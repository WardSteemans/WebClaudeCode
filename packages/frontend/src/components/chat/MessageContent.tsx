import { useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// ==================== Types ====================

interface PastedTextSegments {
  type: 'normal' | 'pasted';
  content: string;
  label?: string;
}

// ==================== Regex ====================

/** Regex to extract the line count from the marker */
const PASTED_LINE_RE = /---\s+Begin\s+\[Pasted text(?: #(\d+))? · (\d+) lines\]\s*---/;

// ==================== Helpers ====================

/**
 * Splits message content into segments: normal markdown and collapsed pasted-text blocks.
 */
function splitPastedBlocks(text: string): PastedTextSegments[] {
  const segments: PastedTextSegments[] = [];
  let lastIndex = 0;
  const regex = /---\s+Begin\s+\[Pasted text[^\]]*\]\s*---\n([\s\S]*?)\n---\s+End\s+\[Pasted text[^\]]*\]\s*---/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // Normal text before this block
    if (match.index > lastIndex) {
      segments.push({ type: 'normal', content: text.slice(lastIndex, match.index) });
    }
    // Extract label info
    const headerMatch = text.slice(match.index, match.index + match[0].length).match(PASTED_LINE_RE);
    const num = headerMatch?.[1] ? ` #${headerMatch[1]}` : '';
    const lines = headerMatch?.[2] || '?';
    segments.push({
      type: 'pasted',
      content: match[1],
      label: `📋 Pasted text${num} · ${lines} lines`,
    });
    lastIndex = match.index + match[0].length;
  }

  // Remaining normal text
  if (lastIndex < text.length) {
    segments.push({ type: 'normal', content: text.slice(lastIndex) });
  }

  return segments.length > 0 ? segments : [{ type: 'normal', content: text }];
}

// ==================== Component ====================

/** Renders message content with pasted-text blocks collapsed by default. */
export function MessageContent({ content }: { content: string }) {
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const segments = useMemo(() => splitPastedBlocks(content), [content]);

  return (
    <>
      {segments.map((seg, i) =>
        seg.type === 'normal' ? (
          <div key={i} className="[&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-slate-300 dark:[&_th]:border-slate-700 [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:border-slate-300 dark:[&_td]:border-slate-700 [&_td]:px-2 [&_td]:py-1 [&_strong]:text-slate-900 dark:[&_strong]:text-slate-100 [&_a]:text-accent-600 dark:[&_a]:text-accent-400 [&_a]:underline [&_code]:bg-slate-100 dark:[&_code]:bg-slate-700/50 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[13px] [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_p]:mb-1.5 [&_p:last-child]:mb-0 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-medium">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{seg.content}</ReactMarkdown>
          </div>
        ) : (
          <div key={i} className="mb-2 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
            <button
              onClick={() => setExpanded((prev) => ({ ...prev, [i]: !prev[i] }))}
              className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-xs font-medium bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 transition-colors"
            >
              <span className="text-[10px]">{expanded[i] ? '▼' : '▶'}</span>
              <span>{seg.label}</span>
            </button>
            {expanded[i] && (
              <div className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400 max-h-64 overflow-y-auto border-t border-slate-200 dark:border-slate-700">
                <pre className="whitespace-pre-wrap font-sans leading-relaxed">{seg.content}</pre>
              </div>
            )}
          </div>
        )
      )}
    </>
  );
}
