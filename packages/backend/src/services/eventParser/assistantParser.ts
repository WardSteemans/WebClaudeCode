import type { AppEvent } from '@cc-gui/shared';
import type { ParserState } from './state.js';
import type { RawAssistantEvent, AssistantBlock } from './eventTypes.js';
import { mkId, now } from './state.js';
import { deriveFileEvents, deriveCommandEvent, emitToolStarted } from './toolEmitters.js';

// ── Assistant event parser (legacy aggregated format — fallback) ──

export function* parseAssistantEvent(evt: RawAssistantEvent, sessionId: string, _id: string, _ts: string, s: ParserState): Generator<AppEvent> {
  if (!evt.message?.content) return;
  const blocks = Array.isArray(evt.message.content) ? evt.message.content : [];

  for (const block of blocks as AssistantBlock[]) {
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
        yield* emitToolStarted(tName, tInput, sessionId);

        // Legacy path also yields file events separately
        for (const fe of deriveFileEvents(tName, tInput, sessionId)) yield fe;

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
