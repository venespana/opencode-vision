import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('backend/mcp', () => {
  let McpBackend: new (cfg: any) => any;

  beforeEach(async () => {
    vi.resetModules();
    const mcp = await import('./mcp.js');
    McpBackend = mcp.McpBackend;
  });

  // S1: MCP analyze returns inject-instructions with tool call instruction
  it('S1: analyze returns inject-instructions mode with tool call instruction', async () => {
    const backend = new McpBackend({
      tool: 'openrouter_image_analyze',
      prompt: 'Describe the image.',
    });
    const result = await backend.analyze({
      images: [{ partId: 'p1', mime: 'image/png', ref: '/tmp/image.png', origin: { kind: 'file', path: '/tmp/image.png' } }],
      userText: 'What is in this image?',
      prompt: 'You are a helpful assistant.',
    });
    expect(result.mode).toBe('inject-instructions');
    expect(result.text).toContain('openrouter_image_analyze');
    expect(result.text).toContain('/tmp/image.png');
    expect(result.text).toContain('What is in this image?');
  });

  it('S1: instruction tells model to call the configured tool', async () => {
    const backend = new McpBackend({ tool: 'my_image_tool' });
    const result = await backend.analyze({
      images: [{ partId: 'p1', mime: 'image/jpeg', ref: 'https://example.com/photo.jpg', origin: { kind: 'url', url: 'https://example.com/photo.jpg' } }],
      userText: 'Describe this photo',
      prompt: 'You are a helpful assistant.',
    });
    expect(result.mode).toBe('inject-instructions');
    expect(result.text).toMatch(/my_image_tool/);
  });
});
