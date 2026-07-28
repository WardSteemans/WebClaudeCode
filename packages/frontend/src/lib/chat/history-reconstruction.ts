import type { ChatMessage, ThinkingTool, ThinkingSegment, ThinkingBlock } from './types';
import { thinkingSummary } from './thinking-utils';

// ==================== Types ====================

interface HistoryTextBlock {
  type: 'text';
  text: string;
}

interface HistoryThinkingBlock {
  type: 'thinking';
  thinking: string;
}

interface HistoryToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface HistoryToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string | unknown[];
}

type HistoryBlock = HistoryTextBlock | HistoryThinkingBlock | HistoryToolUseBlock | HistoryToolResultBlock;

export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
  blocks: HistoryBlock[];
  timestamp: string | null;
}

// ==================== Helpers ====================

function isToolResult(b: HistoryBlock): b is HistoryToolResultBlock {
  return b.type === 'tool_result';
}

function isText(b: HistoryBlock): b is HistoryTextBlock {
  return b.type === 'text';
}

function isThinking(b: HistoryBlock): b is HistoryThinkingBlock {
  return b.type === 'thinking';
}

function isToolUse(b: HistoryBlock): b is HistoryToolUseBlock {
  return b.type === 'tool_use';
}

// ==================== Reconstruction ====================

/**
 * Reconstruct ChatMessage[] and ThinkingBlock map from raw history data.
 * Preserves thinking blocks, tool calls, and tool results.
 */
export function reconstructHistory(raw: HistoryMessage[]): {
  msgs: ChatMessage[];
  thinkBlocks: Map<string, ThinkingBlock>;
} {
  const msgs: ChatMessage[] = [];
  const thinkBlocks = new Map<string, ThinkingBlock>();
  // Track tool IDs → their parent thinking block for wiring up results
  const toolToBlock = new Map<string, string>();

  for (const m of raw) {
    const blocks = m.blocks || [];

    if (m.role === 'user') {
      // Check for tool_result blocks — wire them up to existing thinking blocks
      const toolResults = blocks.filter(isToolResult);
      if (toolResults.length > 0) {
        for (const tr of toolResults) {
          const blockId = toolToBlock.get(tr.tool_use_id || '');
          if (blockId) {
            const block = thinkBlocks.get(blockId);
            if (block) {
              const segs = block.segments.map((seg) => {
                if (seg.kind === 'tool' && seg.tool.name && seg.tool.status === 'done') {
                  if (!seg.tool.output && tr.content) {
                    const output = typeof tr.content === 'string' ? tr.content.slice(0, 200) : JSON.stringify(tr.content).slice(0, 200);
                    return { ...seg, tool: { ...seg.tool, output } };
                  }
                }
                return seg;
              });
              thinkBlocks.set(blockId, { ...block, segments: segs });
            }
          }
        }
        // Don't add tool_result-only user messages as separate chat messages
        const hasTextBlocks = blocks.some((b) => isText(b) && b.text);
        if (hasTextBlocks || toolResults.length === 0) {
          msgs.push({ role: 'user', content: m.content, id: crypto.randomUUID(), timestamp: m.timestamp || new Date().toISOString() });
        }
        continue;
      }
      // Regular user message
      msgs.push({ role: 'user', content: m.content, id: crypto.randomUUID(), timestamp: m.timestamp || new Date().toISOString() });
    } else if (m.role === 'assistant') {
      const textBlocks = blocks.filter((b): b is HistoryTextBlock => isText(b) && !!b.text);
      const thinkBlocks_raw = blocks.filter(isThinking);
      const toolBlocks = blocks.filter(isToolUse);

      // If there are thinking/tool blocks, create a ThinkingBlock
      if (thinkBlocks_raw.length > 0 || toolBlocks.length > 0) {
        const blockId = crypto.randomUUID();
        const segments: ThinkingSegment[] = [];
        let startTime = Date.now();

        // Interleave thinking and tool blocks in original order
        for (const b of blocks) {
          if (isThinking(b)) {
            const text = b.thinking || '';
            segments.push({
              id: crypto.randomUUID(),
              kind: 'thinking',
              text,
              summary: thinkingSummary(text),
            });
          } else if (isToolUse(b)) {
            let detail = '';
            if (b.input?.query) detail = `"${String(b.input.query).slice(0, 60)}"`;
            else if (b.input?.url) detail = String(b.input.url).slice(0, 60);
            else if (b.input && Object.keys(b.input).length > 0) detail = JSON.stringify(b.input).slice(0, 80);

            const tool: ThinkingTool = {
              id: crypto.randomUUID(),
              name: b.name || 'unknown',
              detail,
              status: 'done', // history tools are always completed
            };
            segments.push({ id: tool.id, kind: 'tool', tool });
            toolToBlock.set(b.id, blockId);
          }
        }

        if (m.timestamp) startTime = new Date(m.timestamp).getTime();
        thinkBlocks.set(blockId, { segments, secs: 0, startTime });

        // Add a tool-type message for the thinking block
        msgs.push({ role: 'tool', content: '', id: blockId, timestamp: m.timestamp || new Date().toISOString() });
      }

      // Add the assistant text message if there's content
      const text = textBlocks.map((b) => b.text).join('\n');
      if (text) {
        msgs.push({ role: 'assistant', content: text, id: crypto.randomUUID(), timestamp: m.timestamp || new Date().toISOString() });
      }
    }
  }

  return { msgs, thinkBlocks };
}
