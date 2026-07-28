import type { VisionBackend, SavedImage } from './types.js';
import type { McpBackendConfig } from '../types.js';

// ─────────────────────────────────────────────────────────────────────────────
// McpBackend — inject-instructions mode
// Produces a VisionResult telling the model to call the configured MCP tool
// with the image path/URL and the user's original question.
// ─────────────────────────────────────────────────────────────────────────────
export class McpBackend implements VisionBackend {
  public readonly type = 'mcp' as const;

  constructor(private readonly config: McpBackendConfig) {}

  analyze(ctx: { images: SavedImage[]; userText: string; prompt: string }): Promise<{ mode: 'inject-instructions'; text: string }> {
    const { images, userText } = ctx;
    const tool = this.config.tool;
    const imageRefs = images.map((img) => img.ref).join(', ');

    const instruction = [
      `Use the ${tool} tool to analyze the following image(s): ${imageRefs}`,
      `User's request: "${userText}"`,
      this.config.prompt ? `Additional context: ${this.config.prompt}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    return Promise.resolve({ mode: 'inject-instructions', text: instruction });
  }
}
