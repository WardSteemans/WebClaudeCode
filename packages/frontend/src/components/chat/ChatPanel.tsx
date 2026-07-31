import { useState, useMemo, useEffect, useRef, memo, useDeferredValue } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
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

// ==================== Question Answer Bar ====================

interface QuestionAnswerBarProps {
  question: string;
  options: Array<{ label: string; description: string }>;
  onSubmit: (answer: string) => void;
}

function QuestionAnswerBar({ question, options, onSubmit }: QuestionAnswerBarProps) {
  const [text, setText] = useState('');

  const handleClickOption = (label: string) => {
    onSubmit(label);
  };

  const handleSubmitText = () => {
    const trimmed = text.trim();
    if (trimmed) onSubmit(trimmed);
    setText('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmitText();
    }
  };

  return (
    <div className="px-4 py-3 border-t border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 shrink-0">
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
          Claude is asking a question:
        </span>
        {options.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {options.map((opt, i) => (
              <button
                key={i}
                onClick={() => handleClickOption(opt.label)}
                className="px-2.5 py-1 text-xs rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-accent-400 dark:hover:border-accent-500 text-slate-700 dark:text-slate-300 hover:text-accent-600 dark:hover:text-accent-400 transition-colors"
                title={opt.description}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2 items-center">
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your answer…"
            className="flex-1 px-3 py-1.5 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:border-accent-500 text-slate-700 dark:text-slate-300"
            autoFocus
          />
          <button
            onClick={handleSubmitText}
            disabled={!text.trim()}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-accent-600 text-white hover:bg-accent-700 disabled:opacity-40 transition-colors"
          >
            Answer
          </button>
        </div>
      </div>
    </div>
  );
}

// ==================== File Preview Block ====================

const COLLAPSE_LINES = 20;

function FilePreviewBlock({ fileName, content }: { fileName: string; content: string }) {
  const lines = content.split('\n');
  const lineCount = lines.length;
  const collapsed = lineCount > COLLAPSE_LINES;
  const [expanded, setExpanded] = useState(false);
  const displayLines = collapsed && !expanded ? lines.slice(0, COLLAPSE_LINES) : lines;
  const displayContent = displayLines.join('\n');

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden text-xs">
      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
        <span className="text-sm">📄</span>
        <span className="font-medium text-slate-700 dark:text-slate-300 truncate">{fileName}</span>
        <span className="text-[10px] text-slate-400 ml-auto shrink-0">{lineCount} {lineCount === 1 ? 'line' : 'lines'}</span>
      </div>
      <div className="max-h-[300px] overflow-auto">
        <pre className="px-3 py-2 text-[11px] leading-relaxed whitespace-pre font-mono text-slate-600 dark:text-slate-400 bg-white dark:bg-[#0d1117]">
          {displayContent}
        </pre>
      </div>
      {collapsed && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full px-3 py-1 text-[11px] text-slate-500 hover:text-accent-600 dark:hover:text-accent-400 bg-slate-50 dark:bg-slate-800/30 hover:bg-slate-100 dark:hover:bg-slate-800/50 transition-colors border-t border-slate-200 dark:border-slate-700"
        >
          {expanded ? 'Show less' : `Show all ${lineCount} lines`}
        </button>
      )}
    </div>
  );
}

// ==================== Props ====================

interface ChatPanelProps { tabId: string; chatId: string; workDir: string; }

// ==================== Component ====================

function ChatPanelInner({ tabId, chatId, workDir: _tabWorkDir }: ChatPanelProps) {
  // ── Store selectors ──
  const tab = useTabStore((s) => s.tabs.find((t) => t.id === tabId));
  const chat = tab?.chats.find((c) => c.id === chatId);
  const workDir = useMemo(() => chat?.workDir || _tabWorkDir, [chat?.workDir, _tabWorkDir]);
  const updateChatWorkDir = useTabStore((s) => s.updateChatWorkDir);

  // ── Mount/unmount logging ──
  useEffect(() => {
    console.log(`[ChatPanel] MOUNT: chat=[${chatId.slice(0,8)}] title="${chat?.title || '?'}" sessionId=[${chat?.sessionId?.slice(0,8) || 'none'}]`);
    return () => {
      console.log(`[ChatPanel] UNMOUNT: chat=[${chatId.slice(0,8)}] title="${chat?.title || '?'}"`);
    };
  }, [chatId]);

  // ── Local UI state (doesn't belong in the stream hook) ──
  const [permissionMode, setPermissionMode] = useState(chat?.permissionMode || 'default');
  const [selectedModel, setSelectedModel] = useState(chat?.model || safeGetItem('cc-gui-model') || 'claude-sonnet-4-20250514');
  const [selectedEffort, setSelectedEffort] = useState(chat?.effort || '');
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const virtuosoRef = useRef<VirtuosoHandle>(null);

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
    filesRef,
    sendWs,
    answerQuestion,
    pendingQuestionRef,
  } = useChatStream({
    tabId, chatId, workDir, permissionMode, selectedModel, selectedEffort,
    chatSessionId: chat?.sessionId ?? null,
  });

  // Defer messages during streaming so React can interrupt low-priority
  // message-list renders to handle high-priority user input (typing).
  const renderMessages = useDeferredValue(messages);

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
      <div className="flex-1">
        {renderMessages.length === 0 ? (
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
        ) : (
          <Virtuoso
            ref={virtuosoRef}
            className="px-4"
            data={renderMessages}
            followOutput={(isAtBottom) => isAtBottom ? 'smooth' : false}
            computeItemKey={(index, msg) => msg.id}
            increaseViewportBy={{ top: 200, bottom: 200 }}
            initialTopMostItemIndex={999999}
            itemContent={(index, msg) => {
              const thinkBlock = thinkingBlocks.get(msg.id);
              const isThinkingMsg = !!(msg.role === 'tool' && thinkBlock);
              const isSystemMsg = msg.role === 'system';
              const align = msg.role === 'user' ? 'ml-auto' : 'mr-auto';

              return (
                <div className={`max-w-[85%] ${align} py-3`}>
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
                        {msg.files && msg.files.length > 0 && (
                          <div className="flex flex-col gap-2 mb-2">
                            {msg.files.map((file, i) => (
                              <FilePreviewBlock key={i} fileName={file.fileName} content={file.text} />
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
            }}
            components={{
              Header: () => <div className="h-6" />,
              Footer: () => (
                <>
                  {isStreaming && (
                    <div className="flex items-center gap-2 text-xs px-1 py-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-accent-500 animate-pulse" />
                      <span className="text-slate-600 dark:text-slate-400">Processing…</span>
                      <button
                        onClick={abort}
                        className="ml-2 px-2 py-0.5 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 text-[11px] font-medium transition-colors"
                      >
                        Stop
                      </button>
                      <button
                        onClick={() => sendWs({ type: 'permission:approve', sessionId: '' })}
                        className="ml-1 px-2 py-0.5 rounded bg-green-500/10 text-green-400 hover:bg-green-500/20 text-[11px] font-medium transition-colors"
                        title="Approve the pending permission request (PTY mode)"
                      >
                        ✅ Approve
                      </button>
                      <button
                        onClick={() => sendWs({ type: 'permission:deny', sessionId: '' })}
                        className="px-2 py-0.5 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 text-[11px] font-medium transition-colors"
                        title="Deny the pending permission request (PTY mode)"
                      >
                        ❌ Deny
                      </button>
                    </div>
                  )}
                  <div className="h-6" />
                </>
              ),
            }}
          />
        )}
      </div>

      {/* Question answer bar (AskUserQuestion) */}
      {pendingQuestionRef.current && (
        <QuestionAnswerBar
          question={pendingQuestionRef.current.question}
          options={pendingQuestionRef.current.options}
          onSubmit={(answer) => answerQuestion(answer)}
        />
      )}

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
          onSubmit={() => {
            handleSend();
            setResetKey(k => k + 1);
            virtuosoRef.current?.scrollToIndex({ index: 'LAST', behavior: 'smooth' });
          }}
          disabled={isStreaming}
          onImagesChange={(imgs) => { imagesRef.current = imgs; }}
          onFilesChange={(f) => { filesRef.current = f; }}
          resetKey={resetKey}
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
