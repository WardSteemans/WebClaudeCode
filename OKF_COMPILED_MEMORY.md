# OKF Compiled Memory — Caching Architecture

> How the codebase knowledge graph is built, injected, and cached per LLM provider.

---

## Overview

The OKF (Open Knowledge Format) Compiled Memory system builds a **deterministic, AST-based knowledge graph** of the codebase and injects it into every LLM API request. The goal: give the LLM precise, up-to-date codebase structure without RAG, vector databases, or semantic search.

The system has four layers:

```
┌─────────────────────────────────────────────────────┐
│  4. Bundler (proxy injection)                       │
│     Injects cached OKF context into system prompt    │
├─────────────────────────────────────────────────────┤
│  3. File Watcher (chokidar)                         │
│     Watches src/**, triggers extractor on changes    │
├─────────────────────────────────────────────────────┤
│  2. AST Extractor (ts-morph)                        │
│     Parses TypeScript → .okf.md with method sigs     │
├─────────────────────────────────────────────────────┤
│  1. OKF Schema                                      │
│     YAML frontmatter + markdown body format          │
└─────────────────────────────────────────────────────┘
```

### How a `.okf.md` file looks

```markdown
---
type: "class"
name: "ApiRouter"
filepath: "packages/backend/src/services/api-router.ts"
dependencies: ["https", "express", "uuid"]
exports: ["handleProxyRequest", "forwardToUpstream"]
---

## Summary

Routes API requests to upstream providers based on routing rules.

## Methods

### `public static handleProxyRequest(req, res): Promise<void>`

### `public buildUpstreamUrl(baseUrl: string): { hostname, port, path }`
```

Key design: **only method signatures, no implementation bodies**. This maximizes useful information per token.

---

## Caching Strategy

The critical insight: different LLM providers cache differently. The OKF context placement in the system prompt is optimized for both.

### Placement: System Block Position 0

```
System blocks for every request:
┌──────────────────────────────────────────────┐
│ [0] <okf_context>          ← OUR INJECTION   │
│     cache_control: ephemeral                  │  ← Used by Anthropic
├──────────────────────────────────────────────┤
│ [1] Claude CLI instructions                   │  ← Varies per request
├──────────────────────────────────────────────┤
│ [2] Superpowers plugin instructions           │  ← Static but large
├──────────────────────────────────────────────┤
│ [3] ...other blocks...                        │
└──────────────────────────────────────────────┘
```

**Why position 0?** Both Anthropic and DeepSeek benefit from the OKF block being first:

| Provider | Caching mechanism | Requires position 0? |
|----------|-------------------|----------------------|
| **Anthropic** | Explicit `cache_control: { type: "ephemeral" }` | No — works at any position |
| **DeepSeek** | Automatic prefix-based KV cache | **Yes** — must be a shared prefix |

---

## DeepSeek: Automatic Prefix Caching

DeepSeek uses **automatic KV cache on disk**, enabled by default for all users. No code changes needed — but placement matters.

### How it works

DeepSeek persists **cache prefix units** at three trigger points:
1. **Request boundaries** — end of user input, end of model output
2. **Common prefix detection** — detects repeated prefixes across requests, persists them independently
3. **Fixed token intervals** — for very long inputs/outputs

A subsequent request hits the cache **only if it fully matches** a persisted cache prefix unit.

### Why position 0 is essential

```
❌ WRONG (position 2):
  Request 1: [Claude-v1] [Superpowers] [OKF_abc] [User-A]
  Request 2: [Claude-v2] [Superpowers] [OKF_abc] [User-B]
  
  Claude instructions vary → OKF never matches as prefix → NO CACHE HIT

✅ RIGHT (position 0):
  Request 1: [OKF_abc] [Claude-v1] [Superpowers] [User-A]
  Request 2: [OKF_abc] [Claude-v2] [Superpowers] [User-B]
  
  OKF is the shared prefix → DeepSeek detects common prefix → CACHE HIT
```

After 2+ requests with the same OKF context at position 0, DeepSeek's common prefix detector persists `[OKF_abc]` as a standalone cache unit. Every subsequent request hitting this prefix is served from disk — you pay nothing for those tokens.

### Cost model

- **First request**: full token cost for OKF context (~15K-20K tokens written)
- **Second request**: DeepSeek detects common prefix, persists cache unit
- **All subsequent requests**: cache hit on OKF context — **zero token cost** for that block

The cache persists across sessions (disk-based), so it survives restarts.

---

## Anthropic: Explicit Cache Control

Anthropic requires explicit `cache_control` annotations on content blocks. The OKF context is always injected with:

```json
{
  "type": "text",
  "text": "<okf_context>...",
  "cache_control": { "type": "ephemeral" }
}
```

### Cost model

- **First request**: full token cost for OKF context (write price)
- **Subsequent requests within 5-minute TTL**: 10% of write price (cache read price)
- **After 5 minutes without reuse**: cache expires, next request pays full price again

Anthropic's TTL is **5 minutes** per cache breakpoint. DeepSeek has no TTL — disk cache persists indefinitely.

---

## Proxy Injection Flow

Every LLM request goes through the backend proxy:

```
Claude CLI                  Backend Proxy              Provider
    │                            │                        │
    │  POST /v1/messages        │                        │
    │  { system: [...], ... }   │                        │
    │ ─────────────────────────→│                        │
    │                            │                        │
    │                            │ 1. Parse JSON body     │
    │                            │ 2. Read .okf_cache/    │
    │                            │ 3. Inject at position 0│
    │                            │ 4. Add cache_control   │
    │                            │ 5. Re-stringify        │
    │                            │                        │
    │                            │  POST /v1/messages     │
    │                            │  { system: [           │
    │                            │    { okf + cache_ctrl },│
    │                            │    ...original...      │
    │                            │  ], ... }              │
    │                            │ ──────────────────────→│
    │                            │                        │
    │                            │  Streaming response    │
    │                            │ ←──────────────────────│
    │  Streaming response        │                        │
    │ ←─────────────────────────│                        │
```

The injection happens in `handleProxyRequest()` (`packages/backend/src/services/api-router.ts`). The `cache_control` field is always present — Anthropic respects it, DeepSeek silently ignores it.

---

## File Watcher Lifecycle

```
Backend starts
    │
    ▼
startOkfWatcher()
    │
    ├─→ Seed: extractAllSourceFiles() runs on all src/** and packages/**
    │        → generates initial .okf_cache/*.okf.md files
    │
    ├─→ Watch: chokidar monitors src/** and packages/**
    │        excludes: node_modules, .okf_cache, .git, dist, bin, obj
    │
    └─→ On file change (debounced 1000ms):
         extractToOkf(filepath, projectRoot)
              │
              ├─→ Parse with ts-morph
              ├─→ Extract classes, interfaces, enums, functions, modules
              ├─→ Extract method signatures (no bodies)
              ├─→ Extract imports as dependencies
              ├─→ Write .okf.md to .okf_cache/
              └─→ Panel auto-refreshes (5s poll)
```

The watcher is started once at backend startup. It uses `process.cwd()` as the project root. For multi-project setups (e.g., `D:\WebClaudeCode` and `D:\ERP_goed`), the `setOkfProjectRoot()` function exists but is not yet wired to tab switching.

---

## Monitor Panel

Access via the **Database icon** in the left activity bar (between Changes and Settings).

The panel polls `/api/okf/status` every 5 seconds and shows:

| Section | What you see |
|---------|-------------|
| **Status dot** | Green pulsing = watcher active, grey = stopped |
| **Stats bar** | Total entities, total files, oldest file age |
| **File list** | Each generated `.okf.md` with type badge, entity name, source path, age, export/dep counts |
| **Age colors** | Green <10s, amber <60s, grey >60s |
| **Footer** | Project root path, last refresh time |

### States

- **Loading**: spinner on first load
- **Empty**: message explaining watcher will seed on first save
- **Populated**: scrollable list of all cached entities
- **Error**: backend unreachable, retry button

---

## Key Files

| File | Purpose |
|------|---------|
| `packages/shared/src/okf.ts` | Shared types: `OkfDocument`, `OkfStatus`, etc. |
| `packages/backend/src/services/okf/extractor.ts` | AST parser: TypeScript → `.okf.md` |
| `packages/backend/src/services/okf/watcher.ts` | chokidar watcher + seed + debounce |
| `packages/backend/src/services/okf/bundler.ts` | Reads `.okf_cache/`, builds context string, injects at position 0 |
| `packages/backend/src/services/okf/status.ts` | Reads cache metadata for the monitor panel |
| `packages/backend/src/services/api-router.ts` | Proxy handler: injects OKF into system prompt before upstream forward |
| `packages/backend/src/index.ts` | Starts watcher, registers `/api/okf/status` route |
| `packages/frontend/src/components/panels/OkfMonitorPanel.tsx` | Monitor panel UI |

---

## Token Cost Summary

| Scenario | DeepSeek | Anthropic |
|----------|----------|-----------|
| First request with OKF | Full token cost | Full token cost (write) |
| Subsequent requests | **Free** (disk cache hit) | 10% (prompt cache read) |
| OKF context size | ~15-20K tokens typical | Same |
| Cache lifetime | Indefinite (disk) | 5 minutes (ephemeral) |
| Control mechanism | Automatic prefix detection | Explicit `cache_control` |
