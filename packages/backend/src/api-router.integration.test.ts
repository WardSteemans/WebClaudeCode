import { startApiRouter, stopApiRouter } from './services/api-router.js';
import { initDb } from './data/db.js';

(async () => {
  await initDb();
  startApiRouter(9000);
  await new Promise(r => setTimeout(r, 300));

  try {
    const r1 = await fetch('http://localhost:9000/');
    console.log('GET /             →', r1.status, r1.status === 404 ? '✓' : '✗');

    const r2 = await fetch('http://localhost:9000/v1/messages');
    console.log('GET /v1/messages  →', r2.status, r2.status === 404 ? '✓' : '✗');

    const r3 = await fetch('http://localhost:9000/v1/messages', { method: 'POST' });
    console.log('POST no body      →', r3.status, r3.status === 400 ? '✓' : '✗');

    const r4 = await fetch('http://localhost:9000/v1/messages', {
      method: 'POST', body: 'not-json',
    });
    console.log('POST bad JSON     →', r4.status, r4.status === 503 ? '✓ (no key)' : '✗');

    const r5 = await fetch('http://localhost:9000/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-v4-pro',
        messages: [{ role: 'user', content: 'hello' }],
        stream: true,
      }),
    });
    console.log('POST text-only    →', r5.status, r5.status === 503 ? '✓ (no key)' : '✗');
  } finally {
    stopApiRouter();
    console.log('✓ Server lifecycle OK');
  }
})();
