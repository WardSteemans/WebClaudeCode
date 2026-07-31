// ── OKF (Open Knowledge Format) v0.1 schema types ──
// Used by the Compiled Memory system to generate a deterministic,
// AST-based codebase knowledge graph for Anthropic Prompt Caching.

export type OkfEntityType = 'class' | 'interface' | 'module' | 'struct' | 'enum' | 'function';

export interface OkfFrontmatter {
  type: OkfEntityType;
  name: string;
  filepath: string;
  dependencies: string[];
  exports: string[];
}

export interface OkfParam {
  name: string;
  type: string;
  isOptional: boolean;
  defaultValue?: string;
}

export interface OkfMethod {
  name: string;
  visibility: 'public' | 'private' | 'protected';
  isStatic: boolean;
  isAsync: boolean;
  returnType: string;
  params: OkfParam[];
  jsdoc?: string;
}

export interface OkfDocument {
  frontmatter: OkfFrontmatter;
  summary: string;
  methods: OkfMethod[];
}

export const OKF_CACHE_DIR = '.okf_cache';

export const OKF_WATCH_DIRS = ['src'];
export const OKF_IGNORE_PATTERNS = ['node_modules', 'bin', 'obj', '.git'];

export const OKF_DEBOUNCE_MS = 1000;

// ── Status API response types ──

export interface OkfFileEntry {
  /** Cache filename (e.g. "packages_backend_src_services_api-router.okf.md") */
  cacheFile: string;
  /** Entity name from frontmatter */
  entityName: string;
  /** Entity type */
  type: string;
  /** Original source file path */
  sourceFile: string;
  /** Export count */
  exportCount: number;
  /** Dependency count */
  dependencyCount: number;
  /** File size in bytes */
  sizeBytes: number;
  /** Last modified timestamp (ISO string) */
  modifiedAt: string;
  /** Age in seconds since last generation */
  ageSeconds: number;
}

export interface OkfStatus {
  watcherActive: boolean;
  projectRoot: string;
  cacheDir: string;
  totalFiles: number;
  totalEntities: number;
  oldestAgeSeconds: number | null;
  files: OkfFileEntry[];
  generatedAt: string;
}
