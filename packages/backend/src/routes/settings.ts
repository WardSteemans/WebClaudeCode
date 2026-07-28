import express from 'express';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getSettings, saveSettings } from '../data/db.js';

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (value === null) {
      delete result[key];
    } else if (typeof value === 'object' && !Array.isArray(value) && typeof result[key] === 'object' && !Array.isArray(result[key])) {
      result[key] = deepMerge(result[key] as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

const CLAUDE_SETTINGS_PATH = join(process.env.USERPROFILE || '~', '.claude', 'settings.json');

export function registerSettingsRoutes(app: express.Express): void {
  // Settings
  app.get('/api/settings', (_req, res) => {
    res.json(getSettings());
  });

  app.put('/api/settings', express.json(), (req, res) => {
    try {
      saveSettings(req.body);
      res.json({ ok: true });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ----- Claude Code settings -----

  app.get('/api/claude-settings', (_req, res) => {
    try {
      if (!existsSync(CLAUDE_SETTINGS_PATH)) {
        return res.json({});
      }
      const raw = readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      res.json(parsed);
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.put('/api/claude-settings', express.json(), (req, res) => {
    try {
      let current: Record<string, unknown> = {};
      if (existsSync(CLAUDE_SETTINGS_PATH)) {
        const raw = readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8');
        current = JSON.parse(raw);
      }
      // Deep merge: new values override current, null values delete keys
      const next = deepMerge(current, req.body);
      writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(next, null, 2) + '\n');
      res.json({ ok: true });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });
}
