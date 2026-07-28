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

export type WsClientMessage =
  | PromptMessage
  | AbortMessage
  | SubagentStartMessage
  | SubagentAbortMessage;

// ==================== Server → Client ====================

export interface WsOutgoingEvent {
  type: 'event';
  chatId: string;
  subagentId?: string;
  event: unknown; // AppEvent — typed as unknown to avoid circular deps; consumers cast as needed
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

/** Discriminated union of all server→client message types */
export type WsOutgoingMessage =
  | WsOutgoingEvent
  | WsOutgoingSessionReady
  | WsOutgoingSessionExit
  | WsOutgoingAborted
  | WsOutgoingSubagentReady
  | WsOutgoingSubagentExit
  | WsOutgoingSubagentAborted
  | WsOutgoingError;
