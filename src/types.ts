import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Detection mode
// ─────────────────────────────────────────────────────────────────────────────
export const DetectionModeSchema = z.enum(['auto', 'patterns', 'hybrid']);
export type DetectionMode = z.infer<typeof DetectionModeSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Backend types — "tool" is NOT supported in v1 (rejected at Zod parse)
// ─────────────────────────────────────────────────────────────────────────────
export const BackendTypeSchema = z.enum(['mcp', 'cli']);
export type BackendType = z.infer<typeof BackendTypeSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Cleanup mode
// ─────────────────────────────────────────────────────────────────────────────
export const CleanupModeSchema = z.enum(['init', 'never']);
export type CleanupMode = z.infer<typeof CleanupModeSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// MCP backend config
// ─────────────────────────────────────────────────────────────────────────────
export const McpBackendConfigSchema = z.object({
  tool: z.string().min(1).optional(),
  prompt: z.string().optional(),
  format: z.enum(['text', 'json']).optional(),
  maxTokens: z.number().int().positive().optional(),
});
export type McpBackendConfig = z.infer<typeof McpBackendConfigSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// CLI backend config (amendment: timeoutMs default 30000)
// ─────────────────────────────────────────────────────────────────────────────
export const CliBackendConfigSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  promptFlag: z.string().optional(),
  jsonFlag: z.string().optional(),
  env: z.record(z.string()).optional(),
  timeoutMs: z.number().int().positive().default(30000),
});
export type CliBackendConfig = z.infer<typeof CliBackendConfigSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Backend config union
// ─────────────────────────────────────────────────────────────────────────────
export const BackendConfigSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('mcp'), mcp: McpBackendConfigSchema }),
  z.object({ type: z.literal('cli'), cli: CliBackendConfigSchema }),
]).refine(
  (data) => data.type !== 'tool',
  { message: 'backend.type "tool" is not supported in v1. Use "mcp" or "cli".' },
);
export type BackendConfig = z.infer<typeof BackendConfigSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// PluginConfig — full schema (amendment: denylist added)
// ─────────────────────────────────────────────────────────────────────────────
export const PluginConfigSchema = z.object({
  models: z.array(z.string()).default([]),
  denylist: z.array(z.string()).default([]),
  detection: DetectionModeSchema.default('hybrid'),
  backend: BackendConfigSchema.default({ type: 'mcp', mcp: { tool: 'default' } }),
  promptTemplate: z.string().default(''),
  tempDir: z.string().default(() => `${process.env.TMPDIR || '/tmp'}/opencode-vision`),
  cleanupAfterHours: z.number().int().nonnegative().default(24),
  cleanup: CleanupModeSchema.default('init'),
});
export type PluginConfig = z.infer<typeof PluginConfigSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// SavedImage — produced by images.materialize()
// ─────────────────────────────────────────────────────────────────────────────
export interface SavedImage {
  partId: string;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  ref: string; // path (base64/file) or url (https) handed to backend
  origin: { kind: 'base64'; path: string } | { kind: 'file'; path: string } | { kind: 'url'; url: string };
}

// ─────────────────────────────────────────────────────────────────────────────
// VisionResult — returned by VisionBackend.analyze()
// ─────────────────────────────────────────────────────────────────────────────
export type VisionResult =
  | { mode: 'inject-instructions'; text: string }
  | { mode: 'inject-description'; text: string };

// ─────────────────────────────────────────────────────────────────────────────
// VisionBackend — interface implemented by McpBackend / CliBackend
// ─────────────────────────────────────────────────────────────────────────────
export interface VisionBackend {
  readonly type: BackendType;
  analyze(ctx: { images: SavedImage[]; userText: string; prompt: string }): Promise<VisionResult>;
}
