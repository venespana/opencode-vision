import type { SavedImage, VisionResult, VisionBackend, BackendType } from '../types.js';

// Re-export for backend consumers
export type { SavedImage, VisionResult };

// ─────────────────────────────────────────────────────────────────────────────
// VisionBackend — abstract base for all vision backends
// ─────────────────────────────────────────────────────────────────────────────
export interface VisionBackendConstructor {
  new (config: unknown): VisionBackend;
}

// SavedImage type is re-exported from ../types for convenience
export { type VisionBackend, type BackendType };
