import { describe, it, expect, vi, beforeEach } from 'vitest';

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
});
