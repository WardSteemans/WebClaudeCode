// ── Formatting helpers ──
// Used by frontend SessionOverview panel and potentially backend logging/display.

import type { ModelUsage } from '../events';

/** Format a duration in milliseconds to a human-readable string */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const s = sec % 60;
  return `${min}m ${s}s`;
}

/** Format a token count to a human-readable string */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** Format a USD cost to a human-readable string */
export function formatCost(usd: number): string {
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `${(usd * 100).toFixed(1)}¢`;
  return `<0.01¢`;
}

/** Sum total cost across all model usages */
export function totalCost(models: ModelUsage[]): number {
  return models.reduce((sum, m) => sum + m.costUSD, 0);
}
