import { appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// Module-level singleton logger.
// - configureLogging() installs a sink that appends "[<iso>] <msg>\n" to a file.
// - debug() dispatches to the installed sink or is a no-op.
// - resetLogger() clears the sink (for tests and re-init).
// debug() NEVER throws — write errors are swallowed.
// ─────────────────────────────────────────────────────────────────────────────

type Sink = (msg: string) => void;

const NOOP_SINK: Sink = () => {};

let sink: Sink = NOOP_SINK;

function fileSink(logFile: string): Sink {
  return (msg: string) => {
    try {
      mkdirSync(dirname(logFile), { recursive: true });
      const line = `[${new Date().toISOString()}] ${msg}\n`;
      appendFileSync(logFile, line);
    } catch {
      // Never throw from debug — logging is best-effort.
    }
  };
}

export function configureLogging(opts: { enabled: boolean; logFile: string }): void {
  if (opts.enabled) {
    sink = fileSink(opts.logFile);
  } else {
    sink = NOOP_SINK;
  }
}

export function debug(msg: string): void {
  try {
    sink(msg);
  } catch {
    // Defensive: never propagate.
  }
}

export function resetLogger(): void {
  sink = NOOP_SINK;
}
