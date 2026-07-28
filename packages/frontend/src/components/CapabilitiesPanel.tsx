import { useEventBus } from '../store/eventBus';
import { Zap, Bot, Server, Box, Wrench } from 'lucide-react';

export function CapabilitiesPanel() {
  const skills = useEventBus((s) => s.skills);
  const agents = useEventBus((s) => s.agents);
  const mcpServers = useEventBus((s) => s.mcpServers);
  const slashCommands = useEventBus((s) => s.slashCommands);

  const hasData = skills.length > 0 || agents.length > 0 || mcpServers.length > 0;

  if (!hasData) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-4">
        <Box size={28} className="text-[var(--color-text-muted)] opacity-40 mb-2" />
        <p className="text-[12px] text-[var(--color-text-muted)]">
          No capabilities loaded yet.
        </p>
        <p className="text-[10px] text-[var(--color-text-muted)] mt-1 opacity-70">
          Start a Claude Code session to discover<br />installed skills, agents & MCP servers.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Skills */}
      {skills.length > 0 && (
        <div>
          <div className="px-3 py-1.5 text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest">
            Skills ({skills.length})
          </div>
          {skills.map((s, i) => (
            <div key={i} className="px-3 py-1.5 flex items-center gap-2 text-[12px] text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]">
              <Zap size={12} className="text-accent-500 shrink-0" />
              <span className="truncate">{s}</span>
            </div>
          ))}
        </div>
      )}

      {/* Agents */}
      {agents.length > 0 && (
        <div className="mt-2">
          <div className="px-3 py-1.5 text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest">
            Agents ({agents.length})
          </div>
          {agents.map((a, i) => (
            <div key={i} className="px-3 py-1.5 flex items-center gap-2 text-[12px] text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]">
              <Bot size={12} className="text-accent-500 shrink-0" />
              <span className="truncate">{a}</span>
            </div>
          ))}
        </div>
      )}

      {/* Slash Commands */}
      {slashCommands.length > 0 && (
        <div className="mt-2">
          <div className="px-3 py-1.5 text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest">
            Commands ({slashCommands.length})
          </div>
          {slashCommands.map((c, i) => (
            <div key={i} className="px-3 py-1.5 flex items-center gap-2 text-[12px] text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]">
              <Wrench size={12} className="text-[var(--color-text-muted)] shrink-0" />
              <span className="truncate">{c}</span>
            </div>
          ))}
        </div>
      )}

      {/* MCP Servers */}
      {mcpServers.length > 0 && (
        <div className="mt-2">
          <div className="px-3 py-1.5 text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest">
            MCP Servers ({mcpServers.length})
          </div>
          {mcpServers.map((m, i) => (
            <div key={i} className="px-3 py-1.5 flex items-center gap-2 text-[12px] text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]">
              <Server size={12} className="shrink-0" style={{ color: m.status === 'connected' ? '#22c55e' : m.status === 'failed' ? '#ef4444' : 'var(--color-text-muted)' }} />
              <span className="truncate flex-1">{m.name}</span>
              <span className={`text-[10px] shrink-0 ${
                m.status === 'connected' ? 'text-green-500' :
                m.status === 'failed' ? 'text-red-500' :
                'text-[var(--color-text-muted)]'
              }`}>{m.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
