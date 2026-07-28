import type { ThinkingTool } from './types';

/** Summary generated for a thinking segment (first sentence for now, AI later) */
export function thinkingSummary(text: string): string {
  const first = text.trim().split(/[.。!！?\n]/)[0]?.trim();
  return first ? first.slice(0, 100) + (first.length > 100 ? '…' : '') : 'Thinking…';
}

/** Summary line for a tool segment when collapsed */
export function toolSummaryLine(t: ThinkingTool): string {
  const statusIcon = t.status === 'running' ? '⏳' : t.status === 'done' ? '✅' : '❌';
  const dur = t.durationMs != null ? ` (${t.durationMs < 1000 ? `${t.durationMs}ms` : `${(t.durationMs / 1000).toFixed(1)}s`})` : '';
  const detail = t.detail ? ` ${t.detail}` : '';
  let result = '';
  if (t.status !== 'running' && t.output) {
    result = ' → ' + t.output.slice(0, 60).replace(/\n/g, ' ');
  }
  return `${statusIcon} ${t.name}${detail}${result}${dur}`;
}

/** Format ISO timestamp for chat display */
export function formatChatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return time;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}

/**
 * Extract a human-readable detail string from a tool's input.
 * Used by both ChatPanel (thinking blocks) and SubagentStore (subagent tracking).
 */
export function toolInputDetail(toolName: string, toolInput: Record<string, unknown>): string {
  if (toolInput?.query) return `"${String(toolInput.query).slice(0, 60)}"`;
  if (toolInput?.url) return String(toolInput.url).slice(0, 60);
  if (Object.keys(toolInput).length > 0) return JSON.stringify(toolInput).slice(0, 80);
  return '';
}
