// ── Claude Code raw event type definitions ──
// Describes the JSON that Claude Code emits on stdout.
// These are documentation + IDE support; runtime data may deviate so all parsers
// still guard with optional chaining / fallbacks.

// ── Top-level discriminated union ──

export type KnownEventType = 'stream_event' | 'system' | 'user' | 'assistant' | 'result' | 'message_stop';
export const KNOWN_EVENT_TYPES: readonly KnownEventType[] = ['user', 'assistant', 'system', 'result', 'message_stop', 'stream_event'];

// ── Stream event (v2.x) ──

export type StreamInnerType = 'message_start' | 'content_block_start' | 'content_block_delta' | 'content_block_stop' | 'message_delta' | 'message_stop';
export type ContentBlockType = 'thinking' | 'tool_use' | 'text';
export type ContentBlockDeltaType = 'thinking_delta' | 'text_delta' | 'input_json_delta';

export interface StreamMessageUsage {
  input_tokens?: number;
  inputTokens?: number;
  output_tokens?: number;
  outputTokens?: number;
}

export interface StreamMessage {
  id?: string;
  model?: string;
  usage?: StreamMessageUsage;
}

export interface StreamInnerMessageStart {
  type: 'message_start';
  message?: StreamMessage;
}

export interface StreamInnerContentBlock {
  id?: string;
  name?: string;
  type?: ContentBlockType;
}

export interface StreamInnerContentBlockStart {
  type: 'content_block_start';
  content_block?: StreamInnerContentBlock;
}

export interface StreamInnerDelta {
  type?: ContentBlockDeltaType;
  thinking?: string;
  text?: string;
  partial_json?: string;
}

export interface StreamInnerContentBlockDelta {
  type: 'content_block_delta';
  delta?: StreamInnerDelta;
  index?: number;
}

export interface StreamInnerContentBlockStop {
  type: 'content_block_stop';
}

export interface StreamInnerMessageDelta {
  type: 'message_delta';
}

export interface StreamInnerMessageStop {
  type: 'message_stop';
}

export type StreamInner =
  | StreamInnerMessageStart
  | StreamInnerContentBlockStart
  | StreamInnerContentBlockDelta
  | StreamInnerContentBlockStop
  | StreamInnerMessageDelta
  | StreamInnerMessageStop;

export interface RawStreamEvent {
  type: 'stream_event';
  event?: StreamInner;
  parent_tool_use_id?: string | null;
  ttft_ms?: number;
}

// ── System event ──

export type SystemSubtype = 'init' | 'status' | 'thinking_tokens' | 'task_started' | 'task_notification' | 'api_error' | 'compact_boundary';

export interface McpServerInfo {
  name?: string;
  status?: string;
}

export interface RawSystemEvent {
  type: 'system';
  subtype?: SystemSubtype;
  // init
  agents?: string[];
  tools?: string[];
  skills?: string[];
  slash_commands?: string[];
  mcp_servers?: McpServerInfo[];
  cwd?: string;
  model?: string;
  permissionMode?: string;
  // status
  status?: string;
  // thinking_tokens
  estimated_tokens?: number;
  estimated_tokens_delta?: number;
  // task_started
  task_id?: string;
  tool_use_id?: string;
  description?: string;
  task_type?: string;
  // task_notification
  summary?: string;
  output_file?: string;
  // api_error
  message?: string;
  error?: string;
  // session
  session_id?: string;
  // compact_boundary
  tokens_removed?: number;
  token_removed?: number;
  input_tokens?: number;
  output_tokens?: number;
  messages?: number;
  message_count?: number;
}

// ── User event ──

export interface RawUserMessage {
  role?: string;
  content?: string | RawUserContentBlock[];
}

export type RawUserContentBlock = RawUserTextBlock | RawUserToolResultBlock;

export interface RawUserTextBlock {
  type: 'text';
  text?: string;
}

export interface RawUserToolResultBlock {
  type: 'tool_result';
  tool_use_id?: string;
  content?: string | RawUserTextBlock[];
  is_error?: boolean;
}

export interface RawUserEvent {
  type: 'user';
  message?: RawUserMessage;
}

// ── Assistant event (legacy) ──

export type AssistantBlockType = 'thinking' | 'text' | 'tool_use' | 'tool_result';

export interface AssistantMessage {
  content?: AssistantBlock[];
}

export interface AssistantBlockBase {
  type?: AssistantBlockType;
}

export interface AssistantThinkingBlock extends AssistantBlockBase {
  type: 'thinking';
  thinking?: string;
  text?: string;
}

export interface AssistantTextBlock extends AssistantBlockBase {
  type: 'text';
  text?: string;
}

export interface AssistantToolUseBlock extends AssistantBlockBase {
  type: 'tool_use';
  name?: string;
  tool?: string;
  input?: Record<string, unknown>;
}

export interface AssistantToolResultBlock extends AssistantBlockBase {
  type: 'tool_result';
  content?: string | { type: string; text?: string }[];
  result?: string;
  is_error?: boolean;
  isError?: boolean;
}

export type AssistantBlock =
  | AssistantThinkingBlock
  | AssistantTextBlock
  | AssistantToolUseBlock
  | AssistantToolResultBlock;

export interface RawAssistantEvent {
  type: 'assistant';
  message?: AssistantMessage;
}

// ── Result event ──

export interface ResultUsage {
  input_tokens?: number;
  inputTokens?: number;
  output_tokens?: number;
  outputTokens?: number;
  cache_creation_input_tokens?: number;
  cacheCreationInputTokens?: number;
  cache_read_input_tokens?: number;
  cacheReadInputTokens?: number;
}

export interface RawResultEvent {
  type?: 'result' | 'message_stop';
  usage?: ResultUsage;
  modelUsage?: Record<string, {
    inputTokens?: number; input_tokens?: number;
    outputTokens?: number; output_tokens?: number;
    cacheCreationInputTokens?: number; cache_creation_input_tokens?: number;
    cacheReadInputTokens?: number; cache_read_input_tokens?: number;
  }>;
  inputTokens?: number;
  outputTokens?: number;
  duration_ms?: number;
  durationMs?: number;
  duration_api_ms?: number;
  is_error?: boolean;
}

// ── Top-level union ──

export type RawClaudeEvent =
  | RawStreamEvent
  | RawSystemEvent
  | RawUserEvent
  | RawAssistantEvent
  | RawResultEvent;

// ── Helper: narrow to result-like events (those carrying usage data) ──
// The catch-all in index.ts needs to access usage/modelUsage which only exist on RawResultEvent.

export type ResultLikeEvent = RawResultEvent & { type?: string };
