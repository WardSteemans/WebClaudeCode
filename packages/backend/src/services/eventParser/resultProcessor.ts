import type { AppEvent, ModelUsage } from '@cc-gui/shared';
import type { ParserState } from './state.js';
import type { RawResultEvent, ResultUsage } from './eventTypes.js';
import { mkId, now } from './state.js';
import { calcCost, isSubagentModel } from '../../integrations/pricing.js';

// ── Helpers ──

interface TurnUsage {
  turnInput: number;
  turnOutput: number;
  turnCacheCreation: number;
  turnCacheRead: number;
  turnDuration: number;
}

/** Extract token counts and duration from the various shapes Claude Code emits. */
function extractTurnUsage(evt: RawResultEvent): TurnUsage {
  const u: ResultUsage | null = evt.usage || evt.modelUsage || null;
  return {
    turnInput: (u?.input_tokens ?? u?.inputTokens ?? evt.inputTokens ?? 0),
    turnOutput: (u?.output_tokens ?? u?.outputTokens ?? evt.outputTokens ?? 0),
    turnCacheCreation: (u?.cache_creation_input_tokens ?? u?.cacheCreationInputTokens ?? 0),
    turnCacheRead: (u?.cache_read_input_tokens ?? u?.cacheReadInputTokens ?? 0),
    turnDuration: (evt.duration_ms ?? evt.durationMs ?? evt.duration_api_ms ?? 0),
  };
}

/** Returns true if the event carries any kind of usage data. */
function hasUsageData(evt: RawResultEvent): boolean {
  const u: ResultUsage | null = evt.usage || null;
  if (u) {
    if ((u.input_tokens ?? 0) > 0 || (u.inputTokens ?? 0) > 0 ||
        (u.output_tokens ?? 0) > 0 || (u.outputTokens ?? 0) > 0) return true;
  }
  if ((evt.inputTokens ?? 0) > 0) return true;
  if ((evt.outputTokens ?? 0) > 0) return true;
  if (evt.modelUsage && typeof evt.modelUsage === 'object' && Object.keys(evt.modelUsage).length > 0) return true;
  return false;
}

/** Process per-model usage, update state.modelTotals, return turn-level model list. */
function processModelUsage(
  rawModelUsage: NonNullable<RawResultEvent['modelUsage']>,
  turnCacheRead: number,
  turnCacheCreation: number,
  turnInput: number,
  turnOutput: number,
  s: ParserState,
): ModelUsage[] {
  const turnModels: ModelUsage[] = [];

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

  // If cache tokens exist at turn level but no model reported them, assign to first model
  if (turnModels.length > 0 && (turnCacheRead > 0 || turnCacheCreation > 0)) {
    const hasAnyCache = turnModels.some(m => m.cacheReadInputTokens > 0 || m.cacheCreationInputTokens > 0);
    if (!hasAnyCache) {
      turnModels[0].cacheReadInputTokens += turnCacheRead;
      turnModels[0].cacheCreationInputTokens += turnCacheCreation;
      const prev = s.modelTotals.get(turnModels[0].modelName);
      if (prev) { prev.cacheRead += turnCacheRead; prev.cacheCreation += turnCacheCreation; }
    }
  }

  return turnModels;
}

/** Build cumulative model usage list from state totals. */
function buildCumModels(s: ParserState): ModelUsage[] {
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
  return cumModels;
}

// ── Result event processor ──

export function* handleResult(evt: RawResultEvent, sessionId: string, s: ParserState): Generator<AppEvent> {
  if (!hasUsageData(evt)) {
    yield { type: 'session.waiting', id: mkId(), timestamp: now(), sessionId };
    return;
  }

  const { turnInput, turnOutput, turnCacheCreation, turnCacheRead, turnDuration } = extractTurnUsage(evt);

  // Update cumulative counters
  s.cumInputTokens += turnInput;
  s.cumOutputTokens += turnOutput;
  s.cumCacheCreation += turnCacheCreation;
  s.cumCacheRead += turnCacheRead;
  s.requestCount += 1;
  s.totalDurationMs += turnDuration;

  // Process per-model usage
  let turnModels = processModelUsage(
    evt.modelUsage || {},
    turnCacheRead, turnCacheCreation, turnInput, turnOutput, s,
  );

  // Fallback: no per-model data → assume single default model
  if (turnModels.length === 0 && (turnInput > 0 || turnOutput > 0)) {
    const defaultModel = 'claude-sonnet-4-20250514';
    const prev = s.modelTotals.get(defaultModel);
    s.modelTotals.set(defaultModel, {
      input: (prev?.input || 0) + turnInput,
      output: (prev?.output || 0) + turnOutput,
      cacheCreation: (prev?.cacheCreation || 0) + turnCacheCreation,
      cacheRead: (prev?.cacheRead || 0) + turnCacheRead,
    });
    turnModels.push({
      modelName: defaultModel,
      inputTokens: turnInput, outputTokens: turnOutput,
      cacheCreationInputTokens: turnCacheCreation, cacheReadInputTokens: turnCacheRead,
      isSubagent: false,
      costUSD: calcCost(defaultModel, turnInput, turnOutput, turnCacheCreation, turnCacheRead),
    });
  }

  // Build cumulative models
  const cumModels = buildCumModels(s);

  // Context window estimate
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
  };

  yield { type: 'session.waiting', id: mkId(), timestamp: now(), sessionId };
}
