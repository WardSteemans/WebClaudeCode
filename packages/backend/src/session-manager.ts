import { spawn, ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import { createLogger } from './logger.js';

const log = createLogger('session');

export interface StreamEvent {
  type: 'assistant' | 'tool_use' | 'tool_result' | 'user' | 'result' | 'message_stop' | 'prompt_suggestion';
  sessionId: string;
  data: unknown;
}

export interface StreamErrorEvent {
  type: 'error';
  sessionId: string;
  message: string;
}

export type AnyStreamEvent = StreamEvent | StreamErrorEvent;

export type StreamCallback = (event: AnyStreamEvent) => void;
export type RawLineCallback = (line: string, sessionId: string) => void;

interface SessionOptions {
  sessionId?: string;
  resumeSessionId?: string;
  workDir: string;
  permissionMode?: 'default' | 'acceptEdits' | 'auto' | 'plan' | 'dontAsk' | 'bypassPermissions';
  env?: Record<string, string>;
  onRawLine: RawLineCallback;           // NEW: raw Claude JSON line
  onExit: (code: number | null) => void;
  onSessionReady?: (sessionId: string) => void;
}

export interface ActiveSession {
  sessionId: string;
  workDir: string;
  process: ChildProcess;
  sendPrompt: (prompt: string) => void;
  abort: () => void;
}

export function startSession(opts: SessionOptions): ActiveSession {
  const sessionId = opts.sessionId || randomUUID();
  const isResume = !!opts.resumeSessionId;

  const args = [
    '--print',
    '--output-format', 'stream-json',
    '--input-format', 'stream-json',
    '--verbose',
    ...(isResume
      ? ['--resume', opts.resumeSessionId!]
      : ['--session-id', sessionId]),
    '--replay-user-messages',
    '--permission-mode', opts.permissionMode ?? 'bypassPermissions',
    '--add-dir', opts.workDir,
    '--include-partial-messages',
  ];

  const isWindows = process.platform === 'win32';

  const proc = spawn('claude', args, {
    cwd: opts.workDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...opts.env },
    shell: isWindows,
  });

  const sid = sessionId.slice(0, 8);
  log.info(`spawning claude`, { sid, workDir: opts.workDir, isResume, permissionMode: opts.permissionMode });
  log.debug(`env keys`, { sid, keys: Object.keys({ ...process.env, ...opts.env }).filter(k => k.includes('ANTHROPIC')).join(', ') });

  let stdoutBuffer = '';
  let realSessionId: string | null = null;

  const processLine = (line: string) => {
    if (!line.trim()) return;
    log.debug(`stdout`, { sid, line: line.slice(0, 200) });

    // Check for real session ID in system init
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === 'system' && parsed.subtype === 'init' && parsed.session_id) {
        realSessionId = parsed.session_id as string;
        opts.onSessionReady?.(realSessionId);
      }
    } catch { /* not JSON, skip */ }

    // Pass raw line — use real session ID once known for consistent event tagging
    opts.onRawLine(line, realSessionId || sessionId);
  };

  proc.stdout!.on('data', (chunk: Buffer) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop() || '';
    for (const line of lines) processLine(line);
  });

  proc.stdout!.on('end', () => {
    if (stdoutBuffer.trim()) processLine(stdoutBuffer);
  });

  proc.stderr!.on('data', (chunk: Buffer) => {
    log.warn(`stderr`, { sid, stderr: chunk.toString().slice(0, 500) });
  });

  proc.on('error', (err) => {
    log.error(`process error`, err, { sid });
  });

  proc.on('exit', (code) => {
    if (stdoutBuffer.trim()) { processLine(stdoutBuffer); stdoutBuffer = ''; }
    log.info(`process exited`, { sid, exitCode: code });
    opts.onExit(code);
  });

  const sendPrompt = (prompt: string) => {
    const message = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: prompt },
    }) + '\n';
    log.info(`sending prompt`, { sid, bytes: message.length });
    proc.stdin!.write(message);
    proc.stdin!.end();
  };

  const abort = () => { proc.kill('SIGTERM'); };

  return { sessionId, workDir: opts.workDir, process: proc, sendPrompt, abort };
}
