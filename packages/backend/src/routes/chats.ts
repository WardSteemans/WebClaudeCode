import express from 'express';
import * as http from 'http';
import * as https from 'https';
import { createLogger } from '../logger.js';
import { getSettings } from '../data/db.js';

const log = createLogger('chats', 'title/title-gen');

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
      log.info('generate-title: no ANTHROPIC_API_KEY in env, using fallback');
      return res.json({ title: generateFallbackTitle(messages) });
    }

    const rawBase = (env?.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '');
    const url = new URL('/v1/messages', rawBase);
    const model = env?.ANTHROPIC_MODEL || 'claude-3-5-haiku-20241022';
    const isHttp = url.protocol === 'http:';

    // Mirror api-router TLS setting for corporate proxies that intercept TLS
    const insecureTls = getSettings().apiRouterInsecureTls === 'true';

    log.debug('generate-title: calling AI API', { baseUrl: rawBase, model, msgCount: messages.length, isHttp, insecureTls });

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

    const reqOpts: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port || (isHttp ? 80 : 443),
      path: url.pathname,
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      },
      timeout: 15000,
      ...(insecureTls ? { rejectUnauthorized: false } : {}),
    };

    const transport = isHttp ? http : https;

    const apiReq = transport.request(reqOpts, (apiRes) => {
      let data = '';
      apiRes.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      apiRes.on('end', () => {
        if (apiRes.statusCode !== 200) {
          log.warn('generate-title: AI API non-200', { statusCode: apiRes.statusCode });
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
          if (!title || title.length > 100) {
            log.debug('generate-title: AI returned empty or too-long title, using fallback', { rawTitle: title });
            title = generateFallbackTitle(messages);
          }
          log.info('generate-title: success', { title });
          res.json({ title });
        } catch (err) {
          log.warn('generate-title: failed to parse AI response, using fallback', err instanceof Error ? { message: err.message } : undefined);
          res.json({ title: generateFallbackTitle(messages) });
        }
      });
    });

    apiReq.on('error', (err) => {
      log.warn('generate-title: AI API request error, using fallback', { message: err.message });
      if (!res.headersSent) res.json({ title: generateFallbackTitle(messages) });
    });
    apiReq.on('timeout', () => {
      log.warn('generate-title: AI API request timeout, using fallback');
      apiReq.destroy();
      if (!res.headersSent) res.json({ title: generateFallbackTitle(messages) });
    });
    apiReq.write(body);
    apiReq.end();
  });
}
