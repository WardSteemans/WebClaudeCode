import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { createServer } from 'http';
import { startSession, ActiveSession } from '../services/session-manager.js';
import { startPtySession, PtyActiveSession, detectPromptType } from '../services/ptty-session-manager.js';
import { parseClaudeEvent } from '../services/eventParser/index.js';
import { getRegistry, type SessionRegistry } from '../services/session-registry.js';
import { createLogger } from '../logger.js';
import type { SessionUsageEvent, CatchupMessage } from '@cc-gui/shared';
import type {
  WsClientMessage, PermissionMode, PromptMessage,
  WsOutgoingEvent, WsOutgoingSessionReady, WsOutgoingSessionExit,
  WsOutgoingAborted, WsOutgoingSubagentReady, WsOutgoingSubagentExit,
  WsOutgoingSubagentAborted, WsOutgoingError, WsOutgoingPtyData,
} from '@cc-gui/shared';

const log = createLogger('ws');

type AnyActiveSession = ActiveSession | PtyActiveSession;

export interface WsServerState {
  sessions: SessionRegistry;
  subSessions: Map<string, ActiveSession>;
}

const ptySessions = new Map<string, AnyActiveSession>();
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

export function setupWebSocket(server: ReturnType<typeof createServer>): WsServerState {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const registry = getRegistry();

  wss.on('connection', (ws: WebSocket) => {
    let activeSession: AnyActiveSession | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let isAlive = true;
    const connectionChatIds = new Set<string>();

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
              ptySessions.delete(activeSession.sessionId);
            }

            const workDir = msg.workDir || process.cwd();
            const permissionMode: PermissionMode = msg.permissionMode || 'bypassPermissions';
            const chatId = msg._chatId || 'default';
            const usePty = msg.usePty ?? false;
            let realSessionId: string | null = null;

            if (usePty) {
              // ── PTY (interactive TUI) mode ──
              const ptySession = startPtySession({
                resumeSessionId: msg.resumeSessionId,
                workDir,
                permissionMode,
                env: msg.env,
                onData: (rawData, sid) => {
                  if (ws.readyState !== WebSocket.OPEN) return;
                  const { isApproval, isQuestion } = detectPromptType(rawData);
                  const ptyMsg: WsOutgoingPtyData = {
                    type: 'pty_data', chatId, sessionId: sid,
                    data: rawData,
                    approvalDetected: isApproval || undefined,
                    questionDetected: isQuestion || undefined,
                  };
                  log.debug('pty_data → frontend', { sid: sid.slice(0,8), len: rawData.length, isApproval, isQuestion });
                  ws.send(JSON.stringify(ptyMsg));
                },
                onSessionReady: (realId) => {
                  realSessionId = realId;
                  if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'session_ready', sessionId: realId } satisfies WsOutgoingSessionReady));
                  }
                },
                onExit: (code) => {
                  const sid = realSessionId || ptySession.sessionId;
                  if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                      type: 'session_exit', sessionId: sid, exitCode: code,
                    } satisfies WsOutgoingSessionExit));
                  }
                  ptySessions.delete(ptySession.sessionId);
                  if (activeSession?.sessionId === ptySession.sessionId) activeSession = null;
                },
              });

              ptySessions.set(ptySession.sessionId, ptySession);
              activeSession = ptySession;
              if (msg.prompt) ptySession.sendPrompt(msg.prompt as string);
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
                    ws.send(JSON.stringify({ type: 'session_ready', sessionId: realId } satisfies WsOutgoingSessionReady));
                  }
                },
                onExit: (code) => {
                  const sid = realSessionId || entry.session.sessionId;
                  const exitMsg = { type: 'session_exit', sessionId: sid, exitCode: code } satisfies WsOutgoingSessionExit;
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
            break;
          }

          // ── Catchup: replay buffered events ──
          case 'catchup': {
            const chatId = (msg as CatchupMessage).chatId;
            registry.replay(chatId, ws);
            connectionChatIds.add(chatId);
            break;
          }

          // ── Permission: approve (PTY mode) ──
          case 'permission:approve': {
            const pty = activeSession as PtyActiveSession | null;
            if (pty && 'sendKeystroke' in pty) {
              pty.sendKeystroke('y');
              log.info('permission:approve → sent "y"', { sessionId: pty.sessionId.slice(0, 8) });
            }
            break;
          }

          // ── Permission: deny (PTY mode) ──
          case 'permission:deny': {
            const pty = activeSession as PtyActiveSession | null;
            if (pty && 'sendKeystroke' in pty) {
              pty.sendKeystroke('n');
              log.info('permission:deny → sent "n"', { sessionId: pty.sessionId.slice(0, 8) });
            }
            break;
          }

          // ── Tool result: send answer to stream-json session's stdin ──
          case 'tool:result': {
            const session = activeSession as ActiveSession | null;
            if (session && 'sendStdin' in session) {
              const toolResultMsg = {
                type: 'user',
                message: {
                  role: 'user',
                  content: [{
                    type: 'tool_result',
                    tool_use_id: msg.toolUseId,
                    content: msg.content,
                  }],
                },
              };
              session.sendStdin(toolResultMsg);
              log.info('tool:result → stdin', {
                toolUseId: msg.toolUseId.slice(0, 12),
                answerLen: msg.content.length,
              });
            }
            break;
          }

          // ── Abort active session ──
          case 'abort': {
            for (const chatId of connectionChatIds) { registry.abort(chatId); }
            connectionChatIds.clear();
            ws.send(JSON.stringify({ type: 'aborted' } satisfies WsOutgoingAborted));
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
      registry.removeListenerWs(ws);
      for (const [id, sub] of subSessions) {
        sub.abort();
      }
      subSessions.clear();
    });
  });

  wss.on('error', (err) => {
    log.error('server-level WebSocket error', err instanceof Error ? err : undefined);
  });

  return { sessions: registry, subSessions };
}
