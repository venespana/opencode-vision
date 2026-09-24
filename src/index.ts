import { Plugin } from '@opencode/plugin';
import type { Plugin as V1Plugin, PluginOptions } from '@opencode-ai/plugin';
import { loadConfig } from './config.js';
import { initCleanup } from './cleanup.js';
import { applyVisionTransform, applyVisionTransformV2 } from './transform.js';
import { configureLogging, debug } from './logger.js';
import { setClient, setProvidersResolver } from './detection.js';
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

const PLUGIN_ID = 'opencode-vision';

// ─────────────────────────────────────────────────────────────────────────────
// bootstrap — shared init for both runtimes: config resolution, logging,
// init-time TTL cleanup. `warn` is the runtime-specific warn-log sink.
// ─────────────────────────────────────────────────────────────────────────────
function bootstrap(options: PluginOptions | undefined, warn: (message: string) => void): PluginConfig {
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
    warn(`cleanup error: ${msg}`);
  }

  return config;
}

// ─────────────────────────────────────────────────────────────────────────────
// V1 wiring — `server()` entry. V1 runtimes (OpenCode 1.x) call this.
// Registers the `experimental.chat.messages.transform` hook.
//
// CRITICAL: hooks must be returned at the TOP LEVEL of the object, NOT nested
// inside a `hooks` property. The Plugin type expects `Promise<Hooks>` where
// Hooks is a flat interface with hook names as keys.
// ─────────────────────────────────────────────────────────────────────────────
export const VisionPlugin: V1Plugin = async (ctx, options?: PluginOptions) => {
  const { client, directory } = ctx;

  // Inject client into detection module so it can resolve model capabilities
  setClient(client, directory);

  const config = bootstrap(options, (message) =>
    (client.app.log as any)({ level: 'warn', message: `[opencode-vision] ${message}` }),
  );

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

// ─────────────────────────────────────────────────────────────────────────────
// V2 wiring — `setup(ctx)` entry. V2 runtimes (OpenCode 2.x) call this.
// V1 hook mapping (per docs/build/plugins/migrate-v1):
//   experimental.chat.messages.transform → ctx.session.hook("context")
// The `context` hook covers agent-loop model requests — the same scope the V1
// hook ran in. Compaction/title/generate requests are not bridged.
// ─────────────────────────────────────────────────────────────────────────────
const v2Plugin = Plugin.define({
  id: PLUGIN_ID,
  async setup(ctx) {
    // V1 resolved model capabilities through the SDK client
    // (client.config.providers); V2 exposes the model registry on the context
    // instead. Adapt it to the resolver shape detection.ts expects.
    setProvidersResolver(async () => {
      const { data: models } = await ctx.model.list();
      const byProvider = new Map<
        string,
        {
          provider: string;
          id: string;
          models: Array<{ id: string; capabilities: { input: { image: boolean } } }>;
        }
      >();
      for (const model of models) {
        let entry = byProvider.get(model.providerID);
        if (!entry) {
          entry = { provider: model.providerID, id: model.providerID, models: [] };
          byProvider.set(model.providerID, entry);
        }
        entry.models.push({
          id: model.id,
          capabilities: {
            input: {
              // V2 capability model: `input` is a modality string list.
              image: Array.isArray(model.capabilities?.input) && model.capabilities.input.includes('image'),
            },
          },
        });
      }
      return { providers: [...byProvider.values()] };
    });

    // V2 context exposes no warn-log sink; debug file logging still applies.
    const config = bootstrap(ctx.options, () => {});

    await ctx.session.hook('context', async (event) => {
      debug('context hook fired; messages=' + (event.messages?.length ?? 0));
      try {
        await applyVisionTransformV2(event, config);
      } catch (err) {
        debug('transform error: ' + (err instanceof Error ? err.message : String(err)));
      }
    });
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Dual default export: V1 runtimes call server(), V2 runtimes call setup().
// This shape does NOT translate hooks automatically — server() and setup()
// wire their own runtime to the shared pipeline in transform.ts.
// ─────────────────────────────────────────────────────────────────────────────
export default {
  id: v2Plugin.id,
  setup: v2Plugin.setup,
  server: VisionPlugin,
};
