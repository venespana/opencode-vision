import { spawn } from 'child_process';
import type { VisionBackend, SavedImage } from './types.js';
import type { CliBackendConfig } from '../types.js';
import { debug } from '../logger.js';

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
    const { command, args, promptFlag, jsonFlag, imageFlag, env } = this.config;

    const imageRefs = images.map((img) => img.ref);

    // Build argument list: args + optional prompt/json flags + image handling
    const spawnArgs: string[] = [...args];
    if (promptFlag && prompt) {
      spawnArgs.push(promptFlag, prompt);
    }
    if (jsonFlag) {
      spawnArgs.push(jsonFlag);
    }
    // imageFlag set → each image as "<flag> <ref>"; otherwise positional trailing args
    if (imageFlag) {
      for (const ref of imageRefs) {
        spawnArgs.push(imageFlag, ref);
      }
    } else {
      spawnArgs.push(...imageRefs);
    }

    debug(`spawn: ${command} ${spawnArgs.join(' ')}`);

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
          debug(`cli exit=0 stdoutLen=${stdout.length}`);
          resolve({ mode: 'inject-description', text: stdout.trim() });
        } else {
          const reason = code === null ? 'timeout' : `exit:${code}`;
          const detail = stderr.trim() || stdout.trim() || 'no output';
          const errorText = `[opencode-vision] cli ${reason}: ${detail}`;
          debug(`cli error: ${reason} stdoutLen=${stdout.length} stderrLen=${stderr.length}`);
          this.logFn?.({ level: 'warn', message: errorText });
          resolve({ mode: 'inject-description', text: errorText });
        }
      });

      proc.on('error', (err: Error) => {
        debug(`cli error: spawn failure: ${err.message}`);
        const errorText = `[opencode-vision] cli error: ${err.message}`;
        this.logFn?.({ level: 'warn', message: errorText });
        resolve({ mode: 'inject-description', text: errorText });
      });
    });
  }
}
