import { describe, it, expect } from 'vitest';
import type { VisionBackend, VisionResult } from './types.js';

describe('backend/types', () => {
  describe('VisionBackend interface', () => {
    it('VisionBackend.analyze returns Promise<VisionResult>', () => {
      // Test the interface contract: analyze returns Promise with VisionResult
      const mockBackend: VisionBackend = {
        type: 'mcp',
        analyze: async () => ({ mode: 'inject-instructions', text: 'test' }),
      };
      const result = mockBackend.analyze({ images: [], userText: 'test', prompt: 'test' });
      expect(result).toBeInstanceOf(Promise);
    });

    it('VisionResult mode is inject-instructions or inject-description', async () => {
      const mcpResult: VisionResult = { mode: 'inject-instructions', text: 'call tool X with path' };
      const cliResult: VisionResult = { mode: 'inject-description', text: 'A cat in a tree' };
      expect(mcpResult.mode).toBe('inject-instructions');
      expect(cliResult.mode).toBe('inject-description');
    });
  });
});
