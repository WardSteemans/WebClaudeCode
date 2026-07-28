// ── Event type definitions shared between backend and frontend ──

// ==================== Base ====================

export interface BaseEvent {
  /** Unique event ID (UUID v4) */
  id: string;
  /** ISO timestamp */
  timestamp: string;
  /** Session ID this event belongs to */
  sessionId: string;
}

// ==================== Chat Events ====================

export interface ChatUserEvent extends BaseEvent {
  type: 'chat.user';
  content: string;
}

export interface ChatAssistantEvent extends BaseEvent {
  type: 'chat.assistant';
  content: string;
  /** True while streaming; false when final */
  partial: boolean;
}

export interface ChatThinkingEvent extends BaseEvent {
  type: 'chat.thinking';
  content: string;
  partial: boolean;
}

export interface ChatErrorEvent extends BaseEvent {
  type: 'chat.error';
  message: string;
  code?: string;
}

export type ChatEvent = ChatUserEvent | ChatAssistantEvent | ChatThinkingEvent | ChatErrorEvent;

// ==================== Tool Events ====================

export interface ToolStartedEvent extends BaseEvent {
  type: 'tool.started';
  toolName: string;
  toolInput: Record<string, unknown>;
  /** Optional: which files are affected */
  files?: string[];
}

export interface ToolCompletedEvent extends BaseEvent {
  type: 'tool.completed';
  toolName: string;
  toolInput: Record<string, unknown>;
  /** Whether the tool completed successfully */
  success: boolean;
  /** Tool result summary */
  summary?: string;
  /** Duration in ms */
  durationMs: number;
  /** Which files were read/written */
  files?: string[];
  /** File diff/patch (for write/edit tools) */
  diff?: string;
}

export type ToolEvent = ToolStartedEvent | ToolCompletedEvent;

// ==================== File Events (derived from tool use) ====================

export interface FileReadEvent extends BaseEvent {
  type: 'file.read';
  path: string;
}

export interface FileChangedEvent extends BaseEvent {
  type: 'file.changed';
  path: string;
  changeType: 'created' | 'modified' | 'deleted';
  patch?: string;
}

export type FileEvent = FileReadEvent | FileChangedEvent;

// ==================== Command Events ====================

export interface CommandStartedEvent extends BaseEvent {
  type: 'command.started';
  command: string;
  cwd: string;
}

export interface CommandFinishedEvent extends BaseEvent {
  type: 'command.finished';
  command: string;
  exitCode: number;
  durationMs: number;
  output?: string;
}

export type CommandEvent = CommandStartedEvent | CommandFinishedEvent;

// ==================== Session Events ====================

export interface SessionReadyEvent extends BaseEvent {
  type: 'session.ready';
  sessionId: string;
}

export interface SessionWaitingEvent extends BaseEvent {
  type: 'session.waiting';
}

export interface SessionCompactedEvent extends BaseEvent {
  type: 'session.compacted';
  /** Approximate tokens removed (if reported by CLI) */
  tokensRemoved?: number;
  /** Input tokens before compact (if reported) */
  inputTokens?: number;
  /** Output tokens before compact (if reported) */
  outputTokens?: number;
  /** How many messages were in the conversation (if reported) */
  messageCount?: number;
}

export interface SessionCompletedEvent extends BaseEvent {
  type: 'session.completed';
  exitCode: number;
}

export interface SessionAbortedEvent extends BaseEvent {
  type: 'session.aborted';
}

export interface SessionErrorEvent extends BaseEvent {
  type: 'session.error';
  message: string;
  code?: string;
}

export type SessionEvent =
  | SessionReadyEvent
  | SessionWaitingEvent
  | SessionCompletedEvent
  | SessionCompactedEvent
  | SessionAbortedEvent
  | SessionErrorEvent;

// ==================== Permission Events ====================

export interface PermissionRequestedEvent extends BaseEvent {
  type: 'permission.requested';
  toolName: string;
  toolInput: Record<string, unknown>;
  /** What Claude wants to do */
  description: string;
  /** Optional: risk level */
  risk: 'low' | 'medium' | 'high';
}

export type PermissionEvent = PermissionRequestedEvent;

// ==================== Notification Event ====================

export interface NotificationEvent extends BaseEvent {
  type: 'notification';
  level: 'info' | 'warn' | 'error';
  message: string;
  /** Optional: dismiss after ms */
  ttlMs?: number;
}

// ==================== Usage Events ====================

/** Per-model token breakdown */
export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  /** The model name, e.g. "claude-sonnet-4-20250514" */
  modelName: string;
  /** Whether this is a subagent model (Haiku) vs main model (Sonnet) */
  isSubagent: boolean;
  /** Cost in USD (approximate, based on pricing) */
  costUSD: number;
}

/** Cumulative session usage event — emitted at the end of each turn */
export interface SessionUsageEvent extends BaseEvent {
  type: 'session.usage';
  /** Cumulative token totals across all turns in this session */
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  /** Per-model breakdowns */
  models: ModelUsage[];
  /** Total number of API requests (turns) so far */
  requestCount: number;
  /** Total API duration in ms */
  totalDurationMs: number;
  /** Turn-level metrics from the just-completed turn */
  turn: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
    durationMs: number;
    modelUsage: ModelUsage[];
  };
  /** Context window: total tokens used vs context limit */
  contextWindow: {
    used: number;
    limit: number;
    percentUsed: number;
  };
}

// ==================== Session Init Event ====================
// Parsed from system::init — gives us agent/tool/skill lists

export interface SessionInitEvent extends BaseEvent {
  type: 'session.init';
  cwd: string;
  model: string;
  tools: string[];
  agents: string[];
  skills: string[];
  slashCommands: string[];
  mcpServers: Array<{ name: string; status: string }>;
  permissionMode: string;
}

// ==================== Session Status Event ====================
// Parsed from system::status — "requesting", "streaming", etc.

export interface SessionStatusEvent extends BaseEvent {
  type: 'session.status';
  status: string;
}

// ==================== Thinking Tokens Event ====================
// Parsed from system::thinking_tokens — real-time token count

export interface ThinkingTokensEvent extends BaseEvent {
  type: 'thinking.tokens';
  estimatedTokens: number;
  estimatedTokensDelta: number;
}

// ==================== Task (Subagent) Events ====================
// Parsed from system::task_started / system::task_notification

export interface TaskStartedEvent extends BaseEvent {
  type: 'task.started';
  /** CLI's internal task ID (short, e.g. "bxz7e9x0a") */
  taskId: string;
  /** The parent tool_use_id that spawned this task */
  toolUseId: string;
  /** Human-readable description */
  description: string;
  /** Type: "local_bash", "subagent_call", etc. */
  taskType: string;
}

export interface TaskCompletedEvent extends BaseEvent {
  type: 'task.completed';
  /** CLI's internal task ID */
  taskId: string;
  /** The parent tool_use_id */
  toolUseId: string;
  /** "completed", "error", etc. */
  status: string;
  /** One-line summary of what was done */
  summary?: string;
  /** Path to output file (if any) */
  outputFile?: string;
}

// ==================== Stream Message Info ====================
// Extracted from stream_event::message_start — model + message ID info

export interface StreamMessageInfoEvent extends BaseEvent {
  type: 'stream.message';
  messageId: string;
  model: string;
  /** If non-null: this message belongs to a subagent spawned by this tool_use_id */
  parentToolUseId: string | null;
  /** Input tokens used for this turn */
  inputTokens: number;
  /** Time-to-first-token in ms */
  ttftMs?: number;
}

// ==================== Aggregate ====================

export type AppEvent =
  | ChatEvent
  | ToolEvent
  | FileEvent
  | CommandEvent
  | SessionEvent
  | PermissionEvent
  | NotificationEvent
  | SessionUsageEvent
  | SessionInitEvent
  | SessionStatusEvent
  | ThinkingTokensEvent
  | TaskStartedEvent
  | TaskCompletedEvent
  | StreamMessageInfoEvent;

// ==================== WS Transport ====================

export interface WsEnvelope {
  /** Which chat this event belongs to */
  chatId: string;
  /** The typed event */
  event: AppEvent;
}

// ==================== API Router Metrics ====================

export interface ProxyMetric {
  id: string;
  timestamp: string;
  /** 'direct' = no images, forwarded straight */
  routing: 'direct' | 'vision' | 'stripped' | 'error';
  provider: string;
  model: string;
  statusCode: number;
  /** Time to first byte from upstream (ms) */
  ttfbMs: number;
  /** Total time from request to response end (ms) */
  totalMs: number;
  bodySize: number;
  imageCount: number;
  error?: string;
}
