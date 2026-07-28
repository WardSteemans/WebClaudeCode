// ==================== Chat domain types ====================
// Shared between ChatPanel, ThinkingBlock, MessageContent, useChatStream, and subagentStore.

export interface ThinkingTool {
  id: string;
  name: string;
  detail: string;  // short description (query, url, args)
  status: 'running' | 'done' | 'error';
  durationMs?: number;
  output?: string;    // result summary
  diff?: string;      // file diff for write/edit tools
  files?: string[];   // files affected
}

export interface ThinkingFile {
  type: 'read' | 'changed' | 'created' | 'deleted';
  path: string;
  diff?: string;
}

/** One segment in the thinking timeline — rendered in order */
export type ThinkingSegment =
  | { id: string; kind: 'thinking'; text: string; summary: string }
  | { id: string; kind: 'tool'; tool: ThinkingTool }
  | { id: string; kind: 'files'; files: ThinkingFile[] };

export interface ThinkingBlock {
  segments: ThinkingSegment[];
  secs: number;
  startTime: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool' | 'error' | 'system';
  content: string;
  id: string;
  timestamp: string; // ISO 8601
  images?: Array<{ base64: string; mediaType: string }>;
}
