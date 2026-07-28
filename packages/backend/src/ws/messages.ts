// ── WebSocket message types (client → server) ──
// Discriminated union: the `type` field determines the shape.

export type PermissionMode = 'default' | 'acceptEdits' | 'auto' | 'plan' | 'dontAsk' | 'bypassPermissions';

// ── Individual message shapes ──

export interface PromptMessage {
  type: 'prompt';
  workDir?: string;
  sessionId?: string;
  permissionMode?: PermissionMode;
  prompt?: string;
  env?: Record<string, string>;
  resumeSessionId?: string;
  provider?: string;
  model?: string;
  _chatId?: string;
}

export interface AbortMessage {
  type: 'abort';
}

export interface SubagentStartMessage {
  type: 'subagent:start';
  chatId?: string;
  subagentId?: string;
  task?: string;
  workDir?: string;
  env?: Record<string, string>;
}

export interface SubagentAbortMessage {
  type: 'subagent:abort';
  subagentId?: string;
}

// ── Discriminated union ──

export type WsClientMessage =
  | PromptMessage
  | AbortMessage
  | SubagentStartMessage
  | SubagentAbortMessage;

// ── Outgoing message shapes (server → client) ──

export interface WsOutgoingEvent {
  type: 'event';
  chatId: string;
  subagentId?: string;
  event: unknown; // AppEvent — imported at use site to avoid circular deps
}

export interface WsOutgoingSessionReady {
  type: 'session_ready';
  sessionId: string;
}

export interface WsOutgoingSessionExit {
  type: 'session_exit';
  sessionId: string;
  exitCode: number | null;
}

export interface WsOutgoingAborted {
  type: 'aborted';
}

export interface WsOutgoingSubagentReady {
  type: 'subagent_ready';
  chatId: string;
  subagentId: string;
  sessionId: string;
}

export interface WsOutgoingSubagentExit {
  type: 'subagent_exit';
  chatId: string;
  subagentId: string;
  exitCode: number | null;
}

export interface WsOutgoingSubagentAborted {
  type: 'subagent_aborted';
  subagentId: string;
}

export interface WsOutgoingError {
  type: 'error';
  message: string;
}
