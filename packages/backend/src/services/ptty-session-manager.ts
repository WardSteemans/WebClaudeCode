import { spawn as ptySpawn, IPty } from 'node-pty';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../logger.js';
import type { PermissionMode } from '@cc-gui/shared';

const log = createLogger('ptty');

// ── Timing constants (tuned per claude-wrap patterns) ──
// Claude Code's Ink TUI commits typed input asynchronously. Sending text and
// Enter in one write lets Enter race ahead of the text commit, so the prompt
// is typed but never submitted. A short gap with separate writes fixes this.
const SUBMIT_DELAY_MS = 150;
// If Claude hasn't started processing after this timeout, retry Enter once.
const SUBMIT_RETRY_MS = 3_000;

// ── Child environment helpers ──
// Strip parent Claude Code / IDE-integration vars that interfere with a
// freshly-spawned child session (pattern from claude-wrap).
const STRIP_EXACT = new Set(['CLAUDECODE', 'CLAUDE_EFFORT', 'AI_AGENT']);
const STRIP_PREFIXES = ['CLAUDE_CODE_'];

function cleanChildEnv(parentEnv: typeof process.env, extra?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(parentEnv)) {
    if (v === undefined) continue;
    if (STRIP_EXACT.has(k)) continue;
    if (STRIP_PREFIXES.some(p => k.startsWith(p))) continue;
    env[k] = v;
  }
  if (extra) Object.assign(env, extra);
  // Ensure Claude Code sees a proper terminal type for its TUI
  if (!env.TERM) env.TERM = 'xterm-256color';
  env.FORCE_COLOR = '3';
  return env;
}

// ── PTY debug file logger ──
// Writes raw PTY I/O to a separate file for debugging.
const PTY_DEBUG_DIR = (() => {
  // Resolve relative to the workspace root, not cwd
  const cwd = process.cwd();
  // If running from packages/backend, go up 2 levels to workspace root
  if (cwd.endsWith('packages\\backend') || cwd.endsWith('packages/backend')) {
    return path.resolve(cwd, '..', '..', 'logging');
  }
  return path.resolve(cwd, 'logging');
})();
const pty_debug = (sid: string, dir: string, msg: string, data?: string) => {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const ts = new Date().toISOString();
    const line = `[${ts}] [${sid}] ${msg}${data ? '\n' + data : ''}\n`;
    fs.appendFileSync(path.join(dir, `pty-debug-${sid.slice(0, 8)}.log`), line);
  } catch { /* never crash on debug logging */ }
};

// ── Helpers ──

/** Strip all ANSI escape sequences (CSI, OSC, etc) for plain text matching */
function stripAnsi(data: string): string {
  return data
    // Replace cursor-forward sequences with spaces to preserve word boundaries
    .replace(/\x1b\[[0-9]*C/g, ' ')
    // Replace cursor-up/down/position with newlines/spaces
    .replace(/\x1b\[[0-9;]*[AB]/g, ' ')
    .replace(/\x1b\[[0-9;]*[Hf]/g, '\n')
    // Strip remaining CSI sequences
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    // Strip OSC sequences (hyperlinks, title)
    .replace(/\x1b\][^\x07]*\x07/g, '')
    // Strip other escape sequences
    .replace(/\x1b[><=][0-9;]*[a-zA-Z]?/g, '')
    // Strip remaining control chars
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
}

/** Detect approval prompts and AskUserQuestion patterns in raw PTY output */
export function detectPromptType(data: string): { isApproval: boolean; isQuestion: boolean } {
  const plain = stripAnsi(data);

  const isApproval =
    /Do you want to (proceed|allow|approve|grant|authorize)/i.test(plain) ||
    /permission to (write|edit|delete|run|execute)/i.test(plain) ||
    /(?:\[y\/n\]|\(y\/n\))/i.test(plain)
    || /may i (?:write|edit|delete|run|execute|access)/i.test(plain)
    || /want (?:me )?to (?:write|edit|delete|run|execute)/i.test(plain)
    || /\b(?:approve|allow|proceed)\?/i.test(plain);

  const isQuestion =
    /Select (?:one|an option)|Choose (?:one|an option)/i.test(plain) ||
    /\[.*\].*\[.*\] .*\[.*\]/i.test(plain)
    || /What (?:should|would|do) you|Which (?:one|option|approach)/i.test(plain);

  return { isApproval, isQuestion };
}

export type PtyRawDataCallback = (data: string, sessionId: string) => void;
export type PtyExitCallback = (code: number | null) => void;
export type PtySessionReadyCallback = (sessionId: string) => void;

interface PtySessionOptions {
  sessionId?: string;
  resumeSessionId?: string;
  workDir: string;
  permissionMode?: PermissionMode;
  env?: Record<string, string>;
  onData: PtyRawDataCallback;
  onExit: PtyExitCallback;
  onSessionReady?: PtySessionReadyCallback;
}

export interface PtyActiveSession {
  sessionId: string;
  workDir: string;
  pty: IPty;
  sendPrompt: (prompt: string) => void;
  sendKeystroke: (key: string) => void;
  resize: (cols: number, rows: number) => void;
  abort: () => void;
}

// ── PTY-based session (interactive Claude Code) ──

export function startPtySession(opts: PtySessionOptions): PtyActiveSession {
  const sessionId = opts.sessionId || randomUUID();
  const isResume = !!opts.resumeSessionId;

  const args: string[] = [
    'claude',
    ...(isResume
      ? ['--resume', opts.resumeSessionId!]
      : ['--session-id', sessionId]),
    '--permission-mode', opts.permissionMode ?? 'default',
    '--add-dir', opts.workDir,
  ];

  const sid = sessionId.slice(0, 8);
  // Clean env: strip parent Claude Code vars that interfere with child session
  const env = cleanChildEnv(process.env, opts.env);

  pty_debug(sid, PTY_DEBUG_DIR, '=== PTY SESSION START ===');
  pty_debug(sid, PTY_DEBUG_DIR, 'config', JSON.stringify({
    sessionId, isResume, workDir: opts.workDir,
    permissionMode: opts.permissionMode,
    command: 'claude', args: args.slice(1),
    envKeys: Object.keys(env).filter(k =>
      k.startsWith('ANTHROPIC') || k.startsWith('CLAUDE') || k === 'PATH' || k === 'HOME' || k === 'TERM'
    ),
    envVals: {
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY ? `${env.ANTHROPIC_API_KEY.slice(0, 12)}...` : '<missing>',
      ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL || '<default>',
      ANTHROPIC_MODEL: env.ANTHROPIC_MODEL || '<default>',
      CLAUDE_CODE_EFFORT_LEVEL: env.CLAUDE_CODE_EFFORT_LEVEL || '<unset>',
      TERM: env.TERM || '<unset>',
    },
    platform: process.platform,
  }));

  log.info(`spawning claude PTY`, { sid, workDir: opts.workDir, isResume, permissionMode: opts.permissionMode });

  // On Windows, use cmd.exe /c wrapper (matching claude-wrap pattern) for reliable ConPTY input.
  // On Unix, direct claude spawn works.
  const isWindows = process.platform === 'win32';

  let pty: IPty;
  try {
    if (isWindows) {
      // Use cmd.exe /c claude pattern (claude-wrap uses same for headless mode).
      // This avoids edge cases with .cmd file resolution and ConPTY input processing.
      pty = ptySpawn('cmd.exe', ['/c', 'claude', ...args.slice(1)], {
        name: 'xterm-256color',
        cwd: opts.workDir,
        env,
        cols: 200,
        rows: 60,
        useConpty: true,
      });
    } else {
      pty = ptySpawn('claude', args.slice(1), {
        name: 'xterm-256color',
        cwd: opts.workDir,
        env,
        cols: 200,
        rows: 60,
      });
    }
    pty_debug(sid, PTY_DEBUG_DIR, 'PTY spawned successfully', `pid=${pty.pid}`);
  } catch (err: any) {
    const msg = `PTY spawn failed: ${err?.message || err}`;
    pty_debug(sid, PTY_DEBUG_DIR, 'FATAL', msg);
    log.error('PTY spawn failed', err instanceof Error ? err : undefined);
    throw err;
  }

  let realSessionId: string | null = null;
  let trustHandled = false;
  let apiKeyHandled = false;
  let readyForPrompt = false;
  let lastPromptSeen = 0; // timestamp of last time ❯ was visible in output

  // ── Data handler ──
  pty.onData((data: string) => {
    pty_debug(sid, PTY_DEBUG_DIR, '← PTY RAW DATA', JSON.stringify(data));
    pty_debug(sid, PTY_DEBUG_DIR, '← PTY PLAIN', stripAnsi(data));

    const plain = stripAnsi(data);
    log.debug(`pty data`, { sid, len: data.length, preview: plain.slice(0, 200) });

    // Auto-handle the "trust this folder" prompt (only if NOT the API key prompt)
    if (!trustHandled && !apiKeyHandled &&
        /Quick safety check.*Is this a project you/i.test(plain)) {
      trustHandled = true;
      pty_debug(sid, PTY_DEBUG_DIR, '→ AUTO TRUST', 'Sending Enter to trust folder');
      log.info(`PTY auto-trusting folder`, { sid });
      setTimeout(() => {
        pty.write('\r\n');
        pty_debug(sid, PTY_DEBUG_DIR, '→ TRUST SENT');
      }, 500);
    }

    // If trust was already granted (no trust prompt), detect the main TUI instead
    if (!trustHandled && /Welcome back|Claude Code v\d|❯ /.test(plain) && plain.length > 100) {
      trustHandled = true;
      pty_debug(sid, PTY_DEBUG_DIR, 'TRUST SKIPPED', 'Already trusted, proceeding');
    }

    // Auto-handle the "use this API key?" prompt (select "Yes" — option 1)
    // Must come AFTER trust detection to avoid double-trigger
    if (trustHandled && !apiKeyHandled && /Do you want to use this API key/i.test(plain)) {
      apiKeyHandled = true;
      pty_debug(sid, PTY_DEBUG_DIR, '→ AUTO API KEY', 'Sending 1+Enter to select Yes');
      log.info(`PTY auto-accepting API key`, { sid });
      setTimeout(() => {
        // Use number shortcut "1" instead of arrow keys (more reliable across platforms)
        pty.write('1\r\n');
        pty_debug(sid, PTY_DEBUG_DIR, '→ API KEY ACCEPTED');
      }, 300);
    }

    // Fallback: if trust handled but no API key prompt appeared, and welcome screen shows → mark resolved
    if (trustHandled && !apiKeyHandled && /Claude Code v\d|Welcome back/i.test(plain)) {
      apiKeyHandled = true;
      pty_debug(sid, PTY_DEBUG_DIR, 'API KEY SKIPPED', 'No API key prompt detected, proceeding');
    }

    // Detect when Claude is ready for input — the prompt indicator "❯" appears
    // Placed AFTER all prompt handlers so trust+apiKey flags are already resolved
    if (trustHandled && apiKeyHandled && !readyForPrompt) {
      if (/❯\s*$/.test(plain.trim()) || /❯ /.test(plain) || />\s*Try/.test(plain) || /❯\s*Try/.test(plain) || /❯ /.test(plain)) {
        readyForPrompt = true;
        pty_debug(sid, PTY_DEBUG_DIR, 'CLAUDE READY', 'Detected prompt indicator ❯');
        log.info(`PTY claude ready for input`, { sid });
        // Send the pending prompt (text first, Enter after delay)
        if (pendingPrompt) {
          pty_debug(sid, PTY_DEBUG_DIR, '→ SEND PENDING PROMPT', pendingPrompt);
          pty.write(pendingPrompt);
          scheduleEnterWithRetry();
          pendingPrompt = null;
        }
      }
    }

    // Track whether the ❯ prompt disappeared → Claude is genuinely processing.
    // Simple absence of ❯ in one chunk isn't enough (status bar updates don't
    // contain ❯ either). We track the LAST time we saw ❯ — if it hasn't been
    // seen for a while, Claude likely started working.
    if (/❯\s/.test(plain) || /-- INSERT --/.test(plain)) {
      lastPromptSeen = Date.now();
    }

    // Extract session ID from system init
    if (!realSessionId) {
      const initMatch = data.match(/"session_id"\s*:\s*"([a-f0-9-]+)"/);
      if (initMatch) {
        realSessionId = initMatch[1];
        log.info(`PTY session ready`, { sid, realSessionId: initMatch[1] });
        pty_debug(sid, PTY_DEBUG_DIR, 'session_ready', realSessionId);
        opts.onSessionReady?.(realSessionId);
      }
    }

    // Forward raw data to callback
    opts.onData(data, realSessionId || sessionId);
  });

  // ── Exit handler ──
  pty.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
    log.info(`pty exited`, { sid, exitCode, signal });
    pty_debug(sid, PTY_DEBUG_DIR, '=== PTY EXITED ===', JSON.stringify({ exitCode, signal }));
    opts.onExit(exitCode);
  });

  // ── Send a prompt (plain text + Enter) ──
  let pendingPrompt: string | null = null;
  let enterRetryTimer: ReturnType<typeof setTimeout> | null = null;

  // Schedule an Enter keypress with a single retry if Claude doesn't respond.
  // Claude Code's Ink TUI commits typed input asynchronously; sending text and
  // Enter together lets Enter race ahead — the prompt is typed but never submitted.
  // A short gap between text write and Enter write fixes this reliably (claude-wrap pattern).
  function scheduleEnterWithRetry() {
    // Clear any previous retry timer
    if (enterRetryTimer) clearTimeout(enterRetryTimer);

    // Send Enter after a short delay (let TUI commit the typed text)
    setTimeout(() => {
      pty.write('\r\n');
      pty_debug(sid, PTY_DEBUG_DIR, '→ ENTER SENT');
      const enterSentAt = Date.now();

      // Single retry: if Claude doesn't respond within SUBMIT_RETRY_MS,
      // send Enter again — but ONLY if the prompt is still visible (Claude is idle).
      // If ❯ disappeared, Claude is working and retry would be harmful.
      enterRetryTimer = setTimeout(() => {
        // Check that ❯ was seen AFTER we sent Enter (i.e. Claude is still waiting)
        if (lastPromptSeen >= enterSentAt) {
          pty.write('\r\n');
          pty_debug(sid, PTY_DEBUG_DIR, '→ ENTER RETRY (prompt still visible)');
        } else {
          pty_debug(sid, PTY_DEBUG_DIR, '→ ENTER RETRY SKIPPED (prompt gone, Claude is processing)');
        }
        enterRetryTimer = null;
      }, SUBMIT_RETRY_MS);
    }, SUBMIT_DELAY_MS);
  }

  // Cancel any pending Enter retry (call when Claude starts processing)
  function cancelEnterRetry() {
    if (enterRetryTimer) {
      clearTimeout(enterRetryTimer);
      enterRetryTimer = null;
    }
  }

  const sendPrompt = (prompt: string) => {
    log.info(`sending prompt to PTY`, { sid, len: prompt.length });
    pty_debug(sid, PTY_DEBUG_DIR, `→ QUEUED PROMPT`, prompt);

    if (readyForPrompt) {
      pty_debug(sid, PTY_DEBUG_DIR, `→ SEND PROMPT (text first, Enter after ${SUBMIT_DELAY_MS}ms)`, prompt);
      pty.write(prompt);
      scheduleEnterWithRetry();
    } else {
      // Store prompt, send when Claude is ready
      pendingPrompt = prompt;
      pty_debug(sid, PTY_DEBUG_DIR, `→ PROMPT QUEUED (waiting for Claude ready state)`, prompt);
      // Fallback: send after 15s even if ready signal not detected
      setTimeout(() => {
        if (pendingPrompt === prompt) {
          pty_debug(sid, PTY_DEBUG_DIR, `→ SEND PROMPT (timeout fallback)`, prompt);
          pty.write(prompt);
          scheduleEnterWithRetry();
          pendingPrompt = null;
        }
      }, 15000);
    }
  };

  // ── Send a keystroke (y/n/etc for approvals) ──
  // Claude Code's TUI uses letter keys to select a permission option, then
  // Enter to confirm. Sending just the letter without Enter does nothing.
  // Pattern matches claude-wrap's chooseOption().
  const sendKeystroke = (key: string) => {
    log.info(`sending keystroke to PTY`, { sid, key });
    pty_debug(sid, PTY_DEBUG_DIR, `→ SEND KEY`, key);
    pty.write(key);
    // Confirm selection with Enter after a short gap
    setTimeout(() => {
      pty.write('\r\n');
      pty_debug(sid, PTY_DEBUG_DIR, `→ KEY ENTER (confirm ${key})`);
    }, SUBMIT_DELAY_MS);
  };

  // ── Resize terminal ──
  const resize = (cols: number, rows: number) => {
    pty.resize(cols, rows);
  };

  // ── Abort ──
  const abort = () => {
    log.info(`aborting PTY`, { sid });
    pty_debug(sid, PTY_DEBUG_DIR, '=== PTY ABORTED ===');
    cancelEnterRetry();
    pty.kill();
  };

  return { sessionId, workDir: opts.workDir, pty, sendPrompt, sendKeystroke, resize, abort };
}
