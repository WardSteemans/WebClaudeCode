import { useEventBus, ActivityEntry } from '../store/eventBus';
import { Wrench, FileText, Terminal, Shield, Check, X, Loader, ChevronDown } from 'lucide-react';
import { useState } from 'react';

function entryIcon(entry: ActivityEntry) {
  const cls = 'shrink-0';
  switch (entry.kind) {
    case 'tool': {
      if (entry.success === undefined) return <Loader size={12} className={`${cls} animate-spin text-accent-400`} />;
      return entry.success ? <Check size={12} className={`${cls} text-green-500`} /> : <X size={12} className={`${cls} text-red-500`} />;
    }
    case 'file:read': return <FileText size={12} className={`${cls} text-blue-400`} />;
    case 'file:changed': return <FileText size={12} className={`${cls} text-amber-400`} />;
    case 'command': return <Terminal size={12} className={`${cls} text-purple-400`} />;
    case 'permission': return <Shield size={12} className={`${cls} text-orange-400`} />;
    default: return <Wrench size={12} className={`${cls} text-slate-400`} />;
  }
}

export function ActivityTimeline() {
  const activityLog = useEventBus((s) => s.activityLog);
  const [expanded, setExpanded] = useState(false);
  const clearActivity = useEventBus((s) => s.clearActivity);

  const visible = expanded ? activityLog : activityLog.slice(0, 3);

  if (activityLog.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-[11px] text-[var(--color-text-muted)] p-2">
        No activity yet
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-[10px] text-[var(--color-text-muted)]">{activityLog.length} entries</span>
        <button onClick={clearActivity} className="text-[10px] text-[var(--color-text-muted)] hover:text-red-500">clear</button>
      </div>
      {visible.map((entry) => (
        <div key={entry.id} className="flex items-start gap-1.5 px-2 py-1 hover:bg-[var(--color-surface-hover)] transition-colors text-[11px] cursor-default" title={entry.detail}>
          {entryIcon(entry)}
          <span className="text-[var(--color-text-secondary)] truncate flex-1">{entry.label}</span>
        </div>
      ))}
      {activityLog.length > 3 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full text-[11px] text-accent-500 hover:text-accent-400 py-1 flex items-center justify-center gap-1"
        >
          <ChevronDown size={12} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
          {expanded ? 'Show less' : `Show ${activityLog.length - 3} more`}
        </button>
      )}
    </div>
  );
}
