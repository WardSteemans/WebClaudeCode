import { randomUUID } from 'crypto';
import { createLogger } from '../../logger.js';

const log = createLogger('eventParser:state');

// ── Pending tool during stream accumulation ──

export interface PendingTool {
  id: string;           // tool_use_id from stream
  name: string;
  inputJson: string;    // accumulated input_json_delta chunks
  startTime: number;
}

// ── Per-message stream state ──

export interface StreamState {
  messageId: string;
  model: string;
  parentToolUseId: string | null;
  inputTokens: number;
  pendingTool: PendingTool | null;
  thinkingStarted: boolean;
}

// ── Per-session aggregate state ──

export interface ParserState {
  currentTool: { name: string; input: Record<string, unknown>; startTime: number } | null;
  stream: StreamState | null;
  cumInputTokens: number;
  cumOutputTokens: number;
  cumCacheCreation: number;
  cumCacheRead: number;
  requestCount: number;
  totalDurationMs: number;
  modelTotals: Map<string, { input: number; output: number; cacheCreation: number; cacheRead: number }>;
  agents: string[];
  tools: string[];
}

// ── Session state store ──

const states = new Map<string, ParserState>();

export function state(sessionId: string): ParserState {
  if (!states.has(sessionId)) states.set(sessionId, {
    currentTool: null,
    stream: null,
    cumInputTokens: 0, cumOutputTokens: 0, cumCacheCreation: 0, cumCacheRead: 0,
    requestCount: 0, totalDurationMs: 0,
    modelTotals: new Map(),
    agents: [], tools: [],
  });
  return states.get(sessionId)!;
}

export function resetParser(sessionId: string) {
  log.debug('resetting parser state', { sessionId: sessionId.slice(0, 8) });
  states.delete(sessionId);
}

// ── Tiny helpers used across all parsers ──

export function mkId() { return randomUUID(); }
export function now() { return new Date().toISOString(); }
