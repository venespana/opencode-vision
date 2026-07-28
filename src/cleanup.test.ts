import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('cleanup', () => {
  let initCleanup: (config: any) => void;

  beforeEach(async () => {
    vi.resetModules();
    vi.mock('fs', async () => {
      const fs = await import('fs');
      return { ...fs.default ?? fs };
    });
    const cleanup = await import('./cleanup.js');
    initCleanup = cleanup.initCleanup;
  });

  // S5: Init TTL cleanup — deletes files aged > cleanupAfterHours
  it('S5: init cleanup deletes files older than cleanupAfterHours', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vision-cleanup-'));
    const oldFile = path.join(tmpDir, 'vision-old.png');
    const newFile = path.join(tmpDir, 'vision-new.png');

    fs.writeFileSync(oldFile, 'old');
    fs.writeFileSync(newFile, 'new');

    // Make oldFile appear 25 hours old
    const now = Date.now();
    fs.utimesSync(oldFile, now / 1000, (now - 25 * 3600 * 1000) / 1000);

    await initCleanup({
      tempDir: tmpDir,
      cleanupAfterHours: 24,
      cleanup: 'init',
    });

    expect(fs.existsSync(oldFile)).toBe(false);
    expect(fs.existsSync(newFile)).toBe(true);
    fs.rmSync(tmpDir, { recursive: true });
  });

  // S6: Cleanup disabled — cleanup:"never" does nothing
  it('S6: cleanup mode "never" does not delete any files', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vision-cleanup-'));
    const oldFile = path.join(tmpDir, 'vision-old.png');
    fs.writeFileSync(oldFile, 'old');

    // Make it appear old
    const now = Date.now();
    fs.utimesSync(oldFile, now / 1000, (now - 25 * 3600 * 1000) / 1000);

    await initCleanup({
      tempDir: tmpDir,
      cleanupAfterHours: 24,
      cleanup: 'never',
    });

    expect(fs.existsSync(oldFile)).toBe(true);
    fs.rmSync(tmpDir, { recursive: true });
  });
});
