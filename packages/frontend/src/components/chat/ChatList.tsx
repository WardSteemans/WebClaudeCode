import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  MessageSquare, X, Pin, Archive, FolderIcon, FolderOpen,
  ChevronRight, ChevronDown, Plus,
} from 'lucide-react';
import { useShallow } from 'zustand/shallow';
import { useTabStore, Chat, ChatFolder } from '../../store';
import { ContextMenu, ContextMenuItem } from '../ui/ContextMenu';

/** Format epoch ms for sidebar display */
function chatTime(ms: number | null): string {
  if (!ms) return '';
  const d = new Date(ms);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

interface ChatListProps {
  tabId: string;
  workDir: string | null;
}

export function ChatList({ tabId, workDir }: ChatListProps) {
  const tab = useTabStore(
    useShallow((s) => s.tabs.find((t) => t.id === tabId) ?? null)
  );
  const removeChat = useTabStore((s) => s.removeChat);
  const setActiveChat = useTabStore((s) => s.setActiveChat);
  const updateChatTitle = useTabStore((s) => s.updateChatTitle);
  const addChat = useTabStore((s) => s.addChat);
  const updateChatSessionId = useTabStore((s) => s.updateChatSessionId);

  // New actions
  const addFolder = useTabStore((s) => s.addFolder);
  const removeFolder = useTabStore((s) => s.removeFolder);
  const renameFolder = useTabStore((s) => s.renameFolder);
  const moveFolder = useTabStore((s) => s.moveFolder);
  const moveChatToFolder = useTabStore((s) => s.moveChatToFolder);
  const togglePinChat = useTabStore((s) => s.togglePinChat);
  const archiveChat = useTabStore((s) => s.archiveChat);
  const unarchiveChat = useTabStore((s) => s.unarchiveChat);

  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; chatId: string } | null>(null);
  const [folderContextMenu, setFolderContextMenu] = useState<{ x: number; y: number; folderId: string } | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Auto-import sessions for this workDir as chats (never creates tabs)
  // Also cleans up chats whose session files no longer exist
  const sessionsImportedRef = useRef(false);
  useEffect(() => {
    if (!workDir || !tab) return;
    if (sessionsImportedRef.current) return;
    sessionsImportedRef.current = true;

    fetch(`/api/sessions/list?base=${encodeURIComponent(workDir)}`)
      .then(r => r.json())
      .then((data: Array<{ sessionId: string; title: string; timestamp: string; workDir?: string }>) => {
        if (!Array.isArray(data)) return;
        const discoveredIds = new Set(data.map(s => s.sessionId));
        const existingSessionIds = new Set(tab.chats.filter(c => c.sessionId).map(c => c.sessionId!));
        const hiddenIds = new Set(tab.hiddenSessionIds || []);

        // Remove chats whose session file no longer exists (clean up stale entries)
        for (const chat of tab.chats) {
          if (chat.sessionId && !discoveredIds.has(chat.sessionId) && !hiddenIds.has(chat.sessionId)) {
            useTabStore.getState().removeChat(tabId, chat.id);
          }
        }

        // Add newly discovered sessions
        for (const s of data) {
          if (existingSessionIds.has(s.sessionId) || hiddenIds.has(s.sessionId)) continue;
          const ts = s.timestamp ? new Date(s.timestamp).getTime() : undefined;
          const chatId = addChat(tabId, {
            title: (s.title || 'Untitled').slice(0, 30),
            workDir: s.workDir || workDir,
            createdAt: ts,
            setActive: false, // auto-import: don't steal focus
          });
          updateChatSessionId(tabId, chatId, s.sessionId);
        }
      })
      .then(() => {
        const currentTab = useTabStore.getState().tabs.find(t => t.id === tabId);
        console.log(`[ChatList] auto-import done: ${currentTab?.chats.length ?? '?'} chats, active=[${currentTab?.activeChatId?.slice(0,8)}]`);
      })
      .catch((err) => { console.warn('Failed to load sessions', err); });
  }, [workDir, tab?.id]);

  if (!tab || !tab.chats) return null;

  const folders = tab.folders || [];

  const toggleSection = (key: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const isCollapsed = (key: string) => collapsedSections.has(key);

  // Categorize chats — memoized to avoid re-filtering on every render
  const pinnedChats = useMemo(
    () => tab.chats.filter(c => c.pinned && !c.archived).sort((a, b) => (b.lastMessageAt ?? b.createdAt) - (a.lastMessageAt ?? a.createdAt)),
    [tab.chats]
  );
  const archivedChats = useMemo(
    () => tab.chats.filter(c => c.archived).sort((a, b) => (b.lastMessageAt ?? b.createdAt) - (a.lastMessageAt ?? a.createdAt)),
    [tab.chats]
  );
  const rootChats = useMemo(
    () => tab.chats.filter(c => !c.folderId && !c.pinned && !c.archived).sort((a, b) => (b.lastMessageAt ?? b.createdAt) - (a.lastMessageAt ?? a.createdAt)),
    [tab.chats]
  );

  const getFolderChats = useCallback((folderId: string) =>
    tab.chats.filter(c => c.folderId === folderId && !c.pinned && !c.archived).sort((a, b) => (b.lastMessageAt ?? b.createdAt) - (a.lastMessageAt ?? a.createdAt)),
    [tab.chats]
  );

  const getSubFolders = useCallback((parentId: string | null) =>
    folders.filter(f => f.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name)),
    [folders]
  );

  // --- Context menu handlers ---

  const handleContextMenu = (e: React.MouseEvent, chatId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, chatId });
  };

  const closeContextMenu = () => setContextMenu(null);

  const buildContextMenuItems = useCallback((chatId: string): ContextMenuItem[] => {
    const chat = tab!.chats.find(c => c.id === chatId);
    if (!chat) return [];
    const isPinned = chat.pinned;
    const isArchived = chat.archived;

    const folderOptions = (parentId: string | null, depth: number = 0): ContextMenuItem[] => {
      const items: ContextMenuItem[] = [];
      const subFolders = getSubFolders(parentId);
      for (const f of subFolders) {
        items.push({
          label: `${'  '.repeat(depth)}${f.name}`,
          onClick: () => moveChatToFolder(tabId, chatId, f.id),
        });
        items.push(...folderOptions(f.id, depth + 1));
      }
      return items;
    };

    const items: ContextMenuItem[] = [
      {
        label: isPinned ? 'Unpin' : 'Pin',
        icon: <Pin size={13} />,
        onClick: () => togglePinChat(tabId, chatId),
      },
      {
        label: 'Rename',
        onClick: () => {
          const name = prompt('Chat name:', chat.title);
          if (name) updateChatTitle(tabId, chatId, name);
        },
      },
      { label: '', onClick: () => {}, dividerAfter: true },
    ];

    // Move to folder submenu
    const rootFolders = getSubFolders(null);
    if (rootFolders.length > 0) {
      const moveItems = folderOptions(null);
      moveItems.unshift({
        label: '(No folder)',
        onClick: () => moveChatToFolder(tabId, chatId, null),
        dividerAfter: true,
      });
      items.push({
        label: 'Move to folder',
        icon: <FolderIcon size={13} />,
        onClick: () => {}, // parent opens submenu
        submenu: moveItems,
      });
    } else {
      items.push({
        label: 'Move to folder',
        icon: <FolderIcon size={13} />,
        disabled: true,
        onClick: () => {},
      });
    }

    if (chat.folderId) {
      items.push({
        label: 'Remove from folder',
        onClick: () => moveChatToFolder(tabId, chatId, null),
      });
    }

    items.push({ label: '', onClick: () => {}, dividerAfter: true });

    if (isArchived) {
      items.push({
        label: 'Unarchive',
        icon: <Archive size={13} />,
        onClick: () => unarchiveChat(tabId, chatId),
      });
    } else {
      items.push({
        label: 'Archive',
        icon: <Archive size={13} />,
        onClick: () => archiveChat(tabId, chatId),
      });
    }

    items.push({
      label: 'Delete',
      icon: <X size={13} />,
      danger: true,
      onClick: () => { if (tab!.chats.length > 1) removeChat(tabId, chatId); },
    });

    return items;
  }, [tab, tabId, moveChatToFolder, togglePinChat, archiveChat, unarchiveChat, removeChat, updateChatTitle]);

  // --- Folder context menu ---

  const handleFolderContextMenu = (e: React.MouseEvent, folderId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setFolderContextMenu({ x: e.clientX, y: e.clientY, folderId });
  };

  const closeFolderContextMenu = () => setFolderContextMenu(null);

  const buildFolderContextMenuItems = (folderId: string): ContextMenuItem[] => {
    const folder = folders.find(f => f.id === folderId);
    if (!folder) return [];
    return [
      {
        label: 'Rename folder',
        onClick: () => {
          setRenamingFolderId(folderId);
          setRenameValue(folder.name);
        },
      },
      { label: '', onClick: () => {}, dividerAfter: true },
      {
        label: 'Delete folder',
        danger: true,
        onClick: () => removeFolder(tabId, folderId),
      },
    ];
  };

  // --- Folder creation ---

  const handleCreateFolder = () => {
    setCreatingFolder(true);
    setFolderName('');
  };

  const submitFolder = () => {
    const name = folderName.trim();
    if (name) {
      addFolder(tabId, name);
      setCreatingFolder(false);
      setFolderName('');
    }
  };

  const submitRenameFolder = (folderId: string) => {
    const name = renameValue.trim();
    if (name) {
      renameFolder(tabId, folderId, name);
    }
    setRenamingFolderId(null);
    setRenameValue('');
  };

  // Uncategorized (root-level non-pinned, non-archived) — already computed above
  const rootFolders = useMemo(
    () => getSubFolders(null),
    [getSubFolders]
  );

  // --- Render helpers ---

  const renderChatItem = (chat: Chat, level: number = 0) => (
    <div key={chat.id}>
      <div
        onClick={() => { console.log(`[ChatList] CLICK: chat=[${chat.id.slice(0,8)}] "${chat.title}" (was active=[${tab.activeChatId?.slice(0,8)}])`); setActiveChat(tabId, chat.id); }}
        onContextMenu={(e) => handleContextMenu(e, chat.id)}
        className={`group flex items-center gap-2 px-3 py-1.5 cursor-pointer text-[13px] transition-colors ${
          chat.id === tab.activeChatId
            ? 'bg-accent-600/15 text-accent-600 dark:text-accent-400 border-l-2 border-accent-500'
            : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] border-l-2 border-transparent'
        }`}
        style={{ paddingLeft: `${12 + level * 16}px` }}
      >
        <MessageSquare size={14} className="shrink-0 opacity-60" />
        <span
          className="truncate flex-1"
          onDoubleClick={(e) => {
            e.stopPropagation();
            const name = prompt('Chat name:', chat.title);
            if (name) updateChatTitle(tabId, chat.id, name);
          }}
        >
          {chat.title}
        </span>
        <span className="text-[10px] text-[var(--color-text-muted)] opacity-60 shrink-0">
          {chatTime(chat.lastMessageAt) || chatTime(chat.createdAt)}
        </span>
        {chat.pinned && <Pin size={11} className="shrink-0 text-accent-500" />}
        <button
          onClick={(e) => { e.stopPropagation(); if (tab.chats.length > 1) removeChat(tabId, chat.id); }}
          className="text-[var(--color-text-muted)] hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all p-0.5"
          title="Delete chat"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );

  const renderFolder = (folder: ChatFolder, level: number = 0) => {
    const sectionKey = `folder-${folder.id}`;
    const subFolders = getSubFolders(folder.id);
    const folderChats = getFolderChats(folder.id);
    const hasContent = subFolders.length > 0 || folderChats.length > 0;
    const collapsed = isCollapsed(sectionKey);

    return (
      <div key={folder.id}>
        {/* Folder header */}
        <div
          onContextMenu={(e) => handleFolderContextMenu(e, folder.id)}
          onClick={() => toggleSection(sectionKey)}
          className="group flex items-center gap-1 px-3 py-1.5 cursor-pointer text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-colors"
          style={{ paddingLeft: `${12 + level * 16}px` }}
        >
          {hasContent ? (
            collapsed ? <ChevronRight size={12} className="shrink-0" /> : <ChevronDown size={12} className="shrink-0" />
          ) : (
            <span className="w-3 shrink-0" />
          )}
          {collapsed ? <FolderIcon size={14} className="shrink-0 text-yellow-500" /> : <FolderOpen size={14} className="shrink-0 text-yellow-500" />}
          {renamingFolderId === folder.id ? (
            <input
              className="flex-1 bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-1 py-0.5 text-[13px] outline-none focus:border-accent-500 min-w-0"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={() => submitRenameFolder(folder.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitRenameFolder(folder.id);
                if (e.key === 'Escape') setRenamingFolderId(null);
              }}
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="truncate flex-1 font-medium">{folder.name}</span>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); handleCreateFolder(); }}
            className="opacity-0 group-hover:opacity-100 p-0.5 text-[var(--color-text-muted)] hover:text-accent-500 transition-all"
            title="Add subfolder"
          >
            <Plus size={12} />
          </button>
          <span className="text-[10px] text-[var(--color-text-muted)] shrink-0">{folderChats.length}</span>
        </div>

        {/* Folder contents */}
        {!collapsed && hasContent && (
          <div>
            {subFolders.map(sf => renderFolder(sf, level + 1))}
            {folderChats.map(c => renderChatItem(c, level + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex-1 overflow-y-auto py-1">
      {/* === Pinned Section === */}
      {pinnedChats.length > 0 && (
        <div>
          <div
            onClick={() => toggleSection('pinned')}
            className="flex items-center gap-1 px-3 py-1 text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider cursor-pointer hover:text-[var(--color-text-secondary)] transition-colors"
          >
            {isCollapsed('pinned') ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            <Pin size={12} />
            <span>Pinned</span>
            <span className="ml-auto text-[10px] font-normal normal-case">{pinnedChats.length}</span>
          </div>
          {!isCollapsed('pinned') && pinnedChats.map(c => renderChatItem(c))}
        </div>
      )}

      {/* === Folders === */}
      {rootFolders.length > 0 && (
        <div className="mb-1">
          {rootFolders.map(f => renderFolder(f))}
        </div>
      )}

      {/* === Inline folder creation (always shown at bottom of folders area) === */}
      <div className="px-3 py-0.5">
        <button
          onClick={handleCreateFolder}
          className="flex items-center gap-1.5 text-[12px] text-[var(--color-text-muted)] hover:text-accent-500 transition-colors w-full px-1 py-1 rounded hover:bg-[var(--color-surface-hover)]"
        >
          <Plus size={12} />
          <span>New folder</span>
        </button>
      </div>

      {creatingFolder && (
        <div className="px-3 py-1">
          <input
            className="w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-2 py-1 text-[13px] outline-none focus:border-accent-500"
            placeholder="Folder name..."
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            onBlur={submitFolder}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitFolder();
              if (e.key === 'Escape') setCreatingFolder(false);
            }}
            autoFocus
          />
        </div>
      )}

      {/* === Uncategorized (root) chats === */}
      {(rootFolders.length > 0 || pinnedChats.length > 0) && rootChats.length > 0 && (
        <div className="mx-3 my-1 border-t border-[var(--color-border)]" />
      )}
      {rootChats.map(c => renderChatItem(c))}

      {/* === Archived Section === */}
      {archivedChats.length > 0 && (
        <div>
          <div className="mx-3 my-1 border-t border-[var(--color-border)]" />
          <div
            onClick={() => toggleSection('archived')}
            className="flex items-center gap-1 px-3 py-1 text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider cursor-pointer hover:text-[var(--color-text-secondary)] transition-colors"
          >
            {isCollapsed('archived') ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            <Archive size={12} />
            <span>Archived</span>
            <span className="ml-auto text-[10px] font-normal normal-case">{archivedChats.length}</span>
          </div>
          {!isCollapsed('archived') && archivedChats.map(c =>
            <div key={c.id}>
              <div
                onClick={() => {
                  unarchiveChat(tabId, c.id);
                  setActiveChat(tabId, c.id);
                }}
                onContextMenu={(e) => handleContextMenu(e, c.id)}
                className="group flex items-center gap-2 px-3 py-1.5 cursor-pointer text-[13px] transition-colors text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] border-l-2 border-transparent"
              >
                <Archive size={13} className="shrink-0 opacity-50" />
                <span className="truncate flex-1 italic">{c.title}</span>
                <span className="text-[10px] opacity-50 shrink-0">
                  {new Date(c.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* === Context Menu === */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={buildContextMenuItems(contextMenu.chatId)}
          onClose={closeContextMenu}
        />
      )}

      {/* === Folder Context Menu === */}
      {folderContextMenu && (
        <ContextMenu
          x={folderContextMenu.x}
          y={folderContextMenu.y}
          items={buildFolderContextMenuItems(folderContextMenu.folderId)}
          onClose={closeFolderContextMenu}
        />
      )}
    </div>
  );
}
