# Inline Diff & Changes Panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show effective file changes inline in thinking blocks and in a dedicated Changes sidebar panel.

**Architecture:** A shared `InlineDiff` component renders unified diffs. A zustand `diffStore` collects changes per chat from WS events. `ThinkingBlock` renders diffs inline at tool/file segments. `ChatDiffsPanel` reads from the store to show all changes per chat in a sidebar panel.

**Tech Stack:** React 18, TypeScript, Zustand, Tailwind CSS, lucide-react

## Global Constraints

- Diff data already arrives via WS events (`ToolCompletedEvent.diff`, `FileChangedEvent.patch`) — no backend changes needed
- No persistence for the diff store — session-only, clears on reload
- Follow existing code patterns: same panel structure as GitPanel, same store pattern as eventBus
- Props must use the existing `workDir` / `chatId` conventions
- Use `FileDiff` icon from lucide-react for the Changes activity bar button

---

### Task 1: Create `InlineDiff` shared component

**Files:**
- Create: `packages/frontend/src/components/files/InlineDiff.tsx`

**Interfaces:**
- Produces: `InlineDiff({ diff, maxLines? }: { diff: string; maxLines?: number }) => JSX.Element`
  - `maxLines` defaults to 30. When diff exceeds this, collapsed by default with "Show all N lines" toggle.

- [ ] **Step 1: Write the component**

```tsx
import { useState, useMemo } from 'react';

interface InlineDiffProps {
  diff: string;
  maxLines?: number;
}

export function InlineDiff({ diff, maxLines = 30 }: InlineDiffProps) {
  const lines = useMemo(() => diff.split('\n'), [diff]);
  const [expanded, setExpanded] = useState(false);
  const collapsed = lines.length > maxLines;
  const displayLines = collapsed && !expanded ? lines.slice(0, maxLines) : lines;

  return (
    <div className="rounded border border-slate-200 dark:border-slate-700 overflow-hidden text-xs">
      <div className="max-h-[300px] overflow-auto bg-white dark:bg-[#0d1117]">
        {displayLines.map((line, i) => {
          let cls = 'px-2 whitespace-pre font-mono text-[11px] leading-relaxed';
          if (line.startsWith('@@')) cls += ' text-cyan-500 bg-cyan-500/5';
          else if (line.startsWith('+')) cls += ' text-green-500 bg-green-500/5';
          else if (line.startsWith('-')) cls += ' text-red-500 bg-red-500/5';
          else if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++'))
            cls += ' text-[var(--color-text-muted)] font-bold';
          else cls += ' text-[var(--color-text-secondary)]';
          return <div key={i} className={cls}>{line || ' '}</div>;
        })}
      </div>
      {collapsed && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full px-3 py-1 text-[11px] text-slate-500 hover:text-accent-600 dark:hover:text-accent-400 bg-slate-50 dark:bg-slate-800/30 hover:bg-slate-100 dark:hover:bg-slate-800/50 transition-colors border-t border-slate-200 dark:border-slate-700"
        >
          {expanded ? 'Show less' : `Show all ${lines.length} lines`}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit` from `packages/frontend`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/files/InlineDiff.tsx
git commit -m "add InlineDiff component for unified diff rendering"
```

---

### Task 2: Create `diffStore` (Zustand)

**Files:**
- Create: `packages/frontend/src/store/diffStore.ts`

**Interfaces:**
- Produces:
  - `useDiffStore(): DiffStore`
  - `FileChange { path: string; type: 'created' | 'modified' | 'deleted'; diff?: string; timestamp: string }`
  - `DiffStore { changesByChat: Record<string, FileChange[]>; addChange(chatId, change): void; clearChanges(chatId): void }`

- [ ] **Step 1: Write the store**

```typescript
import { create } from 'zustand';

export interface FileChange {
  path: string;
  type: 'created' | 'modified' | 'deleted';
  diff?: string;
  timestamp: string;
}

interface DiffStore {
  changesByChat: Record<string, FileChange[]>;
  addChange: (chatId: string, change: FileChange) => void;
  clearChanges: (chatId: string) => void;
}

export const useDiffStore = create<DiffStore>((set) => ({
  changesByChat: {},

  addChange: (chatId, change) =>
    set((s) => {
      const existing = s.changesByChat[chatId] || [];
      // Deduplicate: if same path already exists, update it instead of pushing
      const idx = existing.findIndex((c) => c.path === change.path);
      if (idx >= 0) {
        const updated = [...existing];
        updated[idx] = { ...change, timestamp: new Date().toISOString() };
        return { changesByChat: { ...s.changesByChat, [chatId]: updated } };
      }
      return {
        changesByChat: {
          ...s.changesByChat,
          [chatId]: [...existing, { ...change, timestamp: new Date().toISOString() }],
        },
      };
    }),

  clearChanges: (chatId) =>
    set((s) => {
      const next = { ...s.changesByChat };
      delete next[chatId];
      return { changesByChat: next };
    }),
}));
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit` from `packages/frontend`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/store/diffStore.ts
git commit -m "add diffStore for tracking file changes per chat"
```

---

### Task 3: Wire `useChatStream` to push changes into `diffStore`

**Files:**
- Modify: `packages/frontend/src/hooks/useChatStream.ts`

**Interfaces:**
- Consumes: `useDiffStore` from Task 2
- Consumes: `FileChange` type from Task 2

- [ ] **Step 1: Add import**

At the top of `useChatStream.ts`, add after the existing imports:

```typescript
import { useDiffStore } from '../store/diffStore';
```

- [ ] **Step 2: Push changes on `tool.completed`**

In `handleEvent`, inside the `case 'tool.completed':` block (around line 357), after the `setThinkingBlocks` call, add:

```typescript
// Push file changes to diffStore for the Changes panel
if (e.files && e.files.length > 0) {
  const diffStore = useDiffStore.getState();
  for (const f of e.files) {
    // Only push write/edit tool results that actually have a diff
    if (e.diff) {
      diffStore.addChange(chatId, {
        path: f,
        type: 'modified',
        diff: e.diff,
        timestamp: new Date().toISOString(),
      });
    }
  }
}
```

This goes inside the `case 'tool.completed':` block, after the existing `setThinkingBlocks(...)` and `setCollapsedSegments(...)` calls but before the `break`.

- [ ] **Step 3: Push changes on `file.changed`**

In `handleEvent`, inside the `case 'file.changed':` block (around line 453), after the `setThinkingBlocks` call, add:

```typescript
// Push to diffStore
const diffStore = useDiffStore.getState();
diffStore.addChange(chatId, {
  path: e.path,
  type: e.changeType,
  diff: e.patch,
  timestamp: new Date().toISOString(),
});
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit` from `packages/frontend`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/hooks/useChatStream.ts
git commit -m "push tool/file changes to diffStore from useChatStream"
```

---

### Task 4: Render diff inline in ThinkingBlock

**Files:**
- Modify: `packages/frontend/src/components/chat/ThinkingBlock.tsx`

**Interfaces:**
- Consumes: `InlineDiff` from Task 1

- [ ] **Step 1: Add import**

At the top of `ThinkingBlock.tsx`, add:

```typescript
import { InlineDiff } from '../files/InlineDiff';
```

- [ ] **Step 2: Render diff in `ToolSegmentView`**

In the `ToolSegmentView` function, in the `!collapsed` block (after the tool.output block), add diff rendering right before the closing `</div>` of the expanded content:

```tsx
{tool.diff && (
  <div className="mt-1">
    <InlineDiff diff={tool.diff} />
  </div>
)}
```

Insert this after line 85 (`</pre>` closing tag of `tool.output`) and before line 86 (the files section). Actually, the diff should come after both output AND files, so insert it after line 94 (`</div>` closing the files section).

- [ ] **Step 3: Render diff in `FilesSegmentView`**

In the `FilesSegmentView` function, in the `!collapsed` block, after each file entry, add diff rendering. Modify the file list rendering at lines 121-128 to include an `InlineDiff` when the file has a diff:

```tsx
{files.map((f, i) => (
  <div key={i}>
    <div className="flex items-center gap-1.5 text-[11px]">
      {f.type === 'read' && <Eye size={10} className="text-blue-400 shrink-0" />}
      {f.type !== 'read' && <FileText size={10} className="text-amber-400 shrink-0" />}
      <span className="text-slate-600 dark:text-slate-400 truncate">{f.path.split(/[/\\]/).pop()}</span>
      <span className="text-[10px] text-slate-500">{f.type}</span>
    </div>
    {f.diff && (
      <div className="mt-1 mb-1">
        <InlineDiff diff={f.diff} />
      </div>
    )}
  </div>
))}
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit` from `packages/frontend`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/chat/ThinkingBlock.tsx
git commit -m "render diff inline in thinking block tool and file segments"
```

---

### Task 5: Create `ChatDiffsPanel` component

**Files:**
- Create: `packages/frontend/src/components/panels/ChatDiffsPanel.tsx`

**Interfaces:**
- Consumes: `useDiffStore` from Task 2, `InlineDiff` from Task 1
- Produces: `ChatDiffsPanel({ chatId }: { chatId: string }) => JSX.Element`

- [ ] **Step 1: Write the component**

```tsx
import { useState } from 'react';
import { FileDiff, FilePlus, FileMinus, FileEdit, Trash2 } from 'lucide-react';
import { useDiffStore, type FileChange } from '../../store/diffStore';
import { InlineDiff } from '../files/InlineDiff';

interface ChatDiffsPanelProps {
  chatId: string;
}

const typeIcon = (type: FileChange['type']) => {
  switch (type) {
    case 'created': return <FilePlus size={12} className="text-green-500 shrink-0" />;
    case 'deleted': return <FileMinus size={12} className="text-red-500 shrink-0" />;
    case 'modified': return <FileEdit size={12} className="text-amber-500 shrink-0" />;
  }
};

export function ChatDiffsPanel({ chatId }: ChatDiffsPanelProps) {
  const changes = useDiffStore((s) => s.changesByChat[chatId] || []);
  const clearChanges = useDiffStore((s) => s.clearChanges);
  const [expandedPath, setExpandedPath] = useState<string | null>(null);

  if (!chatId) {
    return <div className="p-4 text-[var(--color-text-muted)] text-sm text-center">No chat selected</div>;
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--color-border)] shrink-0">
        <div className="flex items-center gap-1.5">
          <FileDiff size={14} className="text-[var(--color-text-muted)]" />
          <span className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest">
            Changes {changes.length > 0 && `· ${changes.length}`}
          </span>
        </div>
        {changes.length > 0 && (
          <button
            onClick={() => clearChanges(chatId)}
            className="p-0.5 text-[var(--color-text-muted)] hover:text-red-500 hover:bg-red-500/10 rounded transition-colors"
            title="Clear all changes"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {changes.length === 0 ? (
          <div className="p-4 text-center text-[var(--color-text-muted)] text-sm">
            No file changes yet
          </div>
        ) : (
          <div>
            {[...changes].reverse().map((change, i) => {
              const isExpanded = expandedPath === change.path;
              const fileName = change.path.split(/[/\\]/).pop() || change.path;

              return (
                <div key={`${change.path}-${i}`} className="border-b border-[var(--color-border)] last:border-0">
                  <button
                    onClick={() => setExpandedPath(isExpanded ? null : change.path)}
                    className="flex items-center gap-1.5 w-full text-left px-3 py-1.5 text-[13px] hover:bg-[var(--color-surface-hover)] transition-colors"
                  >
                    {typeIcon(change.type)}
                    <span className="truncate flex-1 text-[var(--color-text)]">{fileName}</span>
                    <span className="text-[10px] text-[var(--color-text-muted)] shrink-0">
                      {new Date(change.timestamp).toLocaleTimeString()}
                    </span>
                  </button>
                  {isExpanded && change.diff && (
                    <div className="px-3 pb-2">
                      <InlineDiff diff={change.diff} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit` from `packages/frontend`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/panels/ChatDiffsPanel.tsx
git commit -m "add ChatDiffsPanel for per-chat file changes overview"
```

---

### Task 6: Register Changes panel in `App.tsx`

**Files:**
- Modify: `packages/frontend/src/App.tsx`

**Interfaces:**
- Consumes: `ChatDiffsPanel` from Task 5
- Consumes: `FileDiff` icon from lucide-react

- [ ] **Step 1: Add imports**

At the top of `App.tsx`:

Add `FileDiff` to the lucide-react import on line 3 (join the existing import):
```typescript
import { Plus, X, FolderOpen, Code2, Sun, Moon, Files, MessageSquare, LayoutPanelLeft, GitBranch, Cloud, Settings as SettingsIcon, BarChart3, Puzzle, FileDiff } from 'lucide-react';
```

Add the panel import after the existing panel imports (after line 22):
```typescript
import { ChatDiffsPanel } from './components/panels/ChatDiffsPanel';
```

- [ ] **Step 2: Add `'changes'` to the `leftPanel` union type**

Change line 36 from:
```typescript
const [leftPanel, setLeftPanel] = useState<'explorer' | 'git' | 'azure' | 'overview' | 'capabilities'>('explorer');
```
to:
```typescript
const [leftPanel, setLeftPanel] = useState<'explorer' | 'git' | 'azure' | 'overview' | 'capabilities' | 'changes'>('explorer');
```

- [ ] **Step 3: Add activity bar button**

After the Capabilities button (lines 187-189), add the Changes button:

```tsx
<button onClick={() => { if (leftPanel === 'changes' && !explorer.collapsed) { explorer.toggle(); setLeftPanel('explorer'); } else { if (explorer.collapsed) explorer.toggle(); setLeftPanel('changes'); } }} className={`p-1.5 rounded-md transition-colors ${leftPanel === 'changes' && !explorer.collapsed ? 'text-accent-500 bg-accent-500/10' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]'}`} title="Changes">
  <FileDiff size={20} />
</button>
```

- [ ] **Step 4: Add left panel title case**

Update line 124 to include 'changes':
```typescript
const leftPanelTitle = leftPanel === 'git' ? 'Source Control' : leftPanel === 'azure' ? 'Azure DevOps' : leftPanel === 'overview' ? 'Overview' : leftPanel === 'capabilities' ? 'Capabilities' : leftPanel === 'changes' ? 'Changes' : 'Explorer';
```

- [ ] **Step 5: Add panel rendering**

After line 204 (Capabilities panel rendering), add:

```tsx
{!explorer.collapsed && leftPanel === 'changes' && <ErrorBoundary name="Changes panel"><ChatDiffsPanel chatId={activeTab?.activeChatId ?? ''} /></ErrorBoundary>}
```

- [ ] **Step 6: Verify it compiles**

Run: `npx tsc --noEmit` from `packages/frontend`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/src/App.tsx
git commit -m "add Changes panel to activity bar and left panel rendering"
```

---

### Task 7: Add `diff` to `ThinkingFile` in `file.changed` handler

**Files:**
- Modify: `packages/frontend/src/hooks/useChatStream.ts`

**Interfaces:**
- Produces: `ThinkingFile` entries with `diff` populated from `FileChangedEvent.patch`

- [ ] **Step 1: Add `diff` field to the `file.changed` ThinkingFile creation**

In `useChatStream.ts`, line 462, change:
```typescript
const newFile: ThinkingFile = { type: e.changeType === 'modified' ? 'changed' : e.changeType, path: e.path };
```
to:
```typescript
const newFile: ThinkingFile = { type: e.changeType === 'modified' ? 'changed' : e.changeType, path: e.path, diff: e.patch };
```

- [ ] **Step 2: Verify `ThinkingFile` type accepts `diff`**

The type in `packages/frontend/src/lib/chat/types.ts` already has `diff?: string` on `ThinkingFile`. Verified.

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit` from `packages/frontend`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/hooks/useChatStream.ts
git commit -m "include patch diff in file.changed ThinkingFile entries"
