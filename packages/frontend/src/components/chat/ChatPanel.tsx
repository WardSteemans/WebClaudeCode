import { useState, useMemo, memo } from 'react';
import type { ChatMessage, ThinkingBlock } from '../../lib/chat/types';
import { formatChatTime } from '../../lib/chat/thinking-utils';
import { useTabStore } from '../../store';
import { useChatStream } from '../../hooks/useChatStream';
import { safeGetItem, safeSetItem } from '../../lib/storage';
import { MessageContent } from './MessageContent';
import { ThinkingBlockView } from './ThinkingBlock';
import { ChatToolbar } from './ChatToolbar';
import { PromptInput } from './PromptInput';
import { FolderPicker } from '../files/FolderPicker';

// ==================== Props ====================

interface ChatPanelProps { tabId: string; chatId: string; workDir: string; }

// ==================== Component ====================

function ChatPanelInner({ tabId, chatId, workDir: _tabWorkDir }: ChatPanelProps) {
  // ── Store selectors ──
  const tab = useTabStore((s) => s.tabs.find((t) => t.id === tabId));
  const chat = tab?.chats.find((c) => c.id === chatId);
  const workDir = useMemo(() => chat?.workDir || _tabWorkDir, [chat?.workDir, _tabWorkDir]);
  const updateChatWorkDir = useTabStore((s) => s.updateChatWorkDir);

  // ── Local UI state (doesn't belong in the stream hook) ──
  const [permissionMode, setPermissionMode] = useState(chat?.permissionMode || 'default');
  const [selectedModel, setSelectedModel] = useState(chat?.model || safeGetItem('cc-gui-model') || 'claude-sonnet-4-20250514');
  const [selectedEffort, setSelectedEffort] = useState(chat?.effort || '');
  const [showFolderPicker, setShowFolderPicker] = useState(false);

  // ── Streaming hook ──
  const {
    messages,
    thinkingBlocks,
    thinkingExpanded,
    collapsedSegments,
    isStreaming,
    input,
    setInput,
    messagesEndRef,
    handleSend,
    abort,
    handleSegmentClick,
    isSegmentCollapsed,
    handleToggleThinkingExpand,
    imagesRef,
  } = useChatStream({
    tabId, chatId, workDir, permissionMode, selectedModel, selectedEffort,
    chatSessionId: chat?.sessionId ?? null,
  });

  // ── Persist per-chat overrides to store ──
  const updateChatPermissionMode = useTabStore((s) => s.updateChatPermissionMode);
  const updateChatModel = useTabStore((s) => s.updateChatModel);
  const updateChatEffort = useTabStore((s) => s.updateChatEffort);

  // These are fire-and-forget effects already in the original; we use inline handlers instead
  const handlePermissionChange = (mode: string) => {
    setPermissionMode(mode);
    if (chat) updateChatPermissionMode(tabId, chatId, mode);
  };
  const handleModelChange = (model: string) => {
    setSelectedModel(model);
    safeSetItem('cc-gui-model', model);
    if (chat) updateChatModel(tabId, chatId, model);
  };
  const handleEffortChange = (effort: string) => {
    setSelectedEffort(effort);
    if (chat) updateChatEffort(tabId, chatId, effort || null);
  };

  // ── Render helpers ──

  const bubbleClass = (msg: ChatMessage, isThinkingMsg: boolean) => {
    if (msg.role === 'user') return 'bg-accent-600 text-white rounded-br-md shadow-sm';
    if (msg.role === 'assistant') return 'bg-white dark:bg-[#1a2233] text-slate-700 dark:text-slate-300 rounded-bl-md border border-slate-200 dark:border-slate-800';
    if (isThinkingMsg) return 'bg-white dark:bg-[#161b22] border border-slate-200 dark:border-slate-800 rounded-xl text-slate-600 dark:text-slate-400';
    if (msg.role === 'error') return 'bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-300 border border-red-200 dark:border-red-900/30 rounded-xl';
    if (msg.role === 'system') return 'bg-slate-100 dark:bg-slate-800/50 text-slate-500 dark:text-slate-500 border border-slate-200 dark:border-slate-800 rounded-xl text-center';
    return 'bg-white dark:bg-[#161b22] text-slate-400 dark:text-slate-500 border border-slate-200 dark:border-slate-800 rounded-xl text-center';
  };

  // ── Render ──

  return (
    <div className="flex flex-col h-full">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-slate-600 gap-2">
            <span className="text-sm">Ready in</span>
            <button
              onClick={() => setShowFolderPicker(true)}
              className="text-accent-600 dark:text-accent-400 text-xs bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
              title="Click to change work directory"
            >
              {workDir}
            </button>
          </div>
        )}
        {messages.map((msg) => {
          const thinkBlock = thinkingBlocks.get(msg.id);
          const isThinkingMsg = !!(msg.role === 'tool' && thinkBlock);
          const isSystemMsg = msg.role === 'system';
          const align = msg.role === 'user' ? 'ml-auto' : 'mr-auto';

          return (
            <div key={msg.id} className={`max-w-[85%] ${align}`}>
              <div className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${bubbleClass(msg, isThinkingMsg)}`}>
                {isThinkingMsg ? (
                  <ThinkingBlockView
                    msgId={msg.id}
                    block={thinkBlock!}
                    expanded={thinkingExpanded.has(msg.id)}
                    onToggleExpand={() => handleToggleThinkingExpand(msg.id, thinkBlock!)}
                    collapsedSegments={collapsedSegments}
                    onSegmentClick={(segId) => handleSegmentClick(segId, msg.id)}
                  />
                ) : isSystemMsg ? (
                  <span className="text-[12px]">{msg.content}</span>
                ) : msg.role === 'error' ? (
                  <span>{msg.content}</span>
                ) : (
                  <>
                    {msg.images && msg.images.length > 0 && (
                      <div className="flex gap-1.5 mb-2 flex-wrap">
                        {msg.images.map((img, i) => (
                          <img
                            key={i}
                            src={`data:${img.mediaType};base64,${img.base64}`}
                            alt="Attached"
                            className="max-w-[200px] max-h-[150px] rounded-lg object-cover"
                          />
                        ))}
                      </div>
                    )}
                    <MessageContent content={msg.content} />
                  </>
                )}
              </div>
              <div className={`text-[10px] text-slate-400 dark:text-slate-600 mt-0.5 ${msg.role === 'user' ? 'text-right' : 'text-left'} px-1`} title={new Date(msg.timestamp).toLocaleString()}>
                {formatChatTime(msg.timestamp)}
              </div>
            </div>
          );
        })}
        {isStreaming && (
          <div className="flex items-center gap-2 text-xs px-1">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-500 animate-pulse" />
            <span className="text-slate-600 dark:text-slate-400">Processing…</span>
            <button
              onClick={abort}
              className="ml-2 px-2 py-0.5 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 text-[11px] font-medium transition-colors"
            >
              Stop
            </button>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="p-3 border-t border-[var(--color-border)] bg-[var(--color-surface)] shrink-0 transition-colors">
        <ChatToolbar
          permissionMode={permissionMode}
          onPermissionModeChange={handlePermissionChange}
          selectedModel={selectedModel}
          onModelChange={handleModelChange}
          selectedEffort={selectedEffort}
          onEffortChange={handleEffortChange}
        />
        <PromptInput
          workDir={workDir}
          value={input}
          onChange={setInput}
          onSubmit={handleSend}
          disabled={isStreaming}
          onImagesChange={(imgs) => { imagesRef.current = imgs; }}
          placeholder={isStreaming ? 'Waiting for response…' : 'Send a prompt…'}
        />
      </div>

      {showFolderPicker && (
        <FolderPicker
          initialPath={workDir}
          onSelect={(path) => {
            setShowFolderPicker(false);
            if (path && path !== workDir) updateChatWorkDir(tabId, chatId, path);
          }}
          onClose={() => setShowFolderPicker(false)}
        />
      )}
    </div>
  );
}

export const ChatPanel = memo(ChatPanelInner);
