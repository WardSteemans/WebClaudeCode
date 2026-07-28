import { useState, useEffect, useCallback, useRef } from 'react';
import { Folder, File, ChevronRight, ArrowUp, RotateCw, X, HardDrive, Search } from 'lucide-react';

interface FolderPickerProps {
  initialPath?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}

interface FsEntry {
  name: string;
  path: string;
  type: 'directory' | 'file';
  size?: number;
}

const DRIVE_RE = /^[A-Za-z]:\\?$/;

/**
 * Modal folder browser — uses ONLY the backend /api/fs/list API.
 * No browser file APIs (no showDirectoryPicker, no webkitdirectory).
 * We only need the path string, the backend does all file I/O.
 */
export function FolderPicker({ initialPath, onSelect, onClose }: FolderPickerProps) {
  const [currentDir, setCurrentDir] = useState('');
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drives, setDrives] = useState<string[] | null>(null);
  const [typedPath, setTypedPath] = useState(initialPath || '');
  const inputRef = useRef<HTMLInputElement>(null);
  const [isBrowsing, setIsBrowsing] = useState(false);

  // Detect drives on mount (Windows) or show root
  useEffect(() => {
    async function detectDrives() {
      try {
        const res = await fetch('/api/fs/drives');
        if (!res.ok) return;
        const data = await res.json();
        if (data.drives && data.drives.length > 0) setDrives(data.drives);
      } catch { /* best-effort */ }
    }
    if (!initialPath) detectDrives();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load initial path if provided
  useEffect(() => {
    if (initialPath) {
      setTypedPath(initialPath);
      loadDir(initialPath);
      setIsBrowsing(true);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadDir = useCallback(async (dir: string) => {
    if (!dir) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/fs/list?dir=' + encodeURIComponent(dir));
      if (!res.ok) {
        const msg = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(msg.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setEntries(data.entries || []);
      setCurrentDir(data.dir || dir);
      setTypedPath(data.dir || dir);
      setIsBrowsing(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const navigateTo = (dir: string) => loadDir(dir);

  const goUp = () => {
    if (!currentDir) return;
    const parent = getParentDir(currentDir);
    if (parent !== currentDir) loadDir(parent);
  };

  const handleGoClick = () => {
    const val = typedPath.trim();
    if (val) loadDir(val);
  };

  const startBrowsing = () => {
    if (drives && drives.length > 0) {
      // Show drives as the first browsing level
      setIsBrowsing(true);
      setCurrentDir('');
      setEntries([]);
    } else {
      // Try common root (Unix/macOS: /home, /)
      loadDir('/');
    }
  };

  const dirs = entries.filter((e) => e.type === 'directory');
  const files = entries.filter((e) => e.type === 'file');
  const isRoot = !currentDir || currentDir === '' || currentDir === '/' || DRIVE_RE.test(currentDir);
  const showLanding = !isBrowsing && !loading && !error && entries.length === 0 && !initialPath;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
      tabIndex={-1}
    >
      <div className="bg-[#1a1d23] border border-gray-700 rounded-xl shadow-2xl w-[600px] max-w-[90vw] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 shrink-0">
          <h2 className="text-sm font-semibold text-gray-200">Select folder</h2>
          <button onClick={onClose} className="p-1 text-gray-500 hover:text-gray-300 hover:bg-gray-700 rounded-md transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Path bar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-700/50 shrink-0">
          <div className="flex-1 flex items-center gap-1 bg-gray-800 border border-gray-600 rounded-md px-2 py-1">
            <input
              ref={inputRef}
              type="text"
              value={typedPath}
              onChange={(e) => setTypedPath(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleGoClick(); }}
              className="flex-1 bg-transparent text-xs text-gray-200 outline-none placeholder-gray-500 font-mono"
              placeholder="Type of plak een pad, bv. D:/projecten/mijn-project"
            />
            {loading && <RotateCw size={12} className="text-gray-500 animate-spin shrink-0" />}
          </div>
          <button
            onClick={handleGoClick}
            disabled={!typedPath.trim()}
            className="px-2.5 py-1 text-xs font-medium bg-accent-600 hover:bg-accent-500 text-white rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="Ga naar pad"
          >
            <Search size={14} />
          </button>
          <button
            onClick={goUp}
            disabled={isRoot || !currentDir}
            className="p-1.5 text-gray-400 hover:text-gray-200 hover:bg-gray-700 rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Omhoog"
          >
            <ArrowUp size={16} />
          </button>
          <button
            onClick={() => currentDir && loadDir(currentDir)}
            disabled={!currentDir}
            className="p-1.5 text-gray-400 hover:text-gray-200 hover:bg-gray-700 rounded-md transition-colors disabled:opacity-30"
            title="Ververs"
          >
            <RotateCw size={16} />
          </button>
        </div>

        {/* Breadcrumb */}
        {currentDir && (
          <div className="flex items-center gap-1 px-4 py-1 border-b border-gray-700/30 shrink-0 overflow-x-auto">
            {renderBreadcrumbs(currentDir, navigateTo)}
          </div>
        )}

        {/* Content area */}
        <div className="flex-1 overflow-y-auto px-2 py-1 min-h-[260px]">
          {/* Error */}
          {error && (
            <div className="flex flex-col items-center justify-center h-full text-center px-6">
              <p className="text-red-400 text-xs mb-3">{error}</p>
              <button onClick={() => currentDir && loadDir(currentDir)} className="text-xs text-accent-400 hover:underline">
                Opnieuw proberen
              </button>
            </div>
          )}

          {/* LANDING: nothing loaded yet */}
          {showLanding && (
            <div className="flex flex-col items-center justify-center h-full text-center px-8 gap-5">
              <div className="w-14 h-14 rounded-xl bg-gray-800 border border-gray-700 flex items-center justify-center">
                <Folder size={28} className="text-amber-400" />
              </div>
              <div>
                <p className="text-sm text-gray-300 font-medium mb-1">Open een projectfolder</p>
                <p className="text-xs text-gray-500 max-w-xs">
                  Type een pad in het veld hierboven en druk op Enter, of klik op <strong>Bladeren</strong> om te navigeren.
                </p>
              </div>

              <button
                onClick={startBrowsing}
                className="flex items-center gap-2 px-5 py-2.5 bg-accent-600 hover:bg-accent-500 text-white rounded-lg text-sm font-medium transition-all shadow-lg shadow-accent-900/30"
              >
                <Folder size={16} />
                Bladeren door mappen…
              </button>

              <p className="text-[10px] text-gray-600">
                Of plak een pad in het veld hierboven
              </p>
            </div>
          )}

          {/* Drives (Windows) — getoond bij start van bladeren */}
          {!error && drives && isBrowsing && !currentDir && !loading && (
            <div className="flex flex-col items-center justify-center h-full">
              <div className="w-full max-w-xs">
                <p className="text-[10px] text-gray-500 uppercase tracking-wider px-2 pb-2 text-center">Kies een schijf</p>
                {drives.map((d) => (
                  <button
                    key={d}
                    onClick={() => navigateTo(d)}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm text-gray-300 hover:bg-gray-700/50 transition-colors text-left"
                  >
                    <HardDrive size={18} className="text-blue-400 shrink-0" />
                    <span className="font-medium">{d}</span>
                    <ChevronRight size={16} className="text-gray-600 ml-auto shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Lege directory */}
          {!error && !loading && isBrowsing && currentDir && dirs.length === 0 && files.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center px-6">
              <Folder size={32} className="text-gray-600 mb-2" />
              <p className="text-gray-500 text-xs">Deze map is leeg</p>
            </div>
          )}

          {/* Directory listing */}
          {!error && dirs.length > 0 && (
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider px-2 pt-2 pb-1">Mappen</p>
              {dirs.map((entry) => (
                <button
                  key={entry.path}
                  onClick={() => navigateTo(entry.path)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-gray-300 hover:bg-gray-700/50 transition-colors text-left group"
                  title={entry.path}
                >
                  <Folder size={16} className="text-amber-400 shrink-0" />
                  <span className="truncate">{entry.name}</span>
                  <ChevronRight size={14} className="text-gray-600 ml-auto shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              ))}
            </div>
          )}

          {/* Bestanden */}
          {!error && files.length > 0 && (
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider px-2 pt-3 pb-1">Bestanden</p>
              {files.map((entry) => (
                <div
                  key={entry.path}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-500"
                  title={entry.path}
                >
                  <File size={14} className="text-gray-600 shrink-0" />
                  <span className="truncate">{entry.name}</span>
                  {entry.size !== undefined && (
                    <span className="text-[10px] text-gray-600 ml-auto shrink-0">{formatSize(entry.size)}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center h-full">
              <div className="flex items-center gap-2 text-gray-500 text-xs">
                <RotateCw size={14} className="animate-spin" />
                Laden…
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-gray-700 shrink-0">
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <Folder size={12} className="text-amber-400" />
            <span className="font-mono truncate max-w-[260px]">{currentDir || '(geen)'}</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-700 rounded-md transition-colors">
              Annuleren
            </button>
            <button
              onClick={() => { if (currentDir) onSelect(currentDir); }}
              disabled={!currentDir || loading}
              className="px-4 py-1.5 text-xs font-medium bg-accent-600 hover:bg-accent-500 text-white rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Selecteer map
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Helpers ---

function getParentDir(dir: string): string {
  if (DRIVE_RE.test(dir)) return '';
  if (!dir || dir === '/' || dir === '') return '';

  const normalized = dir.replace(/\\/g, '/').replace(/\/$/, '');
  const idx = normalized.lastIndexOf('/');
  if (idx <= 0) {
    return dir.match(/^[A-Za-z]:/i) ? dir.charAt(0).toUpperCase() + ':\\' : '/';
  }
  const parent = normalized.slice(0, idx);
  if (/^[A-Za-z]$/.test(parent)) return parent + ':\\';
  return parent;
}

function renderBreadcrumbs(path: string, navigate: (dir: string) => void) {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  const crumbs: { label: string; path: string }[] = [];

  if (/^[A-Za-z]:\\?$/i.test(path)) {
    crumbs.push({ label: path.replace(/\\$/, ''), path });
  } else if (path.startsWith('/')) {
    crumbs.push({ label: '/', path: '/' });
  }

  let accumulated = '';
  for (let i = 0; i < parts.length; i++) {
    if (i === 0 && /^[A-Za-z]:$/.test(parts[i])) {
      accumulated = parts[i] + '\\';
      crumbs.push({ label: parts[i] + '\\', path: accumulated });
    } else {
      accumulated = i === 0 ? parts[i] : accumulated + '/' + parts[i];
      crumbs.push({ label: parts[i], path: accumulated });
    }
  }

  return crumbs.map((crumb, i) => (
    <span key={crumb.path} className="flex items-center gap-1">
      {i > 0 && <ChevronRight size={10} className="text-gray-600 shrink-0" />}
      <button onClick={() => navigate(crumb.path)} className="text-[11px] text-gray-400 hover:text-accent-400 whitespace-nowrap transition-colors">
        {crumb.label}
      </button>
    </span>
  ));
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
