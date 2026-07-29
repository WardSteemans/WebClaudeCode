// ── Chat domain types ──
// Shared between ChatPanel, ThinkingBlock, MessageContent, useChatStream, subagentStore, and history-reconstruction.

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

export interface FileAttachment {
  id: string;
  text: string;
  fileName: string;
  mimeType: string;
  size: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool' | 'error' | 'system';
  content: string;
  id: string;
  timestamp: string; // ISO 8601
  images?: Array<{ base64: string; mediaType: string }>;
  files?: Array<{ text: string; fileName: string; mimeType: string }>;
}

// ==================== Helpers ====================

/**
 * Extract a human-readable detail string from a tool's input.
 * Used by both ChatPanel (thinking blocks) and SubagentStore (subagent tracking).
 */
export function toolInputDetail(_toolName: string, toolInput: Record<string, unknown>): string {
  if (toolInput?.query) return `"${String(toolInput.query).slice(0, 60)}"`;
  if (toolInput?.url) return String(toolInput.url).slice(0, 60);
  if (Object.keys(toolInput).length > 0) return JSON.stringify(toolInput).slice(0, 80);
  return '';
}
