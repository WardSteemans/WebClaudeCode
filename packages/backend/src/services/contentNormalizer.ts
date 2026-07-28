// ── Shared content normalization ──
// Parses Claude Code's various message content formats into a uniform block array.
// Used by both data/sessions.ts and routes/sessions.ts.

export interface ContentBlock {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export interface NormalizedMessage {
  role: 'user' | 'assistant';
  content: string;
  blocks: ContentBlock[];
  timestamp?: string | null;
}

// ── Normalize into blocks ──

export function normalizeBlocks(msg: { content?: unknown }): ContentBlock[] {
  const raw = msg.content;
  if (Array.isArray(raw)) return raw as ContentBlock[];
  if (typeof raw === 'string') {
    // Could be a JSON string with nested messages, or plain text
    try {
      const parsed = JSON.parse(raw);
      if (parsed.messages) {
        return parsed.messages.flatMap((m: { content?: unknown }) => normalizeBlocks(m));
      }
      if (Array.isArray(parsed.content)) return parsed.content as ContentBlock[];
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

// ── Extract plain text from blocks ──

export function blocksToText(blocks: ContentBlock[]): string {
  return blocks
    .filter(b => b.type === 'text' && b.text)
    .map(b => b.text!)
    .join('\n');
}
