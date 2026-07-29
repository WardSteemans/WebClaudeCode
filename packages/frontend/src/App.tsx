import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Plus, X, FolderOpen, Code2, Sun, Moon, Files, MessageSquare, LayoutPanelLeft, GitBranch, Cloud, Settings as SettingsIcon, BarChart3, Puzzle } from 'lucide-react';
import { useTheme } from './ThemeContext';
import { useResizable } from './hooks/useResizable';
import { useTabStore } from './store';
import { useEventBus } from './store/eventBus';
import { useSettingsStore } from './store/settingsStore';
import { useSessionMetrics } from './store/sessionMetrics';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { FileExplorer } from './components/files/FileExplorer';
import { FileViewer } from './components/files/FileViewer';
import { TabView } from './components/chat/TabView';
import { ChatList } from './components/chat/ChatList';
import { GitPanel } from './components/panels/GitPanel';
import { AzureDevOpsPanel } from './components/panels/AzureDevOpsPanel';
import { SettingsModal } from './components/settings/SettingsModal';
import { SessionOverview } from './components/panels/SessionOverview';
import { ActivityTimeline } from './components/panels/ActivityTimeline';
import { Notifications } from './components/ui/Notifications';
import { SubagentPanel } from './components/panels/SubagentPanel';
import { CapabilitiesPanel } from './components/panels/CapabilitiesPanel';
import { StatusBar } from './components/ui/StatusBar';
import { ProxyMetricsPanel } from './components/ProxyMetricsPanel';
import { FolderPicker } from './components/files/FolderPicker';

export default function App() {
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const addTab = useTabStore((s) => s.addTab);
  const removeTab = useTabStore((s) => s.removeTab);
  const setActiveTab = useTabStore((s) => s.setActiveTab);
  const { theme, toggle: toggleTheme } = useTheme();

  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [leftPanel, setLeftPanel] = useState<'explorer' | 'git' | 'azure' | 'overview' | 'capabilities'>('explorer');
  const [showSettings, setShowSettings] = useState(false);
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const showActivityPanel = useSettingsStore(s => s.showActivity);
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const activeChatId = useTabStore((s) => {
    const tab = s.tabs.find(t => t.id === s.activeTabId);
    return tab?.activeChatId ?? null;
  });
  const taskCount = useEventBus(s => s.taskEntries.length);

  // ── URL routing: sync store ↔ URL ──
  const { tabId: urlTabId, chatId: urlChatId } = useParams();
  const navigate = useNavigate();

  // On mount: restore tab/chat from URL
  const urlRestoredRef = useRef(false);
  useEffect(() => {
    if (urlRestoredRef.current) return;
    if (tabs.length === 0) return;
    urlRestoredRef.current = true;
    console.log(`[App] URL RESTORE: url=[${location.pathname}] tabs=${tabs.length} activeTabId=[${activeTabId?.slice(0,8)}]`);
    if (urlTabId) {
      const tab = tabs.find(t => t.id === urlTabId);
      if (tab) {
        if (activeTabId !== urlTabId) {
          useTabStore.getState().setActiveTab(urlTabId);
        }
        if (urlChatId && tab.chats.some(c => c.id === urlChatId)) {
          useTabStore.getState().setActiveChat(urlTabId, urlChatId);
        }
      } else {
        // Tab not found in URL — redirect to first tab
        navigate(`/${tabs[0].id}`, { replace: true });
      }
    } else {
      // No URL params — redirect to first tab
      const firstTab = tabs[0];
      const chatId = firstTab.activeChatId;
      navigate(chatId ? `/${firstTab.id}/${chatId}` : `/${firstTab.id}`, { replace: true });
    }
  }, [urlTabId, urlChatId, tabs.length]);

  // Keep URL in sync with store state
  useEffect(() => {
    if (activeTabId) {
      const path = activeChatId ? `/${activeTabId}/${activeChatId}` : `/${activeTabId}`;
      if (location.pathname !== path) {
        console.log(`[App] URL SYNC: store → navigate [${location.pathname}] → [${path}]`);
        navigate(path, { replace: true });
      }
    } else if (tabs.length === 0 && location.pathname !== '/') {
      console.log(`[App] URL SYNC: no tabs → navigate to /`);
      navigate('/', { replace: true });
    }
  }, [activeTabId, activeChatId, tabs.length]);

  // Load settings from SQLite on startup
  useEffect(() => {
    useSettingsStore.getState().loadFromDb();
    useSettingsStore.getState().loadClaudeSettings();
    useSessionMetrics.getState().loadMetricsFromDb();
  }, []);

  // Listen for external requests to open settings (e.g. from Azure DevOps panel)
  useEffect(() => {
    const handler = () => setShowSettings(true);
    window.addEventListener('cc-gui:open-settings', handler);
    return () => window.removeEventListener('cc-gui:open-settings', handler);
  }, []);

  const explorer = useResizable(240, 100, 500);
  const chatList = useResizable(192, 100, 400);
  const viewer = useResizable(400, 200, 900, true);
  const subagent = useResizable(320, 200, 600, true);

  const handleNewTab = () => {
    setShowFolderPicker(true);
  };

  const handleFolderSelected = (path: string) => {
    setShowFolderPicker(false);
    if (path) {
      const tabId = addTab(path);
      navigate(`/${tabId}`);
    }
  };

  const leftPanelTitle = leftPanel === 'git' ? 'Source Control' : leftPanel === 'azure' ? 'Azure DevOps' : leftPanel === 'overview' ? 'Overview' : leftPanel === 'capabilities' ? 'Capabilities' : 'Explorer';

  return (
    <div className="h-screen flex flex-col bg-[var(--color-bg)] text-[var(--color-text)] transition-colors">
      {/* Tab bar */}
      <header className="flex items-center bg-[var(--color-surface)] border-b border-[var(--color-border)] shrink-0 px-2 transition-colors">
        <div className="flex items-center gap-2 pr-3 border-r border-[var(--color-border)] mr-1">
          <Code2 size={16} className="text-accent-500" />
          <span className="text-xs font-semibold text-[var(--color-text-secondary)] tracking-wide">CC GUI</span>
        </div>

        <div className="flex-1 flex items-center gap-0.5 overflow-x-auto py-1.5">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); setSelectedFile(null); }}
              className={`group flex items-center gap-1.5 px-3 py-1.5 rounded-md cursor-pointer text-[13px] whitespace-nowrap transition-all duration-150 ${
                tab.id === activeTabId
                  ? 'bg-[var(--color-surface-hover)] text-[var(--color-text)] shadow-sm ring-1 ring-[var(--color-border)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]/50'
              }`}
            >
              <FolderOpen size={13} className="shrink-0 opacity-60" />
              <span className="truncate max-w-36">{tab.label}</span>
              <button
                onClick={(e) => { e.stopPropagation(); removeTab(tab.id); }}
                className="text-[var(--color-text-muted)] hover:text-red-500 hover:bg-red-500/10 rounded-sm p-0.5 opacity-0 group-hover:opacity-100 transition-all"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>

        <button onClick={toggleTheme} className="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] rounded-md transition-all" title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}>
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>

        <button onClick={handleNewTab} className="flex items-center gap-1 px-2.5 py-1.5 text-[var(--color-text-secondary)] hover:text-accent-500 hover:bg-accent-500/10 rounded-md transition-all text-xs ml-1">
          <Plus size={14} /><span>New Tab</span>
        </button>
      </header>

      {/* Main */}
      <main className="flex-1 min-h-0 flex flex-col">
        <div className="flex-1 min-h-0 flex">
          {/* Left activity bar */}
          <div className="w-10 shrink-0 flex flex-col items-center gap-1 py-2 border-r border-[var(--color-border)] bg-[var(--color-surface)] transition-colors">
            <button onClick={() => { if (leftPanel === 'explorer' && !explorer.collapsed) { explorer.toggle(); } else { if (explorer.collapsed) explorer.toggle(); setLeftPanel('explorer'); } }} className={`p-1.5 rounded-md transition-colors ${leftPanel === 'explorer' && !explorer.collapsed ? 'text-accent-500 bg-accent-500/10' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]'}`} title="Explorer">
              <Files size={20} />
            </button>
            <button onClick={() => { if (leftPanel === 'git' && !explorer.collapsed) { explorer.toggle(); setLeftPanel('explorer'); } else { if (explorer.collapsed) explorer.toggle(); setLeftPanel('git'); } }} className={`p-1.5 rounded-md transition-colors ${leftPanel === 'git' && !explorer.collapsed ? 'text-accent-500 bg-accent-500/10' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]'}`} title="Source Control">
              <GitBranch size={20} />
            </button>
            <button onClick={() => { if (leftPanel === 'azure' && !explorer.collapsed) { explorer.toggle(); setLeftPanel('explorer'); } else { if (explorer.collapsed) explorer.toggle(); setLeftPanel('azure'); } }} className={`p-1.5 rounded-md transition-colors ${leftPanel === 'azure' && !explorer.collapsed ? 'text-accent-500 bg-accent-500/10' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]'}`} title="Azure DevOps">
              <Cloud size={20} />
            </button>
            <button onClick={chatList.toggle} className={`p-1.5 rounded-md transition-colors ${!chatList.collapsed ? 'text-accent-500 bg-accent-500/10' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]'}`} title="Chats">
              <MessageSquare size={20} />
            </button>
            <button onClick={() => { if (leftPanel === 'overview' && !explorer.collapsed) { explorer.toggle(); setLeftPanel('explorer'); } else { if (explorer.collapsed) explorer.toggle(); setLeftPanel('overview'); } }} className={`p-1.5 rounded-md transition-colors ${leftPanel === 'overview' && !explorer.collapsed ? 'text-accent-500 bg-accent-500/10' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]'}`} title="Session Overview">
              <BarChart3 size={20} />
            </button>
            <button onClick={() => { if (leftPanel === 'capabilities' && !explorer.collapsed) { explorer.toggle(); setLeftPanel('explorer'); } else { if (explorer.collapsed) explorer.toggle(); setLeftPanel('capabilities'); } }} className={`p-1.5 rounded-md transition-colors ${leftPanel === 'capabilities' && !explorer.collapsed ? 'text-accent-500 bg-accent-500/10' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]'}`} title="Capabilities">
              <Puzzle size={20} />
            </button>
            <button onClick={() => setShowSettings(true)} className="mt-auto p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-colors" title="Settings">
              <SettingsIcon size={20} />
            </button>
          </div>

          {/* Left panel content */}
          <div ref={explorer.panelRef} style={{ width: explorer.width }} className="shrink-0 flex flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)] shrink-0">
              <span className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest">{leftPanelTitle}</span>
            </div>
            {!explorer.collapsed && leftPanel === 'explorer' && <ErrorBoundary name="File explorer"><FileExplorer workDir={activeTab?.workDir ?? null} onSelectFile={setSelectedFile} selectedFile={selectedFile} /></ErrorBoundary>}
            {!explorer.collapsed && leftPanel === 'git' && <ErrorBoundary name="Git panel"><GitPanel workDir={activeTab?.workDir ?? null} /></ErrorBoundary>}
            {!explorer.collapsed && leftPanel === 'azure' && <ErrorBoundary name="Azure DevOps panel"><AzureDevOpsPanel workDir={activeTab?.workDir ?? null} /></ErrorBoundary>}
            {!explorer.collapsed && leftPanel === 'overview' && <ErrorBoundary name="Session overview"><SessionOverview sessionId={activeTab?.chats.find(c => c.id === activeTab.activeChatId)?.sessionId ?? null} /></ErrorBoundary>}
            {!explorer.collapsed && leftPanel === 'capabilities' && <ErrorBoundary name="Capabilities"><CapabilitiesPanel /></ErrorBoundary>}
          </div>

          {!explorer.collapsed && <div onMouseDown={explorer.onMouseDown} className="w-1 cursor-col-resize hover:bg-accent-500/50 transition-colors shrink-0 bg-[var(--color-border)]" />}

          {/* Chat list */}
          <div ref={chatList.panelRef} style={{ width: chatList.width }} className="shrink-0 flex flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)] shrink-0">
              <span className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest">Chats</span>
              {activeTab && <button onClick={() => useTabStore.getState().addChat(activeTab.id)} className="p-0.5 text-[var(--color-text-muted)] hover:text-accent-500 hover:bg-accent-500/10 rounded transition-colors" title="New chat"><Plus size={14} /></button>}
            </div>
            {!chatList.collapsed && activeTab && <ErrorBoundary name="Chat list"><ChatList tabId={activeTab.id} workDir={activeTab.workDir} /></ErrorBoundary>}
          </div>

          {!chatList.collapsed && <div onMouseDown={chatList.onMouseDown} className="w-1 cursor-col-resize hover:bg-accent-500/50 transition-colors shrink-0 bg-[var(--color-border)]" />}

          {/* Center */}
          <section className="flex-1 min-w-0 flex flex-col bg-[var(--color-bg)] transition-colors overflow-hidden">
            {tabs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-4 text-[var(--color-text-muted)]">
                <Code2 size={48} className="opacity-40" />
                <p className="text-sm">No project open</p>
                <button onClick={handleNewTab} className="px-5 py-2.5 bg-accent-600 hover:bg-accent-500 text-white rounded-lg text-sm font-medium transition-all shadow-lg shadow-accent-900/30">Open Project Folder</button>
              </div>
            ) : (
              tabs.map((tab) => (
                <div key={tab.id} className={`flex-1 flex-col min-h-0 ${tab.id === activeTabId ? 'flex' : 'hidden'}`}>
                  <TabView tabId={tab.id} workDir={tab.workDir} chatList={chatList} />
                </div>
              ))
            )}
          </section>

          {taskCount > 0 && <div onMouseDown={subagent.onMouseDown} className="w-1 cursor-col-resize hover:bg-accent-500/50 transition-colors shrink-0 bg-[var(--color-border)]" />}

          {taskCount > 0 && <ErrorBoundary name="Subagent panel"><SubagentPanel collapsed={subagent.collapsed} onToggleCollapse={subagent.toggle} width={subagent.width} ref={subagent.panelRef} /></ErrorBoundary>}

          {selectedFile && <div onMouseDown={viewer.onMouseDown} className="w-1 cursor-col-resize hover:bg-accent-500/50 transition-colors shrink-0 bg-[var(--color-border)]" />}

          {selectedFile && (
            <>
              {viewer.collapsed && (
                <div className="w-10 shrink-0 flex flex-col items-center gap-1 py-2 border-l border-[var(--color-border)] bg-[var(--color-surface)] transition-colors">
                  <button onClick={viewer.toggle} className="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-colors" title="Show viewer">
                    <LayoutPanelLeft size={18} />
                  </button>
                </div>
              )}
              <div ref={viewer.panelRef} style={{ width: viewer.width }} className="shrink-0 flex flex-col overflow-hidden">
                <ErrorBoundary name="File viewer"><FileViewer filePath={selectedFile} baseDir={activeTab?.workDir ?? null} onClose={() => setSelectedFile(null)} onToggleCollapse={viewer.toggle} collapsed={viewer.collapsed} /></ErrorBoundary>
              </div>
            </>
          )}
        </div>

        {/* Activity panel (bottom, toggleable via Settings) */}
        {showActivityPanel && (
          <div className="h-48 shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col">
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--color-border)] shrink-0">
              <span className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-widest">Activity</span>
            </div>
            <ErrorBoundary name="Activity timeline"><ActivityTimeline /></ErrorBoundary>
          </div>
        )}

        <Notifications />

        <ProxyMetricsPanel />

        {/* Status bar */}
        <StatusBar />
      </main>

      {/* Settings modal */}
      {showSettings && <ErrorBoundary name="Settings"><SettingsModal onClose={() => setShowSettings(false)} /></ErrorBoundary>}

      {/* Folder picker modal */}
      {showFolderPicker && <FolderPicker onSelect={handleFolderSelected} onClose={() => setShowFolderPicker(false)} />}
    </div>
  );
}
