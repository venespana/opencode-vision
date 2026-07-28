import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('backend/cli', () => {
  let CliBackend: new (cfg: any, client?: any) => any;

  beforeEach(async () => {
    vi.resetModules();
    vi.mock('child_process', () => ({
      spawn: vi.fn(),
    }));
    const cli = await import('./cli.js');
    CliBackend = cli.CliBackend;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // S2: CLI exit 0 → inject-description with trimmed stdout
  it('S2: exit 0 returns inject-description with trimmed stdout', async () => {
    const { spawn } = await import('child_process');
    (spawn as any).mockImplementation(() => {
      const mock = {
        stdout: { on: (event: string, cb: (data: string) => void) => { if (event === 'data') cb('A cat in a tree'); } },
        stderr: { on: vi.fn() },
        on: (event: string, cb: (code: number) => void) => { if (event === 'close') cb(0); },
        kill: vi.fn(),
      };
      return mock;
    });

    const backend = new CliBackend({ command: 'mmx', args: ['vision'], promptFlag: '--prompt' });
    const result = await backend.analyze({
      images: [{ partId: 'p1', mime: 'image/png', ref: '/tmp/img.png', origin: { kind: 'file', path: '/tmp/img.png' } }],
      userText: 'test',
      prompt: 'Describe this.',
    });

    expect(result.mode).toBe('inject-description');
    expect(result.text).toBe('A cat in a tree');
  });

  // S3: CLI non-zero exit → fail-soft VisionResult
  it('S3: non-zero exit returns fail-soft error description', async () => {
    const { spawn } = await import('child_process');
    (spawn as any).mockImplementation(() => {
      const mock = {
        stdout: { on: vi.fn() },
        stderr: { on: (event: string, cb: (data: string) => void) => { if (event === 'data') cb('error details'); } },
        on: (event: string, cb: (code: number) => void) => { if (event === 'close') cb(1); },
        kill: vi.fn(),
      };
      return mock;
    });

    const mockLog = vi.fn();
    const backend = new CliBackend(
      { command: 'mmx', args: ['vision'] },
      { app: { log: mockLog } },
    );
    const result = await backend.analyze({
      images: [],
      userText: 'test',
      prompt: 'Describe this.',
    });

    expect(result.mode).toBe('inject-description');
    expect(result.text).toContain('[opencode-vision]');
    expect(result.text).toContain('exit:1');
    expect(mockLog).toHaveBeenCalledWith({ level: 'warn', message: expect.stringContaining('exit:1') });
  });

  // S3b: CLI timeout → fail-soft with timeout reason
  it('S3b: timeout returns fail-soft with timeout reason', async () => {
    const { spawn } = await import('child_process');
    // Mock spawn where process emits 'error' (simulating SIGKILL from timeout)
    (spawn as any).mockImplementation(() => {
      const mock = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, cb: (arg: any) => void) => {
          if (event === 'error') {
            // Simulate process being killed — error with code signal
            cb(Object.assign(new Error('spawn ETIMEDOUT'), { code: 'ETIMEDOUT' }));
          }
          if (event === 'close') cb(1);
        }),
        kill: vi.fn(),
      };
      return mock;
    });

    const mockLog = vi.fn();
    const backend = new CliBackend(
      { command: 'slow', args: [], timeoutMs: 10 },
      { app: { log: mockLog } },
    );

    const result = await backend.analyze({
      images: [],
      userText: 'test',
      prompt: 'Describe.',
    });

    expect(result.mode).toBe('inject-description');
    expect(result.text).toMatch(/\[opencode-vision\]/);
  });

  // S5: env propagation
  it('S5: env variables are propagated to subprocess', async () => {
    const { spawn } = await import('child_process');
    const mockSpawn = (spawn as any).mockImplementation(() => {
      const mock = {
        stdout: { on: (event: string, cb: (data: string) => void) => { if (event === 'data') cb(''); } },
        stderr: { on: vi.fn() },
        on: (event: string, cb: (code: number) => void) => { if (event === 'close') cb(0); },
        kill: vi.fn(),
      };
      return mock;
    });

    const backend = new CliBackend({ command: 'test', args: [], env: { API_KEY: 'secret' } });
    await backend.analyze({ images: [], userText: '', prompt: '' });

    expect(mockSpawn).toHaveBeenCalledWith(
      'test',
      expect.arrayContaining([]),
      expect.objectContaining({
        env: expect.objectContaining({ API_KEY: 'secret' }),
      }),
    );
  });
});
