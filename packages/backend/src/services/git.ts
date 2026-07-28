import { execSync } from 'child_process';
import { createLogger } from '../logger.js';

const log = createLogger('git');

function git(cwd: string, args: string[]): string {
  const command = `git ${args.join(' ')}`;
  const mark = log.mark('git', { command: command.slice(0, 200), cwd });
  try {
    const out = execSync(command, { cwd, maxBuffer: 10 * 1024 * 1024, shell: true } as any).toString();
    const result = out.replace(/\r/g, '').replace(/\n+$/, '').replace(/^\n+/, '');
    mark.end({ exitCode: 0, outputLen: result.length });
    return result;
  } catch (err: any) {
    mark.end({ exitCode: err.status, error: err.message?.slice(0, 200) });
    return '';
  }
}

export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  changes: { file: string; status: string; staged: boolean; added: number; deleted: number }[];
  clean: boolean;
  isWorktree: boolean;
  worktreePath?: string;
  mainWorktree?: string;
}

export function getStatus(cwd: string): GitStatus {
  const branch = git(cwd, ['rev-parse --abbrev-ref HEAD']) || 'unknown';
  const ahead = parseInt(git(cwd, ['rev-list --count HEAD...@{upstream}']) || '0', 10);
  const behind = parseInt(git(cwd, ['rev-list --count @{upstream}...HEAD']) || '0', 10);

  // Detect worktree
  let isWorktree = false;
  let worktreePath: string | undefined;
  let mainWorktree: string | undefined;
  const gitDir = git(cwd, ['rev-parse --git-dir']);
  const gitCommonDir = git(cwd, ['rev-parse --git-common-dir']);
  const superProject = git(cwd, ['rev-parse --show-superproject-working-tree']);
  if (gitDir && gitCommonDir && gitDir !== gitCommonDir && !superProject) {
    isWorktree = true;
    worktreePath = cwd;
    // Main worktree is git-common-dir's parent's parent
    const parts = gitCommonDir.replace(/\\/g, '/').split('/');
    const gitIndex = parts.lastIndexOf('.git');
    if (gitIndex > 0) mainWorktree = parts.slice(0, gitIndex).join('/');
  }

  // Get line-change stats per file (unstaged + staged)
  const numstatOut = git(cwd, ['diff --numstat']);
  const unstagedStats = new Map<string, { added: number; deleted: number }>();
  for (const line of numstatOut.split(/\r?\n/)) {
    const parts = line.split('\t');
    if (parts.length >= 3) {
      unstagedStats.set(parts[2], { added: parseInt(parts[0], 10) || 0, deleted: parseInt(parts[1], 10) || 0 });
    }
  }
  const stagedNumstat = git(cwd, ['diff --cached --numstat']);
  const stagedStats = new Map<string, { added: number; deleted: number }>();
  for (const line of stagedNumstat.split(/\r?\n/)) {
    const parts = line.split('\t');
    if (parts.length >= 3) {
      stagedStats.set(parts[2], { added: parseInt(parts[0], 10) || 0, deleted: parseInt(parts[1], 10) || 0 });
    }
  }

  // Get changed files (staged + unstaged)
  const statusOut = git(cwd, ['status --porcelain']);
  const changes: GitStatus['changes'] = [];
  for (const rawLine of statusOut.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    const x = line[0];
    const y = line[1];
    const file = line.slice(3).trim();
    if (x !== ' ' && x !== '?') {
      const s = ({ M: 'm', A: 'a', D: 'd', R: 'r', C: 'c' } as Record<string, string>)[x] || x.toLowerCase();
      const nums = stagedStats.get(file) || { added: 0, deleted: 0 };
      changes.push({ file, status: s, staged: true, ...nums });
    }
    if (y !== ' ' && y !== '?') {
      const s = ({ M: 'm', D: 'd' } as Record<string, string>)[y] || y.toLowerCase();
      const nums = unstagedStats.get(file) || { added: 0, deleted: 0 };
      changes.push({ file, status: s, staged: false, ...nums });
    }
  }

  // Deduplicate: if a file has both staged and unstaged, keep both entries
  const clean = changes.length === 0;

  return { branch, ahead, behind, changes, clean, isWorktree, worktreePath, mainWorktree };
}

export function getDiff(cwd: string, file?: string, staged = false): string {
  const args = ['diff'];
  if (staged) args.push('--cached');
  if (file) args.push('--', file);
  return git(cwd, args);
}

export function getLog(cwd: string, limit = 30): { hash: string; message: string; author: string; date: string }[] {
  const out = git(cwd, [`log --oneline -${limit} --format="%h|%s|%an|%ar"`]);
  return out.split('\n').filter(Boolean).map((line) => {
    const [hash, ...rest] = line.split('|');
    const message = rest.slice(0, -2).join('|');
    const author = rest[rest.length - 2];
    const date = rest[rest.length - 1];
    return { hash, message, author, date };
  });
}

export function getBranches(cwd: string): { name: string; current: boolean }[] {
  const out = git(cwd, ['branch']);
  return out.split('\n').filter(Boolean).map((line) => ({
    name: line.replace(/^\*?\s+/, ''),
    current: line.startsWith('*'),
  }));
}

export function stage(cwd: string, files: string[]): string {
  return git(cwd, ['add', ...files]);
}

export function unstage(cwd: string, files: string[]): string {
  return git(cwd, ['reset HEAD', ...files]);
}

export function commit(cwd: string, message: string): string {
  return git(cwd, ['commit -m', `"${message.replace(/"/g, '\\"')}"`]);
}

export function push(cwd: string): string {
  return git(cwd, ['push']);
}

export function pull(cwd: string): string {
  return git(cwd, ['pull --rebase']);
}

export function fetch(cwd: string): string {
  return git(cwd, ['fetch --all']);
}

export function checkout(cwd: string, branch: string): string {
  return git(cwd, ['checkout', branch]);
}

export function worktreeAdd(cwd: string, branch: string, targetPath?: string): { ok: boolean; output: string; path: string } {
  const fullBranch = branch.includes('remotes/origin/') ? branch : `origin/${branch}`;
  
  // Derive path name from branch
  const branchName = branch.replace(/^remotes\/origin\//, '').replace(/^origin\//, '').replace(/\//g, '-');
  const worktreePath = targetPath || `${cwd}-review-${branchName}`;
  
  // First fetch to ensure the remote branch is available
  git(cwd, ['fetch origin', branchName]);
  
  const output = git(cwd, ['worktree add', `"${worktreePath}"`, fullBranch]);
  return { ok: !!output, output, path: worktreePath };
}
