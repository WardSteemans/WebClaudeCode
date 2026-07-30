# Stream Reconnect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a global session registry + event buffering + catchup protocol so users can switch chats/tabs, refresh the page, or open a second browser tab and reconnect to an in-progress Claude stream without losing any events.

**Architecture:** Backend gets a global `SessionRegistry` singleton decoupling sessions from WebSocket connections. Frontend sends a `catchup` message on ChatPanel mount; backend replays buffered events then puts the new connection live. `TabView` renders all chats (hidden via CSS) so tab switches are instant.

**Tech Stack:** TypeScript, Express, ws, React 18, Zustand 5

## Global Constraints

- Stream-json mode only (PTY sessions are out of scope)
- Subagent sessions stay per-connection (unchanged)
- Ring buffer capped at 5000 events per chat
- Session cleanup: 60s grace period after `markDone`
- No new dependencies
- `permission:approve`/`permission:deny` for PTY mode become no-ops (they were per-connection; PTY reconnection is out of scope)

---

### Task 1: Add catchup protocol types to shared ws-messages

**Files:**
- Modify: `packages/shared/src/ws-messages.ts`

**Interfaces:**
- Produces: `CatchupMessage`, `WsOutgoingCatchupEvents`, `WsOutgoingCatchupDone` — added to `WsClientMessage` and `WsOutgoingMessage` unions

- [ ] **Step 1: Add CatchupMessage interface**

After `ToolResultMessage` (line 60), insert:

```typescript
/** Request buffered events for a chat — sent by frontend on ChatPanel mount */
export interface CatchupMessage {
  type: 'catchup';
  chatId: string;
}
```

- [ ] **Step 2: Add to WsClientMessage union**

Add `| CatchupMessage` to the union (line 63-69).

- [ ] **Step 3: Add WsOutgoingCatchupEvents and WsOutgoingCatchupDone**

After `WsOutgoingError` (line 133), insert:

```typescript
/** Batch of buffered events sent in response to a catchup request */
export interface WsOutgoingCatchupEvents {
  type: 'catchup_events';
  chatId: string;
  events: unknown[];
}

/** Sent after catchup_events — the client is now receiving live events */
export interface WsOutgoingCatchupDone {
  type: 'catchup_done';
  chatId: string;
}
```

- [ ] **Step 4: Add to WsOutgoingMessage union**

Add `| WsOutgoingCatchupEvents | WsOutgoingCatchupDone` to the union (line 136-144).

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` in `packages/shared`

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/ws-messages.ts
git commit -m "add catchup protocol message types to shared ws-messages"
```

---

### Task 2: Create SessionRegistry with tests

**Files:**
- Create: `packages/backend/src/services/session-registry.ts`
- Create: `packages/backend/src/services/session-registry.test.ts`

**Interfaces:**
- Consumes: `ActiveSession` from `session-manager.js`, `AppEvent` from `@cc-gui/shared`
- Produces: `getRegistry()` returning `SessionRegistry` with: `createOrResume`, `bufferAndBroadcast`, `addListener`, `removeListener`, `removeListenerWs`, `replay`, `markDone`, `abort`, `get`, `has`, `size`, `delete`, `entries`, `values`, `cleanupNow`

- [ ] **Step 1: Write the failing test**

Create `packages/backend/src/services/session-registry.test.ts`:

```typescript
import { getRegistry } from './session-registry.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label} — FAIL`); }
}

const registry = getRegistry();

function fakeSession() {
  return {
    sessionId: 'sess-001',
    workDir: '/test',
    process: {} as any,
    sendPrompt: (_p: unknown) => {},
    sendStdin: (_m: unknown) => {},
    closeStdin: () => {},
    abort: () => {},
  };
}

// createEntry & get
const entry = registry.createEntry('chat-1', fakeSession(), ['claude']);
assert(entry !== undefined, 'createEntry returns entry');
assert(registry.get('chat-1') !== undefined, 'get returns entry');
assert(registry.get('xyz') === undefined, 'get returns undefined for unknown');
assert(registry.has('chat-1'), 'has returns true');
assert(!registry.has('xyz'), 'has returns false');
assert(registry.size === 1, 'size is 1');

// bufferAndBroadcast
const e1: any = { id: 'e1', timestamp: '2026-01-01', sessionId: 's1', type: 'chat.assistant', content: 'Hello', partial: true };
const e2: any = { id: 'e2', timestamp: '2026-01-01', sessionId: 's1', type: 'chat.assistant', content: ' world', partial: true };
registry.bufferAndBroadcast('chat-1', e1);
registry.bufferAndBroadcast('chat-1', e2);
assert(entry.eventBuffer.length === 2, 'buffer has 2 events');
assert(entry.eventBuffer[0].content === 'Hello', 'first event preserved');

// broadcast to listener
const received: any[] = [];
const fakeWs: any = { readyState: 1, send: (d: string) => received.push(JSON.parse(d)) };
entry.listeners.add(fakeWs);
registry.bufferAndBroadcast('chat-1', { id: 'e3', timestamp: 't', sessionId: 's1', type: 'chat.thinking', content: 'hmm', partial: true });
assert(received.length === 1, 'event broadcast to listener');
assert(received[0].event.content === 'hmm', 'content matches');

// ring buffer eviction
(entry as any).maxEvents = 3;
for (let i = 0; i < 5; i++) {
  registry.bufferAndBroadcast('chat-1', { id: `f-${i}`, timestamp: 't', sessionId: 's1', type: 'chat.assistant' as const, content: `msg-${i}`, partial: true });
}
assert(entry.eventBuffer.length === 3, 'buffer capped at 3');
assert(entry.eventBuffer[0].content === 'msg-2', 'oldest evicted');

// replay
const r2: any[] = [];
const fw2: any = { readyState: 1, send: (d: string) => r2.push(JSON.parse(d)) };
registry.replay('chat-1', fw2);
assert(r2.length === 2, 'replay sends 2 msgs');
assert(r2[0].type === 'catchup_events', 'first is catchup_events');
assert(r2[0].events.length === 3, 'has 3 events');
assert(r2[1].type === 'catchup_done', 'second is catchup_done');

// replay for unknown
const r3: any[] = [];
const fw3: any = { readyState: 1, send: (d: string) => r3.push(JSON.parse(d)) };
registry.replay('bogus', fw3);
assert(r3[0].events.length === 0, 'unknown chat gets empty events');

// listeners
const fw4: any = { readyState: 1, send: () => {} };
registry.addListener('chat-1', fw4);
assert(entry.listeners.has(fw4), 'addListener works');
registry.removeListenerWs(fw4);
assert(!entry.listeners.has(fw4), 'removeListenerWs works');

// markDone + cleanup
registry.markDone('chat-1');
assert(registry.get('chat-1')!.done, 'done flag set');
registry.cleanupNow('chat-1');
assert(!registry.get('chat-1'), 'entry removed after cleanup');
assert(registry.size === 0, 'size is 0 after cleanup');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run test — expect failure**

Run: `npx tsx packages/backend/src/services/session-registry.test.ts`

- [ ] **Step 3: Implement session-registry.ts**

```typescript
import type { WebSocket } from 'ws';
import type { AppEvent, WsOutgoingCatchupEvents, WsOutgoingCatchupDone } from '@cc-gui/shared';
import type { ActiveSession } from './session-manager.js';
import { startSession } from './session-manager.js';
import { createLogger } from '../logger.js';

const log = createLogger('session-registry');

// ── Types ──

export interface SessionEntry {
  chatId: string;
  session: ActiveSession;
  eventBuffer: AppEvent[];
  maxEvents: number;
  listeners: Set<WebSocket>;
  done: boolean;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
  cliArgs: string[];
}

export interface CreateOptions {
  resumeSessionId?: string;
  workDir: string;
  permissionMode: string;
  env?: Record<string, string>;
  cliArgs: string[];
  onRawLine: (rawLine: string, sessionId: string) => void;
  onExit: (code: number | null) => void;
  onSessionReady?: (sessionId: string) => void;
}

const CLEANUP_DELAY_MS = 60_000;
const DEFAULT_MAX_EVENTS = 5000;

// ── Global singleton ──

let _registry: SessionRegistry | null = null;

export function getRegistry(): SessionRegistry {
  if (!_registry) _registry = new SessionRegistry();
  return _registry;
}

// ── Registry class ──

class SessionRegistry {
  private sessions = new Map<string, SessionEntry>();

  /** Test helper: inject a pre-built session entry */
  createEntry(chatId: string, session: ActiveSession, cliArgs: string[]): SessionEntry {
    const entry: SessionEntry = {
      chatId, session, eventBuffer: [], maxEvents: DEFAULT_MAX_EVENTS,
      listeners: new Set(), done: false, cleanupTimer: null, cliArgs,
    };
    this.sessions.set(chatId, entry);
    log.info('entry created', { chatId: chatId.slice(0, 8), sessionId: session.sessionId.slice(0, 8) });
    return entry;
  }

  /** Start (or resume) a Claude Code session for a chat */
  createOrResume(chatId: string, opts: CreateOptions): SessionEntry {
    const existing = this.sessions.get(chatId);
    if (existing && !existing.done) {
      log.info('session already active — reusing', { chatId: chatId.slice(0, 8) });
      return existing;
    }
    if (existing?.cleanupTimer) { clearTimeout(existing.cleanupTimer); }

    const session = startSession({
      resumeSessionId: opts.resumeSessionId,
      workDir: opts.workDir,
      permissionMode: opts.permissionMode as any,
      env: opts.env,
      onRawLine: opts.onRawLine,
      onSessionReady: opts.onSessionReady,
      onExit: (code) => { this.markDone(chatId); opts.onExit(code); },
    });

    const entry: SessionEntry = {
      chatId, session, eventBuffer: [], maxEvents: DEFAULT_MAX_EVENTS,
      listeners: new Set(), done: false, cleanupTimer: null, cliArgs: opts.cliArgs,
    };
    this.sessions.set(chatId, entry);
    log.info('session created', { chatId: chatId.slice(0, 8), sessionId: session.sessionId.slice(0, 8) });
    return entry;
  }

  /** Buffer event and broadcast to all registered WebSocket listeners */
  bufferAndBroadcast(chatId: string, event: AppEvent): void {
    const entry = this.sessions.get(chatId);
    if (!entry) return;
    entry.eventBuffer.push(event);
    while (entry.eventBuffer.length > entry.maxEvents) { entry.eventBuffer.shift(); }
    for (const ws of entry.listeners) {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'event', chatId, event, _sentAt: Date.now() }));
      }
    }
  }

  addListener(chatId: string, ws: WebSocket): void {
    const entry = this.sessions.get(chatId);
    if (!entry) return;
    if (entry.done && entry.cleanupTimer) { clearTimeout(entry.cleanupTimer); entry.cleanupTimer = null; }
    entry.listeners.add(ws);
  }

  removeListener(chatId: string, ws: WebSocket): void {
    this.sessions.get(chatId)?.listeners.delete(ws);
  }

  removeListenerWs(ws: WebSocket): void {
    for (const [, entry] of this.sessions) { entry.listeners.delete(ws); }
  }

  /** Replay buffered events to a WebSocket, then send catchup_done and register listener */
  replay(chatId: string, ws: WebSocket): void {
    const entry = this.sessions.get(chatId);
    const events = entry ? [...entry.eventBuffer] : [];
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'catchup_events', chatId, events } satisfies WsOutgoingCatchupEvents));
      ws.send(JSON.stringify({ type: 'catchup_done', chatId } satisfies WsOutgoingCatchupDone));
    }
    log.info('replay sent', { chatId: chatId.slice(0, 8), eventCount: events.length });
    if (entry) this.addListener(chatId, ws);
  }

  markDone(chatId: string): void {
    const entry = this.sessions.get(chatId);
    if (!entry) return;
    entry.done = true;
    entry.cleanupTimer = setTimeout(() => this.cleanup(chatId), CLEANUP_DELAY_MS);
  }

  abort(chatId: string): void {
    const entry = this.sessions.get(chatId);
    if (!entry) return;
    try { entry.session.abort(); } catch { /* ignore */ }
    this.cleanup(chatId);
  }

  get(chatId: string): SessionEntry | undefined { return this.sessions.get(chatId); }
  has(chatId: string): boolean { return this.sessions.has(chatId); }
  get size(): number { return this.sessions.size; }
  delete(chatId: string): boolean { return this.sessions.delete(chatId); }
  entries(): IterableIterator<[string, SessionEntry]> { return this.sessions.entries(); }
  values(): IterableIterator<SessionEntry> { return this.sessions.values(); }

  private cleanup(chatId: string): void {
    const entry = this.sessions.get(chatId);
    if (!entry) return;
    if (entry.cleanupTimer) { clearTimeout(entry.cleanupTimer); }
    this.sessions.delete(chatId);
  }

  /** Test helper: immediate cleanup without grace period */
  cleanupNow(chatId: string): void { this.cleanup(chatId); }
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `npx tsx packages/backend/src/services/session-registry.test.ts`

- [ ] **Step 5: Verify backend compiles**

Run: `npx tsc --noEmit` in `packages/backend`

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/services/session-registry.ts packages/backend/src/services/session-registry.test.ts
git commit -m "add SessionRegistry with event buffering, listener management, and catchup replay"
```

---

### Task 3: Rewire ws/handler.ts through SessionRegistry

**Files:**
- Modify: `packages/backend/src/ws/handler.ts`

**Interfaces:**
- Consumes: `getRegistry`, `SessionRegistry` from `session-registry.js`
- Produces: `setupWebSocket(server)` — sessions now routed through the global registry; subagents remain per-connection

- [ ] **Step 1: Read current file**

Read `packages/backend/src/ws/handler.ts` to establish the exact line numbers for the edits below.

- [ ] **Step 2: Add import and update types**

At the top of the file, after line 5 (`import { createServer } from 'http';`):

```typescript
import { getRegistry, type SessionRegistry } from '../services/session-registry.js';
```

Remove line 19: `type AnyActiveSession = ...` (replace with the same line plus the export type):

```typescript
type AnyActiveSession = ActiveSession | PtyActiveSession;

export interface WsServerState {
  sessions: SessionRegistry;
  subSessions: Map<string, ActiveSession>;
}
```

Remove line 21: `const sessions = new Map<string, AnyActiveSession>();`

- [ ] **Step 3: Add registry init and connection tracking**

After `const wss = new WebSocketServer(...)` (line 152), add:

```typescript
const registry = getRegistry();
```

Inside the connection callback, after `let isAlive = true;` (~line 158):

```typescript
const connectionChatIds = new Set<string>();
```

- [ ] **Step 4: Rewrite stream-json prompt case**

Replace lines ~243-275 (the `} else {` block for stream-json mode inside the `prompt` case) with:

```typescript
            } else {
              const entry = registry.createOrResume(chatId, {
                resumeSessionId: msg.resumeSessionId,
                workDir,
                permissionMode,
                env: msg.env,
                cliArgs: [],
                onRawLine: (rawLine, sid) => {
                  for (const event of parseClaudeEvent(rawLine, sid)) {
                    registry.bufferAndBroadcast(chatId, event);
                  }
                },
                onSessionReady: (realId) => {
                  realSessionId = realId;
                  if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'session_ready', sessionId: realId }));
                  }
                },
                onExit: (code) => {
                  const sid = realSessionId || entry.session.sessionId;
                  const exitMsg = { type: 'session_exit', sessionId: sid, exitCode: code };
                  const sessionEntry = registry.get(chatId);
                  if (sessionEntry) {
                    for (const l of sessionEntry.listeners) {
                      if (l.readyState === WebSocket.OPEN) l.send(JSON.stringify(exitMsg));
                    }
                  }
                  if (ws.readyState === WebSocket.OPEN) queryContext(workDir, sid, chatId, ws);
                },
              });
              registry.addListener(chatId, ws);
              connectionChatIds.add(chatId);
              if (msg.prompt) entry.session.sendPrompt(msg.prompt as string | unknown[]);
            }
```

- [ ] **Step 5: Add catchup case**

After the `prompt` case block (after the closing `break;` of the prompt case, before `permission:approve`):

```typescript
          case 'catchup': {
            const chatId = (msg as CatchupMessage).chatId;
            registry.replay(chatId, ws);
            connectionChatIds.add(chatId);
            break;
          }
```

- [ ] **Step 6: Rewrite abort case**

Replace the existing `abort` case with:

```typescript
          case 'abort': {
            for (const chatId of connectionChatIds) { registry.abort(chatId); }
            connectionChatIds.clear();
            ws.send(JSON.stringify({ type: 'aborted' }));
            break;
          }
```

- [ ] **Step 7: Rewrite onClose to not abort sessions**

Replace the `ws.on('close', ...)` handler body with:

```typescript
    ws.on('close', () => {
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
      registry.removeListenerWs(ws);
      for (const [id, sub] of subSessions) { sub.abort(); }
      subSessions.clear();
    });
```

- [ ] **Step 8: Update return value**

```typescript
  return { sessions: registry, subSessions };
```

- [ ] **Step 9: Update index.ts to match new return type**

Read `packages/backend/src/index.ts` around line 69. The destructured `{ sessions }` needs the type updated. Change the destructured line to use the new type:

```typescript
import type { WsServerState } from './ws/handler.js';
// ...
const ws: WsServerState = setupWebSocket(server);
// Update usage: sessions.size still works (we added the getter)
```

Actually, since we have `.size` as a getter on SessionRegistry, and that's the only usage in index.ts (`sessions.size`), minimal changes are needed. Just ensure the type assignment works.

- [ ] **Step 10: Verify backend compiles**

Run: `npx tsc --noEmit` in `packages/backend`

- [ ] **Step 11: Run registry tests again**

Run: `npx tsx packages/backend/src/services/session-registry.test.ts`

- [ ] **Step 12: Commit**

```bash
git add packages/backend/src/ws/handler.ts packages/backend/src/index.ts
git commit -m "rewire ws handler through SessionRegistry — global session tracking, catchup support"
```

---

### Task 4: TabView — render all chats, hide inactive

**Files:**
- Modify: `packages/frontend/src/components/chat/TabView.tsx`

- [ ] **Step 1: Replace conditional rendering with display toggle**

Current code (lines 18-26):

```tsx
{tab.chats.filter(c => c.id === tab.activeChatId).map((chat) => (
  <div key={chat.id} className="flex-1 flex-col min-h-0 flex">
    <ErrorBoundary name="Chat panel">
      <ChatPanel tabId={tabId} chatId={chat.id} workDir={workDir} />
    </ErrorBoundary>
  </div>
))}
```

Replace with:

```tsx
{tab.chats.map((chat) => (
  <div
    key={chat.id}
    style={{ display: chat.id === tab.activeChatId ? 'flex' : 'none' }}
    className="flex-1 flex-col min-h-0"
  >
    <ErrorBoundary name="Chat panel">
      <ChatPanel tabId={tabId} chatId={chat.id} workDir={workDir} />
    </ErrorBoundary>
  </div>
))}
```

- [ ] **Step 2: Verify frontend compiles**

Run: `npx tsc --noEmit` in `packages/frontend`

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/chat/TabView.tsx
git commit -m "keep all chats mounted in TabView — hide inactive via CSS for stream continuity"
```

---

### Task 5: useChatStream catchup integration

**Files:**
- Modify: `packages/frontend/src/hooks/useChatStream.ts`

**Interfaces:**
- Consumes: `useWebSocket.send`, `chatId`, `chatSessionId`
- Produces: same return shape; sends `catchup` on mount, handles `catchup_events`/`catchup_done`

- [ ] **Step 1: Read current file**

Read `packages/frontend/src/hooks/useChatStream.ts` — focus on the `onMessage` handler (lines 528-615) and the `useEffect` that calls `connect()` (line 627).

- [ ] **Step 2: Add catchup-send useEffect**

After the existing `useEffect(() => { connect(); return () => close(); }, [connect])` (line 627), add:

```typescript
  // ── Catchup: request buffered events on mount ──
  useEffect(() => {
    if (!chatId) return;
    console.log(`[useChatStream] catchup request: chat=[${chatId.slice(0, 8)}]`);
    send({ type: 'catchup', chatId });
  }, [chatId, send]);
```

- [ ] **Step 3: Add catchup message handlers in onMessage callback**

In the `onMessage` callback of `useWebSocket` (around line 528), BEFORE the `if ('chatId' in msg ...)` line, add:

```typescript
      // ── Catchup: replay buffered events ──
      if (msg.type === 'catchup_events') {
        const m = msg as { type: 'catchup_events'; chatId: string; events: AppEvent[] };
        console.log(`[useChatStream] catchup events: chat=[${m.chatId.slice(0, 8)}] count=${m.events.length}`);
        if (m.events.length > 0) {
          for (const event of m.events) { handleEvent(event); }
        }
        return;
      }

      if (msg.type === 'catchup_done') {
        const m = msg as { type: 'catchup_done'; chatId: string };
        console.log(`[useChatStream] catchup done: chat=[${m.chatId.slice(0, 8)}]`);
        return;
      }
```

- [ ] **Step 4: Update WsMessage type to include catchup messages**

In `useChatStream.ts`, the `WsMessage` type is `WfOutgoingMessage` (shared type). Since we added the new types to the union in Task 1, this should already work. Verify: `useWebSocket.ts` line 8 re-exports `WsOutgoingMessage` which now includes catchup types.

- [ ] **Step 5: Verify frontend compiles**

Run: `npx tsc --noEmit` in `packages/frontend`

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/hooks/useChatStream.ts
git commit -m "add catchup integration to useChatStream — replay buffered events on mount"
```

---

### Task 6: Manual smoke test & verify

No code changes — confirm the feature works end-to-end.

- [ ] **Step 1: Start the dev server**

Run backend: `npx tsx packages/backend/src/index.ts`
Run frontend dev server (check `packages/frontend/package.json` for the dev command)

- [ ] **Step 2: Test scenario A — chat switch**

1. Send a prompt in chat A
2. While Claude is generating, click on chat B
3. Wait a few seconds
4. Click back on chat A
5. Verify: the stream continues where it left off, no events missing

- [ ] **Step 3: Test scenario B — page refresh**

1. Send a prompt in chat A
2. While Claude is generating, refresh the browser
3. Navigate back to chat A
4. Verify: the stream reconnects and replays missed events

- [ ] **Step 4: Test scenario C — two browser tabs**

1. Open the app in tab 1, send a prompt
2. While generating, open tab 2, navigate to the same chat
3. Verify: tab 2 shows the stream in progress (replayed events)

- [ ] **Step 5: Run registry unit tests**

```bash
npx tsx packages/backend/src/services/session-registry.test.ts
```
