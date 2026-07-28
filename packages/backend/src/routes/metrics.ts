import express from 'express';
import { getSessionMetrics, getAllSessionMetrics, saveSessionMetrics, deleteSessionMetrics } from '../data/db.js';

export function registerMetricsRoutes(app: express.Express): void {
  app.get('/api/metrics', (_req, res) => {
    res.json(getAllSessionMetrics());
  });

  app.get('/api/metrics/:sessionId', (req, res) => {
    const metrics = getSessionMetrics(req.params.sessionId);
    if (!metrics) return res.status(404).json({ error: 'Not found' });
    res.json(metrics);
  });

  app.post('/api/metrics', express.json(), (req, res) => {
    try {
      const { sessionId, data } = req.body;
      if (!sessionId || !data) return res.status(400).json({ error: 'Missing sessionId or data' });
      saveSessionMetrics(sessionId, data);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/metrics/:sessionId', (req, res) => {
    deleteSessionMetrics(req.params.sessionId);
    res.json({ ok: true });
  });
}
