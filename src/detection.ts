// No crypto needed in detection — hashing is done in images.ts

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
      if (p.provider !== providerID) continue;
      for (const m of p.models) {
        if (m.id !== modelID) continue;
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
// Real SDK providers resolver — uses globalThis (SDK injects client there)
// ─────────────────────────────────────────────────────────────────────────────
async function realProvidersResolver() {
   
  const client = (globalThis as any).__opencode_client__;
  if (!client?.config?.providers) {
    return { providers: [] };
  }
  return client.config.providers() as Promise<{
    providers: Array<{
      provider: string;
      models: Array<{ id: string; capabilities: { input?: { image?: boolean } } }>;
    }>;
  }>;
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
      return false;
    }
  }

  // 2. Allowlist check — force-on (005)
  for (const pattern of models) {
    if (matchPattern(pattern, model.providerID, model.modelID)) {
      return true;
    }
  }

  // 3. Auto-detect via capability resolution
  const cap = await resolveCapabilities(model.providerID, model.modelID);

  if (cap.resolved) {
    // 002: vision model → skip
    if (cap.input.image === true) return false;
    // 003: text-only → activate
    if (cap.input.image === false) return true;
    // Fall through to hybrid/patterns fallback
  }

  // 4. Hybrid/patterns fallback (004)
  if (detection === 'hybrid' || detection === 'patterns') {
    // Empty allowlist → false
    for (const pattern of models) {
      if (matchPattern(pattern, model.providerID, model.modelID)) {
        return true;
      }
    }
  }

  return false;
}
