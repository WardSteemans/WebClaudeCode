// ── Stream Timeline Logger ──────────────────────────────────────────────────
// Purpose: Log every event flowing through the Claude → Backend → Frontend
// pipeline. One NDJSON line per phase (send/recv/process), written to a
// dedicated log file so we can trace exactly when each event was sent,
// received, and how the frontend acted on it.
//
// Activation: backend: STREAM_DEBUG=true in env
//             frontend: ?stream_debug=1 in URL or window.__STREAM_DEBUG__ = true
//
// The StreamTimeline class lives in the frontend. The backend writes entries
// to file via POST /api/stream-log (which checks STREAM_DEBUG env var).

// ============================================================================
// Types
// ============================================================================

/** Short field names to keep NDJSON lines compact. */
export interface StreamTimelineEntry {
  /** Monotonic sequence number per timeline instance */
  s: number;
  /** ISO timestamp with ms precision */
  ts: string;
  /** Delta in ms since previous entry in this timeline (first = 0) */
  d: number;
  /** Pipeline phase */
  p: 'b_send' | 'f_recv' | 'f_proc';
  /** Session ID */
  sid: string;
  /** Chat ID */
  cid: string;
  /** Subagent ID (if applicable) */
  aid?: string;
  /** Event type string (e.g. 'chat.thinking', 'tool.started') */
  ev: string;
  /** Event ID (UUID from BaseEvent) */
  eid: string;
  /** Content length (for text/thinking events) */
  len?: number;
  /** First 80 chars of content */
  pre?: string;
  /** Whether this was a partial (streaming) event */
  par?: boolean;
  /** Tool name (for tool.* events) */
  tln?: string;

  // ── Frontend processing info (only on f_proc phase) ──
  /** What the handler did */
  act?: string;
  /** Target message ID */
  mid?: string | null;
  /** Target thinking block ID */
  bid?: string | null;
  /** Target segment ID */
  sgid?: string | null;
  /** streamMsgIdRef value AFTER the action */
  mrf?: string | null;
  /** currentThinkingIdRef value AFTER the action */
  trf?: string | null;
  /** Message count AFTER the action */
  mc?: number;
  /** Thinking block count AFTER the action */
  bc?: number;
}

/** Internal helper: what recordSend/recordRecv/recordProcess receive. */
interface TimelineInput {
  phase: StreamTimelineEntry['p'];
  sessionId: string;
  chatId: string;
  subagentId?: string;
  eventType: string;
  eventId: string;
  contentLength?: number;
  contentPreview?: string;
  partial?: boolean;
  toolName?: string;
  // f_proc only
  action?: string;
  targetMsgId?: string | null;
  targetBlockId?: string | null;
  targetSegmentId?: string | null;
  streamMsgIdRef?: string | null;
  currentThinkingIdRef?: string | null;
  messageCount?: number;
  thinkingBlockCount?: number;
}

// ============================================================================
// Activation check
// ============================================================================

function isEnabled(): boolean {
  if (typeof window !== 'undefined') {
    try {
      if (new URLSearchParams(window.location.search).get('stream_debug') === '1') return true;
    } catch { /* SSR guard */ }
    if ((window as unknown as Record<string, unknown>).__STREAM_DEBUG__ === true) return true;
  }
  return false;
}

// ============================================================================
// StreamTimeline class
// ============================================================================

export class StreamTimeline {
  private seq = 0;
  private lastTs = 0;
  private buffer: StreamTimelineEntry[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private readonly FLUSH_MS = 500;
  private readonly MAX_BUF = 20;
  private readonly sid: string;
  private readonly cid: string;
  private enabled: boolean;

  constructor(sessionId: string, chatId: string) {
    this.sid = sessionId;
    this.cid = chatId;
    this.enabled = isEnabled();
  }

  // ── Lifecycle ──

  start(): void {
    if (!this.enabled) return;
    this.flushTimer = setInterval(() => this.flush(), this.FLUSH_MS);
  }

  stop(): void {
    if (this.flushTimer) { clearInterval(this.flushTimer); this.flushTimer = null; }
    this.flush();
  }

  // ── Public recording API ──

  record(input: TimelineInput): void {
    if (!this.enabled) return;

    const now = new Date();
    const ts = now.toISOString();
    const deltaMs = this.seq === 0 ? 0 : now.getTime() - this.lastTs;
    this.lastTs = now.getTime();
    this.seq++;

    const entry: StreamTimelineEntry = {
      s: this.seq,
      ts,
      d: deltaMs,
      p: input.phase,
      sid: input.sessionId,
      cid: input.chatId,
      ev: input.eventType,
      eid: input.eventId,
    };

    if (input.subagentId) entry.aid = input.subagentId;
    if (input.contentLength !== undefined) entry.len = input.contentLength;
    if (input.contentPreview) entry.pre = input.contentPreview.slice(0, 80);
    if (input.partial !== undefined) entry.par = input.partial;
    if (input.toolName) entry.tln = input.toolName;

    if (input.phase === 'f_proc') {
      entry.act = input.action;
      if (input.targetMsgId !== undefined) entry.mid = input.targetMsgId;
      if (input.targetBlockId !== undefined) entry.bid = input.targetBlockId;
      if (input.targetSegmentId !== undefined) entry.sgid = input.targetSegmentId;
      if (input.streamMsgIdRef !== undefined) entry.mrf = input.streamMsgIdRef;
      if (input.currentThinkingIdRef !== undefined) entry.trf = input.currentThinkingIdRef;
      if (input.messageCount !== undefined) entry.mc = input.messageCount;
      if (input.thinkingBlockCount !== undefined) entry.bc = input.thinkingBlockCount;
    }

    this.buffer.push(entry);
    if (this.buffer.length >= this.MAX_BUF) this.flush();
  }

  // ── Convenience wrappers ──

  recordSend(event: {
    id: string;
    type: string;
    sessionId: string;
    content?: string;
    partial?: boolean;
    toolName?: string;
  }, chatId: string, subagentId?: string): void {
    this.record({
      phase: 'b_send',
      sessionId: event.sessionId,
      chatId,
      subagentId,
      eventType: event.type,
      eventId: event.id,
      contentLength: (event as { content?: string }).content?.length,
      contentPreview: (event as { content?: string }).content?.slice(0, 80),
      partial: (event as { partial?: boolean }).partial,
      toolName: (event as { toolName?: string }).toolName,
    });
  }

  recordRecv(event: {
    id: string;
    type: string;
    sessionId: string;
    content?: string;
    toolName?: string;
  }, chatId: string, subagentId?: string): void {
    this.record({
      phase: 'f_recv',
      sessionId: event.sessionId,
      chatId,
      subagentId,
      eventType: event.type,
      eventId: event.id,
      contentLength: (event as { content?: string }).content?.length,
    });
  }

  recordProcess(event: { id: string; type: string; sessionId: string }, info: {
    action: string;
    targetMsgId?: string | null;
    targetBlockId?: string | null;
    targetSegmentId?: string | null;
    streamMsgIdRef?: string | null;
    currentThinkingIdRef?: string | null;
    messageCount?: number;
    thinkingBlockCount?: number;
  }): void {
    this.record({
      phase: 'f_proc',
      sessionId: event.sessionId,
      chatId: this.cid,
      eventType: event.type,
      eventId: event.id,
      action: info.action,
      targetMsgId: info.targetMsgId,
      targetBlockId: info.targetBlockId,
      targetSegmentId: info.targetSegmentId,
      streamMsgIdRef: info.streamMsgIdRef,
      currentThinkingIdRef: info.currentThinkingIdRef,
      messageCount: info.messageCount,
      thinkingBlockCount: info.thinkingBlockCount,
    });
  }

  // ── Dump for console debugging ──

  dump(): StreamTimelineEntry[] {
    return [...this.buffer];
  }

  // ── Flush to backend ──

  private flush(): void {
    if (this.buffer.length === 0) return;
    const entries = this.buffer.splice(0);
    const body = JSON.stringify(entries);
    try {
      fetch('/api/stream-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => { /* silently ignore — logging failures must not break the app */ });
    } catch { /* ignore */ }
  }
}
