import { extractImages, materialize, isSupportedMime } from './images.js';
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
// VisionPipelineInput / VisionPipelineOutput — runtime-agnostic contract shared
// by the V1 hook adapter (applyVisionTransform) and the V2 adapter
// (applyVisionTransformV2). The pipeline owns everything after image
// extraction: activation, idempotency, materialization, prompting, backend.
// ─────────────────────────────────────────────────────────────────────────────
export interface VisionPipelineInput {
  model: { providerID: string; modelID: string };
  /** Text-bearing parts/content of ONE message (sentinel check + user text). */
  parts: Array<{ type: string; text?: string }>;
  /** Images already extracted from that message by the runtime adapter. */
  images: SavedImage[];
  config: PluginConfig;
  /** Optional SDK client — the CLI backend uses it for warn logging (V1 only). */
  client?: ConstructorParameters<typeof CliBackend>[1];
}

export interface VisionPipelineOutput {
  result: VisionResult;
  processedIds: Set<string>;
  hashes: string[];
}

export async function runVisionPipeline(input: VisionPipelineInput): Promise<VisionPipelineOutput | null> {
  const { model, parts, images, config } = input;

  // Step 1: Detection — should we activate?
  const activated = await shouldActivate(model, {
    denylist: config.denylist,
    models: config.models,
    detection: config.detection,
  });
  if (!activated) {
    debug('shouldActivate=false');
    return null;
  }
  debug('shouldActivate=true');

  // Step 2: Nothing to bridge without supported images
  if (images.length === 0) {
    debug('extracted 0 image(s)');
    return null;
  }
  debug(`extracted ${images.length} image(s)`);

  // Step 3: Idempotency — check sentinel marker
  const imageHashes: string[] = [];
  for (const img of images) {
    if (img.origin?.kind === 'base64' && img.ref) {
      const match = img.ref.match(/vision-([a-f0-9]{64})/);
      if (match) imageHashes.push(match[1]);
    }
  }

  if (imageHashes.length > 0 && hasSentinelMarker(parts, imageHashes)) {
    debug('idempotent skip (sentinel present)');
    return null;
  }

  // Step 4: Materialize images (write base64 to temp files)
  const savedImages: SavedImage[] = [];
  const processedIds = new Set<string>();

  for (const img of images) {
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
  const userText = parts.find((p) => p.type === 'text')?.text ?? '';
  const prompt = renderTemplate(config.promptTemplate, savedImages, userText);

  // Step 6: Call backend
  let result: VisionResult;
  try {
    const backend =
      config.backend.type === 'mcp'
        ? new McpBackend(config.backend.mcp)
        : new CliBackend(config.backend.cli, input.client);

    result = await backend.analyze({ images: savedImages, userText, prompt });
    debug(`backend result mode=${result.mode} textLen=${result.text.length}`);
  } catch (err) {
    // Fail-soft: inject error description
    const msg = err instanceof Error ? err.message : String(err);
    debug(`error: backend threw: ${msg}`);
    result = { mode: 'inject-description', text: `[opencode-vision] backend error: ${msg}` };
  }

  return { result, processedIds, hashes: imageHashes };
}

// ─────────────────────────────────────────────────────────────────────────────
// applyVisionTransform — V1 adapter for the `experimental.chat.messages.transform`
// hook. Mutates output.messages in place.
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

    // Extract supported image FileParts, then run the shared pipeline
    const imageParts = extractImages(msg.parts);
    const outcome = await runVisionPipeline({
      model,
      parts: msg.parts,
      images: imageParts,
      config,
      client: ctx?.client,
    });
    if (!outcome) continue;

    // Step 7: Mutate message parts in place.
    // Clone the parts array so we don't corrupt the original message object
    // if the same message is processed again on a transform rerun.
    msg.parts = [...msg.parts];
    mutateParts(msg.parts, outcome.result, outcome.processedIds, outcome.hashes);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// V2 adapter — @opencode/ai Message content parts.
//
// V2 messages carry media inside `content` as MediaPart entries:
//   { type: 'media', media: { source: { type: 'base64', data, mediaType } } }
//   { type: 'media', media: { source: { type: 'url', url, mediaType? } } }
// Sources of type 'bytes' (in-memory Uint8Array) and 'ref' (provider media
// reference) have no V1 FilePart equivalent and are intentionally not bridged.
// ─────────────────────────────────────────────────────────────────────────────

export interface MediaSourceEntryV2 {
  /** Original content part object — tracked by identity for removal. */
  part: unknown;
  image: SavedImage;
}

export function extractMediaPartsV2(content: Array<any>): MediaSourceEntryV2[] {
  const entries: MediaSourceEntryV2[] = [];
  for (const part of content) {
    if (part?.type !== 'media') continue;
    const source = part.media?.source;
    if (!source) continue;

    if (
      source.type === 'base64' &&
      typeof source.data === 'string' &&
      isSupportedMime(source.mediaType ?? '')
    ) {
      entries.push({
        part,
        image: {
          // V2 media sources carry no per-part id; partId is positional.
          partId: `media-${entries.length}`,
          mime: source.mediaType as SavedImage['mime'],
          ref: '',
          origin: { kind: 'base64', path: `data:${source.mediaType};base64,${source.data}` },
        },
      });
    } else if (
      source.type === 'url' &&
      typeof source.url === 'string' &&
      isSupportedMime(source.mediaType ?? '')
    ) {
      entries.push({
        part,
        image: {
          partId: `media-${entries.length}`,
          mime: source.mediaType as SavedImage['mime'],
          ref: source.url,
          origin: { kind: 'url', url: source.url },
        },
      });
    }
  }
  return entries;
}

// ─────────────────────────────────────────────────────────────────────────────
// mutateContentV2 — V2 counterpart of mutateParts. Mutates a Message content
// array in place: removes processed media parts and injects the result text.
// ─────────────────────────────────────────────────────────────────────────────
export function mutateContentV2(
  content: Array<any>,
  result: VisionResult,
  processedParts: Set<unknown>,
  hashes: string[],
): void {
  // Remove processed media parts by identity
  for (let i = content.length - 1; i >= 0; i--) {
    if (content[i]?.type === 'media' && processedParts.has(content[i])) {
      content.splice(i, 1);
    }
  }

  const sentinel = SENTINEL_PREFIX(result.mode, hashes);
  const textPartIndex = content.findIndex((p) => p?.type === 'text');

  if (result.mode === 'inject-instructions') {
    if (textPartIndex >= 0) {
      // Replace existing text part (spread keeps optional metadata fields)
      content[textPartIndex] = { ...content[textPartIndex], text: sentinel + result.text };
    } else {
      content.push({ type: 'text', text: sentinel + result.text });
    }
  } else {
    // inject-description: append synthetic text part
    content.push({ type: 'text', text: sentinel + result.text });
  }
}

export interface VisionContextEventV2 {
  /** V2 carries one model per request (V1 carried it per message). */
  model?: { providerID: string; id?: string };
  messages?: Array<any>;
}

// ─────────────────────────────────────────────────────────────────────────────
// applyVisionTransformV2 — V2 adapter for the session `context` hook
// (mapped from V1 `experimental.chat.messages.transform`). Mutates
// event.messages in place.
// ─────────────────────────────────────────────────────────────────────────────
export async function applyVisionTransformV2(
  event: VisionContextEventV2,
  config: PluginConfig,
): Promise<void> {
  if (!event?.messages || !Array.isArray(event.messages)) {
    debug('transform: no messages in event, skipping');
    return;
  }

  const model = event.model
    ? { providerID: event.model.providerID, modelID: event.model.id ?? '' }
    : undefined;

  let msgIndex = 0;
  for (const msg of event.messages) {
    msgIndex++;
    const content = msg?.content;

    if (!model || !Array.isArray(content)) {
      debug(`message ${msgIndex}: missing model or content, skipping`);
      continue;
    }
    debug(`message ${msgIndex} model=${model.providerID}/${model.modelID}`);

    const entries = extractMediaPartsV2(content);
    if (entries.length === 0) {
      debug(`message ${msgIndex}: extracted 0 image(s)`);
      continue;
    }

    const outcome = await runVisionPipeline({
      model,
      parts: content,
      images: entries.map((e) => e.image),
      config,
    });
    if (!outcome) continue;

    mutateContentV2(content, outcome.result, new Set(entries.map((e) => e.part)), outcome.hashes);
  }
}
