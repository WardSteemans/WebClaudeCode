import type { AppEvent } from '@cc-gui/shared';
import type { ParserState, StreamState } from './state.js';
import { mkId, now } from './state.js';
import { emitToolStarted } from './toolEmitters.js';
import type { RawStreamEvent, StreamInner } from './eventTypes.js';

// ── Helpers ──

function ensureStream(s: ParserState): StreamState {
  if (!s.stream) s.stream = { messageId: '', model: '', parentToolUseId: null, inputTokens: 0, pendingTool: null, thinkingStarted: false };
  return s.stream;
}

// ── Stream event parser (Claude Code v2.x format) ──

export function* parseStreamEvent(evt: RawStreamEvent, sessionId: string, s: ParserState): Generator<AppEvent> {
  const inner: StreamInner | undefined = evt.event;
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

      yield {
        id: mkId(), timestamp: now(), sessionId,
        type: 'stream.message',
        messageId: stream.messageId,
        model: stream.model,
        parentToolUseId: stream.parentToolUseId,
        inputTokens: stream.inputTokens,
        ttftMs: evt.ttft_ms,
      };
      break;
    }

    case 'content_block_start': {
      const stream = ensureStream(s);
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
          break;
        // text block: nothing to do until deltas arrive
      }
      break;
    }

    case 'content_block_delta': {
      const stream = ensureStream(s);
      const delta = inner.delta || {};

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

      if (stream.pendingTool) {
        let toolInput: Record<string, unknown> = {};
        try { if (stream.pendingTool.inputJson) toolInput = JSON.parse(stream.pendingTool.inputJson); } catch {}

        const t = stream.pendingTool;
        yield* emitToolStarted(t.name, toolInput, sessionId);

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
