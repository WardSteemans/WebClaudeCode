// ── Tool name classification ──
// Shared constants used across the event parser modules.

export const FILE_READ_TOOLS = new Set(['Read', 'read_file', 'Grep', 'Glob']);
export const FILE_WRITE_TOOLS = new Set(['Write', 'write_file', 'Edit', 'edit_file', 'MultiEdit', 'multi_edit']);
export const SHELL_TOOLS = new Set(['Bash', 'bash', 'execute_command']);

const HIGH_RISK_NAMES = ['Bash', 'Write', 'Edit', 'Delete'];

export function isHighRisk(toolName: string): boolean {
  return HIGH_RISK_NAMES.some(t => toolName.includes(t) || t.includes(toolName));
}
