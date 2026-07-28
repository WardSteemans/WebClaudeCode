import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Cloud, CloudOff, RefreshCw, GitPullRequest, GitBranch, FolderGit2,
  ChevronRight, ChevronDown, CheckCircle, XCircle, AlertCircle,
  Clock, User, GitMerge, ExternalLink, MessageSquare, Search,
  FileCode, ArrowRightLeft, Dot, Shield, ShieldCheck, ShieldAlert,
  GitCommit, Loader2, AlertTriangle, Play, UserCheck,
} from 'lucide-react';
import { useSettingsStore } from '../store/settingsStore';
import { useTabStore } from '../store';

// ── Types ──

interface AdzRepo {
  id: string; name: string; defaultBranch: string; url: string; sshUrl: string; size: number;
}

interface AdzBranch {
  name: string; fullName: string;
  commit: { id: string; author: string; date: string; message: string };
  ahead: number; behind: number; isBaseVersion: boolean;
}

interface AdzPullRequest {
  id: number; title: string; description: string;
  status: 'active' | 'completed' | 'abandoned';
  createdBy: string; creationDate: string;
  sourceBranch: string; targetBranch: string;
  mergeStatus: string; isDraft: boolean;
  reviewers: { name: string; vote: number; voteLabel: string; hasDeclined: boolean; isRequired: boolean }[];
  url: string;
}

interface AdzPullRequestDetail extends AdzPullRequest {
  threads: { id: number; status: string; comments: { id: number; author: string; content: string; date: string; commentType: string; isDeleted: boolean }[] }[];
  iterations: { id: number; description: string; commits: { id: string; author: string; message: string }[] }[];
  commits: { id: string; author: string; message: string; date: string }[];
}

// ── Panel ──

export function AzureDevOpsPanel({ workDir }: { workDir: string | null }) {
  const {
    azureDevopsConnected, azureDevopsProject, azureDevopsRepository,
    azureDevopsUserName, connectAzureDevops,
  } = useSettingsStore();
  const addTab = useTabStore((s) => s.addTab);

  const [tab, setTab] = useState<'prs' | 'branches' | 'repos'>('prs');
  const [connecting, setConnecting] = useState(false);
  const [repos, setRepos] = useState<AdzRepo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<string>('');
  const [showConfig, setShowConfig] = useState(false);

  // Auto-connect on mount if settings exist
  useEffect(() => {
    if (!azureDevopsConnected) {
      const s = useSettingsStore.getState();
      if (s.azureDevopsOrgUrl && s.azureDevopsPat) {
        setConnecting(true);
        connectAzureDevops().then(() => setConnecting(false));
      }
    }
  }, []);

  // Load repos when connected
  useEffect(() => {
    if (azureDevopsConnected && azureDevopsProject) {
      fetch('/api/azure-devops/repositories?project=' + encodeURIComponent(azureDevopsProject))
        .then(r => r.json())
        .then((data: AdzRepo[]) => {
          setRepos(Array.isArray(data) ? data : []);
          if (!selectedRepo && azureDevopsRepository && Array.isArray(data)) {
            const match = data.find(r => r.name.toLowerCase() === azureDevopsRepository.toLowerCase());
            if (match) setSelectedRepo(match.id);
          }
        })
        .catch(() => setRepos([]));
    }
  }, [azureDevopsConnected, azureDevopsProject]);

  // Not connected state
  if (!azureDevopsConnected && !connecting) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header tab={tab} onTab={setTab} repos={repos} selectedRepo={selectedRepo} />
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-center">
          <CloudOff size={36} className="text-[var(--color-text-muted)] opacity-40" />
          <div>
            <p className="text-sm font-medium text-[var(--color-text)] mb-1">Azure DevOps not connected</p>
            <p className="text-[12px] text-[var(--color-text-muted)] max-w-xs">
              Configure your organization URL and Personal Access Token in Settings to browse repositories, branches, and pull requests.
            </p>
          </div>
          <button
            onClick={() => document.querySelector<HTMLButtonElement>('[title="Settings"]')?.click()}
            className="px-4 py-2 bg-accent-600 hover:bg-accent-500 text-white rounded-lg text-[13px] font-medium transition-colors shadow-sm"
          >
            Open Settings
          </button>
        </div>
      </div>
    );
  }

  // Connecting state
  if (connecting) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header tab={tab} onTab={setTab} repos={repos} selectedRepo={selectedRepo} />
        <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6">
          <Loader2 size={28} className="text-accent-500 animate-spin" />
          <p className="text-[12px] text-[var(--color-text-muted)]">Connecting to Azure DevOps...</p>
        </div>
      </div>
    );
  }

  // No project configured
  if (!azureDevopsProject) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header tab={tab} onTab={setTab} repos={repos} selectedRepo={selectedRepo} />
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-center">
          <FolderGit2 size={36} className="text-[var(--color-text-muted)] opacity-40" />
          <div>
            <p className="text-sm font-medium text-[var(--color-text)] mb-1">No project selected</p>
            <p className="text-[12px] text-[var(--color-text-muted)] max-w-xs">
              Set a default project in Settings to get started.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <Header tab={tab} onTab={setTab} repos={repos} selectedRepo={selectedRepo} onSelectRepo={setSelectedRepo} />

      {selectedRepo ? (
        <div className="flex-1 overflow-y-auto">
          {tab === 'prs' && <PullRequestsView project={azureDevopsProject} repoId={selectedRepo} workDir={workDir} />}
          {tab === 'branches' && <BranchesView project={azureDevopsProject} repoId={selectedRepo} />}
          {tab === 'repos' && <ReposView repos={repos} onSelect={setSelectedRepo} />}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <ReposView repos={repos} onSelect={setSelectedRepo} />
        </div>
      )}
    </div>
  );
}

// ── Header ──

function Header({ tab, onTab, repos, selectedRepo, onSelectRepo }: {
  tab: string;
  onTab: (t: 'prs' | 'branches' | 'repos') => void;
  repos: AdzRepo[];
  selectedRepo: string;
  onSelectRepo?: (id: string) => void;
}) {
  const selectedName = repos.find(r => r.id === selectedRepo)?.name ?? '';

  return (
    <div className="shrink-0 border-b border-[var(--color-border)]">
      {/* Tabs */}
      <div className="flex items-center gap-0 px-2 pt-1">
        <TabButton icon={<GitPullRequest size={13} />} label="Pull Requests" active={tab === 'prs'} onClick={() => onTab('prs')} />
        <TabButton icon={<GitBranch size={13} />} label="Branches" active={tab === 'branches'} onClick={() => onTab('branches')} />
        <TabButton icon={<FolderGit2 size={13} />} label="Repos" active={tab === 'repos'} onClick={() => onTab('repos')} />
      </div>

      {/* Repo selector */}
      {onSelectRepo && repos.length > 0 && (
        <div className="px-2 pb-1.5 pt-0.5">
          <select
            value={selectedRepo}
            onChange={e => onSelectRepo(e.target.value)}
            className="w-full px-2 py-1 text-[11px] bg-[var(--color-input-bg)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] focus:outline-none focus:border-accent-500 transition-colors"
          >
            <option value="">Select a repository...</option>
            {repos.map(r => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

function TabButton({ icon, label, active, onClick }: {
  icon: React.ReactNode; label: string; active?: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] rounded-t-md transition-colors border-b-2 ${
        active
          ? 'text-[var(--color-text)] border-accent-500 bg-[var(--color-surface-hover)]/30'
          : 'text-[var(--color-text-muted)] border-transparent hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]/20'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

// ── Pull Requests View ──

function PullRequestsView({ project, repoId, workDir }: { project: string; repoId: string; workDir: string | null }) {
  const [prs, setPrs] = useState<AdzPullRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'active' | 'completed' | 'abandoned' | 'all'>('active');
  const [assignedToMe, setAssignedToMe] = useState(false);
  const [selectedPr, setSelectedPr] = useState<number | null>(null);
  const azureDevopsUserId = useSettingsStore(s => s.azureDevopsUserId);
  const azureDevopsUserName = useSettingsStore(s => s.azureDevopsUserName);

  const fetchPrs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let url = `/api/azure-devops/pullrequests?project=${encodeURIComponent(project)}&repositoryId=${encodeURIComponent(repoId)}&status=${filter}&top=40`;
      if (assignedToMe && azureDevopsUserId) {
        url += `&reviewerId=${encodeURIComponent(azureDevopsUserId)}`;
      }
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
      const data = await res.json();
      setPrs(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  }, [project, repoId, filter, assignedToMe, azureDevopsUserId]);

  useEffect(() => { fetchPrs(); }, [fetchPrs]);

  useEffect(() => {
    if (selectedPr) { fetchPrs(); }
  }, [selectedPr]);

  if (selectedPr) {
    return (
      <PullRequestDetail
        project={project}
        repoId={repoId}
        prId={selectedPr}
        workDir={workDir}
        onBack={() => setSelectedPr(null)}
      />
    );
  }

  return (
    <div className="flex flex-col">
      {/* Filter bar */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-[var(--color-border)] shrink-0">
        <FilterPill label="Active" active={filter === 'active'} onClick={() => setFilter('active')} />
        <FilterPill label="Completed" active={filter === 'completed'} onClick={() => setFilter('completed')} />
        <FilterPill label="Abandoned" active={filter === 'abandoned'} onClick={() => setFilter('abandoned')} />
        <FilterPill label="All" active={filter === 'all'} onClick={() => setFilter('all')} />
        <div className="w-px h-4 bg-[var(--color-border)] mx-0.5" />
        <button
          onClick={() => setAssignedToMe(!assignedToMe)}
          className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] transition-colors ${
            assignedToMe
              ? 'bg-accent-500/15 text-accent-400 font-medium'
              : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]'
          }`}
          title={azureDevopsUserName ? `PRs where ${azureDevopsUserName} is a reviewer` : 'Filter PRs assigned to you'}
        >
          <UserCheck size={11} />
          Me
        </button>
        <div className="flex-1" />
        <button onClick={fetchPrs} className="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] rounded-md transition-colors" title="Refresh">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Content */}
      <div className="overflow-y-auto">
        {loading && prs.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={20} className="text-[var(--color-text-muted)] animate-spin" />
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center gap-2 py-12 px-4 text-center">
            <AlertTriangle size={24} className="text-amber-500" />
            <p className="text-[12px] text-red-400">{error}</p>
            <button onClick={fetchPrs} className="px-3 py-1 text-[11px] bg-[var(--color-surface-hover)] hover:bg-[var(--color-border)] rounded-md transition-colors">Retry</button>
          </div>
        )}

        {!loading && !error && prs.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <GitPullRequest size={24} className="text-[var(--color-text-muted)] opacity-40" />
            <p className="text-[12px] text-[var(--color-text-muted)]">No {filter === 'all' ? '' : filter} pull requests found</p>
          </div>
        )}

        {prs.map(pr => (
          <div
            key={pr.id}
            onClick={() => setSelectedPr(pr.id)}
            className="px-3 py-2.5 border-b border-[var(--color-border)]/50 hover:bg-[var(--color-surface-hover)]/30 cursor-pointer transition-colors"
          >
            <div className="flex items-start gap-2">
              <PRStatusIcon status={pr.status} draft={pr.isDraft} />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-[var(--color-text)] truncate">
                  {pr.isDraft && <span className="text-[10px] text-[var(--color-text-muted)] mr-1 px-1 py-0.5 bg-[var(--color-border)] rounded">Draft</span>}
                  {pr.title}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-[var(--color-text-muted)]">
                  <span className="text-accent-400">!{pr.id}</span>
                  <Dot size={10} className="opacity-30" />
                  <span>{pr.createdBy}</span>
                  <Dot size={10} className="opacity-30" />
                  <span className="flex items-center gap-0.5">
                    <GitBranch size={10} /> {pr.sourceBranch}
                  </span>
                  <ArrowRightLeft size={10} className="mx-0.5 opacity-40" />
                  <span className="flex items-center gap-0.5">
                    <GitBranch size={10} /> {pr.targetBranch}
                  </span>
                </div>
              </div>
              <div className="shrink-0 flex items-center gap-2">
                <ReviewersBadge reviewers={pr.reviewers} />
                <ChevronRight size={14} className="text-[var(--color-text-muted)] opacity-40" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FilterPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-0.5 rounded-full text-[11px] transition-colors ${
        active
          ? 'bg-accent-500/15 text-accent-400 font-medium'
          : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]'
      }`}
    >
      {label}
    </button>
  );
}

function PRStatusIcon({ status, draft }: { status: string; draft: boolean }) {
  if (draft) return <GitPullRequest size={15} className="text-[var(--color-text-muted)] mt-0.5" />;
  switch (status) {
    case 'active': return <GitPullRequest size={15} className="text-emerald-400 mt-0.5" />;
    case 'completed': return <GitMerge size={15} className="text-accent-400 mt-0.5" />;
    case 'abandoned': return <XCircle size={15} className="text-red-400 mt-0.5" />;
    default: return <GitPullRequest size={15} className="text-[var(--color-text-muted)] mt-0.5" />;
  }
}

function ReviewersBadge({ reviewers }: { reviewers: AdzPullRequest['reviewers'] }) {
  if (!reviewers || reviewers.length === 0) return null;
  
  const approved = reviewers.filter(r => r.vote === 10).length;
  const rejected = reviewers.filter(r => r.vote === -10).length;
  const required = reviewers.filter(r => r.isRequired).length;
  const requiredApproved = reviewers.filter(r => r.isRequired && r.vote === 10).length;

  return (
    <div className="flex items-center gap-1.5" title={reviewers.map(r => `${r.name}: ${r.voteLabel}`).join('\n')}>
      {rejected > 0 ? (
        <ShieldAlert size={13} className="text-red-400" />
      ) : requiredApproved >= required ? (
        <ShieldCheck size={13} className="text-emerald-400" />
      ) : (
        <Shield size={13} className="text-[var(--color-text-muted)]" />
      )}
      <span className={`text-[10px] font-medium ${
        rejected > 0 ? 'text-red-400' :
        requiredApproved >= required ? 'text-emerald-400' :
        'text-[var(--color-text-muted)]'
      }`}>
        {approved}/{reviewers.length}
      </span>
    </div>
  );
}

// ── Pull Request Detail ──

function PullRequestDetail({ project, repoId, prId, workDir, onBack }: {
  project: string; repoId: string; prId: number; workDir: string | null; onBack: () => void;
}) {
  const [detail, setDetail] = useState<AdzPullRequestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creatingReview, setCreatingReview] = useState(false);
  const addTab = useTabStore((s) => s.addTab);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/azure-devops/pullrequests/${prId}?project=${encodeURIComponent(project)}&repositoryId=${encodeURIComponent(repoId)}`)
      .then(r => r.json())
      .then(data => {
        setDetail(data);
        setError(null);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [project, repoId, prId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={22} className="text-accent-500 animate-spin" />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <AlertTriangle size={24} className="text-red-400" />
        <p className="text-[12px] text-red-400">{error || 'Failed to load PR details'}</p>
        <button onClick={onBack} className="text-[12px] text-accent-400 hover:underline">Go back</button>
      </div>
    );
  }

  const timeAgo = formatTimeAgo(detail.creationDate);

  const handleStartReview = async () => {
    if (!workDir || !detail) return;
    setCreatingReview(true);
    try {
      const res = await fetch('/api/git/worktree-add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base: workDir, branch: detail.sourceBranch }),
      });
      const data = await res.json();
      if (data.ok && data.path) {
        addTab(data.path);
      }
    } catch { /* user will see no feedback if it fails — acceptable */ }
    setCreatingReview(false);
  };

  return (
    <div className="flex flex-col">
      {/* Back button + title */}
      <div className="border-b border-[var(--color-border)] px-3 py-2">
        <button onClick={onBack} className="flex items-center gap-1 text-[11px] text-accent-400 hover:text-accent-300 mb-1.5 transition-colors">
          <ChevronRight size={12} className="rotate-180" />
          Back to list
        </button>
        <div className="flex items-center gap-2">
          <PRStatusIcon status={detail.status} draft={detail.isDraft} />
          <div className="flex-1 min-w-0">
            <h3 className="text-[14px] font-semibold text-[var(--color-text)] truncate">{detail.title}</h3>
            <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-[var(--color-text-muted)]">
              <span className="text-accent-400">!{detail.id}</span>
              <Dot size={10} className="opacity-30" />
              <User size={10} />
              <span>{detail.createdBy}</span>
              <Dot size={10} className="opacity-30" />
              <Clock size={10} />
              <span>{timeAgo}</span>
            </div>
          </div>
          <a href={detail.url} target="_blank" rel="noopener noreferrer" className="text-[var(--color-text-muted)] hover:text-accent-400 transition-colors" title="Open in browser">
            <ExternalLink size={14} />
          </a>
        </div>
      </div>

      <div className="overflow-y-auto">
        {/* Description */}
        {detail.description && (
          <div className="px-3 py-2.5 border-b border-[var(--color-border)]/50">
            <p className="text-[12px] text-[var(--color-text-secondary)] whitespace-pre-wrap line-clamp-6">{detail.description}</p>
          </div>
        )}

        {/* Branch info */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--color-border)]/50 text-[12px]">
          <div className="flex items-center gap-1 text-[var(--color-text-muted)]">
            <GitBranch size={11} />
            <span className="text-emerald-400 font-mono">{detail.sourceBranch}</span>
          </div>
          <ArrowRightLeft size={11} className="text-[var(--color-text-muted)]" />
          <div className="flex items-center gap-1 text-[var(--color-text-muted)]">
            <GitBranch size={11} />
            <span className="text-accent-400 font-mono">{detail.targetBranch}</span>
          </div>
          <div className="flex-1" />
          {detail.status === 'active' && workDir && (
            <button
              onClick={handleStartReview}
              disabled={creatingReview}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-accent-600 hover:bg-accent-500 disabled:bg-[var(--color-border)] disabled:text-[var(--color-text-muted)] text-white rounded-md text-[11px] font-medium transition-colors"
            >
              {creatingReview ? (
                <><Loader2 size={11} className="animate-spin" /> Setting up...</>
              ) : (
                <><Play size={11} /> Start Code Review</>
              )}
            </button>
          )}
        </div>

        {/* Reviewers */}
        {detail.reviewers.length > 0 && (
          <div className="px-3 py-2.5 border-b border-[var(--color-border)]/50">
            <span className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Reviewers</span>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {detail.reviewers.map((r, i) => (
                <span key={i} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] ${
                  r.vote === 10 ? 'bg-emerald-500/10 text-emerald-400' :
                  r.vote === -10 ? 'bg-red-500/10 text-red-400' :
                  r.vote === -5 ? 'bg-amber-500/10 text-amber-400' :
                  'bg-[var(--color-surface-hover)] text-[var(--color-text-muted)]'
                }`}>
                  {r.vote === 10 ? <CheckCircle size={10} /> : r.vote === -10 ? <XCircle size={10} /> : r.vote === -5 ? <Clock size={10} /> : <Dot size={10} />}
                  {r.name}
                  {r.isRequired && <span className="text-[9px] opacity-60">(required)</span>}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Commits */}
        <CollapsibleSection title={`Commits (${detail.commits.length})`} icon={<GitCommit size={12} />} defaultOpen>
          {detail.commits.length === 0 ? (
            <p className="text-[11px] text-[var(--color-text-muted)] py-1">No commits</p>
          ) : (
            <div className="space-y-1">
              {detail.commits.slice(0, 20).map((c, i) => (
                <div key={i} className="flex items-start gap-2 text-[11px]">
                  <span className="text-accent-400 font-mono shrink-0 mt-0.5">{c.id}</span>
                  <div className="min-w-0 flex-1">
                    <span className="text-[var(--color-text)] truncate block">{c.message.split('\n')[0]}</span>
                    <span className="text-[var(--color-text-muted)]">
                      {c.author} · {formatTimeAgo(c.date)}
                    </span>
                  </div>
                </div>
              ))}
              {detail.commits.length > 20 && (
                <p className="text-[11px] text-[var(--color-text-muted)]">...and {detail.commits.length - 20} more</p>
              )}
            </div>
          )}
        </CollapsibleSection>

        {/* Threads / Comments */}
        <CollapsibleSection title={`Comments (${detail.threads.length})`} icon={<MessageSquare size={12} />}>
          {detail.threads.length === 0 ? (
            <p className="text-[11px] text-[var(--color-text-muted)] py-1">No comments</p>
          ) : (
            <div className="space-y-2">
              {detail.threads.map((t) => (
                <div key={t.id} className="border-l-2 border-[var(--color-border)] pl-2.5">
                  {t.comments.filter(c => !c.isDeleted).map((c) => (
                    <div key={c.id} className="py-1">
                      <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)] mb-0.5">
                        <User size={9} />
                        <span className="font-medium text-[var(--color-text-secondary)]">{c.author}</span>
                        <span>{formatTimeAgo(c.date)}</span>
                      </div>
                      <p className="text-[11px] text-[var(--color-text)] whitespace-pre-wrap">{c.content}</p>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </CollapsibleSection>
      </div>
    </div>
  );
}

function CollapsibleSection({ title, icon, children, defaultOpen }: {
  title: string; icon: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div className="border-b border-[var(--color-border)]/50">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-1.5 px-3 py-2 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
      >
        {icon}
        <span className="font-medium">{title}</span>
        <ChevronRight size={12} className={`ml-auto transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && <div className="px-3 pb-2">{children}</div>}
    </div>
  );
}

// ── Branches View ──

function BranchesView({ project, repoId }: { project: string; repoId: string }) {
  const [branches, setBranches] = useState<AdzBranch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const fetchBranches = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const filter = search ? `&filter=${encodeURIComponent(search)}` : '';
      const res = await fetch(`/api/azure-devops/branches?project=${encodeURIComponent(project)}&repositoryId=${encodeURIComponent(repoId)}${filter}`);
      if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
      const data = await res.json();
      setBranches(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  }, [project, repoId, search]);

  useEffect(() => { fetchBranches(); }, [fetchBranches]);

  useEffect(() => {
    const timer = setTimeout(fetchBranches, 300);
    return () => clearTimeout(timer);
  }, [search]);

  return (
    <div className="flex flex-col">
      {/* Search bar */}
      <div className="px-3 py-2 border-b border-[var(--color-border)] shrink-0">
        <div className="flex items-center gap-1.5 px-2 py-1 bg-[var(--color-input-bg)] border border-[var(--color-border)] rounded-md focus-within:border-accent-500 transition-colors">
          <Search size={12} className="text-[var(--color-text-muted)] shrink-0" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter branches..."
            spellCheck={false}
            className="flex-1 bg-transparent text-[12px] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)]/40 focus:outline-none"
          />
          {loading && <Loader2 size={11} className="text-accent-500 animate-spin" />}
        </div>
      </div>

      <div className="overflow-y-auto">
        {error && (
          <div className="flex flex-col items-center gap-2 py-12 px-4 text-center">
            <AlertTriangle size={24} className="text-amber-500" />
            <p className="text-[12px] text-red-400">{error}</p>
            <button onClick={fetchBranches} className="px-3 py-1 text-[11px] bg-[var(--color-surface-hover)] rounded-md transition-colors">Retry</button>
          </div>
        )}

        {!error && branches.length === 0 && !loading && (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <GitBranch size={24} className="text-[var(--color-text-muted)] opacity-40" />
            <p className="text-[12px] text-[var(--color-text-muted)]">No branches found</p>
          </div>
        )}

        {branches.map(b => (
          <div key={b.name} className="px-3 py-2 border-b border-[var(--color-border)]/50 hover:bg-[var(--color-surface-hover)]/30 transition-colors">
            <div className="flex items-center gap-2">
              <GitBranch size={13} className={`shrink-0 ${b.isBaseVersion ? 'text-accent-400' : 'text-[var(--color-text-muted)]'}`} />
              <span className="text-[13px] font-medium text-[var(--color-text)] font-mono truncate">{b.name}</span>
              {(b.ahead > 0 || b.behind > 0) && (
                <span className="shrink-0 flex items-center gap-1 text-[10px]">
                  {b.ahead > 0 && <span className="text-emerald-400">↑{b.ahead}</span>}
                  {b.behind > 0 && <span className="text-amber-400">↓{b.behind}</span>}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5 ml-5 text-[11px] text-[var(--color-text-muted)]">
              <span className="text-accent-400 font-mono">{b.commit.id}</span>
              <Dot size={10} className="opacity-30" />
              <span className="truncate max-w-md">{b.commit.message?.split('\n')[0] || '—'}</span>
            </div>
            <div className="flex items-center gap-1.5 ml-5 text-[10px] text-[var(--color-text-muted)]">
              <User size={9} />
              <span>{b.commit.author}</span>
              <Dot size={8} className="opacity-30" />
              <Clock size={9} />
              <span>{formatTimeAgo(b.commit.date)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Repositories View ──

function ReposView({ repos, onSelect }: { repos: AdzRepo[]; onSelect: (id: string) => void }) {
  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (repos.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-center">
        <FolderGit2 size={24} className="text-[var(--color-text-muted)] opacity-40" />
        <p className="text-[12px] text-[var(--color-text-muted)]">No repositories found</p>
      </div>
    );
  }

  return (
    <div className="overflow-y-auto">
      {repos.map(repo => (
        <div
          key={repo.id}
          onClick={() => onSelect(repo.id)}
          className="px-3 py-2.5 border-b border-[var(--color-border)]/50 hover:bg-[var(--color-surface-hover)]/30 cursor-pointer transition-colors flex items-center justify-between group"
        >
          <div className="flex items-center gap-2 min-w-0">
            <FolderGit2 size={15} className="text-accent-400 shrink-0" />
            <div className="min-w-0">
              <span className="text-[13px] font-medium text-[var(--color-text)] block truncate">{repo.name}</span>
              <span className="text-[10px] text-[var(--color-text-muted)]">
                {repo.defaultBranch || 'no default branch'} · {formatSize(repo.size)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a href={repo.url} target="_blank" rel="noopener noreferrer" className="opacity-0 group-hover:opacity-100 text-[var(--color-text-muted)] hover:text-accent-400 transition-all" title="Open in browser" onClick={e => e.stopPropagation()}>
              <ExternalLink size={12} />
            </a>
            <ChevronRight size={14} className="text-[var(--color-text-muted)] opacity-40" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Helpers ──

function formatTimeAgo(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  } catch {
    return '';
  }
}
