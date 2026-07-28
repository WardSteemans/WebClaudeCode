import { readdirSync, readFileSync, existsSync, openSync, readSync, closeSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createLogger } from '../logger.js';
import { normalizeBlocks, blocksToText } from '../services/contentNormalizer.js';
import type { RawClaudeEvent } from '../services/eventParser/eventTypes.js';

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
      const lines = content.split('\n').filter(l => l.trim());
      if (lines.length > 0 && !content.endsWith('\n')) lines.pop();

      let title = 'Untitled';
      let timestamp = '';
      let msgCount = 0;
      let sessionWorkDir: string | undefined;
      for (const line of lines) {
        try {
          const evt = JSON.parse(line) as RawClaudeEvent;
          // Extract title from first user message
          if (title === 'Untitled' && evt.type === 'user' && evt.message?.role === 'user') {
            try {
              const blocks = normalizeBlocks(evt.message);
              title = blocksToText(blocks).slice(0, 80) || 'Untitled';
            } catch { /* keep Untitled */ }
          }
          // Count user/assistant messages (type is sufficient discriminator)
          if (evt.type === 'user' || evt.type === 'assistant') msgCount++;
          if (!timestamp && 'timestamp' in evt) timestamp = (evt as unknown as Record<string, unknown>).timestamp as string;
          // Extract workDir from system init event
          if (!sessionWorkDir && evt.type === 'system' && evt.subtype === 'init') {
            const sysEvt = evt as unknown as Record<string, unknown>;
            if (sysEvt.cwd) sessionWorkDir = sysEvt.cwd as string;
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
