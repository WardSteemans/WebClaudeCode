import type { AppEvent } from '@cc-gui/shared';
import { createLogger } from '../../logger.js';
import { state, mkId, now } from './state.js';
import { parseStreamEvent } from './streamParser.js';
import { parseSystemEvent } from './systemParser.js';
import { parseUserEvent } from './userParser.js';
import { parseAssistantEvent } from './assistantParser.js';
import { handleResult } from './resultProcessor.js';
import type { RawClaudeEvent, RawResultEvent } from './eventTypes.js';

const log = createLogger('eventParser');

// ── Main parser entry point ──

export function* parseClaudeEvent(line: string, sessionId: string): Generator<AppEvent> {
  let evt: RawClaudeEvent;
  try { evt = JSON.parse(line) as RawClaudeEvent; } catch {
    log.debug('non-JSON line skipped', { sessionId: sessionId.slice(0, 8), linePreview: line.slice(0, 100) });
    return;
  }

  const id = mkId();
  const ts = now();
  const s = state(sessionId);

  switch (evt.type) {
    // ── Stream event (v2.x format) ──
    case 'stream_event':
      yield* parseStreamEvent(evt, sessionId, s);
      break;

    // ── System events ──
    case 'system':
      yield* parseSystemEvent(evt, sessionId, id, ts, s);
      break;

    // ── User (prompt or tool_result) ──
    case 'user':
      yield* parseUserEvent(evt, sessionId, id, ts, s);
      break;

    // ── Assistant (legacy aggregated format — fallback) ──
    case 'assistant':
      if (!s.stream || s.stream.messageId === '') {
        yield* parseAssistantEvent(evt, sessionId, id, ts, s);
      }
      break;

    // ── Result / message_stop (end of turn) ──
    case 'result':
    case 'message_stop':
      s.stream = null;
      if (evt.type === 'result') {
        yield* handleResult(evt, sessionId, s);
      }
      break;

    // ── Unknown or absent type ──
    default: {
      // Typeless events with usage data (Claude Code >= 2.x result format)
      if (!evt.type && ((evt as RawResultEvent).usage || (evt as RawResultEvent).modelUsage || (evt as RawResultEvent).is_error !== undefined)) {
        s.stream = null;
        yield* handleResult(evt as RawResultEvent, sessionId, s);
        break;
      }
      // Events with unknown type that still carry usage data
      if (evt.type && ((evt as RawResultEvent).usage || (evt as RawResultEvent).modelUsage)) {
        log.debug('unknown event type — treating as result', { sessionId: sessionId.slice(0, 8), type: evt.type });
        s.stream = null;
        yield* handleResult(evt as RawResultEvent, sessionId, s);
      }
    }
  }
}

// Re-export for external consumers
export { resetParser } from './state.js';
