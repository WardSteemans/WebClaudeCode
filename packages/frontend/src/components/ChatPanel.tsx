import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { AppEvent, ChatAssistantEvent, ChatThinkingEvent, ChatErrorEvent, ToolStartedEvent, ToolCompletedEvent, FileEvent, SessionCompactedEvent } from '@cc-gui/shared';
import { useTabStore } from '../store';
import { useEventBus } from '../store/eventBus';
import { useSettingsStore, ALL_MODELS } from '../store/settingsStore';
import { useWebSocket } from '../hooks/useWebSocket';
import { useSubagentStore } from '../store/subagentStore';
import { ChevronDown, ChevronRight, Check, X, Loader, FileText, Terminal, Eye, Wrench } from 'lucide-react';
import { PromptInput } from './PromptInput';
import { FolderPicker } from './FolderPicker';

// ==================== Types ====================

interface ChatMessage {
  role: 'user' | 'assistant' | 'tool' | 'error' | 'system';
  content: string;
  id: string;
  timestamp: string; // ISO 8601
}

interface ThinkingTool {
  id: string;
  name: string;
  detail: string;  // short description (query, url, args)
  status: 'running' | 'done' | 'error';
  durationMs?: number;
  output?: string;    // result summary
  diff?: string;      // file diff for write/edit tools
  files?: string[];   // files affected
}

interface ThinkingFile {
  type: 'read' | 'changed' | 'created' | 'deleted';
  path: string;
  diff?: string;
}

/** One segment in the thinking timeline — rendered in order */
type ThinkingSegment =
  | { id: string; kind: 'thinking'; text: string; summary: string }
  | { id: string; kind: 'tool'; tool: ThinkingTool }
  | { id: string; kind: 'files'; files: ThinkingFile[] };

interface ThinkingBlock {
  segments: ThinkingSegment[];
  secs: number;
  startTime: number;
}

/** Summary generated for a thinking segment (first sentence for now, AI later) */
function thinkingSummary(text: string): string {
  const first = text.trim().split(/[.。!！?\n]/)[0]?.trim();
  return first ? first.slice(0, 100) + (first.length > 100 ? '…' : '') : 'Thinking…';
}

/** Summary line for a tool segment when collapsed */
function toolSummaryLine(t: ThinkingTool): string {
  const statusIcon = t.status === 'running' ? '⏳' : t.status === 'done' ? '✅' : '❌';
  const dur = t.durationMs != null ? ` (${t.durationMs < 1000 ? `${t.durationMs}ms` : `${(t.durationMs / 1000).toFixed(1)}s`})` : '';
  const detail = t.detail ? ` ${t.detail}` : '';
  let result = '';
  if (t.status !== 'running' && t.output) {
    result = ' → ' + t.output.slice(0, 60).replace(/\n/g, ' ');
  }
  return `${statusIcon} ${t.name}${detail}${result}${dur}`;
}

/** Format ISO timestamp for chat display */
function formatChatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return time;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}

// ==================== Pasted Text Block Helper ====================

/** Regex to extract the line count from the marker */
const PASTED_LINE_RE = /---\s+Begin\s+\[Pasted text(?: #(\d+))? · (\d+) lines\]\s*---/;

interface PastedTextSegments {
  type: 'normal' | 'pasted';
  content: string;
  label?: string;
}

/**
 * Splits message content into segments: normal markdown and collapsed pasted-text blocks.
 */
function splitPastedBlocks(text: string): PastedTextSegments[] {
  const segments: PastedTextSegments[] = [];
  let lastIndex = 0;
  const regex = /---\s+Begin\s+\[Pasted text[^\]]*\]\s*---\n([\s\S]*?)\n---\s+End\s+\[Pasted text[^\]]*\]\s*---/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // Normal text before this block
    if (match.index > lastIndex) {
      segments.push({ type: 'normal', content: text.slice(lastIndex, match.index) });
    }
    // Extract label info
    const headerMatch = text.slice(match.index, match.index + match[0].length).match(PASTED_LINE_RE);
    const num = headerMatch?.[1] ? ` #${headerMatch[1]}` : '';
    const lines = headerMatch?.[2] || '?';
    segments.push({
      type: 'pasted',
      content: match[1],
      label: `📋 Pasted text${num} · ${lines} lines`,
    });
    lastIndex = match.index + match[0].length;
  }

  // Remaining normal text
  if (lastIndex < text.length) {
    segments.push({ type: 'normal', content: text.slice(lastIndex) });
  }

  return segments.length > 0 ? segments : [{ type: 'normal', content: text }];
}

/** Renders message content with pasted-text blocks collapsed by default. */
function MessageContent({ content }: { content: string }) {
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const segments = useMemo(() => splitPastedBlocks(content), [content]);

  return (
    <>
      {segments.map((seg, i) =>
        seg.type === 'normal' ? (
          <div key={i} className="[&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-slate-300 dark:[&_th]:border-slate-700 [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:border-slate-300 dark:[&_td]:border-slate-700 [&_td]:px-2 [&_td]:py-1 [&_strong]:text-slate-900 dark:[&_strong]:text-slate-100 [&_a]:text-accent-600 dark:[&_a]:text-accent-400 [&_a]:underline [&_code]:bg-slate-100 dark:[&_code]:bg-slate-700/50 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[13px] [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_p]:mb-1.5 [&_p:last-child]:mb-0 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-medium">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{seg.content}</ReactMarkdown>
          </div>
        ) : (
          <div key={i} className="mb-2 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
            <button
              onClick={() => setExpanded((prev) => ({ ...prev, [i]: !prev[i] }))}
              className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-xs font-medium bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 transition-colors"
            >
              <span className="text-[10px]">{expanded[i] ? '▼' : '▶'}</span>
              <span>{seg.label}</span>
            </button>
            {expanded[i] && (
              <div className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400 max-h-64 overflow-y-auto border-t border-slate-200 dark:border-slate-700">
                <pre className="whitespace-pre-wrap font-sans leading-relaxed">{seg.content}</pre>
              </div>
            )}
          </div>
        )
      )}
    </>
  );
}

// ==================== History Reconstruction ====================

interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
  blocks: Array<{ type: string; [key: string]: any }>;
  timestamp: string | null;
}

/**
 * Reconstruct ChatMessage[] and ThinkingBlock map from raw history data.
 * Preserves thinking blocks, tool calls, and tool results.
 */
function reconstructHistory(raw: HistoryMessage[]): {
  msgs: ChatMessage[];
  thinkBlocks: Map<string, ThinkingBlock>;
} {
  const msgs: ChatMessage[] = [];
  const thinkBlocks = new Map<string, ThinkingBlock>();
  // Track tool IDs → their parent thinking block for wiring up results
  const toolToBlock = new Map<string, string>();

  for (const m of raw) {
    if (m.role === 'user') {
      // Check for tool_result blocks — wire them up to existing thinking blocks
      const toolResults = (m.blocks || []).filter((b: any) => b.type === 'tool_result');
      if (toolResults.length > 0) {
        for (const tr of toolResults) {
          const blockId = toolToBlock.get(tr.tool_use_id || '');
          if (blockId) {
            const block = thinkBlocks.get(blockId);
            if (block) {
              const segs = block.segments.map((seg) => {
                if (seg.kind === 'tool' && seg.tool.name && seg.tool.status === 'done') {
                  // Match by finding first tool without output
                  if (!seg.tool.output && tr.content) {
                    const output = typeof tr.content === 'string' ? tr.content.slice(0, 200) : JSON.stringify(tr.content).slice(0, 200);
                    return { ...seg, tool: { ...seg.tool, output } };
                  }
                }
                return seg;
              });
              thinkBlocks.set(blockId, { ...block, segments: segs });
            }
          }
        }
        // Don't add tool_result-only user messages as separate chat messages
        const hasTextBlocks = (m.blocks || []).some((b: any) => b.type === 'text' && b.text);
        if (hasTextBlocks || toolResults.length === 0) {
          msgs.push({ role: 'user', content: m.content, id: crypto.randomUUID(), timestamp: m.timestamp || new Date().toISOString() });
        }
        continue;
      }
      // Regular user message
      msgs.push({ role: 'user', content: m.content, id: crypto.randomUUID(), timestamp: m.timestamp || new Date().toISOString() });
    } else if (m.role === 'assistant') {
      const blocks = m.blocks || [];
      const textBlocks = blocks.filter((b: any) => b.type === 'text' && b.text);
      const thinkBlocks_raw = blocks.filter((b: any) => b.type === 'thinking');
      const toolBlocks = blocks.filter((b: any) => b.type === 'tool_use');

      // If there are thinking/tool blocks, create a ThinkingBlock
      if (thinkBlocks_raw.length > 0 || toolBlocks.length > 0) {
        const blockId = crypto.randomUUID();
        const segments: ThinkingSegment[] = [];
        let startTime = Date.now();

        // Interleave thinking and tool blocks in original order
        for (const b of blocks) {
          if (b.type === 'thinking') {
            const text = b.thinking || '';
            segments.push({
              id: crypto.randomUUID(),
              kind: 'thinking',
              text,
              summary: thinkingSummary(text),
            });
          } else if (b.type === 'tool_use') {
            let detail = '';
            if (b.input?.query) detail = `"${String(b.input.query).slice(0, 60)}"`;
            else if (b.input?.url) detail = String(b.input.url).slice(0, 60);
            else if (b.input && Object.keys(b.input).length > 0) detail = JSON.stringify(b.input).slice(0, 80);

            const tool: ThinkingTool = {
              id: crypto.randomUUID(),
              name: b.name || 'unknown',
              detail,
              status: 'done', // history tools are always completed
            };
            segments.push({ id: tool.id, kind: 'tool', tool });
            toolToBlock.set(b.id, blockId);
          }
        }

        if (m.timestamp) startTime = new Date(m.timestamp).getTime();
        thinkBlocks.set(blockId, { segments, secs: 0, startTime });

        // Add a tool-type message for the thinking block
        msgs.push({ role: 'tool', content: '', id: blockId, timestamp: m.timestamp || new Date().toISOString() });
      }

      // Add the assistant text message if there's content
      const text = textBlocks.map((b: any) => b.text).join('\n');
      if (text) {
        msgs.push({ role: 'assistant', content: text, id: crypto.randomUUID(), timestamp: m.timestamp || new Date().toISOString() });
      }
    }
  }

  return { msgs, thinkBlocks };
}

// ==================== Module-level guards ====================

/** Session IDs for which we've already attempted to load history (survives remounts) */
const historyAttempted = new Set<string>();

interface ChatPanelProps { tabId: string; chatId: string; workDir: string; }

function ChatPanelInner({ tabId, chatId, workDir: _tabWorkDir }: ChatPanelProps) {
  const tab = useTabStore((s) => s.tabs.find((t) => t.id === tabId));
  const chat = tab?.chats.find((c) => c.id === chatId);
  const workDir = useMemo(() => chat?.workDir || _tabWorkDir, [chat?.workDir, _tabWorkDir]);
  const chatSessionId = chat?.sessionId ?? null;
  const updateChatSessionId = useTabStore((s) => s.updateChatSessionId);
  const activateChat = useTabStore((s) => s.activateChat);
  const updateChatWorkDir = useTabStore((s) => s.updateChatWorkDir);
  const updateChatLastMessage = useTabStore((s) => s.updateChatLastMessage);
  const pushEvent = useEventBus((s) => s.pushEvent);
  const setTabStatus = useEventBus((s) => s.setTabStatus);
  // Reactive subscription so model selector updates when keys load async
  const anthropicApiKey = useSettingsStore((s) => s.anthropicApiKey);
  const deepseekApiKey = useSettingsStore((s) => s.deepseekApiKey);
  const hasKey = (provider: string) => provider === 'anthropic' ? !!anthropicApiKey : !!deepseekApiKey;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [permissionMode, setPermissionMode] = useState(chat?.permissionMode || 'default');
  const [selectedModel, setSelectedModel] = useState(chat?.model || localStorage.getItem('cc-gui-model') || 'claude-sonnet-4-20250514');
  // Per-chat effort: seed from chat.effort; no global default so each chat is independent
  const [selectedEffort, setSelectedEffort] = useState(chat?.effort || '');
  const [thinkingBlocks, setThinkingBlocks] = useState<Map<string, ThinkingBlock>>(new Map());
  const [thinkingExpanded, setThinkingExpanded] = useState<Set<string>>(new Set());
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  // Segment IDs that are currently collapsed (auto or manual). Absent = expanded.
  const [collapsedSegments, setCollapsedSegments] = useState<Set<string>>(new Set());
  // Track click timing for single vs double-click
  const clickTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Stable ref to thinkingBlocks for use in callbacks that shouldn't re-trigger
  const thinkingBlocksRef = useRef<Map<string, ThinkingBlock>>(new Map());

  // Persist permission mode per-chat
  const updateChatPermissionMode = useTabStore((s) => s.updateChatPermissionMode);
  useEffect(() => { if (chat) updateChatPermissionMode(tabId, chatId, permissionMode); }, [permissionMode, tabId, chatId]);
  useEffect(() => { localStorage.setItem('cc-gui-model', selectedModel); }, [selectedModel]);
  // Persist model per-chat
  const updateChatModel = useTabStore((s) => s.updateChatModel);
  useEffect(() => { if (chat) updateChatModel(tabId, chatId, selectedModel); }, [selectedModel, tabId, chatId]);
  // Persist effort per-chat whenever it changes
  const updateChatEffort = useTabStore((s) => s.updateChatEffort);
  useEffect(() => { if (chat) updateChatEffort(tabId, chatId, selectedEffort || null); }, [selectedEffort, tabId, chatId]);
  // Keep ref in sync for callbacks that read thinkingBlocks without re-subscribing
  useEffect(() => { thinkingBlocksRef.current = thinkingBlocks; }, [thinkingBlocks]);

  const streamContentRef = useRef('');
  const streamMsgIdRef = useRef<string | null>(null);
  const currentThinkingIdRef = useRef<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const streamTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const thinkingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasSentRef = useRef(false);

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

  // ==================== Auto title generation ====================

  const updateChatTitle = useTabStore((s) => s.updateChatTitle);
  const lastTitleGenRef = useRef(0);

  const generateChatTitle = useCallback(async () => {
    // Build env vars matching the current model config
    const env: Record<string, string> = {};
    const settingsEnv = useSettingsStore.getState().getEnvVarsForModel(selectedModel);
    for (const [key, value] of Object.entries(settingsEnv)) {
      if (value) env[key] = value;
    }
    // Override to use the subagent (cheaper) model for title generation
    const model = ALL_MODELS.find(m => m.id === selectedModel);
    if (model?.subagentModel) {
      env.ANTHROPIC_MODEL = model.subagentModel;
    } else if (model?.provider === 'anthropic') {
      env.ANTHROPIC_MODEL = 'claude-3-5-haiku-20241022';
    }

    // Apply selected effort from chat toolbar
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

  // Trigger title generation after streaming finishes, at the configured interval
  useEffect(() => {
    if (isStreaming) return;
    if (messages.length === 0) return;
    // Only generate titles after the user actively sends a message, not on history load
    if (!hasSentRef.current) return;

    const state = useSettingsStore.getState();
    if (!state.autoTitleEnabled || !state.autoTitleTiers.length) return;

    const meaningfulCount = messages.filter(m => m.role === 'user' || m.role === 'assistant').length;
    if (meaningfulCount < 2) return;

    // Find the current interval: first matching tier, or last tier's interval
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

  // ==============================================================

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
          // Generate summaries for all thinking segments
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

  const isSegmentCollapsed = useCallback((segmentId: string) => {
    return collapsedSegments.has(segmentId);
  }, [collapsedSegments]);

  // Handler for typed events
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
          // First thinking in this turn — create block + first thinking segment
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
          // Auto-expand the thinking block during streaming
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
          // Append to last segment if it's a thinking segment, else create new thinking segment
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

        const newTool: ThinkingTool = {
          id: toolId,
          name: e.toolName,
          detail,
          status: 'running',
          files: e.files,
        };

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
                diff: (e as any).diff,
              };
              return { ...seg, tool: updated };
            }
            return seg;
          });

          // Auto-collapse: the completed tool + the thinking segment just before it
          for (let i = 0; i < segs.length; i++) {
            const seg = segs[i];
            if (seg.kind === 'tool' && seg.tool.status !== 'running') {
              collapseIds.push(seg.id);
              // Also collapse the thinking segment immediately before this tool
              if (i > 0 && segs[i - 1].kind === 'thinking') {
                collapseIds.push(segs[i - 1].id);
              }
            }
          }

          // Add file entries for file operations
          if (e.files && e.files.length > 0) {
            const isRead = ['Read', 'read_file', 'Grep', 'Glob'].some(n => e.toolName.includes(n));
            const newFiles: ThinkingFile[] = e.files.map(f => ({
              type: isRead ? 'read' : 'changed',
              path: f,
              diff: (e as any).diff,
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
        const e = event as (FileEvent & { changeType?: string });
        setThinkingBlocks((prev) => {
          const next = new Map(prev);
          const id = currentThinkingIdRef.current;
          if (!id) return next;
          const block = next.get(id);
          if (!block) return next;
          const segs = [...block.segments];
          const newFile: ThinkingFile = { type: (e.changeType as any) || 'changed', path: e.path };
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

  const { connect, send, close } = useWebSocket({
    url: `ws://${location.host}/ws`,
    onMessage: (msg) => {
      // Route to correct chat — prevent every instance from processing every message
      if ('chatId' in msg && msg.chatId !== chatId) return;
      if (msg.type === 'event') {
        if (msg.subagentId) {
          useSubagentStore.getState().pushEvent(msg.subagentId, msg.event);
        } else {
          handleEvent(msg.event);
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
    onOpen: () => {},  // singleton logs connection status
    onClose: () => { finalizeStream(); },
  });

  useEffect(() => { connect(); return () => close(); }, [connect]);

  // Listen for subagent spawn/abort requests from SubagentPanel
  useEffect(() => {
    const onSpawn = (e: Event) => {
      const { subagentId, task, env } = (e as CustomEvent).detail;
      const modelEnv = useSettingsStore.getState().getEnvVarsForModel(selectedModel);
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

  // Session history loader — fires once per sessionId globally (survives remounts)
  useEffect(() => {
    if (!chatSessionId || messages.length > 0 || !workDir) return;
    if (historyAttempted.has(chatSessionId)) return;
    historyAttempted.add(chatSessionId);
    fetch(`/api/sessions/read?base=${encodeURIComponent(workDir)}&id=${chatSessionId}`)
      .then(r => r.json())
      .then(data => {
        if (data.messages) {
          const { msgs, thinkBlocks } = reconstructHistory(data.messages);
          setMessages(msgs);
          setThinkingBlocks(thinkBlocks);
          // Auto-expand all thinking blocks in history
          const expanded = new Set<string>();
          for (const [id] of thinkBlocks) expanded.add(id);
          setThinkingExpanded(expanded);
        }
      })
      .catch(() => {});
  }, [chatSessionId, messages.length, workDir]);

  const handleSend = () => {
    const prompt = input.trim();
    if (!prompt || isStreaming) return;
    setIsStreaming(true);
    setTabStatus(chatId, 'streaming');
    setInput('');
    // First message: move chat to top of active list
    if (!hasSentRef.current) {
      hasSentRef.current = true;
      activateChat(tabId, chatId);
    }
    // Clear previous subagent tasks for new session
    useEventBus.getState().clearTasks();
    setMessages((prev) => [...prev, { role: 'user', content: prompt, id: crypto.randomUUID(), timestamp: new Date().toISOString() }]);
    updateChatLastMessage(tabId, chatId);
    const env: Record<string, string> = {};

    // Inject env vars from settings based on selected model
    const settingsEnv = useSettingsStore.getState().getEnvVarsForModel(selectedModel);
    for (const [key, value] of Object.entries(settingsEnv)) {
      if (value) env[key] = value;
    }

    // Apply selected effort from the chat toolbar (overrides settings)
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
  };

  // ── Rendering helpers ──

  const renderThinkingBlock = (msg: ChatMessage, block: ThinkingBlock) => {
    const open = thinkingExpanded.has(msg.id);
    const toolCount = block.segments.filter(s => s.kind === 'tool').length;
    const fileCount = block.segments.filter(s => s.kind === 'files').reduce((sum, s) => sum + (s as any).files.length, 0);
    const runningTools = block.segments.filter(s => s.kind === 'tool' && s.tool.status === 'running').length;

    return (
      <div>
        {/* Header row */}
        <button
          onClick={() => {
            const wasOpen = thinkingExpanded.has(msg.id);
            setThinkingExpanded((prev) => {
              const next = new Set(prev);
              next.has(msg.id) ? next.delete(msg.id) : next.add(msg.id);
              return next;
            });
            // When opening a FINISHED block: collapse all segments except the first
            // (During streaming, segments are managed by auto-collapse in event handlers)
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
          }}
          className="flex items-center gap-2 text-slate-500 dark:text-slate-400 hover:text-accent-600 dark:hover:text-accent-300 transition-colors w-full text-left text-xs font-medium"
        >
          <span className="text-[10px]">{open ? '▼' : '▶'}</span>
          <span className="bg-accent-600/20 text-accent-400 px-1.5 py-0.5 rounded text-[11px]">🧠</span>
          {runningTools > 0 && <Loader size={11} className="animate-spin text-accent-400" />}
          <span className="text-slate-400 dark:text-slate-600 text-[11px]">
            {toolCount > 0 && `${toolCount} tool${toolCount > 1 ? 's' : ''} · `}
            {fileCount > 0 && `${fileCount} file${fileCount > 1 ? 's' : ''} · `}
            {block.secs}s
          </span>
        </button>

        {open && (
          <div className="mt-2 border-l-2 border-accent-600/40 pl-3 max-h-[500px] overflow-y-auto">
            {block.segments.map((seg, i) => {
              const collapsed = isSegmentCollapsed(seg.id);
              const isLast = i === block.segments.length - 1;
              const showDivider = seg.kind === 'thinking' && i > 0;

              if (seg.kind === 'thinking') {
                return (
                  <div key={seg.id}>
                    {showDivider && <div className="border-t border-slate-200 dark:border-slate-700/50 my-1.5" />}
                    <button
                      onClick={() => handleSegmentClick(seg.id, msg.id)}
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

              if (seg.kind === 'tool') {
                const t = seg.tool;
                return (
                  <div key={seg.id}>
                    <button
                      onClick={() => handleSegmentClick(seg.id, msg.id)}
                      className="flex items-center gap-1.5 text-[11px] w-full text-left group py-0.5"
                    >
                      {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                      {t.status === 'running' && <Loader size={10} className="animate-spin text-accent-400 shrink-0" />}
                      {t.status === 'done' && <Check size={10} className="text-green-500 shrink-0" />}
                      {t.status === 'error' && <X size={10} className="text-red-500 shrink-0" />}
                      <Terminal size={10} className="text-purple-400 shrink-0" />
                      <span className="text-slate-600 dark:text-slate-400 truncate">
                        {collapsed
                          ? toolSummaryLine(t)
                          : <>{t.name}{t.detail && <span className="text-slate-400 dark:text-slate-600">: {t.detail}</span>}</>
                        }
                      </span>
                      {t.durationMs != null && (
                        <span className="text-[10px] text-slate-500 ml-auto shrink-0">{t.durationMs < 1000 ? `${t.durationMs}ms` : `${(t.durationMs / 1000).toFixed(1)}s`}</span>
                      )}
                    </button>
                    {!collapsed && (
                      <div className="mt-0.5 ml-6 text-[11px] text-slate-500 dark:text-slate-400 space-y-1">
                        {t.output && (
                          <pre className="whitespace-pre-wrap font-mono text-[11px] bg-slate-100 dark:bg-slate-800/50 rounded p-1.5 max-h-32 overflow-y-auto">{t.output}</pre>
                        )}
                        {t.files && t.files.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {t.files.map((f, i) => (
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

              if (seg.kind === 'files') {
                const files = seg.files;
                return (
                  <div key={seg.id}>
                    <button
                      onClick={() => handleSegmentClick(seg.id, msg.id)}
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

              return null;
            })}
          </div>
        )}
      </div>
    );
  };

  // ── Main render ──

  const bubbleClass = (msg: ChatMessage, isThinkingMsg: boolean) => {
    if (msg.role === 'user') return 'bg-accent-600 text-white rounded-br-md shadow-sm';
    if (msg.role === 'assistant') return 'bg-white dark:bg-[#1a2233] text-slate-700 dark:text-slate-300 rounded-bl-md border border-slate-200 dark:border-slate-800';
    if (isThinkingMsg) return 'bg-white dark:bg-[#161b22] border border-slate-200 dark:border-slate-800 rounded-xl text-slate-600 dark:text-slate-400';
    if (msg.role === 'error') return 'bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-300 border border-red-200 dark:border-red-900/30 rounded-xl';
    if (msg.role === 'system') return 'bg-slate-100 dark:bg-slate-800/50 text-slate-500 dark:text-slate-500 border border-slate-200 dark:border-slate-800 rounded-xl text-center';
    return 'bg-white dark:bg-[#161b22] text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-slate-800 rounded-xl text-center';
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-slate-600 gap-2">
            <span className="text-sm">Ready in</span>
            <button
              onClick={() => setShowFolderPicker(true)}
              className="text-accent-600 dark:text-accent-400 text-xs bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
              title="Click to change work directory"
            >
              {workDir}
            </button>
          </div>
        )}
        {messages.map((msg) => {
          const thinkBlock = thinkingBlocks.get(msg.id);
          const isThinkingMsg = !!(msg.role === 'tool' && thinkBlock);
          const isSystemMsg = msg.role === 'system';
          const align = msg.role === 'user' ? 'ml-auto' : 'mr-auto';

          return (
            <div key={msg.id} className={`max-w-[85%] ${align}`}>
              <div className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${bubbleClass(msg, isThinkingMsg)}`}>
                {isThinkingMsg ? (
                  renderThinkingBlock(msg, thinkBlock!)
                ) : isSystemMsg ? (
                  <span className="text-[12px]">{msg.content}</span>
                ) : msg.role === 'error' ? (
                  <span>{msg.content}</span>
                ) : (
                  <MessageContent content={msg.content} />
                )}
              </div>
              <div className={`text-[10px] text-slate-400 dark:text-slate-600 mt-0.5 ${msg.role === 'user' ? 'text-right' : 'text-left'} px-1`} title={new Date(msg.timestamp).toLocaleString()}>
                {formatChatTime(msg.timestamp)}
              </div>
            </div>
          );
        })}
        {isStreaming && (
          <div className="flex items-center gap-2 text-xs text-slate-600 px-1">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-500 animate-pulse" />
            Processing…
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-[var(--color-border)] bg-[var(--color-surface)] shrink-0 transition-colors">
        <div className="flex gap-3 mb-2 items-center">
          <select value={permissionMode} onChange={(e) => setPermissionMode(e.target.value)} className="text-[12px] bg-[var(--color-input-bg)] border border-[var(--color-border)] rounded-md px-2 py-1 text-[var(--color-text)] focus:outline-none focus:border-accent-500 transition-colors">
            <option value="default">🛡️ Manual (default)</option>
            <option value="acceptEdits">✏️ Auto-approve edits</option>
            <option value="auto">🤖 Auto</option>
            <option value="plan">📋 Plan only</option>
            <option value="dontAsk">🚫 Deny all</option>
            <option value="bypassPermissions">🔓 Auto-approve all</option>
          </select>
          <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} className="text-[12px] bg-[var(--color-input-bg)] border border-[var(--color-border)] rounded-md px-2 py-1 text-[var(--color-text)] focus:outline-none focus:border-accent-500 transition-colors min-w-0">
            {ALL_MODELS.map((m) => (
              <option key={m.id} value={m.id} disabled={!hasKey(m.provider)}>
                {m.label}{!hasKey(m.provider) ? ' (no key)' : ''}
              </option>
            ))}
          </select>
          <select value={selectedEffort} onChange={(e) => setSelectedEffort(e.target.value)} className="text-[12px] bg-[var(--color-input-bg)] border border-[var(--color-border)] rounded-md px-2 py-1 text-[var(--color-text)] focus:outline-none focus:border-accent-500 transition-colors" title="Reasoning effort">
            <option value="">🎯 Effort: auto</option>
            <option value="low">🎯 Effort: low</option>
            <option value="medium">🎯 Effort: medium</option>
            <option value="high">🎯 Effort: high</option>
            <option value="max">🎯 Effort: max</option>
          </select>
        </div>
        <PromptInput
          workDir={workDir}
          value={input}
          onChange={setInput}
          onSubmit={handleSend}
          disabled={isStreaming}
          placeholder={isStreaming ? 'Waiting for response…' : 'Send a prompt…'}
        />
      </div>

      {showFolderPicker && (
        <FolderPicker
          initialPath={workDir}
          onSelect={(path) => {
            setShowFolderPicker(false);
            if (path && path !== workDir) updateChatWorkDir(tabId, chatId, path);
          }}
          onClose={() => setShowFolderPicker(false)}
        />
      )}
    </div>
  );
}

export const ChatPanel = memo(ChatPanelInner);
