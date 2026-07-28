import express from 'express';
import * as sessionHistory from '../data/sessions.js';
import { normalizeBlocks, blocksToText, type NormalizedMessage } from '../services/contentNormalizer.js';
import type { RawClaudeEvent } from '../services/eventParser/eventTypes.js';

export function registerSessionsRoutes(app: express.Express): void {
  app.get('/api/sessions/list', (req, res) => {
    const base = (req.query.base as string) || process.cwd();
    try { res.json(sessionHistory.listSessions(base)); } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  app.get('/api/sessions/read', (req, res) => {
    const base = (req.query.base as string) || process.cwd();
    const id = req.query.id as string;
    if (!id) return res.status(400).json({ error: 'id query param required' });
    const content = sessionHistory.readSession(base, id);
    if (content === null) return res.status(404).json({ error: 'Session not found' });

    const messages: NormalizedMessage[] = [];
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const evt = JSON.parse(line) as RawClaudeEvent;
        if (evt.type !== 'user' && evt.type !== 'assistant') continue;
        if (!evt.message) continue;
        const ts = ('timestamp' in evt ? (evt as unknown as Record<string, unknown>).timestamp : null) as string | null;

        if (evt.type === 'user') {
          const blocks = normalizeBlocks(evt.message);
          const text = blocksToText(blocks);
          if (text || blocks.length > 0) {
            messages.push({ role: 'user', content: text, blocks, timestamp: ts });
          }
        } else {
          // evt.type === 'assistant'
          const blocks = normalizeBlocks(evt.message);
          const text = blocks.filter(b => b.type === 'text').map(b => b.text ?? '').join('');
          if (text || blocks.length > 0) {
            messages.push({ role: 'assistant', content: text, blocks, timestamp: ts });
          }
        }
      } catch { /* skip */ }
    }
    res.json({ sessionId: id, messages });
  });
}
