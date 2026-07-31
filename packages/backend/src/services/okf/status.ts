import { readdirSync, statSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { OKF_CACHE_DIR } from '@cc-gui/shared';
import type { OkfStatus, OkfFileEntry } from '@cc-gui/shared';
import { getOkfProjectRoot, isOkfWatcherActive } from './watcher.js';

function parseFrontmatter(content: string): { type: string; name: string; filepath: string; dependencies: string[]; exports: string[] } {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  const defaults = { type: 'unknown', name: 'unknown', filepath: 'unknown', dependencies: [] as string[], exports: [] as string[] };

  if (!match) return defaults;

  const yaml = match[1];
  const lines = yaml.split('\n');

  for (const line of lines) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (!kv) continue;
    const [, key, value] = kv;
    switch (key) {
      case 'type': defaults.type = value.replace(/"/g, ''); break;
      case 'name': defaults.name = value.replace(/"/g, ''); break;
      case 'filepath': defaults.filepath = value.replace(/"/g, ''); break;
      case 'dependencies': defaults.dependencies = parseInlineArray(value); break;
      case 'exports': defaults.exports = parseInlineArray(value); break;
    }
  }

  return defaults;
}

function parseInlineArray(value: string): string[] {
  // Parse YAML inline array: ["a", "b", "c"] or [item1, item2]
  const inner = value.replace(/^\[|\]$/g, '').trim();
  if (!inner) return [];
  return inner.split(',').map(s => s.trim().replace(/^"|"$/g, '')).filter(s => s.length > 0);
}

export function getOkfStatus(): OkfStatus {
  const projectRoot = getOkfProjectRoot();
  const cacheDir = join(projectRoot, OKF_CACHE_DIR);
  const now = Date.now();

  const files: OkfFileEntry[] = [];

  if (!existsSync(cacheDir)) {
    return {
      watcherActive: isOkfWatcherActive(), // watcher can be active even without cache yet
      projectRoot,
      cacheDir,
      totalFiles: 0,
      totalEntities: 0,
      oldestAgeSeconds: null,
      files: [],
      generatedAt: new Date().toISOString(),
    };
  }

  const entries = readdirSync(cacheDir).filter(f => f.endsWith('.okf.md'));
  let totalEntities = 0;
  let oldestAge: number | null = null;

  for (const entry of entries.sort()) {
    const filepath = join(cacheDir, entry);
    try {
      const content = readFileSync(filepath, 'utf-8');
      const stat = statSync(filepath);
      const ageSeconds = Math.round((now - stat.mtimeMs) / 1000);
      const fm = parseFrontmatter(content);

      totalEntities++;

      if (oldestAge === null || ageSeconds > oldestAge) {
        oldestAge = ageSeconds;
      }

      files.push({
        cacheFile: entry,
        entityName: fm.name,
        type: fm.type,
        sourceFile: fm.filepath,
        exportCount: fm.exports.length,
        dependencyCount: fm.dependencies.length,
        sizeBytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        ageSeconds,
      });
    } catch {
      // skip corrupted files
    }
  }

  return {
    watcherActive: isOkfWatcherActive(),
    projectRoot,
    cacheDir,
    totalFiles: entries.length,
    totalEntities,
    oldestAgeSeconds: oldestAge,
    files,
    generatedAt: new Date().toISOString(),
  };
}
