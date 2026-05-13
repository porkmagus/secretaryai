# Phase 8: Quality Lock — OpenAPI, Rate Limiting, Web Tests, E2E Expansion

## Track 1: OpenAPI + Swagger UI (Worker API)
- Install `@fastify/swagger` + `@fastify/swagger-ui`
- Add Swagger decorators/schema to all ~40+ worker routes in server.ts
- Serve `/docs` with Swagger UI on the worker (port 4000)
- Auto-generate OpenAPI 3.1 spec from route schemas
- Verify: `curl http://localhost:4000/docs` returns UI

## Track 2: Rate Limiting (Worker API)
- Install `@fastify/rate-limit`
- Register rate limiter: 100 req/15s per IP for general routes
- Stricter limits: 20 req/min for chat/inference routes, 5 req/min for admin
- Add `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` headers
- Whitelist health check endpoints
- Verify: headers present, rate limiting enforced

## Track 3: Web Vitest Unit Tests
- Fix vitest config (currently points to `src/**/*.test.*` but web app uses `app/` dir)
- Write component tests for key UI components:
  - `desk-shell/chat-input.tsx` — input handling, submit, keydown
  - `desk-shell/message-list.tsx` — rendering messages, status indicators
  - `desk-shell/sidebar.tsx` — navigation, active state
  - `lib/ui.tsx` — SurfaceCard, FieldHint, LoadingShell
  - `lib/secretary-portrait-field.tsx` — portrait upload flow
- Write hook tests:
  - `lib/desk-chat-hooks.ts` — state management, pending approvals
- Target: 15+ tests, 60%+ coverage on tested files

## Track 4: Playwright E2E Expansion
- Extend smoke.spec.ts with full flows:
  - Desk compose → send message → see response
  - Navigate to persona settings → change name → verify persist
  - Health page → verify all services status
  - Sidebar navigation → all routes load without 500
- Add API testing: worker health endpoints
- Target: 8+ E2E tests

## Track 5: CI Enhancement
- Add E2E test step to CI (start web + worker, run playwright)
- Add coverage threshold: fail if < 50% on tracked files
- Upload Playwright report + screenshots as CI artifacts
- Add OpenAPI spec validation step
