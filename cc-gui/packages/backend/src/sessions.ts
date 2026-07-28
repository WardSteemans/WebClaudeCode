import { readdirSync, readFileSync, existsSync, openSync, readSync, closeSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createLogger } from './logger.js';

const log = createLogger('sessions');

function projectDir(workDir: string): string {
  const encoded = workDir
    .replace(/^([A-Z]):[\/\\]/, '$1--')
    .replace(/[\/\\_]/g, '-');
  return join(homedir(), '.claude', 'projects', encoded);
}

/** Read N bytes from file at given offset */
function readHead(filePath: string, bytes: number, offset = 0): string {
  const buf = Buffer.alloc(bytes);
  let fd: number | undefined;
  try {
    fd = openSync(filePath, 'r');
    const read = readSync(fd, buf, 0, bytes, offset);
    return buf.toString('utf-8', 0, read);
  } catch {
    return '';
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export interface SessionMeta {
  sessionId: string;
  title: string;
  timestamp: string;
  messageCount: number;
  file: string;
  workDir?: string;
}

export function listSessions(workDir: string): SessionMeta[] {
  const dir = projectDir(workDir);
  log.begin('listSessions', { workDir });
  if (!existsSync(dir)) {
    log.end('listSessions', { count: 0, reason: 'dir not found' });
    return [];
  }

  const sessions: SessionMeta[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.jsonl')) continue;
    const sessionId = file.replace('.jsonl', '');
    try {
      const content = readHead(join(dir, file), 65536);
      if (!content) continue;
      const lines = content.split('\n').filter((l: string) => l.trim());
      if (lines.length > 0 && !content.endsWith('\n')) lines.pop();

      let title = 'Untitled';
      let timestamp = '';
      let msgCount = 0;
      let sessionWorkDir: string | undefined;
      for (const line of lines) {
        try {
          const evt = JSON.parse(line);
          if (title === 'Untitled' && evt.type === 'user' && evt.message?.role === 'user') {
            try {
              const raw = evt.message?.content;
              if (typeof raw === 'string') {
                try { title = JSON.parse(raw).messages?.[0]?.content || raw.slice(0, 80); } catch { title = raw.slice(0, 80); }
              } else if (Array.isArray(raw)) {
                title = raw.filter((b: any) => b.type === 'text' && b.text).map((b: any) => b.text).join(' ').slice(0, 80);
              } else if (raw?.[0]?.text) {
                title = raw[0].text.slice(0, 80);
              }
            } catch { /* keep Untitled */ }
          }
          if ((evt.type === 'user' && evt.message?.role === 'user') || (evt.type === 'assistant' && evt.message?.role === 'assistant')) msgCount++;
          if (!timestamp && evt.timestamp) timestamp = evt.timestamp;
          if (!sessionWorkDir && evt.type === 'system' && evt.subtype === 'init' && evt.add_dir) {
            sessionWorkDir = evt.add_dir as string;
          }
        } catch { /* skip malformed lines */ }
      }
      sessions.push({ sessionId, title, timestamp, messageCount: msgCount, file, workDir: sessionWorkDir });
    } catch { /* skip unreadable */ }
  }

  const result = sessions.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  log.end('listSessions', { count: result.length, dir });
  return result;
}

export function readSession(workDir: string, sessionId: string): string | null {
  const file = join(projectDir(workDir), `${sessionId}.jsonl`);
  if (!existsSync(file)) {
    log.warn('session file not found', { sessionId: sessionId.slice(0, 8), file });
    return null;
  }
  const content = readFileSync(file, 'utf-8');
  log.debug('read session', { sessionId: sessionId.slice(0, 8), bytes: content.length });
  return content;
}
