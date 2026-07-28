import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../logger.js';

const log = createLogger('pricing');

// ── Types ──

export interface ModelPricing {
  input: number;      // USD per 1M input tokens
  output: number;     // USD per 1M output tokens
  cacheRead: number;  // USD per 1M cache-read tokens (0 if unsupported)
  cacheWrite: number; // USD per 1M cache-write tokens (0 if unsupported)
}

export interface ProviderPricing {
  /** Tier name → pricing */
  models: Record<string, ModelPricing>;
  /** Default tier when no specific model matches */
  defaultModel: string;
}

export interface PricingData {
  updated: string;  // ISO date
  source: 'default' | 'cache' | 'fetch' | 'env';
  providers: Record<string, ProviderPricing>;
}

// ── Hardcoded defaults ──

const DEFAULTS: PricingData = {
  updated: '2025-07-23',
  source: 'default',
  providers: {
    anthropic: {
      defaultModel: 'sonnet',
      models: {
        sonnet: { input: 3.00, output: 15.00, cacheRead: 0.30, cacheWrite: 3.75 },
        haiku:  { input: 0.80, output: 4.00,  cacheRead: 0.08, cacheWrite: 1.00 },
        opus:   { input: 15.00, output: 75.00, cacheRead: 1.50, cacheWrite: 18.75 },
      },
    },
    deepseek: {
      defaultModel: 'v3',
      models: {
        v3: { input: 0.27, output: 1.10, cacheRead: 0.07, cacheWrite: 0 },
        r1: { input: 0.55, output: 2.19, cacheRead: 0.14, cacheWrite: 0 },
      },
    },
    openai: {
      defaultModel: 'gpt-4o',
      models: {
        'gpt-4o':      { input: 2.50, output: 10.00, cacheRead: 1.25, cacheWrite: 0 },
        'gpt-4o-mini': { input: 0.15, output: 0.60,  cacheRead: 0.075, cacheWrite: 0 },
        'o1':          { input: 15.00, output: 60.00, cacheRead: 7.50, cacheWrite: 0 },
        'o3-mini':     { input: 1.10, output: 4.40,  cacheRead: 0.55, cacheWrite: 0 },
      },
    },
  },
};

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

// ── State ──

let currentPricing: PricingData = DEFAULTS;
let initDone = false;

function cachePath(): string {
  return path.join(process.cwd(), '.pricing-cache.json');
}

// ── Fetch ──

async function fetchPricing(url: string): Promise<PricingData | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const json = await res.json();

    // Validate: must have providers with models having input/output
    if (!json || typeof json.providers !== 'object') return null;
    for (const [, pp] of Object.entries(json.providers)) {
      const p = pp as { models?: Record<string, unknown> };
      if (!p.models || typeof p.models !== 'object') return null;
      for (const [, v] of Object.entries(p.models)) {
        const m = v as { input?: unknown; output?: unknown };
        if (typeof m.input !== 'number' || typeof m.output !== 'number') return null;
      }
    }

    return {
      updated: json.updated || new Date().toISOString().slice(0, 10),
      source: 'fetch',
      providers: json.providers as Record<string, ProviderPricing>,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function readCache(): PricingData | null {
  try {
    const raw = fs.readFileSync(cachePath(), 'utf-8');
    const data = JSON.parse(raw);
    // Accept both old flat format and new providers format
    if (data?.providers && data?.updated) {
      const age = Date.now() - new Date(data.updated).getTime();
      if (age > CACHE_TTL_MS) return null;
      return { ...data, source: 'cache' };
    }
    return null;
  } catch {
    return null;
  }
}

function writeCache(data: PricingData): void {
  try {
    fs.writeFileSync(cachePath(), JSON.stringify(data, null, 2), 'utf-8');
  } catch { /* non-critical */ }
}

// ── Init ──

export async function initPricing(): Promise<void> {
  if (initDone) return;

  const cached = readCache();
  if (cached) {
    currentPricing = cached;
    log.info('using cached pricing', { updated: cached.updated, source: cached.source });
    initDone = true;
    const age = Date.now() - new Date(cached.updated).getTime();
    if (age > 12 * 60 * 60 * 1000) refreshInBackground();
    return;
  }

  const url = process.env.PRICING_URL;
  if (url) {
    log.info('fetching pricing', { url });
    const fetched = await fetchPricing(url);
    if (fetched) {
      currentPricing = fetched;
      writeCache(fetched);
      log.info('fetched and cached pricing', { updated: fetched.updated });
      initDone = true;
      return;
    }
    log.warn('fetch failed, using defaults');
  }

  log.info('using hardcoded defaults', { updated: DEFAULTS.updated });
  initDone = true;
}

async function refreshInBackground(): Promise<void> {
  const url = process.env.PRICING_URL;
  if (!url) return;
  try {
    const fetched = await fetchPricing(url);
    if (fetched) {
      currentPricing = fetched;
      writeCache(fetched);
      log.info('background refresh succeeded', { updated: fetched.updated });
    }
  } catch { /* silent */ }
}

// ── Public API ──

export function getPricing(): PricingData {
  return currentPricing;
}

/**
 * Detect which provider a model belongs to.
 * Extend this when adding new providers.
 */
export function detectProvider(modelName: string): string {
  const lower = modelName.toLowerCase();
  if (/claude|anthropic/.test(lower)) return 'anthropic';
  if (/deepseek/.test(lower)) return 'deepseek';
  if (/gpt|o1|o3|openai|davinci/.test(lower)) return 'openai';
  return 'anthropic'; // default fallback
}

/**
 * Map a model name to a pricing tier within its provider.
 * Falls back to the provider's defaultModel.
 */
export function detectModelTier(modelName: string): string {
  const provider = detectProvider(modelName);
  const pp = getPricing().providers[provider];
  if (!pp) return 'sonnet';

  const lower = modelName.toLowerCase();

  // Provider-specific heuristics
  switch (provider) {
    case 'anthropic':
      if (lower.includes('haiku')) return 'haiku';
      if (lower.includes('opus')) return 'opus';
      return 'sonnet';
    case 'deepseek':
      if (/r1|reasoner/.test(lower)) return 'r1';
      return 'v3';
    case 'openai':
      if (/mini/.test(lower)) return lower.includes('o3') ? 'o3-mini' : 'gpt-4o-mini';
      if (/o1/.test(lower)) return 'o1';
      if (/o3/.test(lower)) return 'o3-mini';
      return 'gpt-4o';
    default:
      // Generic: try substring match against known tiers
      for (const tier of Object.keys(pp.models)) {
        if (lower.includes(tier.toLowerCase())) return tier;
      }
      return pp.defaultModel;
  }
}

/**
 * Determine if a model is typically used as a subagent/lightweight worker.
 * Used by the frontend to split "Main" vs "Subagent" in the UI.
 */
export function isSubagentModel(modelName: string): boolean {
  const lower = modelName.toLowerCase();
  // Anthropic: Haiku is the subagent workhorse
  if (lower.includes('haiku')) return true;
  // OpenAI: mini models
  if (lower.includes('mini')) return true;
  // DeepSeek: no subagent-specific model yet
  return false;
}

/**
 * Calculate cost for a model given token counts.
 * Works for any provider that has pricing data.
 */
export function calcCost(
  modelName: string,
  inputTokens: number,
  outputTokens: number,
  cacheWrite: number,
  cacheRead: number,
): number {
  const provider = detectProvider(modelName);
  const tier = detectModelTier(modelName);
  const pp = getPricing().providers[provider];
  const p = pp?.models[tier] || pp?.models[pp.defaultModel];
  if (!p) return 0;

  const regularInput = Math.max(0, inputTokens - cacheWrite - cacheRead);
  return (
    (regularInput / 1_000_000) * p.input +
    (outputTokens / 1_000_000) * p.output +
    (cacheWrite / 1_000_000) * (p.cacheWrite || 0) +
    (cacheRead / 1_000_000) * (p.cacheRead || 0)
  );
}
