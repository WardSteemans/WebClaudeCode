import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// API-backed storage — persists zustand state to backend SQLite database
// Compatible with multi-device setup: all clients share the same backing store
function apiStorage() {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let latestValue: string | null = null;

  const flush = () => {
    if (latestValue === null) return;
    const payload = latestValue;
    latestValue = null;
    fetch('/api/tab-state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    }).catch(() => {});
  };

  return createJSONStorage(() => ({
    getItem: async (_name: string) => {
      try {
        const res = await fetch('/api/tab-state');
        if (!res.ok) return null;
        // Return raw text — createJSONStorage will JSON.parse it
        return await res.text();
      } catch {
        return null;
      }
    },
    setItem: (_name: string, value: string) => {
      latestValue = value;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(flush, 250);
    },
    removeItem: (_name: string) => {
      latestValue = null;
      if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
      fetch('/api/tab-state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tabs: [], activeTabId: null }),
      }).catch(() => {});
    },
  }));
}

export interface ChatFolder {
  id: string;
  name: string;
  parentId: string | null;  // null = root-level folder
  createdAt: number;
}

export interface Chat {
  id: string;
  title: string;
  sessionId: string | null;
  workDir: string | null;  // per-chat worktree — null = inherit from tab
  effort: string | null;   // reasoning effort override — null = default
  permissionMode: string | null;  // permission mode override — null = default
  model: string | null;    // model override — null = default
  createdAt: number;
  lastMessageAt: number | null;  // epoch ms — last user/assistant message
  folderId: string | null;  // null = uncategorized
  pinned: boolean;
  archived: boolean;
}

export interface Tab {
  id: string;
  workDir: string;
  label: string;
  chats: Chat[];
  folders: ChatFolder[];
  activeChatId: string | null;
  hiddenSessionIds: string[];  // sessionIds the user deleted — skip on auto-import
  createdAt: number;
}

interface TabState {
  tabs: Tab[];
  activeTabId: string | null;

  addTab: (workDir: string, label?: string) => string;
  removeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  activeTab: () => Tab | undefined;

  addChat: (tabId: string, opts?: { title?: string; workDir?: string; createdAt?: number }) => string;
  removeChat: (tabId: string, chatId: string) => void;
  setActiveChat: (tabId: string, chatId: string) => void;
  updateChatSessionId: (tabId: string, chatId: string, sessionId: string) => void;
  updateChatTitle: (tabId: string, chatId: string, title: string) => void;
  updateChatWorkDir: (tabId: string, chatId: string, workDir: string) => void;
  updateChatEffort: (tabId: string, chatId: string, effort: string | null) => void;
  updateChatPermissionMode: (tabId: string, chatId: string, permissionMode: string | null) => void;
  updateChatModel: (tabId: string, chatId: string, model: string | null) => void;
  updateChatLastMessage: (tabId: string, chatId: string, ts?: number) => void;
  activateChat: (tabId: string, chatId: string) => void;

  // Folders
  addFolder: (tabId: string, name: string, parentId?: string | null) => string;
  removeFolder: (tabId: string, folderId: string) => void;
  renameFolder: (tabId: string, folderId: string, name: string) => void;
  moveFolder: (tabId: string, folderId: string, newParentId: string | null) => void;

  // Chat organization
  moveChatToFolder: (tabId: string, chatId: string, folderId: string | null) => void;
  togglePinChat: (tabId: string, chatId: string) => void;
  archiveChat: (tabId: string, chatId: string) => void;
  unarchiveChat: (tabId: string, chatId: string) => void;

  // Hidden sessions (deleted by user — don't re-import)
  unhideSession: (tabId: string, sessionId: string) => void;
}

let chatCounter = 1;

export const useTabStore = create<TabState>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeTabId: null,

      addTab: (workDir: string, label?: string) => {
        const id = crypto.randomUUID();
        const name = label || workDir.split(/[/\\]/).filter(Boolean).pop() || workDir;
        const chatId = crypto.randomUUID();
        const tab: Tab = {
          id, workDir, label: name,
          chats: [{ id: chatId, title: 'Chat 1', sessionId: null, workDir: null, effort: null, permissionMode: null, model: null, createdAt: Date.now(), lastMessageAt: null, folderId: null, pinned: false, archived: false }],
          folders: [],
          hiddenSessionIds: [],
          activeChatId: chatId, createdAt: Date.now(),
        };
        set((s) => ({ tabs: [...s.tabs, tab], activeTabId: id }));
        return id;
      },

      removeTab: (id: string) => set((s) => {
        const remaining = s.tabs.filter((t) => t.id !== id);
        return { tabs: remaining, activeTabId: s.activeTabId === id ? remaining[remaining.length - 1]?.id ?? null : s.activeTabId };
      }),

      setActiveTab: (id: string) => set({ activeTabId: id }),

      activeTab: () => get().tabs.find((t) => t.id === get().activeTabId),

      addChat: (tabId: string, opts?: { title?: string; workDir?: string; createdAt?: number }) => {
        const id = crypto.randomUUID();
        const num = chatCounter++;
        const createdAt = opts?.createdAt ?? Date.now();
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === tabId
              ? {
                  ...t,
                  chats: [...t.chats, { id, title: opts?.title || `Chat ${num}`, sessionId: null, workDir: opts?.workDir || null, effort: null, permissionMode: null, model: null, createdAt, lastMessageAt: createdAt, folderId: null, pinned: false, archived: false }],
                  activeChatId: id,
                }
              : t
          ),
        }));
        return id;
      },

      removeChat: (tabId: string, chatId: string) => set((s) => ({
        tabs: s.tabs.map((t) => {
          if (t.id !== tabId) return t;
          const chat = t.chats.find(c => c.id === chatId);
          const remaining = t.chats.filter((c) => c.id !== chatId);
          const hiddenSessionIds = chat?.sessionId && !t.hiddenSessionIds.includes(chat.sessionId)
            ? [...t.hiddenSessionIds, chat.sessionId]
            : t.hiddenSessionIds;
          return { ...t, chats: remaining, hiddenSessionIds, activeChatId: t.activeChatId === chatId ? remaining[remaining.length - 1]?.id ?? null : t.activeChatId };
        }),
      })),

      setActiveChat: (tabId: string, chatId: string) => set((s) => ({
        tabs: s.tabs.map((t) => t.id === tabId ? { ...t, activeChatId: chatId } : t),
      })),

      updateChatSessionId: (tabId: string, chatId: string, sessionId: string) => set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId ? { ...t, chats: t.chats.map((c) => c.id === chatId ? { ...c, sessionId } : c) } : t
        ),
      })),

      updateChatTitle: (tabId: string, chatId: string, title: string) => set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId ? { ...t, chats: t.chats.map((c) => c.id === chatId ? { ...c, title } : c) } : t
        ),
      })),

      updateChatWorkDir: (tabId: string, chatId: string, workDir: string) => set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId ? { ...t, chats: t.chats.map((c) => c.id === chatId ? { ...c, workDir } : c) } : t
        ),
      })),

      updateChatEffort: (tabId: string, chatId: string, effort: string | null) => set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId ? { ...t, chats: t.chats.map((c) => c.id === chatId ? { ...c, effort } : c) } : t
        ),
      })),

      updateChatPermissionMode: (tabId: string, chatId: string, permissionMode: string | null) => set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId ? { ...t, chats: t.chats.map((c) => c.id === chatId ? { ...c, permissionMode } : c) } : t
        ),
      })),

      updateChatModel: (tabId: string, chatId: string, model: string | null) => set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId ? { ...t, chats: t.chats.map((c) => c.id === chatId ? { ...c, model } : c) } : t
        ),
      })),

      updateChatLastMessage: (tabId: string, chatId: string, ts?: number) => set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId ? { ...t, chats: t.chats.map((c) => c.id === chatId ? { ...c, lastMessageAt: ts ?? Date.now() } : c) } : t
        ),
      })),

      activateChat: (tabId: string, chatId: string) => set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId ? {
            ...t,
            chats: t.chats.map((c) => c.id === chatId ? { ...c, createdAt: Date.now() } : c),
          } : t
        ),
      })),

      // === Folders ===

      addFolder: (tabId: string, name: string, parentId: string | null = null) => {
        const id = crypto.randomUUID();
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === tabId ? { ...t, folders: [...t.folders, { id, name, parentId, createdAt: Date.now() }] } : t
          ),
        }));
        return id;
      },

      removeFolder: (tabId: string, folderId: string) => set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId
            ? {
                ...t,
                // Move chats in this folder (and its sub-folders) to uncategorized,
                // remove the folder, and also remove any sub-folders
                chats: t.chats.map((c) => c.folderId === folderId ? { ...c, folderId: null } : c),
                folders: t.folders.filter((f) => f.id !== folderId && f.parentId !== folderId),
              }
            : t
        ),
      })),

      renameFolder: (tabId: string, folderId: string, name: string) => set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId
            ? { ...t, folders: t.folders.map((f) => f.id === folderId ? { ...f, name } : f) }
            : t
        ),
      })),

      moveFolder: (tabId: string, folderId: string, newParentId: string | null) => set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId
            ? {
                ...t,
                folders: t.folders.map((f) =>
                  f.id === folderId ? { ...f, parentId: newParentId } : f
                ),
              }
            : t
        ),
      })),

      // === Chat organization ===

      moveChatToFolder: (tabId: string, chatId: string, folderId: string | null) => set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId
            ? { ...t, chats: t.chats.map((c) => c.id === chatId ? { ...c, folderId } : c) }
            : t
        ),
      })),

      togglePinChat: (tabId: string, chatId: string) => set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId
            ? { ...t, chats: t.chats.map((c) => c.id === chatId ? { ...c, pinned: !c.pinned } : c) }
            : t
        ),
      })),

      archiveChat: (tabId: string, chatId: string) => set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId
            ? { ...t, chats: t.chats.map((c) => c.id === chatId ? { ...c, archived: true } : c) }
            : t
        ),
      })),

      unarchiveChat: (tabId: string, chatId: string) => set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId
            ? { ...t, chats: t.chats.map((c) => c.id === chatId ? { ...c, archived: false } : c) }
            : t
        ),
      })),

      // === Hidden sessions ===

      unhideSession: (tabId: string, sessionId: string) => set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId
            ? { ...t, hiddenSessionIds: t.hiddenSessionIds.filter(id => id !== sessionId) }
            : t
        ),
      })),
    }),
    {
      name: 'cc-gui-tabs',
      version: 11,
      storage: apiStorage(),
      migrate: (persisted: unknown, version: number) => {
        const state = persisted as Record<string, unknown>;
        const tabs = state.tabs as Array<Record<string, unknown>> | undefined;
        if (!tabs) return state as unknown as TabState;

        let migrated = tabs;

        // Version 4: add workDir to chats
        if (version < 4) {
          migrated = migrated.map((t) => ({
            ...t,
            chats: Array.isArray(t.chats)
              ? (t.chats as Array<Record<string, unknown>>).map((c: Record<string, unknown>) => ({ ...c, workDir: c.workDir || null }))
              : [],
          }));
        }

        // Version 5: add folderId, pinned, archived to chats, and folders to tabs
        if (version < 5) {
          migrated = migrated.map((t) => ({
            ...t,
            folders: [],
            chats: Array.isArray(t.chats)
              ? (t.chats as Array<Record<string, unknown>>).map((c: Record<string, unknown>) => ({
                  ...c,
                  folderId: (c as any).folderId || null,
                  pinned: (c as any).pinned || false,
                  archived: (c as any).archived || false,
                }))
              : [],
          }));
        }

        // Version 6: add hiddenSessionIds to tabs
        if (version < 6) {
          migrated = migrated.map((t) => ({
            ...t,
            hiddenSessionIds: (t as any).hiddenSessionIds || [],
          }));
        }

        // Version 7-8: add lastMessageAt to chats, seed from createdAt if missing
        if (version < 8) {
          migrated = migrated.map((t) => ({
            ...t,
            chats: Array.isArray(t.chats)
              ? (t.chats as Array<Record<string, unknown>>).map((c: Record<string, unknown>) => ({
                  ...c,
                  lastMessageAt: (c as any).lastMessageAt || c.createdAt || null,
                }))
              : [],
          }));
        }

        // Version 9: add effort to chats
        if (version < 9) {
          migrated = migrated.map((t) => ({
            ...t,
            chats: Array.isArray(t.chats)
              ? (t.chats as Array<Record<string, unknown>>).map((c: Record<string, unknown>) => ({
                  ...c,
                  effort: (c as any).effort || null,
                }))
              : [],
          }));
        }

        // Version 10: add permissionMode to chats
        if (version < 10) {
          migrated = migrated.map((t) => ({
            ...t,
            chats: Array.isArray(t.chats)
              ? (t.chats as Array<Record<string, unknown>>).map((c: Record<string, unknown>) => ({
                  ...c,
                  permissionMode: (c as any).permissionMode || null,
                }))
              : [],
          }));
        }

        // Version 11: add model to chats
        if (version < 11) {
          migrated = migrated.map((t) => ({
            ...t,
            chats: Array.isArray(t.chats)
              ? (t.chats as Array<Record<string, unknown>>).map((c: Record<string, unknown>) => ({
                  ...c,
                  model: (c as any).model || null,
                }))
              : [],
          }));
        }

        return { ...state, tabs: migrated } as unknown as TabState;
      },
    }
  )
);
