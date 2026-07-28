import express from 'express';
import * as https from 'https';

interface ChatMessage {
  role: string;
  content: string;
}

interface ContentBlock {
  type: string;
  text?: string;
}

function generateFallbackTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find(m => m.role === 'user');
  if (firstUser) {
    return firstUser.content.replace(/[\n\r]/g, ' ').slice(0, 50).trim();
  }
  return 'Chat';
}

export function registerChatsRoutes(app: express.Express): void {
  app.post('/api/chats/generate-title', express.json(), (req, res) => {
    const { messages, env } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length < 2) {
      return res.status(400).json({ error: 'Need at least 2 messages' });
    }

    const apiKey = env?.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.json({ title: generateFallbackTitle(messages) });
    }

    const rawBase = (env?.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '');
    const url = new URL('/v1/messages', rawBase);
    const model = env?.ANTHROPIC_MODEL || 'claude-3-5-haiku-20241022';

    // Build conversation summary
    const conversationText = messages
      .filter((m: ChatMessage) => m.role === 'user' || m.role === 'assistant')
      .slice(-6)
      .map((m: ChatMessage) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${String(m.content).slice(0, 500)}`)
      .join('\n\n');

    const body = JSON.stringify({
      model,
      max_tokens: 20,
      system: 'You generate very short chat titles. Always respond with ONLY the title text, nothing else.',
      messages: [{
        role: 'user',
        content: `Generate a very short, descriptive title (max 5 words) that captures what this conversation is about. Return ONLY the title — no quotes, no punctuation, no explanation.\n\nConversation:\n${conversationText}\n\nTitle:`,
      }],
    });

    const reqOpts: https.RequestOptions = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      },
      timeout: 15000,
    };

    const apiReq = https.request(reqOpts, (apiRes) => {
      let data = '';
      apiRes.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      apiRes.on('end', () => {
        if (apiRes.statusCode !== 200) {
          return res.json({ title: generateFallbackTitle(messages) });
        }
        try {
          const parsed = JSON.parse(data);
          let title = '';
          if (parsed.content && Array.isArray(parsed.content)) {
            title = parsed.content
              .filter((b: ContentBlock) => b.type === 'text' && b.text)
              .map((b: ContentBlock) => b.text)
              .join('');
          }
          title = title.replace(/^["'\s]+|["'\s]+$/g, '').trim();
          if (!title || title.length > 100) title = generateFallbackTitle(messages);
          res.json({ title });
        } catch {
          res.json({ title: generateFallbackTitle(messages) });
        }
      });
    });

    apiReq.on('error', () => { /* silent — titles are non-critical */ });
    apiReq.on('timeout', () => { apiReq.destroy(); if (!res.headersSent) res.json({ title: generateFallbackTitle(messages) }); });
    apiReq.write(body);
    apiReq.end();
  });
}
