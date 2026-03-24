# HamCult - Secretary-First Personal Assistant

This repository contains the Phase 1 scaffold for a self-hosted, single-user Secretary-first assistant system.

## Workspace Layout

- `apps/web`: Next.js Desk UI and thin web-facing APIs
- `apps/worker`: Fastify runtime for chat orchestration and async processing
- `packages/config`: shared environment parsing and runtime config helpers
- `packages/core-runtime`: normalized runtime contracts and stub Secretary logic
- `packages/db`: database schema and migration home
- `packages/observability`: logger and trace helpers
- `docker/compose`: local infrastructure definitions
- `docs/adr`: architectural decision records

## Getting Started

1. Install dependencies with `npm install`
2. Copy `.env.example` to `.env`
3. Create visible runtime storage folders with `npm run storage:prepare`
4. Start local services with `npm run stack:up`
5. Apply the Phase 1 schema with `npm run db:migrate`
6. Run the apps in separate terminals:
   - `npm run dev:web`
   - `npm run dev:worker`

## Phase 1 Verification

To verify the current Phase 1 checkpoint:

1. Make sure the core stack is running with `npm run stack:up`
2. Run `npm run phase1:verify`

The verification script checks:

- runtime storage folders exist
- build succeeds
- migrations apply
- core stack is reachable
- Desk page loads
- web chat succeeds
- conversation history can be read back
- app restart preserves conversation data

Live service storage now lands in repo-visible paths:

- `runtime/postgres/data`: PostgreSQL cluster data
- `runtime/redis/data`: Redis persistence data

This initial scaffold now includes:

- a web Desk shell and thin API proxy
- a worker runtime with health checks
- Drizzle schema plus a first SQL migration
- persisted conversation, message, job, and trace wiring in the worker
- deterministic Secretary replies that use recent conversation context
- placeholder memory-candidate queueing through BullMQ
- automated Phase 1 verification for bring-up, chat, history, and restart

Telegram, voice, and tool execution are still intentionally out of scope for this stage.
