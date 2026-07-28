import { useState, useEffect, useCallback } from 'react';
import type { ProxyMetric } from '@cc-gui/shared';
import { Activity, Image, Zap, AlertTriangle, ArrowRight } from 'lucide-react';

const ROUTING_LABELS: Record<ProxyMetric['routing'], { icon: React.ReactNode; label: string; color: string }> = {
  direct:    { icon: <ArrowRight size={12} />, label: 'Direct',  color: 'text-emerald-400' },
  vision:    { icon: <Image size={12} />,      label: 'Vision',  color: 'text-purple-400' },
  stripped:  { icon: <AlertTriangle size={12} />, label: 'No vision', color: 'text-amber-400' },
  error:     { icon: <AlertTriangle size={12} />, label: 'Error', color: 'text-red-400' },
};

export function ProxyMetricsPanel() {
  const [metrics, setMetrics] = useState<ProxyMetric[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [visible, setVisible] = useState(false);

  const fetchMetrics = useCallback(async () => {
    try {
      const res = await fetch('/api/proxy/metrics?limit=20');
      if (res.ok) {
        const data = await res.json();
        setMetrics(data);
        if (data.length > 0) setVisible(true);
      }
    } catch { /* proxy might not be running */ }
  }, []);

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 3000);
    return () => clearInterval(interval);
  }, [fetchMetrics]);

  if (!visible) return null;

  const latest = metrics[0];
  const directCount = metrics.filter(m => m.routing === 'direct').length;
  const visionCount = metrics.filter(m => m.routing === 'vision').length;
  const errorCount = metrics.filter(m => m.routing === 'error' || m.statusCode >= 400).length;

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {expanded ? (
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-2xl w-80 max-h-96 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg)]/50">
            <div className="flex items-center gap-2">
              <Activity size={13} className="text-accent-500" />
              <span className="text-[11px] font-semibold text-[var(--color-text)]">Proxy Metrics</span>
              {latest && (
                <span className={`text-[10px] ${latest.statusCode < 400 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {latest.statusCode < 400 ? '● Live' : '● Error'}
                </span>
              )}
            </div>
            <button
              onClick={() => setExpanded(false)}
              className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] text-[10px]"
            >
              −
            </button>
          </div>

          {/* Summary bar */}
          <div className="flex gap-3 px-3 py-2 text-[10px] border-b border-[var(--color-border)]/50">
            <span className="text-[var(--color-text-muted)]">
              <ArrowRight size={10} className="inline mr-1" />
              {directCount} direct
            </span>
            <span className="text-purple-400">
              <Image size={10} className="inline mr-1" />
              {visionCount} vision
            </span>
            {errorCount > 0 && (
              <span className="text-red-400">
                <AlertTriangle size={10} className="inline mr-1" />
                {errorCount} errors
              </span>
            )}
          </div>

          {/* Request list */}
          <div className="flex-1 overflow-y-auto">
            {metrics.slice(0, 15).map((m) => {
              const style = ROUTING_LABELS[m.routing];
              return (
                <div
                  key={m.id}
                  className="px-3 py-1.5 border-b border-[var(--color-border)]/30 hover:bg-[var(--color-surface-hover)]/50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className={style.color}>{style.icon}</span>
                    <span className={`text-[10px] font-medium ${style.color}`}>{style.label}</span>
                    <span className="text-[10px] text-[var(--color-text-muted)] ml-auto">
                      {m.statusCode} · {m.totalMs}ms
                    </span>
                  </div>
                  <div className="flex gap-2 mt-0.5 text-[9px] text-[var(--color-text-muted)]/70">
                    <span>{m.provider}/{m.model}</span>
                    {m.imageCount > 0 && <span>· {m.imageCount} img</span>}
                    {m.ttfbMs > 0 && <span>· ttfb {m.ttfbMs}ms</span>}
                    <span>· {(m.bodySize / 1024).toFixed(0)}KB</span>
                  </div>
                  {m.error && (
                    <div className="text-[9px] text-red-400 mt-0.5 truncate">{m.error}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* Collapsed badge */
        <button
          onClick={() => setExpanded(true)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-full shadow-lg hover:shadow-xl transition-all hover:scale-105"
        >
          <Activity size={12} className="text-accent-500" />
          <span className="text-[10px] font-medium text-[var(--color-text)]">
            {metrics.length > 0
              ? `${directCount + visionCount} req · ${visionCount} img`
              : 'Loading...'}
          </span>
          {latest && (
            <span className={`w-1.5 h-1.5 rounded-full ${latest.statusCode < 400 ? 'bg-emerald-400' : 'bg-red-400'}`} />
          )}
        </button>
      )}
    </div>
  );
}
