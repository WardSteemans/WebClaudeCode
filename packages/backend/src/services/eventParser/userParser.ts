import type { AppEvent } from '@cc-gui/shared';
import type { ParserState } from './state.js';
import type { RawUserEvent, RawUserTextBlock } from './eventTypes.js';
import { mkId, now } from './state.js';
import { deriveFileEvents, deriveCommandEvent } from './toolEmitters.js';

export function* parseUserEvent(evt: RawUserEvent, sessionId: string, _id: string, _ts: string, s: ParserState): Generator<AppEvent> {
  const msg = evt.message;
  if (!msg || msg.role !== 'user') return;

  const content = msg.content;
  let text = '';

  // Check for tool_result content blocks
  const blocks = Array.isArray(content) ? content : [];
  let toolResult: { toolUseId: string; content: string; isError: boolean } | null = null;

  if (Array.isArray(content)) {
    const textBlocks = content.filter((b): b is RawUserTextBlock => b.type === 'text');
    text = textBlocks.map(b => b.text ?? '').join('');

    // Find tool_result block
    const tr = content.find((b) => b.type === 'tool_result');
    if (tr) {
      toolResult = {
        toolUseId: tr.tool_use_id || '',
        content: typeof tr.content === 'string' ? tr.content : (Array.isArray(tr.content) ? tr.content.filter((b): b is RawUserTextBlock => b.type === 'text').map(b => b.text ?? '').join('') : ''),
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

  // ── Emit tool.completed from tool_result ──

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

  // ── Emit user chat message (only if there's actual user text) ──

  if (text && !text.startsWith('This session is being continued') && !text.startsWith('Primary Request')) {
    if (text.startsWith('Compacted')) {
      yield { type: 'chat.assistant', content: text.startsWith('✅') ? text : '✅ ' + text, partial: false, id: mkId(), timestamp: now(), sessionId };
    } else {
      yield { type: 'chat.user', content: text, id: mkId(), timestamp: now(), sessionId };
    }
  }
}
