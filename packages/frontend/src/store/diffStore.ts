import { create } from 'zustand';

export interface FileChange {
  path: string;
  type: 'created' | 'modified' | 'deleted';
  diff?: string;
  timestamp: string;
}

interface DiffStore {
  changesByChat: Record<string, FileChange[]>;
  addChange: (chatId: string, change: FileChange) => void;
  clearChanges: (chatId: string) => void;
}

export const useDiffStore = create<DiffStore>((set) => ({
  changesByChat: {},

  addChange: (chatId, change) =>
    set((s) => {
      const existing = s.changesByChat[chatId] || [];
      const idx = existing.findIndex((c) => c.path === change.path);
      if (idx >= 0) {
        const updated = [...existing];
        updated[idx] = { ...change, timestamp: new Date().toISOString() };
        return { changesByChat: { ...s.changesByChat, [chatId]: updated } };
      }
      return {
        changesByChat: {
          ...s.changesByChat,
          [chatId]: [...existing, { ...change, timestamp: new Date().toISOString() }],
        },
      };
    }),

  clearChanges: (chatId) =>
    set((s) => {
      const next = { ...s.changesByChat };
      delete next[chatId];
      return { changesByChat: next };
    }),
}));
