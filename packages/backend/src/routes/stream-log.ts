import express from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { createLogger, LOG_DIR } from '../logger.js';

const log = createLogger('stream-log');

// LOG_DIR imported from logger.ts – uses workspace-root/logging/
let currentDate = '';
let writeStream: fs.WriteStream | null = null;

// ── Helpers (mirrors logger.ts pattern but keeps a separate file) ──

function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function getStreamLogFileName(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return path.join(LOG_DIR, `cc-gui-stream-${y}-${m}-${d}.log`);
}

function rotateIfNeeded(): void {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== currentDate) {
    if (writeStream) {
      writeStream.end();
      writeStream = null;
    }
    currentDate = today;
    ensureLogDir();
    writeStream = fs.createWriteStream(getStreamLogFileName(), { flags: 'a' });
  }
}

function ensureStream(): fs.WriteStream {
  if (!writeStream) {
    ensureLogDir();
    currentDate = new Date().toISOString().slice(0, 10);
    writeStream = fs.createWriteStream(getStreamLogFileName(), { flags: 'a' });
  }
  return writeStream;
}

// ── Graceful shutdown ──

function shutdownStreamLog(): void {
  if (writeStream) {
    try { writeStream.end(); } catch { /* ignore */ }
    writeStream = null;
  }
}

// Register with the existing logger shutdown hooks
process.on('SIGINT', shutdownStreamLog);
process.on('SIGTERM', shutdownStreamLog);

// ── Route ──

export function registerStreamLogRoutes(app: express.Express): void {
  app.post('/api/stream-log', express.json({ limit: '1mb' }), (req, res) => {
    // Only write when STREAM_DEBUG is enabled
    if (process.env.STREAM_DEBUG !== 'true') {
      return res.json({ ok: true, enabled: false });
    }

    try {
      const entries = req.body;
      if (!Array.isArray(entries) || entries.length === 0) {
        return res.json({ ok: true, written: 0 });
      }

      rotateIfNeeded();

      let written = 0;
      const stream = ensureStream();
      for (const entry of entries) {
        try {
          const line = JSON.stringify(entry);
          stream.write(line + '\n');
          written++;
        } catch {
          // Skip malformed entries
        }
      }

      if (written > 0) {
        log.debug(`wrote ${written} stream timeline entries`, { count: written });
      }

      res.json({ ok: true, written });
    } catch (err: unknown) {
      log.error('stream-log write failed', err instanceof Error ? err : undefined);
      res.status(500).json({ error: (err as Error).message });
    }
  });
}
