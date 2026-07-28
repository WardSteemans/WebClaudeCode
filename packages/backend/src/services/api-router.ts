import * as http from 'http';
import * as https from 'https';
import { getSettings } from '../data/db.js';
import { createLogger } from '../logger.js';

const log = createLogger('api-router');

// ── Types ──

interface UpstreamConfig {
  deepseekBaseUrl: string;
  deepseekApiKey: string;
  anthropicApiKey: string;
  visionModel: string;
}

interface ImageBlock {
  type: 'image';
  source: { type: string; media_type: string; data: string };
}

type JsonValue = string | number | boolean | null | JsonObject | JsonArray;
interface JsonObject { [key: string]: JsonValue }
interface JsonArray extends Array<JsonValue> {}

// ── State ──

let server: http.Server | null = null;
let config: UpstreamConfig | null = null;
let configLoadedAt = 0;
const CONFIG_TTL_MS = 5000;

// ── Config ──

function loadConfig(): UpstreamConfig | null {
  const now = Date.now();
  if (config && (now - configLoadedAt) < CONFIG_TTL_MS) return config;

  const settings = getSettings();
  const deepseekBaseUrl = settings.deepseekBaseUrl || 'https://api.deepseek.com/anthropic';
  const deepseekApiKey = settings.deepseekApiKey;
  const anthropicApiKey = settings.anthropicApiKey;

  if (!deepseekApiKey) {
    log.warn('DeepSeek API key not configured — API router disabled');
    return null;
  }

  config = {
    deepseekBaseUrl: deepseekBaseUrl.replace(/\/+$/, ''),
    deepseekApiKey,
    anthropicApiKey: anthropicApiKey || '',
    visionModel: settings.visionModel || 'claude-3-5-haiku-20241022',
  };
  configLoadedAt = now;
  return config;
}

// ── Body reading ──

function readBody(req: http.IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;

    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        req.destroy();
        reject(new Error('Payload too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

// ── Image detection ──

function hasImages(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') return false;
  if (Array.isArray(obj)) return obj.some(hasImages);

  const record = obj as Record<string, unknown>;
  if (record.type === 'image' && record.source) return true;
  return Object.values(record).some(v => hasImages(v));
}

function extractImages(obj: unknown): ImageBlock[] {
  const images: ImageBlock[] = [];
  _collectImages(obj, images);
  return images;
}

function _collectImages(obj: unknown, out: ImageBlock[]): void {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    for (const item of obj) _collectImages(item, out);
    return;
  }
  const record = obj as Record<string, unknown>;
  if (record.type === 'image' && record.source) {
    out.push(obj as unknown as ImageBlock);
  }
  for (const v of Object.values(record)) _collectImages(v, out);
}

// ── Request rewriting ──

function rewriteBody(body: JsonValue, description: string): JsonValue {
  return _replaceImages(structuredClone(body), description);
}

function _replaceImages(obj: JsonValue, description: string): JsonValue {
  if (!obj || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return (obj as JsonArray).map(item => _replaceImages(item, description));
  }

  const record = obj as JsonObject;
  if (record.type === 'image' && record.source) {
    return {
      type: 'text',
      text: `[Attached image: ${description}]`,
    } as unknown as JsonValue;
  }

  const result: JsonObject = {};
  for (const [key, value] of Object.entries(record)) {
    result[key] = _replaceImages(value, description);
  }
  return result;
}

function stripImages(body: JsonValue): JsonValue {
  return _stripImages(structuredClone(body));
}

function _stripImages(obj: JsonValue): JsonValue {
  if (!obj || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return (obj as JsonArray)
      .map(item => _stripImages(item))
      .filter(item => {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          return (item as JsonObject).type !== 'image';
        }
        return true;
      });
  }

  const record = obj as JsonObject;
  if (record.type === 'image') return null as unknown as JsonValue;

  const result: JsonObject = {};
  for (const [key, value] of Object.entries(record)) {
    const cleaned = _stripImages(value);
    if (cleaned !== null) {
      result[key] = cleaned;
    }
  }
  return result;
}

// ── Anthropic Vision API ──

async function callVisionAPI(cfg: UpstreamConfig, images: ImageBlock[]): Promise<string> {
  if (!cfg.anthropicApiKey) {
    throw new Error('No Anthropic API key configured for vision processing');
  }

  const body = JSON.stringify({
    model: cfg.visionModel,
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        ...images.map(img => ({
          type: 'image',
          source: img.source,
        })),
        {
          type: 'text',
          text: 'Describe each image in detail. Focus on layout, text content, UI elements, alignment, colors, and any visible issues. Be thorough but concise.',
        },
      ],
    }],
  });

  log.info('calling vision API', { model: cfg.visionModel, imageCount: images.length });

  return new Promise((resolve, reject) => {
    const url = new URL('/v1/messages', 'https://api.anthropic.com');
    const req = https.request({
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'x-api-key': cfg.anthropicApiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      },
      timeout: 60_000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          log.warn('vision API error', { status: res.statusCode, body: data.slice(0, 500) });
          reject(new Error(`Vision API returned ${res.statusCode}`));
          return;
        }
        try {
          const parsed = JSON.parse(data);
          const text = (parsed.content || [])
            .filter((b: { type: string; text?: string }) => b.type === 'text')
            .map((b: { type: string; text?: string }) => b.text)
            .join('\n');
          log.info('vision API success', { descriptionLength: text.length });
          resolve(text);
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Vision API timeout')); });
    req.write(body);
    req.end();
  });
}

// ── Streaming forward ──

function forwardToUpstream(
  targetBaseUrl: string,
  apiKey: string,
  body: string,
  cliRes: http.ServerResponse,
): void {
  const url = new URL('/v1/messages', targetBaseUrl);

  const options: https.RequestOptions = {
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
    timeout: 300_000,
  };

  log.info('forwarding to upstream', { target: targetBaseUrl, bodySize: body.length });

  const upstreamReq = https.request(options, (upstreamRes) => {
    cliRes.writeHead(upstreamRes.statusCode || 200, upstreamRes.headers);
    upstreamRes.pipe(cliRes);
  });

  upstreamReq.on('error', (err) => {
    log.error('upstream request failed', err);
    if (!cliRes.headersSent) {
      cliRes.writeHead(502, { 'content-type': 'application/json' });
      cliRes.end(JSON.stringify({
        type: 'error',
        error: { type: 'api_error', message: `Upstream unavailable: ${err.message}` },
      }));
    }
  });

  upstreamReq.on('timeout', () => {
    upstreamReq.destroy();
    if (!cliRes.headersSent) {
      cliRes.writeHead(504, { 'content-type': 'application/json' });
      cliRes.end(JSON.stringify({
        type: 'error',
        error: { type: 'timeout', message: 'Upstream request timed out' },
      }));
    }
  });

  upstreamReq.write(body);
  upstreamReq.end();
}

// ── Request handler ──

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  // Only handle POST /v1/messages
  if (req.method !== 'POST' || !req.url?.startsWith('/v1/messages')) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  const cfg = loadConfig();
  if (!cfg) {
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      type: 'error',
      error: { type: 'configuration', message: 'API router not configured — DeepSeek API key required' },
    }));
    return;
  }

  // Read body
  let body: string;
  try {
    body = await readBody(req, 10 * 1024 * 1024);
  } catch (err) {
    res.writeHead(413, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Payload too large' }));
    return;
  }

  if (!body.trim()) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Empty body' }));
    return;
  }

  // Parse JSON
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(body);
  } catch {
    // Not valid JSON — forward as-is
    forwardToUpstream(cfg.deepseekBaseUrl, cfg.deepseekApiKey, body, res);
    return;
  }

  // Check for images
  if (!hasImages(parsed)) {
    forwardToUpstream(cfg.deepseekBaseUrl, cfg.deepseekApiKey, body, res);
    return;
  }

  // ── Vision flow ──
  log.info('image detected — routing through vision');

  const images = extractImages(parsed);
  try {
    const description = await callVisionAPI(cfg, images);
    const rewritten = rewriteBody(parsed, description);
    forwardToUpstream(cfg.deepseekBaseUrl, cfg.deepseekApiKey, JSON.stringify(rewritten), res);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Vision processing failed';
    log.warn('vision failed, forwarding without images', { error: message, imageCount: images.length });

    try {
      const cleaned = stripImages(parsed);
      // Add a note so the model knows images were present
      if (cleaned && typeof cleaned === 'object' && 'messages' in cleaned) {
        const msgs = (cleaned as JsonObject).messages as JsonArray;
        if (msgs && msgs.length > 0) {
          const last = msgs[msgs.length - 1] as JsonObject;
          if (last.content) {
            if (Array.isArray(last.content)) {
              (last.content as JsonArray).push({
                type: 'text',
                text: `[Note: ${images.length} image(s) could not be processed automatically. ${message}]`,
              } as unknown as JsonValue);
            }
          }
        }
      }
      forwardToUpstream(cfg.deepseekBaseUrl, cfg.deepseekApiKey, JSON.stringify(cleaned), res);
    } catch {
      // Last resort: forward original body
      forwardToUpstream(cfg.deepseekBaseUrl, cfg.deepseekApiKey, body, res);
    }
  }
}

// ── Lifecycle ──

export function startApiRouter(preferredPort = 9000): http.Server {
  if (server) return server;

  server = http.createServer(handleRequest);
  server.timeout = 300_000;

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      log.warn(`port ${preferredPort} in use, trying ${preferredPort + 1}`);
      server?.close();
      server = null;
      startApiRouter(preferredPort + 1);
      return;
    }
    log.error('API router fatal error', err);
  });

  server.listen(preferredPort, () => {
    log.info(`API router started`, { port: preferredPort });
    console.log(`API router listening on http://localhost:${preferredPort}`);
  });

  return server;
}

export function getApiRouterPort(): number {
  return (server?.address() as { port: number })?.port || 0;
}

export function stopApiRouter(): void {
  if (server) {
    server.close();
    server = null;
    log.info('API router stopped');
  }
}
