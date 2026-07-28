import { useState, useRef, useEffect, forwardRef, useCallback } from 'react';
import { useEventBus, type TaskEntry } from '../store/eventBus';
import { useSubagentStore, type SubagentSession, type SubagentThinkingBlock } from '../store/subagentStore';
import { useSettingsStore } from '../store/settingsStore';
import { ChevronDown, ChevronRight, Check, X, Loader, Braces, ChevronsRight, Trash2, Play, Square, Send } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface SubagentPanelProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  width: number;
}

export const SubagentPanel = forwardRef<HTMLDivElement, SubagentPanelProps>(
  function SubagentPanel({ collapsed, onToggleCollapse, width }, ref) {
    const taskEntries = useEventBus(s => s.taskEntries);
    const subSessions = useSubagentStore(s => s.sessions);
    const [selected, setSelected] = useState<{ type: 'task' | 'subagent'; id: string } | null>(null);
    const [taskInput, setTaskInput] = useState('');
    const [thinkingExpanded, setThinkingExpanded] = useState<Set<string>>(new Set());

    const running = taskEntries.filter(t => t.status === 'running');
    const completed = taskEntries.filter(t => t.status !== 'running');
    const guiRunning = subSessions.filter(s => s.status === 'running');
    const guiCompleted = subSessions.filter(s => s.status !== 'running');

    // Auto-select first running item
    useEffect(() => {
      if (!selected && (guiRunning.length > 0 || running.length > 0)) {
        const first = guiRunning[0];
        if (first) {
          setSelected({ type: 'subagent', id: first.id });
        } else if (running[0]) {
          setSelected({ type: 'task', id: running[0].taskId });
        }
      }
    }, [guiRunning, running, selected]);

    const handleSpawn = () => {
      const task = taskInput.trim();
      if (!task) return;
      setTaskInput('');
      const subagentId = crypto.randomUUID();
      useSubagentStore.getState().startSubagent(subagentId, task, '');

      // Build env vars from settings using current model
      const env: Record<string, string> = {};
      const settingsEnv = useSettingsStore.getState().getEnvVarsForModel(
        localStorage.getItem('cc-gui-model') || 'claude-sonnet-4-20250514'
      );
      for (const [k, v] of Object.entries(settingsEnv)) {
        if (v) env[k] = v;
      }

      // Send via the existing WS — dispatch a custom event to ChatPanel
      window.dispatchEvent(new CustomEvent('cc-gui:subagent-spawn', {
        detail: { subagentId, task, env },
      }));
      setSelected({ type: 'subagent', id: subagentId });
    };

    const handleAbort = () => {
      window.dispatchEvent(new CustomEvent('cc-gui:subagent-abort', {
        detail: { subagentId: selected?.id },
      }));
    };

    if (collapsed) {
      const totalRunning = running.length + guiRunning.length;
      const totalDone = completed.length + guiCompleted.length;
      return (
        <div className="w-10 shrink-0 flex flex-col items-center gap-1 py-2 border-l border-[var(--color-border)] bg-[var(--color-surface)] transition-colors">
          <button onClick={onToggleCollapse} className="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-colors relative" title="Subagents">
            <Braces size={18} />
            {totalRunning > 0 && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-500 border border-[var(--color-surface)]" />}
          </button>
          {totalDone > 0 && <span className="text-[10px] text-[var(--color-text-muted)]">{totalDone}d</span>}
          {totalRunning > 0 && <span className="text-[10px] text-green-500 animate-pulse">{totalRunning}r</span>}
        </div>
      );
    }

    const totalItems = taskEntries.length + subSessions.length;

    return (
      <div ref={ref} style={{ width }} className="shrink-0 flex flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)] shrink-0">
          <span className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest">
            🔀 Subagents ({totalItems})
          </span>
          <div className="flex items-center gap-1">
            <button onClick={() => { useEventBus.getState().clearTasks(); useSubagentStore.getState().clearSessions(); }} className="p-0.5 text-[var(--color-text-muted)] hover:text-red-500 rounded transition-colors" title="Clear all">
              <Trash2 size={12} />
            </button>
            <button onClick={onToggleCollapse} className="p-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] rounded transition-colors" title="Collapse">
              <ChevronsRight size={14} />
            </button>
          </div>
        </div>

        {/* Spawn input */}
        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-[var(--color-border)] shrink-0">
          <input
            type="text"
            value={taskInput}
            onChange={e => setTaskInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSpawn(); }}
            placeholder="Spawn subagent..."
            className="flex-1 bg-[var(--color-input-bg)] border border-[var(--color-border)] rounded px-2 py-1 text-[12px] text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-accent-500"
          />
          <button onClick={handleSpawn} disabled={!taskInput.trim()} className="p-1 rounded text-accent-500 hover:bg-accent-500/10 disabled:opacity-30 transition-colors" title="Spawn">
            <Play size={14} />
          </button>
          {guiRunning.length > 0 && (
            <button onClick={handleAbort} className="p-1 rounded text-red-500 hover:bg-red-500/10 transition-colors" title="Abort running">
              <Square size={14} />
            </button>
          )}
        </div>

        {totalItems === 0 ? (
          <div className="flex-1 flex items-center justify-center text-[var(--color-text-muted)] text-xs p-4 text-center">
            No subagents yet.<br />Type a task above and press Enter,<br />or Claude will spawn internal tasks.
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-h-0">
            {/* GUI-spawned running */}
            {guiRunning.length > 0 && (
              <div className="border-b border-[var(--color-border)]">
                <div className="px-3 py-1.5 text-[10px] font-semibold text-accent-500 uppercase tracking-wide">My Subagents ({guiRunning.length})</div>
                {guiRunning.map(s => (
                  <SubagentRow key={s.id} session={s} isSelected={selected?.id === s.id && selected?.type === 'subagent'} onSelect={() => setSelected({ type: 'subagent', id: s.id })} />
                ))}
              </div>
            )}

            {/* GUI-spawned completed */}
            {guiCompleted.length > 0 && (
              <div className="border-b border-[var(--color-border)]">
                <div className="px-3 py-1.5 text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">My Subagents ({guiCompleted.length})</div>
                {guiCompleted.map(s => (
                  <SubagentRow key={s.id} session={s} isSelected={selected?.id === s.id && selected?.type === 'subagent'} onSelect={() => setSelected({ type: 'subagent', id: s.id })} />
                ))}
              </div>
            )}

            {/* CLI internal tasks */}
            {running.length > 0 && (
              <div className="border-b border-[var(--color-border)]">
                <div className="px-3 py-1.5 text-[10px] font-semibold text-green-500 uppercase tracking-wide">Internal Tasks ({running.length})</div>
                {running.map(t => (
                  <TaskRow key={t.taskId} task={t} isSelected={selected?.id === t.taskId && selected?.type === 'task'} onSelect={() => setSelected({ type: 'task', id: t.taskId })} />
                ))}
              </div>
            )}

            {completed.length > 0 && (
              <div className="flex-1 overflow-y-auto">
                <div className="px-3 py-1.5 text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Internal Tasks ({completed.length})</div>
                {completed.map(t => (
                  <TaskRow key={t.taskId} task={t} isSelected={selected?.id === t.taskId && selected?.type === 'task'} onSelect={() => setSelected({ type: 'task', id: t.taskId })} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Detail / Chat View */}
        {selected && (
          <div className="border-t border-[var(--color-border)] shrink-0" style={{ maxHeight: '60%', overflowY: 'auto' }}>
            {selected.type === 'task' ? (
              <TaskDetail task={taskEntries.find(t => t.taskId === selected.id)} />
            ) : (
              <SubagentChat
                session={subSessions.find(s => s.id === selected.id)}
                thinkingExpanded={thinkingExpanded}
                setThinkingExpanded={setThinkingExpanded}
              />
            )}
          </div>
        )}
      </div>
    );
  });

// ── Subagent Chat View ──

function SubagentChat({ session, thinkingExpanded, setThinkingExpanded }: {
  session?: SubagentSession;
  thinkingExpanded: Set<string>;
  setThinkingExpanded: (v: Set<string>) => void;
}) {
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  });

  if (!session) return null;

  const statusIcon = session.status === 'running' ? <Loader size={10} className="animate-spin text-green-500" />
    : session.status === 'completed' ? <Check size={10} className="text-green-500" />
    : <X size={10} className="text-red-500" />;

  return (
    <div>
      <div className="px-3 py-2 border-b border-[var(--color-border)] flex items-center gap-2">
        {statusIcon}
        <span className="text-[11px] font-semibold text-[var(--color-text)] truncate flex-1">{session.task}</span>
        {session.usage && (
          <span className="text-[10px] text-[var(--color-text-muted)]">
            {session.usage.inputTokens + session.usage.outputTokens} tokens · ${session.usage.models.reduce((s, m) => s + m.costUSD, 0).toFixed(3)}
          </span>
        )}
      </div>

      <div className="p-3 space-y-3 max-h-[400px] overflow-y-auto">
        {session.messages.length === 0 && session.status === 'running' && (
          <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)] px-1">
            <Loader size={12} className="animate-spin" /> Working...
          </div>
        )}
        {session.messages.map(msg => {
          const thinkBlock = session.thinkingBlocks[msg.id];
          const isThinking = !!(msg.role === 'tool' && thinkBlock);

          if (msg.role === 'user') return null; // hide user messages in subagent view

          return (
            <div key={msg.id} className="max-w-full">
              {isThinking ? (
                <ThinkingView
                  block={thinkBlock!}
                  expanded={thinkingExpanded.has(msg.id)}
                  onToggle={() => {
                    const next = new Set(thinkingExpanded);
                    next.has(msg.id) ? next.delete(msg.id) : next.add(msg.id);
                    setThinkingExpanded(next);
                  }}
                />
              ) : msg.role === 'assistant' ? (
                <div className="text-[12px] leading-relaxed text-[var(--color-text)] [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-slate-300 dark:[&_th]:border-slate-700 [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:border-slate-300 dark:[&_td]:border-slate-700 [&_td]:px-2 [&_td]:py-1 [&_strong]:text-[var(--color-text)] [&_a]:text-accent-500 [&_a]:underline [&_code]:bg-slate-100 dark:[&_code]:bg-slate-700/50 [&_code]:px-1 [&_code]:rounded [&_code]:text-[11px] [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_p]:mb-1 [&_p:last-child]:mb-0 [&_h1]:text-sm [&_h1]:font-semibold [&_h2]:text-[13px] [&_h2]:font-semibold [&_h3]:text-[12px] [&_h3]:font-medium [&_hr]:border-[var(--color-border)] [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--color-border)] [&_blockquote]:pl-3 [&_blockquote]:text-[var(--color-text-muted)] [&_pre]:bg-slate-100 dark:[&_pre]:bg-slate-800/50 [&_pre]:rounded [&_pre]:p-2 [&_pre]:overflow-x-auto [&_pre]:text-[11px]">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                </div>
              ) : msg.role === 'error' ? (
                <div className="text-[12px] text-red-500">{msg.content}</div>
              ) : null}
            </div>
          );
        })}
        <div ref={chatEndRef} />
      </div>
    </div>
  );
}

function ThinkingView({ block, expanded, onToggle }: { block: SubagentThinkingBlock; expanded: boolean; onToggle: () => void }) {
  return (
    <div>
      <button onClick={onToggle} className="flex items-center gap-2 text-[var(--color-text-muted)] hover:text-accent-500 transition-colors w-full text-left text-xs font-medium">
        <span className="text-[10px]">{expanded ? '▼' : '▶'}</span>
        <span className="bg-accent-600/20 text-accent-400 px-1.5 py-0.5 rounded text-[11px]">🧠</span>
        <span className="text-[var(--color-text-muted)] text-[11px]">
          {block.tools.length > 0 && `${block.tools.length} tools · `}
          {block.files.length > 0 && `${block.files.length} files · `}
          {block.secs}s
        </span>
      </button>
      {expanded && (
        <div className="mt-2 border-l-2 border-accent-600/40 pl-3 space-y-2 max-h-[300px] overflow-y-auto">
          <pre className="whitespace-pre-wrap font-sans text-[var(--color-text-muted)] text-[11px] leading-relaxed italic">{block.text}</pre>
          {block.tools.map(t => (
            <div key={t.id} className="flex items-center gap-1.5 text-[11px]">
              {t.status === 'running' ? <Loader size={10} className="animate-spin text-accent-400" />
                : t.status === 'done' ? <Check size={10} className="text-green-500" />
                : <X size={10} className="text-red-500" />}
              <span className="text-[var(--color-text)]">{t.name}</span>
              {t.detail && <span className="text-[var(--color-text-muted)] truncate">{t.detail}</span>}
              {t.durationMs != null && <span className="text-[10px] text-[var(--color-text-muted)] ml-auto">{t.durationMs}ms</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Task Row ──

function SubagentRow({ session, isSelected, onSelect }: { session: SubagentSession; isSelected: boolean; onSelect: () => void }) {
  const elapsed = session.completedAt ? Math.round((session.completedAt - session.startedAt) / 1000) : Math.round((Date.now() - session.startedAt) / 1000);
  return (
    <div onClick={onSelect} className={`px-3 py-1.5 cursor-pointer border-b border-[var(--color-border)]/50 transition-colors ${isSelected ? 'bg-accent-500/10 border-l-2 border-l-accent-500' : 'hover:bg-[var(--color-surface-hover)]'}`}>
      <div className="flex items-center gap-1.5">
        {session.status === 'running' ? <Loader size={10} className="animate-spin text-accent-400 shrink-0" />
          : session.status === 'completed' ? <Check size={10} className="text-green-500 shrink-0" />
          : <X size={10} className="text-red-500 shrink-0" />}
        <span className="flex-1 truncate text-[12px] text-[var(--color-text)]">{session.task}</span>
        <span className="text-[10px] text-[var(--color-text-muted)] shrink-0">{elapsed}s</span>
      </div>
    </div>
  );
}

function TaskRow({ task, isSelected, onSelect }: { task: TaskEntry; isSelected: boolean; onSelect: () => void }) {
  const elapsed = task.completedAt ? Math.round((new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime()) / 1000) : Math.round((Date.now() - new Date(task.startedAt).getTime()) / 1000);
  return (
    <div onClick={onSelect} className={`px-3 py-1.5 cursor-pointer border-b border-[var(--color-border)]/50 transition-colors ${isSelected ? 'bg-accent-500/10 border-l-2 border-l-accent-500' : 'hover:bg-[var(--color-surface-hover)]'}`}>
      <div className="flex items-center gap-1.5">
        {task.status === 'running' ? <Loader size={10} className="animate-spin text-green-500 shrink-0" />
          : task.status === 'completed' ? <Check size={10} className="text-green-500 shrink-0" />
          : <X size={10} className="text-red-500 shrink-0" />}
        <span className="flex-1 truncate text-[12px] text-[var(--color-text)]">{task.description}</span>
        <span className="text-[10px] text-[var(--color-text-muted)] shrink-0">{elapsed}s</span>
      </div>
    </div>
  );
}

function TaskDetail({ task }: { task?: TaskEntry }) {
  if (!task) return null;
  return (
    <div>
      <div className="px-3 py-2 border-b border-[var(--color-border)]">
        <span className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Task Detail</span>
      </div>
      <div className="p-3 space-y-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[var(--color-text-muted)] w-16 shrink-0">ID</span>
          <span className="text-[var(--color-text)]">{task.taskId}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[var(--color-text-muted)] w-16 shrink-0">Type</span>
          <span className="text-[var(--color-text)]">{task.taskType}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[var(--color-text-muted)] w-16 shrink-0">Status</span>
          <span className="text-[var(--color-text)] flex items-center gap-1">
            {task.status === 'running' ? <Loader size={10} className="animate-spin text-green-500" />
              : task.status === 'completed' ? <Check size={10} className="text-green-500" />
              : <X size={10} className="text-red-500" />}
            {task.status}
          </span>
        </div>
        {task.summary && (
          <div>
            <div className="text-[10px] text-[var(--color-text-muted)] mb-0.5">Summary</div>
            <div className="text-[var(--color-text)] whitespace-pre-wrap break-words">{task.summary}</div>
          </div>
        )}
      </div>
    </div>
  );
}
