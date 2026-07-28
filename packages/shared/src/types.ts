// ── Shared type definitions ──
// Types used by both backend and frontend that don't belong to a specific domain.

// ==================== Logging ====================

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

// ==================== Permissions ====================

export type PermissionMode = 'default' | 'acceptEdits' | 'auto' | 'plan' | 'dontAsk' | 'bypassPermissions';

// ==================== Sessions ====================

export interface SessionMeta {
  sessionId: string;
  title: string;
  timestamp: string;
  messageCount: number;
  file: string;
  workDir?: string;
}

// ==================== Models ====================

export interface ModelOption {
  id: string;
  label: string;
  provider: 'anthropic' | 'deepseek';
  subagentModel?: string;
}

export const ALL_MODELS: ModelOption[] = [
  { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4', provider: 'anthropic', subagentModel: 'claude-3-5-haiku-20241022' },
  { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet', provider: 'anthropic', subagentModel: 'claude-3-5-haiku-20241022' },
  { id: 'claude-opus-4-20250514', label: 'Claude Opus 4', provider: 'anthropic', subagentModel: 'claude-3-5-haiku-20241022' },
  { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku', provider: 'anthropic' },
  { id: 'deepseek-v4-pro[1m]', label: 'DeepSeek V4 Pro (1M)', provider: 'deepseek', subagentModel: 'deepseek-v4-flash' },
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', provider: 'deepseek', subagentModel: 'deepseek-v4-flash' },
  { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', provider: 'deepseek' },
  { id: 'deepseek-r1', label: 'DeepSeek R1', provider: 'deepseek', subagentModel: 'deepseek-v4-flash' },
  { id: 'deepseek-v3', label: 'DeepSeek V3', provider: 'deepseek', subagentModel: 'deepseek-v4-flash' },
];

// ==================== Slash Commands ====================

export interface SlashCommand {
  /** The command name, e.g. "review" for /review */
  name: string;
  /** Short description shown in autocomplete */
  description: string;
  /** Optional: example usage */
  example?: string;
  /** Category for grouping */
  category: 'build' | 'review' | 'explore' | 'manage' | 'other';
}

export const SLASH_COMMANDS: SlashCommand[] = [
  // ── Review ──
  { name: 'review', description: 'Review pending changes (branch diff) — correctness, security, tests', example: '/review', category: 'review' },
  { name: 'security-review', description: 'Security-focused review — injection, auth, secrets, crypto', example: '/security-review', category: 'review' },
  { name: 'pr-review', description: 'Review a branch/PR diff with pasteable line comments', example: '/pr-review', category: 'review' },

  // ── Explore ──
  { name: 'explore', description: 'Explore the codebase — wide-net read-only investigation', example: '/explore', category: 'explore' },
  { name: 'research', description: 'Research combining web + code reading', example: '/research', category: 'explore' },

  // ── Build/Test ──
  { name: 'test', description: 'Run test suite, diagnose failures, fix, re-run until green', example: '/test', category: 'build' },
  { name: 'init', description: 'Bootstrap or refresh AGENTS.md from codebase analysis', example: '/init', category: 'manage' },

  // ── Manage ──
  { name: 'install-capability', description: 'Install/uninstall MCP servers and skills', example: '/install-capability', category: 'manage' },
  { name: 'find-skills', description: 'Discover and install agent skills', example: '/find-skills', category: 'manage' },
  { name: 'reasonix-guide', description: 'Troubleshoot and configure Reasonix capabilities', example: '/reasonix-guide', category: 'manage' },

  // ── Other ──
  { name: 'clear', description: 'Clear the conversation and start fresh', example: '/clear', category: 'other' },
  { name: 'compact', description: 'Compact conversation context to save tokens', example: '/compact', category: 'other' },
  { name: 'context', description: 'Show current context window usage', example: '/context', category: 'other' },
  { name: 'cost', description: 'Show token usage and cost for this session', example: '/cost', category: 'other' },
  { name: 'doctor', description: 'Diagnose Claude Code installation issues', example: '/doctor', category: 'other' },
  { name: 'help', description: 'Show help and available commands', example: '/help', category: 'other' },
  { name: 'login', description: 'Log in to your Anthropic account', example: '/login', category: 'other' },
  { name: 'logout', description: 'Log out of your Anthropic account', example: '/logout', category: 'other' },
  { name: 'status', description: 'Show Claude Code status and version', example: '/status', category: 'other' },
  { name: 'add-dir', description: 'Add a directory to the workspace context', example: '/add-dir <path>', category: 'manage' },
  { name: 'ide', description: 'Manage IDE integration', example: '/ide', category: 'manage' },
  { name: 'memory', description: 'Open or edit a memory file', example: '/memory <name>', category: 'manage' },
];
