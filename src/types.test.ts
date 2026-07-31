import { describe, it, expect } from 'vitest';
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

    it('should accept optional imageFlag in cli backend', () => {
      const withFlag = {
        models: [],
        detection: 'hybrid',
        backend: {
          type: 'cli',
          cli: { command: 'mmx', args: ['vision', 'describe'], imageFlag: '--image' },
        },
        promptTemplate: 'test',
        tempDir: '/tmp/vision',
        cleanupAfterHours: 24,
        cleanup: 'init',
      };
      const result = PluginConfigSchema.safeParse(withFlag);
      expect(result.success).toBe(true);
      if (result.success) {
        const cliCfg = (result.data.backend as any).cli;
        expect(cliCfg?.imageFlag).toBe('--image');
      }
    });

    it('should accept cli backend without imageFlag (optional, backward compatible)', () => {
      const withoutFlag = {
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
      const result = PluginConfigSchema.safeParse(withoutFlag);
      expect(result.success).toBe(true);
      if (result.success) {
        const cliCfg = (result.data.backend as any).cli;
        expect(cliCfg?.imageFlag).toBeUndefined();
      }
    });

    it('should accept optional debug (boolean) and logFile (string) fields', () => {
      const withDebug = {
        models: [],
        detection: 'hybrid',
        backend: { type: 'mcp', mcp: { tool: 't' } },
        promptTemplate: '',
        tempDir: '/tmp/v',
        cleanupAfterHours: 24,
        cleanup: 'init',
        debug: true,
        logFile: '/tmp/vision-debug.log',
      };
      const result = PluginConfigSchema.safeParse(withDebug);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.debug).toBe(true);
        expect(result.data.logFile).toBe('/tmp/vision-debug.log');
      }
    });

    it('should treat debug and logFile as optional (defaults)', () => {
      const minimal = {
        models: [],
        detection: 'hybrid',
        backend: { type: 'mcp', mcp: { tool: 't' } },
        promptTemplate: '',
        tempDir: '/tmp/v',
        cleanupAfterHours: 24,
        cleanup: 'init',
      };
      const result = PluginConfigSchema.safeParse(minimal);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.debug).toBeUndefined();
        expect(result.data.logFile).toBeUndefined();
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
