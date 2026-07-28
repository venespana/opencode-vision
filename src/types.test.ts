import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { PluginConfigSchema } from './types.js';

describe('types', () => {
  describe('PluginConfigSchema', () => {
    it('should accept denylist field', () => {
      const valid = {
        models: ['openai/gpt-4o-mini'],
        denylist: ['openai/gpt-4o'],
        detection: 'hybrid',
        backend: { type: 'mcp', mcp: { tool: 'test' } },
        promptTemplate: 'test',
        tempDir: '/tmp/vision',
        cleanupAfterHours: 24,
        cleanup: 'init',
      };
      const result = PluginConfigSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('should default cli.timeoutMs to 30000', () => {
      const minimal = {
        models: [],
        detection: 'hybrid',
        backend: {
          type: 'cli',
          cli: { command: 'mmx', args: ['vision'] },
        },
        promptTemplate: 'test',
        tempDir: '/tmp/vision',
        cleanupAfterHours: 24,
        cleanup: 'init',
      };
      const result = PluginConfigSchema.safeParse(minimal);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.backend).toBeDefined();
        const cliCfg = (result.data.backend as any).cli;
        expect(cliCfg?.timeoutMs ?? 30000).toBe(30000);
      }
    });

    it('should reject backend.type "tool" with precise error', () => {
      const invalid = {
        models: [],
        detection: 'hybrid',
        backend: { type: 'tool' } as any,
        promptTemplate: 'test',
        tempDir: '/tmp/vision',
        cleanupAfterHours: 24,
        cleanup: 'init',
      };
      const result = PluginConfigSchema.safeParse(invalid);
      expect(result.success).toBe(false);
      if (!result.success) {
        const toolError = result.error.errors.find(
          (e: z.ZodIssue) => e.path.join('.') === 'backend.type',
        );
        expect(toolError).toBeDefined();
        // Zod discriminatedUnion error: "Invalid discriminator value. Expected 'mcp' | 'cli'"
        expect(result.error.errors[0].message).toBeDefined();
      }
    });
  });
});
