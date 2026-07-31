import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { configureLogging, debug, resetLogger } from './logger.js';

describe('logger', () => {
  let tmpFile: string;

  beforeEach(() => {
    resetLogger();
    tmpFile = path.join(os.tmpdir(), `vision-logger-test-${Date.now()}-${Math.random().toString(36).slice(2)}.log`);
  });

  afterEach(() => {
    resetLogger();
    try {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    } catch {
      // ignore
    }
  });

  it('configureLogging({enabled:true}) + debug appends a timestamped line', () => {
    configureLogging({ enabled: true, logFile: tmpFile });
    debug('hello');
    const content = fs.readFileSync(tmpFile, 'utf-8');
    expect(content).toMatch(/^\[.*\] hello\n$/);
  });

  it('two debug calls append two lines (append, not overwrite)', () => {
    configureLogging({ enabled: true, logFile: tmpFile });
    debug('first');
    debug('second');
    const content = fs.readFileSync(tmpFile, 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\[.*\] first$/);
    expect(lines[1]).toMatch(/^\[.*\] second$/);
  });

  it('enabled:false → no file created / no writes', () => {
    configureLogging({ enabled: false, logFile: tmpFile });
    debug('nothing');
    expect(fs.existsSync(tmpFile)).toBe(false);
  });

  it('debug before any configureLogging → no throw, no file', () => {
    expect(() => debug('unconfigured')).not.toThrow();
    expect(fs.existsSync(tmpFile)).toBe(false);
  });

  it('resetLogger between cases isolates sinks', () => {
    configureLogging({ enabled: true, logFile: tmpFile });
    debug('before-reset');
    resetLogger();
    debug('after-reset');
    const content = fs.readFileSync(tmpFile, 'utf-8');
    // Only the "before-reset" line should be present
    expect(content).toMatch(/before-reset/);
    expect(content).not.toMatch(/after-reset/);
  });
});
