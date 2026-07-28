import { useState, useRef, useEffect, useCallback } from 'react';
import type { AppEvent, ChatAssistantEvent, ChatThinkingEvent, ChatErrorEvent, ToolStartedEvent, ToolCompletedEvent, FileEvent, FileChangedEvent, SessionCompactedEvent } from '@cc-gui/shared';
import { useTabStore } from '../store';
import { useEventBus } from '../store/eventBus';
import { useSettingsStore, ALL_MODELS } from '../store/settingsStore';
import { useWebSocket } from './useWebSocket';
import { useSubagentStore } from '../store/subagentStore';
import { createFrontendLogger } from '../logger';
import type { ChatMessage, ThinkingBlock, ThinkingTool, ThinkingFile, ThinkingSegment } from '../lib/chat/types';
import { thinkingSummary } from '../lib/chat/thinking-utils';
import { reconstructHistory } from '../lib/chat/history-reconstruction';

// ==================== Module-level guards ====================

/** Session IDs for which we've already attempted to load history (survives remounts).
 *  Capped at 200 entries to prevent unbounded growth in long-running sessions. */
const historyAttempted = new Set<string>();
const HISTORY_MAX_SIZE = 200;
let historyInsertOrder: string[] = [];

function markHistoryAttempted(sessionId: string): boolean {
  if (historyAttempted.has(sessionId)) return true;
  historyAttempted.add(sessionId);
  historyInsertOrder.push(sessionId);
  // FIFO eviction: remove oldest when over capacity
  if (historyInsertOrder.length > HISTORY_MAX_SIZE) {
    const oldest = historyInsertOrder.shift()!;
    historyAttempted.delete(oldest);
  }
  return false;
}

const log = createFrontendLogger('useChatStream');

// ==================== Hook options ====================

interface UseChatStreamOptions {
  tabId: string;
  chatId: string;
  workDir: string;
  permissionMode: string;
  selectedModel: string;
  selectedEffort: string;
  chatSessionId: string | null;
}

// ==================== Hook ====================

export function useChatStream({
  tabId, chatId, workDir, permissionMode, selectedModel, selectedEffort, chatSessionId,
}: UseChatStreamOptions) {
  // ── Store actions ──
  const updateChatSessionId = useTabStore((s) => s.updateChatSessionId);
  const activateChat = useTabStore((s) => s.activateChat);
  const updateChatLastMessage = useTabStore((s) => s.updateChatLastMessage);
  const pushEvent = useEventBus((s) => s.pushEvent);
  const setTabStatus = useEventBus((s) => s.setTabStatus);

  // ── State ──
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [thinkingBlocks, setThinkingBlocks] = useState<Map<string, ThinkingBlock>>(new Map());
  const [thinkingExpanded, setThinkingExpanded] = useState<Set<string>>(new Set());
  const [collapsedSegments, setCollapsedSegments] = useState<Set<string>>(new Set());

  // ── Refs ──
  const streamContentRef = useRef('');
  const streamMsgIdRef = useRef<string | null>(null);
  const currentThinkingIdRef = useRef<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const streamTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const thinkingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasSentRef = useRef(false);
  const clickTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const thinkingBlocksRef = useRef<Map<string, ThinkingBlock>>(new Map());
  const lastTitleGenRef = useRef(0);

  // Keep ref in sync for callbacks that read thinkingBlocks without re-subscribing
  useEffect(() => { thinkingBlocksRef.current = thinkingBlocks; }, [thinkingBlocks]);

  // ── Helper functions ──

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const stopThinkingTimer = useCallback(() => {
    if (thinkingTimerRef.current) { clearInterval(thinkingTimerRef.current); thinkingTimerRef.current = null; }
  }, []);

  const appendToStream = useCallback((text: string) => {
    streamContentRef.current += text;
    if (streamMsgIdRef.current) {
      setMessages((prev) => prev.map((m) => m.id === streamMsgIdRef.current ? { ...m, content: streamContentRef.current } : m));
    }
  }, []);

  const finalizeStream = useCallback(() => {
    streamMsgIdRef.current = null;
    streamContentRef.current = '';
    stopThinkingTimer();
    if (currentThinkingIdRef.current) {
      const id = currentThinkingIdRef.current;
      setThinkingBlocks((prev) => {
        const next = new Map(prev);
        const block = next.get(id);
        if (block) {
          const segs = block.segments.map(seg =>
            seg.kind === 'thinking' && !seg.summary
              ? { ...seg, summary: thinkingSummary(seg.text) }
              : seg
          );
          next.set(id, { ...block, segments: segs, secs: Math.round((Date.now() - block.startTime) / 1000) || 1 });
        }
        return next;
      });
      currentThinkingIdRef.current = null;
    }
    setIsStreaming(false);
    setTabStatus(chatId, 'idle');
    if (streamTimerRef.current) { clearTimeout(streamTimerRef.current); streamTimerRef.current = null; }
  }, [stopThinkingTimer, chatId, setTabStatus]);

  const resetStreamTimer = useCallback(() => {
    if (streamTimerRef.current) clearTimeout(streamTimerRef.current);
    streamTimerRef.current = setTimeout(() => {
      finalizeStream();
      setMessages((prev) => [...prev, { role: 'error' as const, content: 'Timed out waiting for Claude response.', id: crypto.randomUUID(), timestamp: new Date().toISOString() }]);
    }, 120000);
  }, [finalizeStream]);

  // ── Segment click handling ──

  const isSegmentCollapsed = useCallback((segmentId: string) => {
    return collapsedSegments.has(segmentId);
  }, [collapsedSegments]);

  // Single-click: toggle one segment. Double-click: expand all segments in the block.
  const handleSegmentClick = useCallback((segmentId: string, blockId: string) => {
    const existing = clickTimersRef.current.get(segmentId);
    if (existing) {
      // Double-click detected → expand ALL segments in this block
      clearTimeout(existing);
      clickTimersRef.current.delete(segmentId);
      setCollapsedSegments((prev) => {
        const next = new Set(prev);
        const block = thinkingBlocksRef.current.get(blockId);
        if (block) {
          for (const seg of block.segments) next.delete(seg.id);
        }
        return next;
      });
    } else {
      // Single-click: wait a beat, then toggle
      const timer = setTimeout(() => {
        clickTimersRef.current.delete(segmentId);
        setCollapsedSegments((prev) => {
          const next = new Set(prev);
          next.has(segmentId) ? next.delete(segmentId) : next.add(segmentId);
          return next;
        });
      }, 250);
      clickTimersRef.current.set(segmentId, timer);
    }
  }, []);

  // ── Event handler (for WebSocket events) ──

  const handleEvent = useCallback((event: AppEvent) => {
    pushEvent(event, chatId);

    switch (event.type) {
      case 'chat.assistant': {
        resetStreamTimer();
        const text = (event as ChatAssistantEvent).content;
        if (!streamMsgIdRef.current) {
          const id = crypto.randomUUID();
          streamMsgIdRef.current = id;
          streamContentRef.current = text;
          updateChatLastMessage(tabId, chatId);
          setMessages((prev) => [...prev, { role: 'assistant', content: text, id, timestamp: new Date().toISOString() }]);
        } else {
          appendToStream(text);
        }
        break;
      }

      case 'chat.thinking': {
        const e = event as ChatThinkingEvent;
        if (!currentThinkingIdRef.current) {
          const id = crypto.randomUUID();
          currentThinkingIdRef.current = id;
          const segId = crypto.randomUUID();
          setThinkingBlocks((prev) => {
            const next = new Map(prev);
            next.set(id, {
              segments: [{ id: segId, kind: 'thinking', text: e.content, summary: '' }],
              secs: 0, startTime: Date.now(),
            });
            return next;
          });
          setThinkingExpanded((prev) => { const next = new Set(prev); next.add(id); return next; });
          setMessages((prev) => [...prev, { role: 'tool', content: '', id, timestamp: new Date().toISOString() }]);
          stopThinkingTimer();
          thinkingTimerRef.current = setInterval(() => {
            setThinkingBlocks((prev) => {
              const next = new Map(prev);
              const block = next.get(id);
              if (block) next.set(id, { ...block, secs: Math.round((Date.now() - block.startTime) / 1000) });
              return next;
            });
          }, 1000);
        } else {
          setThinkingBlocks((prev) => {
            const next = new Map(prev);
            const block = next.get(currentThinkingIdRef.current!);
            if (!block) return next;
            const segs = [...block.segments];
            const last = segs[segs.length - 1];
            if (last && last.kind === 'thinking') {
              segs[segs.length - 1] = { ...last, text: last.text + e.content };
            } else {
              segs.push({ id: crypto.randomUUID(), kind: 'thinking', text: e.content, summary: '' });
            }
            next.set(currentThinkingIdRef.current!, { ...block, segments: segs });
            return next;
          });
        }
        break;
      }

      case 'tool.started': {
        const e = event as ToolStartedEvent;
        const toolId = crypto.randomUUID();
        let detail = '';
        if (e.toolInput?.query) detail = `"${String(e.toolInput.query).slice(0, 60)}"`;
        else if (e.toolInput?.url) detail = String(e.toolInput.url).slice(0, 60);
        else if (Object.keys(e.toolInput).length > 0) detail = JSON.stringify(e.toolInput).slice(0, 80);

        const newTool: ThinkingTool = { id: toolId, name: e.toolName, detail, status: 'running', files: e.files };

        setThinkingBlocks((prev) => {
          const next = new Map(prev);
          const id = currentThinkingIdRef.current;
          if (!id) return next;
          const block = next.get(id);
          if (!block) return next;
          const segs = [...block.segments];
          segs.push({ id: toolId, kind: 'tool', tool: newTool });
          next.set(id, { ...block, segments: segs });
          return next;
        });
        break;
      }

      case 'tool.completed': {
        const e = event as ToolCompletedEvent;
        const collapseIds: string[] = [];

        setThinkingBlocks((prev) => {
          const next = new Map(prev);
          const id = currentThinkingIdRef.current;
          if (!id) return next;
          const block = next.get(id);
          if (!block) return next;

          const segs = block.segments.map((seg) => {
            if (seg.kind === 'tool' && seg.tool.name === e.toolName && seg.tool.status === 'running') {
              const updated: ThinkingTool = {
                ...seg.tool,
                status: e.success ? 'done' : 'error',
                durationMs: e.durationMs,
                output: e.summary,
                diff: e.diff,
              };
              return { ...seg, tool: updated };
            }
            return seg;
          });

          for (let i = 0; i < segs.length; i++) {
            const seg = segs[i];
            if (seg.kind === 'tool' && seg.tool.status !== 'running') {
              collapseIds.push(seg.id);
              if (i > 0 && segs[i - 1].kind === 'thinking') {
                collapseIds.push(segs[i - 1].id);
              }
            }
          }

          if (e.files && e.files.length > 0) {
            const isRead = ['Read', 'read_file', 'Grep', 'Glob'].some(n => e.toolName.includes(n));
            const newFiles: ThinkingFile[] = e.files.map(f => ({
              type: isRead ? 'read' : 'changed',
              path: f,
              diff: e.diff,
            }));
            const lastIsFiles = segs.length > 0 && segs[segs.length - 1].kind === 'files';
            if (lastIsFiles) {
              const lastFiles = segs[segs.length - 1] as { id: string; kind: 'files'; files: ThinkingFile[] };
              segs[segs.length - 1] = { ...lastFiles, files: [...lastFiles.files, ...newFiles] };
            } else {
              segs.push({ id: crypto.randomUUID(), kind: 'files', files: newFiles });
            }
          }

          next.set(id, { ...block, segments: segs });
          return next;
        });

        if (collapseIds.length > 0) {
          setCollapsedSegments((prev) => {
            const next = new Set(prev);
            for (const cid of collapseIds) next.add(cid);
            return next;
          });
        }
        break;
      }

      case 'file.read': {
        const e = event as FileEvent;
        setThinkingBlocks((prev) => {
          const next = new Map(prev);
          const id = currentThinkingIdRef.current;
          if (!id) return next;
          const block = next.get(id);
          if (!block) return next;
          const segs = [...block.segments];
          const last = segs[segs.length - 1];
          if (last && last.kind === 'files') {
            segs[segs.length - 1] = { ...last, files: [...last.files, { type: 'read' as const, path: e.path }] };
          } else {
            segs.push({ id: crypto.randomUUID(), kind: 'files', files: [{ type: 'read' as const, path: e.path }] });
          }
          next.set(id, { ...block, segments: segs });
          return next;
        });
        break;
      }

      case 'file.changed': {
        const e = event as FileChangedEvent;
        setThinkingBlocks((prev) => {
          const next = new Map(prev);
          const id = currentThinkingIdRef.current;
          if (!id) return next;
          const block = next.get(id);
          if (!block) return next;
          const segs = [...block.segments];
          const newFile: ThinkingFile = { type: e.changeType === 'modified' ? 'changed' : e.changeType, path: e.path };
          const last = segs[segs.length - 1];
          if (last && last.kind === 'files') {
            segs[segs.length - 1] = { ...last, files: [...last.files, newFile] };
          } else {
            segs.push({ id: crypto.randomUUID(), kind: 'files', files: [newFile] });
          }
          next.set(id, { ...block, segments: segs });
          return next;
        });
        break;
      }

      case 'session.compacted': {
        const e = event as SessionCompactedEvent;
        finalizeStream();
        let msg = '✅ Conversation compacted';
        const parts: string[] = [];
        if (e.tokensRemoved) parts.push(`~${(e.tokensRemoved / 1000).toFixed(0)}K tokens freed`);
        if (e.messageCount) parts.push(`${e.messageCount} messages`);
        if (e.inputTokens && e.outputTokens) {
          const totalK = ((e.inputTokens + e.outputTokens) / 1000).toFixed(0);
          parts.push(`${totalK}K tokens before compact`);
        }
        if (parts.length > 0) msg += ' — ' + parts.join(', ');
        setMessages((prev) => [...prev, { role: 'system' as const, content: msg, id: crypto.randomUUID(), timestamp: new Date().toISOString() }]);
        break;
      }

      case 'session.waiting':
      case 'session.completed':
      case 'session.aborted': {
        finalizeStream();
        if (event.type === 'session.completed') {
          const e = event as { exitCode: number };
          if (e.exitCode !== 0) {
            setMessages((prev) => [...prev, { role: 'system', content: `Process exited with code ${e.exitCode}`, id: crypto.randomUUID(), timestamp: new Date().toISOString() }]);
          }
        } else if (event.type === 'session.aborted') {
          setMessages((prev) => [...prev, { role: 'system', content: 'Generation aborted.', id: crypto.randomUUID(), timestamp: new Date().toISOString() }]);
        }
        break;
      }

      case 'chat.error':
      case 'session.error': {
        finalizeStream();
        const err = event as ChatErrorEvent;
        setMessages((prev) => [...prev, { role: 'error', content: err.message, id: crypto.randomUUID(), timestamp: new Date().toISOString() }]);
        break;
      }
    }
    scrollToBottom();
  }, [pushEvent, chatId, tabId, resetStreamTimer, appendToStream, finalizeStream, scrollToBottom, stopThinkingTimer, setTabStatus, updateChatLastMessage]);

  // ── WebSocket ──

  const { connect, send, close } = useWebSocket({
    url: `ws://${location.host}/ws`,
    onMessage: (msg) => {
      if ('chatId' in msg && msg.chatId !== chatId) return;
      if (msg.type === 'event') {
        const event = msg.event as AppEvent;
        if (msg.subagentId) {
          useSubagentStore.getState().pushEvent(msg.subagentId, event);
        } else {
          handleEvent(event);
        }
      } else if (msg.type === 'session_ready') {
        updateChatSessionId(tabId, chatId, msg.sessionId);
      } else if (msg.type === 'session_exit') {
        finalizeStream();
      } else if (msg.type === 'aborted') {
        finalizeStream();
        setMessages((prev) => [...prev, { role: 'system', content: 'Generation aborted.', id: crypto.randomUUID(), timestamp: new Date().toISOString() }]);
      } else if (msg.type === 'subagent_ready') {
        useSubagentStore.getState().markReady(msg.subagentId);
      } else if (msg.type === 'subagent_exit') {
        useSubagentStore.getState().markExit(msg.subagentId, msg.exitCode);
      } else if (msg.type === 'subagent_aborted') {
        useSubagentStore.getState().markExit(msg.subagentId, -1);
      }
    },
    onOpen: () => {},
    onClose: () => { finalizeStream(); },
  });

  useEffect(() => { connect(); return () => close(); }, [connect]);

  // ── Subagent listeners ──

  useEffect(() => {
    const modelEnv = useSettingsStore.getState().getEnvVarsForModel(selectedModel);
    const onSpawn = (e: Event) => {
      const { subagentId, task, env } = (e as CustomEvent).detail;
      const mergedEnv = { ...modelEnv, ...env };
      send({
        type: 'subagent:start',
        chatId,
        subagentId,
        task,
        workDir,
        env: Object.keys(mergedEnv).length > 0 ? mergedEnv : undefined,
      });
    };
    const onAbort = (e: Event) => {
      const { subagentId } = (e as CustomEvent).detail;
      send({ type: 'subagent:abort', subagentId });
    };
    window.addEventListener('cc-gui:subagent-spawn', onSpawn);
    window.addEventListener('cc-gui:subagent-abort', onAbort);
    return () => {
      window.removeEventListener('cc-gui:subagent-spawn', onSpawn);
      window.removeEventListener('cc-gui:subagent-abort', onAbort);
    };
  }, [send, chatId, workDir, selectedModel]);

  // ── History loading ──

  useEffect(() => {
    if (!chatSessionId || messages.length > 0 || !workDir) return;
    if (markHistoryAttempted(chatSessionId)) return;
    fetch(`/api/sessions/read?base=${encodeURIComponent(workDir)}&id=${chatSessionId}`)
      .then(r => r.json())
      .then(data => {
        if (data.messages) {
          const { msgs, thinkBlocks } = reconstructHistory(data.messages);
          setMessages(msgs);
          setThinkingBlocks(thinkBlocks);
          const expanded = new Set<string>();
          for (const [id] of thinkBlocks) expanded.add(id);
          setThinkingExpanded(expanded);
        }
      })
      .catch((err) => { log.warn('Failed to load session history', err instanceof Error ? { message: err.message } : undefined); });
  }, [chatSessionId, messages.length, workDir]);

  // ── Auto title generation ──

  const updateChatTitle = useTabStore((s) => s.updateChatTitle);

  const generateChatTitle = useCallback(async () => {
    const env: Record<string, string> = {};
    const settingsEnv = useSettingsStore.getState().getEnvVarsForModel(selectedModel);
    for (const [key, value] of Object.entries(settingsEnv)) {
      if (value) env[key] = value;
    }
    const model = ALL_MODELS.find(m => m.id === selectedModel);
    if (model?.subagentModel) {
      env.ANTHROPIC_MODEL = model.subagentModel;
    } else if (model?.provider === 'anthropic') {
      env.ANTHROPIC_MODEL = 'claude-3-5-haiku-20241022';
    }
    if (selectedEffort) {
      env.CLAUDE_CODE_EFFORT_LEVEL = selectedEffort;
    }

    try {
      const res = await fetch('/api/chats/generate-title', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, workDir, env }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.title) {
          updateChatTitle(tabId, chatId, data.title);
        }
      }
    } catch {
      // Silently fail — titles are non-critical
    }
  }, [messages, workDir, selectedModel, selectedEffort, tabId, chatId, updateChatTitle]);

  useEffect(() => {
    if (isStreaming) return;
    if (messages.length === 0) return;
    if (!hasSentRef.current) return;

    const state = useSettingsStore.getState();
    if (!state.autoTitleEnabled || !state.autoTitleTiers.length) return;

    const meaningfulCount = messages.filter(m => m.role === 'user' || m.role === 'assistant').length;
    if (meaningfulCount < 2) return;

    const match = state.autoTitleTiers.find(t => meaningfulCount <= t.upTo);
    const currentInterval = match?.every ?? state.autoTitleTiers[state.autoTitleTiers.length - 1].every;

    const isFirstGen = lastTitleGenRef.current === 0;
    const thresholdReached = isFirstGen
      ? meaningfulCount >= 2
      : meaningfulCount >= lastTitleGenRef.current + currentInterval;

    if (thresholdReached) {
      lastTitleGenRef.current = meaningfulCount;
      generateChatTitle();
    }
  }, [messages, isStreaming, generateChatTitle]);

  // ── Handle send ──

  const handleSend = useCallback(() => {
    const prompt = input.trim();
    if (!prompt || isStreaming) return;
    setIsStreaming(true);
    setTabStatus(chatId, 'streaming');
    setInput('');
    if (!hasSentRef.current) {
      hasSentRef.current = true;
      activateChat(tabId, chatId);
    }
    useEventBus.getState().clearTasks();
    setMessages((prev) => [...prev, { role: 'user', content: prompt, id: crypto.randomUUID(), timestamp: new Date().toISOString() }]);
    updateChatLastMessage(tabId, chatId);

    const env: Record<string, string> = {};
    const settingsEnv = useSettingsStore.getState().getEnvVarsForModel(selectedModel);
    for (const [key, value] of Object.entries(settingsEnv)) {
      if (value) env[key] = value;
    }
    if (selectedEffort) {
      env.CLAUDE_CODE_EFFORT_LEVEL = selectedEffort;
    }

    resetStreamTimer();
    send({
      type: 'prompt', workDir, prompt, permissionMode,
      env: Object.keys(env).length > 0 ? env : undefined,
      resumeSessionId: chatSessionId,
      _chatId: chatId,
    });
    currentThinkingIdRef.current = null;
  }, [input, isStreaming, chatId, tabId, workDir, permissionMode, selectedModel, selectedEffort, chatSessionId, resetStreamTimer, send, setTabStatus, activateChat, updateChatLastMessage]);

  // ── Thinking block expand handler (placed here to access setThinkingExpanded / setCollapsedSegments) ──

  const handleToggleThinkingExpand = useCallback((msgId: string, block: ThinkingBlock) => {
    const wasOpen = thinkingExpanded.has(msgId);
    setThinkingExpanded((prev) => {
      const next = new Set(prev);
      next.has(msgId) ? next.delete(msgId) : next.add(msgId);
      return next;
    });
    const isRunning = block.segments.some(s => s.kind === 'tool' && s.tool.status === 'running');
    if (!wasOpen && !isRunning && block.segments.length > 1) {
      setCollapsedSegments((prev) => {
        const next = new Set(prev);
        for (let i = 1; i < block.segments.length; i++) {
          next.add(block.segments[i].id);
        }
        next.delete(block.segments[0].id);
        return next;
      });
    }
  }, [thinkingExpanded]);

  // ── Return everything the component needs ──

  return {
    // State
    messages,
    thinkingBlocks,
    thinkingExpanded,
    collapsedSegments,
    isStreaming,
    input,
    // Setters
    setInput,
    // Refs
    messagesEndRef,
    thinkingBlocksRef,
    // Actions
    handleSend,
    handleSegmentClick,
    isSegmentCollapsed,
    handleToggleThinkingExpand,
  };
}
