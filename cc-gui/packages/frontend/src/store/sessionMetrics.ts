import { create } from 'zustand';
import type { ModelUsage } from '@cc-gui/shared';

// ==================== Types ====================

export interface TurnMetrics {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  durationMs: number;
  modelUsage: ModelUsage[];
}

export interface SessionMetricsEntry {
  sessionId: string;
  /** Cumulative totals */
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  /** Per-model cumulative breakdown */
  models: ModelUsage[];
  /** Total requests/turns */
  requestCount: number;
  /** Total wall-clock duration */
  totalDurationMs: number;
  /** Latest turn snapshot */
  lastTurn: TurnMetrics;
  /** Context window estimate */
  contextWindow: {
    used: number;
    limit: number;
    percentUsed: number;
  };
  /** Runtime */
  firstEventAt: string;
  lastEventAt: string;
}

// ==================== Helpers ====================

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const s = sec % 60;
  return `${min}m ${s}s`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatCost(usd: number): string {
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `${(usd * 100).toFixed(1)}¢`;
  return `<0.01¢`;
}

function totalCost(models: ModelUsage[]): number {
  return models.reduce((sum, m) => sum + m.costUSD, 0);
}

// ==================== Aggregation ====================

export interface SessionMetricsAggregated {
  /** Main agent totals (non-subagent models) */
  main: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    costUSD: number;
  };
  /** Subagent totals */
  subagent: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    costUSD: number;
  };
  /** Grand total */
  total: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    costUSD: number;
  };
}

function aggregateModels(models: ModelUsage[]): SessionMetricsAggregated {
  const main = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUSD: 0 };
  const sub = { ...main };

  for (const m of models) {
    const target = m.isSubagent ? sub : main;
    target.inputTokens += m.inputTokens;
    target.outputTokens += m.outputTokens;
    target.cacheReadTokens += m.cacheReadInputTokens;
    target.cacheCreationTokens += m.cacheCreationInputTokens;
    target.costUSD += m.costUSD;
  }

  return {
    main,
    subagent: sub,
    total: {
      inputTokens: main.inputTokens + sub.inputTokens,
      outputTokens: main.outputTokens + sub.outputTokens,
      cacheReadTokens: main.cacheReadTokens + sub.cacheReadTokens,
      cacheCreationTokens: main.cacheCreationTokens + sub.cacheCreationTokens,
      costUSD: main.costUSD + sub.costUSD,
    },
  };
}

// ==================== Store ====================

interface SessionMetricsState {
  /** All session metrics keyed by sessionId */
  metrics: Record<string, SessionMetricsEntry>;
  /** Active session ID (set by the UI) */
  activeSessionId: string | null;

  /** Push a usage event to update metrics */
  pushUsage: (sessionId: string, data: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
    models: ModelUsage[];
    requestCount: number;
    totalDurationMs: number;
    turn: TurnMetrics;
    contextWindow: { used: number; limit: number; percentUsed: number };
  }) => void;

  /** Get metrics for a specific session */
  getMetrics: (sessionId: string) => SessionMetricsEntry | undefined;

  /** Get aggregated main/subagent/total breakdown */
  getAggregated: (sessionId: string) => SessionMetricsAggregated | undefined;

  /** Set active session */
  setActiveSession: (sessionId: string | null) => void;

  /** Clear all metrics */
  clear: () => void;

  /** Hydrate metrics from backend DB on startup */
  loadMetricsFromDb: () => Promise<void>;
}

export const useSessionMetrics = create<SessionMetricsState>((set, get) => ({
  metrics: {},
  activeSessionId: null,

  pushUsage: (sessionId, data) => {
    const now = new Date().toISOString();
    const entry: SessionMetricsEntry = {
      sessionId,
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
      cacheCreationInputTokens: data.cacheCreationInputTokens,
      cacheReadInputTokens: data.cacheReadInputTokens,
      models: data.models,
      requestCount: data.requestCount,
      totalDurationMs: data.totalDurationMs,
      lastTurn: data.turn,
      contextWindow: data.contextWindow,
      firstEventAt: now,
      lastEventAt: now,
    };
    set(s => {
      const existing = s.metrics[sessionId];
      return {
        metrics: {
          ...s.metrics,
          [sessionId]: { ...entry, firstEventAt: existing?.firstEventAt || now },
        },
      };
    });

    // Persist to SQLite
    saveMetricsToDb(sessionId, entry);
  },

  getMetrics: (sessionId) => get().metrics[sessionId],

  getAggregated: (sessionId) => {
    const m = get().metrics[sessionId];
    if (!m) return undefined;
    return aggregateModels(m.models);
  },

  setActiveSession: (sessionId) => set({ activeSessionId: sessionId }),

  clear: () => set({ metrics: {}, activeSessionId: null }),

  loadMetricsFromDb: async () => {
    try {
      const res = await fetch('/api/metrics');
      if (!res.ok) return;
      const data: Array<{ sessionId: string; data: SessionMetricsEntry }> = await res.json();
      const metrics: Record<string, SessionMetricsEntry> = {};
      for (const row of data) {
        metrics[row.sessionId] = row.data;
      }
      set({ metrics });
    } catch { /* silently fail — metrics are non-critical */ }
  },
}));

// ==================== DB Persistence ====================

let metricsSaveTimer: ReturnType<typeof setTimeout> | null = null;

function saveMetricsToDb(sessionId: string, entry: SessionMetricsEntry) {
  if (metricsSaveTimer) clearTimeout(metricsSaveTimer);
  metricsSaveTimer = setTimeout(() => {
    fetch('/api/metrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, data: entry }),
    }).catch(() => {});
  }, 500);
}

// ==================== Re-export helpers ====================
export { formatDuration, formatTokens, formatCost, totalCost, aggregateModels };
