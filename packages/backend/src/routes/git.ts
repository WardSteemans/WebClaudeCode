import express from 'express';
import * as git from '../services/git.js';

function gitBase(req: { query: { base?: unknown } }): string {
  return (req.query.base as string) || process.cwd();
}

export function registerGitRoutes(app: express.Express): void {
  app.get('/api/git/status', (req, res) => {
    try { res.json(git.getStatus(gitBase(req))); } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  app.get('/api/git/diff', (req, res) => {
    try {
      const file = req.query.file as string | undefined;
      const staged = req.query.staged === 'true';
      const diff = git.getDiff(gitBase(req), file, staged);
      res.json({ diff });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  app.get('/api/git/log', (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string, 10) || 30;
      res.json(git.getLog(gitBase(req), limit));
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  app.get('/api/git/branches', (req, res) => {
    try { res.json(git.getBranches(gitBase(req))); } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  app.post('/api/git/stage', (req, res) => {
    try {
      const files: string[] = req.body.files || [];
      const out = git.stage(gitBase(req), files);
      res.json({ ok: true, output: out });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  app.post('/api/git/unstage', (req, res) => {
    try {
      const files: string[] = req.body.files || [];
      const out = git.unstage(gitBase(req), files);
      res.json({ ok: true, output: out });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  app.post('/api/git/commit', (req, res) => {
    try {
      const out = git.commit(gitBase(req), req.body.message || '');
      res.json({ ok: true, output: out });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  app.post('/api/git/push', (req, res) => {
    try { res.json({ ok: true, output: git.push(gitBase(req)) }); } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  app.post('/api/git/pull', (req, res) => {
    try { res.json({ ok: true, output: git.pull(gitBase(req)) }); } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  app.post('/api/git/fetch', (req, res) => {
    try { res.json({ ok: true, output: git.fetch(gitBase(req)) }); } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  app.post('/api/git/checkout', (req, res) => {
    try {
      const out = git.checkout(gitBase(req), req.body.branch || '');
      res.json({ ok: true, output: out });
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });

  app.post('/api/git/worktree-add', (req, res) => {
    try {
      const base = req.body.base || process.cwd();
      const branch = req.body.branch;
      const targetPath = req.body.targetPath;
      if (!branch) return res.status(400).json({ error: 'branch required' });
      const result = git.worktreeAdd(base, branch, targetPath);
      res.json(result);
    } catch (e) { res.status(500).json({ error: String(e) }); }
  });
}
