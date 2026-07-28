import { useState } from 'react';
import { X, Plus, Eye, EyeOff, Key, Activity, Globe, ChevronRight, Sliders, Cloud, Link2 } from 'lucide-react';
import { useSettingsStore } from '../../store/settingsStore';
import { ClaudeSettingsPage } from './ClaudeSettingsPage';

interface SettingsModalProps {
  onClose: () => void;
}

type SettingsPage = 'api-keys' | 'display' | 'claude' | 'azure-devops';

const PAGES: { id: SettingsPage; label: string; icon: React.ReactNode }[] = [
  { id: 'api-keys', label: 'API Keys', icon: <Key size={15} /> },
  { id: 'display', label: 'Display', icon: <Activity size={15} /> },
  { id: 'claude', label: 'Claude Code', icon: <Sliders size={15} /> },
  { id: 'azure-devops', label: 'Azure DevOps', icon: <Cloud size={15} /> },
];

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [page, setPage] = useState<SettingsPage>('api-keys');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-2xl w-[580px] h-[440px] flex overflow-hidden">
        {/* ── Left sidebar ── */}
        <div className="w-44 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-bg)]/50 flex flex-col">
          <div className="px-3 py-3 border-b border-[var(--color-border)]">
            <h2 className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest">Settings</h2>
          </div>
          <nav className="flex-1 py-1">
            {PAGES.map((p) => (
              <button
                key={p.id}
                onClick={() => setPage(p.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-[13px] transition-colors ${
                  page === p.id
                    ? 'text-[var(--color-text)] bg-[var(--color-surface-hover)] border-r-2 border-accent-500'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]/50'
                }`}
              >
                <span className={page === p.id ? 'text-accent-500' : ''}>{p.icon}</span>
                {p.label}
              </button>
            ))}
          </nav>
        </div>

        {/* ── Right content ── */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] shrink-0">
            <div className="flex items-center gap-1.5 text-[13px] text-[var(--color-text)]">
              <ChevronRight size={12} className="text-[var(--color-text-muted)]" />
              <span className="font-medium">{PAGES.find(p => p.id === page)?.label}</span>
            </div>
            <button onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] rounded-md p-1 transition-colors">
              <X size={15} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {page === 'api-keys' && <ApiKeysPage />}
            {page === 'display' && <DisplayPage />}
            {page === 'claude' && <ClaudeSettingsPage />}
            {page === 'azure-devops' && <AzureDevOpsSettingsPage />}
          </div>

          <div className="px-4 py-2.5 border-t border-[var(--color-border)] shrink-0 bg-[var(--color-bg)]/50 flex justify-between items-center">
            <span className="text-[10px] text-[var(--color-text-muted)]">Keys stored locally in your browser</span>
            <button onClick={onClose} className="px-3.5 py-1.5 bg-accent-600 hover:bg-accent-500 text-white rounded-md text-xs font-medium transition-colors shadow-sm">
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ==================== API Keys Page ====================

function ApiKeysPage() {
  const {
    anthropicApiKey, deepseekApiKey, deepseekBaseUrl,
    setAnthropicApiKey, setDeepseekApiKey, setDeepseekBaseUrl,
  } = useSettingsStore();

  const [showAnthropicKey, setShowAnthropicKey] = useState(false);
  const [showDeepseekKey, setShowDeepseekKey] = useState(false);

  return (
    <div className="space-y-5">
      {/* Anthropic */}
      <div>
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-xs font-semibold text-[var(--color-text)]">Anthropic</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--color-surface-hover)] text-[var(--color-text-muted)]">Claude</span>
        </div>
        <p className="text-[11px] text-[var(--color-text-muted)] mb-2.5">Used for all Claude models</p>

        <label className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wide block mb-1.5">API Key</label>
        <ApiKeyInput
          placeholder="sk-ant-..."
          value={anthropicApiKey}
          onChange={setAnthropicApiKey}
          show={showAnthropicKey}
          onToggleShow={() => setShowAnthropicKey(!showAnthropicKey)}
        />
      </div>

      <div className="border-t border-[var(--color-border)]/40" />

      {/* DeepSeek */}
      <div>
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-xs font-semibold text-[var(--color-text)]">DeepSeek</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--color-surface-hover)] text-[var(--color-text-muted)]">via Anthropic API</span>
        </div>
        <p className="text-[11px] text-[var(--color-text-muted)] mb-2.5">Routes through Claude Code with Anthropic-compatible endpoint</p>

        <label className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wide block mb-1.5">API Key</label>
        <ApiKeyInput
          placeholder="sk-..."
          value={deepseekApiKey}
          onChange={setDeepseekApiKey}
          show={showDeepseekKey}
          onToggleShow={() => setShowDeepseekKey(!showDeepseekKey)}
        />

        <div className="mt-3">
          <label className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wide block mb-1.5">
            <Globe size={11} className="inline mr-1" />
            Base URL
          </label>
          <input
            type="text"
            value={deepseekBaseUrl}
            onChange={(e) => setDeepseekBaseUrl(e.target.value)}
            placeholder="https://api.deepseek.com/anthropic"
            spellCheck={false}
            className="w-full px-3 py-2 text-[13px] bg-[var(--color-input-bg)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] focus:outline-none focus:border-accent-500 transition-colors font-mono placeholder:text-[var(--color-text-muted)]/40"
          />
        </div>
      </div>
    </div>
  );
}

function ApiKeyInput({
  placeholder, value, onChange, show, onToggleShow,
}: {
  placeholder: string; value: string;
  onChange: (val: string) => void; show: boolean;
  onToggleShow: () => void;
}) {
  return (
    <div className="flex gap-1.5">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        className="flex-1 px-3 py-2 text-[13px] bg-[var(--color-input-bg)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] focus:outline-none focus:border-accent-500 transition-colors font-mono placeholder:text-[var(--color-text-muted)]/40"
      />
      <button
        onClick={onToggleShow}
        className={`px-2.5 rounded-lg border border-[var(--color-border)] transition-colors ${
          show ? 'text-accent-500 bg-accent-500/10 border-accent-500/30' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
        }`}
        title={show ? 'Hide' : 'Show'}
      >
        {show ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
}

// ==================== Display Page ====================

function DisplayPage() {
  const {
    showActivity, setShowActivity,
    autoTitleEnabled, setAutoTitleEnabled,
    autoTitleTiers, setAutoTitleTiers,
  } = useSettingsStore();

  const updateTier = (index: number, field: 'upTo' | 'every', value: number) => {
    const next = autoTitleTiers.map((t, i) => i === index ? { ...t, [field]: value } : t);
    setAutoTitleTiers(next);
  };

  const removeTier = (index: number) => {
    if (autoTitleTiers.length <= 1) return; // keep at least 1 tier
    const next = autoTitleTiers.filter((_, i) => i !== index);
    setAutoTitleTiers(next);
  };

  const addTier = () => {
    const last = autoTitleTiers[autoTitleTiers.length - 1];
    const newUpTo = last ? last.upTo * 2 : 40;
    const newEvery = last ? Math.min(last.every * 2, 50) : 10;
    // Insert before the last infinite row — wait, there's no infinite row.
    // Just append, and the last row's upTo defines its range.
    // Actually, let's insert before last so the new tier splits the range.
    const insertAt = autoTitleTiers.length - 1;
    const prevUpTo = insertAt > 0 ? autoTitleTiers[insertAt - 1].upTo : 0;
    const midUpTo = prevUpTo + Math.floor((autoTitleTiers[insertAt].upTo - prevUpTo) / 2);
    const next = [...autoTitleTiers];
    next.splice(insertAt, 0, { upTo: midUpTo, every: Math.max(1, Math.floor(autoTitleTiers[insertAt].every / 2)) });
    setAutoTitleTiers(next);
  };

  const isLastTier = (index: number) => index === autoTitleTiers.length - 1;

  return (
    <div className="space-y-6">
      {/* ── Activity Log ── */}
      <div>
        <span className="text-xs font-semibold text-[var(--color-text)]">Activity Log</span>
        <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">Shows tool executions, file operations, and commands in a bottom panel</p>

        <label className="flex items-center gap-3 cursor-pointer mt-2.5">
          <button
            onClick={() => setShowActivity(!showActivity)}
            className={`relative w-9 h-5 rounded-full transition-colors ${
              showActivity ? 'bg-accent-500' : 'bg-[var(--color-border)]'
            }`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
              showActivity ? 'translate-x-4' : ''
            }`} />
          </button>
          <span className="text-[13px] text-[var(--color-text)]">{showActivity ? 'Enabled' : 'Disabled'}</span>
        </label>
      </div>

      <div className="border-t border-[var(--color-border)]/40" />

      {/* ── Auto Chat Titles ── */}
      <div>
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-xs font-semibold text-[var(--color-text)]">Auto Chat Titles</span>
          <label className="flex items-center gap-2 cursor-pointer">
            <button
              onClick={() => setAutoTitleEnabled(!autoTitleEnabled)}
              className={`relative w-9 h-5 rounded-full transition-colors ${
                autoTitleEnabled ? 'bg-accent-500' : 'bg-[var(--color-border)]'
              }`}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                autoTitleEnabled ? 'translate-x-4' : ''
              }`} />
            </button>
            <span className="text-[13px] text-[var(--color-text)]">{autoTitleEnabled ? 'On' : 'Off'}</span>
          </label>
        </div>
        <p className="text-[11px] text-[var(--color-text-muted)]">
          Uses AI (Haiku / Flash) to generate a descriptive title. Add boundaries to control how often titles update as the conversation grows.
        </p>

        {autoTitleEnabled && (
          <div className="mt-3 pl-2 border-l-2 border-[var(--color-border)] space-y-1.5">
            {/* Header */}
            <div className="flex items-center gap-2 text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider px-2 pb-1">
              <span className="w-20 text-center">up to</span>
              <span className="flex-1" />
              <span className="w-20 text-center">every</span>
              <span className="w-7" />
            </div>

            {/* Rows */}
            {autoTitleTiers.map((tier, i) => (
              <div key={i} className="flex items-center gap-2">
                {isLastTier(i) ? (
                  <>
                    <span className="w-20 text-center text-[12px] text-[var(--color-text-muted)] italic">Beyond</span>
                    <span className="text-[var(--color-text-muted)] text-[12px]">—</span>
                  </>
                ) : (
                  <>
                    <input
                      type="number"
                      min={1}
                      max={99999}
                      step={1}
                      value={tier.upTo}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        if (!isNaN(val) && val >= 1) updateTier(i, 'upTo', val);
                      }}
                      className="w-20 px-2 py-1.5 text-[13px] bg-[var(--color-input-bg)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] focus:outline-none focus:border-accent-500 transition-colors text-center"
                    />
                    <span className="text-[var(--color-text-muted)] text-[12px]">messages</span>
                  </>
                )}
                <span className="text-[12px] text-[var(--color-text-muted)] ml-auto">every</span>
                <input
                  type="number"
                  min={1}
                  max={200}
                  step={1}
                  value={tier.every}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (!isNaN(val) && val >= 1 && val <= 200) updateTier(i, 'every', val);
                  }}
                  className="w-16 px-2 py-1.5 text-[13px] bg-[var(--color-input-bg)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] focus:outline-none focus:border-accent-500 transition-colors text-center"
                />
                <span className="text-[12px] text-[var(--color-text-muted)]">msgs</span>
                <button
                  onClick={() => removeTier(i)}
                  disabled={autoTitleTiers.length <= 1}
                  className="w-7 h-7 flex items-center justify-center rounded-md text-[var(--color-text-muted)] hover:text-red-500 hover:bg-red-500/10 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                  title="Remove boundary"
                >
                  <X size={13} />
                </button>
              </div>
            ))}

            {/* Add button */}
            <button
              onClick={addTier}
              className="flex items-center gap-1 text-[12px] text-accent-500 hover:text-accent-400 transition-colors px-1 py-1"
            >
              <Plus size={12} />
              Add boundary
            </button>

            <p className="text-[10px] text-[var(--color-text-muted)] italic pt-1">
              The first title generates after 2 messages. The interval from the first matching boundary is used.
              The last row applies to all messages beyond the previous boundaries.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ==================== Azure DevOps Settings Page ====================

function AzureDevOpsSettingsPage() {
  const {
    azureDevopsOrgUrl, azureDevopsPat, azureDevopsProject, azureDevopsRepository,
    azureDevopsConnected, azureDevopsConnectionError,
    setAzureDevopsOrgUrl, setAzureDevopsPat, setAzureDevopsProject, setAzureDevopsRepository,
    connectAzureDevops, disconnectAzureDevops,
  } = useSettingsStore();

  const [showPat, setShowPat] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const handleConnect = async () => {
    setConnecting(true);
    await connectAzureDevops();
    setConnecting(false);
  };

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2 mb-0.5">
          <Cloud size={14} className="text-accent-500" />
          <span className="text-xs font-semibold text-[var(--color-text)]">Azure DevOps Connection</span>
        </div>
        <p className="text-[11px] text-[var(--color-text-muted)] mb-2.5">
          Connect to your Azure DevOps organization to browse repositories, pull requests, and branches.
        </p>

        {/* Organization URL */}
        <label className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wide block mb-1.5">
          <Link2 size={11} className="inline mr-1" />
          Organization URL
        </label>
        <input
          type="text"
          value={azureDevopsOrgUrl}
          onChange={(e) => setAzureDevopsOrgUrl(e.target.value)}
          placeholder="https://dev.azure.com/myorg"
          spellCheck={false}
          className="w-full px-3 py-2 text-[13px] bg-[var(--color-input-bg)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] focus:outline-none focus:border-accent-500 transition-colors font-mono placeholder:text-[var(--color-text-muted)]/40 mb-3"
        />

        {/* PAT */}
        <label className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wide block mb-1.5">
          <Key size={11} className="inline mr-1" />
          Personal Access Token (PAT)
        </label>
        <ApiKeyInput
          placeholder="..."
          value={azureDevopsPat}
          onChange={setAzureDevopsPat}
          show={showPat}
          onToggleShow={() => setShowPat(!showPat)}
        />

        <p className="text-[10px] text-[var(--color-text-muted)] mt-1.5">
          Create a PAT in Azure DevOps with <code className="text-accent-400 bg-accent-500/10 px-1 rounded">Code (Read & Write)</code> scope.
        </p>
      </div>

      <div className="border-t border-[var(--color-border)]/40" />

      {/* Default Project & Repository */}
      <div>
        <span className="text-xs font-semibold text-[var(--color-text)]">Default Project & Repository</span>
        <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5 mb-3">
          Optional — pre-select a project and repo when opening the panel.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wide block mb-1.5">Project</label>
            <input
              type="text"
              value={azureDevopsProject}
              onChange={(e) => setAzureDevopsProject(e.target.value)}
              placeholder="e.g. MyProject"
              spellCheck={false}
              className="w-full px-3 py-2 text-[13px] bg-[var(--color-input-bg)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] focus:outline-none focus:border-accent-500 transition-colors placeholder:text-[var(--color-text-muted)]/40"
            />
          </div>
          <div>
            <label className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wide block mb-1.5">Repository</label>
            <input
              type="text"
              value={azureDevopsRepository}
              onChange={(e) => setAzureDevopsRepository(e.target.value)}
              placeholder="e.g. MyRepo"
              spellCheck={false}
              className="w-full px-3 py-2 text-[13px] bg-[var(--color-input-bg)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] focus:outline-none focus:border-accent-500 transition-colors placeholder:text-[var(--color-text-muted)]/40"
            />
          </div>
        </div>
      </div>

      <div className="border-t border-[var(--color-border)]/40" />

      {/* Connect / Disconnect */}
      <div className="flex items-center justify-between">
        <div>
          {azureDevopsConnected ? (
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[12px] text-emerald-500 font-medium">Connected</span>
            </div>
          ) : (
            <span className="text-[12px] text-[var(--color-text-muted)]">Not connected</span>
          )}
          {azureDevopsConnectionError && !azureDevopsConnected && (
            <p className="text-[11px] text-red-400 mt-0.5 max-w-xs break-words">{azureDevopsConnectionError}</p>
          )}
        </div>

        {azureDevopsConnected ? (
          <button
            onClick={disconnectAzureDevops}
            className="px-3 py-1.5 border border-red-500/30 text-red-400 hover:bg-red-500/10 rounded-md text-xs font-medium transition-colors"
          >
            Disconnect
          </button>
        ) : (
          <button
            onClick={handleConnect}
            disabled={connecting || !azureDevopsOrgUrl || !azureDevopsPat}
            className="px-4 py-1.5 bg-accent-600 hover:bg-accent-500 disabled:bg-[var(--color-border)] disabled:text-[var(--color-text-muted)] disabled:cursor-not-allowed text-white rounded-md text-xs font-medium transition-colors shadow-sm"
          >
            {connecting ? 'Connecting...' : 'Connect'}
          </button>
        )}
      </div>
    </div>
  );
}
