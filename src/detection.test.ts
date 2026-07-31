import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('detection', () => {
  describe('shouldActivate', () => {
    let shouldActivate: (model: { providerID: string; modelID: string }, config?: { denylist?: string[]; models?: string[]; detection?: 'auto' | 'patterns' | 'hybrid' }) => Promise<boolean>;
    let setProvidersResolver: (resolver: () => Promise<{ providers: Array<{ provider: string; models: Array<{ id: string; capabilities: { input?: { image?: boolean } } }> }> }>) => void;
    let capCache: Map<string, { resolved: boolean; input: { image?: boolean } }>;

    beforeEach(async () => {
      vi.resetModules();
      const detection = await import('./detection.js');
      shouldActivate = detection.shouldActivate;
      setProvidersResolver = detection.setProvidersResolver as any;
      capCache = detection.capCache as Map<string, { resolved: boolean; input: { image?: boolean } }>;
      capCache.clear();
    });

    // S1: Vision model skipped — input.image===true → plugin NOT activated
    it('S1: should NOT activate when model has input.image===true (vision model)', async () => {
      setProvidersResolver(() => Promise.resolve({
        providers: [{
          provider: 'openai',
          models: [{
            id: 'gpt-4o',
            capabilities: { input: { image: true } },
          }],
        }],
      }));
      const model = { providerID: 'openai', modelID: 'gpt-4o' };
      const result = await shouldActivate(model);
      expect(result).toBe(false);
    });

    // S2: Text-only activates — input.image===false → plugin activated
    it('S2: should activate when model has input.image===false (text-only)', async () => {
      setProvidersResolver(() => Promise.resolve({
        providers: [{
          provider: 'anthropic',
          models: [{
            id: 'claude-3-haiku',
            capabilities: { input: { image: false } },
          }],
        }],
      }));
      const model = { providerID: 'anthropic', modelID: 'claude-3-haiku' };
      const result = await shouldActivate(model);
      expect(result).toBe(true);
    });

    // S3: Unresolvable + hybrid falls back to allowlist match
    it('S3: unresolvable model + hybrid detection + allowlist match → activate', async () => {
      // Model not in providers, hybrid mode, models allowlist matches
      setProvidersResolver(() => Promise.resolve({ providers: [] }));
      const model = { providerID: 'unknown', modelID: 'model-x' };
      const result = await shouldActivate(model, {
        detection: 'hybrid',
        models: ['unknown/*'],
      });
      expect(result).toBe(true);
    });

    // S4: Denylist wins over allowlist — force-off
    it('S4: denylist match returns false even if model would auto-activate', async () => {
      setProvidersResolver(() => Promise.resolve({
        providers: [{
          provider: 'openai',
          models: [{
            id: 'gpt-4o',
            capabilities: { input: { image: false } }, // would activate
          }],
        }],
      }));
      const model = { providerID: 'openai', modelID: 'gpt-4o' };
      // Denylist overrides auto-detect
      const result = await shouldActivate(model, {
        denylist: ['openai/*'],
      });
      expect(result).toBe(false);
    });

    // S5: providers() fail → no throw, falls back to patterns
    it('S5: providers() throwing does not throw — falls back to patterns', async () => {
      setProvidersResolver(() => { throw new Error('providers() failed'); });
      const model = { providerID: 'some', modelID: 'model' };
      // Should not throw — must fall back to pattern matching
      await expect(shouldActivate(model, { models: ['some/*'] })).resolves.not.toThrow();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Real SDK (hey-api) client shape — these exercise realProvidersResolver via
  // setClient, WITHOUT bypassing it via setProvidersResolver. The opencode SDK
  // is built on hey-api, so client.config.providers() resolves to a wrapped
  // { data: { providers: [...] }, error, request, response } envelope. Reading
  // result.providers directly yields undefined → capabilities never resolve.
  // ───────────────────────────────────────────────────────────────────────────
  describe('shouldActivate (real hey-api client shape via setClient)', () => {
    type ShouldActivate = (model: { providerID: string; modelID: string }, config?: { denylist?: string[]; models?: string[]; detection?: 'auto' | 'patterns' | 'hybrid' }) => Promise<boolean>;
    let shouldActivate: ShouldActivate;
    let setClient: (client: any, directory?: string) => void;
    let setProvidersResolver: (resolver: any) => void;
    let capCache: Map<string, { resolved: boolean; input: { image?: boolean } }>;

    beforeEach(async () => {
      vi.resetModules();
      const detection = await import('./detection.js');
      shouldActivate = detection.shouldActivate;
      setClient = detection.setClient;
      setProvidersResolver = detection.setProvidersResolver as any;
      capCache = detection.capCache as any;
      // Ensure realProvidersResolver is used (not an injected test resolver)
      setProvidersResolver(null);
      setClient(null);
      capCache.clear();
    });

    afterEach(() => {
      setClient(null);
    });

    // R1: text-only model activates when providers() returns the hey-api
    // envelope { data: { providers: [...] } }. Before the fix, result.providers
    // was undefined → resolveCapabilities threw → unresolved → activation=false.
    it('R1: activates text-only model via real hey-api envelope { data: { providers } }', async () => {
      setClient({
        config: {
          providers: async () => ({
            data: {
              providers: [
                {
                  id: 'zai-coding-plan',
                  models: {
                    'glm-5.2': {
                      id: 'glm-5.2',
                      capabilities: { input: { image: false } },
                    },
                  },
                },
              ],
            },
          }),
        },
      });
      capCache.clear();
      const result = await shouldActivate(
        { providerID: 'zai-coding-plan', modelID: 'glm-5.2' },
        { detection: 'auto' },
      );
      expect(result).toBe(true);
    });

    // R2: vision model is skipped BECAUSE it was detected as vision
    // (resolved=true, input.image=true). Asserting on capCache distinguishes a
    // correct detection from an unresolved fallback to the same boolean.
    it('R2: skips vision model via real hey-api envelope (detected, not unresolved)', async () => {
      setClient({
        config: {
          providers: async () => ({
            data: {
              providers: [
                {
                  id: 'zai-coding-plan',
                  models: {
                    'glm-5.2-vision': {
                      id: 'glm-5.2-vision',
                      capabilities: { input: { image: true } },
                    },
                  },
                },
              ],
            },
          }),
        },
      });
      capCache.clear();
      const result = await shouldActivate(
        { providerID: 'zai-coding-plan', modelID: 'glm-5.2-vision' },
        { detection: 'auto' },
      );
      expect(result).toBe(false);
      const cached = capCache.get('zai-coding-plan:glm-5.2-vision');
      expect(cached?.resolved).toBe(true);
      expect(cached?.input.image).toBe(true);
    });

    // R3: regression guard for the `?? result?.providers` fallback branch — a
    // client that returns an unwrapped { providers: [...] } (no `data` envelope)
    // must still resolve after the fix.
    it('R3: still resolves when providers() returns unwrapped { providers } (fallback branch)', async () => {
      setClient({
        config: {
          providers: async () => ({
            providers: [
              {
                id: 'legacy',
                models: {
                  'legacy-text': {
                    id: 'legacy-text',
                    capabilities: { input: { image: false } },
                  },
                },
              },
            ],
          }),
        },
      });
      capCache.clear();
      const result = await shouldActivate(
        { providerID: 'legacy', modelID: 'legacy-text' },
        { detection: 'auto' },
      );
      expect(result).toBe(true);
    });
  });
});
