// ── Chat domain types ──
// Re-exported from shared — all types live in @cc-gui/shared now.
// Keep this file as a re-export for internal consumers that already import from '../../lib/chat/types'.

export type {
  ThinkingTool,
  ThinkingFile,
  ThinkingSegment,
  ThinkingBlock,
  ChatMessage,
} from '@cc-gui/shared';

export { toolInputDetail } from '@cc-gui/shared';
