import { ALL_MODELS, useSettingsStore } from '../../store/settingsStore';

export interface ChatToolbarProps {
  permissionMode: string;
  onPermissionModeChange: (mode: string) => void;
  selectedModel: string;
  onModelChange: (model: string) => void;
  selectedEffort: string;
  onEffortChange: (effort: string) => void;
}

export function ChatToolbar({
  permissionMode,
  onPermissionModeChange,
  selectedModel,
  onModelChange,
  selectedEffort,
  onEffortChange,
}: ChatToolbarProps) {
  const anthropicApiKey = useSettingsStore((s) => s.anthropicApiKey);
  const deepseekApiKey = useSettingsStore((s) => s.deepseekApiKey);
  const hasKey = (provider: string) => provider === 'anthropic' ? !!anthropicApiKey : !!deepseekApiKey;

  const selectClass = "text-[12px] bg-[var(--color-input-bg)] border border-[var(--color-border)] rounded-md px-2 py-1 text-[var(--color-text)] focus:outline-none focus:border-accent-500 transition-colors";

  return (
    <div className="flex gap-3 mb-2 items-center">
      <select value={permissionMode} onChange={(e) => onPermissionModeChange(e.target.value)} className={selectClass}>
        <option value="default">🛡️ Manual (default)</option>
        <option value="acceptEdits">✏️ Auto-approve edits</option>
        <option value="auto">🤖 Auto</option>
        <option value="plan">📋 Plan only</option>
        <option value="dontAsk">🚫 Deny all</option>
        <option value="bypassPermissions">🔓 Auto-approve all</option>
      </select>
      <select value={selectedModel} onChange={(e) => onModelChange(e.target.value)} className={`${selectClass} min-w-0`}>
        {ALL_MODELS.map((m) => (
          <option key={m.id} value={m.id} disabled={!hasKey(m.provider)}>
            {m.label}{!hasKey(m.provider) ? ' (no key)' : ''}
          </option>
        ))}
      </select>
      <select value={selectedEffort} onChange={(e) => onEffortChange(e.target.value)} className={selectClass} title="Reasoning effort">
        <option value="">🎯 Effort: auto</option>
        <option value="low">🎯 Effort: low</option>
        <option value="medium">🎯 Effort: medium</option>
        <option value="high">🎯 Effort: high</option>
        <option value="max">🎯 Effort: max</option>
      </select>
    </div>
  );
}
