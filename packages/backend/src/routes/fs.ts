import express from 'express';
import { readdirSync, statSync, readFileSync, existsSync } from 'fs';
import { join, resolve, normalize } from 'path';

const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
  json: 'json', css: 'css', html: 'html', md: 'markdown',
  py: 'python', rs: 'rust', go: 'go', java: 'java', c: 'c',
  cpp: 'cpp', h: 'c', sh: 'bash', yml: 'yaml', yaml: 'yaml',
  xml: 'xml', sql: 'sql', graphql: 'graphql', toml: 'toml',
  env: 'plaintext', gitignore: 'plaintext', dockerfile: 'dockerfile',
};

function getLanguage(filepath: string): string {
  const ext = filepath.split('.').pop()?.toLowerCase();
  return ext ? EXT_TO_LANG[ext] || 'plaintext' : 'plaintext';
}

function isSafe(baseDir: string, targetPath: string): boolean {
  const resolved = resolve(baseDir, normalize(targetPath));
  return resolved.startsWith(resolve(baseDir));
}

export function registerFsRoutes(app: express.Express): void {
  app.get('/api/fs/list', (req, res) => {
    const dir = req.query.dir as string | undefined;
    if (!dir) return res.status(400).json({ error: 'dir query param required' });

    // If an explicit base is provided, enforce path safety.
    // Otherwise (when no base), allow browsing anywhere — used by FolderPicker.
    if (typeof req.query.base === 'string') {
      if (!isSafe(req.query.base, dir)) return res.status(403).json({ error: 'Path traversal denied' });
    }

    try {
      const entries = readdirSync(dir, { withFileTypes: true }).map((e) => ({
        name: e.name,
        path: join(dir, e.name),
        type: e.isDirectory() ? 'directory' as const : 'file' as const,
        size: e.isFile() ? statSync(join(dir, e.name)).size : undefined,
      }));
      entries.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      res.json({ entries, dir });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Get available drives (Windows) or root paths (Unix)
  // Used by the folder picker to show a starting list of roots.
  app.get('/api/fs/drives', (_req, res) => {
    try {
      const roots: string[] = [];
      const isWin = process.platform === 'win32';

      if (isWin) {
        for (let i = 65; i <= 90; i++) {
          const drive = String.fromCharCode(i) + ':\\';
          try {
            if (existsSync(drive)) roots.push(drive);
          } catch { /* inaccessible */ }
        }
      } else {
        roots.push('/');
        if (process.env.HOME) roots.push(process.env.HOME);
      }

      res.json({ drives: roots });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get('/api/fs/read', (req, res) => {
    const file = req.query.file as string | undefined;
    if (!file) return res.status(400).json({ error: 'file query param required' });

    const baseDir = typeof req.query.base === 'string' ? req.query.base : process.cwd();
    if (!isSafe(baseDir, file)) return res.status(403).json({ error: 'Path traversal denied' });

    try {
      const content = readFileSync(file, 'utf-8');
      res.json({ path: file, content, language: getLanguage(file) });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });
}
