// ── Claude Code settings types ──
// Maps to ~/.claude/settings.json structure
// Only non-default values are present in the file

export interface ClaudeCodeSettings {
  // ── Boolean settings ──
  alwaysThinkingEnabled?: boolean;        // Thinking mode, default: true
  autoCompactEnabled?: boolean;           // Auto-compact, default: true
  switchModelsOnFlag?: boolean;           // Switch models when flagged, default: true
  verbose?: boolean;                      // Verbose output, default: false
  fastMode?: boolean;                     // Fast mode, default: false
  reduceMotion?: boolean;                 // Reduce motion, default: false
  promptSuggestionEnabled?: boolean;      // Prompt suggestions, default: true
  awaySummaryEnabled?: boolean;           // Session recap, default: true
  disableWorkflows?: boolean;             // Dynamic workflows (false=on), default: false
  showTurnDuration?: boolean;             // Show turn duration, default: true
  terminalProgressBarEnabled?: boolean;   // Terminal progress bar, default: true
  autoScrollEnabled?: boolean;            // Auto-scroll, default: true
  leftArrowOpensAgents?: boolean;         // ← opens agents, default: true
  useAutoModeDuringPlan?: boolean;        // Use auto mode during plan, default: true
  skipWorkflowUsageWarning?: boolean;
  inputNeededNotifEnabled?: boolean;
  agentPushNotifEnabled?: boolean;
  spinnerTipsEnabled?: boolean;           // Show tips, default: true
  checkpointingEnabled?: boolean;         // Rewind code, default: true
  workflowKeywordTriggerEnabled?: boolean; // Ultracode keyword trigger, default: true
  axleScreenReader?: boolean;

  // ── String settings ──
  theme?: string;                         // "auto" | "dark" | "light" | "dark-daltonized" | ...
  autoUpdatesChannel?: string;            // "latest" | "stable"
  preferredNotifChannel?: string;         // "auto" | "terminal_bell" | "iterm2" | ...
  outputStyle?: string;                   // "default" | ...
  language?: string;                      // "en" | ...
  editorMode?: string;                    // "normal" | "vim" | ...
  askUserQuestionTimeout?: string;        // "never" | "5m" | ...
  dynamicWorkflowSize?: string;           // "unrestricted" | "restricted"
  model?: string;
  tui?: string;

  // ── Nested settings ──
  permissions?: {
    defaultMode?: string;                 // "auto" | "manual" | ...
    allow?: string[];
    deny?: string[];
  };
  env?: Record<string, string>;
  worktree?: {
    baseRef?: string;
  };
  enabledPlugins?: Record<string, boolean>;
  attribution?: {
    commit?: string;
    pr?: string;
  };
}

// ── Setting definitions for UI rendering ──

export interface SettingDefinition {
  key: string;                  // JSON key in settings.json
  label: string;                // Display label (from /config)
  type: 'boolean' | 'string' | 'select' | 'nested';
  defaultValue: boolean | string;
  options?: { label: string; value: string }[];  // For select type
  description?: string;
  uiGroup: 'general' | 'interface' | 'editor' | 'ide' | 'plugins';
}

export const CLAUDE_SETTING_DEFINITIONS: SettingDefinition[] = [
  // ── Model ──
  { key: 'env.ANTHROPIC_DEFAULT_SONNET_MODEL', label: 'Model', type: 'string', defaultValue: '', uiGroup: 'general' },

  // ── General ──
  { key: 'theme', label: 'Theme', type: 'select', defaultValue: 'dark', uiGroup: 'general',
    options: [
      { label: 'Auto (match terminal)', value: 'auto' },
      { label: 'Dark', value: 'dark' },
      { label: 'Light', value: 'light' },
      { label: 'Dark (daltonized)', value: 'dark-daltonized' },
      { label: 'Light (daltonized)', value: 'light-daltonized' },
    ] },
  { key: 'language', label: 'Language', type: 'select', defaultValue: 'en', uiGroup: 'general',
    options: [
      { label: 'Default (English)', value: 'en' },
      { label: 'Nederlands', value: 'nl' },
    ] },
  { key: 'autoUpdatesChannel', label: 'Auto-update channel', type: 'select', defaultValue: 'latest', uiGroup: 'general',
    options: [
      { label: 'Latest', value: 'latest' },
      { label: 'Stable', value: 'stable' },
    ] },
  { key: 'outputStyle', label: 'Output style', type: 'select', defaultValue: 'default', uiGroup: 'general',
    options: [
      { label: 'Default', value: 'default' },
      { label: 'Explanatory', value: 'explanatory' },
    ] },

  // ── Interface ──
  { key: 'alwaysThinkingEnabled', label: 'Thinking mode', type: 'boolean', defaultValue: true, uiGroup: 'general' },
  { key: 'verbose', label: 'Verbose output', type: 'boolean', defaultValue: false, uiGroup: 'general' },
  { key: 'autoCompactEnabled', label: 'Auto-compact', type: 'boolean', defaultValue: true, uiGroup: 'general' },
  { key: 'switchModelsOnFlag', label: 'Switch models when flagged', type: 'boolean', defaultValue: true, uiGroup: 'general' },
  { key: 'fastMode', label: 'Fast mode', type: 'boolean', defaultValue: false, uiGroup: 'general' },
  { key: 'promptSuggestionEnabled', label: 'Prompt suggestions', type: 'boolean', defaultValue: true, uiGroup: 'general' },
  { key: 'spinnerTipsEnabled', label: 'Show tips', type: 'boolean', defaultValue: true, uiGroup: 'general' },
  { key: 'showTurnDuration', label: 'Show turn duration', type: 'boolean', defaultValue: true, uiGroup: 'interface' },
  { key: 'terminalProgressBarEnabled', label: 'Terminal progress bar', type: 'boolean', defaultValue: true, uiGroup: 'interface' },
  { key: 'autoScrollEnabled', label: 'Auto-scroll', type: 'boolean', defaultValue: true, uiGroup: 'interface' },
  { key: 'reduceMotion', label: 'Reduce motion', type: 'boolean', defaultValue: false, uiGroup: 'interface' },
  { key: 'awaySummaryEnabled', label: 'Session recap', type: 'boolean', defaultValue: true, uiGroup: 'interface' },
  { key: 'leftArrowOpensAgents', label: '← opens agents', type: 'boolean', defaultValue: true, uiGroup: 'interface' },
  { key: 'useAutoModeDuringPlan', label: 'Use auto mode during plan', type: 'boolean', defaultValue: true, uiGroup: 'general' },
  { key: 'preferredNotifChannel', label: 'Local notifications', type: 'select', defaultValue: 'auto', uiGroup: 'interface',
    options: [
      { label: 'Auto', value: 'auto' },
      { label: 'Terminal bell', value: 'terminal_bell' },
      { label: 'Disabled', value: 'notifications_disabled' },
    ] },

  // ── Editor ──
  { key: 'editorMode', label: 'Editor mode', type: 'select', defaultValue: 'normal', uiGroup: 'editor',
    options: [
      { label: 'Normal', value: 'normal' },
      { label: 'Vim', value: 'vim' },
    ] },
  { key: 'askUserQuestionTimeout', label: 'Question auto-continue timeout', type: 'select', defaultValue: 'never', uiGroup: 'editor',
    options: [
      { label: 'Never', value: 'never' },
      { label: '5 minutes', value: '5m' },
      { label: '30 seconds', value: '30s' },
    ] },

  // ── Workflows / Checkpoints ──
  { key: 'disableWorkflows', label: 'Dynamic workflows', type: 'boolean', defaultValue: false, uiGroup: 'general',
    description: 'false = enabled, true = disabled' },
  { key: 'workflowKeywordTriggerEnabled', label: 'Ultracode keyword trigger', type: 'boolean', defaultValue: true, uiGroup: 'general' },
  { key: 'dynamicWorkflowSize', label: 'Dynamic workflow size', type: 'select', defaultValue: 'unrestricted', uiGroup: 'general',
    options: [
      { label: 'Unrestricted', value: 'unrestricted' },
      { label: 'Restricted', value: 'restricted' },
    ] },
  { key: 'checkpointingEnabled', label: 'Rewind code (checkpoints)', type: 'boolean', defaultValue: true, uiGroup: 'general' },

  // ── Effort ──
  { key: 'env.CLAUDE_CODE_EFFORT_LEVEL', label: 'Reasoning effort', type: 'select', defaultValue: '', uiGroup: 'general',
    description: 'Overrides CLAUDE_CODE_EFFORT_LEVEL — empty = Claude Code default',
    options: [
      { label: 'Default (auto)', value: '' },
      { label: 'Low', value: 'low' },
      { label: 'Medium', value: 'medium' },
      { label: 'High', value: 'high' },
      { label: 'Max', value: 'max' },
    ] },

  // ── Permissions ──
  { key: 'permissions.defaultMode', label: 'Default permission mode', type: 'select', defaultValue: 'manual', uiGroup: 'general',
    options: [
      { label: 'Manual', value: 'manual' },
      { label: 'Auto', value: 'auto' },
      { label: 'Accept Edits', value: 'acceptEdits' },
      { label: 'Bypass', value: 'bypassPermissions' },
    ] },
  { key: 'worktree.baseRef', label: 'Worktree base ref', type: 'select', defaultValue: 'fresh', uiGroup: 'general',
    options: [
      { label: 'Fresh', value: 'fresh' },
      { label: 'Head', value: 'head' },
      { label: 'Main', value: 'main' },
    ] },

  // ── Misc ──
  { key: 'skipWorkflowUsageWarning', label: 'Skip workflow usage warning', type: 'boolean', defaultValue: false, uiGroup: 'general' },
  { key: 'inputNeededNotifEnabled', label: 'Input needed notifications', type: 'boolean', defaultValue: false, uiGroup: 'general' },
  { key: 'agentPushNotifEnabled', label: 'Agent push notifications', type: 'boolean', defaultValue: false, uiGroup: 'general' },
];

export const CLAUDE_SETTING_DEFAULTS: Record<string, boolean | string> = {};
for (const def of CLAUDE_SETTING_DEFINITIONS) {
  CLAUDE_SETTING_DEFAULTS[def.key] = def.defaultValue;
}
