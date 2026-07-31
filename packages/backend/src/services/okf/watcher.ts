import { watch, type FSWatcher } from 'chokidar';
import { existsSync } from 'fs';
import { join } from 'path';
import { extractToOkf, extractAllSourceFiles, isSourceFile } from './extractor.js';

let watcher: FSWatcher | null = null;

export function isOkfWatcherActive(): boolean {
  return watcher !== null;
}
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let currentProjectRoot: string = process.cwd();

export function getOkfProjectRoot(): string {
  return currentProjectRoot;
}

export function setOkfProjectRoot(root: string): void {
  if (root === currentProjectRoot) return;
  stopOkfWatcher();
  currentProjectRoot = root;
  startOkfWatcher();
}

export function startOkfWatcher(projectRoot?: string): void {
  if (projectRoot) currentProjectRoot = projectRoot;
  const root = currentProjectRoot;

  if (watcher) return;

  // Seed cache on startup
  extractAllSourceFiles(root);

  const watchPaths = ['src', 'packages'].map(d => join(root, d));
  const dirs = watchPaths.filter(d => existsSync(d));
  if (dirs.length === 0) return;

  watcher = watch(dirs, {
    ignored: [
      /(^|[/\\])node_modules([/\\]|$)/,
      /(^|[/\\])\.okf_cache([/\\]|$)/,
      /(^|[/\\])\.git([/\\]|$)/,
      /(^|[/\\])bin([/\\]|$)/,
      /(^|[/\\])obj([/\\]|$)/,
      /(^|[/\\])dist([/\\]|$)/,
    ],
    ignoreInitial: true,
    persistent: true,
  });

  watcher.on('add', (filepath: string) => handleChange(filepath));
  watcher.on('change', (filepath: string) => handleChange(filepath));
  watcher.on('unlink', (filepath: string) => {
    // Remove the corresponding OKF file on deletion
    // Silence for now — stale cache entries are harmless and get cleaned on next seed
  });

  function handleChange(filepath: string): void {
    if (!isSourceFile(filepath)) return;

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      try {
        extractToOkf(filepath, root);
      } catch {
        // Silently skip files we can't parse
      }
    }, 1000);
  }
}

export function stopOkfWatcher(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}
