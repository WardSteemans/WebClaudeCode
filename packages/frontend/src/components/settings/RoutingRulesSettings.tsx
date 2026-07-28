import { useState, useEffect, useCallback } from 'react';
import type { RoutingRule } from '@cc-gui/shared';
import { Plus, X, GripVertical, Check, Ban, ArrowRight } from 'lucide-react';

const DEFAULT_RULE: RoutingRule = {
  id: '',
  name: 'New rule',
  enabled: true,
  condition: { field: 'hasImages', operator: 'equals', value: 'true' },
  action: { type: 'forceVision' },
};

const FIELD_OPTIONS = [
  { value: 'hasImages', label: 'Has images' },
  { value: 'model', label: 'Model name' },
  { value: 'content', label: 'Message content' },
];

const OPERATOR_OPTIONS = [
  { value: 'equals', label: '=' },
  { value: 'contains', label: 'contains' },
  { value: 'startsWith', label: 'starts with' },
  { value: 'regex', label: 'regex' },
  { value: 'gt', label: '>' },
  { value: 'lt', label: '<' },
];

const ACTION_OPTIONS = [
  { value: 'setModel', label: 'Set model', needsValue: true, valueLabel: 'Model ID' },
  { value: 'forceVision', label: 'Force vision', needsValue: false },
  { value: 'skipVision', label: 'Skip vision', needsValue: false },
];

export function RoutingRulesSettings() {
  const [rules, setRules] = useState<RoutingRule[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRule, setEditRule] = useState<RoutingRule>(DEFAULT_RULE);
  const [saving, setSaving] = useState(false);

  const fetchRules = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/routing-rules');
      if (res.ok) setRules(await res.json());
    } catch {}
  }, []);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  const saveRules = async (newRules: RoutingRule[]) => {
    setSaving(true);
    await fetch('/api/settings/routing-rules', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newRules),
    });
    setSaving(false);
    fetchRules();
  };

  const toggleRule = (id: string) => {
    saveRules(rules.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r));
  };

  const deleteRule = (id: string) => {
    saveRules(rules.filter(r => r.id !== id));
  };

  const startEdit = (rule?: RoutingRule) => {
    setEditRule(rule ? { ...rule } : { ...DEFAULT_RULE, id: Math.random().toString(36).slice(2, 10) });
    setEditingId(rule?.id || 'new');
  };

  const saveEdit = () => {
    const existing = rules.findIndex(r => r.id === editRule.id);
    if (existing >= 0) {
      saveRules(rules.map(r => r.id === editRule.id ? editRule : r));
    } else {
      saveRules([...rules, editRule]);
    }
    setEditingId(null);
  };

  const actionOpt = ACTION_OPTIONS.find(a => a.value === editRule.action.type);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-semibold text-[var(--color-text)]">Routing Rules</h3>
          <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
            Rules are checked in order. The first matching rule applies.
          </p>
        </div>
        <button
          onClick={() => startEdit()}
          className="flex items-center gap-1 px-2.5 py-1.5 bg-accent-600 hover:bg-accent-500 text-white rounded-md text-[11px] font-medium transition-colors"
        >
          <Plus size={12} /> Add Rule
        </button>
      </div>

      {/* Rule list */}
      <div className="space-y-1.5">
        {rules.length === 0 && !editingId && (
          <div className="text-center text-[11px] text-[var(--color-text-muted)] py-6">
            No routing rules yet. Add one to customize request routing.
          </div>
        )}

        {rules.map((rule, i) => (
          <div
            key={rule.id}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors ${
              rule.enabled
                ? 'border-[var(--color-border)] bg-[var(--color-input-bg)]'
                : 'border-[var(--color-border)]/40 bg-[var(--color-input-bg)]/40 opacity-50'
            }`}
          >
            <GripVertical size={12} className="text-[var(--color-text-muted)] shrink-0" />
            <span className="text-[10px] text-[var(--color-text-muted)] w-5">{i + 1}</span>

            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-medium text-[var(--color-text)] truncate">{rule.name}</div>
              <div className="text-[10px] text-[var(--color-text-muted)] truncate">
                IF {rule.condition.field} {rule.condition.operator} "{rule.condition.value}"
                {' → '}
                {rule.action.type}{rule.action.value ? ` = ${rule.action.value}` : ''}
              </div>
            </div>

            <button
              onClick={() => toggleRule(rule.id)}
              className={`p-1 rounded transition-colors ${rule.enabled ? 'text-emerald-400 hover:bg-emerald-400/10' : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]'}`}
              title={rule.enabled ? 'Disable' : 'Enable'}
            >
              {rule.enabled ? <Check size={13} /> : <Ban size={13} />}
            </button>

            <button
              onClick={() => startEdit(rule)}
              className="p-1 text-[var(--color-text-muted)] hover:text-accent-500 hover:bg-accent-500/10 rounded transition-colors"
              title="Edit"
            >
              <ArrowRight size={13} />
            </button>

            <button
              onClick={() => deleteRule(rule.id)}
              className="p-1 text-[var(--color-text-muted)] hover:text-red-400 hover:bg-red-400/10 rounded transition-colors"
              title="Delete"
            >
              <X size={13} />
            </button>
          </div>
        ))}

        {/* Edit form */}
        {editingId && (
          <div className="border-2 border-accent-500/30 rounded-lg p-3 space-y-3 bg-[var(--color-surface)]">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-accent-500">
                {editingId === 'new' ? 'New Rule' : 'Edit Rule'}
              </span>
              <button onClick={() => setEditingId(null)} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                <X size={14} />
              </button>
            </div>

            {/* Name */}
            <div>
              <label className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wide">Name</label>
              <input
                type="text"
                value={editRule.name}
                onChange={e => setEditRule({ ...editRule, name: e.target.value })}
                className="w-full mt-1 px-2.5 py-1.5 text-[12px] bg-[var(--color-input-bg)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] focus:outline-none focus:border-accent-500"
              />
            </div>

            {/* Condition */}
            <div>
              <label className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wide">IF</label>
              <div className="flex gap-1.5 mt-1">
                <select
                  value={editRule.condition.field}
                  onChange={e => setEditRule({ ...editRule, condition: { ...editRule.condition, field: e.target.value } })}
                  className="flex-1 px-2 py-1.5 text-[11px] bg-[var(--color-input-bg)] border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
                >
                  {FIELD_OPTIONS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
                <select
                  value={editRule.condition.operator}
                  onChange={e => setEditRule({ ...editRule, condition: { ...editRule.condition, operator: e.target.value as RoutingRule['condition']['operator'] } })}
                  className="w-20 px-2 py-1.5 text-[11px] bg-[var(--color-input-bg)] border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
                >
                  {OPERATOR_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <input
                  type="text"
                  value={editRule.condition.value}
                  onChange={e => setEditRule({ ...editRule, condition: { ...editRule.condition, value: e.target.value } })}
                  placeholder="value"
                  className="flex-1 px-2 py-1.5 text-[11px] bg-[var(--color-input-bg)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] focus:outline-none focus:border-accent-500 font-mono"
                />
              </div>
            </div>

            {/* Action */}
            <div>
              <label className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wide">THEN</label>
              <div className="flex gap-1.5 mt-1">
                <select
                  value={editRule.action.type}
                  onChange={e => setEditRule({ ...editRule, action: { type: e.target.value } })}
                  className="flex-1 px-2 py-1.5 text-[11px] bg-[var(--color-input-bg)] border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
                >
                  {ACTION_OPTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                </select>
                {actionOpt?.needsValue && (
                  <input
                    type="text"
                    value={editRule.action.value || ''}
                    onChange={e => setEditRule({ ...editRule, action: { ...editRule.action, value: e.target.value } })}
                    placeholder={actionOpt.valueLabel || 'value'}
                    className="flex-1 px-2 py-1.5 text-[11px] bg-[var(--color-input-bg)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] focus:outline-none focus:border-accent-500 font-mono"
                  />
                )}
              </div>
            </div>

            {/* Buttons */}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setEditingId(null)} className="px-3 py-1.5 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors">
                Cancel
              </button>
              <button
                onClick={saveEdit}
                disabled={!editRule.name.trim() || saving}
                className="px-4 py-1.5 bg-accent-600 hover:bg-accent-500 disabled:opacity-40 text-white rounded-md text-[11px] font-medium transition-colors"
              >
                {saving ? 'Saving...' : 'Save Rule'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Status */}
      <div className="flex items-center justify-between text-[10px] text-[var(--color-text-muted)]">
        <span>{rules.length} rule{rules.length !== 1 ? 's' : ''} · {rules.filter(r => r.enabled).length} active</span>
        {saving && <span className="text-accent-500">Saving...</span>}
      </div>
    </div>
  );
}
