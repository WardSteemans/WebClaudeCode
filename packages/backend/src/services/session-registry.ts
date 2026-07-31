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
  permissionMode: string;
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

export class SessionRegistry {
  private sessions = new Map<string, SessionEntry>();

  /** Test helper: inject a pre-built session entry */
  createEntry(chatId: string, session: ActiveSession, cliArgs: string[]): SessionEntry {
    const entry: SessionEntry = {
      chatId, session, permissionMode: 'bypassPermissions', eventBuffer: [], maxEvents: DEFAULT_MAX_EVENTS,
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
      if (existing.permissionMode === opts.permissionMode) {
        log.info('session already active — reusing', { chatId: chatId.slice(0, 8) });
        return existing;
      }
      // Permission mode changed — abort old session and start a new one
      log.info('permission mode changed — restarting session', {
        chatId: chatId.slice(0, 8),
        oldMode: existing.permissionMode,
        newMode: opts.permissionMode,
      });
      try { existing.session.abort(); } catch {}
      this.sessions.delete(chatId);
    }
    if (existing?.cleanupTimer) { clearTimeout(existing.cleanupTimer); }

    const session = startSession({
      resumeSessionId: opts.resumeSessionId,
      workDir: opts.workDir,
      permissionMode: opts.permissionMode as any,
      env: opts.env,
      onRawLine: opts.onRawLine,
      onSessionReady: opts.onSessionReady,
      onExit: (code) => {
        // Only mark done if this session hasn't been replaced (e.g. by a permission mode change)
        const current = this.sessions.get(chatId);
        if (current && current.session === session) {
          this.markDone(chatId);
        }
        opts.onExit(code);
      },
    });

    const entry: SessionEntry = {
      chatId, session, permissionMode: opts.permissionMode, eventBuffer: [], maxEvents: DEFAULT_MAX_EVENTS,
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
