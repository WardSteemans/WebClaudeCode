import { useState, useEffect, useCallback } from 'react';
import { Folder, FolderOpen, File, ChevronRight, Loader2 } from 'lucide-react';

interface FsEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
}

interface FileExplorerProps {
  workDir: string | null;
  onSelectFile: (path: string) => void;
  selectedFile: string | null;
}

export function FileExplorer({ workDir, onSelectFile, selectedFile }: FileExplorerProps) {
  const [rootEntries, setRootEntries] = useState<FsEntry[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [children, setChildren] = useState<Map<string, FsEntry[]>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!workDir) return;
    setLoading(true);
    fetch(`/api/fs/list?dir=${encodeURIComponent(workDir)}&base=${encodeURIComponent(workDir)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setRootEntries(data.entries || []);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [workDir]);

  const toggleDir = useCallback(async (dirPath: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) {
        next.delete(dirPath);
        return next;
      }
      if (!children.has(dirPath)) {
        fetch(`/api/fs/list?dir=${encodeURIComponent(dirPath)}&base=${encodeURIComponent(workDir!)}`)
          .then((r) => r.json())
          .then((data) => {
            if (!data.error) {
              setChildren((prev) => new Map(prev).set(dirPath, data.entries || []));
            }
          })
          .catch((err) => { console.warn('Failed to load file tree', err); });
      }
      next.add(dirPath);
      return next;
    });
  }, [workDir, children]);

  const renderEntry = (entry: FsEntry, depth: number) => {
    const isExpanded = expandedDirs.has(entry.path);
    const isSelected = entry.path === selectedFile;
    const isDir = entry.type === 'directory';
    const kids = children.get(entry.path);

    return (
      <div key={entry.path}>
        <div
          onClick={() => isDir ? toggleDir(entry.path) : onSelectFile(entry.path)}
          className={`flex items-center gap-1.5 pr-2 py-0.5 cursor-pointer text-[13px] transition-colors group border-l-2 ${
            isSelected
              ? 'bg-accent-600/20 text-accent-600 dark:text-accent-300 border-accent-500'
              : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] border-transparent'
          }`}
          style={{ paddingLeft: `${depth * 14 + 8}px` }}
        >
          {isDir ? (
            <ChevronRight
              size={12}
              className={`shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''} ${isSelected ? 'text-accent-500' : 'text-[var(--color-text-muted)]'}`}
            />
          ) : (
            <span className="w-3 shrink-0" />
          )}
          {isDir ? (
            isExpanded
              ? <FolderOpen size={15} className="shrink-0 text-amber-600/80" />
              : <Folder size={15} className="shrink-0 text-amber-600/60" />
          ) : (
            <File size={15} className="shrink-0 text-slate-500" />
          )}
          <span className="truncate">{entry.name}</span>
          {!isDir && entry.size != null && (
            <span className="text-[11px] text-[var(--color-text-muted)] ml-auto shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              {formatSize(entry.size)}
            </span>
          )}
        </div>
        {isDir && isExpanded && kids && (
          <div>{kids.map((child) => renderEntry(child, depth + 1))}</div>
        )}
      </div>
    );
  };

  if (!workDir) return <div className="p-4 text-[var(--color-text-muted)] text-sm text-center">No project open</div>;

  return (
    <div className="overflow-y-auto flex-1 py-1">
      {loading && (
        <div className="flex items-center justify-center gap-2 py-4 text-[var(--color-text-muted)] text-sm">
          <Loader2 size={14} className="animate-spin text-[var(--color-text-muted)]" />
          Loading...
        </div>
      )}
      {error && <div className="p-3 text-red-400 text-sm">{error}</div>}
      {!loading && !error && rootEntries.map((entry) => renderEntry(entry, 0))}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
