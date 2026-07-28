import { spawn } from 'child_process';
import type { VisionBackend, SavedImage } from './types.js';
import type { CliBackendConfig } from '../types.js';

export interface LogFn {
  (msg: { level: 'warn'; message: string }): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// CliBackend — inject-description mode
// Spawns a CLI command with image paths, captures stdout as description.
// Bounded by AbortSignal.timeout (default 30s). Fail-soft on timeout/non-zero.
// ─────────────────────────────────────────────────────────────────────────────
export class CliBackend implements VisionBackend {
  public readonly type = 'cli' as const;
  private readonly timeoutMs: number;
  private readonly logFn?: LogFn;

  constructor(
    private readonly config: CliBackendConfig,
    client?: { app: { log: (msg: { level: string; message: string }) => void } },
  ) {
    this.timeoutMs = config.timeoutMs ?? 30000;
    this.logFn = client?.app.log.bind(client.app);
  }

  async analyze(ctx: { images: SavedImage[]; userText: string; prompt: string }): Promise<{ mode: 'inject-description'; text: string }> {
    const { images, prompt } = ctx;
    const { command, args, promptFlag, jsonFlag, env } = this.config;

    const imageRefs = images.map((img) => img.ref);

    // Build argument list: args + image refs + optional prompt/json flags
    const spawnArgs: string[] = [...args];
    if (promptFlag && prompt) {
      spawnArgs.push(promptFlag, prompt);
    }
    if (jsonFlag) {
      spawnArgs.push(jsonFlag);
    }
    spawnArgs.push(...imageRefs);

    return new Promise((resolve) => {
      const timeoutSignal = AbortSignal.timeout(this.timeoutMs);

      const proc = spawn(command, spawnArgs, {
        env: { ...process.env, ...env },
        signal: timeoutSignal,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      proc.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on('close', (code: number | null) => {
        if (code === 0) {
          resolve({ mode: 'inject-description', text: stdout.trim() });
        } else {
          const reason = code === null ? 'timeout' : `exit:${code}`;
          const detail = stderr.trim() || stdout.trim() || 'no output';
          const errorText = `[opencode-vision] cli ${reason}: ${detail}`;
          this.logFn?.({ level: 'warn', message: errorText });
          resolve({ mode: 'inject-description', text: errorText });
        }
      });

      proc.on('error', (err: Error) => {
        const errorText = `[opencode-vision] cli error: ${err.message}`;
        this.logFn?.({ level: 'warn', message: errorText });
        resolve({ mode: 'inject-description', text: errorText });
      });
    });
  }
}
