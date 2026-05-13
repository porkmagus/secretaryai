# Phase 7: Production Hardening & Quality Lock

Status: Planning  
Goal: Move from "passes basic CI" to "passes production-grade scrutiny" — zero warnings, zero technical debt, zero ambiguity.

## 1. CI Pipeline Hardening

### 1.1 Fix CI YAML (critical bug)
`npm run test --workspace @secretary/worker` is **not valid npm syntax**.  
CI runs: `npm run test --workspace @secretary/worker` but `test` does not exist on root.  
It must be: `npm run test -w @secretary/worker` or `npm --workspace @secretary/worker run test`.

### 1.2 Add Unified Test Orchestration
- Root `package.json`: add `"test": "npm run test --workspaces --if-present"`  
  (runs test in every workspace that has one)
- Each package without tests: add `"test": "echo 'no tests: skip' && exit 0"`
- Add `"test:coverage"` script using c8 (built-in coverage for node:test)
- Add npm `--ignore-scripts` where appropriate

### 1.3 GitHub Actions Reliability
- Add dependency cache key on `package-lock.json` hash
- Add `timeout-minutes: 10` per step
- Add artifacts upload for build outputs on failure
- Remove `continue-on-error: true` from lint step once warnings are fixed
- Add `--max-diagnostics=0` (show all) for lint

## 2. Lint & Type Safety: Zero Warnings

### 2.1 Address All Biome Warnings
Current: several rules demoted to `warn` in `biome.json`.

| Rule | Current | Action |
|------|---------|--------|
| `complexity/noBannedTypes` | warn | Fix all `{}` / `Function` / `Object` usage |
| `suspicious/noConsole` | warn | Remove debug logs, keep intentional logs with `// biome-ignore lint/suspicious/noConsole: <reason>` |
| `suspicious/noExplicitAny` | warn | Replace with `unknown` + type guards where possible; `// biome-ignore` only for external API boundaries and AI SDK patterns |

### 2.2 Fix the CI Syntax Error
Change `continue-on-error: true` → proper fail-fast with allowed warnings handled via Biome severity.

## 3. Test Coverage Expansion

### 3.1 Worker: Reach 80% line coverage
Current: 74 tests across ~66 files. Unknown coverage.  
Use c8 (`npx c8 npm run test`) to measure baseline, then add tests for:
- `agent-job-runtime.ts` (2,742 lines, 0 tests currently)
- `admin-runtime.ts` / `admin-import-export.ts`
- `conversation-decisions.ts` (has tests — extend edge cases)
- `turn-orchestrator.ts` (has tests — extend)

### 3.2 Database: Add Unit Tests (currently 0)
- Setup SQLite in-memory for tests (or mock Drizzle)
- Test query builders and schema helpers
- Test migration scripts with `npm run --if-present`

### 3.3 Packages: Add Unit Tests (currently 0)
- `config`: test env var parsing and defaults
- `core-runtime`: test context message mapping
- `integrations`: test adapter patterns with mocked clients
- `observability`: already has 1 test file — verify coverage

### 3.4 Web: Add Frontend Unit Tests (currently 0 unit tests, 1 Playwright smoke)
- Setup Vitest for React testing
- Test utility functions
- Test desk-shell sub-components (chat-input, message-list, sidebar)
- Extend Playwright: add navigation, form interaction, error boundary tests

## 4. Developer Experience (DX)

### 4.1 Fix `tsx` Deprecation Warnings
Node 26 warns: `[DEP0205] module.register() deprecated`.  
Fix: update tsx to 4.25.x or add `NODE_OPTIONS='--no-warnings'` in test/lint scripts.

### 4.2 Pre-Commit Hooks (Husky + lint-staged)
```json
// package.json
"prepare": "husky"
"lint-staged": {
  "*.{ts,tsx}": ["biome check --write --no-errors-on-unmatched"]
}
```
Install: `husky`, `lint-staged`  
Ensures no unlinted code reaches CI.

### 4.3 VS Code Settings (Optional)
Add `.vscode/settings.json` for Biome as default formatter + `formatOnSave`.

## 5. API Documentation & Contract Safety

### 5.1 Generate OpenAPI Specs
- Fastify 5 + `@fastify/swagger` → auto-generate from Zod schemas
- Document `/health`, `/api/chat`, `/api/tasks`, `/api/settings`
- Serve Swagger UI at `/docs` in dev mode only

### 5.2 Zod Schema Validation
- Audit all route handlers for missing `.strict()` or `.passthrough()`
- Add centralized error response format `{"success": false, "error": "..."}`

## 6. Docker & Deployment

### 6.1 Add `compose.yml` (or verify existing orchestration)
If none exists at top-level, add one that:
- Builds `sweb` and `worker` from local Dockerfiles
- Includes `postgres`, `redis`, `searxng`, `stt`, `tts` services  
- Uses `.env` for configuration  
- Includes health checks on Postgres (`pg_isready`) and Redis (`redis-cli ping`)

### 6.2 Dockerfile Hardening
- Add `HEALTHCHECK` instruction to both web and worker Dockerfiles
- Add `.dockerignore` to reduce context size
- Verify `node:24-bookworm-slim` → `NODE_ENV=production`
- Consider non-root user (`USER node`)

## 7. Security & Error Handling

### 7.1 Audit Input Validation
- All `req.body` in Fastify must have Zod schemas
- All chat messages and task inputs must sanitize before DB insert
- Review for SQL injection vectors in Drizzle raw queries (if any)

### 7.2 Rate Limiting
- Add `@fastify/rate-limit` on all public routes
- Configurable via env var `RATE_MAX=100` `RATE_WINDOW_MS=60000`

### 7.3 Healthz Endpoints
- `/health` → basic liveness
- `/health/deep` → checks DB connectivity, Redis, external API reachability
- Worker: `/health` → queue depth, memory usage, uptime

## 8. Naming & Cohesion

### 8.1 Unify Project Name
Currently: package.json = `secretary-first-assistant`, README = `HamCult`.  
Pick one or create a clear hierarchy: HamCult (product name) / SecretaryAI (repo name).

## 9. Execution Plan (Delegation)

| Phase | Task | Owner | Complexity |
|-------|------|-------|------------|
| 7.1 | Fix CI YAML syntax + add `test` root script | Hermes | Low |
| 7.2 | Measure coverage baseline with c8 | Hermes | Low |
| 7.3 | Fix Biome warnings (all) | Codex (large refactor) | Medium |
| 7.4 | Husky + lint-staged + .vscode settings | Hermes | Low |
| 7.5 | Add DB package tests (sqlite mock) | Codex | Medium |
| 7.6 | Add config/core-runtime/integrations tests | Codex | Medium |
| 7.7 | Add web Vitest unit tests + extend e2e | Codex | High |
| 7.8 | OpenAPI / Swagger setup | Codex | Medium |
| 7.9 | Healthchecks & rate limiting | Hermes | Medium |
| 7.10 | compose.yml + Dockerfile health checks | Hermes | Low |

**Parallel tracks:**
- Track A (Quality): 7.1 → 7.2 → 7.3 → 7.4 (CI → Lint → Hooks)
- Track B (Testing): 7.5 → 7.6 → 7.7 (Backend → Frontend)
- Track C (Infrastructure): 7.9 → 7.10 → 7.8 (Ops → Docs)

## 10. Success Criteria

- [ ] `npm test` runs and passes for ALL workspaces
- [ ] `npm run lint` passes with zero errors, zero warnings
- [ ] `npm run test:coverage` reports ≥80% line coverage overall
- [ ] `npm run build` produces valid output
- [ ] `npm run typecheck` passes for all 7 workspaces
- [ ] GitHub Actions CI passes on every push with `fail-fast` enabled
- [ ] Pre-commit hooks block unlinted commits locally
- [ ] OpenAPI spec is generated at `/docs`
- [ ] `docker compose up` spins full stack with health checks
- [ ] No tsx deprecation warnings in CI output