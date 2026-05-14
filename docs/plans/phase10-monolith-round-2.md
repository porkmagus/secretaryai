# Phase 10: Monolith Round 2

**Goal:** Continue structural simplification. Kill dead code, split remaining worker monoliths, and apply the `sections/` feature folder pattern to remaining web consoles.

**Guiding principle:** No behavioral changes. Pure structural surgery. Typecheck + tests + lint must pass after each sub-phase.

---

## Phase 10A: Nuke dead `tools-runtime.ts` (Immediate Win)

The original 2,752-line monolith from Phase 9B was never deleted. It has zero imports. Safe to delete.

### Action
1. `rm apps/worker/src/lib/tools-runtime.ts`
2. Verify: `grep -rn 'tools-runtime' --include="*.ts" --include="*.tsx"` returns nothing
3. Run `npm run typecheck && npm test && npm run lint`
4. Commit & push

---

## Phase 10B: Split `agent-job-executor.ts` (1807 lines)

### Current: Everything about agent job execution in one file
- Step execution functions
- Tool loop logic
- Verification
- Step state management

### Target: `apps/worker/src/lib/agent-jobs/executor/`
```
executor/
  index.ts          — public re-exports
  steps.ts          — step execution, state transitions
  tool-loop.ts      — executeToolLoop, runStep, runVerification
  transformers.ts   — (if any remaining)
```

---

## Phase 10C: Split `jobs-console.tsx` (1169 lines) ✅ COMPLETE

### Result:
- Extracted 4 sub-components to `apps/web/app/activity/jobs/sections/`:
  - `job-status-pill.tsx`: JobStatusPill, ArtifactContent, statusTone
  - `job-form-panel.tsx`: job creation form
  - `job-detail-panel.tsx`: job detail view (steps, requirements, artifacts)
  - `job-queue-panel.tsx`: job queue/history list
- jobs-console.tsx reduced to 1138 lines
- Committed: `acfbd9b`

---

## Phase 10D: Split `memory-engine.ts` (1204 lines)

### Current: All memory logic in one file
- Memory search
- Memory CRUD
- Memory scoring/relevance
- Memory linking

### Target: `apps/worker/src/lib/memory/`
```
index.ts            — public API
engine.ts           — core search, scoring, relevance
crud.ts             — create, update, delete, list
linking.ts          — memory relationships
```

---

## Phase 10E: Split `admin-runtime-core.ts` (1476 lines)

### Current: All admin logic in one file
- Import/export
- Snapshots
- Data validation
- Migration helpers

### Target: `apps/worker/src/lib/admin/`
```
index.ts            — public API
import-export.ts    — data import/export
snapshots.ts        — snapshot creation/restore
validation.ts       — data validation helpers
migration.ts        — migration helpers
```

---

## Phase 10F: Split `desk-shell.tsx` (1177 lines)

### Current: Main shell layout monolith
- Sidebar navigation
- Console routing
- Onboarding flow
- System notices
- Persona selection

### Target: `apps/web/app/desk-shell/sections/`
```
sections/
  index.ts
  sidebar-nav.tsx         — left sidebar, navigation
  console-router.tsx      — console selection/display
  onboarding-flow.tsx     — onboarding steps
  system-notices.tsx      — notice banners, readiness
```

---

## Execution Order

1. **10A** — Delete dead code (zero risk)
2. **10C** — Split jobs-console (matches established pattern)
3. **10F** — Split desk-shell (web, same pattern)
4. **10B** — Split agent-job-executor (worker, medium risk)
5. **10D** — Split memory-engine (worker, medium risk)
6. **10E** — Split admin-runtime-core (worker, medium risk)

Each phase ends with: `npm run typecheck && npm run test && npm run lint` — all must pass.
