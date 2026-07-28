import { randomUUID } from 'crypto';
import type {
  AppEvent, ToolStartedEvent, ToolCompletedEvent, FileEvent, CommandEvent,
  PermissionRequestedEvent, SessionUsageEvent, ModelUsage,
  SessionInitEvent, SessionStatusEvent, ThinkingTokensEvent,
  TaskStartedEvent, TaskCompletedEvent, StreamMessageInfoEvent
} from '@cc-gui/shared';
import { detectModelTier, calcCost, isSubagentModel } from './pricing';
import { createLogger } from './logger.js';

const log = createLogger('eventParser');

// ── Parser State ──

interface PendingTool {
  id: string;           // tool_use_id from stream
  name: string;
  inputJson: string;    // accumulated input_json_delta chunks
  startTime: number;
}

interface StreamState {
  messageId: string;
  model: string;
  parentToolUseId: string | null;
  inputTokens: number;
  // Current block being accumulated
  pendingTool: PendingTool | null;
  thinkingStarted: boolean;
}

interface ParserState {
  // Legacy tool tracking
  currentTool: { name: string; input: Record<string, unknown>; startTime: number } | null;
  // Stream event aggregation
  stream: StreamState | null;
  // Cumulative usage
  cumInputTokens: number;
  cumOutputTokens: number;
  cumCacheCreation: number;
  cumCacheRead: number;
  requestCount: number;
  totalDurationMs: number;
  modelTotals: Map<string, { input: number; output: number; cacheCreation: number; cacheRead: number }>;
  // Session init data
  agents: string[];
  tools: string[];
}

const states = new Map<string, ParserState>();

function state(sessionId: string): ParserState {
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

function mkId() { return randomUUID(); }
function now() { return new Date().toISOString(); }

// ── File & command derivation ──

function deriveFileEvents(toolName: string, input: Record<string, unknown>, sessionId: string): FileEvent[] {
  const events: FileEvent[] = [];
  switch (toolName) {
    case 'Read':
    case 'read_file':
    case 'Grep':
    case 'Glob':
      if (input.file_path) events.push({ id: mkId(), timestamp: now(), sessionId, type: 'file.read', path: String(input.file_path) });
      if (input.path) events.push({ id: mkId(), timestamp: now(), sessionId, type: 'file.read', path: String(input.path) });
      break;
    case 'Write':
    case 'write_file':
    case 'Edit':
    case 'edit_file':
    case 'MultiEdit':
    case 'multi_edit':
      if (input.file_path) events.push({ id: mkId(), timestamp: now(), sessionId, type: 'file.changed', path: String(input.file_path), changeType: 'modified' });
      if (input.path) events.push({ id: mkId(), timestamp: now(), sessionId, type: 'file.changed', path: String(input.path), changeType: 'modified' });
      break;
  }
  return events;
}

function deriveCommandEvent(toolName: string, input: Record<string, unknown>, sessionId: string, exitCode: number, durationMs: number): CommandEvent | null {
  if ((toolName === 'Bash' || toolName === 'bash' || toolName === 'execute_command') && input.command) {
    return { id: mkId(), timestamp: now(), sessionId, type: 'command.finished', command: String(input.command), exitCode, durationMs };
  }
  return null;
}

function isHighRisk(toolName: string): boolean {
  return ['Bash', 'Write', 'Edit', 'Delete'].some(t => toolName.includes(t) || t.includes(toolName));
}

// ── Stream event helpers ──

function ensureStream(s: ParserState, sessionId: string): StreamState {
  if (!s.stream) s.stream = { messageId: '', model: '', parentToolUseId: null, inputTokens: 0, pendingTool: null, thinkingStarted: false };
  return s.stream;
}

// ── Main parser ──

export function* parseClaudeEvent(line: string, sessionId: string): Generator<AppEvent> {
  let evt: any;
  try { evt = JSON.parse(line); } catch {
    log.debug('non-JSON line skipped', { sessionId: sessionId.slice(0, 8), linePreview: line.slice(0, 100) });
    return;
  }

  const id = mkId();
  const ts = now();
  const s = state(sessionId);

  switch (evt.type) {
    // ========== STREAM EVENT (new v2.x format) ==========
    case 'stream_event':
      yield* parseStreamEvent(evt, sessionId, id, ts, s);
      break;

    // ========== SYSTEM EVENTS ==========
    case 'system':
      yield* parseSystemEvent(evt, sessionId, id, ts, s);
      break;

    // ========== USER (prompt or tool_result) ==========
    case 'user':
      yield* parseUserEvent(evt, sessionId, id, ts, s);
      break;

    // ========== ASSISTANT (legacy aggregated format — fallback) ==========
    case 'assistant':
      // Only use if we haven't already processed via stream_event
      if (!s.stream || s.stream.messageId === '') {
        yield* parseAssistantEvent(evt, sessionId, id, ts, s);
      }
      break;

    // ========== RESULT (end of session / turn) ==========
    case 'result':
    case 'message_stop':
      s.stream = null; // reset stream state
      if (evt.type === 'result') {
        yield* handleResult(evt, sessionId, id, ts, s);
      }
      break;
  }

  // Handle result events without type field (Claude Code >= 2.x)
  if (!evt.type && (evt.usage || evt.modelUsage || evt.is_error !== undefined)) {
    s.stream = null;
    yield* handleResult(evt, sessionId, id, ts, s);
  }

  // Catch-all: unhandled type with usage data
  if (evt.type && !['user', 'assistant', 'system', 'result', 'message_stop', 'stream_event'].includes(evt.type)
    && (evt.usage || evt.modelUsage)) {
    s.stream = null;
    yield* handleResult(evt, sessionId, id, ts, s);
  }
}

// ── Stream event parser ──

function* parseStreamEvent(evt: any, sessionId: string, _id: string, _ts: string, s: ParserState): Generator<AppEvent> {
  const inner = evt.event;
  if (!inner) return;

  const parentToolUseId: string | null = evt.parent_tool_use_id || null;

  switch (inner.type) {
    case 'message_start': {
      const msg = inner.message || {};
      const stream: StreamState = {
        messageId: msg.id || '',
        model: msg.model || '',
        parentToolUseId,
        inputTokens: msg.usage?.input_tokens || msg.usage?.inputTokens || 0,
        pendingTool: null,
        thinkingStarted: false,
      };
      s.stream = stream;

      // Emit message info (used for subagent tracking via parentToolUseId)
      const info: StreamMessageInfoEvent = {
        id: mkId(), timestamp: now(), sessionId,
        type: 'stream.message',
        messageId: stream.messageId,
        model: stream.model,
        parentToolUseId: stream.parentToolUseId,
        inputTokens: stream.inputTokens,
        ttftMs: evt.ttft_ms,
      };
      yield info;
      break;
    }

    case 'content_block_start': {
      const stream = ensureStream(s, sessionId);
      const cb = inner.content_block || {};

      switch (cb.type) {
        case 'thinking':
          stream.thinkingStarted = true;
          break;
        case 'tool_use':
          stream.pendingTool = {
            id: cb.id || '',
            name: cb.name || 'unknown',
            inputJson: '',
            startTime: Date.now(),
          };
          // Don't emit tool.started yet — wait until we have the full input from deltas
          break;
        // text block: nothing to do until deltas arrive
      }
      break;
    }

    case 'content_block_delta': {
      const stream = ensureStream(s, sessionId);
      const delta = inner.delta || {};
      const idx = inner.index;

      switch (delta.type) {
        case 'thinking_delta':
          yield {
            type: 'chat.thinking',
            content: delta.thinking || '',
            partial: true,
            id: mkId(), timestamp: now(), sessionId,
          };
          break;

        case 'text_delta':
          yield {
            type: 'chat.assistant',
            content: delta.text || '',
            partial: true,
            id: mkId(), timestamp: now(), sessionId,
          };
          break;

        case 'input_json_delta':
          if (stream.pendingTool) {
            stream.pendingTool.inputJson += (delta.partial_json || '');
          }
          break;
      }
      break;
    }

    case 'content_block_stop': {
      const stream = s.stream;
      if (!stream) break;

      // If we have a pending tool, emit tool.started with parsed input
      if (stream.pendingTool) {
        let toolInput: Record<string, unknown> = {};
        try { if (stream.pendingTool.inputJson) toolInput = JSON.parse(stream.pendingTool.inputJson); } catch {}

        const t = stream.pendingTool;
        yield {
          type: 'tool.started',
          toolName: t.name,
          toolInput,
          files: deriveFileEvents(t.name, toolInput, sessionId).map(f => f.path),
          id: mkId(), timestamp: now(), sessionId,
        };

        // Command started
        if ((t.name === 'Bash' || t.name === 'bash') && toolInput.command) {
          yield {
            type: 'command.started',
            command: String(toolInput.command),
            cwd: String(toolInput.workdir || ''),
            id: mkId(), timestamp: now(), sessionId,
          };
        }

        // Permission check
        if (isHighRisk(t.name)) {
          yield {
            type: 'permission.requested',
            toolName: t.name,
            toolInput,
            description: `${t.name}: ${JSON.stringify(toolInput).slice(0, 100)}`,
            risk: t.name === 'Bash' || t.name === 'bash' ? 'high' : 'medium',
            id: mkId(), timestamp: now(), sessionId,
          };
        }

        // Also set legacy tool tracker for matching tool_result later
        s.currentTool = { name: t.name, input: toolInput, startTime: t.startTime };
      }
      break;
    }

    case 'message_delta':
      // Contains stop_reason + updated usage — useful but not critical for display
      break;

    case 'message_stop':
      // End of streaming message
      break;
  }
}

// ── System event parser ──

function* parseSystemEvent(evt: any, sessionId: string, id: string, ts: string, s: ParserState): Generator<AppEvent> {
  switch (evt.subtype) {
    case 'init': {
      const agents: string[] = evt.agents || [];
      const tools: string[] = evt.tools || [];
      s.agents = agents;
      s.tools = tools;

      const init: SessionInitEvent = {
        id, timestamp: ts, sessionId,
        type: 'session.init',
        cwd: evt.cwd || '',
        model: evt.model || '',
        tools,
        agents,
        skills: evt.skills || [],
        slashCommands: evt.slash_commands || [],
        mcpServers: (evt.mcp_servers || []).map((m: any) => ({ name: m.name || '', status: m.status || '' })),
        permissionMode: evt.permissionMode || '',
      };
      yield init;
      break;
    }

    case 'status': {
      const status: SessionStatusEvent = {
        id, timestamp: ts, sessionId,
        type: 'session.status',
        status: evt.status || '',
      };
      yield status;
      break;
    }

    case 'thinking_tokens': {
      const tt: ThinkingTokensEvent = {
        id, timestamp: ts, sessionId,
        type: 'thinking.tokens',
        estimatedTokens: evt.estimated_tokens || 0,
        estimatedTokensDelta: evt.estimated_tokens_delta || 0,
      };
      yield tt;
      break;
    }

    case 'task_started': {
      const task: TaskStartedEvent = {
        id, timestamp: ts, sessionId,
        type: 'task.started',
        taskId: evt.task_id || '',
        toolUseId: evt.tool_use_id || '',
        description: evt.description || '',
        taskType: evt.task_type || '',
      };
      yield task;
      break;
    }

    case 'task_notification': {
      const task: TaskCompletedEvent = {
        id, timestamp: ts, sessionId,
        type: 'task.completed',
        taskId: evt.task_id || '',
        toolUseId: evt.tool_use_id || '',
        status: evt.status || '',
        summary: evt.summary || '',
        outputFile: evt.output_file || '',
      };
      yield task;
      break;
    }

    case 'api_error':
      log.warn('API error event', { sessionId: sessionId.slice(0, 8), message: evt.message || evt.error });
      yield {
        type: 'session.error',
        message: evt.message || evt.error || 'API error',
        code: 'api_error',
        id, timestamp: ts, sessionId,
      };
      break;

    case 'compact_boundary': {
      yield {
        type: 'session.compacted',
        tokensRemoved: evt.tokens_removed ?? evt.token_removed ?? undefined,
        inputTokens: evt.input_tokens ?? undefined,
        outputTokens: evt.output_tokens ?? undefined,
        messageCount: evt.messages ?? evt.message_count ?? undefined,
        id, timestamp: ts, sessionId,
      };
      break;
    }
  }
}

// ── User event parser ──

function* parseUserEvent(evt: any, sessionId: string, id: string, ts: string, s: ParserState): Generator<AppEvent> {
  const msg = evt.message;
  if (!msg || msg.role !== 'user') return;

  const content = msg.content;
  let text = '';

  // Check for tool_result content blocks
  const blocks = Array.isArray(content) ? content : [];
  let toolResult: { toolUseId: string; content: string; isError: boolean } | null = null;

  if (Array.isArray(content)) {
    const textBlocks = content.filter((b: any) => b.type === 'text' && b.text);
    text = textBlocks.map((b: any) => b.text).join('');

    // Find tool_result block
    const tr = content.find((b: any) => b.type === 'tool_result');
    if (tr) {
      toolResult = {
        toolUseId: tr.tool_use_id || '',
        content: typeof tr.content === 'string' ? tr.content : (Array.isArray(tr.content) ? tr.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('') : ''),
        isError: tr.is_error || false,
      };
    }
  } else if (typeof content === 'string') {
    text = content;
  }

  // Try to extract real text from JSON-encoded content
  if (typeof content === 'string') {
    try {
      const parsed = JSON.parse(content);
      if (parsed.messages?.[0]?.content) text = parsed.messages[0].content;
    } catch {}
  }

  // Emit tool.completed from tool_result
  if (toolResult) {
    const t = s.currentTool;
    const toolName = t?.name || 'unknown';
    const toolInput = t?.input || {};
    const success = !toolResult.isError;
    const summary = toolResult.content.slice(0, 200);
    const durationMs = t ? Date.now() - t.startTime : 0;

    yield {
      type: 'tool.completed',
      toolName,
      toolInput,
      success,
      summary,
      durationMs,
      files: deriveFileEvents(toolName, toolInput, sessionId).map(f => f.path),
      diff: undefined,
      id: mkId(), timestamp: now(), sessionId,
    };

    // Command finished
    const cmdEvt = deriveCommandEvent(toolName, toolInput, sessionId, success ? 0 : 1, durationMs);
    if (cmdEvt) yield cmdEvt;

    s.currentTool = null;
  }

  // Emit user chat message (only if there's actual user text)
  if (text && !text.startsWith('This session is being continued') && !text.startsWith('Primary Request')) {
    if (text.startsWith('Compacted')) {
      yield { type: 'chat.assistant', content: text.startsWith('✅') ? text : '✅ ' + text, partial: false, id: mkId(), timestamp: now(), sessionId };
    } else {
      yield { type: 'chat.user', content: text, id: mkId(), timestamp: now(), sessionId };
    }
  }
}

// ── Assistant event parser (legacy fallback) ──

function* parseAssistantEvent(evt: any, sessionId: string, id: string, ts: string, s: ParserState): Generator<AppEvent> {
  if (!evt.message?.content) return;
  const blocks = Array.isArray(evt.message.content) ? evt.message.content : [];

  for (const block of blocks) {
    const blockId = mkId();

    switch (block.type) {
      case 'thinking':
        yield {
          type: 'chat.thinking',
          content: block.thinking || block.text || '',
          partial: true,
          id: blockId, timestamp: now(), sessionId,
        };
        break;

      case 'text':
        yield {
          type: 'chat.assistant',
          content: block.text || '',
          partial: true,
          id: blockId, timestamp: now(), sessionId,
        };
        break;

      case 'tool_use': {
        const tName = block.name || block.tool || 'unknown';
        const tInput = block.input || {};

        s.currentTool = { name: tName, input: tInput, startTime: Date.now() };
        yield {
          type: 'tool.started',
          toolName: tName,
          toolInput: tInput,
          files: deriveFileEvents(tName, tInput, sessionId).map(f => f.path),
          id: blockId, timestamp: now(), sessionId,
        };

        for (const fe of deriveFileEvents(tName, tInput, sessionId)) yield fe;

        if ((tName === 'Bash' || tName === 'bash') && tInput.command) {
          yield {
            type: 'command.started',
            command: String(tInput.command),
            cwd: String(tInput.workdir || ''),
            id: mkId(), timestamp: now(), sessionId,
          };
        }

        if (isHighRisk(tName)) {
          yield {
            type: 'permission.requested',
            toolName: tName,
            toolInput: tInput,
            description: `${tName}: ${JSON.stringify(tInput).slice(0, 100)}`,
            risk: tName === 'Bash' || tName === 'bash' ? 'high' : 'medium',
            id: mkId(), timestamp: now(), sessionId,
          };
        }
        break;
      }

      case 'tool_result': {
        let success = true;
        const tResult = block.content || block.result || '';
        const text = Array.isArray(tResult) ? tResult.filter((b: any) => b.type === 'text' && b.text).map((b: any) => b.text).join('') : String(tResult);
        let summary = text.slice(0, 200);
        let diff: string | undefined;

        if (block.is_error || block.isError) success = false;

        const t = s.currentTool;
        const toolName = t?.name || 'unknown';
        if (['Write', 'Edit', 'MultiEdit', 'write_file', 'edit_file', 'multi_edit'].some(n => n === toolName || toolName.includes(n))) {
          const diffMatch = text.match(/@@[\s\S]*?(?=\n\n|$)/);
          if (diffMatch) diff = diffMatch[0].slice(0, 2000);
        }

        const durationMs = t ? Date.now() - t.startTime : 0;
        const toolInput = t?.input || {};

        yield {
          type: 'tool.completed',
          toolName, toolInput, success, summary, durationMs,
          files: deriveFileEvents(toolName, toolInput, sessionId).map(f => f.path),
          diff, id: blockId, timestamp: now(), sessionId,
        };

        const cmdEvt = deriveCommandEvent(toolName, toolInput, sessionId, success ? 0 : 1, durationMs);
        if (cmdEvt) yield cmdEvt;

        s.currentTool = null;
        break;
      }
    }
  }
}

// ── Result event processor ──

function* handleResult(evt: any, sessionId: string, _id: string, _ts: string, s: ParserState): Generator<AppEvent> {
  const u = evt.usage || evt.modelUsage || null;
  const hasAnyUsage = (u && (u.input_tokens || u.inputTokens || u.output_tokens || u.outputTokens)) ||
    evt.inputTokens || evt.outputTokens ||
    (evt.modelUsage && typeof evt.modelUsage === 'object' && Object.keys(evt.modelUsage).length > 0);

  if (hasAnyUsage) {
    const turnInput = (u?.input_tokens ?? u?.inputTokens ?? evt.inputTokens ?? 0) as number;
    const turnOutput = (u?.output_tokens ?? u?.outputTokens ?? evt.outputTokens ?? 0) as number;
    const turnCacheCreation = (u?.cache_creation_input_tokens ?? u?.cacheCreationInputTokens ?? 0) as number;
    const turnCacheRead = (u?.cache_read_input_tokens ?? u?.cacheReadInputTokens ?? 0) as number;
    const turnDuration = (evt.duration_ms ?? evt.durationMs ?? evt.duration_api_ms ?? 0) as number;

    s.cumInputTokens += turnInput;
    s.cumOutputTokens += turnOutput;
    s.cumCacheCreation += turnCacheCreation;
    s.cumCacheRead += turnCacheRead;
    s.requestCount += 1;
    s.totalDurationMs += turnDuration;

    const turnModels: ModelUsage[] = [];
    const rawModelUsage: Record<string, any> = evt.modelUsage || {};
    for (const [modelName, mu] of Object.entries(rawModelUsage)) {
      if (!mu || typeof mu !== 'object') continue;
      const mInput = (mu.inputTokens || mu.input_tokens || 0) as number;
      const mOutput = (mu.outputTokens || mu.output_tokens || 0) as number;
      const mCacheCreate = (mu.cacheCreationInputTokens || mu.cache_creation_input_tokens || 0) as number;
      const mCacheRead = (mu.cacheReadInputTokens || mu.cache_read_input_tokens || 0) as number;

      const prev = s.modelTotals.get(modelName);
      s.modelTotals.set(modelName, {
        input: (prev?.input || 0) + mInput,
        output: (prev?.output || 0) + mOutput,
        cacheCreation: (prev?.cacheCreation || 0) + mCacheCreate,
        cacheRead: (prev?.cacheRead || 0) + mCacheRead,
      });

      turnModels.push({
        modelName,
        inputTokens: mInput, outputTokens: mOutput,
        cacheCreationInputTokens: mCacheCreate, cacheReadInputTokens: mCacheRead,
        isSubagent: isSubagentModel(modelName),
        costUSD: calcCost(modelName, mInput, mOutput, mCacheCreate, mCacheRead),
      });
    }

    if (turnModels.length > 0 && (turnCacheRead > 0 || turnCacheCreation > 0)) {
      const hasAnyCache = turnModels.some(m => m.cacheReadInputTokens > 0 || m.cacheCreationInputTokens > 0);
      if (!hasAnyCache) {
        turnModels[0].cacheReadInputTokens += turnCacheRead;
        turnModels[0].cacheCreationInputTokens += turnCacheCreation;
        const prev = s.modelTotals.get(turnModels[0].modelName);
        if (prev) { prev.cacheRead += turnCacheRead; prev.cacheCreation += turnCacheCreation; }
      }
    }

    if (turnModels.length === 0 && (turnInput > 0 || turnOutput > 0)) {
      const defaultModel = 'claude-sonnet-4-20250514';
      const prev = s.modelTotals.get(defaultModel);
      s.modelTotals.set(defaultModel, { input: (prev?.input || 0) + turnInput, output: (prev?.output || 0) + turnOutput, cacheCreation: (prev?.cacheCreation || 0) + turnCacheCreation, cacheRead: (prev?.cacheRead || 0) + turnCacheRead });
      turnModels.push({
        modelName: defaultModel,
        inputTokens: turnInput, outputTokens: turnOutput,
        cacheCreationInputTokens: turnCacheCreation, cacheReadInputTokens: turnCacheRead,
        isSubagent: false,
        costUSD: calcCost(defaultModel, turnInput, turnOutput, turnCacheCreation, turnCacheRead),
      });
    }

    const cumModels: ModelUsage[] = [];
    for (const [modelName, totals] of s.modelTotals) {
      cumModels.push({
        modelName,
        inputTokens: totals.input, outputTokens: totals.output,
        cacheCreationInputTokens: totals.cacheCreation, cacheReadInputTokens: totals.cacheRead,
        isSubagent: isSubagentModel(modelName),
        costUSD: calcCost(modelName, totals.input, totals.output, totals.cacheCreation, totals.cacheRead),
      });
    }

    const contextLimit = 1_000_000;
    const contextUsed = s.requestCount === 1 ? turnInput : s.cumInputTokens;

    yield {
      type: 'session.usage',
      id: mkId(), timestamp: now(), sessionId,
      inputTokens: s.cumInputTokens,
      outputTokens: s.cumOutputTokens,
      cacheCreationInputTokens: s.cumCacheCreation,
      cacheReadInputTokens: s.cumCacheRead,
      models: cumModels,
      requestCount: s.requestCount,
      totalDurationMs: s.totalDurationMs,
      turn: {
        inputTokens: turnInput, outputTokens: turnOutput,
        cacheCreationInputTokens: turnCacheCreation, cacheReadInputTokens: turnCacheRead,
        durationMs: turnDuration,
        modelUsage: turnModels,
      },
      contextWindow: {
        used: contextUsed, limit: contextLimit,
        percentUsed: Math.round((contextUsed / contextLimit) * 1000) / 10,
      },
    } satisfies SessionUsageEvent;
  }

  yield { type: 'session.waiting', id: mkId(), timestamp: now(), sessionId };
}
