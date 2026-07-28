import * as azdev from 'azure-devops-node-api';
import { createLogger } from '../logger.js';

const log = createLogger('azure-devops');

let connection: azdev.WebApi | null = null;
let connectionError: string | null = null;
let currentPat: string = '';
let currentOrgUrl: string = '';
let authenticatedUserId: string = '';
let authenticatedUserName: string = '';

export interface AdzConfig {
  orgUrl: string;
  pat: string;
}

export function isConfigured(): boolean {
  return connection !== null;
}

export function getConnectionError(): string | null {
  return connectionError;
}

export async function connect(config: AdzConfig): Promise<boolean> {
  log.begin('connect', { orgUrl: config.orgUrl });
  try {
    const url = config.orgUrl.replace(/\/+$/, '');
    const authHandler = azdev.getPersonalAccessTokenHandler(config.pat);
    connection = new azdev.WebApi(url, authHandler);
    const connData = await connection.connect();
    connectionError = null;
    currentPat = config.pat;
    currentOrgUrl = url;
    // Store authenticated user for "assigned to me" filtering
    authenticatedUserId = connData?.authenticatedUser?.id ?? '';
    authenticatedUserName = connData?.authenticatedUser?.providerDisplayName ?? '';
    log.end('connect', { userId: authenticatedUserId });
    return true;
  } catch (err: any) {
    log.fail('connect', err);
    connectionError = err.message || String(err);
    connection = null;
    return false;
  }
}

export function disconnect(): void {
  connection = null;
  connectionError = null;
  currentPat = '';
  currentOrgUrl = '';
  authenticatedUserId = '';
  authenticatedUserName = '';
}

function getConn(): azdev.WebApi {
  if (!connection) {
    throw new Error(
      connectionError
        ? `Azure DevOps not connected: ${connectionError}`
        : 'Azure DevOps not configured. Please set orgUrl and PAT in Settings.'
    );
  }
  return connection;
}

// ── Internal: fetch PR threads via REST (not exposed on IGitApi) ──

async function fetchThreads(repoId: string, prId: number, project: string): Promise<any[]> {
  const orgUrl = currentOrgUrl;
  const url = `${orgUrl}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repoId)}/pullRequests/${prId}/threads?api-version=7.1`;
  const authToken = Buffer.from(`:${currentPat}`).toString('base64');
  const res = await fetch(url, {
    headers: { Authorization: `Basic ${authToken}`, Accept: 'application/json' },
  });
  if (!res.ok) return [];
  const data: any = await res.json();
  return (data as any).value ?? data ?? [];
}

// ── Projects ──

export async function getProjects(): Promise<AdzProject[]> {
  const core = await getConn().getCoreApi();
  const projects = await core.getProjects(undefined, 100, 0);
  return projects.map(p => ({
    id: p.id!,
    name: p.name!,
    description: p.description ?? '',
    url: p.url!,
    state: p.state!,
    visibility: p.visibility !== undefined ? String(p.visibility) : 'unknown',
  }));
}

// ── Repositories ──

export async function getRepositories(project: string): Promise<AdzRepo[]> {
  const git = await getConn().getGitApi();
  const repos = await git.getRepositories(project, true, false, false);
  return repos.map(r => ({
    id: r.id!,
    name: r.name!,
    defaultBranch: r.defaultBranch?.replace('refs/heads/', '') ?? '',
    url: r.webUrl!,
    sshUrl: r.sshUrl!,
    size: r.size ?? 0,
  }));
}

// ── Branches ──

export async function getBranches(project: string, repoId: string, filter?: string): Promise<AdzBranch[]> {
  const git = await getConn().getGitApi();
  let branches = await git.getBranches(repoId, project);

  let result: AdzBranch[] = branches.map(b => ({
    name: b.name!.replace('refs/heads/', ''),
    fullName: b.name!,
    commit: {
      id: b.commit?.commitId?.slice(0, 8) ?? '',
      author: b.commit?.author?.name ?? '',
      date: b.commit?.author?.date?.toISOString() ?? '',
      message: b.commit?.comment ?? '',
    },
    ahead: b.aheadCount ?? 0,
    behind: b.behindCount ?? 0,
    isBaseVersion: b.isBaseVersion ?? false,
  }));

  if (filter) {
    const f = filter.toLowerCase();
    result = result.filter(b => b.name.toLowerCase().includes(f));
  }

  return result;
}

// ── Pull Requests ──

export async function getPullRequests(
  project: string,
  repoId: string,
  status?: 'active' | 'completed' | 'abandoned' | 'all',
  top: number = 50,
  skip: number = 0,
  reviewerId?: string,
): Promise<AdzPullRequest[]> {
  const git = await getConn().getGitApi();

  const searchCriteria: any = {};
  if (status && status !== 'all') {
    searchCriteria.status = status === 'active' ? 1 : (status === 'completed' ? 3 : 2);
  }
  if (reviewerId) {
    searchCriteria.reviewerId = reviewerId;
  }

  const prs = await git.getPullRequests(repoId, searchCriteria, project, 0, skip, top);

  return prs.map(pr => ({
    id: pr.pullRequestId!,
    title: pr.title!,
    description: pr.description ?? '',
    status: (pr.status === 1 ? 'active' : pr.status === 3 ? 'completed' : 'abandoned') as AdzPullRequest['status'],
    createdBy: pr.createdBy?.displayName ?? '',
    creationDate: pr.creationDate?.toISOString() ?? '',
    sourceBranch: pr.sourceRefName?.replace('refs/heads/', '') ?? '',
    targetBranch: pr.targetRefName?.replace('refs/heads/', '') ?? '',
    mergeStatus: String(pr.mergeStatus ?? 'unknown'),
    isDraft: pr.isDraft ?? false,
    reviewers: (pr.reviewers ?? []).map((r: any) => ({
      name: r.displayName ?? '',
      vote: r.vote ?? 0,
      hasDeclined: r.hasDeclined ?? false,
      isRequired: r.isRequired ?? false,
      voteLabel: voteLabel(r.vote ?? 0),
    })),
    url: pr.url ?? '',
  }));
}

export async function getPullRequestDetail(
  project: string,
  repoId: string,
  prId: number
): Promise<AdzPullRequestDetail> {
  const git = await getConn().getGitApi();

  const [pr, threads, iterations, commits] = await Promise.all([
    git.getPullRequest(repoId, prId, project, undefined, undefined, undefined, true, true),
    fetchThreads(repoId, prId, project),
    git.getPullRequestIterations(repoId, prId, project, true),
    git.getPullRequestCommits(repoId, prId, project),
  ]);

  return {
    id: pr.pullRequestId!,
    title: pr.title!,
    description: pr.description ?? '',
    status: (pr.status === 1 ? 'active' : pr.status === 3 ? 'completed' : 'abandoned') as AdzPullRequestDetail['status'],
    createdBy: pr.createdBy?.displayName ?? '',
    creationDate: pr.creationDate?.toISOString() ?? '',
    sourceBranch: pr.sourceRefName?.replace('refs/heads/', '') ?? '',
    targetBranch: pr.targetRefName?.replace('refs/heads/', '') ?? '',
    mergeStatus: String(pr.mergeStatus ?? 'unknown'),
    isDraft: pr.isDraft ?? false,
    reviewers: (pr.reviewers ?? []).map((r: any) => ({
      name: r.displayName ?? '',
      vote: r.vote ?? 0,
      hasDeclined: r.hasDeclined ?? false,
      isRequired: r.isRequired ?? false,
      voteLabel: voteLabel(r.vote ?? 0),
    })),
    threads: (threads ?? []).map((t: any) => ({
      id: t.id ?? 0,
      status: t.status ?? 'unknown',
      comments: (t.comments ?? []).map((c: any) => ({
        id: c.id ?? 0,
        author: c.author?.displayName ?? '',
        content: c.content ?? '',
        date: c.publishedDate ? new Date(c.publishedDate).toISOString() : '',
        commentType: c.commentType ?? 'text',
        isDeleted: c.isDeleted ?? false,
      })),
    })),
    iterations: (iterations ?? []).map((i: any) => ({
      id: i.id ?? 0,
      description: i.description ?? '',
      commits: (i.commits ?? []).map((c: any) => ({
        id: (c.commitId ?? '').slice(0, 8),
        author: c.author?.name ?? '',
        message: c.comment ?? '',
      })),
    })),
    commits: (commits ?? []).map((c: any) => ({
      id: (c.commitId ?? '').slice(0, 8),
      author: c.author?.name ?? '',
      message: c.comment ?? '',
      date: c.author?.date?.toISOString() ?? '',
    })),
    url: pr.url ?? '',
  };
}

// ── Work Items ──

export async function getWorkItems(project: string, ids: number[]): Promise<AdzWorkItem[]> {
  if (ids.length === 0) return [];
  const wit = await getConn().getWorkItemTrackingApi();
  const items = await wit.getWorkItems(
    ids,
    ['System.Id', 'System.Title', 'System.State', 'System.WorkItemType', 'System.AssignedTo'],
    undefined,
    undefined,
    undefined,
    project,
  );
  return (items ?? []).map((wi: any) => ({
    id: wi.id!,
    title: wi.fields?.['System.Title'] ?? '',
    state: wi.fields?.['System.State'] ?? '',
    type: wi.fields?.['System.WorkItemType'] ?? '',
    assignedTo: wi.fields?.['System.AssignedTo']?.displayName ?? '',
    url: wi.url ?? '',
  }));
}

// ── Connection Info ──

export function getConnectionInfo(): { connected: boolean; error: string | null; user: { id: string; name: string } | null } {
  return {
    connected: connection !== null,
    error: connectionError,
    user: authenticatedUserId ? { id: authenticatedUserId, name: authenticatedUserName } : null,
  };
}

export function getAuthenticatedUser(): { id: string; name: string } | null {
  return authenticatedUserId ? { id: authenticatedUserId, name: authenticatedUserName } : null;
}

export function getAuthenticatedUserId(): string {
  return authenticatedUserId;
}

// ── Helpers ──

function voteLabel(vote: number): string {
  if (vote === 10) return 'approved';
  if (vote === 5) return 'approved with suggestions';
  if (vote === 0) return 'no vote';
  if (vote === -5) return 'waiting for author';
  if (vote === -10) return 'rejected';
  return 'pending';
}

// ── Exported interfaces ──

export interface AdzProject {
  id: string;
  name: string;
  description: string;
  url: string;
  state: string;
  visibility: string;
}

export interface AdzRepo {
  id: string;
  name: string;
  defaultBranch: string;
  url: string;
  sshUrl: string;
  size: number;
}

export interface AdzBranch {
  name: string;
  fullName: string;
  commit: {
    id: string;
    author: string;
    date: string;
    message: string;
  };
  ahead: number;
  behind: number;
  isBaseVersion: boolean;
}

export interface AdzPullRequest {
  id: number;
  title: string;
  description: string;
  status: 'active' | 'completed' | 'abandoned';
  createdBy: string;
  creationDate: string;
  sourceBranch: string;
  targetBranch: string;
  mergeStatus: string;
  isDraft: boolean;
  reviewers: {
    name: string;
    vote: number;
    hasDeclined: boolean;
    isRequired: boolean;
    voteLabel: string;
  }[];
  url: string;
}

export interface AdzPullRequestDetail extends AdzPullRequest {
  threads: {
    id: number;
    status: string;
    comments: {
      id: number;
      author: string;
      content: string;
      date: string;
      commentType: string;
      isDeleted: boolean;
    }[];
  }[];
  iterations: {
    id: number;
    description: string;
    commits: {
      id: string;
      author: string;
      message: string;
    }[];
  }[];
  commits: {
    id: string;
    author: string;
    message: string;
    date: string;
  }[];
}

export interface AdzWorkItem {
  id: number;
  title: string;
  state: string;
  type: string;
  assignedTo: string;
  url: string;
}
