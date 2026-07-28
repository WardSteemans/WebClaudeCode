import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { SLASH_COMMANDS, SlashCommand } from '../data/commands';
import { useEventBus } from '../store/eventBus';

// ==================== Types ====================

interface PromptInputProps {
  workDir: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  placeholder?: string;
}

interface AutocompleteState {
  type: 'command' | 'file';
  /** The partial query being typed (without / or @) */
  query: string;
  /** Character position in the textarea where the trigger starts */
  triggerStart: number;
  /** Character position where the query ends (cursor position) */
  triggerEnd: number;
}

interface FileSuggestion {
  name: string;
  path: string;
  type: 'file' | 'directory';
}

// ==================== Tokenizer ====================

interface Token {
  text: string;
  type: 'normal' | 'command' | 'file';
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  // Match: /command (word chars + hyphens) or @path (non-whitespace)
  const regex = /(\/[a-zA-Z][\w-]*|@\S+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ text: text.slice(lastIndex, match.index), type: 'normal' });
    }
    const raw = match[1];
    tokens.push({
      text: raw,
      type: raw.startsWith('/') ? 'command' : 'file',
    });
    lastIndex = match.index + raw.length;
  }
  if (lastIndex < text.length) {
    tokens.push({ text: text.slice(lastIndex), type: 'normal' });
  }
  return tokens;
}

// ==================== Helpers ====================

/** Find the / or @ trigger around the cursor */
function findAutocompleteTrigger(
  text: string,
  cursorPos: number,
): AutocompleteState | null {
  // Look backwards from cursor to find start of trigger
  let i = cursorPos - 1;
  while (i >= 0 && text[i] !== ' ' && text[i] !== '\n') i--;
  const wordStart = i + 1;
  const word = text.slice(wordStart, cursorPos);

  // /command trigger — allow partial after /
  if (word.startsWith('/') && word.length >= 1 && !word.includes(' ')) {
    // Don't trigger if it looks like a path (contains . or more slashes)
    if (word.includes('.')) return null;
    return {
      type: 'command',
      query: word.slice(1), // remove leading /
      triggerStart: wordStart,
      triggerEnd: cursorPos,
    };
  }

  // @file trigger — allow partial after @
  if (word.startsWith('@') && word.length >= 1 && !word.includes(' ')) {
    return {
      type: 'file',
      query: word.slice(1), // remove leading @
      triggerStart: wordStart,
      triggerEnd: cursorPos,
    };
  }

  return null;
}

// ==================== Component ====================

export function PromptInput({
  workDir,
  value,
  onChange,
  onSubmit,
  disabled,
  placeholder,
}: PromptInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [autocomplete, setAutocomplete] = useState<AutocompleteState | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [fileSuggestions, setFileSuggestions] = useState<FileSuggestion[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  // ── Dynamic slash commands from Claude Code (merged with static list) ──
  const dynamicSlashCommands = useEventBus((s) => s.slashCommands);
  const allCommands: SlashCommand[] = useMemo(() => {
    // Start with the static curated list
    const merged = new Map<string, SlashCommand>();
    for (const cmd of SLASH_COMMANDS) {
      merged.set(cmd.name, cmd);
    }
    // Add any dynamic commands not already in the static list
    for (const name of dynamicSlashCommands) {
      if (!merged.has(name)) {
        merged.set(name, {
          name,
          description: `Claude Code slash command`,
          category: 'other',
        });
      }
    }
    return Array.from(merged.values());
  }, [dynamicSlashCommands]);

  // ── Sync scroll between textarea and overlay ──
  const syncScroll = useCallback(() => {
    if (textareaRef.current && overlayRef.current) {
      overlayRef.current.scrollTop = textareaRef.current.scrollTop;
      overlayRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  }, []);

  // ── Tokenize the current value ──
  const tokens = useMemo(() => tokenize(value), [value]);

  // ── Handle input changes ──
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      onChange(newValue);
      syncScroll();

      // Check for autocomplete triggers
      const cursor = e.target.selectionStart;
      const trigger = findAutocompleteTrigger(newValue, cursor);
      setAutocomplete(trigger);
      setSelectedIndex(0);

      if (trigger?.type === 'file') {
        fetchFileSuggestions(trigger.query);
      }
    },
    [onChange, syncScroll],
  );

  // ── Handle cursor movement (click only — not onKeyUp to avoid resetting selectedIndex) ──
  const handleCursorChange = useCallback(
    (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
      const cursor = (e.target as HTMLTextAreaElement).selectionStart;
      const trigger = findAutocompleteTrigger(value, cursor);
      // Only reset selectedIndex if the trigger actually changed
      setAutocomplete((prev) => {
        const sameTrigger =
          prev?.type === trigger?.type &&
          prev?.triggerStart === trigger?.triggerStart &&
          prev?.query === trigger?.query;
        if (!sameTrigger) setSelectedIndex(0);
        return trigger;
      });
      if (trigger?.type === 'file') {
        fetchFileSuggestions(trigger.query);
      }
    },
    [value],
  );

  // ── Fetch file suggestions from the backend ──
  const fetchFileSuggestions = useCallback(
    async (query: string) => {
      setLoadingFiles(true);
      try {
        // Determine the directory to search
        let dir = workDir;
        if (query.includes('/')) {
          const lastSlash = query.lastIndexOf('/');
          const prefix = query.slice(0, lastSlash);
          dir = `${workDir}/${prefix}`.replace(/\/+/g, '/');
        }

        const url = `/api/fs/list?base=${encodeURIComponent(workDir)}&dir=${encodeURIComponent(dir)}`;
        const res = await fetch(url);
        if (!res.ok) { setFileSuggestions([]); return; }
        const data = await res.json();
        const entries: FileSuggestion[] = (data.entries || [])
          .filter((e: FileSuggestion) => {
            // Filter by the search query (filename part)
            const namePart = query.includes('/') ? query.slice(query.lastIndexOf('/') + 1) : query;
            if (!namePart) return true;
            return e.name.toLowerCase().includes(namePart.toLowerCase());
          })
          .slice(0, 20);
        setFileSuggestions(entries);
      } catch {
        setFileSuggestions([]);
      } finally {
        setLoadingFiles(false);
      }
    },
    [workDir],
  );

  // ── Apply autocomplete selection ──
  const applyAutocomplete = useCallback(
    (selection: string) => {
      if (!autocomplete) return;
      // Replace the trigger + partial query with the full selection
      const prefix = autocomplete.type === 'command' ? '/' : '@';
      const before = value.slice(0, autocomplete.triggerStart);
      const after = value.slice(autocomplete.triggerEnd);
      const newValue = before + prefix + selection + ' ' + after;
      onChange(newValue);
      setAutocomplete(null);
      setSelectedIndex(0);

      // Focus back on textarea and set cursor after the inserted text
      setTimeout(() => {
        if (textareaRef.current) {
          const newCursor = before.length + prefix.length + selection.length + 1;
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(newCursor, newCursor);
        }
      }, 0);
    },
    [autocomplete, value, onChange],
  );

  // ── Dismiss autocomplete ──
  const dismissAutocomplete = useCallback(() => {
    setAutocomplete(null);
    setSelectedIndex(0);
  }, []);

  // ── Keyboard handling ──
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Command palette: Ctrl+K / Cmd+K
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }

      // Autocomplete keyboard nav
      if (autocomplete) {
        const suggestions = getFilteredSuggestions(autocomplete, fileSuggestions, allCommands);

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, suggestions.length - 1));
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          if (suggestions[selectedIndex]) {
            e.preventDefault();
            applyAutocomplete(suggestions[selectedIndex]);
            return;
          }
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          dismissAutocomplete();
          return;
        }
      }

      // Normal submit: Enter without Shift
      if (e.key === 'Enter' && !e.shiftKey && !autocomplete) {
        e.preventDefault();
        onSubmit();
      }
    },
    [autocomplete, fileSuggestions, selectedIndex, applyAutocomplete, dismissAutocomplete, onSubmit, allCommands],
  );

  // ── Compute filtered suggestions ──
  const suggestions = useMemo(() => {
    if (!autocomplete) return [];
    return getFilteredSuggestions(autocomplete, fileSuggestions, allCommands);
  }, [autocomplete, fileSuggestions, allCommands]);

  // ── Recompute selectedIndex when suggestions change ──
  useEffect(() => {
    setSelectedIndex(0);
  }, [suggestions.length]);

  // ── Scroll selected item into view ──
  useEffect(() => {
    if (!dropdownRef.current || !autocomplete || suggestions.length === 0) return;
    const items = dropdownRef.current.querySelectorAll('button');
    const selected = items[selectedIndex] as HTMLElement | undefined;
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex, autocomplete, suggestions.length]);

  // ── Close dropdown on outside click ──
  useEffect(() => {
    if (!autocomplete) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        dismissAutocomplete();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [autocomplete, dismissAutocomplete]);

  // ── Render ──

  const showDropdown = autocomplete && suggestions.length > 0;

  return (
    <>
      {/* Command Palette Modal */}
      {commandPaletteOpen && (
        <CommandPalette
          workDir={workDir}
          commands={allCommands}
          onSelect={(cmd) => {
            onChange((value ? value + ' ' : '') + '/' + cmd);
            setCommandPaletteOpen(false);
            textareaRef.current?.focus();
          }}
          onClose={() => {
            setCommandPaletteOpen(false);
            textareaRef.current?.focus();
          }}
        />
      )}

      <div className="relative flex gap-2">
        {/* Input container */}
        <div className="relative flex-1 bg-[var(--color-input-bg)] border border-[var(--color-border)] rounded-lg">
          {/* Syntax highlight overlay */}
          <div
            ref={overlayRef}
            aria-hidden
            className="absolute inset-0 px-3 py-2 text-sm font-sans leading-relaxed whitespace-pre-wrap break-words overflow-hidden pointer-events-none select-none"
            style={{
              // Must match textarea styling exactly
              fontFamily: 'inherit',
              lineHeight: '1.625',
            }}
          >
            {tokens.map((token, i) => (
              <span
                key={i}
                className={
                  token.type === 'command'
                    ? 'text-purple-600 dark:text-purple-400 font-medium'
                    : token.type === 'file'
                    ? 'text-amber-600 dark:text-amber-400 font-medium'
                    : ''
                }
              >
                {token.text}
              </span>
            ))}
            {/* Invisible spacer to keep overlay same height as textarea */}
            {'\n'}
          </div>

          {/* Actual textarea */}
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onClick={handleCursorChange}
            onKeyDown={handleKeyDown}
            onScroll={syncScroll}
            placeholder={placeholder}
            disabled={disabled}
            rows={2}
            className="relative z-10 w-full px-3 py-2 text-sm bg-transparent resize-none focus:outline-none placeholder-[var(--color-text-muted)] disabled:opacity-40"
            style={{
              color: 'transparent',
              caretColor: 'var(--color-text, #1e293b)',
              fontFamily: 'inherit',
              lineHeight: '1.625',
            }}
          />
        </div>

        {/* Send button */}
        <button
          onClick={onSubmit}
          disabled={!value.trim() || disabled}
          className="px-5 py-2 bg-accent-600 hover:bg-accent-500 disabled:bg-[var(--color-input-bg)] disabled:text-[var(--color-text-muted)] rounded-xl text-sm font-medium transition-all shrink-0 shadow-sm shadow-accent-900/30"
        >
          Send
        </button>

        {/* Autocomplete dropdown */}
        {showDropdown && (
          <div
            ref={dropdownRef}
            className="absolute bottom-full left-0 mb-1 w-[min(420px,90vw)] max-h-72 overflow-y-auto bg-white dark:bg-[#1a2233] border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl z-50"
          >
            {loadingFiles && autocomplete?.type === 'file' && (
              <div className="px-3 py-2 text-xs text-slate-500">Loading...</div>
            )}
            {!loadingFiles &&
              suggestions.map((s, i) => {
                const isFile = autocomplete?.type === 'file';
                const isSelected = i === selectedIndex;
                return (
                  <button
                    key={isFile ? s : s}
                    onClick={() => applyAutocomplete(s)}
                    onMouseEnter={() => setSelectedIndex(i)}
                    className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors min-w-0 ${
                      isSelected
                        ? 'bg-accent-600/10 text-accent-600 dark:text-accent-400'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    {isFile ? (
                      <>
                        <span className="text-[10px] shrink-0">
                          {s.endsWith('/') || s === 'Loading...' ? '📁' : '📄'}
                        </span>
                        <span className="truncate">{s}</span>
                      </>
                    ) : (
                      <>
                        <span className="text-[10px] shrink-0">⚡</span>
                        <span className="truncate font-medium">/{s}</span>
                        <span className="text-[10px] text-slate-400 ml-auto shrink-0 truncate max-w-[55%]">
                          {allCommands.find((c) => c.name === s)?.description}
                        </span>
                      </>
                    )}
                  </button>
                );
              })}
          </div>
        )}
      </div>
    </>
  );
}

// ==================== Filtered suggestions ====================

function getFilteredSuggestions(
  ac: AutocompleteState,
  fileSuggestions: FileSuggestion[],
  commands: SlashCommand[],
): string[] {
  if (ac.type === 'command') {
    return commands.filter(
      (c) => !ac.query || c.name.toLowerCase().includes(ac.query.toLowerCase()),
    ).map((c) => c.name);
  }

  // File suggestions: show full path relative to workDir
  return fileSuggestions.map((f) => {
    const suffix = f.type === 'directory' ? '/' : '';
    return f.name + suffix;
  });
}

// ==================== Command Palette ====================

interface CommandPaletteProps {
  workDir: string;
  onSelect: (command: string) => void;
  onClose: () => void;
  commands: SlashCommand[];
}

function CommandPalette({ onSelect, onClose, commands }: CommandPaletteProps) {
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const filtered = useMemo(() => {
    if (!search) return commands;
    const q = search.toLowerCase();
    return commands.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q),
    );
  }, [search]);

  const categories = useMemo(() => {
    const cats = new Map<string, SlashCommand[]>();
    for (const cmd of filtered) {
      const list = cats.get(cmd.category) || [];
      list.push(cmd);
      cats.set(cmd.category, list);
    }
    return cats;
  }, [filtered]);

  const handleSelect = (name: string) => {
    onSelect(name);
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-[520px] max-h-[60vh] bg-white dark:bg-[#1a2233] border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl overflow-hidden flex flex-col">
        {/* Search input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <span className="text-slate-400 text-sm">⚡</span>
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search commands..."
            className="flex-1 bg-transparent text-sm text-slate-700 dark:text-slate-300 placeholder-slate-400 focus:outline-none"
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
            }}
          />
          <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500">
            Esc
          </kbd>
        </div>

        {/* Command list */}
        <div className="overflow-y-auto p-2">
          {Array.from(categories.entries()).map(([category, cmds]) => (
            <div key={category} className="mb-2">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 px-3 py-1">
                {category}
              </div>
              {cmds.map((cmd) => (
                <button
                  key={cmd.name}
                  onClick={() => handleSelect(cmd.name)}
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-3 transition-colors group"
                >
                  <span className="text-sm font-medium text-purple-600 dark:text-purple-400 shrink-0">
                    /{cmd.name}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400 truncate">
                    {cmd.description}
                  </span>
                  {cmd.example && (
                    <span className="text-[10px] text-slate-400 ml-auto shrink-0 hidden sm:inline font-mono">
                      {cmd.example}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="text-center text-sm text-slate-400 py-8">
              No commands found
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
