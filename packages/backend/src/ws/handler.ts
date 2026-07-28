import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { createServer } from 'http';
import { startSession, ActiveSession } from '../services/session-manager.js';
import { parseClaudeEvent } from '../services/eventParser.js';
import { createLogger } from '../logger.js';

const log = createLogger('ws');

const sessions = new Map<string, ActiveSession>();
const subSessions = new Map<string, ActiveSession>();

// Per-connection heartbeat: send ping every 30s to keep the connection alive
const HEARTBEAT_INTERVAL = 30_000;

// ----- Context query (runs after session exits to get usage stats) -----

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

  // Write /context prompt immediately (--print mode expects stdin right away)
  proc.stdin!.write(JSON.stringify({
    type: 'user',
    message: { role: 'user', content: '/context' },
  }) + '\n');
  proc.stdin!.end();

  proc.on('close', () => {
    try {
      const lines = stdout.split('\n').filter(l => l.trim());
      for (const line of lines) {
        let evt: any;
        try { evt = JSON.parse(line); } catch { continue; }
        
        // Claude Code outputs context as a user or assistant message
        if (evt.type === 'user' || evt.type === 'assistant') {
          const content = Array.isArray(evt.message?.content)
            ? evt.message.content.map((b: any) => b.text || '').join('')
            : String(evt.message?.content || '');
          
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

function extractUsageFromContext(content: string, sessionId: string): any | null {
  // Try to find JSON-like context data in Claude's response
  // Claude Code's /context output varies by version
  
  // Pattern 1: Look for token counts like "Total tokens: 12,345 / 200,000"
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
    };
  }
  
  return null;
}

export function setupWebSocket(server: ReturnType<typeof createServer>): { sessions: Map<string, ActiveSession>; subSessions: Map<string, ActiveSession> } {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: WebSocket) => {
    let activeSession: ActiveSession | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let isAlive = true;

    // Heartbeat: send ping, mark as dead if no pong comes back
    heartbeatTimer = setInterval(() => {
      if (!isAlive) {
        log.warn('heartbeat lost — terminating socket');
        heartbeatTimer && clearInterval(heartbeatTimer);
        return ws.terminate();
      }
      isAlive = false;
      ws.ping();
    }, HEARTBEAT_INTERVAL);

    // Mark alive on pong (browser responds automatically to ping)
    ws.on('pong', () => {
      isAlive = true;
    });

    ws.on('message', (data) => {
      const raw = data.toString();

      // Parse JSON (separate try so we don't misreport spawn errors)
      let msg: { type: string; workDir?: string; sessionId?: string; permissionMode?: string; prompt?: string; env?: Record<string, string>; resumeSessionId?: string; provider?: string; model?: string };
      try {
        msg = JSON.parse(raw);
      } catch {
        log.error('invalid JSON received', undefined, { length: raw.length });
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
        return;
      }

      log.debug('ws message', { type: msg.type, promptPreview: msg.prompt?.slice(0, 80) });

      try {
        switch (msg.type) {
          case 'prompt': {
            // Kill any existing Claude process
            if (activeSession) {
              activeSession.abort();
              sessions.delete(activeSession.sessionId);
            }

            const workDir = msg.workDir || process.cwd();
            const permissionMode: 'default' | 'acceptEdits' | 'auto' | 'plan' | 'dontAsk' | 'bypassPermissions' = (msg.permissionMode as any) || 'bypassPermissions';
            const chatId = (msg as any)._chatId || 'default';
            let realSessionId: string | null = null;

            const session = startSession({
              resumeSessionId: msg.resumeSessionId,
              workDir,
              permissionMode,
              env: msg.env,
              onRawLine: (rawLine, sid) => {
                if (ws.readyState !== WebSocket.OPEN) return;
                for (const event of parseClaudeEvent(rawLine, sid)) {
                  ws.send(JSON.stringify({ type: 'event', chatId, event }));
                }
              },
              onSessionReady: (realId) => {
                realSessionId = realId;
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: 'session_ready', sessionId: realId }));
                }
              },
              onExit: (code) => {
                const sid = realSessionId || session.sessionId;
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({
                    type: 'session_exit',
                    sessionId: sid,
                    exitCode: code,
                  }));
                }
                // Query context in background to get usage stats (fallback if parser missed it)
                // Disabled: parser now reliably extracts usage from result events
                // if (realSessionId) queryContext(workDir, realSessionId, chatId, ws);
                sessions.delete(session.sessionId);
                if (activeSession?.sessionId === session.sessionId) activeSession = null;
              },
            });

            sessions.set(session.sessionId, session);
            activeSession = session;
            if (msg.prompt) session.sendPrompt(msg.prompt);
            break;
          }

          case 'abort': {
            if (activeSession) {
              activeSession.abort();
              sessions.delete(activeSession.sessionId);
              activeSession = null;
              ws.send(JSON.stringify({ type: 'aborted' }));
            }
            break;
          }

          case 'subagent:start': {
            const chatId = (msg as any).chatId || 'default';
            const subagentId = (msg as any).subagentId || randomUUID();
            const task = (msg as any).task || '';
            const workDir = (msg as any).workDir || process.cwd();
            const env = (msg as any).env || {};

            log.info('subagent:start', { subagentId: subagentId.slice(0, 8), taskPreview: task.slice(0, 100), chatId });

            const subSession = startSession({
              workDir,
              permissionMode: 'bypassPermissions',
              env,
              onRawLine: (rawLine, sid) => {
                if (ws.readyState !== WebSocket.OPEN) return;
                for (const event of parseClaudeEvent(rawLine, sid)) {
                  ws.send(JSON.stringify({ type: 'event', chatId, subagentId, event }));
                }
              },
              onSessionReady: (realId) => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: 'subagent_ready', chatId, subagentId, sessionId: realId }));
                }
              },
              onExit: (code) => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: 'subagent_exit', chatId, subagentId, exitCode: code }));
                }
                subSessions.delete(subagentId);
              },
            });

            subSessions.set(subagentId, subSession);
            subSession.sendPrompt(task);
            break;
          }

          case 'subagent:abort': {
            const subagentId = (msg as any).subagentId;
            if (subagentId) {
              const sub = subSessions.get(subagentId);
              if (sub) {
                sub.abort();
                subSessions.delete(subagentId);
                ws.send(JSON.stringify({ type: 'subagent_aborted', subagentId }));
              }
            }
            break;
          }

          default:
            ws.send(JSON.stringify({ type: 'error', message: `Unknown message type: ${msg.type}` }));
        }
      } catch (err) {
        log.error('ws handler error', err instanceof Error ? err : undefined);
        ws.send(JSON.stringify({ type: 'error', message: 'Server error: ' + (err instanceof Error ? err.message : String(err)) }));
      }
    });

    ws.on('error', (err) => {
      log.error('ws socket error', err instanceof Error ? err : undefined);
      // Cleanup happens in close handler (error always triggers close)
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
      // Only log if there was actual work being done
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
