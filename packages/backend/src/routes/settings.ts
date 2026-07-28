import express from 'express';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getSettings, saveSettings } from '../data/db.js';

function deepMerge(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
  const result = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (value === null) {
      // null = delete key (even nested)
      delete result[key];
    } else if (typeof value === 'object' && !Array.isArray(value) && typeof result[key] === 'object' && !Array.isArray(result[key])) {
      // Deep merge objects
      result[key] = deepMerge(result[key], value);
    } else {
      // Overwrite scalars and arrays
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
    } catch (err: any) {
      res.status(500).json({ error: err.message });
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
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/claude-settings', express.json(), (req, res) => {
    try {
      let current: Record<string, any> = {};
      if (existsSync(CLAUDE_SETTINGS_PATH)) {
        const raw = readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8');
        current = JSON.parse(raw);
      }
      // Deep merge: new values override current, null values delete keys
      const next = deepMerge(current, req.body);
      writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(next, null, 2) + '\n');
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
