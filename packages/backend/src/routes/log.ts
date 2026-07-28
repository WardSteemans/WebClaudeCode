import express from 'express';
import { createLogger } from '../logger.js';

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

      const frontendLog = createLogger(`fe:${module || 'unknown'}`);
      switch (level) {
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

      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
