import { useState } from 'react';
import { BarChart3, Cpu, Clock, Zap, DollarSign, Layers, ChevronDown, ChevronRight } from 'lucide-react';
import { useSessionMetrics, formatTokens, formatDuration, formatCost, aggregateModels, type SessionMetricsEntry, type SessionMetricsAggregated } from '../../store/sessionMetrics';
import type { ModelUsage } from '@cc-gui/shared';

// ==================== Session Overview ====================

interface SessionOverviewProps {
  sessionId: string | null;
}

export function SessionOverview({ sessionId }: SessionOverviewProps) {
  const metrics = useSessionMetrics(s => sessionId ? s.metrics[sessionId] : undefined);

  if (!sessionId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[var(--color-text-muted)] p-6">
        <BarChart3 size={32} className="opacity-30 mb-3" />
        <p className="text-sm text-center">No active session</p>
        <p className="text-xs text-center mt-1 opacity-60">Start a conversation to see usage metrics</p>
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[var(--color-text-muted)] p-6">
        <Clock size={32} className="opacity-30 mb-3" />
        <p className="text-sm text-center">Waiting for metrics…</p>
        <p className="text-xs text-center mt-1 opacity-60">Usage data will appear after the first response</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto text-sm">
      {/* Context Window */}
      <ContextWindowSection metrics={metrics} />

      <Divider />

      {/* Session Metrics Summary */}
      <MetricsSummary metrics={metrics} />

      <Divider />

      {/* Usage Analysis */}
      <UsageAnalysis metrics={metrics} aggregated={aggregateModels(metrics.models)} />

      <Divider />

      {/* Model Details */}
      <ModelDetails models={metrics.models} />
    </div>
  );
}

// ==================== Context Window ====================

function ContextWindowSection({ metrics }: { metrics: SessionMetricsEntry }) {
  const { used, limit, percentUsed } = metrics.contextWindow;
  const pct = Math.min(percentUsed, 100);

  const barColor =
    pct > 80 ? 'bg-red-500' :
    pct > 60 ? 'bg-yellow-500' :
    'bg-green-500';

  return (
    <div className="px-3 py-3">
      <div className="flex items-center gap-1.5 mb-2">
        <Layers size={13} className="text-[var(--color-text-muted)]" />
        <span className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest">Context Window</span>
      </div>
      <div className="flex items-center gap-2 mb-1">
        <div className="flex-1 h-3 bg-[var(--color-surface-hover)] rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${barColor}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-xs font-mono font-semibold text-[var(--color-text)] w-12 text-right">
          {percentUsed}%
        </span>
      </div>
      <div className="flex justify-between text-[11px] text-[var(--color-text-muted)]">
        <span>{formatTokens(used)} tokens used</span>
        <span>limit {formatTokens(limit)}</span>
      </div>
    </div>
  );
}

// ==================== Metrics Summary ====================

function MetricsSummary({ metrics }: { metrics: SessionMetricsEntry }) {
  const totalTokens = metrics.inputTokens + metrics.outputTokens;
  const totalCost = metrics.models.reduce((s, m) => s + m.costUSD, 0);

  return (
    <div className="px-3 py-3">
      <div className="flex items-center gap-1.5 mb-2">
        <Zap size={13} className="text-[var(--color-text-muted)]" />
        <span className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest">Session Metrics</span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <Metric label="Tokens" value={formatTokens(totalTokens)} />
        <Metric label="Requests" value={String(metrics.requestCount)} />
        <Metric label="Input" value={formatTokens(metrics.inputTokens)} />
        <Metric label="Output" value={formatTokens(metrics.outputTokens)} />
        <Metric label="Runtime" value={formatDuration(metrics.totalDurationMs)} />
        <Metric label="Cost" value={formatCost(totalCost)} />
        {metrics.cacheReadInputTokens > 0 && (
          <Metric label="Cache Hit" value={formatTokens(metrics.cacheReadInputTokens)} />
        )}
        {metrics.cacheCreationInputTokens > 0 && (
          <Metric label="Cache New" value={formatTokens(metrics.cacheCreationInputTokens)} />
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wide">{label}</span>
      <span className="text-[13px] font-mono font-medium text-[var(--color-text)]">{value}</span>
    </div>
  );
}

// ==================== Usage Analysis ====================

type UsageTab = 'agent' | 'type';

function UsageAnalysis({ metrics, aggregated }: { metrics: SessionMetricsEntry; aggregated?: SessionMetricsAggregated }) {
  const [tab, setTab] = useState<UsageTab>('agent');
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="px-3 py-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Cpu size={13} className="text-[var(--color-text-muted)]" />
          <span className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest">Usage Analysis</span>
        </div>
        <button onClick={() => setExpanded(!expanded)} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-0.5 mb-3 bg-[var(--color-surface-hover)] rounded-md p-0.5">
        <button
          onClick={() => setTab('agent')}
          className={`flex-1 px-2 py-1 rounded text-[11px] font-medium transition-colors ${
            tab === 'agent' ? 'bg-[var(--color-bg)] text-[var(--color-text)] shadow-sm' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
          }`}
        >
          By Agent
        </button>
        <button
          onClick={() => setTab('type')}
          className={`flex-1 px-2 py-1 rounded text-[11px] font-medium transition-colors ${
            tab === 'type' ? 'bg-[var(--color-bg)] text-[var(--color-text)] shadow-sm' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
          }`}
        >
          By Type
        </button>
      </div>

      {expanded && (
        tab === 'agent' ? <AgentUsage aggregated={aggregated} /> : <TypeUsage metrics={metrics} />
      )}
    </div>
  );
}

function AgentUsage({ aggregated }: { aggregated?: SessionMetricsAggregated }) {
  if (!aggregated) return <p className="text-xs text-[var(--color-text-muted)]">No data</p>;

  const rows: { label: string; sub: string; data: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number; costUSD: number } }[] = [
    { label: 'Main', sub: 'Sonnet', data: aggregated.main },
    { label: 'Subagent', sub: 'Haiku', data: aggregated.subagent },
  ];

  return (
    <div>
      {/* Table header */}
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 text-[10px] text-[var(--color-text-muted)] uppercase tracking-wide mb-1 px-1">
        <span></span>
        <span className="text-right">Total</span>
        <span className="text-right">Cache</span>
        <span className="text-right">Cost</span>
      </div>

      {rows.map(row => {
        const total = row.data.inputTokens + row.data.outputTokens;
        const cache = row.data.cacheReadTokens;
        const hasAny = total > 0 || cache > 0;

        return (
          <div key={row.label} className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-1 py-1.5 border-b border-[var(--color-border)]/30 last:border-0">
            <div className="flex flex-col">
              <span className="text-xs font-medium text-[var(--color-text)]">{row.label}</span>
              <span className="text-[10px] text-[var(--color-text-muted)]">{row.sub}</span>
            </div>
            <span className="text-xs font-mono text-[var(--color-text)] text-right tabular-nums">
              {hasAny ? formatTokens(total) : '-'}
            </span>
            <span className="text-xs font-mono text-[var(--color-text-muted)] text-right tabular-nums">
              {cache > 0 ? formatTokens(cache) : '-'}
            </span>
            <span className="text-xs font-mono text-right tabular-nums" style={{ color: row.data.costUSD > 0 ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
              {row.data.costUSD > 0 ? formatCost(row.data.costUSD) : '-'}
            </span>
          </div>
        );
      })}

      {/* Total row */}
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-1 py-1.5 mt-0.5 bg-[var(--color-surface-hover)]/50 rounded">
        <span className="text-xs font-semibold text-[var(--color-text)]">Total</span>
        <span className="text-xs font-mono font-semibold text-[var(--color-text)] text-right tabular-nums">
          {formatTokens(aggregated.total.inputTokens + aggregated.total.outputTokens)}
        </span>
        <span className="text-xs font-mono text-[var(--color-text-muted)] text-right tabular-nums">
          {formatTokens(aggregated.total.cacheReadTokens)}
        </span>
        <span className="text-xs font-mono font-semibold text-accent-500 text-right tabular-nums">
          {formatCost(aggregated.total.costUSD)}
        </span>
      </div>
    </div>
  );
}

function TypeUsage({ metrics }: { metrics: SessionMetricsEntry }) {
  // Use latest turn values consistently — cumulative cache makes no sense
  const turn = metrics.lastTurn;
  const cacheRead = turn?.cacheReadInputTokens ?? 0;
  const cacheWrite = turn?.cacheCreationInputTokens ?? 0;
  const turnInput = turn?.inputTokens ?? 0;
  const turnOutput = turn?.outputTokens ?? 0;
  // Prompt = input minus cache (cache is a subset of input in Anthropic API)
  const regularInput = Math.max(0, turnInput - cacheRead - cacheWrite);

  const total = regularInput + turnOutput + cacheRead + cacheWrite;
  const maxWidth = total > 0 ? total : 1;

  const bars: { label: string; value: number; color: string; desc: string }[] = [
    { label: 'Prompt', value: regularInput, color: 'bg-blue-500', desc: 'Regular input tokens' },
    { label: 'Completion', value: turnOutput, color: 'bg-purple-500', desc: 'Generated output tokens' },
    { label: 'Cache Hit', value: cacheRead, color: 'bg-emerald-500', desc: 'Tokens read from cache' },
    { label: 'Cache Write', value: cacheWrite, color: 'bg-amber-500', desc: 'Tokens written to cache' },
  ];

  return (
    <div>
      {bars.map(bar => {
        const pct = total > 0 ? Math.round((bar.value / total) * 100) : 0;
        const barPct = Math.max((bar.value / maxWidth) * 100, pct > 0 ? 2 : 0);

        return (
          <div key={bar.label} className="mb-2 last:mb-0">
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[11px] text-[var(--color-text)]">{bar.label}</span>
              <span className="text-[11px] font-mono text-[var(--color-text-muted)] tabular-nums">
                {formatTokens(bar.value)} <span className="text-[10px]">({pct}%)</span>
              </span>
            </div>
            <div className="h-2 bg-[var(--color-surface-hover)] rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${bar.color}`}
                style={{ width: `${barPct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ==================== Model Details ====================

function ModelDetails({ models }: { models: ModelUsage[] }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="px-3 py-3">
      <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-1.5 mb-2 w-full">
        <DollarSign size={13} className="text-[var(--color-text-muted)]" />
        <span className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest">Model Details</span>
        <span className="flex-1" />
        {expanded ? <ChevronDown size={14} className="text-[var(--color-text-muted)]" /> : <ChevronRight size={14} className="text-[var(--color-text-muted)]" />}
      </button>

      {expanded && (
        <div>
          {models.length === 0 && (
            <p className="text-xs text-[var(--color-text-muted)]">No model data yet</p>
          )}
          {models.map(m => (
            <div key={m.modelName} className="mb-2 last:mb-0 p-2 bg-[var(--color-surface-hover)]/40 rounded">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-[var(--color-text)]">{m.modelName}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--color-surface-hover)] text-[var(--color-text-muted)]">
                  {m.isSubagent ? 'Subagent' : 'Main'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
                <ModelMetric label="Input" value={formatTokens(m.inputTokens)} />
                <ModelMetric label="Output" value={formatTokens(m.outputTokens)} />
                {m.cacheReadInputTokens > 0 && (
                  <ModelMetric label="Cache Read" value={formatTokens(m.cacheReadInputTokens)} />
                )}
                {m.cacheCreationInputTokens > 0 && (
                  <ModelMetric label="Cache Write" value={formatTokens(m.cacheCreationInputTokens)} />
                )}
                <ModelMetric label="Cost" value={formatCost(m.costUSD)} highlight />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ModelMetric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-[var(--color-text-muted)]">{label}</span>
      <span className={`font-mono tabular-nums ${highlight ? 'text-accent-500' : 'text-[var(--color-text)]'}`}>{value}</span>
    </div>
  );
}

// ==================== Divider ====================

function Divider() {
  return <div className="border-t border-[var(--color-border)]/50 mx-3" />;
}
