import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { createServer } from 'http';
import { startSession, ActiveSession } from '../services/session-manager.js';
import { parseClaudeEvent } from '../services/eventParser/index.js';
import { createLogger } from '../logger.js';
import type { SessionUsageEvent } from '@cc-gui/shared';
import type {
  WsClientMessage, PermissionMode, PromptMessage,
  WsOutgoingEvent, WsOutgoingSessionReady, WsOutgoingSessionExit,
  WsOutgoingAborted, WsOutgoingSubagentReady, WsOutgoingSubagentExit,
  WsOutgoingSubagentAborted, WsOutgoingError,
} from '@cc-gui/shared';

const log = createLogger('ws');

const sessions = new Map<string, ActiveSession>();
const subSessions = new Map<string, ActiveSession>();

// Per-connection heartbeat
const HEARTBEAT_INTERVAL = 30_000;

// ── Context query (runs after session exits to get usage stats) ──

function queryContext(workDir: string, sessionId: string, chatId: string, ws: WebSocket) {
  log.info('querying /context', { sessionId: sessionId.slice(0, 8) });
  const args = [
    '--resume', sessionId,
    '--print',
    '--output-format', 'stream-json',
    '--permission-mode', 'bypassPermissions',
    '--add-dir', workDir,
  ];
  const isWindows = process.platform === 'win32';
  const proc = spawn('claude', args, {
    cwd: workDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env,
    shell: isWindows,
  });

  let stdout = '';
  proc.stdout!.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });

  proc.on('error', (err) => {
    console.error(`[context] query error:`, err.message);
  });

  proc.stdin!.write(JSON.stringify({
    type: 'user',
    message: { role: 'user', content: '/context' },
  }) + '\n');
  proc.stdin!.end();

  proc.on('close', () => {
    try {
      const lines = stdout.split('\n').filter(l => l.trim());
      for (const line of lines) {
        let evt: unknown;
        try { evt = JSON.parse(line); } catch { continue; }

        if (typeof evt !== 'object' || !evt) continue;
        const e = evt as Record<string, unknown>;

        if (e.type === 'user' || e.type === 'assistant') {
          const msg = e.message as Record<string, unknown> | undefined;
          const content = Array.isArray(msg?.content)
            ? (msg.content as { text?: string }[]).map(b => b.text || '').join('')
            : String(msg?.content || '');

          const usage = extractUsageFromContext(content, sessionId);
          if (usage && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'event', chatId, event: usage }));
            console.log(`[context] usage extracted: ${usage.inputTokens} in / ${usage.outputTokens} out`);
          }
        }
      }
    } catch (err) {
      console.error(`[context] parse error:`, err instanceof Error ? err.message : err);
    }
  });
}

function extractUsageFromContext(content: string, sessionId: string): SessionUsageEvent | null {
  const totalMatch = content.match(/[Tt]otal\s*tokens?:?\s*([\d,]+)\s*\/\s*([\d,]+)/);
  const inputMatch = content.match(/[Ii]nput\s*tokens?:?\s*([\d,]+)/);
  const outputMatch = content.match(/[Oo]utput\s*tokens?:?\s*([\d,]+)/);
  const cacheMatch = content.match(/[Cc]ache\s*(?:read)?:?\s*([\d,]+)/);

  if (totalMatch || inputMatch || outputMatch) {
    const parse = (s: string) => parseInt(s.replace(/,/g, ''), 10) || 0;
    const inputTokens = inputMatch ? parse(inputMatch[1]) : (totalMatch ? parse(totalMatch[1]) : 0);
    const contextLimit = totalMatch ? parse(totalMatch[2]) : 200_000;
    const outputTokens = outputMatch ? parse(outputMatch[1]) : 0;
    const cacheRead = cacheMatch ? parse(cacheMatch[1]) : 0;

    return {
      type: 'session.usage',
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      sessionId,
      inputTokens,
      outputTokens,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: cacheRead,
      models: [{
        modelName: 'unknown',
        inputTokens,
        outputTokens,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: cacheRead,
        isSubagent: false,
        costUSD: 0,
      }],
      requestCount: 1,
      totalDurationMs: 0,
      turn: {
        inputTokens,
        outputTokens,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: cacheRead,
        durationMs: 0,
        modelUsage: [{
          modelName: 'unknown',
          inputTokens,
          outputTokens,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: cacheRead,
          isSubagent: false,
          costUSD: 0,
        }],
      },
      contextWindow: {
        used: inputTokens,
        limit: contextLimit,
        percentUsed: Math.round((inputTokens / contextLimit) * 1000) / 10,
      },
    } satisfies SessionUsageEvent;
  }

  return null;
}

// ── WebSocket setup ──

export function setupWebSocket(server: ReturnType<typeof createServer>): { sessions: Map<string, ActiveSession>; subSessions: Map<string, ActiveSession> } {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: WebSocket) => {
    let activeSession: ActiveSession | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let isAlive = true;

    heartbeatTimer = setInterval(() => {
      if (!isAlive) {
        log.warn('heartbeat lost — terminating socket');
        heartbeatTimer && clearInterval(heartbeatTimer);
        return ws.terminate();
      }
      isAlive = false;
      ws.ping();
    }, HEARTBEAT_INTERVAL);

    ws.on('pong', () => {
      isAlive = true;
    });

    ws.on('message', (data) => {
      const raw = data.toString();

      let msg: WsClientMessage;
      try {
        msg = JSON.parse(raw) as WsClientMessage;
      } catch {
        log.error('invalid JSON received', undefined, { length: raw.length });
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' } satisfies WsOutgoingError));
        return;
      }

      log.debug('ws message', { type: msg.type, promptPreview: (msg as PromptMessage).prompt?.slice(0, 80) });

      try {
        switch (msg.type) {
          // ── Start Claude session ──
          case 'prompt': {
            if (activeSession) {
              activeSession.abort();
              sessions.delete(activeSession.sessionId);
            }

            const workDir = msg.workDir || process.cwd();
            const permissionMode: PermissionMode = msg.permissionMode || 'bypassPermissions';
            const chatId = msg._chatId || 'default';
            let realSessionId: string | null = null;

            const session = startSession({
              resumeSessionId: msg.resumeSessionId,
              workDir,
              permissionMode,
              env: msg.env,
              onRawLine: (rawLine, sid) => {
                if (ws.readyState !== WebSocket.OPEN) return;
                for (const event of parseClaudeEvent(rawLine, sid)) {
                  ws.send(JSON.stringify({ type: 'event', chatId, event } satisfies WsOutgoingEvent));
                }
              },
              onSessionReady: (realId) => {
                realSessionId = realId;
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: 'session_ready', sessionId: realId } satisfies WsOutgoingSessionReady));
                }
              },
              onExit: (code) => {
                const sid = realSessionId || session.sessionId;
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({
                    type: 'session_exit', sessionId: sid, exitCode: code,
                  } satisfies WsOutgoingSessionExit));
                }
                sessions.delete(session.sessionId);
                if (activeSession?.sessionId === session.sessionId) activeSession = null;
              },
            });

            sessions.set(session.sessionId, session);
            activeSession = session;
            if (msg.prompt) session.sendPrompt(msg.prompt);
            break;
          }

          // ── Abort active session ──
          case 'abort': {
            if (activeSession) {
              activeSession.abort();
              sessions.delete(activeSession.sessionId);
              activeSession = null;
              ws.send(JSON.stringify({ type: 'aborted' } satisfies WsOutgoingAborted));
            }
            break;
          }

          // ── Start subagent ──
          case 'subagent:start': {
            const chatId = msg.chatId || 'default';
            const subagentId = msg.subagentId || randomUUID();
            const task = msg.task || '';
            const workDir = msg.workDir || process.cwd();
            const env = msg.env || {};

            log.info('subagent:start', { subagentId: subagentId.slice(0, 8), taskPreview: task.slice(0, 100), chatId });

            const subSession = startSession({
              workDir,
              permissionMode: 'bypassPermissions',
              env,
              onRawLine: (rawLine, sid) => {
                if (ws.readyState !== WebSocket.OPEN) return;
                for (const event of parseClaudeEvent(rawLine, sid)) {
                  ws.send(JSON.stringify({ type: 'event', chatId, subagentId, event } satisfies WsOutgoingEvent));
                }
              },
              onSessionReady: (realId) => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: 'subagent_ready', chatId, subagentId, sessionId: realId } satisfies WsOutgoingSubagentReady));
                }
              },
              onExit: (code) => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: 'subagent_exit', chatId, subagentId, exitCode: code } satisfies WsOutgoingSubagentExit));
                }
                subSessions.delete(subagentId);
              },
            });

            subSessions.set(subagentId, subSession);
            subSession.sendPrompt(task);
            break;
          }

          // ── Abort subagent ──
          case 'subagent:abort': {
            const subagentId = msg.subagentId;
            if (subagentId) {
              const sub = subSessions.get(subagentId);
              if (sub) {
                sub.abort();
                subSessions.delete(subagentId);
                ws.send(JSON.stringify({ type: 'subagent_aborted', subagentId } satisfies WsOutgoingSubagentAborted));
              }
            }
            break;
          }
        }
      } catch (err) {
        log.error('ws handler error', err instanceof Error ? err : undefined);
        ws.send(JSON.stringify({ type: 'error', message: 'Server error: ' + (err instanceof Error ? err.message : String(err)) } satisfies WsOutgoingError));
      }
    });

    ws.on('error', (err) => {
      log.error('ws socket error', err instanceof Error ? err : undefined);
    });

    ws.on('close', () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      const hadSession = !!activeSession;
      const subCount = subSessions.size;
      if (activeSession) {
        activeSession.abort();
        sessions.delete(activeSession.sessionId);
      }
      for (const [id, sub] of subSessions) {
        sub.abort();
      }
      subSessions.clear();
      if (hadSession || subCount > 0) {
        log.info(`client disconnected`, { hadSession, subCount });
      }
    });
  });

  wss.on('error', (err) => {
    log.error('server-level WebSocket error', err instanceof Error ? err : undefined);
  });

  return { sessions, subSessions };
}
