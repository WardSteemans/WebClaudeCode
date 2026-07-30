// ── WebSocket message types (shared between backend handler and frontend client) ──

import type { PermissionMode } from './types';

// ==================== Client → Server ====================

export interface PromptMessage {
  type: 'prompt';
  workDir?: string;
  sessionId?: string;
  permissionMode?: PermissionMode;
  prompt?: string | unknown[];
  env?: Record<string, string>;
  resumeSessionId?: string;
  provider?: string;
  model?: string;
  _chatId?: string;
  /** Use interactive PTY mode (default=false). Only needed for initial trust/API-key prompts. */
  usePty?: boolean;
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

export interface PermissionApproveMessage {
  type: 'permission:approve';
  sessionId: string;
  /** Optional: modified tool input to send back */
  updatedInput?: Record<string, unknown>;
}

export interface PermissionDenyMessage {
  type: 'permission:deny';
  sessionId: string;
  message?: string;
}

/** Send a tool_result to Claude Code's stdin (stream-json mode).
 *  Used for answering AskUserQuestion and other interactive tool prompts. */
export interface ToolResultMessage {
  type: 'tool:result';
  sessionId: string;
  toolUseId: string;
  content: string;
}

/** Request buffered events for a chat — sent by frontend on ChatPanel mount */
export interface CatchupMessage {
  type: 'catchup';
  chatId: string;
}

export type WsClientMessage =
  | PromptMessage
  | AbortMessage
  | SubagentStartMessage
  | SubagentAbortMessage
  | PermissionApproveMessage
  | PermissionDenyMessage
  | ToolResultMessage
  | CatchupMessage;

// ==================== Server → Client ====================

export interface WsOutgoingEvent {
  type: 'event';
  chatId: string;
  subagentId?: string;
  event: unknown; // AppEvent — typed as unknown to avoid circular deps; consumers cast as needed
  /** Epoch-ms timestamp set by backend just before ws.send().
   *  Used by the frontend's StreamTimeline to log the backend:send phase. */
  _sentAt?: number;
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

export interface WsOutgoingPtyData {
  type: 'pty_data';
  chatId: string;
  sessionId: string;
  /** Raw terminal output from the PTY */
  data: string;
  /** True when an approval/permission prompt is detected in this chunk */
  approvalDetected?: boolean;
  /** True when a question/interactive prompt is detected in this chunk */
  questionDetected?: boolean;
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

/** Batch of buffered events sent in response to a catchup request */
export interface WsOutgoingCatchupEvents {
  type: 'catchup_events';
  chatId: string;
  events: unknown[];
}

/** Sent after catchup_events — the client is now receiving live events */
export interface WsOutgoingCatchupDone {
  type: 'catchup_done';
  chatId: string;
}

/** Discriminated union of all server→client message types */
export type WsOutgoingMessage =
  | WsOutgoingEvent
  | WsOutgoingSessionReady
  | WsOutgoingSessionExit
  | WsOutgoingAborted
  | WsOutgoingPtyData
  | WsOutgoingSubagentReady
  | WsOutgoingSubagentExit
  | WsOutgoingSubagentAborted
  | WsOutgoingError
  | WsOutgoingCatchupEvents
  | WsOutgoingCatchupDone;
