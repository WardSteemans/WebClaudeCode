// ── Raw Azure DevOps REST API shapes ──
// These match the actual JSON returned by the azure-devops-node-api SDK.
// Used as mapper input types in azure-devops.ts to eliminate `any`.

// ── PR status constants ──
export const PR_STATUS = {
  ACTIVE: 1,
  ABANDONED: 2,
  COMPLETED: 3,
} as const;
export type PrStatusCode = typeof PR_STATUS[keyof typeof PR_STATUS];

// ── Raw SDK types used in mappers ──

export interface RawIdentityRef {
  id?: string;
  displayName?: string;
  providerDisplayName?: string;
  name?: string;
}

export interface RawCommitRef {
  commitId?: string;
  author?: { name?: string; date?: Date };
  comment?: string;
}

export interface RawBranch {
  name?: string;
  commit?: RawCommitRef;
  aheadCount?: number;
  behindCount?: number;
  isBaseVersion?: boolean;
}

export interface RawPullRequest {
  pullRequestId?: number;
  title?: string;
  description?: string;
  status?: number;
  createdBy?: RawIdentityRef;
  creationDate?: Date;
  sourceRefName?: string;
  targetRefName?: string;
  mergeStatus?: number;
  isDraft?: boolean;
  reviewers?: RawReviewer[];
  url?: string;
}

export interface RawReviewer {
  displayName?: string;
  vote?: number;
  hasDeclined?: boolean;
  isRequired?: boolean;
}

export interface RawThreadComment {
  id?: number;
  author?: RawIdentityRef;
  content?: string;
  publishedDate?: string;
  commentType?: string;
  isDeleted?: boolean;
}

export interface RawThread {
  id?: number;
  status?: string;
  comments?: RawThreadComment[];
}

export interface RawIterationCommit {
  commitId?: string;
  author?: { name?: string };
  comment?: string;
}

export interface RawIteration {
  id?: number;
  description?: string;
  commits?: RawIterationCommit[];
}

export interface RawWorkItem {
  id?: number;
  fields?: Record<string, unknown>;
  url?: string;
}
