import express from 'express';
import { createServer } from 'http';
import { initPricing } from './integrations/pricing.js';
import { initDb } from './data/db.js';
import { createLogger } from './logger.js';
import { setupWebSocket } from './ws/handler.js';
import { startApiRouter, getApiRouterPort, stopApiRouter } from './services/api-router.js';
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
  res.json({ status: 'ok', activeSessions: sessions.size, apiRouterPort: getApiRouterPort() });
});

// ----- Start -----

initDb().then(() => initPricing()).then(() => {
  startApiRouter(9000);

  server.listen(PORT, () => {
    log.info(`Backend running`, { port: PORT, wsPath: '/ws', apiRouterPort: getApiRouterPort() });
    console.log(`Backend running on http://localhost:${PORT}`);
    console.log(`API router on http://localhost:${getApiRouterPort()}`);
    console.log(`WebSocket on ws://localhost:${PORT}/ws`);
  });
});

