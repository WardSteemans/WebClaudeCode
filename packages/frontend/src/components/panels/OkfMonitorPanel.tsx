import { useState, useEffect, useCallback } from 'react';
import type { OkfStatus, OkfFileEntry } from '@cc-gui/shared';
import { Database, RefreshCw, FileCode, Clock, Hash, Box, Layers } from 'lucide-react';

const ENTITY_COLORS: Record<string, string> = {
  class: 'text-amber-400',
  interface: 'text-purple-400',
  enum: 'text-emerald-400',
  function: 'text-blue-400',
  module: 'text-cyan-400',
};

const ENTITY_BG: Record<string, string> = {
  class: 'bg-amber-400/10',
  interface: 'bg-purple-400/10',
  enum: 'bg-emerald-400/10',
  function: 'bg-blue-400/10',
  module: 'bg-cyan-400/10',
};

function formatAge(seconds: number): string {
  if (seconds < 2) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function ageColor(seconds: number): string {
  if (seconds < 10) return 'text-emerald-400';
  if (seconds < 60) return 'text-amber-400';
  return 'text-[var(--color-text-muted)]';
}

export function OkfMonitorPanel() {
  const [status, setStatus] = useState<OkfStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/okf/status');
      if (res.ok) {
        const data: OkfStatus = await res.json();
        setStatus(data);
        setError(null);
      } else {
        setError(`API error: ${res.status}`);
      }
    } catch {
      setError('Backend unreachable');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // ── Loading state ──
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--color-text-muted)]">
        <RefreshCw size={16} className="animate-spin mr-2" />
        <span className="text-xs">Loading compiled memory...</span>
      </div>
    );
  }

  // ── Error state ──
  if (error || !status) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-4 text-[var(--color-text-muted)]">
        <Database size={28} className="opacity-30" />
        <p className="text-xs text-center">{error || 'No data available'}</p>
        <button onClick={fetchStatus} className="px-3 py-1.5 text-xs bg-accent-600 hover:bg-accent-500 text-white rounded-md transition-colors">
          Retry
        </button>
      </div>
    );
  }

  // ── Empty state ──
  if (status.totalFiles === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-4">
        <Database size={28} className="text-[var(--color-text-muted)] opacity-30" />
        <p className="text-xs text-[var(--color-text-muted)] text-center">
          No compiled memory yet.
        </p>
        <p className="text-[10px] text-[var(--color-text-muted)]/60 text-center">
          Save a TypeScript file to trigger generation,<br />
          or wait for the watcher to seed the cache.
        </p>
        <div className="flex items-center gap-2 mt-1">
          <span className={`w-2 h-2 rounded-full ${status.watcherActive ? 'bg-emerald-400' : 'bg-gray-500'}`} />
          <span className="text-[10px] text-[var(--color-text-muted)]">
            Watcher: {status.watcherActive ? 'Active' : 'Inactive'}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Stats bar */}
      <div className="px-3 py-2.5 border-b border-[var(--color-border)] shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <span className={`w-2 h-2 rounded-full ${status.watcherActive ? 'bg-emerald-400 animate-pulse' : 'bg-gray-500'}`} />
          <span className="text-[10px] font-medium text-[var(--color-text)]">
            {status.watcherActive ? 'Watcher active' : 'Watcher stopped'}
          </span>
          <button
            onClick={fetchStatus}
            className="ml-auto p-1 rounded text-[var(--color-text-muted)] hover:text-accent-500 hover:bg-accent-500/10 transition-colors"
            title="Refresh"
          >
            <RefreshCw size={12} />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <StatBadge icon={<Box size={10} />} label="Entities" value={status.totalEntities} />
          <StatBadge icon={<FileCode size={10} />} label="Files" value={status.totalFiles} />
          <StatBadge
            icon={<Clock size={10} />}
            label="Oldest"
            value={status.oldestAgeSeconds != null ? formatAge(status.oldestAgeSeconds) : '—'}
          />
        </div>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto">
        {status.files.map((entry) => (
          <OkfFileRow key={entry.cacheFile} entry={entry} />
        ))}
      </div>

      {/* Footer */}
      <div className="px-3 py-1.5 border-t border-[var(--color-border)] shrink-0 flex items-center justify-between text-[9px] text-[var(--color-text-muted)]/50">
        <span title={status.projectRoot}>{truncatePath(status.projectRoot, 40)}</span>
        <span>updated {formatAge(Math.round((Date.now() - new Date(status.generatedAt).getTime()) / 1000))}</span>
      </div>
    </div>
  );
}

function StatBadge({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)]/50">
      <span className="text-[var(--color-text-muted)]">{icon}</span>
      <span className="text-[10px] text-[var(--color-text-muted)]">{label}</span>
      <span className="text-[11px] font-semibold text-[var(--color-text)] ml-auto">{value}</span>
    </div>
  );
}

function OkfFileRow({ entry }: { entry: OkfFileEntry }) {
  const colorClass = ENTITY_COLORS[entry.type] || 'text-[var(--color-text-muted)]';
  const bgClass = ENTITY_BG[entry.type] || 'bg-[var(--color-bg)]';

  return (
    <div className="px-3 py-2 border-b border-[var(--color-border)]/30 hover:bg-[var(--color-surface-hover)]/30 transition-colors">
      <div className="flex items-center gap-2">
        <span className={`text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded ${bgClass} ${colorClass}`}>
          {entry.type}
        </span>
        <span className="text-xs font-medium text-[var(--color-text)] truncate">{entry.entityName}</span>
        <span className={`ml-auto text-[10px] ${ageColor(entry.ageSeconds)} shrink-0`}>
          {formatAge(entry.ageSeconds)}
        </span>
      </div>
      <div className="flex items-center gap-3 mt-1">
        <span className="text-[10px] text-[var(--color-text-muted)]/60 truncate" title={entry.sourceFile}>
          {entry.sourceFile}
        </span>
        {entry.exportCount > 0 && (
          <span className="text-[9px] text-[var(--color-text-muted)]/50 shrink-0 flex items-center gap-0.5">
            <Hash size={9} />{entry.exportCount}
          </span>
        )}
        {entry.dependencyCount > 0 && (
          <span className="text-[9px] text-[var(--color-text-muted)]/50 shrink-0 flex items-center gap-0.5">
            <Layers size={9} />{entry.dependencyCount}
          </span>
        )}
      </div>
    </div>
  );
}

function truncatePath(path: string, maxLen: number): string {
  if (path.length <= maxLen) return path;
  const parts = path.replace(/\\/g, '/').split('/');
  // Keep first and last parts, trim middle
  let result = parts[0];
  for (let i = 1; i < parts.length; i++) {
    const candidate = result + '/' + parts[i];
    if (candidate.length > maxLen - 4) {
      return result + '/...';
    }
    result = candidate;
  }
  return result;
}
