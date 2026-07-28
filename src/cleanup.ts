import { readdirSync, statSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import type { PluginConfig } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// initCleanup — run TTL sweep on tempDir at plugin initialization
// Deletes files where mtime < now - cleanupAfterHours*3600*1000
// when cleanup === "init". cleanup === "never" is a no-op.
// ─────────────────────────────────────────────────────────────────────────────
export function initCleanup(config: Pick<PluginConfig, 'tempDir' | 'cleanupAfterHours' | 'cleanup'>): void {
  if (config.cleanup === 'never') return;

  const { tempDir, cleanupAfterHours } = config;
  const cutoffMs = cleanupAfterHours * 3600 * 1000;
  const now = Date.now();

  try {
    if (!existsSync(tempDir)) return;
  } catch {
    return;
  }

  let files: string[] = [];
  try {
    files = readdirSync(tempDir);
  } catch {
    return;
  }

  for (const file of files) {
    if (!file.startsWith('vision-')) continue;
    const filePath = join(tempDir, file);
    try {
      const stat = statSync(filePath);
      const ageMs = now - stat.mtimeMs;
      if (ageMs > cutoffMs) {
        unlinkSync(filePath);
      }
    } catch {
      // Skip files we can't stat/delete
    }
  }
}
