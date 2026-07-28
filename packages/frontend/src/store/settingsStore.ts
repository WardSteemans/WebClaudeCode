import { create } from 'zustand';
import { ClaudeCodeSettings, CLAUDE_SETTING_DEFAULTS, ALL_MODELS, deepGet, deepSet, deepDelete } from '@cc-gui/shared';
import type { ModelOption } from '@cc-gui/shared';
import { safeGetItem } from '../lib/storage';

// ==================== Model Catalog ====================

export type { ModelOption };
export { ALL_MODELS };

export interface AutoTitleTier {
  upTo: number;
  every: number;
}

export const DEFAULT_AUTO_TITLE_TIERS: AutoTitleTier[] = [
  { upTo: 20, every: 5 },
  { upTo: 200, every: 25 },
];

// ==================== API helpers ====================

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function debouncedSave(settings: Record<string, string>) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    }).catch((err) => { console.warn('Failed to load settings', err); });
  }, 300);
}

export async function loadSettingsFromDb(): Promise<Record<string, string>> {
  try {
    const res = await fetch('/api/settings');
    if (res.ok) return await res.json();
  } catch {}
  // Fallback: migrate from localStorage (one-time)
  const legacy: Record<string, string> = {};
  const anthropic = safeGetItem('cc-gui-settings-anthropicKey');
  const deepseek = safeGetItem('cc-gui-settings-deepseekKey');
  const baseUrl = safeGetItem('cc-gui-settings-deepseekBaseUrl');
  const activity = safeGetItem('cc-gui-settings-showActivity');
  if (anthropic) legacy.anthropicApiKey = anthropic;
  if (deepseek) legacy.deepseekApiKey = deepseek;
  if (baseUrl) legacy.deepseekBaseUrl = baseUrl;
  if (activity) legacy.showActivity = activity;
  // Also try legacy Zustand persist key
  try {
    const raw = safeGetItem('cc-gui-settings');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.state) Object.assign(legacy, {
        anthropicApiKey: parsed.state.anthropicApiKey || legacy.anthropicApiKey || '',
        deepseekApiKey: parsed.state.deepseekApiKey || legacy.deepseekApiKey || '',
        deepseekBaseUrl: parsed.state.deepseekBaseUrl || legacy.deepseekBaseUrl || '',
        showActivity: String(parsed.state.showActivity ?? legacy.showActivity ?? 'true'),
      });
    }
  } catch {}
  // Save migrated data to DB
  if (Object.keys(legacy).length > 0) {
    debouncedSave(legacy);
  }
  return legacy;
}

// ==================== Store ====================

interface SettingsState {
  anthropicApiKey: string;
  deepseekApiKey: string;
  deepseekBaseUrl: string;
  apiProxyUrl: string;
  apiRouterInsecureTls: boolean;
  showActivity: boolean;
  autoTitleEnabled: boolean;
  autoTitleTiers: AutoTitleTier[];
  loaded: boolean;

  // Azure DevOps
  azureDevopsOrgUrl: string;
  azureDevopsPat: string;
  azureDevopsProject: string;
  azureDevopsRepository: string;
  azureDevopsConnected: boolean;
  azureDevopsConnectionError: string | null;
  azureDevopsUserName: string;
  azureDevopsUserId: string;

  // Claude Code settings
  claudeSettings: ClaudeCodeSettings;
  claudeSettingsLoaded: boolean;

  setAnthropicApiKey: (key: string) => void;
  setDeepseekApiKey: (key: string) => void;
  setDeepseekBaseUrl: (url: string) => void;
  setApiProxyUrl: (url: string) => void;
  setApiRouterInsecureTls: (enabled: boolean) => void;
  setShowActivity: (show: boolean) => void;
  setAutoTitleEnabled: (enabled: boolean) => void;
  setAutoTitleTiers: (tiers: AutoTitleTier[]) => void;
  loadFromDb: () => Promise<void>;

  // Azure DevOps settings
  setAzureDevopsOrgUrl: (url: string) => void;
  setAzureDevopsPat: (pat: string) => void;
  setAzureDevopsProject: (project: string) => void;
  setAzureDevopsRepository: (repo: string) => void;
  connectAzureDevops: () => Promise<boolean>;
  disconnectAzureDevops: () => void;

  // Claude Code settings actions
  loadClaudeSettings: () => Promise<void>;
  saveClaudeSetting: (key: string, value: unknown) => Promise<void>;
  getClaudeSetting: (key: string) => any;
  resetClaudeSetting: (key: string) => Promise<void>;

  getEnvVarsForModel: (modelId: string) => Record<string, string>;
  hasKey: (provider: 'anthropic' | 'deepseek') => boolean;
  getAvailableModels: () => ModelOption[];
}

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  anthropicApiKey: '',
  deepseekApiKey: '',
  deepseekBaseUrl: 'https://api.deepseek.com/anthropic',
  apiProxyUrl: '',
  apiRouterInsecureTls: false,
  showActivity: true,
  autoTitleEnabled: true,
  autoTitleTiers: [...DEFAULT_AUTO_TITLE_TIERS],
  loaded: false,

  azureDevopsOrgUrl: '',
  azureDevopsPat: '',
  azureDevopsProject: '',
  azureDevopsRepository: '',
  azureDevopsConnected: false,
  azureDevopsConnectionError: null,
  azureDevopsUserName: '',
  azureDevopsUserId: '',

  claudeSettings: {},
  claudeSettingsLoaded: false,

  loadClaudeSettings: async () => {
    try {
      const res = await fetch('/api/claude-settings');
      if (res.ok) {
        const data = await res.json();
        set({ claudeSettings: data as ClaudeCodeSettings, claudeSettingsLoaded: true });
      }
    } catch { /* Claude Code may not be installed */ }
  },

  saveClaudeSetting: async (key, value) => {
    const current = get().claudeSettings as Record<string, unknown>;
    // Build the delta to send
    const delta: Record<string, unknown> = {};
    const keys = key.split('.');
    if (keys.length === 1) {
      delta[key] = value;
    } else {
      let d: Record<string, unknown> = delta;
      for (let i = 0; i < keys.length - 1; i++) {
        d[keys[i]] = {};
        d = d[keys[i]] as Record<string, unknown>;
      }
      d[keys[keys.length - 1]] = value;
    }

    // Optimistic local update
    const next = deepSet(current, key, value);
    set({ claudeSettings: next as unknown as ClaudeCodeSettings });

    try {
      await fetch('/api/claude-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(delta),
      });
    } catch { /* ignore */ }
  },

  getClaudeSetting: (key) => {
    const val = deepGet(get().claudeSettings as Record<string, unknown>, key);
    if (val !== undefined) return val;
    return CLAUDE_SETTING_DEFAULTS[key];
  },

  resetClaudeSetting: async (key) => {
    const current = get().claudeSettings as Record<string, unknown>;
    const next = deepDelete(current, key);
    set({ claudeSettings: next as unknown as ClaudeCodeSettings });

    // Send null to delete
    const delta: Record<string, unknown> = {};
    const keys = key.split('.');
    if (keys.length === 1) {
      delta[key] = null;
    } else {
      let d: Record<string, unknown> = delta;
      for (let i = 0; i < keys.length - 1; i++) {
        d[keys[i]] = {};
        d = d[keys[i]] as Record<string, unknown>;
      }
      d[keys[keys.length - 1]] = null;
    }

    try {
      await fetch('/api/claude-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(delta),
      });
    } catch { /* ignore */ }
  },

  setAnthropicApiKey: (key) => {
    set({ anthropicApiKey: key.trim() });
    debouncedSave(toSettings(get()));
  },
  setDeepseekApiKey: (key) => {
    set({ deepseekApiKey: key.trim() });
    debouncedSave(toSettings(get()));
  },
  setDeepseekBaseUrl: (url) => {
    set({ deepseekBaseUrl: url });
    debouncedSave(toSettings(get()));
  },
  setApiProxyUrl: (url) => {
    set({ apiProxyUrl: url });
    debouncedSave(toSettings(get()));
  },
  setApiRouterInsecureTls: (enabled) => {
    set({ apiRouterInsecureTls: enabled });
    debouncedSave(toSettings(get()));
  },
  setShowActivity: (show) => {
    set({ showActivity: show });
    debouncedSave(toSettings(get()));
  },

  setAutoTitleEnabled: (enabled) => {
    set({ autoTitleEnabled: enabled });
    debouncedSave(toSettings(get()));
  },

  setAutoTitleTiers: (tiers) => {
    set({ autoTitleTiers: tiers });
    debouncedSave(toSettings(get()));
  },

  loadFromDb: async () => {
    const data = await loadSettingsFromDb();
    set({
      anthropicApiKey: data.anthropicApiKey || '',
      deepseekApiKey: data.deepseekApiKey || '',
      deepseekBaseUrl: data.deepseekBaseUrl || 'https://api.deepseek.com/anthropic',
      apiProxyUrl: data.apiProxyUrl || '',
      apiRouterInsecureTls: data.apiRouterInsecureTls === 'true',
      showActivity: data.showActivity !== 'false',
      autoTitleEnabled: data.autoTitleEnabled !== 'false',
      autoTitleTiers: (() => {
        try { const p = JSON.parse(data.autoTitleTiers || 'null'); return Array.isArray(p) ? p : null; } catch { return null; }
      })() || [...DEFAULT_AUTO_TITLE_TIERS],
      azureDevopsOrgUrl: data.azureDevopsOrgUrl || '',
      azureDevopsPat: data.azureDevopsPat || '',
      azureDevopsProject: data.azureDevopsProject || '',
      azureDevopsRepository: data.azureDevopsRepository || '',
      azureDevopsUserName: data.azureDevopsUserName || '',
      azureDevopsUserId: data.azureDevopsUserId || '',
      loaded: true,
    });
  },

  getEnvVarsForModel: (modelId) => {
    const s = get();
    const model = ALL_MODELS.find(m => m.id === modelId);
    const subModel = model?.subagentModel || 'claude-3-5-haiku-20241022';

    // Read effort from Claude settings env, or default for DeepSeek
    const effort = s.claudeSettings?.env?.CLAUDE_CODE_EFFORT_LEVEL;

    if (model?.provider === 'deepseek') {
      // Route through our built-in proxy for automatic image→vision processing.
      // Default assumes backend on localhost:3001. Override via apiProxyUrl setting.
      const proxyUrl = s.apiProxyUrl || 'http://localhost:3001/api/proxy';
      return {
        ANTHROPIC_BASE_URL: proxyUrl,
        ANTHROPIC_API_KEY: s.deepseekApiKey,
        ANTHROPIC_MODEL: modelId,
        ANTHROPIC_DEFAULT_SONNET_MODEL: modelId,
        ANTHROPIC_DEFAULT_OPUS_MODEL: modelId,
        ANTHROPIC_DEFAULT_HAIKU_MODEL: subModel,
        CLAUDE_CODE_SUBAGENT_MODEL: subModel,
        CLAUDE_CODE_EFFORT_LEVEL: effort || 'max',
      };
    }
    const env: Record<string, string> = {};
    if (s.anthropicApiKey) env.ANTHROPIC_API_KEY = s.anthropicApiKey;
    if (effort) env.CLAUDE_CODE_EFFORT_LEVEL = effort;
    return env;
  },

  hasKey: (provider) => {
    const s = get();
    return provider === 'anthropic' ? !!s.anthropicApiKey : !!s.deepseekApiKey;
  },

  getAvailableModels: () => {
    const s = get();
    return ALL_MODELS.filter(m => s.hasKey(m.provider));
  },

  // ── Azure DevOps ──

  setAzureDevopsOrgUrl: (url) => {
    set({ azureDevopsOrgUrl: url });
    debouncedSave(toSettings(get()));
  },
  setAzureDevopsPat: (pat) => {
    set({ azureDevopsPat: pat });
    debouncedSave(toSettings(get()));
  },
  setAzureDevopsProject: (project) => {
    set({ azureDevopsProject: project });
    debouncedSave(toSettings(get()));
  },
  setAzureDevopsRepository: (repo) => {
    set({ azureDevopsRepository: repo });
    debouncedSave(toSettings(get()));
  },

  connectAzureDevops: async () => {
    const s = get();
    if (!s.azureDevopsOrgUrl || !s.azureDevopsPat) {
      set({ azureDevopsConnected: false, azureDevopsConnectionError: 'Please provide org URL and PAT' });
      return false;
    }
    try {
      const res = await fetch('/api/azure-devops/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgUrl: s.azureDevopsOrgUrl, pat: s.azureDevopsPat }),
      });
      const data = await res.json();
      const connected = data.connected === true;
      const userName = data.user?.name || '';
      const userId = data.user?.id || '';
      set({
        azureDevopsConnected: connected,
        azureDevopsConnectionError: data.error || null,
        azureDevopsUserName: userName,
        azureDevopsUserId: userId,
      });
      return connected;
    } catch (err) {
      set({ azureDevopsConnected: false, azureDevopsConnectionError: err instanceof Error ? err.message : 'Unknown error' });
      return false;
    }
  },

  disconnectAzureDevops: () => {
    fetch('/api/azure-devops/disconnect', { method: 'POST' }).catch((err) => { console.warn('Failed to disconnect Azure DevOps', err); });
    set({ azureDevopsConnected: false, azureDevopsConnectionError: null });
  },
}));

function toSettings(s: SettingsState): Record<string, string> {
  return {
    anthropicApiKey: s.anthropicApiKey,
    deepseekApiKey: s.deepseekApiKey,
    deepseekBaseUrl: s.deepseekBaseUrl,
    apiProxyUrl: s.apiProxyUrl,
    apiRouterInsecureTls: String(s.apiRouterInsecureTls),
    showActivity: String(s.showActivity),
    autoTitleEnabled: String(s.autoTitleEnabled),
    autoTitleTiers: JSON.stringify(s.autoTitleTiers),
    azureDevopsOrgUrl: s.azureDevopsOrgUrl,
    azureDevopsPat: s.azureDevopsPat,
    azureDevopsProject: s.azureDevopsProject,
    azureDevopsRepository: s.azureDevopsRepository,
  };
}
