// @ts-nocheck — manual test run with tsx, not compiled
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
