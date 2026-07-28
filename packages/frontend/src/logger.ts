// ── Frontend logger — sends to backend /api/log endpoint ──
// All sends are fire-and-forget (no await) to avoid blocking the UI.

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

interface LogPayload {
  level: LogLevel;
  module: string;
  message: string;
  data?: Record<string, unknown>;
  error?: string;
}

function sendLog(payload: LogPayload): void {
  const body = JSON.stringify(payload);
  // Fire-and-forget: no await, no .then()
  fetch('/api/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    // keepalive ensures the request completes even if the page is navigating away
    keepalive: true,
  }).catch((err) => {
    // Silently ignore — we don't want logging failures to cause noise
    // but log to console in dev for debugging
    if (import.meta.env.DEV) console.warn('Logger failed to send', err);
  });
}

export interface FrontendLogger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, error?: Error | string, data?: Record<string, unknown>): void;
}

export function createFrontendLogger(module: string): FrontendLogger {
  return {
    debug(message, data) {
      sendLog({ level: 'DEBUG', module, message, data });
    },
    info(message, data) {
      sendLog({ level: 'INFO', module, message, data });
    },
    warn(message, data) {
      sendLog({ level: 'WARN', module, message, data });
    },
    error(message, error, data) {
      const errStr = error instanceof Error ? error.message : (typeof error === 'string' ? error : undefined);
      sendLog({ level: 'ERROR', module, message, data, error: errStr });
    },
  };
}

// Default singleton
export const feLog = createFrontendLogger('app');
