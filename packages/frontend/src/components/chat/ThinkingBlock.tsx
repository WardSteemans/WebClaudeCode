import { ChevronDown, ChevronRight, Check, X, Loader, FileText, Terminal, Eye } from 'lucide-react';
import type { ChatMessage, ThinkingBlock, ThinkingTool, ThinkingFile } from '../../lib/chat/types';
import { thinkingSummary, toolSummaryLine } from '../../lib/chat/thinking-utils';

// ==================== Props ====================

export interface ThinkingBlockViewProps {
  msgId: string;
  block: ThinkingBlock;
  /** Whether the entire thinking block is expanded */
  expanded: boolean;
  /** Called when the user clicks the header to toggle expand/collapse */
  onToggleExpand: () => void;
  /** Set of collapsed segment IDs */
  collapsedSegments: Set<string>;
  /** Called when the user clicks a segment header (single/double-click handled by parent) */
  onSegmentClick: (segmentId: string) => void;
}

// ==================== Segment renderers ====================

function ThinkingSegmentView({
  seg,
  collapsed,
  showDivider,
  onToggle,
}: {
  seg: { id: string; kind: 'thinking'; text: string; summary: string };
  collapsed: boolean;
  showDivider: boolean;
  onToggle: () => void;
}) {
  return (
    <div>
      {showDivider && <div className="border-t border-slate-200 dark:border-slate-700/50 my-1.5" />}
      <button
        onClick={onToggle}
        className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 hover:text-[var(--color-text)] transition-colors w-full text-left group"
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        <span>📝</span>
        <span className="truncate">{collapsed ? (seg.summary || thinkingSummary(seg.text)) : 'Thinking'}</span>
      </button>
      {!collapsed && (
        <pre className="mt-1 mb-1 whitespace-pre-wrap font-sans text-slate-500 dark:text-slate-400 text-[12px] leading-relaxed italic pl-5">{seg.text}</pre>
      )}
    </div>
  );
}

function ToolSegmentView({
  tool,
  collapsed,
  onToggle,
}: {
  tool: ThinkingTool;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="flex items-center gap-1.5 text-[11px] w-full text-left group py-0.5"
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        {tool.status === 'running' && <Loader size={10} className="animate-spin text-accent-400 shrink-0" />}
        {tool.status === 'done' && <Check size={10} className="text-green-500 shrink-0" />}
        {tool.status === 'error' && <X size={10} className="text-red-500 shrink-0" />}
        <Terminal size={10} className="text-purple-400 shrink-0" />
        <span className="text-slate-600 dark:text-slate-400 truncate">
          {collapsed
            ? toolSummaryLine(tool)
            : <>{tool.name}{tool.detail && <span className="text-slate-400 dark:text-slate-600">: {tool.detail}</span>}</>
          }
        </span>
        {tool.durationMs != null && (
          <span className="text-[10px] text-slate-500 ml-auto shrink-0">{tool.durationMs < 1000 ? `${tool.durationMs}ms` : `${(tool.durationMs / 1000).toFixed(1)}s`}</span>
        )}
      </button>
      {!collapsed && (
        <div className="mt-0.5 ml-6 text-[11px] text-slate-500 dark:text-slate-400 space-y-1">
          {tool.output && (
            <pre className="whitespace-pre-wrap font-mono text-[11px] bg-slate-100 dark:bg-slate-800/50 rounded p-1.5 max-h-32 overflow-y-auto">{tool.output}</pre>
          )}
          {tool.files && tool.files.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {tool.files.map((f, i) => (
                <span key={i} className="inline-flex items-center gap-0.5 text-[10px] bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded">
                  <FileText size={9} /> {f.split(/[/\\]/).pop()}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FilesSegmentView({
  files,
  collapsed,
  onToggle,
}: {
  files: ThinkingFile[];
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 hover:text-[var(--color-text)] transition-colors w-full text-left py-0.5"
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        <span>📁 Files ({files.length})</span>
      </button>
      {!collapsed && (
        <div className="mt-0.5 ml-6 space-y-0.5">
          {files.map((f, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[11px]">
              {f.type === 'read' && <Eye size={10} className="text-blue-400 shrink-0" />}
              {f.type !== 'read' && <FileText size={10} className="text-amber-400 shrink-0" />}
              <span className="text-slate-600 dark:text-slate-400 truncate">{f.path.split(/[/\\]/).pop()}</span>
              <span className="text-[10px] text-slate-500">{f.type}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ==================== Main component ====================

export function ThinkingBlockView({
  msgId,
  block,
  expanded,
  onToggleExpand,
  collapsedSegments,
  onSegmentClick,
}: ThinkingBlockViewProps) {
  const toolCount = block.segments.filter(s => s.kind === 'tool').length;
  const fileCount = block.segments
    .filter((s): s is { id: string; kind: 'files'; files: ThinkingFile[] } => s.kind === 'files')
    .reduce((sum, s) => sum + s.files.length, 0);
  const runningTools = block.segments.filter(s => s.kind === 'tool' && s.tool.status === 'running').length;

  return (
    <div>
      {/* Header row */}
      <button
        onClick={onToggleExpand}
        className="flex items-center gap-2 text-slate-500 dark:text-slate-400 hover:text-accent-600 dark:hover:text-accent-300 transition-colors w-full text-left text-xs font-medium"
      >
        <span className="text-[10px]">{expanded ? '▼' : '▶'}</span>
        <span className="bg-accent-600/20 text-accent-400 px-1.5 py-0.5 rounded text-[11px]">🧠</span>
        {runningTools > 0 && <Loader size={11} className="animate-spin text-accent-400" />}
        <span className="text-slate-400 dark:text-slate-600 text-[11px]">
          {toolCount > 0 && `${toolCount} tool${toolCount > 1 ? 's' : ''} · `}
          {fileCount > 0 && `${fileCount} file${fileCount > 1 ? 's' : ''} · `}
          {block.secs}s
        </span>
      </button>

      {expanded && (
        <div className="mt-2 border-l-2 border-accent-600/40 pl-3 max-h-[500px] overflow-y-auto">
          {block.segments.map((seg, i) => {
            const collapsed = collapsedSegments.has(seg.id);
            const showDivider = seg.kind === 'thinking' && i > 0;

            if (seg.kind === 'thinking') {
              return (
                <ThinkingSegmentView
                  key={seg.id}
                  seg={seg}
                  collapsed={collapsed}
                  showDivider={showDivider}
                  onToggle={() => onSegmentClick(seg.id)}
                />
              );
            }

            if (seg.kind === 'tool') {
              return (
                <ToolSegmentView
                  key={seg.id}
                  tool={seg.tool}
                  collapsed={collapsed}
                  onToggle={() => onSegmentClick(seg.id)}
                />
              );
            }

            if (seg.kind === 'files') {
              return (
                <FilesSegmentView
                  key={seg.id}
                  files={seg.files}
                  collapsed={collapsed}
                  onToggle={() => onSegmentClick(seg.id)}
                />
              );
            }

            return null;
          })}
        </div>
      )}
    </div>
  );
}
