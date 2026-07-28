import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AppEvent, ChatAssistantEvent, ChatThinkingEvent, ToolStartedEvent, ToolCompletedEvent, SessionUsageEvent, ThinkingTool, ThinkingFile } from '@cc-gui/shared';
import { toolInputDetail } from '@cc-gui/shared';

// ── Types (serializable — no Map) ──

export interface SubagentMessage {
  role: 'user' | 'assistant' | 'tool' | 'error';
  content: string;
  id: string;
}

export interface SubagentThinkingBlock {
  text: string;
  tools: ThinkingTool[];
  files: ThinkingFile[];
  secs: number;
  startTime: number;
}

export interface SubagentSession {
  id: string;
  task: string;
  workDir: string;
  status: 'running' | 'completed' | 'error';
  messages: SubagentMessage[];
  thinkingBlocks: Record<string, SubagentThinkingBlock>;
  /** Last active thinking block message ID (for tool appends) */
  lastThinkingMsgId: string | null;
  startedAt: number;
  completedAt?: number;
  exitCode?: number | null;
  usage?: SessionUsageEvent;
}

// ── Store ──

interface SubagentStoreState {
  sessions: SubagentSession[];

  startSubagent: (id: string, task: string, workDir: string) => void;
  markReady: (id: string) => void;
  markExit: (id: string, exitCode: number | null) => void;
  pushEvent: (subagentId: string, event: AppEvent) => void;
  removeSession: (id: string) => void;
  clearSessions: () => void;
}

export const useSubagentStore = create<SubagentStoreState>()(
  persist(
    (set, get) => ({
      sessions: [],

      startSubagent: (id, task, workDir) => {
        set(s => ({
          sessions: [...s.sessions, {
            id, task, workDir, status: 'running',
            messages: [], thinkingBlocks: {}, lastThinkingMsgId: null,
            startedAt: Date.now(),
          }],
        }));
      },

      markReady: (_id) => { /* no-op */ },

      markExit: (id, exitCode) => {
        set(s => ({
          sessions: s.sessions.map(sess =>
            sess.id === id
              ? { ...sess, status: exitCode === 0 ? 'completed' as const : 'error' as const, completedAt: Date.now(), exitCode }
              : sess
          ),
        }));
      },

      pushEvent: (subagentId, event) => {
        const session = get().sessions.find(s => s.id === subagentId);
        if (!session) return;

        switch (event.type) {
          case 'chat.user': {
            set(s => ({
              sessions: s.sessions.map(sess =>
                sess.id === subagentId
                  ? { ...sess, messages: [...sess.messages, { role: 'user' as const, content: event.content, id: crypto.randomUUID() }] }
                  : sess
              ),
            }));
            break;
          }

          case 'chat.assistant': {
            const text = (event as ChatAssistantEvent).content;
            set(s => ({
              sessions: s.sessions.map(sess => {
                if (sess.id !== subagentId) return sess;
                const last = sess.messages[sess.messages.length - 1];
                if (last && last.role === 'assistant') {
                  const updated = { ...last, content: last.content + text };
                  return { ...sess, messages: [...sess.messages.slice(0, -1), updated] };
                }
                return { ...sess, messages: [...sess.messages, { role: 'assistant' as const, content: text, id: crypto.randomUUID() }] };
              }),
            }));
            break;
          }

          case 'chat.thinking': {
            const content = (event as ChatThinkingEvent).content;
            set(s => ({
              sessions: s.sessions.map(sess => {
                if (sess.id !== subagentId) return sess;

                if (sess.lastThinkingMsgId && sess.thinkingBlocks[sess.lastThinkingMsgId]) {
                  return {
                    ...sess,
                    thinkingBlocks: {
                      ...sess.thinkingBlocks,
                      [sess.lastThinkingMsgId]: {
                        ...sess.thinkingBlocks[sess.lastThinkingMsgId],
                        text: sess.thinkingBlocks[sess.lastThinkingMsgId].text + content,
                      },
                    },
                  };
                } else {
                  const msgId = crypto.randomUUID();
                  return {
                    ...sess,
                    lastThinkingMsgId: msgId,
                    thinkingBlocks: {
                      ...sess.thinkingBlocks,
                      [msgId]: { text: content, tools: [], files: [], secs: 0, startTime: Date.now() },
                    },
                    messages: [...sess.messages, { role: 'tool' as const, content: '', id: msgId }],
                  };
                }
              }),
            }));
            break;
          }

          case 'tool.started': {
            const e = event as ToolStartedEvent;
            const detail = toolInputDetail(e.toolName, e.toolInput);

            const newTool: ThinkingTool = {
              id: crypto.randomUUID(), name: e.toolName, detail, status: 'running', files: e.files,
            };

            set(s => ({
              sessions: s.sessions.map(sess => {
                if (sess.id !== subagentId || !sess.lastThinkingMsgId) return sess;
                const block = sess.thinkingBlocks[sess.lastThinkingMsgId];
                if (!block) return sess;
                return {
                  ...sess,
                  thinkingBlocks: {
                    ...sess.thinkingBlocks,
                    [sess.lastThinkingMsgId]: { ...block, tools: [...block.tools, newTool] },
                  },
                };
              }),
            }));
            break;
          }

          case 'tool.completed': {
            const e = event as ToolCompletedEvent;
            set(s => ({
              sessions: s.sessions.map(sess => {
                if (sess.id !== subagentId || !sess.lastThinkingMsgId) return sess;
                const block = sess.thinkingBlocks[sess.lastThinkingMsgId];
                if (!block) return sess;
                const updatedTools = block.tools.map(t =>
                  t.name === e.toolName && t.status === 'running'
                    ? { ...t, status: e.success ? 'done' as const : 'error' as const, durationMs: e.durationMs, output: e.summary }
                    : t
                );
                const newFiles = [...block.files];
                if (e.files) {
                  for (const f of e.files) {
                    const isRead = ['Read', 'read_file', 'Grep', 'Glob'].some(n => e.toolName.includes(n));
                    newFiles.push({ type: isRead ? 'read' : 'changed', path: f });
                  }
                }
                return {
                  ...sess,
                  thinkingBlocks: {
                    ...sess.thinkingBlocks,
                    [sess.lastThinkingMsgId]: { ...block, tools: updatedTools, files: newFiles, secs: Math.round((Date.now() - block.startTime) / 1000) || 1 },
                  },
                };
              }),
            }));
            break;
          }

          case 'session.usage': {
            set(s => ({
              sessions: s.sessions.map(sess =>
                sess.id === subagentId ? { ...sess, usage: event as SessionUsageEvent } : sess
              ),
            }));
            break;
          }
        }
      },

      removeSession: (id) => {
        set(s => ({ sessions: s.sessions.filter(sess => sess.id !== id) }));
      },

      clearSessions: () => set({ sessions: [] }),
    }),
    {
      name: 'cc-gui-subagents',
      partialize: (state) => ({
        // Only persist completed/error sessions — skip running ones
        sessions: state.sessions
          .filter(s => s.status !== 'running'),
      }),
      version: 1,
    }
  )
);
