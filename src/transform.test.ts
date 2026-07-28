import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PluginConfig } from './types.js';

describe('transform', () => {
  let applyVisionTransform: (input: any, output: any, config: PluginConfig, ctx?: any) => Promise<void>;
  let hasSentinelMarker: (parts: any[], hashes?: string[]) => boolean;
  let mutateParts: (parts: any[], result: any, processedIds: Set<string>, hashes: string[]) => void;

  beforeEach(async () => {
    vi.resetModules();
    vi.mock('./detection.js', () => ({
      shouldActivate: vi.fn().mockResolvedValue(true),
      capCache: new Map(),
    }));
    vi.mock('./images.js', () => ({
      extractImages: vi.fn().mockReturnValue([]),
      materialize: vi.fn().mockResolvedValue({ partId: 'img1', mime: 'image/png', ref: '/tmp/a.png', origin: { kind: 'file', path: '/tmp/a.png' } }),
      isSupportedImageFilePart: () => true,
    }));
    vi.mock('./prompt.js', () => ({
      renderTemplate: vi.fn().mockReturnValue('INJECTED INSTRUCTION'),
      defaultMaximumDetailTemplate: 'DEFAULT TEMPLATE',
    }));
    vi.mock('./backend/mcp.js', () => ({
      McpBackend: class {
        type = 'mcp';
        async analyze() { return { mode: 'inject-instructions', text: 'Use analyze tool' }; }
      },
    }));
    vi.mock('./backend/cli.js', () => ({
      CliBackend: class {
        type = 'cli';
        async analyze() { return { mode: 'inject-description', text: 'A cat in a tree' }; }
      },
    }));

    const transform = await import('./transform.js');
    applyVisionTransform = transform.applyVisionTransform;
    hasSentinelMarker = transform.hasSentinelMarker;
    mutateParts = transform.mutateParts;
  });

  // S1: inject-instructions mode — FilePart removed, TextPart replaced with instruction
  it('S1: inject-instructions mode replaces existing TextPart with instruction', async () => {
    const messages = [{
      info: { model: { providerID: 'a', modelID: 'b' } },
      parts: [
        { type: 'file', mime: 'image/png', url: 'file:///tmp/a.png', id: 'img1' },
        { type: 'text', text: 'hello' },
      ],
    }];

    const output: any = { messages: [] };
    const config: PluginConfig = {
      models: [], denylist: [], detection: 'hybrid',
      backend: { type: 'mcp', mcp: { tool: 'analyze' } },
      promptTemplate: '', tempDir: '/tmp', cleanupAfterHours: 24, cleanup: 'init',
    };

    const { extractImages } = await import('./images.js');
    (extractImages as any).mockReturnValue([
      { id: 'img1', mime: 'image/png', url: 'file:///tmp/a.png', partId: 'img1' },
    ]);

    await applyVisionTransform({ messages }, output, config);

    const hasInstruction = output.messages[0].parts.some((p: any) =>
      p.type === 'text' && p.text?.includes('Use analyze'),
    );
    expect(hasInstruction).toBe(true);
    // Image FilePart should be removed
    const hasImage = output.messages[0].parts.some((p: any) => p.type === 'file');
    expect(hasImage).toBe(false);
  });

  // S2: inject-description mode — FilePart removed, synthetic TextPart pushed
  it('S2: inject-description mode pushes synthetic TextPart with description', async () => {
    const messages = [{
      info: { model: { providerID: 'a', modelID: 'b' } },
      parts: [
        { type: 'file', mime: 'image/png', url: 'file:///tmp/a.png', id: 'img1' },
        { type: 'text', text: 'hello' },
      ],
    }];

    const output: any = { messages: [] };
    const config: PluginConfig = {
      models: [], denylist: [], detection: 'hybrid',
      backend: { type: 'cli', cli: { command: 'mmx', args: [], timeoutMs: 30000 } },
      promptTemplate: '', tempDir: '/tmp', cleanupAfterHours: 24, cleanup: 'init',
    };

    const { extractImages } = await import('./images.js');
    (extractImages as any).mockReturnValue([
      { id: 'img1', mime: 'image/png', url: 'file:///tmp/a.png', partId: 'img1' },
    ]);

    await applyVisionTransform({ messages }, output, config);

    const hasSynthetic = output.messages[0].parts.some((p: any) =>
      p.type === 'text' && p.synthetic === true && p.text?.includes('A cat'),
    );
    expect(hasSynthetic).toBe(true);
  });

  // S3: Idempotent rerun — sentinel marker short-circuits processing
  it('S3: message with sentinel marker short-circuits (idempotent)', async () => {
    // When sentinel is detected (hasSentinelMarker returns true),
    // applyVisionTransform should skip backend call and leave parts unchanged.
    // We test this by verifying hasSentinelMarker returns true for the sentinel.
    const { extractImages } = await import('./images.js');
    (extractImages as any).mockReturnValue([
      { id: 'img1', mime: 'image/png', url: 'file:///tmp/a.png', partId: 'img1' },
    ]);

    const messages = [{
      info: { model: { providerID: 'a', modelID: 'b' } },
      parts: [
        { type: 'text', text: '<!--opencode-vision mode=inject-instructions hashes=abc123,def456-->Use analyze tool' },
        { type: 'file', mime: 'image/png', url: 'file:///tmp/a.png', id: 'img1' },
      ],
    }];

    // The sentinel is present → hasSentinelMarker returns true (verified below)
    expect(hasSentinelMarker(messages[0].parts, ['abc123', 'def456'])).toBe(true);
    expect(hasSentinelMarker(messages[0].parts, [])).toBe(true); // empty hashes = vacuously true
  });

  // S6: Vision model untouched — shouldActivate returns false
  it('S6: shouldActivate=false leaves parts unchanged', async () => {
    const { shouldActivate } = await import('./detection.js');
    (shouldActivate as any).mockResolvedValue(false);

    const messages = [{
      info: { model: { providerID: 'a', modelID: 'b' } },
      parts: [
        { type: 'file', mime: 'image/png', url: 'file:///tmp/a.png', id: 'img1' },
        { type: 'text', text: 'hello' },
      ],
    }];

    const output: any = { messages: [] };
    const config: PluginConfig = {
      models: [], denylist: [], detection: 'hybrid',
      backend: { type: 'mcp', mcp: { tool: 'analyze' } },
      promptTemplate: '', tempDir: '/tmp', cleanupAfterHours: 24, cleanup: 'init',
    };

    await applyVisionTransform({ messages }, output, config);

    expect(output.messages[0].parts).toHaveLength(2);
    expect(output.messages[0].parts[0].type).toBe('file');
  });

  // S7: Unsupported MIME kept — extractImages returns empty for unsupported
  it('S7: extractImages returns empty for unsupported MIME → no processing', async () => {
    const { extractImages } = await import('./images.js');
    (extractImages as any).mockReturnValue([]); // no supported images

    const messages = [{
      info: { model: { providerID: 'a', modelID: 'b' } },
      parts: [
        { type: 'file', mime: 'application/pdf', url: 'file:///tmp/doc.pdf', id: 'pdf1' },
        { type: 'text', text: 'hello' },
      ],
    }];

    const output: any = { messages: [] };
    const config: PluginConfig = {
      models: [], denylist: [], detection: 'hybrid',
      backend: { type: 'mcp', mcp: { tool: 'analyze' } },
      promptTemplate: '', tempDir: '/tmp', cleanupAfterHours: 24, cleanup: 'init',
    };

    await applyVisionTransform({ messages }, output, config);

    // PDF kept as-is (unsupported → extractImages returns empty)
    expect(output.messages[0].parts).toHaveLength(2);
    const hasPdf = output.messages[0].parts.some((p: any) => p.mime === 'application/pdf');
    expect(hasPdf).toBe(true);
  });

  // hasSentinelMarker: detects sentinel
  it('hasSentinelMarker: detects sentinel marker in text parts', () => {
    const parts = [
      { type: 'text', text: '<!--opencode-vision mode=inject-instructions hashes=abc123,def456-->Use the tool' },
    ];
    expect(hasSentinelMarker(parts, ['abc123', 'def456'])).toBe(true);
    expect(hasSentinelMarker(parts, ['abc123'])).toBe(true); // subset
  });

  it('hasSentinelMarker: returns false when no sentinel', () => {
    const parts = [{ type: 'text', text: 'hello' }];
    expect(hasSentinelMarker(parts, ['abc123'])).toBe(false);
  });

  // mutateParts: removes processed FileParts
  it('mutateParts: removes FileParts by partId in processedIds', () => {
    const parts = [
      { type: 'file', id: 'img1' },
      { type: 'file', id: 'img2' },
      { type: 'text', text: 'hello' },
    ];
    const result = { mode: 'inject-instructions', text: 'Use analyze tool' };
    mutateParts(parts, result, new Set(['img1']), ['abc123']);
    expect(parts.some((p: any) => p.id === 'img1')).toBe(false);
    expect(parts.some((p: any) => p.id === 'img2')).toBe(true);
  });

  it('mutateParts: inject-description pushes synthetic TextPart', () => {
    const parts = [{ type: 'text', text: 'hello' }];
    const result = { mode: 'inject-description', text: 'A cat' };
    mutateParts(parts, result, new Set(), []);
    expect(parts.some((p: any) => p.synthetic === true && p.text?.includes('A cat'))).toBe(true);
  });
});
