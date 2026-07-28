// ── Claude Code slash commands ──
// Source: Claude Code built-in commands + Reasonix skills
// Keep this in sync as new commands are added.

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
