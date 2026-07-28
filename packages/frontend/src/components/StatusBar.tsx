import { GitBranch, Wifi, HardDrive, GitFork, MessageSquare } from 'lucide-react';
import { useTabStore } from '../store';
import { useEventBus } from '../store/eventBus';
import { useEffect, useState } from 'react';

interface GitInfo {
  branch: string;
  isWorktree: boolean;
  worktreePath?: string;
}

export function StatusBar() {
  const activeTabId = useTabStore((s) => s.activeTabId);
  const tabs = useTabStore((s) => s.tabs);
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const activeChat = activeTab?.chats.find((c) => c.id === activeTab.activeChatId);
  const tabStatuses = useEventBus((s) => s.tabStatuses);
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null);

  // Resolve active chat's workDir: chat.workDir > tab.workDir
  const chatWorkDir = activeChat?.workDir || activeTab?.workDir;

  // Fetch git info for active chat's workDir
  useEffect(() => {
    if (!chatWorkDir) { setGitInfo(null); return; }

    fetch(`/api/git/status?base=${encodeURIComponent(chatWorkDir)}`)
      .then(r => r.json())
      .then(d => {
        setGitInfo({
          branch: d.branch || 'unknown',
          isWorktree: d.isWorktree || false,
          worktreePath: d.worktreePath,
        });
      })
      .catch(() => setGitInfo(null));
  }, [chatWorkDir, activeTab?.id]);

  const status = activeTabId ? tabStatuses[activeTabId] || 'idle' : 'idle';

  const statusColors: Record<string, string> = {
    idle: 'bg-slate-400',
    streaming: 'bg-green-500 animate-pulse',
    error: 'bg-red-500',
  };

  return (
    <footer className="h-6 shrink-0 flex items-center justify-between px-3 bg-accent-600 text-white text-[11px] select-none">
      <div className="flex items-center gap-3 min-w-0">
        {/* Git info */}
        {gitInfo && (
          <span className="flex items-center gap-1.5 opacity-90 min-w-0">
            {gitInfo.isWorktree ? (
              <GitFork size={11} className="shrink-0 text-green-300" />
            ) : (
              <GitBranch size={11} className="shrink-0" />
            )}
            <span className="truncate max-w-40">{gitInfo.branch}</span>
            {gitInfo.isWorktree && gitInfo.worktreePath && (
              <span className="text-white/50 truncate max-w-60 hidden sm:inline">
                {gitInfo.worktreePath}
              </span>
            )}
          </span>
        )}

        {/* Active chat */}
        {activeChat && (
          <span className="flex items-center gap-1 opacity-75 min-w-0">
            <MessageSquare size={11} className="shrink-0" />
            <span className="truncate max-w-40">{activeChat.title}</span>
          </span>
        )}

        {/* Project */}
        {activeTab && (
          <span className="flex items-center gap-1 opacity-75 min-w-0">
            <HardDrive size={11} className="shrink-0" />
            <span className="truncate max-w-32">{activeTab.label}</span>
          </span>
        )}
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {/* Status */}
        <span className="flex items-center gap-1 opacity-90">
          <span className={`inline-block w-2 h-2 rounded-full ${statusColors[status]}`} />
          {status === 'streaming' ? 'Streaming' : status === 'error' ? 'Error' : 'Ready'}
        </span>

        {/* Tabs count */}
        <span className="opacity-60">{tabs.length}p</span>

        {/* Connection */}
        <span className="flex items-center gap-1 opacity-60">
          <Wifi size={10} />
        </span>
      </div>
    </footer>
  );
}
