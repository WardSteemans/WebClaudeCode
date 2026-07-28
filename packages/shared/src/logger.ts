// ── Shared Logger interface ──

import type { LogLevel } from './types';

/** Base logger interface — implemented by both backend and frontend loggers */
export interface BaseLogger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, error?: Error | string, data?: Record<string, unknown>): void;
}

/** Legacy alias for backwards compatibility */
export type { LogLevel };
