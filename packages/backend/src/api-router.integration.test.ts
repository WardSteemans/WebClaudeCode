import express from 'express';
import { createServer } from 'http';
import { initDb } from './data/db.js';
import { handleProxyRequest } from './services/api-router.js';

(async () => {
  await initDb();

  const app = express();
  app.post('/api/proxy/v1/messages', express.raw({ type: '*/*', limit: '10mb' }), handleProxyRequest);

  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(9001, resolve));
  const base = 'http://localhost:9001/api/proxy';

  try {
    // Test 1: GET → 404 (Express handles routing)
    const r1 = await fetch(base.replace('/api/proxy', '/'));
    console.log('GET /           →', r1.status, r1.status === 404 ? '✓' : '✗');

    // Test 2: POST empty body
    const r2 = await fetch(base + '/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '',
    });
    console.log('POST empty body →', r2.status, r2.status === 400 ? '✓' : '✗');

    // Test 3: POST invalid JSON
    const r3 = await fetch(base + '/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    console.log('POST bad JSON   →', r3.status, r3.status === 400 ? '✓' : '✗');

    // Test 4: POST valid JSON, no DeepSeek key → 503
    const r4 = await fetch(base + '/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-v4-pro',
        messages: [{ role: 'user', content: 'hello' }],
        stream: true,
      }),
    });
    console.log('POST text-only  →', r4.status, r4.status === 503 || r4.status === 502 ? '✓ (no upstream)' : '✗');

  } finally {
    server.close();
    console.log('✓ Proxy lifecycle OK');
  }
})();
