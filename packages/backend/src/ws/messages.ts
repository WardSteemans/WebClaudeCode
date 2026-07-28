// ── WebSocket message types ──
// Re-exported from shared — all types live in @cc-gui/shared now.
// Keep this file as a re-export for internal consumers that already import from './messages.js'.

export type {
  PermissionMode,
  PromptMessage,
  AbortMessage,
  SubagentStartMessage,
  SubagentAbortMessage,
  WsClientMessage,
  WsOutgoingEvent,
  WsOutgoingSessionReady,
  WsOutgoingSessionExit,
  WsOutgoingAborted,
  WsOutgoingSubagentReady,
  WsOutgoingSubagentExit,
  WsOutgoingSubagentAborted,
  WsOutgoingError,
} from '@cc-gui/shared';
