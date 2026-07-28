import type { Plugin, PluginOptions } from '@opencode-ai/plugin';
import { loadConfig } from './config.js';
import { initCleanup } from './cleanup.js';
import { applyVisionTransform } from './transform.js';
import type { PluginConfig } from './types.js';

export type { PluginConfig };

// ─────────────────────────────────────────────────────────────────────────────
// VisionPlugin — the plugin entry point
// Registers the `experimental.chat.messages.transform` hook.
// ─────────────────────────────────────────────────────────────────────────────
export const VisionPlugin: Plugin = async (ctx, options?: PluginOptions) => {
  const { client } = ctx;

  // Load configuration: inline options > project file > user file > defaults
  const config = loadConfig(options);

  // Run init-time TTL cleanup (sync, non-blocking)
  try {
    initCleanup(config);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    (client.app.log as any)({ level: 'warn', message: `[opencode-vision] cleanup error: ${msg}` });
  }

  return {
    hooks: {
      'experimental.chat.messages.transform': (input: any, output: any) =>
        applyVisionTransform(input, output, config, { client }),
    },
  } as any;
};

export default VisionPlugin;
