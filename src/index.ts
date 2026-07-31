import type { Plugin, PluginOptions } from '@opencode-ai/plugin';
import { loadConfig } from './config.js';
import { initCleanup } from './cleanup.js';
import { applyVisionTransform } from './transform.js';
import { configureLogging, debug } from './logger.js';
import { setClient } from './detection.js';
import type { PluginConfig } from './types.js';

export type { PluginConfig };

// ─────────────────────────────────────────────────────────────────────────────
// safeJson — compact JSON for debug logging. Omits promptTemplate body
// (only its length) to keep the log concise. Never throws.
// ─────────────────────────────────────────────────────────────────────────────
function safeJson(config: PluginConfig): string {
  try {
    const { promptTemplate, ...rest } = config;
    const summarized = {
      ...rest,
      promptTemplateLength: typeof promptTemplate === 'string' ? promptTemplate.length : 0,
    };
    return JSON.stringify(summarized);
  } catch (err) {
    return `<unserializable config: ${err instanceof Error ? err.message : String(err)}>`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// VisionPlugin — the plugin entry point
// Registers the `experimental.chat.messages.transform` hook.
//
// CRITICAL: hooks must be returned at the TOP LEVEL of the object, NOT nested
// inside a `hooks` property. The Plugin type expects `Promise<Hooks>` where
// Hooks is a flat interface with hook names as keys.
// ─────────────────────────────────────────────────────────────────────────────
export const VisionPlugin: Plugin = async (ctx, options?: PluginOptions) => {
  const { client, directory } = ctx;

  // Inject client into detection module so it can resolve model capabilities
  setClient(client, directory);

  // Load configuration: inline options > project file > user file > defaults
  const config = loadConfig(options);

  // Configure module-level debug logging based on resolved config.
  configureLogging({ enabled: !!config.debug, logFile: config.logFile ?? '' });
  debug('opencode-vision plugin loaded');
  debug('config: ' + safeJson(config));

  // Run init-time TTL cleanup (sync, non-blocking)
  try {
    initCleanup(config);
    debug('init cleanup complete');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    debug(`error: init cleanup failed: ${msg}`);
    (client.app.log as any)({ level: 'warn', message: `[opencode-vision] cleanup error: ${msg}` });
  }

  return {
    'experimental.chat.messages.transform': async (_input: any, output: any) => {
      debug('transform fired; output.messages=' + (output?.messages?.length ?? 0));
      try {
        await applyVisionTransform(output, config, { client });
      } catch (err) {
        debug('transform error: ' + (err instanceof Error ? err.message : String(err)));
      }
    },
  };
};

export default VisionPlugin;
