import { useState, useRef, useEffect, useCallback } from 'react';
import type { AppEvent, ChatAssistantEvent, ChatThinkingEvent, ChatErrorEvent, ToolStartedEvent, ToolCompletedEvent, FileEvent, FileChangedEvent, SessionCompactedEvent } from '@cc-gui/shared';
import { StreamTimeline } from '@cc-gui/shared';
import { useTabStore } from '../store';
import { useEventBus } from '../store/eventBus';
import { useSettingsStore, ALL_MODELS } from '../store/settingsStore';
import { useWebSocket } from './useWebSocket';
import { useSubagentStore } from '../store/subagentStore';
import { useDiffStore } from '../store/diffStore';
import { createFrontendLogger } from '../logger';
import type { ChatMessage, ThinkingBlock, ThinkingTool, ThinkingFile, ThinkingSegment } from '../lib/chat/types';
import { thinkingSummary } from '../lib/chat/thinking-utils';
import { reconstructHistory } from '../lib/chat/history-reconstruction';

// ==================== Module-level guards ====================

/** Cache for successfully loaded session histories — survives ChatPanel unmount/remount.
 *  Uses Map for O(1) lookup. LRU-evicted at HISTORY_CACHE_MAX entries. */
const historyCache = new Map<string, { msgs: ChatMessage[]; thinkBlocks: Map<string, ThinkingBlock> }>();
const HISTORY_CACHE_MAX = 50;

function getCachedHistory(sessionId: string) {
  return historyCache.get(sessionId) ?? null;
}

function cacheHistory(sessionId: string, msgs: ChatMessage[], thinkBlocks: Map<string, ThinkingBlock>) {
  // LRU eviction: remove oldest entry when at capacity
  if (historyCache.size >= HISTORY_CACHE_MAX) {
    const firstKey = historyCache.keys().next().value;
    if (firstKey) historyCache.delete(firstKey);
  }
  historyCache.set(sessionId, { msgs, thinkBlocks });
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
  const [ptyApprovalPending, setPtyApprovalPending] = useState(false);
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
  const timelineRef = useRef<StreamTimeline | null>(null);
  const imagesRef = useRef<Array<{ base64: string; mediaType: string }>>([]);
  const filesRef = useRef<Array<{ text: string; fileName: string; mimeType: string }>>([]);
  const abortedRef = useRef(false);
  const pendingQuestionRef = useRef<{
    toolUseId: string;
    question: string;
    options: Array<{ label: string; description: string }>;
  } | null>(null);

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
    // ── Diagnostic: log stream state at finalization (for debugging cut responses) ──
    const wasStreaming = !!streamMsgIdRef.current;
    const contentLen = streamContentRef.current.length;
    log.debug('finalizeStream', {
      hadActiveMsg: wasStreaming,
      contentLen,
      msgCount: messages.length,
      thinkCount: thinkingBlocks.size,
      timerActive: !!streamTimerRef.current,
    });

    // ── Timeline: log finalize BEFORE clearing refs ──
    if (timelineRef.current) {
      // Synthetic event for logging purposes
      const synthEvent = { id: 'finalize', type: 'stream.finalize', sessionId: chatSessionId || '' };
      timelineRef.current.recordProcess(synthEvent, {
        action: 'finalize_stream',
        streamMsgIdRef: streamMsgIdRef.current,
        currentThinkingIdRef: currentThinkingIdRef.current,
        messageCount: messages.length,
        thinkingBlockCount: thinkingBlocks.size,
      });
    }

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
    setPtyApprovalPending(false);
    setTabStatus(chatId, 'idle');
    if (streamTimerRef.current) { clearTimeout(streamTimerRef.current); streamTimerRef.current = null; }
  }, [stopThinkingTimer, chatId, setTabStatus]);

  const resetStreamTimer = useCallback(() => {
    if (streamTimerRef.current) clearTimeout(streamTimerRef.current);
    streamTimerRef.current = setTimeout(() => {
      log.warn('stream timer fired — timeout', {
        hadContent: streamContentRef.current.length,
        hadMsg: !!streamMsgIdRef.current,
        msgCount: messages.length,
      });
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
    // ── Abort guard: ignore all events after user clicked Stop ──
    if (abortedRef.current) return;

    // Reset stream timer on EVERY event — Claude can spend >120s in
    // thinking/tool phases with no text output, which would previously
    // trigger a false timeout and cut responses mid-stream.
    resetStreamTimer();

    pushEvent(event, chatId);

    switch (event.type) {
      case 'chat.assistant': {
        const text = (event as ChatAssistantEvent).content;
        if (!streamMsgIdRef.current) {
          const id = crypto.randomUUID();
          streamMsgIdRef.current = id;
          streamContentRef.current = text;
          updateChatLastMessage(tabId, chatId);
          setMessages((prev) => [...prev, { role: 'assistant', content: text, id, timestamp: new Date().toISOString() }]);
          timelineRef.current?.recordProcess(event, {
            action: 'new_message',
            targetMsgId: id,
            streamMsgIdRef: id,
            currentThinkingIdRef: currentThinkingIdRef.current,
          });
        } else {
          appendToStream(text);
          timelineRef.current?.recordProcess(event, {
            action: 'append_message',
            targetMsgId: streamMsgIdRef.current,
            currentThinkingIdRef: currentThinkingIdRef.current,
          });
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
          timelineRef.current?.recordProcess(event, {
            action: 'new_block',
            targetBlockId: id,
            targetSegmentId: segId,
            currentThinkingIdRef: id,
          });
        } else {
          // Determine whether this appends to last segment or creates new
          const block = thinkingBlocksRef.current.get(currentThinkingIdRef.current!);
          const lastSeg = block?.segments[block.segments.length - 1];
          const isAppend = lastSeg?.kind === 'thinking';

          setThinkingBlocks((prev) => {
            const next = new Map(prev);
            const b = next.get(currentThinkingIdRef.current!);
            if (!b) return next;
            const segs = [...b.segments];
            const last = segs[segs.length - 1];
            if (last && last.kind === 'thinking') {
              segs[segs.length - 1] = { ...last, text: last.text + e.content };
            } else {
              segs.push({ id: crypto.randomUUID(), kind: 'thinking', text: e.content, summary: '' });
            }
            next.set(currentThinkingIdRef.current!, { ...b, segments: segs });
            return next;
          });
          timelineRef.current?.recordProcess(event, {
            action: isAppend ? 'append_segment' : 'new_segment',
            targetBlockId: currentThinkingIdRef.current,
            currentThinkingIdRef: currentThinkingIdRef.current,
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
        timelineRef.current?.recordProcess(event, {
          action: 'tool_started',
          targetBlockId: currentThinkingIdRef.current,
          targetSegmentId: toolId,
          currentThinkingIdRef: currentThinkingIdRef.current,
        });

        // ── Detect AskUserQuestion: show answer UI ──
        if (e.toolUseId && /AskUserQuestion|question/i.test(e.toolName)) {
          const qInput = e.toolInput as {
            question?: string;
            options?: Array<{ label: string; description: string }>;
          };
          const question = qInput.question || JSON.stringify(e.toolInput);
          const options = qInput.options || [];
          pendingQuestionRef.current = { toolUseId: e.toolUseId, question, options };

          const optsText = options.length > 0
            ? '\n' + options.map((o, i) => `  ${i + 1}. ${o.label}${o.description ? ' — ' + o.description : ''}`).join('\n')
            : '';
          setMessages((prev) => [...prev, {
            id: crypto.randomUUID(),
            role: 'system' as const,
            content: `❓ ${question}${optsText}\n\n_Reply with your answer below_`,
            timestamp: new Date().toISOString(),
          }]);
        }
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
        timelineRef.current?.recordProcess(event, {
          action: 'tool_completed',
          targetBlockId: currentThinkingIdRef.current,
          currentThinkingIdRef: currentThinkingIdRef.current,
        });

        if (e.files && e.files.length > 0 && e.diff) {
          const diffStore = useDiffStore.getState();
          for (const f of e.files) {
            diffStore.addChange(chatId, {
              path: f,
              type: 'modified',
              diff: e.diff,
              timestamp: new Date().toISOString(),
            });
          }
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
        timelineRef.current?.recordProcess(event, {
          action: 'file_event',
          targetBlockId: currentThinkingIdRef.current,
          currentThinkingIdRef: currentThinkingIdRef.current,
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
          const newFile: ThinkingFile = { type: e.changeType === 'modified' ? 'changed' : e.changeType, path: e.path, diff: e.patch };
          const last = segs[segs.length - 1];
          if (last && last.kind === 'files') {
            segs[segs.length - 1] = { ...last, files: [...last.files, newFile] };
          } else {
            segs.push({ id: crypto.randomUUID(), kind: 'files', files: [newFile] });
          }
          next.set(id, { ...block, segments: segs });
          return next;
        });
        timelineRef.current?.recordProcess(event, {
          action: 'file_event',
          targetBlockId: currentThinkingIdRef.current,
          currentThinkingIdRef: currentThinkingIdRef.current,
        });

        const diffStore = useDiffStore.getState();
        diffStore.addChange(chatId, {
          path: e.path,
          type: e.changeType,
          diff: e.patch,
          timestamp: new Date().toISOString(),
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
        timelineRef.current?.recordProcess(event, { action: 'compacted' });
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
        timelineRef.current?.recordProcess(event, { action: event.type.replace('session.', '') });
        break;
      }

      case 'chat.error':
      case 'session.error': {
        finalizeStream();
        const err = event as ChatErrorEvent;
        setMessages((prev) => [...prev, { role: 'error', content: err.message, id: crypto.randomUUID(), timestamp: new Date().toISOString() }]);
        timelineRef.current?.recordProcess(event, { action: 'error' });
        break;
      }
    }
  }, [pushEvent, chatId, tabId, resetStreamTimer, appendToStream, finalizeStream, stopThinkingTimer, setTabStatus, updateChatLastMessage]);

  // ── WebSocket ──

  const { connect, send, close } = useWebSocket({
    url: `ws://${location.host}/ws`,
    onMessage: (msg) => {
      // ── Catchup: replay buffered events ──
      if (msg.type === 'catchup_events') {
        const m = msg as { type: 'catchup_events'; chatId: string; events: AppEvent[] };
        console.log(`[useChatStream] catchup events: chat=[${m.chatId.slice(0, 8)}] count=${m.events.length}`);
        if (m.events.length > 0) {
          for (const event of m.events) { handleEvent(event); }
        }
        return;
      }

      if (msg.type === 'catchup_done') {
        const m = msg as { type: 'catchup_done'; chatId: string };
        console.log(`[useChatStream] catchup done: chat=[${m.chatId.slice(0, 8)}]`);
        return;
      }

      if ('chatId' in msg && msg.chatId !== chatId) {
        // Message for a different chat — silently skip (logged only for assistant events to avoid noise)
        if (msg.type === 'event') {
          const event = msg.event as AppEvent;
          if (event.type === 'chat.assistant' || event.type === 'session.completed' || event.type === 'session.error') {
            console.log(`[useChatStream] WS SKIP: [${(msg.chatId as string).slice(0,8)}] ≠ ours [${chatId.slice(0,8)}] (${event.type})`);
          }
        }
        return;
      }
      if (msg.type === 'event') {
        const event = msg.event as AppEvent;
        const subagentId = msg.subagentId;

        // ── Stream Timeline: init on first event ──
        if (!timelineRef.current) {
          timelineRef.current = new StreamTimeline(event.sessionId, chatId);
          timelineRef.current.start();
        }

        // ── Timeline: record backend send (using _sentAt from WS envelope) ──
        if (msg._sentAt) {
          timelineRef.current.recordSend(event, chatId, subagentId);
        }

        // ── Timeline: record frontend receive ──
        timelineRef.current.recordRecv(event, chatId, subagentId);

        if (subagentId) {
          useSubagentStore.getState().pushEvent(subagentId, event);
        } else {
          handleEvent(event);
        }
      } else if (msg.type === 'session_ready') {
        console.log(`[useChatStream] SESSION READY: chat=[${chatId.slice(0,8)}] sid=[${msg.sessionId.slice(0,8)}]`);
        updateChatSessionId(tabId, chatId, msg.sessionId);
      } else if (msg.type === 'session_exit') {
        abortedRef.current = false;
        finalizeStream();
      } else if (msg.type === 'aborted') {
        abortedRef.current = false;
        finalizeStream();
        setMessages((prev) => [...prev, { role: 'system', content: 'Generation aborted.', id: crypto.randomUUID(), timestamp: new Date().toISOString() }]);
      } else if (msg.type === 'subagent_ready') {
        useSubagentStore.getState().markReady(msg.subagentId);
      } else if (msg.type === 'subagent_exit') {
        useSubagentStore.getState().markExit(msg.subagentId, msg.exitCode);
      } else if (msg.type === 'subagent_aborted') {
        useSubagentStore.getState().markExit(msg.subagentId, -1);
      } else if (msg.type === 'pty_data') {
        // PTY mode: append raw terminal output as a message
        // Strip ALL ANSI escape sequences (ECMA-48 compliant).
        // CSI: ESC [ <parameter bytes 0x30-3F> <intermediate bytes 0x20-2F> <final byte 0x40-7E>
        // OSC: ESC ] ... BEL or ESC \
        // Remaining single-char escapes and control chars.
        const stripAllAnsi = (raw: string): string =>
          raw
            .replace(/\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g, '')
            .replace(/\x1b\][^\x07]*\x07/g, '')
            .replace(/\x1b\][^\x1b]*\x1b\\/g, '')
            .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
            .replace(/\x1b[=>]|[\x7f]/g, '');
        const plainText = stripAllAnsi(msg.data).trim();
        log.debug('pty_data received', { len: msg.data.length, plainLen: plainText.length, approval: msg.approvalDetected, question: msg.questionDetected, preview: plainText.slice(0, 100) });
        if (plainText) {
          setMessages((prev) => {
            // Try to append to the last system message if recently updated
            const last = prev[prev.length - 1];
            const now = Date.now();
            if (last && last.role === 'system' && last.timestamp && (now - new Date(last.timestamp).getTime() < 2000)) {
              const updated = [...prev];
              updated[updated.length - 1] = { ...last, content: last.content + '\n' + plainText };
              return updated;
            }
            return [...prev, {
              id: crypto.randomUUID(),
              role: 'system' as const,
              content: plainText,
              timestamp: new Date().toISOString(),
            }];
          });
        }
        // If approval is detected, set PTY pending state for PermissionBar
        if (msg.approvalDetected) {
          setPtyApprovalPending(true);
        }
        if (msg.questionDetected) {
          setTabStatus(chatId, 'streaming');
        }
      }
    },
    onOpen: () => {
      console.log(`[useChatStream] WS OPEN: chat=[${chatId.slice(0,8)}]`);
    },
    onClose: () => {
      console.log(`[useChatStream] WS CLOSE: chat=[${chatId.slice(0,8)}]`);
      finalizeStream();
      if (timelineRef.current) { timelineRef.current.stop(); timelineRef.current = null; }
    },
  });

  useEffect(() => { connect(); return () => close(); }, [connect]);

  // ── Catchup: request buffered events on mount ──
  useEffect(() => {
    if (!chatId) return;
    console.log(`[useChatStream] catchup request: chat=[${chatId.slice(0, 8)}]`);
    send({ type: 'catchup', chatId });
  }, [chatId, send]);

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
  // Uses module-level cache for instant restore on chat switch (no re-fetch).
  // Only caches on SUCCESS — failures retry on next mount.

  useEffect(() => {
    if (!chatSessionId || messages.length > 0 || !workDir) return;

    // Check cache first: if we've already loaded this session's history,
    // restore it instantly without a network request.
    const cached = getCachedHistory(chatSessionId);
    if (cached) {
      console.log(`[useChatStream] history CACHE HIT: sid=[${chatSessionId.slice(0,8)}] ${cached.msgs.length} msgs restored instantly`);
      setMessages(cached.msgs);
      setThinkingBlocks(cached.thinkBlocks);
      const expanded = new Set<string>();
      for (const [id] of cached.thinkBlocks) expanded.add(id);
      setThinkingExpanded(expanded);
      return;
    }

    console.log(`[useChatStream] history FETCH: sid=[${chatSessionId.slice(0,8)}] workDir=[${workDir}]`);
    fetch(`/api/sessions/read?base=${encodeURIComponent(workDir)}&id=${chatSessionId}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
        return r.json();
      })
      .then(data => {
        if (data.messages) {
          const { msgs, thinkBlocks } = reconstructHistory(data.messages);
          cacheHistory(chatSessionId, msgs, thinkBlocks);
          console.log(`[useChatStream] history LOADED: sid=[${chatSessionId.slice(0,8)}] ${msgs.length} msgs cached`);
          setMessages(msgs);
          setThinkingBlocks(thinkBlocks);
          const expanded = new Set<string>();
          for (const [id] of thinkBlocks) expanded.add(id);
          setThinkingExpanded(expanded);
        } else {
          console.log(`[useChatStream] history EMPTY: sid=[${chatSessionId.slice(0,8)}] no messages in response`);
        }
      })
      .catch((err) => {
        console.warn(`[useChatStream] history FAILED: sid=[${chatSessionId.slice(0,8)}] error=[${err instanceof Error ? err.message : String(err)}] — will retry on next mount`);
        log.warn('Failed to load session history', err instanceof Error ? { message: err.message } : undefined);
      });
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

    const hasKey = !!env.ANTHROPIC_API_KEY;
    log.debug('generateChatTitle: starting', { model: env.ANTHROPIC_MODEL, hasKey, baseUrl: env.ANTHROPIC_BASE_URL, msgCount: messages.length });

    try {
      const res = await fetch('/api/chats/generate-title', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, workDir, env }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.title) {
          log.info('generateChatTitle: title set', { title: data.title });
          updateChatTitle(tabId, chatId, data.title);
        } else {
          log.warn('generateChatTitle: response missing title', data);
        }
      } else {
        log.warn('generateChatTitle: API returned non-ok', { status: res.status });
      }
    } catch (err) {
      log.warn('generateChatTitle: fetch failed', err instanceof Error ? { message: err.message } : undefined);
    }
  }, [messages, workDir, selectedModel, selectedEffort, tabId, chatId, updateChatTitle]);

  useEffect(() => {
    if (isStreaming) return;
    if (messages.length === 0) return;
    if (!hasSentRef.current) return;

    const state = useSettingsStore.getState();
    if (!state.autoTitleEnabled || !state.autoTitleTiers.length) {
      if (hasSentRef.current && messages.length >= 2) {
        log.debug('generateChatTitle: disabled by settings', { autoTitleEnabled: state.autoTitleEnabled, tiersLength: state.autoTitleTiers.length });
      }
      return;
    }

    const meaningfulCount = messages.filter(m => m.role === 'user' || m.role === 'assistant').length;
    if (meaningfulCount < 2) return;

    const match = state.autoTitleTiers.find(t => meaningfulCount <= t.upTo);
    const currentInterval = match?.every ?? state.autoTitleTiers[state.autoTitleTiers.length - 1].every;

    const isFirstGen = lastTitleGenRef.current === 0;
    const thresholdReached = isFirstGen
      ? meaningfulCount >= 2
      : meaningfulCount >= lastTitleGenRef.current + currentInterval;

    if (thresholdReached) {
      log.debug('generateChatTitle: threshold reached', { meaningfulCount, isFirstGen, currentInterval, lastGen: lastTitleGenRef.current });
      lastTitleGenRef.current = meaningfulCount;
      generateChatTitle();
    }
  }, [messages, isStreaming, generateChatTitle]);

  // ── Handle send ──

  const handleSend = useCallback(() => {
    const prompt = input.trim();
    if (!prompt || isStreaming) return;
    console.log(`[useChatStream] SEND: chat=[${chatId.slice(0,8)}] sessionId=[${chatSessionId?.slice(0,8) || 'none'}] prompt="${prompt.slice(0,60)}"`);
    abortedRef.current = false;
    setIsStreaming(true);
    setTabStatus(chatId, 'streaming');
    setInput('');
    if (!hasSentRef.current) {
      hasSentRef.current = true;
      activateChat(tabId, chatId);
    }
    useEventBus.getState().clearTasks();
    // Build prompt content with images + files if attached
    const images = imagesRef.current;
    const files = filesRef.current;
    const hasImages = images.length > 0;
    const hasFiles = files.length > 0;

    // Construct the text prompt: user's message + file contents inline
    let finalText = prompt;
    if (hasFiles) {
      const fileBlocks = files.map(f => `--- ${f.fileName} ---\n${f.text}\n--- end ${f.fileName} ---`).join('\n\n');
      finalText = `${prompt}\n\nAttached files:\n\n${fileBlocks}`;
    }

    // Content array: if we have images, use Anthropic content blocks; otherwise plain text
    const promptContent: string | unknown[] = hasImages
      ? [
          { type: 'text', text: finalText },
          ...images.map(img => ({
            type: 'image',
            source: { type: 'base64', media_type: img.mediaType, data: img.base64 },
          })),
        ]
      : finalText;

    // Display text shown in the chat bubble
    const parts: string[] = [];
    if (hasImages) parts.push(`${images.length} image${images.length > 1 ? 's' : ''}`);
    if (hasFiles) parts.push(`${files.length} file${files.length > 1 ? 's' : ''}`);
    const attachmentsNote = parts.length > 0 ? `\n\n[${parts.join(' + ')} attached]` : '';
    const displayText = prompt + attachmentsNote;

    setMessages((prev) => [...prev, {
      role: 'user',
      content: displayText,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      images: hasImages ? images : undefined,
      files: hasFiles ? files.map(f => ({ text: f.text, fileName: f.fileName, mimeType: f.mimeType })) : undefined,
    }]);
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
      type: 'prompt', workDir, prompt: promptContent, permissionMode,
      env: Object.keys(env).length > 0 ? env : undefined,
      resumeSessionId: chatSessionId,
      _chatId: chatId,
      usePty: false, // Stream-json mode: structured events + interactive stdin for questions
    });
    currentThinkingIdRef.current = null;
    imagesRef.current = [];
    filesRef.current = [];

    // ── Stream Timeline: stop old, start fresh for new turn ──
    if (timelineRef.current) {
      timelineRef.current.stop();
      timelineRef.current = null;
    }
  }, [input, isStreaming, chatId, tabId, workDir, permissionMode, selectedModel, selectedEffort, chatSessionId, resetStreamTimer, send, setTabStatus, activateChat, updateChatLastMessage]);

  // ── Answer a pending AskUserQuestion ──

  const answerQuestion = useCallback((answer: string) => {
    const pending = pendingQuestionRef.current;
    if (!pending) return;
    log.info('answering question', { toolUseId: pending.toolUseId.slice(0, 12), answerLen: answer.length });
    send({
      type: 'tool:result',
      sessionId: chatSessionId || '',
      toolUseId: pending.toolUseId,
      content: answer,
    });
    pendingQuestionRef.current = null;
  }, [send, chatSessionId]);

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
    ptyApprovalPending,
    input,
    // Setters
    setInput,
    // Refs
    messagesEndRef,
    thinkingBlocksRef,
    // Actions
    handleSend,
    abort: () => {
      abortedRef.current = true;
      send({ type: 'abort' });
    },
    sendWs: send,
    handleSegmentClick,
    isSegmentCollapsed,
    handleToggleThinkingExpand,
    // Image paste
    imagesRef,
    // File attachments
    filesRef,
    // AskUserQuestion handling
    answerQuestion,
    pendingQuestionRef,
    // PTY permission handling
    clearPtyApproval: () => setPtyApprovalPending(false),
  };
}
