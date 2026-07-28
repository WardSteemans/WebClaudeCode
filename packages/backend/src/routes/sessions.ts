import express from 'express';
import * as sessionHistory from '../data/sessions.js';

/** Normalize the Claude message content into a uniform blocks array */
function normalizeBlocks(msg: any): any[] {
  const raw = msg.content;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    // Could be a JSON string with nested messages, or plain text
    try {
      const parsed = JSON.parse(raw);
      if (parsed.messages) {
        // Anthropic-style: {"messages":[{"content":"..."}]}
        return parsed.messages.flatMap((m: any) => normalizeBlocks(m));
      }
      if (Array.isArray(parsed.content)) return parsed.content;
      return [{ type: 'text', text: raw }];
    } catch {
      // Check for internal CLI XML tags
      const stdoutMatch = raw.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/);
      if (stdoutMatch) return [{ type: 'text', text: stdoutMatch[1].trim() }];
      if (raw.startsWith('<local-command')) {
        const cmdNameMatch = raw.match(/<command-name>([^<]*)<\/command-name>/);
        const cmdMsgMatch = raw.match(/<command-message>([^<]*)<\/command-message>/);
        if (cmdNameMatch) {
          const cmd = cmdNameMatch[1].trim();
          const msg = cmdMsgMatch ? cmdMsgMatch[1].trim() : '';
          const text = msg ? `> **\`${cmd}\`** — ${msg}` : `> **\`${cmd}\`**`;
          return [{ type: 'text', text }];
        }
        return [];
      }
      return [{ type: 'text', text: raw }];
    }
  }
  return [];
}

/** Extract plain text from blocks (for backward-compat `content` field) */
function blocksToText(blocks: any[]): string {
  return blocks
    .filter((b: any) => b.type === 'text' && b.text)
    .map((b: any) => b.text)
    .join('\n');
}

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

    // Parse JSONL into message array — preserving all content blocks (thinking, tool_use, etc.)
    const messages: unknown[] = [];
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const evt = JSON.parse(line);
        const ts = evt.timestamp || null;

        if (evt.type === 'user' && evt.message?.role === 'user') {
          const blocks = normalizeBlocks(evt.message);
          const text = blocksToText(blocks);
          if (text || blocks.length > 0) {
            messages.push({ role: 'user', content: text, blocks, timestamp: ts });
          }
        } else if (evt.type === 'assistant' && evt.message?.role === 'assistant') {
          const blocks = normalizeBlocks(evt.message);
          const text = blocks.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
          if (text || blocks.length > 0) {
            messages.push({ role: 'assistant', content: text, blocks, timestamp: ts });
          }
        }
      } catch { /* skip */ }
    }
    res.json({ sessionId: id, messages });
  });
}
