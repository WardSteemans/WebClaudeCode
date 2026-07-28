import { create } from 'zustand';
import type { AppEvent, ToolStartedEvent, ToolCompletedEvent, FileEvent, CommandEvent, SessionEvent, PermissionRequestedEvent, NotificationEvent, SessionStatusEvent, TaskStartedEvent, TaskCompletedEvent } from '@cc-gui/shared';
import { useSessionMetrics } from './sessionMetrics';

// ==================== Activity Timeline Entry ====================

export interface ActivityEntry {
  id: string;
  timestamp: string;
  /** Short label: "Read file.ts", "Bash: npm test", "Write config.json" */
  label: string;
  /** Detail/description */
  detail?: string;
  /** Kind for icon/color */
  kind: 'tool' | 'file:read' | 'file:changed' | 'command' | 'permission' | 'notification' | 'task';
  /** Success/failure for tool commands */
  success?: boolean;
}

// ==================== Permission Queue ====================

export interface PermissionRequest {
  id: string;
  timestamp: string;
  sessionId: string;
  toolName: string;
  description: string;
  risk: 'low' | 'medium' | 'high';
  /** Function to call when approved */
  onApprove?: () => void;
  /** Function to call when denied */
  onDeny?: () => void;
}

// ==================== Task Entry (for subagent tracking) ====================

export interface TaskEntry {
  taskId: string;
  toolUseId: string;
  description: string;
  taskType: string;
  status: 'running' | 'completed' | 'error';
  summary?: string;
  startedAt: string;
  completedAt?: string;
}

// ==================== Tab Status ====================

export type TabStatus = 'idle' | 'streaming' | 'error';

// ==================== Store ====================

interface EventBusState {
  // Activity timeline (last 100 entries)
  activityLog: ActivityEntry[];
  // Permission requests awaiting user action
  permissionQueue: PermissionRequest[];
  // Notifications (snackbar/toast)
  notifications: Array<{ id: string; level: 'info' | 'warn' | 'error'; message: string; timestamp: string }>;
  // Tab status per chatId
  tabStatuses: Record<string, TabStatus>;
  // Context tracker: files read/modified by session
  fileActivity: Record<string, { reads: string[]; changes: string[] }>;
  // Subagent/task entries per chatId
  taskEntries: TaskEntry[];

  // Dynamic slash commands, skills, agents, and MCP servers reported by Claude Code via session.init
  slashCommands: string[];
  skills: string[];
  agents: string[];
  mcpServers: Array<{ name: string; status: string }>;

  // Actions
  pushEvent: (event: AppEvent, chatId: string) => void;
  dismissNotification: (id: string) => void;
  approvePermission: (id: string) => void;
  denyPermission: (id: string) => void;
  setTabStatus: (chatId: string, status: TabStatus) => void;
  addFileRead: (sessionId: string, path: string) => void;
  addFileChange: (sessionId: string, path: string) => void;
  clearActivity: () => void;
  clearTasks: () => void;
}

function activityEntry(event: AppEvent): ActivityEntry | null {
  switch (event.type) {
    case 'tool.started': {
      const e = event as ToolStartedEvent;
      return {
        id: e.id, timestamp: e.timestamp, kind: 'tool', success: undefined,
        label: `${e.toolName}: ${JSON.stringify(e.toolInput).slice(0, 80)}`,
        detail: e.files?.join(', '),
      };
    }
    case 'tool.completed': {
      const e = event as ToolCompletedEvent;
      const status = e.success ? '✓' : '✗';
      return {
        id: e.id, timestamp: e.timestamp, kind: 'tool', success: e.success,
        label: `${status} ${e.toolName} (${e.durationMs}ms)`,
        detail: e.summary?.slice(0, 80),
      };
    }
    case 'file.read': {
      const e = event as FileEvent;
      return { id: e.id, timestamp: e.timestamp, kind: 'file:read', label: `Read ${e.path.split('/').pop() || e.path.split('\\').pop() || e.path}`, detail: e.path };
    }
    case 'file.changed': {
      const e = event as FileEvent & { changeType: string };
      return { id: e.id, timestamp: e.timestamp, kind: 'file:changed', label: `${e.changeType} ${e.path.split('/').pop() || e.path.split('\\').pop() || e.path}`, detail: e.path };
    }
    case 'command.started': {
      const e = event as CommandEvent & { command: string };
      return { id: e.id, timestamp: e.timestamp, kind: 'command', label: `▶ ${e.command.slice(0, 60)}` };
    }
    case 'command.finished': {
      const e = event as CommandEvent & { exitCode: number; command: string };
      return { id: e.id, timestamp: e.timestamp, kind: 'command', success: e.exitCode === 0, label: `${e.exitCode === 0 ? '✓' : '✗'} ${e.command.slice(0, 60)}` };
    }
    case 'permission.requested': {
      const e = event as PermissionRequestedEvent;
      return { id: e.id, timestamp: e.timestamp, kind: 'permission', label: `🔒 ${e.toolName}: ${e.description.slice(0, 60)}` };
    }
    case 'task.started': {
      const e = event as TaskStartedEvent;
      return { id: e.id, timestamp: e.timestamp, kind: 'task', label: `🔀 ${e.description.slice(0, 60)}`, detail: e.taskType };
    }
    case 'task.completed': {
      const e = event as TaskCompletedEvent;
      const status = e.status === 'completed' ? '✓' : '✗';
      return { id: e.id, timestamp: e.timestamp, kind: 'task', success: e.status === 'completed', label: `${status} ${e.summary?.slice(0, 60) || e.taskId}`, detail: e.status };
    }
    default:
      return null;
  }
}

export const useEventBus = create<EventBusState>((set, get) => ({
  activityLog: [],
  permissionQueue: [],
  notifications: [],
  tabStatuses: {},
  fileActivity: {},
  taskEntries: [],
  slashCommands: [],
  skills: [],
  agents: [],
  mcpServers: [],

  pushEvent: (event, chatId) => {
    const state = get();

    // Activity log
    const entry = activityEntry(event);
    if (entry) {
      set(s => ({ activityLog: [entry, ...s.activityLog].slice(0, 100) }));
    }

    // Permission queue
    if (event.type === 'permission.requested') {
      const pe = event as PermissionRequestedEvent;
      set(s => ({
        permissionQueue: [...s.permissionQueue, {
          id: pe.id, timestamp: pe.timestamp, sessionId: pe.sessionId,
          toolName: pe.toolName, description: pe.description, risk: pe.risk,
        }],
      }));
    }

    // Notifications
    if (event.type === 'notification') {
      const ne = event as NotificationEvent;
      set(s => ({
        notifications: [...s.notifications, { id: ne.id, level: ne.level, message: ne.message, timestamp: ne.timestamp }],
      }));
    }

    // Store dynamic slash commands + skills from Claude Code init
    if (event.type === 'session.init') {
      const init = event as any;
      if (Array.isArray(init.slashCommands)) {
        set({ slashCommands: init.slashCommands });
      }
      if (Array.isArray(init.skills)) {
        set({ skills: init.skills });
      }
      if (Array.isArray(init.agents)) {
        set({ agents: init.agents });
      }
      if (Array.isArray(init.mcpServers)) {
        set({ mcpServers: init.mcpServers });
      }
    }

    // Tab status
    if (event.type === 'session.status') {
      const se = event as SessionStatusEvent;
      if (se.status === 'requesting' || se.status === 'streaming') {
        set(s => ({ tabStatuses: { ...s.tabStatuses, [chatId]: 'streaming' } }));
      }
    }
    if (event.type === 'session.compacted' || event.type === 'session.completed' || event.type === 'session.aborted') {
      set(s => ({ tabStatuses: { ...s.tabStatuses, [chatId]: 'idle' } }));
    }
    if (event.type === 'session.error') {
      set(s => ({ tabStatuses: { ...s.tabStatuses, [chatId]: 'error' } }));
    }

    // Session usage / metrics
    if (event.type === 'session.usage') {
      useSessionMetrics.getState().pushUsage(event.sessionId, {
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        cacheCreationInputTokens: event.cacheCreationInputTokens,
        cacheReadInputTokens: event.cacheReadInputTokens,
        models: event.models,
        requestCount: event.requestCount,
        totalDurationMs: event.totalDurationMs,
        turn: event.turn,
        contextWindow: event.contextWindow,
      });
    }

    // Task tracking (subagent events)
    if (event.type === 'task.started') {
      const te = event as TaskStartedEvent;
      set(s => {
        // Deduplicate: if taskId already exists, update existing instead of adding
        const existing = s.taskEntries.find(t => t.taskId === te.taskId);
        if (existing) {
          return {
            taskEntries: s.taskEntries.map(t =>
              t.taskId === te.taskId
                ? { ...t, status: 'running' as const, startedAt: te.timestamp, completedAt: undefined, summary: undefined }
                : t
            ),
          };
        }
        return {
          taskEntries: [...s.taskEntries, {
            taskId: te.taskId,
            toolUseId: te.toolUseId,
            description: te.description,
            taskType: te.taskType,
            status: 'running' as const,
            startedAt: te.timestamp,
          }],
        };
      });
    }
    if (event.type === 'task.completed') {
      const te = event as TaskCompletedEvent;
      set(s => ({
        taskEntries: s.taskEntries.map(t =>
          t.taskId === te.taskId
            ? { ...t, status: te.status === 'completed' ? 'completed' as const : 'error' as const, summary: te.summary, completedAt: te.timestamp }
            : t
        ),
      }));
    }

    // File activity tracking
    if (event.type === 'file.read') {
      const fe = event as FileEvent;
      set(s => {
        const prev = s.fileActivity[event.sessionId] || { reads: [], changes: [] };
        if (!prev.reads.includes(fe.path)) {
          return { fileActivity: { ...s.fileActivity, [event.sessionId]: { ...prev, reads: [...prev.reads, fe.path] } } };
        }
        return s;
      });
    }
    if (event.type === 'file.changed') {
      const fe = event as FileEvent & { changeType: string };
      set(s => {
        const prev = s.fileActivity[event.sessionId] || { reads: [], changes: [] };
        if (!prev.changes.includes(fe.path)) {
          return { fileActivity: { ...s.fileActivity, [event.sessionId]: { ...prev, changes: [...prev.changes, fe.path + ' (' + fe.changeType + ')'] } } };
        }
        return s;
      });
    }
  },

  dismissNotification: (id) => {
    set(s => ({ notifications: s.notifications.filter(n => n.id !== id) }));
  },

  approvePermission: (id) => {
    const req = get().permissionQueue.find(r => r.id === id);
    req?.onApprove?.();
    set(s => ({ permissionQueue: s.permissionQueue.filter(r => r.id !== id) }));
  },

  denyPermission: (id) => {
    const req = get().permissionQueue.find(r => r.id === id);
    req?.onDeny?.();
    set(s => ({ permissionQueue: s.permissionQueue.filter(r => r.id !== id) }));
  },

  setTabStatus: (chatId, status) => {
    set(s => ({ tabStatuses: { ...s.tabStatuses, [chatId]: status } }));
  },

  addFileRead: (sessionId, path) => {
    set(s => {
      const prev = s.fileActivity[sessionId] || { reads: [], changes: [] };
      if (!prev.reads.includes(path)) {
        return { fileActivity: { ...s.fileActivity, [sessionId]: { ...prev, reads: [...prev.reads, path] } } };
      }
      return s;
    });
  },

  addFileChange: (sessionId, path) => {
    set(s => {
      const prev = s.fileActivity[sessionId] || { reads: [], changes: [] };
      if (!prev.changes.includes(path)) {
        return { fileActivity: { ...s.fileActivity, [sessionId]: { ...prev, changes: [...prev.changes, path] } } };
      }
      return s;
    });
  },

  clearActivity: () => set({ activityLog: [] }),
  clearTasks: () => set({ taskEntries: [] }),
}));
