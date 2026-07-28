import initSqlJs, { Database as SqlJsDb } from 'sql.js';
import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../logger.js';

const log = createLogger('db');

const DB_PATH = path.join(process.cwd(), '.cc-gui.db');

let db: SqlJsDb | null = null;

// ── Init ──

export async function initDb(): Promise<void> {
  const SQL = await initSqlJs();

  // Load existing DB or create new
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
    log.info('loaded existing database', { path: DB_PATH });
  } else {
    db = new SQL.Database();
    log.info('created new database', { path: DB_PATH });
  }

  // Run schema
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS session_metrics (
      session_id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      tab_id TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS tab_state (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  save();
  log.info('schema initialized');
}

function save(): void {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

function ensureDb(): SqlJsDb {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

// ── Settings ──

export function getSettings(): Record<string, string> {
  const d = ensureDb();
  const rows = d.exec('SELECT key, value FROM settings');
  const settings: Record<string, string> = {};
  if (rows.length > 0) {
    for (const row of rows[0].values) {
      settings[row[0] as string] = row[1] as string;
    }
  }
  return settings;
}

export function saveSettings(settings: Record<string, string>): void {
  const d = ensureDb();
  const stmt = d.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(settings)) {
    stmt.run([key, value]);
  }
  stmt.free();
  save();
}

// ── Session Metrics ──

export function getSessionMetrics(sessionId: string): object | null {
  const d = ensureDb();
  const rows = d.exec('SELECT data FROM session_metrics WHERE session_id = ?', [sessionId]);
  if (rows.length > 0 && rows[0].values.length > 0) {
    return JSON.parse(rows[0].values[0][0] as string);
  }
  return null;
}

export function getAllSessionMetrics(): Array<{ sessionId: string; data: object; updatedAt: string }> {
  const d = ensureDb();
  const rows = d.exec('SELECT session_id, data, updated_at FROM session_metrics ORDER BY updated_at DESC');
  if (rows.length === 0) return [];
  return rows[0].values.map((row: any[]) => ({
    sessionId: row[0] as string,
    data: JSON.parse(row[1] as string),
    updatedAt: row[2] as string,
  }));
}

export function saveSessionMetrics(sessionId: string, data: object): void {
  const d = ensureDb();
  d.run(
    'INSERT OR REPLACE INTO session_metrics (session_id, data, updated_at) VALUES (?, ?, ?)',
    [sessionId, JSON.stringify(data), new Date().toISOString()]
  );
  save();
}

export function deleteSessionMetrics(sessionId: string): void {
  const d = ensureDb();
  d.run('DELETE FROM session_metrics WHERE session_id = ?', [sessionId]);
  save();
}

// ── Tab State (full zustand state persistence) ──
// Works with raw JSON strings for zero-cost passthrough to zustand persist

export function getTabStateRaw(): string | null {
  const d = ensureDb();
  const rows = d.exec('SELECT data FROM tab_state WHERE id = ?', ['main']);
  if (rows.length > 0 && rows[0].values.length > 0) {
    return rows[0].values[0][0] as string;
  }
  return null;
}

export function saveTabStateRaw(json: string): void {
  const d = ensureDb();
  d.run(
    'INSERT OR REPLACE INTO tab_state (id, data, updated_at) VALUES (?, ?, ?)',
    ['main', json, new Date().toISOString()]
  );
  save();
}
