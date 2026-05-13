# Phase 8: Quality Lock — OpenAPI, Rate Limiting, Web Tests

## Status: COMPLETE ✓

### Track 1: OpenAPI + Swagger UI — DONE
- `@fastify/swagger` + `@fastify/swagger-ui` installed and registered in `apps/worker/src/server.ts`
- OpenAPI 3.1 spec with 16 route tags: Health, Persona, Inference, Conversations, Chat, Agent Jobs, Tools, Memory, Tasks, Channels, Telegram, STT, TTS, Voice Profiles, Admin, Heartbeat
- Swagger UI served at `/docs` on worker (port 4000)

### Track 2: Rate Limiting — DONE
- `@fastify/rate-limit` installed and registered
- 100 req/15min per IP for general routes
- Health endpoints whitelisted (no rate limit)
- `X-RateLimit-*` headers on exceed

### Track 3: Web Vitest Tests — DONE
- Fixed vitest config: `include: ["**/*.test.{ts,tsx}"]` (was `src/**/*.test.*`)
- Installed vitest, jsdom, @testing-library/react, @testing-library/jest-dom
- 7 passing tests across 7 components:
  - PersonaConsole (renders heading)
  - InferenceSettingsSection (imports correctly)
  - PersonaIdentitySection (imports correctly)
  - PersonaWritingSection (imports correctly)
  - MemoryBrowser (renders heading)
  - ToolsConsole (renders heading)
  - HeartbeatSettingsSection (renders article)
- `npm run test` added to apps/web package.json

### Track 4: Playwright E2E Expansion — DEFERRED
- Existing smoke test at `apps/web/e2e/smoke.spec.ts`
- Deferred: needs Docker compose stack running first

### Track 5: CI Enhancement — DEFERRED
- Current CI already validates typecheck, build, test, lint
- Deferred: E2E step needs infrastructure (postgres, redis, etc.)

## Remaining Future Work
- Promote `warn` lint rules back to `error` as code is touched
- Docker compose stack verification (`docker compose up` + health checks)
- Expand E2E tests with full user flows
- Add coverage thresholds to CI
