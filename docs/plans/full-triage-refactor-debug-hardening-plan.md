# SecretaryAI — Full Triage, Refactor, Debug & Hardening Plan

> **For Hermes:** Use `subagent-driven-development` + `codex` CLI skills to implement this plan task-by-task. Use `/lsp` for code review and verification.
> **Priority:** P0 — repo is broken and unbuildable. No merges without passing CI.

**Goal:** Bring the SecretaryAI monorepo to production-grade consistency: clean build, passing typecheck, passing tests, unified lint/format, verified E2E flows, and stable CI.

**Architecture:** TypeScript/npm workspaces monorepo: `apps/web` (Next.js 16 Desk UI), `apps/worker` (Fastify 5 + BullMQ), `packages/*` (shared), `services/*` (Python STT/TTS), Docker infra.

**Tech Stack:** Node.js >=24, TypeScript 5.9.3, Next.js 16.2.1, Fastify 5.3.2, Drizzle ORM 0.45.1, BullMQ 5.56.4, Docker, Playwright.

---

## PHASE 0 — Ground Truth: Error Inventory

> **Done by Samantha on 2026-05-13. Below is the verified defect list.**

| # | File | Error | Severity |
|---|------|-------|----------|
| 0-1 | `packages/observability/src/index.test.ts:3` | `.ts` extension in import: `from "./index.ts"` | BUILD-BLOCKING |
| 0-2 | `apps/web/app/desk-shell.tsx:620-635` | Duplicate `aria-label` and `title` JSX attributes | BUILD-BLOCKING |
| 0-3 | `apps/worker/src/lib/admin-runtime.ts:1436-1440` | Duplicate `updatedAt` property in object literal | BUILD-BLOCKING |
| 0-4 | `apps/worker/src/lib/agent-jobs.ts:1063-1117` | `requirements` variable never declared/initialized — used as `requirements.push(...)` but no `const requirements = []` | BUILD-BLOCKING |
| 0-5 | `apps/worker/src/lib/utils.test.ts:7` | `.ts` extension in import: `from "./utils.ts"` | BUILD-BLOCKING |
| 0-6 | `apps/worker/src/lib/utils/clean.test.ts:3` | `.ts` extension in import: `from "./clean.ts"` | BUILD-BLOCKING |
| 0-7 | `apps/worker/src/lib/utils/observability.test.ts:8` | `.ts` extension in import: `from "./observability.ts"` | BUILD-BLOCKING |
| 0-8 | `apps/web/package.json` | `ai` dep version mismatch (`^6.0.140`) vs root (`^6.0.141`) and worker (`^6.0.138`) | MILD |
| 0-9 | `packages/observability/src/index.test.ts:1-2` | `import test from "node:test"` and `import assert from "node:assert"` fail under `esModuleInterop: false` (pre-existing lint error) | TEST-ONLY |
| 0-10 | `apps/worker/package.json:50` | `dotenv` version string `"17.3.1"` missing `^` prefix | MILD |
| 0-11 | `apps/worker/src/index.ts:62-67` | Trailing empty comment lines (`// restart tick` + 4 blank lines) | COSMETIC |
| 0-12 | Entire repo | No ESLint, Prettier, or Biome config — zero static analysis beyond `tsc` | ARCHITECTURAL |
| 0-13 | Entire repo | No test runner config (vitest/jest/playwright). Tests use bare `node --test` with tsx. | ARCHITECTURAL |
| 0-14 | Entire repo | No CI config (GitHub Actions, etc.) | ARCHITECTURAL |
| 0-15 | `apps/web` | Only one test file: `auth_security.test.ts` (orphaned, no runner integration) | TEST-GAP |
| 0-16 | `apps/worker` | Only 6 `.test.ts` files covering utilities; zero coverage for: chat orchestration, Telegram, agent jobs, memory engine, speech runtime, task runtime, tool approvals, turn orchestrator | TEST-GAP |
| 0-17 | `apps/web/app/desk-shell.tsx` | 1,172 lines, 39KB — massive single component doing shell + chat + suggestions + accessibility + followups | REFACTOR |
| 0-18 | `apps/worker/src/lib/agent-jobs.ts` | 2,733 lines, 84KB — likely needs decomposition | REFACTOR |
| 0-19 | `apps/worker/src/lib/admin-runtime.ts` | 1,486 lines, 47KB — likely needs decomposition | REFACTOR |

**Test Command Used:** `npm run typecheck` (fails at worker), `npm run test --workspace @secretary/worker` (passes 13/13 on utilities only).

---

## PHASE 1 — Fix All Build-Blocking Errors

### Task 1.1: Fix `.ts` extension imports in test files

**Objective:** Remove `.ts` extensions from test file imports so they compile under the base tsconfig (no `allowImportingTsExtensions`).

**Files:**
- Modify: `packages/observability/src/index.test.ts:3`
- Modify: `apps/worker/src/lib/utils.test.ts:7`
- Modify: `apps/worker/src/lib/utils/clean.test.ts:3`
- Modify: `apps/worker/src/lib/utils/observability.test.ts:8`

**Steps:**
1. In each file, change `from "./foo.ts"` → `from "./foo"`.
2. Run `npm run typecheck` and confirm the 4 `TS5097` errors are gone.

**Verification:**
```bash
cd /Users/sean/repos/secretaryai
npm run typecheck 2>&1 | grep "TS5097" || echo "PASS — no TS5097 errors"
```

---

### Task 1.2: Fix duplicate JSX attributes in `desk-shell.tsx`

**Objective:** Remove duplicate `aria-label` and `title` on the send button.

**File:** `apps/web/app/desk-shell.tsx:620-638`

**Step 1: Confirm current state**
The button currently has `aria-label` and `title` defined twice (once as dynamic expressions, once as static strings). The dynamic versions were already removed in a prior patch, leaving only:
```tsx
aria-label="Send message"
title="Send message (Ctrl+Enter)"
```
If those are the only ones remaining, this error may already be resolved. If not, keep the static version and delete the duplicate.

**Verification:**
```bash
npm run typecheck 2>&1 | grep "desk-shell" || echo "PASS — no desk-shell errors"
```

---

### Task 1.3: Fix duplicate `updatedAt` in `admin-runtime.ts`

**Objective:** Remove duplicate `updatedAt` property.

**File:** `apps/worker/src/lib/admin-runtime.ts:1436-1440`

**Step 1:** Change:
```typescript
set: {
  enabled: sql`excluded.enabled`,
  approvalMode: sql`excluded.approval_mode`,
  updatedAt: now,
  updatedAt: new Date(),
},
```
to:
```typescript
set: {
  enabled: sql`excluded.enabled`,
  approvalMode: sql`excluded.approval_mode`,
  updatedAt: now,
},
```

**Verification:**
```bash
npm run typecheck 2>&1 | grep "admin-runtime" || echo "PASS — no admin-runtime TS1117"
```

---

### Task 1.4: Fix undeclared `requirements` variable in `agent-jobs.ts`

**Objective:** Declare `requirements` array before pushing into it.

**File:** `apps/worker/src/lib/agent-jobs.ts:1063-1117`

**Step 1:** Read the function `extractVerificationRequirements` (or whatever encloses lines 1063-1117).

**Step 2:** Insert before the first `requirements.push`:
```typescript
const requirements: Array<{
  jobId: string;
  stepId: string;
  kind: "port" | "network" | "service";
  label: string;
  detail: string;
  metadataJson: Record<string, unknown>;
}> = [];
```

**Step 3:** Verify the `insertRequirements({ dbClient, requirements })` call at line 1115-1117 receives the now-declared array.

**Verification:**
```bash
npm run typecheck 2>&1 | grep "agent-jobs" || echo "PASS — no agent-jobs errors"
```

---

### Task 1.5: Fix `dotenv` version string in worker package.json

**Objective:** Add `^` prefix for consistency.

**File:** `apps/worker/package.json:50`

**Step 1:** Change `"dotenv": "17.3.1"` → `"dotenv": "^17.3.1"`.

**Verification:** `npm install` completes without audit drift related to this dep.

---

### Task 1.6: Clean trailing noise in `apps/worker/src/index.ts`

**Objective:** Remove trailing `// restart tick` comment lines.

**File:** `apps/worker/src/index.ts:62-67`

**Step 1:** Delete lines 62-67 (the comment and blank lines after the final `}`).

---

### Task 1.7: Unify `ai` dependency version across workspaces

**Objective:** Eliminate version drift for the `ai` package.

**Files:**
- `package.json` root: currently `^6.0.141`
- `apps/web/package.json`: currently `^6.0.140`
- `apps/worker/package.json`: currently `^6.0.138`

**Step 1:** Align all three to the latest installed version: `^6.0.141`.

**Step 2:** Run `npm install` to update lockfile.

**Verification:** `npm ls ai` shows a single deduped version.

---

### Task 1.8: Fix pre-existing `node:test`/`node:assert` import style

**Objective:** Make `packages/observability/src/index.test.ts` compile cleanly.

**File:** `packages/observability/src/index.test.ts:1-2`

**Issue:** `import test from "node:test"` and `import assert from "node:assert"` fail because `esModuleInterop: false` in base tsconfig. `node:test` and `node:assert` are CommonJS-style modules.

**Step 1:** Change to:
```typescript
import { test } from "node:test";
import { strict as assert } from "node:assert";
```

**Step 2:** Update all `assert.*` calls to use `assert.strictEqual` etc. (already using `strictEqual`, so this is compatible).

**Verification:**
```bash
cd /Users/sean/repos/secretaryai/packages/observability
npx tsc --noEmit
```

---

### Task 1.9: Full typecheck pass

**Objective:** `npm run typecheck` exits 0 with zero errors across all workspaces.

**Command:**
```bash
cd /Users/sean/repos/secretaryai
npm run typecheck
```

**Done When:** Exit code 0, stdout contains no `error TS` lines.

---

## PHASE 2 — Establish Lint/Format/Test Tooling

### Task 2.1: Install and configure Biome

**Objective:** Add a fast unified linter/formatter (ESLint + Prettier replacement) with zero config sprawl.

**Rationale:** Biome handles TS/JS/JSON in one binary, respects our `strict` tsconfig, and is fast. ESLint 9 flat config is too much ceremony for this repo's needs.

**Files:**
- Create: `biome.json`
- Modify: `package.json` (add devDeps + scripts)

**Step 1: Add dev dependency**
```bash
cd /Users/sean/repos/secretaryai
npm install -D -w secretary-first-assistant @biomejs/biome
```

**Step 2: Write `biome.json`**
```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "organizeImports": { "enabled": true },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "correctness": {
        "noUnusedVariables": "error",
        "noUnusedImports": "error"
      },
      "suspicious": {
        "noConsoleLog": "warn",
        "noExplicitAny": "warn"
      }
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "double",
      "semicolons": "always"
    }
  },
  "files": {
    "ignore": ["node_modules", "dist", ".next", "coverage", "runtime", "drizzle"]
  }
}
```

**Step 3: Add scripts to root `package.json`**
```json
"lint": "biome check .",
"lint:fix": "biome check . --write",
"format": "biome format . --write"
```

**Verification:**
```bash
npx biome check apps/worker/src/index.ts
# Should report real issues (console.log, unused vars, etc.)
```

---

### Task 2.2: Configure `node --test` for worker with tsx

**Objective:** Make the existing test suite discoverable and runnable as a single command.

**File:** `apps/worker/package.json`

**Step 1:** Ensure the test script already covers all `.test.ts` files:
```json
"test": "node --import tsx --test 'src/**/*.test.ts'"
```

**Step 2:** Add a `test:watch` script:
```json
"test:watch": "node --import tsx --test --watch 'src/**/*.test.ts'"
```

**Verification:**
```bash
cd /Users/sean/repos/secretaryai
npm run test --workspace @secretary/worker
# Expected: all 13 tests pass (after Phase 1 fixes)
```

---

### Task 2.3: Add Playwright config stub for E2E

**Objective:** Prepare the repo for browser-based E2E verification ( Desk UI + worker flows).

**File:** Create `apps/web/playwright.config.ts`

**Step 1:** Write minimal config:
```typescript
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
```

**Step 2:** Create `apps/web/e2e/smoke.spec.ts`:
```typescript
import { test, expect } from "@playwright/test";

test("health endpoint responds", async ({ request }) => {
  const response = await request.get("http://localhost:4000/health");
  expect(response.status()).toBeLessThan(500);
});
```

**Step 3:** Add dev dependency to `apps/web/package.json`:
```json
"@playwright/test": "^1.58.2"
```

**Verification:** `npm install` completes, Playwright binary downloads.

---

## PHASE 3 — Expand Test Coverage

### Task 3.1: Add unit tests for `task-runtime.ts`

**Objective:** Cover `buildTaskDraft`, `parseReminderTime`, `normalizeTaskTitle` with edge cases.

**File:** `apps/worker/src/lib/task-runtime.test.ts` (already exists)

**Step 1:** Read current test file and the source `task-runtime.ts`.

**Step 2:** Add tests for:
- Empty title fallback (should normalize to "New task" or similar)
- Very long title truncation
- Invalid reminder text (e.g., "remind me never")
- Duplicate title deduplication logic

**Verification:**
```bash
npm run test --workspace @secretary/worker
```

---

### Task 3.2: Add unit tests for `chat-persistence.ts`

**Objective:** Cover conversation creation, message insertion, and retrieval.

**File:** Create `apps/worker/src/lib/chat-persistence.test.ts`

**Step 1:** Inspect `chat-persistence.ts` exports.

**Step 2:** Write tests using an in-memory SQLite or mocked Drizzle client. If Drizzle/pg is hard to mock, test the pure helper functions (if any) first.

**Verification:** Tests pass in isolation.

---

### Task 3.3: Add unit tests for `turn-orchestrator.ts`

**Objective:** Cover the resolution order: safe tool intent → pending approval → pending requirement → pending launch → normal reply.

**File:** Create `apps/worker/src/lib/turn-orchestrator.test.ts`

**Step 1:** Read `turn-orchestrator.ts` and identify pure/stateless decision functions.

**Step 2:** Write tests for each branch in the resolution order using mocked context.

**Verification:** Tests pass.

---

### Task 3.4: Add unit tests for `telegram-integration.ts`

**Objective:** Cover webhook payload parsing, message extraction, and bot command routing.

**File:** Create `apps/worker/src/lib/telegram-integration.test.ts`

**Step 1:** Read `telegram-integration.ts` and identify pure parsing functions.

**Step 2:** Write tests with sample Telegram Update JSON fixtures.

**Verification:** Tests pass.

---

### Task 3.5: Add regression script for Phase 4 (voice)

**Objective:** The existing `scripts/phase4/verify.mjs` should be runnable and validated.

**File:** `scripts/phase4/verify.mjs`

**Step 1:** Read the script. Determine if it depends on running services.

**Step 2:** If it requires Docker services, add a `verify:dry` mode that validates the script structure without live deps.

**Step 3:** Document prerequisites in a comment block at the top.

**Verification:**
```bash
node scripts/phase4/verify.mjs --dry
```

---

## PHASE 4 — CI/CD Skeleton

### Task 4.1: Add GitHub Actions workflow

**Objective:** Run typecheck + build + tests on every PR and push to `main`.

**File:** Create `.github/workflows/ci.yml`

**Step 1:** Write workflow:
```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "24"
          cache: "npm"
      - run: npm ci
      - run: npm run build:packages
      - run: npm run typecheck
      - run: npm run test --workspace @secretary/worker
      - run: npm run lint
```

**Verification:** Push to a branch, open a test PR, confirm all steps pass.

---

## PHASE 5 — Refactor & Decomposition (Post-Stabilization)

> **Rule:** Do NOT start Phase 5 until Phases 1-4 are fully passing.

### Task 5.1: Decompose `desk-shell.tsx` into sub-components

**Objective:** Split the 1,172-line desk shell into focused components.

**Files:**
- Create: `apps/web/app/desk-shell/chat-input.tsx` (input area + send button + followups)
- Create: `apps/web/app/desk-shell/message-list.tsx` (message rendering)
- Create: `apps/web/app/desk-shell/sidebar.tsx` (nav + conversation list)
- Modify: `apps/web/app/desk-shell.tsx` (orchestrator shell only)

**Step 1:** Identify the 3-4 major DOM regions in `desk-shell.tsx`.

**Step 2:** Extract each region into its own component file with explicit props interfaces.

**Step 3:** Update imports in `desk-shell.tsx`.

**Verification:** `npm run typecheck` passes, `npm run build --workspace @secretary/web` passes, and the Desk UI renders identically.

---

### Task 5.2: Decompose `agent-jobs.ts` into domain modules

**Objective:** Split the 2,733-line file into focused modules.

**Target modules:**
- `agent-job-lifecycle.ts` — create, cancel, resume, finalize
- `agent-job-execution.ts` — runStep, tool loop, verification
- `agent-job-requirements.ts` — extract, insert, resolve requirements
- `agent-job-artifacts.ts` — artifact storage/retrieval
- `agent-jobs.ts` — thin barrel re-export

**Step 1:** Use `read_file` to map function boundaries.

**Step 2:** Move functions into new files, update imports in consumers.

**Verification:** `npm run typecheck` passes, all existing tests pass.

---

### Task 5.3: Decompose `admin-runtime.ts` into domain modules

**Objective:** Split the 1,486-line admin file.

**Target modules:**
- `admin-import-export.ts` — settings import/export
- `admin-snapshots.ts` — snapshot utils
- `admin-runtime.ts` — remaining orchestration

**Verification:** Same as 5.2.

---

## PHASE 6 — E2E Verification

### Task 6.1: Smoke test the full dev stack

**Objective:** Prove the system starts and the Desk UI is reachable.

**Steps:**
1. `npm run storage:prepare`
2. `npm run stack:up`
3. `npm run db:migrate`
4. `npm run dev:worker` (in background)
5. `npm run dev:web` (in background)
6. `curl http://localhost:3000` → expect 200
7. `curl http://localhost:4000/health` → expect 200

**Verification:** All curls return 200 within 30 seconds of startup.

---

### Task 6.2: Verify Phase 1-6 scripts

**Objective:** Run all phase verification scripts and document failures.

**Command:**
```bash
npm run phase1:verify
npm run phase2:verify
npm run phase3:verify
npm run phase4:verify
npm run phase5:verify
npm run phase6:verify
```

**Step 1:** Run each and capture output.

**Step 2:** Document any script failures in a new `docs/plans/verification-results.md`.

**Step 3:** Fix any script bugs found (e.g., missing env vars, wrong paths).

---

## Done When (Definition of Done)

- [ ] `npm run typecheck` exits 0 with zero errors
- [ ] `npm run build` exits 0
- [ ] `npm run test --workspace @secretary/worker` exits 0 (13+ tests)
- [ ] `npm run lint` (Biome) runs and reports only warnings (zero errors)
- [ ] `.github/workflows/ci.yml` exists and passes on `main`
- [ ] `apps/web/e2e/smoke.spec.ts` runs and passes against a running stack
- [ ] `AGENTS.md` is updated to reflect any changed commands or new scripts
- [ ] All build-blocking errors from the Phase 0 inventory are resolved
- [ ] No `.ts` extension imports remain in any `.test.ts` file
- [ ] No duplicate object properties remain in the codebase
- [ ] `dotenv` version string is normalized with `^` prefix
- [ ] `ai` package is deduped to a single version across workspaces
- [ ] Trailing noise comments removed from `apps/worker/src/index.ts`

---

## Execution Order

1. **Phase 1** (Tasks 1.1–1.9) — immediate, no dependencies
2. **Phase 2** (Tasks 2.1–2.3) — depends on Phase 1 (clean build needed)
3. **Phase 3** (Tasks 3.1–3.5) — depends on Phase 1-2
4. **Phase 4** (Task 4.1) — depends on Phase 1-3
5. **Phase 5** (Tasks 5.1–5.3) — depends on Phase 1-4; defer if time-constrained
6. **Phase 6** (Tasks 6.1–6.2) — depends on everything above; manual verification required

## Delegation Strategy

| Phase | Tooling | Notes |
|-------|---------|-------|
| Phase 1 | Hermes directly (patch + terminal) | Build-blocking, needs immediate feedback |
| Phase 2 | Hermes directly (config files) | Tooling setup, low risk |
| Phase 3 | `delegate_task` (leaf) × 5 | Parallel test writing |
| Phase 4 | Hermes directly (single file) | Simple skeleton |
| Phase 5 | `codex` CLI or `delegate_task` | Large refactor, needs careful review |
| Phase 6 | Hermes + manual | Needs live services |

## Notes for Implementers

- **No `node:` prefix imports are wrong** — `node:test` and `node:assert` are valid Node.js 24 built-ins. The import style just needs `esModuleInterop` awareness (use named imports).
- **Do not change `tsconfig.base.json` `moduleResolution`** — `Bundler` is correct for Next.js + Fastify hybrid.
- **Do not add `allowImportingTsExtensions`** — that would require `noEmit: true` everywhere and break the `build` scripts. Fix the imports instead.
- **Keep `tsx` for dev/test** — it works; don't migrate to `ts-node` or `vitest` unless asked.
- **Phase 5 refactor is optional for MVP** — the repo will be stable and buildable after Phase 4. Phase 5 is hygiene for long-term maintenance.
