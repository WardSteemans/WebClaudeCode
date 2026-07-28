import express from 'express';
import { createServer } from 'http';
import { initPricing } from './integrations/pricing.js';
import { initDb } from './data/db.js';
import { createLogger } from './logger.js';
import { setupWebSocket } from './ws/handler.js';
import { handleProxyRequest, getMetrics } from './services/api-router.js';
import { registerFsRoutes } from './routes/fs.js';
import { registerGitRoutes } from './routes/git.js';
import { registerAzureDevOpsRoutes } from './routes/azure-devops.js';
import { registerSessionsRoutes } from './routes/sessions.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerMetricsRoutes } from './routes/metrics.js';
import { registerTabStateRoutes } from './routes/tab-state.js';
import { registerChatsRoutes } from './routes/chats.js';
import { registerLogRoutes } from './routes/log.js';

const log = createLogger('server');

const PORT = parseInt(process.env.PORT ?? '', 10) || 3001;

const app = express();

// ── API Router proxy (mounted BEFORE json middleware — needs raw body) ──
// Claude CLI sends requests to ANTHROPIC_BASE_URL/v1/messages.
// We set ANTHROPIC_BASE_URL = http://localhost:3001/api/proxy
// so the CLI hits: POST http://localhost:3001/api/proxy/v1/messages
// Express raw body parser preserves the exact request for upstream forwarding.
app.post('/api/proxy/v1/messages', express.raw({ type: '*/*', limit: '10mb' }), handleProxyRequest);

// ── API Router metrics ──
app.get('/api/proxy/metrics', (_req, res) => {
  const limit = Math.min(Math.max(parseInt(String(_req.query.limit || '50'), 10) || 50, 1), 500);
  res.json(getMetrics(limit));
});

app.use(express.json({ limit: '10mb' }));

// ── Request logging middleware ──
app.use((req, _res, next) => {
  if (req.path.startsWith('/api/')) {
    log.debug(`API ${req.method} ${req.path}`, {
      method: req.method,
      path: req.path,
      query: Object.keys(req.query).length > 0 ? JSON.stringify(req.query).slice(0, 200) : undefined,
    });
  }
  next();
});

const server = createServer(app);

// ── Route registration ──

registerFsRoutes(app);
registerGitRoutes(app);
registerAzureDevOpsRoutes(app);
registerSessionsRoutes(app);
registerSettingsRoutes(app);
registerMetricsRoutes(app);
registerTabStateRoutes(app);
registerChatsRoutes(app);
registerLogRoutes(app);

// ── WebSocket ──

const { sessions } = setupWebSocket(server);

// ── Health ──

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', activeSessions: sessions.size });
});

// ----- Start -----

initDb().then(() => initPricing()).then(() => {
  server.listen(PORT, () => {
    log.info(`Backend running`, { port: PORT, wsPath: '/ws' });
    console.log(`Backend running on http://localhost:${PORT}`);
    console.log(`WebSocket on ws://localhost:${PORT}/ws`);
  });
});
