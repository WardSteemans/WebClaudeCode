import type { FileEvent, CommandEvent, AppEvent } from '@cc-gui/shared';
import { mkId, now } from './state.js';
import { FILE_READ_TOOLS, FILE_WRITE_TOOLS, SHELL_TOOLS, isHighRisk } from './constants.js';

// ── File event derivation from tool input ──

export function deriveFileEvents(toolName: string, input: Record<string, unknown>, sessionId: string): FileEvent[] {
  const events: FileEvent[] = [];
  if (FILE_READ_TOOLS.has(toolName)) {
    if (input.file_path) events.push({ id: mkId(), timestamp: now(), sessionId, type: 'file.read', path: String(input.file_path) });
    if (input.path) events.push({ id: mkId(), timestamp: now(), sessionId, type: 'file.read', path: String(input.path) });
  } else if (FILE_WRITE_TOOLS.has(toolName)) {
    if (input.file_path) events.push({ id: mkId(), timestamp: now(), sessionId, type: 'file.changed', path: String(input.file_path), changeType: 'modified' });
    if (input.path) events.push({ id: mkId(), timestamp: now(), sessionId, type: 'file.changed', path: String(input.path), changeType: 'modified' });
  }
  return events;
}

// ── Command finished event from tool result ──

export function deriveCommandEvent(toolName: string, input: Record<string, unknown>, sessionId: string, exitCode: number, durationMs: number): CommandEvent | null {
  if (SHELL_TOOLS.has(toolName) && input.command) {
    return { id: mkId(), timestamp: now(), sessionId, type: 'command.finished', command: String(input.command), exitCode, durationMs };
  }
  return null;
}

// ── Shared: emit tool.started + command.started + permission.requested ──
// Used by both streamParser (content_block_stop) and assistantParser (tool_use fallback).

export function* emitToolStarted(
  toolName: string,
  toolInput: Record<string, unknown>,
  sessionId: string,
  toolUseId?: string,
): Generator<AppEvent> {
  yield {
    type: 'tool.started',
    toolName,
    toolInput,
    toolUseId,
    files: deriveFileEvents(toolName, toolInput, sessionId).map(f => f.path),
    id: mkId(), timestamp: now(), sessionId,
  };

  // Command started (Bash/bash only — execute_command is excluded from stream-side emission)
  if ((toolName === 'Bash' || toolName === 'bash') && toolInput.command) {
    yield {
      type: 'command.started',
      command: String(toolInput.command),
      cwd: String(toolInput.workdir || ''),
      id: mkId(), timestamp: now(), sessionId,
    };
  }

  // Permission check for high-risk tools
  if (isHighRisk(toolName)) {
    yield {
      type: 'permission.requested',
      toolName,
      toolInput,
      description: `${toolName}: ${JSON.stringify(toolInput).slice(0, 100)}`,
      risk: toolName === 'Bash' || toolName === 'bash' ? 'high' : 'medium',
      id: mkId(), timestamp: now(), sessionId,
    };
  }
}
