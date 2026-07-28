import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { startSession, ActiveSession } from './session-manager.js';
import { parseClaudeEvent } from './eventParser.js';
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { randomUUID } from 'crypto';
import { join, resolve, normalize } from 'path';
import { spawn } from 'child_process';
import * as https from 'https';
import * as git from './git.js';
import * as azureDevOps from './azure-devops.js';
import * as sessionHistory from './sessions.js';
import { initPricing } from './pricing.js';
import { initDb, getSettings, saveSettings, getSessionMetrics, getAllSessionMetrics, saveSessionMetrics, deleteSessionMetrics, getTabStateRaw, saveTabStateRaw } from './db.js';
import { createLogger } from './logger.js';

const log = createLogger('server');

const PORT = Number(process.env.PORT) || 3001;

const app = express();
app.use(express.json({ limit: '10mb' }));

// ── Request logging middleware ──
app.use((req, _res, next) => {
  if (req.path.startsWith('/api/')) {
    log.debug(`API ${req.method} ${req.path}`, {
      method: req.method,
      path: req.path,
      query: Object.keys(req.query).length > 0 ? JSON.stringify(req.query).slice(0, 200) : undefined,
    });
  }
  next();
});

const server = createServer(app);

// ----- File system endpoints -----

const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
  json: 'json', css: 'css', html: 'html', md: 'markdown',
  py: 'python', rs: 'rust', go: 'go', java: 'java', c: 'c',
  cpp: 'cpp', h: 'c', sh: 'bash', yml: 'yaml', yaml: 'yaml',
  xml: 'xml', sql: 'sql', graphql: 'graphql', toml: 'toml',
  env: 'plaintext', gitignore: 'plaintext', dockerfile: 'dockerfile',
};

function getLanguage(filepath: string): string {
  const ext = filepath.split('.').pop()?.toLowerCase();
  return ext ? EXT_TO_LANG[ext] || 'plaintext' : 'plaintext';
}

function isSafe(baseDir: string, targetPath: string): boolean {
  const resolved = resolve(baseDir, normalize(targetPath));
  return resolved.startsWith(resolve(baseDir));
}

app.get('/api/fs/list', (req, res) => {
  const dir = req.query.dir as string | undefined;
  if (!dir) return res.status(400).json({ error: 'dir query param required' });

  // If an explicit base is provided, enforce path safety.
  // Otherwise (when no base), allow browsing anywhere — used by FolderPicker.
  if (typeof req.query.base === 'string') {
    if (!isSafe(req.query.base, dir)) return res.status(403).json({ error: 'Path traversal denied' });
  }

  try {
    const entries = readdirSync(dir, { withFileTypes: true }).map((e) => ({
      name: e.name,
      path: join(dir, e.name),
      type: e.isDirectory() ? 'directory' as const : 'file' as const,
      size: e.isFile() ? statSync(join(dir, e.name)).size : undefined,
    }));
    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    res.json({ entries, dir });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Get available drives (Windows) or root paths (Unix)
// Used by the folder picker to show a starting list of roots.
app.get('/api/fs/drives', (_req, res) => {
  try {
    const roots: string[] = [];
    const isWin = process.platform === 'win32';

    if (isWin) {
      for (let i = 65; i <= 90; i++) {
        const drive = String.fromCharCode(i) + ':\\';
        try {
          if (existsSync(drive)) roots.push(drive);
        } catch { /* inaccessible */ }
      }
    } else {
      roots.push('/');
      if (process.env.HOME) roots.push(process.env.HOME);
    }

    res.json({ drives: roots });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/fs/read', (req, res) => {
  const file = req.query.file as string | undefined;
  if (!file) return res.status(400).json({ error: 'file query param required' });

  const baseDir = typeof req.query.base === 'string' ? req.query.base : process.cwd();
  if (!isSafe(baseDir, file)) return res.status(403).json({ error: 'Path traversal denied' });

  try {
    const content = readFileSync(file, 'utf-8');
    res.json({ path: file, content, language: getLanguage(file) });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ----- Git endpoints -----

function gitBase(req: { query: Record<string, string> }): string {
  return req.query.base || process.cwd();
}

app.get('/api/git/status', (req, res) => {
  try { res.json(git.getStatus(gitBase(req as any))); } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/git/diff', (req, res) => {
  try {
    const file = req.query.file as string | undefined;
    const staged = req.query.staged === 'true';
    const diff = git.getDiff(gitBase(req as any), file, staged);
    res.json({ diff });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/git/log', (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 30;
    res.json(git.getLog(gitBase(req as any), limit));
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/git/branches', (req, res) => {
  try { res.json(git.getBranches(gitBase(req as any))); } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/git/stage', (req, res) => {
  try {
    const files: string[] = req.body.files || [];
    const out = git.stage(gitBase(req as any), files);
    res.json({ ok: true, output: out });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/git/unstage', (req, res) => {
  try {
    const files: string[] = req.body.files || [];
    const out = git.unstage(gitBase(req as any), files);
    res.json({ ok: true, output: out });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/git/commit', (req, res) => {
  try {
    const out = git.commit(gitBase(req as any), req.body.message || '');
    res.json({ ok: true, output: out });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/git/push', (req, res) => {
  try { res.json({ ok: true, output: git.push(gitBase(req as any)) }); } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/git/pull', (req, res) => {
  try { res.json({ ok: true, output: git.pull(gitBase(req as any)) }); } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/git/fetch', (req, res) => {
  try { res.json({ ok: true, output: git.fetch(gitBase(req as any)) }); } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/git/checkout', (req, res) => {
  try {
    const out = git.checkout(gitBase(req as any), req.body.branch || '');
    res.json({ ok: true, output: out });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/git/worktree-add', (req, res) => {
  try {
    const base = req.body.base || process.cwd();
    const branch = req.body.branch;
    const targetPath = req.body.targetPath;
    if (!branch) return res.status(400).json({ error: 'branch required' });
    const result = git.worktreeAdd(base, branch, targetPath);
    res.json(result);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ----- Azure DevOps endpoints -----

app.post('/api/azure-devops/connect', express.json(), async (req, res) => {
  try {
    const { orgUrl, pat } = req.body;
    if (!orgUrl || !pat) return res.status(400).json({ error: 'orgUrl and pat required' });
    const ok = await azureDevOps.connect({ orgUrl, pat });
    const user = azureDevOps.getAuthenticatedUser();
    res.json({ connected: ok, error: azureDevOps.getConnectionError(), user });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/azure-devops/disconnect', (_req, res) => {
  azureDevOps.disconnect();
  res.json({ ok: true });
});

app.get('/api/azure-devops/info', (_req, res) => {
  res.json(azureDevOps.getConnectionInfo());
});

app.get('/api/azure-devops/projects', async (req, res) => {
  try {
    const projects = await azureDevOps.getProjects();
    res.json(projects);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/azure-devops/repositories', async (req, res) => {
  try {
    const project = req.query.project as string;
    if (!project) return res.status(400).json({ error: 'project query param required' });
    const repos = await azureDevOps.getRepositories(project);
    res.json(repos);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/azure-devops/branches', async (req, res) => {
  try {
    const { project, repositoryId, filter } = req.query as Record<string, string>;
    if (!project || !repositoryId) return res.status(400).json({ error: 'project and repositoryId required' });
    const branches = await azureDevOps.getBranches(project, repositoryId, filter);
    res.json(branches);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/azure-devops/pullrequests', async (req, res) => {
  try {
    const { project, repositoryId, status, top, skip, reviewerId } = req.query as Record<string, string>;
    if (!project || !repositoryId) return res.status(400).json({ error: 'project and repositoryId required' });
    const prs = await azureDevOps.getPullRequests(
      project,
      repositoryId,
      (status as any) || 'all',
      parseInt(top || '50', 10),
      parseInt(skip || '0', 10),
      reviewerId || undefined,
    );
    res.json(prs);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/azure-devops/pullrequests/:prId', async (req, res) => {
  try {
    const { project, repositoryId } = req.query as Record<string, string>;
    const prId = parseInt(req.params.prId, 10);
    if (!project || !repositoryId || isNaN(prId)) {
      return res.status(400).json({ error: 'project, repositoryId and prId required' });
    }
    const detail = await azureDevOps.getPullRequestDetail(project, repositoryId, prId);
    res.json(detail);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/azure-devops/workitems', async (req, res) => {
  try {
    const { project, ids } = req.query as Record<string, string>;
    if (!project || !ids) return res.status(400).json({ error: 'project and ids required' });
    const idList = ids.split(',').map(Number).filter(n => !isNaN(n));
    const items = await azureDevOps.getWorkItems(project, idList);
    res.json(items);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ----- Session history endpoints -----

app.get('/api/sessions/list', (req, res) => {
  const base = (req.query.base as string) || process.cwd();
  try { res.json(sessionHistory.listSessions(base)); } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/sessions/read', (req, res) => {
  const base = (req.query.base as string) || process.cwd();
  const id = req.query.id as string;
  if (!id) return res.status(400).json({ error: 'id query param required' });
  const content = sessionHistory.readSession(base, id);
  if (content === null) return res.status(404).json({ error: 'Session not found' });

  // Parse JSONL into message array — preserving all content blocks (thinking, tool_use, etc.)
  const messages: unknown[] = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const evt = JSON.parse(line);
      const ts = evt.timestamp || null;

      if (evt.type === 'user' && evt.message?.role === 'user') {
        const blocks = normalizeBlocks(evt.message);
        const text = blocksToText(blocks);
        if (text || blocks.length > 0) {
          messages.push({ role: 'user', content: text, blocks, timestamp: ts });
        }
      } else if (evt.type === 'assistant' && evt.message?.role === 'assistant') {
        const blocks = normalizeBlocks(evt.message);
        const text = blocks.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
        if (text || blocks.length > 0) {
          messages.push({ role: 'assistant', content: text, blocks, timestamp: ts });
        }
      }
    } catch { /* skip */ }
  }
  res.json({ sessionId: id, messages });
});

/** Normalize the Claude message content into a uniform blocks array */
function normalizeBlocks(msg: any): any[] {
  const raw = msg.content;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    // Could be a JSON string with nested messages, or plain text
    try {
      const parsed = JSON.parse(raw);
      if (parsed.messages) {
        // Anthropic-style: {"messages":[{"content":"..."}]}
        return parsed.messages.flatMap((m: any) => normalizeBlocks(m));
      }
      if (Array.isArray(parsed.content)) return parsed.content;
      return [{ type: 'text', text: raw }];
    } catch {
      // Check for internal CLI XML tags
      const stdoutMatch = raw.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/);
      if (stdoutMatch) return [{ type: 'text', text: stdoutMatch[1].trim() }];
      if (raw.startsWith('<local-command')) {
        const cmdNameMatch = raw.match(/<command-name>([^<]*)<\/command-name>/);
        const cmdMsgMatch = raw.match(/<command-message>([^<]*)<\/command-message>/);
        if (cmdNameMatch) {
          const cmd = cmdNameMatch[1].trim();
          const msg = cmdMsgMatch ? cmdMsgMatch[1].trim() : '';
          const text = msg ? `> **\`${cmd}\`** — ${msg}` : `> **\`${cmd}\`**`;
          return [{ type: 'text', text }];
        }
        return [];
      }
      return [{ type: 'text', text: raw }];
    }
  }
  return [];
}

/** Extract plain text from blocks (for backward-compat `content` field) */
function blocksToText(blocks: any[]): string {
  return blocks
    .filter((b: any) => b.type === 'text' && b.text)
    .map((b: any) => b.text)
    .join('\n');
}

// ----- Session registry -----

const sessions = new Map<string, ActiveSession>();
const subSessions = new Map<string, ActiveSession>();

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

// ----- WebSocket -----

const wss = new WebSocketServer({ server, path: '/ws' });

// Per-connection heartbeat: send ping every 30s to keep the connection alive
const HEARTBEAT_INTERVAL = 30_000;

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

// ----- REST endpoints -----

// Settings
app.get('/api/settings', (_req, res) => {
  res.json(getSettings());
});

app.put('/api/settings', express.json(), (req, res) => {
  try {
    saveSettings(req.body);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ----- Claude Code settings -----

function deepMerge(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
  const result = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (value === null) {
      // null = delete key (even nested)
      delete result[key];
    } else if (typeof value === 'object' && !Array.isArray(value) && typeof result[key] === 'object' && !Array.isArray(result[key])) {
      // Deep merge objects
      result[key] = deepMerge(result[key], value);
    } else {
      // Overwrite scalars and arrays
      result[key] = value;
    }
  }
  return result;
}

const CLAUDE_SETTINGS_PATH = join(process.env.USERPROFILE || '~', '.claude', 'settings.json');

app.get('/api/claude-settings', (_req, res) => {
  try {
    if (!existsSync(CLAUDE_SETTINGS_PATH)) {
      return res.json({});
    }
    const raw = readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    res.json(parsed);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/claude-settings', express.json(), (req, res) => {
  try {
    let current: Record<string, any> = {};
    if (existsSync(CLAUDE_SETTINGS_PATH)) {
      const raw = readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8');
      current = JSON.parse(raw);
    }
    // Deep merge: new values override current, null values delete keys
    const next = deepMerge(current, req.body);
    writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(next, null, 2) + '\n');
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Session metrics
app.get('/api/metrics', (_req, res) => {
  res.json(getAllSessionMetrics());
});

app.get('/api/metrics/:sessionId', (req, res) => {
  const metrics = getSessionMetrics(req.params.sessionId);
  if (!metrics) return res.status(404).json({ error: 'Not found' });
  res.json(metrics);
});

app.post('/api/metrics', express.json(), (req, res) => {
  try {
    const { sessionId, data } = req.body;
    if (!sessionId || !data) return res.status(400).json({ error: 'Missing sessionId or data' });
    saveSessionMetrics(sessionId, data);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/metrics/:sessionId', (req, res) => {
  deleteSessionMetrics(req.params.sessionId);
  res.json({ ok: true });
});

// ----- Tab state (full zustand store persistence) -----
// Raw JSON passthrough — compatible with zustand's createJSONStorage

app.get('/api/tab-state', (_req, res) => {
  try {
    const raw = getTabStateRaw();
    if (raw) {
      res.type('application/json').send(raw);
    } else {
      res.json({ tabs: [], activeTabId: null });
    }
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.put('/api/tab-state', (req, res) => {
  try {
    // req.body is already parsed by express.json() — stringify for DB storage
    saveTabStateRaw(JSON.stringify(req.body));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', activeSessions: sessions.size });
});

// ----- Chat title generation -----

function generateFallbackTitle(messages: Array<{ role: string; content: string }>): string {
  const firstUser = messages.find(m => m.role === 'user');
  if (firstUser) {
    return firstUser.content.replace(/[\n\r]/g, ' ').slice(0, 50).trim();
  }
  return 'Chat';
}

app.post('/api/chats/generate-title', express.json(), (req, res) => {
  const { messages, env } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length < 2) {
    return res.status(400).json({ error: 'Need at least 2 messages' });
  }

  const apiKey = env?.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.json({ title: generateFallbackTitle(messages) });
  }

  const rawBase = (env?.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '');
  const url = new URL('/v1/messages', rawBase);
  const model = env?.ANTHROPIC_MODEL || 'claude-3-5-haiku-20241022';

  // Build conversation summary
  const conversationText = messages
    .filter((m: any) => m.role === 'user' || m.role === 'assistant')
    .slice(-6)
    .map((m: any) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${String(m.content).slice(0, 500)}`)
    .join('\n\n');

  const body = JSON.stringify({
    model,
    max_tokens: 20,
    system: 'You generate very short chat titles. Always respond with ONLY the title text, nothing else.',
    messages: [{
      role: 'user',
      content: `Generate a very short, descriptive title (max 5 words) that captures what this conversation is about. Return ONLY the title — no quotes, no punctuation, no explanation.\n\nConversation:\n${conversationText}\n\nTitle:`,
    }],
  });

  const reqOpts: https.RequestOptions = {
    hostname: url.hostname,
    port: url.port || 443,
    path: url.pathname,
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
    },
    timeout: 15000,
  };

  const apiReq = https.request(reqOpts, (apiRes) => {
    let data = '';
    apiRes.on('data', (chunk: Buffer) => { data += chunk.toString(); });
    apiRes.on('end', () => {
      if (apiRes.statusCode !== 200) {
        return res.json({ title: generateFallbackTitle(messages) });
      }
      try {
        const parsed = JSON.parse(data);
        let title = '';
        if (parsed.content && Array.isArray(parsed.content)) {
          title = parsed.content
            .filter((b: any) => b.type === 'text' && b.text)
            .map((b: any) => b.text)
            .join('');
        }
        title = title.replace(/^["'\s]+|["'\s]+$/g, '').trim();
        if (!title || title.length > 100) title = generateFallbackTitle(messages);
        res.json({ title });
      } catch {
        res.json({ title: generateFallbackTitle(messages) });
      }
    });
  });

  apiReq.on('error', () => { /* silent — titles are non-critical */ });
  apiReq.on('timeout', () => { apiReq.destroy(); if (!res.headersSent) res.json({ title: generateFallbackTitle(messages) }); });
  apiReq.write(body);
  apiReq.end();
});

// ----- Frontend log endpoint -----

app.post('/api/log', express.json(), (req, res) => {
  try {
    const { level, module, message, data, error, step, stepPhase } = req.body as {
      level?: string;
      module?: string;
      message?: string;
      data?: Record<string, unknown>;
      error?: string;
      step?: string;
      stepPhase?: string;
    };

    if (!message) return res.status(400).json({ error: 'message required' });

    const frontendLog = createLogger(`fe:${module || 'unknown'}`);
    switch (level) {
      case 'ERROR':
        frontendLog.error(message, error, { ...data, step, stepPhase });
        break;
      case 'WARN':
        frontendLog.warn(message, { ...data, step, stepPhase });
        break;
      case 'DEBUG':
        frontendLog.debug(message, { ...data, step, stepPhase });
        break;
      default:
        frontendLog.info(message, { ...data, step, stepPhase });
    }

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ----- Start -----

initDb().then(() => initPricing()).then(() => {
  server.listen(PORT, () => {
    log.info(`Backend running`, { port: PORT, wsPath: '/ws' });
    console.log(`Backend running on http://localhost:${PORT}`);
    console.log(`WebSocket on ws://localhost:${PORT}/ws`);
  });
});

