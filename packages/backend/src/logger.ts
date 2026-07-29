import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { LogLevel, BaseLogger } from '@cc-gui/shared';

// Re-export for external consumers
export type { LogLevel };

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  data?: Record<string, unknown>;
  durationMs?: number;
  error?: string;
  step?: string;        // step name for begin/end pairs
  stepPhase?: 'begin' | 'end' | 'error';
}

// ── Resolve workspace root ──
// Walks up from this file's location until it finds package.json with "workspaces".
// Falls back to 3 levels up (standard monorepo layout: packages/backend/src → root).

function findWorkspaceRoot(): string {
  const __filename = fileURLToPath(import.meta.url);
  let dir = path.dirname(__filename);
  for (let i = 0; i < 10; i++) {
    const pkgPath = path.join(dir, 'package.json');
    try {
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.workspaces) return dir;
      }
    } catch { /* keep walking */ }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback for unusual layouts
  return path.resolve(path.dirname(__filename), '..', '..', '..');
}

// ── State ──

const WORKSPACE_ROOT = findWorkspaceRoot();
const LOG_DIR = path.join(WORKSPACE_ROOT, 'logging');
let currentDate = '';
let writeStream: fs.WriteStream | null = null;
let buffer: string[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
const FLUSH_INTERVAL_MS = 1000;
const MAX_BUFFER_SIZE = 50;

// ── Init ──

function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function getLogFileName(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return path.join(LOG_DIR, `cc-gui-${y}-${m}-${d}.log`);
}

function rotateIfNeeded(): void {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  if (today !== currentDate) {
    flushBuffer();
    if (writeStream) {
      writeStream.end();
      writeStream = null;
    }
    currentDate = today;
    ensureLogDir();
    writeStream = fs.createWriteStream(getLogFileName(), { flags: 'a' });
  }
}

function ensureStream(): fs.WriteStream {
  if (!writeStream) {
    ensureLogDir();
    currentDate = new Date().toISOString().slice(0, 10);
    writeStream = fs.createWriteStream(getLogFileName(), { flags: 'a' });
  }
  return writeStream;
}

function startFlushTimer(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    rotateIfNeeded();
    flushBuffer();
  }, FLUSH_INTERVAL_MS);
  // Allow process to exit even with active timer
  flushTimer.unref();
}

function flushBuffer(): void {
  if (buffer.length === 0) return;
  const lines = buffer.splice(0);
  try {
    ensureStream().write(lines.join(''));
  } catch {
    // If write fails, push back to buffer for retry (up to a limit)
    if (buffer.length < MAX_BUFFER_SIZE * 2) {
      buffer.unshift(...lines);
    }
  }
}

function formatTimestamp(): string {
  const now = new Date();
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  return `${y}-${mo}-${d} ${h}:${mi}:${s}.${ms}`;
}

function formatEntry(entry: LogEntry): string {
  // Format: [TIMESTAMP] [LEVEL] [module] message {"key":"value"}
  let line = `[${entry.timestamp}] [${entry.level}] [${entry.module}] ${entry.message}`;

  if (entry.step) {
    line += ` [step:${entry.step} phase:${entry.stepPhase}]`;
  }
  if (entry.durationMs !== undefined) {
    line += ` duration=${entry.durationMs}ms`;
  }
  if (entry.error) {
    line += ` error="${entry.error.replace(/"/g, '\\"')}"`;
  }
  if (entry.data && Object.keys(entry.data).length > 0) {
    // Flatten simple data to avoid massive JSON blocks
    const flat: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(entry.data)) {
      if (v === undefined) continue;
      if (typeof v === 'string' && v.length > 500) {
        flat[k] = v.slice(0, 500) + `...(${v.length} chars)`;
      } else if (typeof v === 'object' && v !== null) {
        flat[k] = JSON.stringify(v).slice(0, 500);
      } else {
        flat[k] = v;
      }
    }
    line += ' ' + JSON.stringify(flat);
  }

  return line + '\n';
}

function writeEntry(entry: LogEntry): void {
  const line = formatEntry(entry);
  buffer.push(line);

  // Flush immediately on ERROR
  if (entry.level === 'ERROR') {
    flushBuffer();
  }

  // Flush if buffer gets large
  if (buffer.length >= MAX_BUFFER_SIZE) {
    flushBuffer();
  }
}

// ── Dedicated log files ──
// Writes a copy of an entry to logs/<name>-YYYY-MM-DD.log.
// Uses appendFileSync for simplicity (dedicated logs are low-volume).

function writeDedicatedEntry(name: string, entry: LogEntry): void {
  try {
    ensureLogDir();
    const now = new Date();
    const y = now.getFullYear();
    const mo = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const fileName = path.join(LOG_DIR, `${name}-${y}-${mo}-${d}.log`);

    // Use same format as main log for consistency
    const line = formatEntry(entry);
    fs.appendFileSync(fileName, line, 'utf-8');
  } catch {
    // Never let dedicated log failures affect the application
  }
}

// Also export so external code (e.g. log.ts route) can write to dedicated logs
function appendToDedicatedLog(name: string, module: string, level: LogLevel, message: string, data?: Record<string, unknown>, error?: string): void {
  writeDedicatedEntry(name, {
    timestamp: formatTimestamp(),
    level,
    module,
    message,
    data,
    error,
  });
}

// ── Logger interface ──

export interface Logger extends BaseLogger {
  /** Log the start of a step. Returns the step name for matching end() call. */
  begin(step: string, data?: Record<string, unknown>): string;
  /** Log the successful end of a step. */
  end(step: string, data?: Record<string, unknown>): void;
  /** Log a step that failed. */
  fail(step: string, error: Error | string, data?: Record<string, unknown>): void;

  /** Create a performance marker. Call .end() on the returned object to log duration. */
  mark(name: string, data?: Record<string, unknown>): PerfMark;
}

export interface PerfMark {
  name: string;
  /** End the mark and log duration. */
  end(data?: Record<string, unknown>): void;
}

// ── Logger implementation ──

const activeMarks = new Map<string, number>();

function createLogger(module: string, dedicatedLog?: string): Logger {
  // Ensure stream and flush timer are started on first logger creation
  ensureStream();
  startFlushTimer();

  const log = (level: LogLevel, message: string, data?: Record<string, unknown>, error?: string, step?: string, stepPhase?: 'begin' | 'end' | 'error', durationMs?: number) => {
    rotateIfNeeded();
    const entry: LogEntry = {
      timestamp: formatTimestamp(),
      level,
      module,
      message,
      data,
      error,
      step,
      stepPhase,
      durationMs,
    };
    writeEntry(entry);

    // Also write to dedicated log file if requested
    if (dedicatedLog) {
      writeDedicatedEntry(dedicatedLog, entry);
    }
  };

  return {
    debug(message, data) {
      log('DEBUG', message, data);
    },

    info(message, data) {
      log('INFO', message, data);
    },

    warn(message, data) {
      log('WARN', message, data);
    },

    error(message, error, data) {
      const errStr = error instanceof Error ? error.message : (typeof error === 'string' ? error : undefined);
      log('ERROR', message, data, errStr);
    },

    begin(step, data) {
      const markKey = `${module}:${step}`;
      activeMarks.set(markKey, Date.now());
      log('DEBUG', `${step} — begin`, data, undefined, step, 'begin');
      return step;
    },

    end(step, data) {
      const markKey = `${module}:${step}`;
      const startTime = activeMarks.get(markKey);
      const durationMs = startTime ? Date.now() - startTime : undefined;
      activeMarks.delete(markKey);
      log('DEBUG', `${step} — done`, data, undefined, step, 'end', durationMs);
    },

    fail(step, error, data) {
      const markKey = `${module}:${step}`;
      const startTime = activeMarks.get(markKey);
      const durationMs = startTime ? Date.now() - startTime : undefined;
      activeMarks.delete(markKey);
      const errStr = error instanceof Error ? error.message : String(error);
      log('ERROR', `${step} — failed`, data, errStr, step, 'error', durationMs);
    },

    mark(name, data) {
      const markKey = `${module}:${name}`;
      const startTime = Date.now();
      activeMarks.set(markKey, startTime);

      return {
        name,
        end(endData) {
          const durationMs = Date.now() - startTime;
          activeMarks.delete(markKey);
          log('DEBUG', `${name} completed`, { ...data, ...endData }, undefined, name, 'end', durationMs);
        },
      };
    },
  };
}

// ── Global log access for non-module code ──

const defaultLogger = createLogger('app');

export const log = defaultLogger;

// Re-export factory
export { createLogger, appendToDedicatedLog, LOG_DIR };

// ── Shutdown ──

let shutdownHandlers: Array<() => void> = [];

export function onShutdown(fn: () => void): void {
  shutdownHandlers.push(fn);
}

function gracefulShutdown(signal: string) {
  console.log(`\n[logger] ${signal} received — flushing logs`);
  flushBuffer();
  if (writeStream) {
    writeStream.end();
    writeStream = null;
  }
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  for (const fn of shutdownHandlers) fn();
  process.exit(0);
}

// Catch termination signals to flush logs
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Also flush on uncaught exceptions
process.on('uncaughtException', (err) => {
  const entry: LogEntry = {
    timestamp: formatTimestamp(),
    level: 'ERROR',
    module: 'process',
    message: 'Uncaught exception — process will exit',
    error: err.message,
    data: { stack: err.stack?.slice(0, 1000) },
  };
  writeEntry(entry);
  flushBuffer();
  if (writeStream) writeStream.end();
  console.error('[logger] uncaught exception, logs flushed:', err.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown) => {
  const entry: LogEntry = {
    timestamp: formatTimestamp(),
    level: 'ERROR',
    module: 'process',
    message: 'Unhandled promise rejection',
    error: reason instanceof Error ? reason.message : String(reason),
    data: { stack: reason instanceof Error ? reason.stack?.slice(0, 1000) : undefined },
  };
  writeEntry(entry);
  flushBuffer();
  console.error('[logger] unhandled rejection, logs flushed:', reason instanceof Error ? reason.message : reason);
});
