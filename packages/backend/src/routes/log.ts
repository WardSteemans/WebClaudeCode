import express from 'express';
import { createLogger, appendToDedicatedLog } from '../logger.js';
import type { LogLevel } from '@cc-gui/shared';

export function registerLogRoutes(app: express.Express): void {
  app.post('/api/log', express.json(), (req, res) => {
    try {
      const { level, module, message, data, error, step, stepPhase } = req.body as {
        level?: string;
        module?: string;
        message?: string;
        data?: Record<string, unknown>;
        error?: string;
        step?: string;
        stepPhase?: string;
      };

      if (!message) return res.status(400).json({ error: 'message required' });

      const validLevels: LogLevel[] = ['ERROR', 'WARN', 'DEBUG'];
      const logLevel: LogLevel = validLevels.includes(level as LogLevel) ? (level as LogLevel) : 'INFO';

      const frontendLog = createLogger(`fe:${module || 'unknown'}`);
      switch (logLevel) {
        case 'ERROR':
          frontendLog.error(message, error, { ...data, step, stepPhase });
          break;
        case 'WARN':
          frontendLog.warn(message, { ...data, step, stepPhase });
          break;
        case 'DEBUG':
          frontendLog.debug(message, { ...data, step, stepPhase });
          break;
        default:
          frontendLog.info(message, { ...data, step, stepPhase });
      }

      // Forward title-generation logs to dedicated log
      if (module === 'useChatStream' && typeof message === 'string' && message.startsWith('generateChatTitle')) {
        appendToDedicatedLog('title/title-gen', `fe:${module}`, logLevel, message, { ...data, step, stepPhase });
      }

      // Forward stream diagnostic logs to dedicated log
      if (module === 'useChatStream' && typeof message === 'string' &&
          (message.startsWith('finalizeStream') || message.startsWith('stream timer fired'))) {
        appendToDedicatedLog('diagnostics/cut-debug', `fe:${module}`, logLevel, message, { ...data, step, stepPhase });
      }

      res.json({ ok: true });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });
}
