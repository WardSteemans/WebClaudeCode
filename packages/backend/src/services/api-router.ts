import * as https from 'https';
import type { Request, Response } from 'express';
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

export interface ImageBlock {
  type: 'image';
  source: { type: string; media_type: string; data: string };
}

type JsonValue = string | number | boolean | null | JsonObject | JsonArray;
interface JsonObject { [key: string]: JsonValue }
interface JsonArray extends Array<JsonValue> {}

// ── Metrics ──

export interface ProxyMetric {
  id: string;
  timestamp: string;
  /** 'direct' = no images, forwarded straight; 'vision' = images → vision API; 'stripped' = images removed (no key/error); 'error' = failed */
  routing: 'direct' | 'vision' | 'stripped' | 'error';
  provider: string;
  model: string;
  statusCode: number;
  /** Time to first byte from upstream (ms) */
  ttfbMs: number;
  /** Total time from request to response end (ms) */
  totalMs: number;
  bodySize: number;
  imageCount: number;
  error?: string;
}

const metrics: ProxyMetric[] = [];
const MAX_METRICS = 500;

function recordMetric(m: Omit<ProxyMetric, 'id' | 'timestamp'>): void {
  const entry: ProxyMetric = {
    ...m,
    id: Math.random().toString(36).slice(2, 10),
    timestamp: new Date().toISOString(),
  };
  metrics.push(entry);
  if (metrics.length > MAX_METRICS) metrics.shift();
}

export function getMetrics(limit = 50): ProxyMetric[] {
  return metrics.slice(-limit).reverse();
}

// ── State ──

let config: UpstreamConfig | null = null;
let configLoadedAt = 0;
const CONFIG_TTL_MS = 5000;

// ── Config ──

function loadConfig(): UpstreamConfig | null {
  const now = Date.now();
  if (config && (now - configLoadedAt) < CONFIG_TTL_MS) return config;

  const settings = getSettings();
  const deepseekApiKey = settings.deepseekApiKey;
  const deepseekBaseUrl = settings.deepseekBaseUrl || 'https://api.deepseek.com/anthropic';

  if (!deepseekApiKey) {
    log.warn('DeepSeek API key not configured');
    return null;
  }

  config = {
    deepseekBaseUrl: deepseekBaseUrl.replace(/\/+$/, ''),
    deepseekApiKey,
    anthropicApiKey: settings.anthropicApiKey || '',
    visionModel: settings.visionModel || 'claude-3-5-haiku-20241022',
  };
  configLoadedAt = now;
  return config;
}

// ── Image detection ──

export function hasImages(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') return false;
  if (Array.isArray(obj)) return obj.some(hasImages);

  const record = obj as Record<string, unknown>;
  if (record.type === 'image' && record.source) return true;
  return Object.values(record).some(v => hasImages(v));
}

export function extractImages(obj: unknown): ImageBlock[] {
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

function extractModel(body: unknown): string {
  if (body && typeof body === 'object' && 'model' in body) {
    return String((body as Record<string, unknown>).model || 'unknown');
  }
  return 'unknown';
}

// ── Request rewriting ──

export function rewriteBody(body: unknown, description: string): unknown {
  try {
    return _replaceImages(structuredClone(body) as JsonValue, description);
  } catch {
    log.warn('structuredClone failed during rewrite — returning original');
    return body;
  }
}

function _replaceImages(obj: JsonValue, description: string): JsonValue {
  if (!obj || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return (obj as JsonArray).map(item => _replaceImages(item, description));
  }

  const record = obj as JsonObject;
  if (record.type === 'image' && record.source) {
    return { type: 'text', text: `[Attached image: ${description}]` } as unknown as JsonValue;
  }

  const result: JsonObject = {};
  for (const [key, value] of Object.entries(record)) {
    result[key] = _replaceImages(value, description);
  }
  return result;
}

export function stripImages(body: unknown): unknown {
  try {
    return _stripImages(structuredClone(body) as JsonValue);
  } catch {
    log.warn('structuredClone failed during strip — returning original');
    return body;
  }
}

function _stripImages(obj: JsonValue): JsonValue {
  if (!obj || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return (obj as JsonArray)
      .map(item => _stripImages(item))
      .filter(item => item !== null);
  }

  const record = obj as JsonObject;
  if (record.type === 'image') return null as unknown as JsonValue;

  const result: JsonObject = {};
  for (const [key, value] of Object.entries(record)) {
    const cleaned = _stripImages(value);
    if (cleaned !== null) result[key] = cleaned;
  }
  return result;
}

function ensureNonEmptyContent(obj: unknown, fallbackText: string): unknown {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return (obj as unknown[]).map(item => ensureNonEmptyContent(item, fallbackText));

  const record = obj as Record<string, unknown>;
  if (Array.isArray(record.content) && record.content.length === 0) {
    return { ...record, content: [{ type: 'text', text: fallbackText }] };
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    result[key] = ensureNonEmptyContent(value, fallbackText);
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
        ...images.map(img => ({ type: 'image', source: img.source })),
        { type: 'text', text: 'Describe each image in detail. Focus on layout, text content, UI elements, alignment, colors, and any visible issues. Be thorough but concise.' },
      ],
    }],
  });

  log.info('calling vision API', { model: cfg.visionModel, imageCount: images.length });

  return new Promise((resolve, reject) => {
    const url = new URL('/v1/messages', 'https://api.anthropic.com');
    const req = https.request({
      hostname: url.hostname, port: 443, path: url.pathname, method: 'POST',
      headers: {
        'x-api-key': cfg.anthropicApiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      },
      timeout: 60_000,
      ...getTlsOptions(),
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
        } catch (err) { reject(err); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Vision API timeout')); });
    req.write(body);
    req.end();
  });
}

function getTlsOptions(): { rejectUnauthorized?: boolean } {
  if (getSettings().apiRouterInsecureTls === 'true') {
    log.warn('TLS verification disabled — apiRouterInsecureTls is set');
    return { rejectUnauthorized: false };
  }
  return {};
}

// ── Streaming forward (with metrics) ──

function forwardToUpstream(
  targetBaseUrl: string,
  apiKey: string,
  body: string,
  res: Response,
  onDone: (statusCode: number, ttfbMs: number, error?: string) => void,
): void {
  const url = new URL('/v1/messages', targetBaseUrl);
  const startTime = Date.now();
  let firstByte = true;
  let ttfbMs = 0;

  const upstreamReq = https.request({
    hostname: url.hostname, port: url.port || 443, path: url.pathname, method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
    },
    timeout: 300_000,
    ...getTlsOptions(),
  }, (upstreamRes) => {
    const isError = (upstreamRes.statusCode || 0) >= 400;
    let errorBody = '';

    upstreamRes.on('data', (chunk: Buffer) => {
      if (firstByte) {
        ttfbMs = Date.now() - startTime;
        firstByte = false;
      }
      res.write(chunk);
      if (isError && errorBody.length < 2000) {
        errorBody += chunk.toString('utf-8');
      }
    });
    upstreamRes.on('end', () => {
      let errorMsg: string | undefined;
      if (isError && errorBody) {
        try {
          const parsed = JSON.parse(errorBody);
          errorMsg = parsed?.error?.message || parsed?.error?.type || String(upstreamRes.statusCode);
        } catch {
          errorMsg = errorBody.slice(0, 100);
        }
      }
      onDone(upstreamRes.statusCode || 0, ttfbMs, errorMsg);
      res.end();
    });
    res.writeHead(upstreamRes.statusCode || 200, upstreamRes.headers);
  });

  upstreamReq.on('error', (err) => {
    log.error('upstream request failed', err);
    if (!res.headersSent) {
      res.status(502).json({
        type: 'error', error: { type: 'api_error', message: `Upstream unavailable: ${err.message}` },
      });
    }
    onDone(502, 0, err.message);
  });

  upstreamReq.on('timeout', () => {
    upstreamReq.destroy();
    if (!res.headersSent) {
      res.status(504).json({
        type: 'error', error: { type: 'timeout', message: 'Upstream request timed out' },
      });
    }
    onDone(504, 0, 'timeout');
  });

  upstreamReq.write(body);
  upstreamReq.end();
}

// ── Routing Rules Engine ──

import type { RoutingRule } from '@cc-gui/shared';

let rulesCache: RoutingRule[] | null = null;
let rulesCacheAt = 0;
const RULES_CACHE_TTL = 10_000;

function loadRules(): RoutingRule[] {
  const now = Date.now();
  if (rulesCache && (now - rulesCacheAt) < RULES_CACHE_TTL) return rulesCache;

  try {
    const settings = getSettings();
    const raw = settings.routingRules;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        rulesCache = parsed as RoutingRule[];
        rulesCacheAt = now;
        return rulesCache;
      }
    }
  } catch { /* invalid JSON, ignore */ }
  rulesCache = [];
  rulesCacheAt = now;
  return rulesCache;
}

export function getRoutingRules(): RoutingRule[] {
  return loadRules();
}

function evaluateCondition(condition: RoutingRule['condition'], parsed: JsonValue): boolean {
  const { field, operator, value } = condition;
  let actual: string | boolean | number = '';

  switch (field) {
    case 'hasImages':
      actual = hasImages(parsed);
      break;
    case 'model':
      actual = extractModel(parsed);
      break;
    case 'content': {
      // Extract all text content from messages
      const parts: string[] = [];
      const collect = (obj: unknown) => {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) { obj.forEach(collect); return; }
        const r = obj as Record<string, unknown>;
        if (r.type === 'text' && typeof r.text === 'string') parts.push(r.text);
        Object.values(r).forEach(collect);
      };
      collect(parsed);
      actual = parts.join(' ');
      break;
    }
    default:
      return false;
  }

  switch (operator) {
    case 'equals':   return String(actual) === value || actual === (value === 'true' ? true : value === 'false' ? false : value);
    case 'contains': return String(actual).toLowerCase().includes(value.toLowerCase());
    case 'startsWith': return String(actual).toLowerCase().startsWith(value.toLowerCase());
    case 'gt':       return Number(actual) > Number(value);
    case 'lt':       return Number(actual) < Number(value);
    case 'regex':
      try { return new RegExp(value, 'i').test(String(actual)); } catch { return false; }
    default: return false;
  }
}

export interface RuleActionResult {
  forceVision: boolean;
  skipVision: boolean;
  overrideModel: string | null;
}

function applyRules(parsed: JsonValue): RuleActionResult {
  const result: RuleActionResult = { forceVision: false, skipVision: false, overrideModel: null };
  const rules = loadRules();

  for (const rule of rules) {
    if (!rule.enabled) continue;

    try {
      if (evaluateCondition(rule.condition, parsed)) {
        log.info('routing rule matched', { rule: rule.name });

        switch (rule.action.type) {
          case 'forceVision':
            result.forceVision = true;
            break;
          case 'skipVision':
            result.skipVision = true;
            break;
          case 'setModel':
            if (rule.action.value) {
              result.overrideModel = rule.action.value;
            }
            break;
        }
      }
    } catch (err) {
      log.warn('rule evaluation failed', { rule: rule.name, error: String(err) });
    }
  }

  return result;
}

// ── Express request handler ──

export async function handleProxyRequest(req: Request, res: Response): Promise<void> {
  const raw = req.body;
  if (!raw || (Buffer.isBuffer(raw) && raw.length === 0)) {
    res.status(400).json({ error: 'Empty body' });
    return;
  }

  const body = Buffer.isBuffer(raw) ? raw.toString('utf-8') : String(raw);
  const bodySize = body.length;
  const startTime = Date.now();

  // Parse JSON
  let parsed: JsonValue;
  try { parsed = JSON.parse(body); } catch {
    res.status(400).json({ error: 'Invalid JSON body' });
    return;
  }

  const model = extractModel(parsed);
  const provider = model.includes('deepseek') ? 'deepseek' : 'anthropic';

  const cfg = loadConfig();
  if (!cfg) {
    res.status(503).json({ type: 'error', error: { type: 'configuration', message: 'DeepSeek API key required' } });
    return;
  }

  // ── Evaluate routing rules ──
  const ruleResult = applyRules(parsed);
  const effectiveModel = ruleResult.overrideModel || model;
  const hasImg = hasImages(parsed);
  const shouldUseVision = (hasImg && !ruleResult.skipVision) || ruleResult.forceVision;

  // No images and no rule-triggered vision → forward directly
  if (!shouldUseVision) {
    forwardToUpstream(cfg.deepseekBaseUrl, cfg.deepseekApiKey, body, res, (statusCode, ttfbMs, errMsg) => {
      recordMetric({
        routing: 'direct', provider, model: effectiveModel, statusCode,
        ttfbMs, totalMs: Date.now() - startTime, bodySize, imageCount: 0,
        ...(errMsg ? { error: errMsg } : {}),
      });
    });
    return;
  }

  // ── Vision flow ──
  const images = hasImg ? extractImages(parsed) : [];
  log.info('vision routing triggered', { hasImg, forceVision: ruleResult.forceVision, imageCount: images.length });

  // No Anthropic key → strip and forward
  if (!cfg.anthropicApiKey) {
    log.warn('no Anthropic key — stripping images');
    const cleaned = ensureNonEmptyContent(stripImages(parsed), '[Image(s) removed — no vision API key configured]');
    forwardToUpstream(cfg.deepseekBaseUrl, cfg.deepseekApiKey, JSON.stringify(cleaned), res, (statusCode, ttfbMs, errMsg) => {
      recordMetric({
        routing: 'stripped', provider: 'deepseek', model, statusCode,
        ttfbMs, totalMs: Date.now() - startTime, bodySize, imageCount: images.length,
        error: errMsg || 'No Anthropic API key',
      });
    });
    return;
  }

  try {
    const description = await callVisionAPI(cfg, images);
    const rewritten = rewriteBody(parsed, description);
    forwardToUpstream(cfg.deepseekBaseUrl, cfg.deepseekApiKey, JSON.stringify(rewritten), res, (statusCode, ttfbMs, errMsg) => {
      recordMetric({
        routing: 'vision', provider: 'deepseek', model, statusCode,
        ttfbMs, totalMs: Date.now() - startTime, bodySize, imageCount: images.length,
        ...(errMsg ? { error: errMsg } : {}),
      });
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Vision processing failed';
    log.warn('vision failed, stripping images', { error: message });

    try {
      const cleaned = ensureNonEmptyContent(stripImages(parsed), `[${images.length} image(s) could not be processed: ${message}]`);
      forwardToUpstream(cfg.deepseekBaseUrl, cfg.deepseekApiKey, JSON.stringify(cleaned), res, (statusCode, ttfbMs, errMsg) => {
        recordMetric({
          routing: 'stripped', provider: 'deepseek', model, statusCode,
          ttfbMs, totalMs: Date.now() - startTime, bodySize, imageCount: images.length,
          error: errMsg || message,
        });
      });
    } catch {
      forwardToUpstream(cfg.deepseekBaseUrl, cfg.deepseekApiKey, body, res, (statusCode, ttfbMs, errMsg) => {
        recordMetric({
          routing: 'error', provider: 'deepseek', model, statusCode,
          ttfbMs, totalMs: Date.now() - startTime, bodySize, imageCount: images.length,
          error: errMsg || 'Failed to strip images',
        });
      });
    }
  }
}
