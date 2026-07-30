import { useState, useMemo } from 'react';

interface InlineDiffProps {
  diff: string;
  maxLines?: number;
}

export function InlineDiff({ diff, maxLines = 30 }: InlineDiffProps) {
  const lines = useMemo(() => diff.split('\n'), [diff]);
  const [expanded, setExpanded] = useState(false);
  const collapsed = lines.length > maxLines;
  const displayLines = collapsed && !expanded ? lines.slice(0, maxLines) : lines;

  return (
    <div className="rounded border border-slate-200 dark:border-slate-700 overflow-hidden text-xs">
      <div className="max-h-[300px] overflow-auto bg-white dark:bg-[#0d1117]">
        {displayLines.map((line, i) => {
          let cls = 'px-2 whitespace-pre font-mono text-[11px] leading-relaxed';
          if (line.startsWith('@@')) cls += ' text-cyan-500 bg-cyan-500/5';
          else if (line.startsWith('+')) cls += ' text-green-500 bg-green-500/5';
          else if (line.startsWith('-')) cls += ' text-red-500 bg-red-500/5';
          else if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++'))
            cls += ' text-[var(--color-text-muted)] font-bold';
          else cls += ' text-[var(--color-text-secondary)]';
          return <div key={i} className={cls}>{line || ' '}</div>;
        })}
      </div>
      {collapsed && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full px-3 py-1 text-[11px] text-slate-500 hover:text-accent-600 dark:hover:text-accent-400 bg-slate-50 dark:bg-slate-800/30 hover:bg-slate-100 dark:hover:bg-slate-800/50 transition-colors border-t border-slate-200 dark:border-slate-700"
        >
          {expanded ? 'Show less' : `Show all ${lines.length} lines`}
        </button>
      )}
    </div>
  );
}
