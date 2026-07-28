import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { readJSONC, overlayDeep, applyDefaults } from './config.js';
import { PluginConfigSchema } from './types.js';

describe('config', () => {
  describe('readJSONC', () => {
    it('should strip JSONC comments and parse valid JSON', () => {
      const content = `{
        // This is a comment
        "tempDir": "/test",
        /* block comment */
        "models": ["a"]
      }`;
      const tmp = path.join(os.tmpdir(), `vision-test-${Date.now()}.jsonc`);
      fs.writeFileSync(tmp, content, 'utf-8');
      const result = readJSONC(tmp);
      expect(result).toEqual({ tempDir: '/test', models: ['a'] });
    });

    it('should return null on missing file', () => {
      const result = readJSONC('/nonexistent/path/file.jsonc');
      expect(result).toBeNull();
    });
  });

  describe('overlayDeep', () => {
    it('S1: inline options take precedence over project file values', () => {
      const layers = [
        { tempDir: '/inline/path', models: [] },
        { tempDir: '/project/path', models: ['p/model'] },
        {},
        {},
      ];
      const merged = overlayDeep(layers);
      expect(merged.tempDir).toBe('/inline/path');
      expect(merged.models).toEqual([]);
    });

    it('S2: project file values take precedence over user file values', () => {
      const layers = [
        {},
        { tempDir: '/project/path' },
        { tempDir: '/user/path' },
        {},
      ];
      const merged = overlayDeep(layers);
      expect(merged.tempDir).toBe('/project/path');
    });

    it('S3: user file is used when no inline or project config exists', () => {
      const layers = [
        {},
        null as any,
        { tempDir: '/user/path' },
        {},
      ];
      const merged = overlayDeep(layers);
      expect(merged.tempDir).toBe('/user/path');
    });

    it('field-by-field: nested backend fields are overlaid recursively', () => {
      const layers = [
        { backend: { cli: { timeoutMs: 60000 } } },
        { backend: { mcp: { tool: 'analyze' }, cli: { command: 'mmx' } } },
        {},
        {},
      ];
      const merged = overlayDeep(layers);
      // Inline cli.timeoutMs wins
      expect((merged as any).backend?.cli?.timeoutMs).toBe(60000);
      // Project mcp is preserved since inline has no mcp
      expect((merged as any).backend?.mcp?.tool).toBe('analyze');
      expect((merged as any).backend?.cli?.command).toBe('mmx');
    });

    it('first-defined-wins: later layers do not override earlier defined values', () => {
      const layers = [
        { tempDir: '/first', models: ['a'] },
        { tempDir: '/second', models: ['b'] },
        {},
        {},
      ];
      const merged = overlayDeep(layers);
      expect(merged.tempDir).toBe('/first');
      expect(merged.models).toEqual(['a']);
    });
  });

  describe('applyDefaults', () => {
    it('S6: defaults are applied when no config sources provide a value', () => {
      const empty = {};
      const withDefaults = applyDefaults(empty);
      expect(withDefaults.detection).toBe('hybrid');
      expect(withDefaults.backend.type).toBe('mcp');
      expect(withDefaults.cleanup).toBe('init');
      expect(withDefaults.cleanupAfterHours).toBe(24);
    });

    it('inline values override defaults', () => {
      const partial = { tempDir: '/custom' };
      const withDefaults = applyDefaults(partial);
      expect(withDefaults.tempDir).toBe('/custom');
      expect(withDefaults.detection).toBe('hybrid'); // default
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});
