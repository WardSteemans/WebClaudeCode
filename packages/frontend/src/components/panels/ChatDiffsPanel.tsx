import { useState } from 'react';
import { FileDiff, FilePlus, FileMinus, FileEdit, Trash2 } from 'lucide-react';
import { useDiffStore, type FileChange } from '../../store/diffStore';
import { InlineDiff } from '../files/InlineDiff';

interface ChatDiffsPanelProps {
  chatId: string;
}

const typeIcon = (type: FileChange['type']) => {
  switch (type) {
    case 'created': return <FilePlus size={12} className="text-green-500 shrink-0" />;
    case 'deleted': return <FileMinus size={12} className="text-red-500 shrink-0" />;
    case 'modified': return <FileEdit size={12} className="text-amber-500 shrink-0" />;
  }
};

export function ChatDiffsPanel({ chatId }: ChatDiffsPanelProps) {
  const changes = useDiffStore((s) => s.changesByChat[chatId] || []);
  const clearChanges = useDiffStore((s) => s.clearChanges);
  const [expandedPath, setExpandedPath] = useState<string | null>(null);

  if (!chatId) {
    return <div className="p-4 text-[var(--color-text-muted)] text-sm text-center">No chat selected</div>;
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--color-border)] shrink-0">
        <div className="flex items-center gap-1.5">
          <FileDiff size={14} className="text-[var(--color-text-muted)]" />
          <span className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest">
            Changes {changes.length > 0 && `· ${changes.length}`}
          </span>
        </div>
        {changes.length > 0 && (
          <button
            onClick={() => clearChanges(chatId)}
            className="p-0.5 text-[var(--color-text-muted)] hover:text-red-500 hover:bg-red-500/10 rounded transition-colors"
            title="Clear all changes"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {changes.length === 0 ? (
          <div className="p-4 text-center text-[var(--color-text-muted)] text-sm">
            No file changes yet
          </div>
        ) : (
          <div>
            {[...changes].reverse().map((change, i) => {
              const isExpanded = expandedPath === change.path;
              const fileName = change.path.split(/[/\\]/).pop() || change.path;

              return (
                <div key={`${change.path}-${i}`} className="border-b border-[var(--color-border)] last:border-0">
                  <button
                    onClick={() => setExpandedPath(isExpanded ? null : change.path)}
                    className="flex items-center gap-1.5 w-full text-left px-3 py-1.5 text-[13px] hover:bg-[var(--color-surface-hover)] transition-colors"
                  >
                    {typeIcon(change.type)}
                    <span className="truncate flex-1 text-[var(--color-text)]">{fileName}</span>
                    <span className="text-[10px] text-[var(--color-text-muted)] shrink-0">
                      {new Date(change.timestamp).toLocaleTimeString()}
                    </span>
                  </button>
                  {isExpanded && change.diff && (
                    <div className="px-3 pb-2">
                      <InlineDiff diff={change.diff} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
