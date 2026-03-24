# HamCult - Secretary-First Personal Assistant

This repository contains a polished Phase 1 through Phase 3 checkpoint for a self-hosted, single-user Secretary-first assistant system.

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
3. Add your real `TELEGRAM_BOT_TOKEN` only in `.env` if you want to exercise the live Telegram path
4. Create visible runtime storage folders with `npm run storage:prepare`
5. Start local services with `npm run stack:up`
6. Apply the current schema with `npm run db:migrate`
7. Run the apps in separate terminals:
   - `npm run dev:web`
   - `npm run dev:worker`

## Current Baseline

- `apps/web`: Next.js `16.2.1` with React `19.2.4`
- shared TypeScript baseline: `5.9.3`
- `packages/db`: Drizzle ORM `0.45.1`
- `packages/config`: Zod `4.3.6`
- `apps/worker`: Fastify runtime with Dotenv `17.3.1`

Primary local surfaces:

- `/`: Desk chat with recent conversations, runtime context, and trace previews
- `/memory`: memory browser/editor with pin and suppress controls
- `/activity`: runtime activity and trace inspection console
- `/channels`: Telegram integration setup, health, test send, and reminder dispatch

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

## Phase 2 Verification

To verify the current Phase 2 checkpoint:

1. Make sure the core stack is running with `npm run stack:up`
2. Run `npm run phase2:verify`

The Phase 2 verifier checks:

- memory extraction writes long-term memory entries
- pinned memory affects later replies
- suppressed memory stops affecting later replies
- reminder hooks appear in task state
- research-shaped prompts use the internal research specialist
- activity traces show memory and specialist usage

## Phase 3 Verification

To verify the current Phase 3 checkpoint:

1. Make sure the core stack is running with `npm run stack:up`
2. Run `npm run phase3:verify`

The Phase 3 verifier checks:

- Telegram webhook sync works against a local fake Bot API
- Telegram inbound text reaches the worker and persists locally
- repeated Telegram messages reuse the same conversation thread
- Telegram replies reuse the same memory core as web chat
- due reminders can be dispatched through Telegram
- disabling the integration removes webhook state cleanly

## Live Telegram Test

To verify the real bot instead of the fake verifier:

1. Make sure `.env` contains a real `TELEGRAM_BOT_TOKEN`
2. Start the local stack with `npm run stack:up`
3. Apply the schema with `npm run db:migrate`
4. Run the apps:
   - `npm run dev:web`
   - `npm run dev:worker`
5. Expose the worker on port `4000` through a public tunnel
   - example: `npx --yes localtunnel --port 4000 --local-host 127.0.0.1`
6. Copy the public worker base URL from the tunnel
7. Open `/channels`
8. Enable Telegram integration
9. Set the public worker URL in the Telegram webhook field
10. Set `TELEGRAM_DEFAULT_CHAT_ID` or save a default chat id in the Channels page
11. Click `Save Settings`
12. Click `Sync Webhook`
13. Send a real Telegram message to the bot
14. Confirm the Channels page stays healthy and the conversation appears in local state

Important notes:

- the public URL must point to the `worker`, not the web app
- the worker webhook path is `/integrations/telegram/webhook`
- outbound Telegram tests can succeed even if inbound webhook delivery is broken
- if inbound delivery fails, check the tunnel URL directly first; a dead tunnel will usually return `503`
- temporary tunnel URLs are ephemeral, so resync the webhook whenever the tunnel URL changes

What success looks like:

- `/channels` shows Telegram health as `ok`
- the bot can send a real outbound test message
- a real inbound Telegram message creates or updates a local `telegram` conversation
- activity traces show `telegram.update.received` and `telegram.reply.sent`
- reminder delivery can send to the configured Telegram chat

This current checkpoint now includes:

- a web Desk shell and thin API proxy
- a worker runtime with health checks
- Drizzle schema plus Phase 1, Phase 2, and Phase 3 migrations
- persisted conversation, message, job, and trace wiring in the worker
- deterministic Secretary replies that use conversation, memory, task, and research context
- memory extraction and retrieval through BullMQ-backed worker processing
- Memory page UI with search, edit, pin, and suppress controls
- Activity page UI for recent conversation trace inspection
- recent conversation browser in the Desk
- reminder/task hooks created from memory processing
- Telegram webhook handling, outbound replies, conversation routing, settings, and reminder delivery
- automated Phase 1, Phase 2, and Phase 3 verification flows

Voice and tool execution are still intentionally reserved for later phases.
