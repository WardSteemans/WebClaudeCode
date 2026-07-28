import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { GitBranch, GitCommit, ArrowUp, ArrowDown, RefreshCw, Plus, Minus, ChevronDown, ChevronRight, Folder, File } from 'lucide-react';
import { DiffViewer } from './DiffViewer';

interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  changes: { file: string; status: string; staged: boolean; added: number; deleted: number }[];
  clean: boolean;
}

interface GitPanelProps {
  workDir: string | null;
}

export function GitPanel({ workDir }: GitPanelProps) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [log, setLog] = useState<{ hash: string; message: string; author: string; date: string }[]>([]);
  const [branches, setBranches] = useState<{ name: string; current: boolean }[]>([]);
  const [message, setMessage] = useState('');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [stagedDiff, setStagedDiff] = useState(false);
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState('');
  const [view, setView] = useState<'changes' | 'log'>('changes');

  const fetchStatus = useCallback(async () => {
    if (!workDir) return;
    setLoading(true);
    try {
      const base = encodeURIComponent(workDir);
      const [s, l, b] = await Promise.all([
        fetch(`/api/git/status?base=${base}`).then(r => r.json()),
        fetch(`/api/git/log?base=${base}&limit=20`).then(r => r.json()),
        fetch(`/api/git/branches?base=${base}`).then(r => r.json()),
      ]);
      setStatus(s);
      setLog(Array.isArray(l) ? l : []);
      setBranches(Array.isArray(b) ? b : []);
    } catch { /* not a git repo */ }
    setLoading(false);
  }, [workDir]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  // Auto-refresh every 10s while panel is open
  useEffect(() => {
    if (!workDir) return;
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const run = async (fn: () => Promise<Response>) => {
    setOutput('');
    const r = await fn();
    const data = await r.json();
    setOutput(data.output || data.error || 'OK');
    await fetchStatus();
  };

  // Hooks must be before any conditional returns
  const stagedChanges = useMemo(() => status ? status.changes.filter(c => c.staged) : [], [status]);
  const unstagedChanges = useMemo(() => status ? status.changes.filter(c => !c.staged) : [], [status]);
  const stagedTree = useMemo(() => buildTree(stagedChanges), [stagedChanges]);
  const unstagedTree = useMemo(() => buildTree(unstagedChanges), [unstagedChanges]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  // Preserve expanded state across panel closes (ref survives unmount)
  const expandedRef = useRef(expandedFolders);
  expandedRef.current = expandedFolders;
  // Restore on mount
  const savedExpanded = useRef<Set<string> | null>(null);
  if (!savedExpanded.current) savedExpanded.current = new Set();
  // Sync: if current expansion is empty, restore from saved; otherwise update saved
  const expanded = expandedFolders.size > 0 ? expandedFolders : savedExpanded.current;
  useEffect(() => {
    if (expandedFolders.size > 0) savedExpanded.current = expandedFolders;
  }, [expandedFolders]);

  const totalAdded = useMemo(() => status ? status.changes.reduce((s, c) => s + c.added, 0) : 0, [status]);
  const totalDeleted = useMemo(() => status ? status.changes.reduce((s, c) => s + c.deleted, 0) : 0, [status]);

  const statusLabel = (s: string) => {
    switch (s) {
      case 'm': case 'modified': return 'M';
      case 'a': return 'A';
      case 'd': return 'D';
      case 'untracked': return '?';
      default: return s[0]?.toUpperCase() || '?';
    }
  };
  const statusColor = (s: string) => {
    switch (s) {
      case 'm': case 'modified': return 'text-amber-500';
      case 'a': return 'text-green-500';
      case 'd': return 'text-red-500';
      case 'untracked': return 'text-green-400';
      default: return 'text-[var(--color-text-muted)]';
    }
  };

  if (!workDir) return <div className="p-4 text-[var(--color-text-muted)] text-sm">No project open</div>;
  if (!status) return <div className="p-4 text-[var(--color-text-muted)] text-sm">{loading ? 'Loading...' : 'Not a git repository'}</div>;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Branch bar */}
      <div className="px-3 py-2 border-b border-[var(--color-border)] shrink-0 space-y-1.5">
        <div className="flex items-center gap-2">
          <GitBranch size={14} className="text-[var(--color-text-muted)]" />
          <span className="text-sm font-medium text-[var(--color-text)]">{status.branch}</span>
          {status.ahead > 0 && <span className="text-[11px] text-green-500 flex items-center gap-0.5"><ArrowUp size={10} />{status.ahead}</span>}
          {status.behind > 0 && <span className="text-[11px] text-amber-500 flex items-center gap-0.5"><ArrowDown size={10} />{status.behind}</span>}
        </div>
        <div className="flex gap-1 flex-wrap">
          <button onClick={() => run(() => fetch(`/api/git/fetch?base=${encodeURIComponent(workDir)}`, { method: 'POST' }))} className="px-2 py-0.5 text-[11px] bg-[var(--color-input-bg)] border border-[var(--color-border)] rounded hover:border-accent-500 transition-colors text-[var(--color-text-secondary)]">Fetch</button>
          <button onClick={() => run(() => fetch(`/api/git/pull?base=${encodeURIComponent(workDir)}`, { method: 'POST' }))} className="px-2 py-0.5 text-[11px] bg-[var(--color-input-bg)] border border-[var(--color-border)] rounded hover:border-accent-500 transition-colors text-[var(--color-text-secondary)]">Pull</button>
          <button onClick={() => run(() => fetch(`/api/git/push?base=${encodeURIComponent(workDir)}`, { method: 'POST' }))} className="px-2 py-0.5 text-[11px] bg-[var(--color-input-bg)] border border-[var(--color-border)] rounded hover:border-accent-500 transition-colors text-[var(--color-text-secondary)]">Push</button>
          <button onClick={fetchStatus} className="px-2 py-0.5 text-[11px] bg-[var(--color-input-bg)] border border-[var(--color-border)] rounded hover:border-accent-500 transition-colors text-[var(--color-text-muted)]"><RefreshCw size={11} /></button>
        </div>
      </div>

      {/* View toggle */}
      <div className="flex border-b border-[var(--color-border)] shrink-0">
        <button onClick={() => setView('changes')} className={`flex-1 py-1.5 text-[12px] font-medium transition-colors flex items-center justify-center gap-1.5 ${view === 'changes' ? 'text-accent-500 border-b-2 border-accent-500' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}>
          Changes
          {status.changes.length > 0 && (
            <span className={`text-[10px] px-1 py-0.5 rounded-full ${view === 'changes' ? 'bg-accent-500/20 text-accent-400' : 'bg-[var(--color-input-bg)] text-[var(--color-text-muted)]'}`}>
              {status.changes.length}
            </span>
          )}
        </button>
        <button onClick={() => setView('log')} className={`flex-1 py-1.5 text-[12px] font-medium transition-colors ${view === 'log' ? 'text-accent-500 border-b-2 border-accent-500' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}>History</button>
      </div>

      {/* Output */}
      {output && (
        <div className="px-3 py-1.5 border-b border-[var(--color-border)] shrink-0 text-[12px] text-[var(--color-text-secondary)] font-mono whitespace-pre-wrap max-h-24 overflow-auto">{output}</div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {view === 'changes' ? (
          <>
            {/* Staged changes */}
            {stagedTree.length > 0 && (
              <div>
                <div className="px-3 py-1.5 text-[11px] font-semibold text-[var(--color-text-muted)] uppercase flex items-center gap-1">
                  Staged
                  <span className="text-[10px] bg-[var(--color-input-bg)] px-1.5 py-0.5 rounded-full">{stagedChanges.length}</span>
                </div>
                {renderTree(stagedTree, 0, expanded, setExpandedFolders, {
                  workDir, selectedFile, setSelectedFile, setStagedDiff, run,
                  isStaged: true, statusColor, statusLabel
                })}
              </div>
            )}

            {/* Unstaged changes */}
            {unstagedTree.length > 0 && (
              <div>
                <div className="px-3 py-1.5 text-[11px] font-semibold text-[var(--color-text-muted)] uppercase flex items-center gap-1">
                  Changes
                  <span className="text-[10px] bg-[var(--color-input-bg)] px-1.5 py-0.5 rounded-full">{unstagedChanges.length}</span>
                </div>
                {renderTree(unstagedTree, 0, expanded, setExpandedFolders, {
                  workDir, selectedFile, setSelectedFile, setStagedDiff, run,
                  isStaged: false, statusColor, statusLabel
                })}
              </div>
            )}

            {status.clean && (
              <div className="p-4 text-center text-[var(--color-text-muted)] text-sm">Nothing to commit, working tree clean</div>
            )}
          </>
        ) : (
          /* Commit log */
          <div>
            {log.map((entry) => (
              <div key={entry.hash} className="px-3 py-1.5 border-b border-[var(--color-border)] last:border-0">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono text-accent-500">{entry.hash}</span>
                  <span className="text-[13px] text-[var(--color-text)] truncate">{entry.message}</span>
                </div>
                <div className="text-[11px] text-[var(--color-text-muted)] mt-0.5">{entry.author} · {entry.date}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Summary + Commit input */}
      <div className="p-2 border-t border-[var(--color-border)] shrink-0 space-y-1.5">
        <div className="text-[11px] text-[var(--color-text-muted)] flex gap-2">
          <span>{status.changes.length} file{status.changes.length !== 1 ? 's' : ''}</span>
          <span className="text-green-500">+{totalAdded}</span>
          <span className="text-red-500">−{totalDeleted}</span>
          {stagedChanges.length > 0 && <span>◆{stagedChanges.length} staged</span>}
        </div>
        <div className="flex gap-1.5">
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Commit message..."
          className="flex-1 px-2 py-1.5 text-[12px] bg-[var(--color-input-bg)] border border-[var(--color-border)] rounded text-[var(--color-text)] focus:outline-none focus:border-accent-500 transition-colors placeholder-[var(--color-text-muted)]"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              run(() => fetch(`/api/git/commit?base=${encodeURIComponent(workDir)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }) }));
              setMessage('');
            }
          }}
        />
        <button
          onClick={() => { run(() => fetch(`/api/git/commit?base=${encodeURIComponent(workDir)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }) })); setMessage(''); }}
          disabled={!message.trim()}
          className="px-3 py-1.5 text-[12px] bg-accent-600 hover:bg-accent-500 disabled:bg-[var(--color-input-bg)] disabled:text-[var(--color-text-muted)] text-white rounded transition-colors flex items-center gap-1"
        >
          <GitCommit size={12} /> Commit
        </button>
        </div>
      </div>

      {/* Diff viewer overlay */}
      {selectedFile && (
        <div className="absolute inset-0 z-20 bg-[var(--color-bg)] flex flex-col">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-surface)] shrink-0">
            <span className="text-[13px] text-[var(--color-text)]">{selectedFile}</span>
            <button onClick={() => setSelectedFile(null)} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]">✕</button>
          </div>
          <DiffViewer workDir={workDir} file={selectedFile} staged={stagedDiff} />
        </div>
      )}
    </div>
  );
}

// ---- Tree helpers ----

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: TreeNode[];
  file?: { file: string; status: string; staged: boolean; added: number; deleted: number };
}

// Find the common directory prefix to trim from display
function findCommonRoot(files: { file: string }[]): string {
  if (files.length <= 1) return '';
  const parts = files.map(f => f.file.split('/'));
  let i = 0;
  while (i < parts[0].length - 1) {
    const seg = parts[0][i];
    if (parts.every(p => p[i] === seg)) i++;
    else break;
  }
  return parts[0].slice(0, i).join('/') + (i > 0 ? '/' : '');
}

function buildTree(changes: { file: string; status: string; staged: boolean; added: number; deleted: number }[]): TreeNode[] {
  const commonRoot = findCommonRoot(changes);
  const root: TreeNode = { name: '', path: '', isDir: true, children: [] };

  for (const c of changes) {
    // Remove common root prefix for display
    const displayPath = commonRoot ? (c.file.startsWith(commonRoot) ? c.file.slice(commonRoot.length) : c.file) : c.file;
    const segments = displayPath.split('/');
    let node = root;
    for (let i = 0; i < segments.length; i++) {
      const isLast = i === segments.length - 1;
      const seg = segments[i];
      const fullPath = isLast ? c.file : segments.slice(0, i + 1).join('/');
      let child = node.children?.find(n => n.name === seg);
      if (!child) {
        child = {
          name: seg,
          path: fullPath,
          isDir: !isLast,
          children: isLast ? undefined : [],
          file: isLast ? { file: c.file, status: c.status, staged: c.staged, added: c.added, deleted: c.deleted } : undefined,
        };
        node.children = node.children || [];
        node.children.push(child);
      }
      node = child;
    }
  }

  return root.children || [];
}

interface TreeCtx {
  workDir: string | null;
  selectedFile: string | null;
  setSelectedFile: (f: string) => void;
  setStagedDiff: (s: boolean) => void;
  run: (fn: () => Promise<Response>) => void;
  isStaged: boolean;
  statusColor: (s: string) => string;
  statusLabel: (s: string) => string;
}

function renderTree(
  nodes: TreeNode[],
  depth: number,
  expanded: Set<string>,
  setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>,
  ctx: TreeCtx
): JSX.Element[] {
  return nodes.map((node, i) => {
    const key = `${node.path || node.name}-${i}-${depth}`;
    if (node.isDir) {
      const isOpen = expanded.has(node.path);
      return (
        <div key={key}>
          <div
            onClick={() => setExpanded(prev => {
              const next = new Set(prev);
              isOpen ? next.delete(node.path) : next.add(node.path);
              return next;
            })}
            className="flex items-center gap-1 px-2 py-0.5 cursor-pointer text-[13px] hover:bg-[var(--color-surface-hover)] transition-colors text-[var(--color-text-secondary)]"
            style={{ paddingLeft: `${depth * 14 + 8}px` }}
          >
            {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <Folder size={13} className="text-amber-600/60" />
            <span className="truncate">{node.name}</span>
          </div>
          {isOpen && node.children && renderTree(node.children, depth + 1, expanded, setExpanded, ctx)}
        </div>
      );
    }
    // File node
    const c = node.file!;
    const sym = c.status === 'a' ? '+' : c.status === 'd' ? '−' : '~';
    return (
      <div
        key={key}
        className="group flex items-center gap-1.5 pr-2 py-0.5 cursor-pointer text-[13px] hover:bg-[var(--color-surface-hover)] transition-colors"
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        onClick={() => { ctx.setSelectedFile(c.file); ctx.setStagedDiff(c.staged); }}
      >
        <span className="w-3 shrink-0" />
        <span className={`w-4 text-center font-mono text-[11px] shrink-0 font-bold ${ctx.statusColor(c.status)}`}>{sym}</span>
        <span className="truncate flex-1 text-[var(--color-text)]">{node.name}</span>
        {(c.added > 0 || c.deleted > 0) && (
          <span className="text-[11px] font-mono shrink-0 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
            <span className="text-green-500">+{c.added}</span>
            <span className="text-red-500">−{c.deleted}</span>
          </span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            const url = ctx.isStaged
              ? `/api/git/unstage?base=${encodeURIComponent(ctx.workDir!)}`
              : `/api/git/stage?base=${encodeURIComponent(ctx.workDir!)}`;
            ctx.run(() => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files: [c.file] }) }));
          }}
          className="text-[var(--color-text-muted)] hover:text-amber-500 opacity-0 group-hover:opacity-100 transition-all p-0.5 shrink-0"
        >
          {ctx.isStaged ? <Minus size={12} /> : <Plus size={12} />}
        </button>
      </div>
    );
  });
}
