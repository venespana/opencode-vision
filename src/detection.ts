// No crypto needed in detection — hashing is done in images.ts

import { debug } from './logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types (re-exported from types.ts for convenience)
// ─────────────────────────────────────────────────────────────────────────────
export type { SavedImage, Model } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Capability cache — shared across shouldActivate calls within a plugin session
// Maps "providerID:modelID" → { resolved: boolean; input: { image?: boolean } }
// Failures cached as resolved=false to avoid retry storms.
// ─────────────────────────────────────────────────────────────────────────────
export interface CapEntry {
  resolved: boolean;
  input: { image?: boolean };
}
export const capCache = new Map<string, CapEntry>();

// Resolver function — can be replaced for testing
type ProvidersResolver = () => Promise<{
  providers: Array<{
    provider: string;
    models: Array<{ id: string; capabilities: { input?: { image?: boolean } } }>;
  }>;
}>;

let providersResolver: ProvidersResolver | null = null;

export function setProvidersResolver(resolver: ProvidersResolver): void {
  providersResolver = resolver;
}

// ─────────────────────────────────────────────────────────────────────────────
// Glob-style pattern matching (supports * wildcard)
// ─────────────────────────────────────────────────────────────────────────────
function matchPattern(pattern: string, providerID: string, modelID: string): boolean {
  const full = `${providerID}/${modelID}`;
  // Simple glob: split on *, each segment must match sequentially
  const regex = new RegExp(
    '^' + pattern.split('*').map(escapeRegex).join('.*') + '$',
  );
  return regex.test(full);
}

function escapeRegex(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolve capabilities for a single model
// Uses the configured providers resolver (or real SDK if not mocked)
// Failures are cached as unresolved.
// ─────────────────────────────────────────────────────────────────────────────
async function resolveCapabilities(
  providerID: string,
  modelID: string,
): Promise<CapEntry> {
  const cacheKey = `${providerID}:${modelID}`;
  const cached = capCache.get(cacheKey);
  if (cached) return cached;

  try {
    const resolver = providersResolver ?? realProvidersResolver;
    const result = await resolver();
    for (const p of result.providers) {
      // SDK Provider uses `id`, not `provider`
      if (p.provider !== providerID && p.id !== providerID) continue;
      // SDK Provider.models is a Record { [key: string]: Model }, not an array
      const models = Array.isArray(p.models) ? p.models : Object.values(p.models);
      for (const m of models) {
        if (m.id !== modelID) continue;
        debug('detection: matched model=' + providerID + '/' + modelID + ' input.image=' + m.capabilities.input?.image);
        const entry: CapEntry = {
          resolved: true,
          input: { image: m.capabilities.input?.image ?? false },
        };
        capCache.set(cacheKey, entry);
        return entry;
      }
    }
    // Not found in providers → unresolved
    const unresolved: CapEntry = { resolved: false, input: {} };
    capCache.set(cacheKey, unresolved);
    return unresolved;
  } catch {
    // Provider fetch failed → cache as unresolved, no throw
    const unresolved: CapEntry = { resolved: false, input: {} };
    capCache.set(cacheKey, unresolved);
    return unresolved;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Real SDK providers resolver — uses the client injected by the plugin context.
// Falls back to globalThis.__opencode_client__ if set (older SDK versions).
// ─────────────────────────────────────────────────────────────────────────────
let injectedClient: any = null;
let injectedDirectory: string | undefined = undefined;

export function setClient(client: any, directory?: string): void {
  injectedClient = client;
  injectedDirectory = directory;
}

async function realProvidersResolver() {
  const client = injectedClient ?? (globalThis as any).__opencode_client__;
  debug('detection: client=' + (client ? 'yes' : 'no') + ' config=' + (client?.config ? 'yes' : 'no') + ' providers=' + (typeof client?.config?.providers));
  if (!client?.config?.providers) {
    return { providers: [] };
  }
  try {
    const result = await client.config.providers({ directory: injectedDirectory });
    // opencode SDK is built on hey-api: providers() resolves to a wrapped
    // { data: { providers: [...] }, error, request, response } envelope.
    // Fall back to result?.providers for any version that unwraps differently.
    const providers = result?.data?.providers ?? result?.providers ?? [];
    debug('detection: providers() returned ' + providers.length + ' providers');
    if (providers.length > 0) {
      const p0 = providers[0];
      debug('detection: result top-level keys=' + JSON.stringify(Object.keys(result ?? {})));
      debug('detection: provider[0] keys=' + JSON.stringify(Object.keys(p0)));
      debug('detection: provider[0].id=' + p0.id + ' models type=' + typeof p0.models + (Array.isArray(p0.models) ? ' (array)' : ' (object)'));
    }
    return { providers };
  } catch (err) {
    debug('detection: providers() threw: ' + (err instanceof Error ? err.message : String(err)));
    return { providers: [] };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// shouldActivate — decide whether vision bridging should activate for a model
// Follows spec order:
//   1. denylist match → false (force-off, highest priority)
//   2. allowlist (models) match → true (force-on)
//   3. auto-detect via capCache
//   4. hybrid fallback to allowlist if unresolvable
// ─────────────────────────────────────────────────────────────────────────────
export async function shouldActivate(
  model: { providerID: string; modelID: string },
  config?: {
    denylist?: string[];
    models?: string[];
    detection?: 'auto' | 'patterns' | 'hybrid';
  },
): Promise<boolean> {
  const denylist = config?.denylist ?? [];
  const models = config?.models ?? [];
  const detection = config?.detection ?? 'hybrid';

  // 1. Denylist check — force-off (005)
  for (const pattern of denylist) {
    if (matchPattern(pattern, model.providerID, model.modelID)) {
      debug(`shouldActivate=false reason=denylist pattern=${pattern}`);
      return false;
    }
  }

  // 2. Allowlist check — force-on (005)
  for (const pattern of models) {
    if (matchPattern(pattern, model.providerID, model.modelID)) {
      debug(`shouldActivate=true reason=allowlist pattern=${pattern}`);
      return true;
    }
  }

  // 3. Auto-detect via capability resolution
  const cap = await resolveCapabilities(model.providerID, model.modelID);
  debug(`capabilities resolved=${cap.resolved} input.image=${cap.input.image}`);

  if (cap.resolved) {
    // 002: vision model → skip
    if (cap.input.image === true) {
      debug('shouldActivate=false reason=vision-model (caps resolved, input.image=true)');
      return false;
    }
    // 003: text-only → activate
    if (cap.input.image === false) {
      debug('shouldActivate=true reason=text-only-model (caps resolved, input.image=false)');
      return true;
    }
    // Fall through to hybrid/patterns fallback
  }

  // 4. Hybrid/patterns fallback (004)
  if (detection === 'hybrid' || detection === 'patterns') {
    // Empty allowlist → false
    for (const pattern of models) {
      if (matchPattern(pattern, model.providerID, model.modelID)) {
        debug(`shouldActivate=true reason=hybrid/patterns-allowlist pattern=${pattern}`);
        return true;
      }
    }
  }

  debug('shouldActivate=false reason=unresolvable-fallback (no match)');
  return false;
}
