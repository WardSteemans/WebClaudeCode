import { RefreshCw, RotateCcw } from 'lucide-react';
import { useSettingsStore } from '../store/settingsStore';
import { CLAUDE_SETTING_DEFINITIONS, CLAUDE_SETTING_DEFAULTS, type SettingDefinition } from '@cc-gui/shared';

export function ClaudeSettingsPage() {
  const claudeSettings = useSettingsStore(s => s.claudeSettings);
  const claudeSettingsLoaded = useSettingsStore(s => s.claudeSettingsLoaded);
  const loadClaudeSettings = useSettingsStore(s => s.loadClaudeSettings);
  const saveClaudeSetting = useSettingsStore(s => s.saveClaudeSetting);
  const resetClaudeSetting = useSettingsStore(s => s.resetClaudeSetting);
  const getClaudeSetting = useSettingsStore(s => s.getClaudeSetting);

  const groups = [
    { id: 'general', label: 'General' },
    { id: 'interface', label: 'Interface' },
    { id: 'editor', label: 'Editor' },
  ];

  function isDefault(key: string): boolean {
    const val = claudeSettings[key];
    if (val === undefined || val === null) return true;
    // Check nested keys
    const keys = key.split('.');
    let current: any = claudeSettings;
    for (const k of keys) {
      if (current == null || !(k in current)) return true;
      current = current[k];
    }
    return false;
  }

  function renderSetting(def: SettingDefinition) {
    const value = getClaudeSetting(def.key);
    const isDefaultVal = isDefault(def.key);

    return (
      <div key={def.key} className="flex items-center justify-between py-2 group">
        <div className="flex-1 min-w-0 mr-3">
          <div className="flex items-center gap-1.5">
            <span className="text-[13px] text-[var(--color-text)]">{def.label}</span>
            {!isDefaultVal && (
              <span className="w-1.5 h-1.5 rounded-full bg-accent-500 flex-shrink-0" title="Modified" />
            )}
          </div>
          {def.description && (
            <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">{def.description}</p>
          )}
        </div>

        {/* Boolean toggle */}
        {def.type === 'boolean' && (
          <div className="flex items-center gap-1">
            {!isDefaultVal && (
              <button
                onClick={() => resetClaudeSetting(def.key)}
                className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] opacity-0 group-hover:opacity-100 transition-opacity"
                title="Reset to default"
              >
                <RotateCcw size={12} />
              </button>
            )}
            <button
              onClick={() => saveClaudeSetting(def.key, !value)}
              className={`relative w-9 h-5 rounded-full transition-colors ${
                value ? 'bg-accent-500' : 'bg-[var(--color-border)]'
              }`}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                value ? 'translate-x-4' : ''
              }`} />
            </button>
          </div>
        )}

        {/* Select/dropdown */}
        {def.type === 'select' && def.options && (
          <div className="flex items-center gap-1">
            {!isDefaultVal && (
              <button
                onClick={() => resetClaudeSetting(def.key)}
                className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] opacity-0 group-hover:opacity-100 transition-opacity"
                title="Reset to default"
              >
                <RotateCcw size={12} />
              </button>
            )}
            <select
              value={String(value)}
              onChange={(e) => {
                const v = e.target.value;
                // Convert "true"/"false" strings for boolean-like selects
                saveClaudeSetting(def.key, v);
              }}
              className="text-[12px] bg-[var(--color-input-bg)] border border-[var(--color-border)] rounded-md px-2 py-1 text-[var(--color-text)] focus:outline-none focus:border-accent-500 cursor-pointer"
            >
              {def.options.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header with refresh */}
      <div className="flex items-center justify-between">
        <div>
          <span className="text-xs font-semibold text-[var(--color-text)]">Claude Code Settings</span>
          <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
            Reads from ~/.claude/settings.json — changes apply live
          </p>
        </div>
        <button
          onClick={loadClaudeSettings}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] bg-[var(--color-surface-hover)] hover:bg-[var(--color-border)] rounded-md transition-colors"
        >
          <RefreshCw size={12} className={claudeSettingsLoaded ? '' : 'animate-spin'} />
          Refresh
        </button>
      </div>

      {/* Dot indicator legend */}
      <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)]">
        <span className="w-1.5 h-1.5 rounded-full bg-accent-500" />
        = modified from default
      </div>

      {/* Settings by group */}
      {groups.map(group => {
        const settings = CLAUDE_SETTING_DEFINITIONS.filter(d => d.uiGroup === group.id);
        if (settings.length === 0) return null;
        return (
          <div key={group.id}>
            <div className="mb-1">
              <span className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest">
                {group.label}
              </span>
            </div>
            <div className="divide-y divide-[var(--color-border)]/30">
              {settings.map(renderSetting)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
