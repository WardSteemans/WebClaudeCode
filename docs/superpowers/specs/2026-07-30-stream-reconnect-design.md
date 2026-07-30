# Stream Reconnect — Design Spec

**Status**: draft
**Date**: 2026-07-30
**Scope**: Backend session registry + event buffering + frontend catchup protocol

## Problem

When a chat is streaming (Claude is generating a response) and the user:
- Switches to another chat/tab within the app
- Closes the browser tab/window and comes back
- Opens a second browser tab pointing to the same app

…the streaming session is lost. The frontend ChatPanel unmounts, the WebSocket listener is removed, and events arriving during absence are discarded. On return, a fresh `useChatStream` instance has no knowledge of the in-progress stream.

The backend Claude process keeps running and generating events — they just have nowhere to go.

## Root Cause

Sessions are scoped to individual WebSocket connections (`ws/handler.ts` per-connection `activeSession` variable). The WS singleton on the frontend keeps one connection open, but per-chat listeners (`useChatStream` instances) come and go as React components mount/unmount.

### Current flow (broken)

```
ws/handler.ts (per WebSocket connection)
  let activeSession: Session | null
  on('prompt')  → startSession()
  onRawLine()   → ws.send(event)   // discarded if no frontend listener
  on('close')   → session.abort()  // kills Claude process!
  onExit()      → delete session
```

When `ChatPanel` unmounts, `useChatStream.close()` removes the listener from the shared WS. Events for that chat still arrive but no one processes them. On remount, the new hook starts with empty state.

Worse: if the user opens a second browser tab, it creates a **separate** WebSocket connection with its own `activeSession` variable — completely unaware of sessions on the first tab's connection.

## Design

### Architecture

Introduce a **global session registry** that decouples sessions from WebSocket connections:

```
session-registry.ts (global singleton)
  Map<chatId, SessionEntry>
    ├─ session: ActiveSession     // Claude child process
    ├─ eventBuffer: AppEvent[]    // ring buffer
    └─ listeners: Set<WebSocket>  // WS connections interested in this chat

ws/handler.ts (per connection, thin)
  on('prompt')  → registry.createOrResume(chatId, ...)
  on('catchup') → registry.replay(chatId, ws)
  on('close')   → registry.removeListener(ws)
  onRawLine()   → registry.bufferAndBroadcast(chatId, event)
  onExit()      → registry.markDone(chatId)
```

### New WebSocket protocol

| Direction | Message type | Payload | Purpose |
|---|---|---|---|
| Client → Server | `catchup` | `{ chatId }` | Request buffered events for a chat |
| Server → Client | `catchup_events` | `{ chatId, events: AppEvent[] }` | Batch of missed events |
| Server → Client | `catchup_done` | `{ chatId }` | Replay complete — you're now live |
| Server → Client | `session_status` | `{ chatId, active: boolean }` | Optional: explicit active status |

### Flow: tab/chat switch within same page

```
Chat A streaming, user switches to Chat B:

1. ChatPanel A unmounts → useChatStream.close()
   → WebSocket singleton stays open (Chat B needs it)
   → Events for Chat A still arrive at browser but are SKIPPED by Chat B's filter

2. Session Registry on backend:
   → broadcast(chatA, event) → Chat B's WS connection is NOT a listener for chatA
   → buffer(chatA, event)    → stored in ring buffer

3. User switches back to Chat A → ChatPanel A mounts
   → useChatStream starts, chatSessionId exists
   → Sends { type: 'catchup', chatId: 'chatA' }

4. Backend receives catchup:
   → Looks up chatA in registry → has buffered events
   → Sends { type: 'catchup_events', chatId: 'chatA', events: [...] }
   → Sends { type: 'catchup_done', chatId: 'chatA' }
   → Registers this WS as listener for chatA
   → From now on: live events flow directly

5. Frontend:
   → catchup_events received → each event fed through handleEvent()
   → State reconstructed: messages, thinkingBlocks, streamMsgIdRef, isStreaming
   → catchup_done received → nothing extra needed, already live
```

### Flow: page refresh or second browser tab

Same flow — the only difference is a new WebSocket connection is created. The session registry is connection-agnostic so it handles this transparently.

### Flow: session already completed when returning

```
1. User sends prompt, switches away
2. Stream completes while away
3. User returns → sends catchup
4. Backend: session is marked done, buffer exists
5. Backend: sends catchup_events + catchup_done
6. Frontend replays, sees session.completed → finalizeStream()
7. State: complete conversation visible, isStreaming = false
```

### Component changes

#### New file: `packages/backend/src/services/session-registry.ts`

```
SessionRegistry (global singleton)
  sessions: Map<chatId, SessionEntry>

  createOrResume(chatId, opts)  → starts or resumes Claude, creates buffer
  bufferAndBroadcast(chatId, event) → stores in ring buffer, sends to all listeners
  addListener(chatId, ws)       → registers WS as interested in this chat
  removeListener(chatId, ws)    → or removeListener(ws) — removes from all chats
  replay(chatId, ws)            → sends catchup_events + catchup_done
  markDone(chatId)              → session completed/errored, schedule cleanup
  abort(chatId)                 → kills Claude process
  get(chatId)                   → returns SessionEntry or undefined
```

Ring buffer: max 5000 events per chat, oldest evicted first. ~500KB max per active chat.

Cleanup: 60 seconds after `markDone`, the entry is removed (buffer + session). Canceled if a listener re-registers before the timer fires.

#### Modified: `packages/backend/src/ws/handler.ts`

- Remove per-connection `activeSession` and `sessions` Map
- `prompt` case: call `registry.createOrResume(chatId, ...)`, then `registry.addListener(chatId, ws)`
- `onRawLine` callback: `registry.bufferAndBroadcast(chatId, parsedEvent)`
- `onExit` callback: `registry.markDone(chatId)`, then `queryContext()` as before
- New `catchup` case: `registry.replay(chatId, ws)`
- `abort` case: `registry.abort(chatId)`
- `close` event: `registry.removeListener(ws)`
- `subagent:*` cases: unchanged (subagents stay per-connection)

#### Modified: `packages/frontend/src/hooks/useChatStream.ts`

- New `useEffect`: on mount, if `chatSessionId` exists, send `{ type: 'catchup', chatId }`. Always safe to call — if no session is active, the backend sends an empty `catchup_events` + `catchup_done` and registers the listener. Idempotent for fresh mounts.
- `onMessage` handler: add cases for `catchup_events` and `catchup_done`
  - `catchup_events`: iterate `msg.events`, pass each through `handleEvent`
  - `catchup_done`: set a flag — from this point, events are "live" (log for debugging)
- Module-level fallback buffer: if events arrive for this chatId BEFORE catchup completes, buffer them and replay after catchup_done. This handles a race where the backend sends live events between catchup_events and catchup_done being processed.

#### Modified: `packages/frontend/src/components/chat/TabView.tsx`

Render all chats but hide inactive ones via CSS (`display: none`). Given the typical number of chats per tab (< 10), the memory cost of hidden ChatPanel + Virtuoso instances is acceptable. This also gives instant tab-switch recovery without waiting for the catchup roundtrip.

```tsx
{tab.chats.map(chat => (
  <div
    key={chat.id}
    style={{ display: chat.id === tab.activeChatId ? 'flex' : 'none' }}
    className="flex-1 flex-col min-h-0"
  >
    <ChatPanel tabId={tabId} chatId={chat.id} workDir={workDir} />
  </div>
))}
```

The catchup protocol remains active as a safety net — if a hidden ChatPanel somehow misses events (e.g. browser tab was backgrounded and throttled), the on-mount catchup fills the gap.

#### Modified: `packages/shared/src/ws-messages.ts`

Add:
```typescript
// Client → Server
export interface CatchupMessage {
  type: 'catchup';
  chatId: string;
}

// Server → Client
export interface WsOutgoingCatchupEvents {
  type: 'catchup_events';
  chatId: string;
  events: AppEvent[];
}

export interface WsOutgoingCatchupDone {
  type: 'catchup_done';
  chatId: string;
}

export interface WsOutgoingSessionStatus {
  type: 'session_status';
  chatId: string;
  active: boolean;
}
```

### Non-goals

- **PTY mode**: PTY sessions are inherently non-reconnectable (terminal state is linear). Out of scope.
- **Subagent reconnection**: Subagents remain per-connection. They're short-lived helper processes.
- **Cross-device sync**: Same browser only. Different machines each run their own backend.

### Risks and mitigations

| Risk | Mitigation |
|---|---|
| Buffer memory grows unbounded | Ring buffer capped at 5000 events. Typical stream: 50-200 events |
| Two tabs send `catchup` simultaneously | Idempotent — both receive the same replay, both register as listeners |
| New event arrives between `catchup_events` and `catchup_done` | Frontend buffers these and replays after `catchup_done` |
| Session cleaned up while tab is loading | Grace period of 60s after `markDone` before cleanup |
| TabView renders 20 hidden ChatPanels | Acceptable trade-off. Typical usage is < 10 chats. Can add lazy mounting later if needed |
| `handleEvent` called twice for same event | AppEvent has `id` field — can de-duplicate if needed |

### Test strategy

1. **Unit**: `session-registry.ts` — buffer, replay, listener add/remove, cleanup
2. **Integration**: WS handler with catchup protocol — send prompt, disconnect, reconnect, verify replay
3. **Manual**: Real Claude Code session — start generation, switch tabs, return
4. **Manual**: Page refresh during generation
5. **Manual**: Two browser tabs, verify both see the same stream
