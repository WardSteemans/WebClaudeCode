import { ChatList } from './ChatList';
import { ChatPanel } from './ChatPanel';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { useTabStore } from '../../store';

interface TabViewProps {
  tabId: string;
  workDir: string;
  chatList: { width: number; collapsed: boolean }; // owned by App for the activity bar
}

export function TabView({ tabId, workDir }: TabViewProps) {
  const tab = useTabStore((s) => s.tabs.find((t) => t.id === tabId));
  if (!tab || !tab.chats) return null;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Render all chats — hide inactive via CSS; keep mounts alive for stream continuity */}
      {tab.chats.map((chat) => (
        <div
          key={chat.id}
          style={{ display: chat.id === tab.activeChatId ? 'flex' : 'none' }}
          className="flex-1 flex-col min-h-0"
        >
          <ErrorBoundary name="Chat panel">
            <ChatPanel tabId={tabId} chatId={chat.id} workDir={workDir} />
          </ErrorBoundary>
        </div>
      ))}
      {(!tab.activeChatId || !tab.chats.find(c => c.id === tab.activeChatId)) && (
        <div className="flex-1 flex items-center justify-center text-[var(--color-text-muted)] text-sm">
          No chat selected
        </div>
      )}
    </div>
  );
}
