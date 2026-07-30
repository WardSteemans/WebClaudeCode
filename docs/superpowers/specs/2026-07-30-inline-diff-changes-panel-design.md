# Inline Diff & Changes Panel

**Date:** 2026-07-30
**Status:** approved

## Problem

Wanneer Claude Code tools bestanden aanpast (Write, Edit), worden de wijzigingen niet visueel getoond in de chat. De backend stuurt al diff-data mee (`ToolCompletedEvent.diff`, `FileChangedEvent.patch`), maar de frontend toont alleen bestandsnamen — geen regel-voor-regel changes.

## Design

### 1. Inline diff in ThinkingBlock

Wanneer een tool-segment uitgeklapt is en `tool.diff` bevat:
- Toon een compacte, gekleurde unified diff onder de tool output
- Bij > 30 regels: collapsed met "Show all N lines" toggle
- Groene `+` lijnen, rode `-` lijnen, cyaan `@@` headers

Ook in `FilesSegmentView`: bij `ThinkingFile` entries met `type === 'changed'` en een `diff`, toon de diff inline.

### 2. Changes panel

Nieuw panel — zelfde plek als Explorer/Git (linker activity bar). Nieuwe "Changes" knop (icoon: `FileDiff` van lucide).

**Store (`useDiffStore`):**
- Zustand store met `Map<chatId, FileChange[]>`
- `FileChange { path, type, diff?, timestamp }`
- Gevuld vanuit `useChatStream.handleEvent` bij `tool.completed` en `file.changed` events
- "Clear" actie per chat

**Panel component (`ChatDiffsPanel`):**
- Leest `activeChatId` en toont changes voor die chat
- Chronologische lijst met per file: icoon (added/modified/deleted), bestandsnaam, uitklapbare diff
- "Clear all" knop in header
- Hergebruikt dezelfde `InlineDiff` component

### 3. Shared `InlineDiff` component

Eén component, twee gebruikers:
- `ThinkingBlock.tsx` → inline (compact, in thinking flow)
- `ChatDiffsPanel.tsx` → panel (ruimere weergave)

Props: `diff: string` (unified diff), `maxLines?: number` (default 30 voor collapsed)

## Data flow

```
Backend WS event (tool.completed / file.changed)
  → useChatStream.handleEvent()
    → useDiffStore.addChange(chatId, change)    [new]
    → setThinkingBlocks (existing, now with diff rendering) [modified]
  → ChatDiffsPanel reads from useDiffStore      [new]
```

## Files

| File | Action | Description |
|------|--------|-------------|
| `packages/frontend/src/components/files/InlineDiff.tsx` | NEW | Shared diff renderer |
| `packages/frontend/src/store/diffStore.ts` | NEW | Zustand store per chat |
| `packages/frontend/src/components/panels/ChatDiffsPanel.tsx` | NEW | Changes panel |
| `packages/frontend/src/components/chat/ThinkingBlock.tsx` | MODIFY | Render diff in tool/file segments |
| `packages/frontend/src/hooks/useChatStream.ts` | MODIFY | Push changes to diffStore |
| `packages/frontend/src/App.tsx` | MODIFY | Add Changes button + panel rendering |
| `packages/frontend/src/lib/chat/types.ts` | MODIFY | Ensure `ThinkingFile.diff` is carried through |

## Scope boundaries

- **In scope:** Diffs tonen die via WS-events binnenkomen (tool.completed.diff, file.changed.patch)
- **Out of scope:** Git diffs (die heeft GitPanel al), diff syntax highlighting (te complex, unified diff coloring is voldoende), diff editor / approve-flow
