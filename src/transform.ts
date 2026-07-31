import { extractImages, materialize } from './images.js';
import { shouldActivate } from './detection.js';
import { renderTemplate } from './prompt.js';
import { McpBackend } from './backend/mcp.js';
import { CliBackend } from './backend/cli.js';
import { debug } from './logger.js';
import type { PluginConfig, VisionResult, SavedImage } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Sentinel marker regex — embedded at start of every injected/rewritten TextPart
// Format: <!--opencode-vision mode=<m> hashes=<h1,h2>-->
// ─────────────────────────────────────────────────────────────────────────────
const SENTINEL_REGEX = /<!--opencode-vision mode=(inject-instructions|inject-description) hashes=([^>]*)-->/;

export const SENTINEL_PREFIX = (mode: string, hashes: string[]) =>
  `<!--opencode-vision mode=${mode} hashes=${hashes.join(',')}-->`;

// ─────────────────────────────────────────────────────────────────────────────
// hasSentinelMarker — checks if parts already contain a sentinel for given hashes
// Short-circuits re-analysis on idempotent rerun.
// ─────────────────────────────────────────────────────────────────────────────
export function hasSentinelMarker(
  parts: Array<{ type: string; text?: string }>,
  hashes: string[] = [],
): boolean {
  for (const part of parts) {
    if (part.type !== 'text' || !part.text) continue;
    const match = part.text.match(SENTINEL_REGEX);
    if (!match) continue;
    const [, , existingHashes] = match;
    const existingSet = new Set(existingHashes.split(',').filter(Boolean));
    // All current hashes must be present in the sentinel
    const allPresent = hashes.every((h) => existingSet.has(h));
    if (allPresent) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// mutateParts — mutates the parts array in place per VisionResult.mode
// - Removes processed image FileParts (by partId)
// - For inject-instructions: replaces existing TextPart
// - For inject-description: pushes synthetic TextPart
// - Does NOT remove unsupported MIME parts
// ─────────────────────────────────────────────────────────────────────────────
export function mutateParts(
  parts: any[],
  result: VisionResult,
  processedIds: Set<string>,
  hashes: string[],
): void {
  // Remove processed FileParts by partId
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (part.type === 'file' && processedIds.has(part.id)) {
      parts.splice(i, 1);
    }
  }

  // Find existing TextPart to replace (for inject-instructions)
  const textPartIndex = parts.findIndex((p) => p.type === 'text');

  const sentinel = SENTINEL_PREFIX(result.mode, hashes);

  if (result.mode === 'inject-instructions') {
    if (textPartIndex >= 0) {
      // Replace existing TextPart
      parts[textPartIndex] = {
        type: 'text',
        text: sentinel + result.text,
      };
    } else {
      // Push synthetic
      parts.push({ type: 'text', text: sentinel + result.text, synthetic: true });
    }
  } else {
    // inject-description: push synthetic TextPart
    parts.push({ type: 'text', text: sentinel + result.text, synthetic: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// applyVisionTransform — main transform function registered as the hook
// Mutates output.messages in place.
// ─────────────────────────────────────────────────────────────────────────────
export async function applyVisionTransform(
  output: { messages?: Array<{ info?: { model?: { providerID: string; modelID: string } }; parts?: any[] }> },
  config: PluginConfig,
  ctx?: { client?: any },
): Promise<void> {
  // Messages are in output.messages (opencode populates them before calling the hook).
  // The hook mutates output.messages in place.
  if (!output?.messages || !Array.isArray(output.messages)) {
    debug('transform: no messages in output, skipping');
    return;
  }

  let msgIndex = 0;
  for (let idx = 0; idx < output.messages.length; idx++) {
    msgIndex++;
    const msg = output.messages[idx];

    // Guard: message must have info.model and parts
    if (!msg?.info?.model || !msg?.parts || !Array.isArray(msg.parts)) {
      debug(`message ${msgIndex}: missing info.model or parts, skipping`);
      continue;
    }

    const { model } = msg.info;
    debug(`message ${msgIndex} model=${model.providerID}/${model.modelID}`);

    // Diagnostic: log all part types and mimes
    for (const p of msg.parts) {
      const meta = p.type === 'file' ? ` mime=${p.mime} url=${(p.url ?? '').substring(0, 60)}` : '';
      debug(`  part: type=${p.type}${meta}`);
    }

    // Step 1: Detection — should we activate?
    const activated = await shouldActivate(model, {
      denylist: config.denylist,
      models: config.models,
      detection: config.detection,
    });
    if (!activated) {
      debug('shouldActivate=false');
      continue;
    }
    debug('shouldActivate=true');

    // Step 2: Extract supported image FileParts
    const imageParts = extractImages(msg.parts);
    if (imageParts.length === 0) {
      debug('extracted 0 image(s)');
      continue;
    }
    debug(`extracted ${imageParts.length} image(s)`);

    // Step 3: Idempotency — check sentinel marker
    const imageHashes: string[] = [];
    for (const img of imageParts) {
      if (img.origin?.kind === 'base64' && img.ref) {
        const match = img.ref.match(/vision-([a-f0-9]{64})/);
        if (match) imageHashes.push(match[1]);
      }
    }

    if (imageHashes.length > 0 && hasSentinelMarker(msg.parts, imageHashes)) {
      debug('idempotent skip (sentinel present)');
      continue;
    }

    // Step 4: Materialize images (write base64 to temp files)
    const savedImages: SavedImage[] = [];
    const processedIds = new Set<string>();

    for (const img of imageParts) {
      const saved = materialize(img, config.tempDir);
      savedImages.push(saved);
      processedIds.add(img.partId);
      if (saved.ref) {
        const match = saved.ref.match(/vision-([a-f0-9]{64})/);
        if (match && !imageHashes.includes(match[1])) {
          imageHashes.push(match[1]);
        }
      }
    }

    // Step 5: Render prompt
    const userText = msg.parts.find((p: any) => p.type === 'text')?.text ?? '';
    const prompt = renderTemplate(config.promptTemplate, savedImages, userText);

    // Step 6: Call backend
    let result: VisionResult;
    try {
      const backend =
        config.backend.type === 'mcp'
          ? new McpBackend(config.backend.mcp)
          : new CliBackend(config.backend.cli, ctx?.client);

      result = await backend.analyze({ images: savedImages, userText, prompt });
      debug(`backend result mode=${result.mode} textLen=${result.text.length}`);
    } catch (err) {
      // Fail-soft: inject error description
      const msg2 = err instanceof Error ? err.message : String(err);
      debug(`error: backend threw: ${msg2}`);
      result = { mode: 'inject-description', text: `[opencode-vision] backend error: ${msg2}` };
    }

    // Step 7: Mutate message parts in place.
    // Clone the parts array so we don't corrupt the original message object
    // if the same message is processed again on a transform rerun.
    msg.parts = [...msg.parts];
    mutateParts(msg.parts, result, processedIds, imageHashes);
  }
}
