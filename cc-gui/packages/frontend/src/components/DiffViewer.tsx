import { useState, useEffect } from 'react';

interface DiffViewerProps {
  workDir: string | null;
  file: string;
  staged: boolean;
}

export function DiffViewer({ workDir, file, staged }: DiffViewerProps) {
  const [diff, setDiff] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workDir) return;
    setLoading(true);
    fetch(`/api/git/diff?base=${encodeURIComponent(workDir)}&file=${encodeURIComponent(file)}&staged=${staged}`)
      .then(r => r.json())
      .then(data => setDiff(data.diff || 'No changes'))
      .catch(() => setDiff('Error loading diff'))
      .finally(() => setLoading(false));
  }, [workDir, file, staged]);

  if (loading) return <div className="p-4 text-[var(--color-text-muted)] text-sm">Loading diff...</div>;

  return (
    <div className="flex-1 overflow-auto font-mono text-[13px] leading-relaxed">
      {diff.split('\n').map((line, i) => {
        let className = 'px-2 whitespace-pre';
        if (line.startsWith('@@')) className += ' text-cyan-500 bg-cyan-500/5';
        else if (line.startsWith('+')) className += ' text-green-500 bg-green-500/5';
        else if (line.startsWith('-')) className += ' text-red-500 bg-red-500/5';
        else if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) className += ' text-[var(--color-text-muted)] font-bold';
        else className += ' text-[var(--color-text-secondary)]';
        return <div key={i} className={className}>{line || ' '}</div>;
      })}
    </div>
  );
}
