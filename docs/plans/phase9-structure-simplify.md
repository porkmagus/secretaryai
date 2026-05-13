# Phase 9: Structure Simplification

**Goal:** Reduce codebase complexity by eliminating indirection layers, splitting monoliths, and consolidating scattered utilities. Target: same functionality, fewer files, clearer boundaries.

**Guiding principle:** No behavioral changes. Pure structural surgery. Tests must pass after each phase.

---

## Phase 9A: Kill Barrel/Alias Files (Immediate Win, Zero Risk)

### Problem
6 files exist solely to re-export functions under different names. Nobody imports them externally. They're indirection noise.

| File | Lines | What it does |
|------|-------|--------------|
| `agent-job-artifacts.ts` | 5 | Aliases `getAgentJobDetail` as `getArtifact`, `listArtifacts`, `storeArtifact` |
| `agent-job-execution.ts` | 7 | Aliases `processAgentJob` as `executeToolLoop`, `runStep`, `runVerification` |
| `agent-job-lifecycle.ts` | 7 | Re-exports lifecycle functions from runtime |
| `agent-job-requirements.ts` | 6 | Aliases `decideAgentJobRequirement` under 4 names |
| `agent-jobs.ts` | 6 | Barrel of all the above |
| `admin-runtime.ts` | 3 | Barrel of `admin-import-export`, `admin-runtime-core`, `admin-snapshots` |

### Action
1. Delete all 6 files
2. Verify nothing imports them (only imports are from within the barrel chain itself)
3. Run `npm run typecheck && npm run test && npm run lint`

### Expected: Zero impact. Fewer files to confuse readers.

---

## Phase 9B: Split `tools-runtime.ts` (2752 lines → ~6 files)

### Current: 72 functions in one file
- 20+ `parse*Intent` functions (intent parsing)
- 15+ `execute*` functions (tool execution)
- 5 utility/parsing helpers
- 6 tool registry/CRUD functions
- 4 trace/persistence functions
- Context building + memory lookup

### Target structure:
```
apps/worker/src/lib/tools/
  index.ts          — public API (listTools, updateTool, handleToolAwareTurn, decideToolExecution)
  types.ts          — BuiltInTool, ToolIntent, constants, builtInTools array
  parsers.ts        — All parse*Intent + detectToolIntent (20+ functions)
  executors.ts      — All execute* functions (15+ tool executors)
  registry.ts       — ensureToolRegistry, getToolByKey, listTools, updateTool, listToolExecutions
  context.ts        — buildToolContext, persistAssistantResult, createExecution, trace helpers
  utils.ts          — resolveWorkspacePath, allowedShellCommand, shortSnippet, path helpers
```

### Novel approach: Registry-based tool dispatch
Instead of `detectToolIntent` manually parsing text with regex for each tool, use a declarative registry:

```ts
// Each tool declares its own parse + execute + metadata
const toolRegistry = new Map<string, ToolDefinition>({
  web_search: {
    name: "Web Search",
    parse: (text) => parseSearchIntent(text),
    execute: (params) => executeWebSearch(config, query),
    approvalMode: "always_allow",
  },
  // ...
});
```

This eliminates the 900-line `detectToolIntent` mega-function and makes adding/removing tools a single entry.

---

## Phase 9C: Split `agent-job-runtime.ts` (2865 lines → ~5 files)

### Current: Everything about agent jobs in one file
- Job CRUD (create, cancel, resume, list, get detail)
- Job processing (`processAgentJob`, step execution)
- Requirement management
- Artifact handling
- Conversation updates
- Settings persistence
- Transformers (DB ↔ API formats)

### Target structure:
```
apps/worker/src/lib/agent-jobs/
  index.ts          — public API re-exports
  types.ts          — Job types, status enums, queue payload types
  lifecycle.ts      — createAgentJob, cancelAgentJob, resumeAgentJob, listAgentJobs, getAgentJobDetail
  processing.ts     — processAgentJob, runStep, executeToolLoop, runVerification
  requirements.ts   — decideAgentJobRequirement, requirement CRUD
  artifacts.ts      — getArtifact, listArtifacts, storeArtifact
  settings.ts       — (existing agent-job-settings.ts, move here)
  queue.ts          — (existing agent-job-queue.ts, move here)
  transformers.ts   — (existing, move here)
  conversation.ts   — (existing agent-job-conversation-updates.ts, move here)
```

---

## Phase 9D: Split `server.ts` (2296 lines → route modules)

### Current: All Fastify routes + Swagger + startup in one file
### Target:
```
apps/worker/src/server/
  index.ts          — Fastify app factory, Swagger, rate limit, startup
  routes/
    health.ts       — /health/* routes
    chat.ts         — /chat routes
    tools.ts        — /tools/*, /tool-executions/*
    jobs.ts         — /agent-jobs/*
    tasks.ts        — /tasks/*
    memories.ts     — /memories/*
    conversations.ts — /conversations/*
    integrations.ts — /integrations/*
    voice.ts        — /voice/*
    speech.ts       — /speech/*
    admin.ts        — /admin/*
    persona.ts      — /persona/*
```

---

## Phase 9E: Consolidate `utils/` Subfolder

### Current: Scattered across multiple locations
```
utils/index.ts      — cleanText, logToolExecution
utils/clean.ts      — cleanText (duplicate?)
utils/paths.ts      — repoRoot, sanitizeSegment, ensureDir
utils/observability.ts — logToolExecution (duplicate?)
```

### Target: Single `utils.ts` with clear sections
```
apps/worker/src/lib/utils.ts
  — Path helpers (repoRoot, sanitizeSegment, resolveRuntimePath, ensureDir)
  — Text helpers (cleanText, shortSnippet)
  — Observability (logToolExecution, createTrace)
```

Delete the subfolder entirely. 4 files → 1.

---

## Phase 9F: Web Console Component Simplification

### Current: 5 "console" components at 1000+ lines each
- `desk-shell.tsx` (1177 lines)
- `jobs-console.tsx` (1169 lines)
- `tools-console.tsx` (1120 lines)
- `voice-console.tsx` (1112 lines)
- `memory-browser.tsx` (678 lines)

### Approach: Extract common patterns
1. **Shared hooks**: `usePolling`, `useFetch` patterns scattered → consolidate
2. **Shared UI primitives**: Loading states, error banners, empty states → `lib/ui.tsx`
3. **Section composition**: Each "console" is really a tabbed dashboard. Extract `<TabbedConsole>` wrapper.
4. **State management**: Each console does its own API polling + state. Extract `useConsoleData<T>` generic hook.

Target: Each console component drops to ~400-600 lines by extracting shared patterns.

---

## Execution Order

1. **9A** — Delete barrels (safe, immediate, tests prove no breakage)
2. **9E** — Consolidate utils (low risk, clears the path for other phases)
3. **9B** — Split tools-runtime (highest impact, unlocks 9C)
4. **9C** — Split agent-job-runtime (second highest impact)
5. **9D** — Split server.ts (clean routing structure)
6. **9F** — Web component simplification (visual, lower priority for backend)

Each phase ends with: `npm run typecheck && npm run build && npm run test && npm run lint` — all must pass.

---

## Risk Assessment

| Phase | Risk | Rollback |
|-------|------|----------|
| 9A | Near zero | Git revert |
| 9E | Low — verify no import paths break | Git revert |
| 9B | Medium — tools-runtime has many consumers | Feature branch |
| 9C | Medium — agent jobs are core | Feature branch |
| 9D | Low — server.ts is self-contained | Feature branch |
| 9F | Low — web components are isolated | Feature branch |

## Novel Techniques Applied

1. **Registry pattern** for tool dispatch — eliminates 900-line switch function
2. **Feature-folder structure** — `tools/`, `agent-jobs/`, `server/routes/` instead of flat file soup
3. **Generic console hook** — `useConsoleData<T>` replaces 5 copies of the same polling pattern
4. **Declarative intent parsing** — each tool owns its parser, not a central mega-function
5. **Single utils file** — 4 scattered files with overlapping content → 1 file with clear sections
