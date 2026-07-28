import express from 'express';
import { getTabStateRaw, saveTabStateRaw } from '../data/db.js';

export function registerTabStateRoutes(app: express.Express): void {
  app.get('/api/tab-state', (_req, res) => {
    try {
      const raw = getTabStateRaw();
      if (raw) {
        res.type('application/json').send(raw);
      } else {
        res.json({ tabs: [], activeTabId: null });
      }
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  app.put('/api/tab-state', (req, res) => {
    try {
      // req.body is already parsed by express.json() — stringify for DB storage
      saveTabStateRaw(JSON.stringify(req.body));
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });
}
