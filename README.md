# HamCult - Secretary-First Personal Assistant

This repository contains a polished Phase 1 through Phase 6 checkpoint for a self-hosted, single-user Secretary-first assistant system.

## Workspace Layout

- `apps/web`: Next.js Desk UI and thin web-facing APIs
- `apps/worker`: Fastify runtime for chat orchestration and async processing
- `packages/config`: shared environment parsing and runtime config helpers
- `packages/core-runtime`: normalized runtime contracts and stub Secretary logic
- `packages/db`: database schema and migration home
- `packages/observability`: logger and trace helpers
- `services/stt-faster-whisper`: local CPU-first STT service for Phase 4 voice intake
- `services/tts-chatterbox`: local Chatterbox TTS service for Phase 4 voice replies
- `docker/compose`: local infrastructure definitions
- `docs/adr`: architectural decision records

## Getting Started

### Fastest Windows Start

First time only:

1. Double-click [`first-run-setup.cmd`](/f:/hamcult/first-run-setup.cmd)
2. Open [`.env`](/f:/hamcult/.env) and fill in what you care about:
   - `TELEGRAM_BOT_TOKEN` if you want the live Telegram bot
   - `APP_AUTH_PASSWORD` and `APP_SESSION_SECRET` if you want the sign-in gate
   - any inference provider keys you want Samantha to use
3. Double-click [`start-secretary-dev.cmd`](/f:/hamcult/start-secretary-dev.cmd)

Daily use after that:

1. Double-click [`start-secretary-dev.cmd`](/f:/hamcult/start-secretary-dev.cmd)
2. Open [http://localhost:3000](http://localhost:3000)
3. When you are done, double-click [`stop-secretary-dev.cmd`](/f:/hamcult/stop-secretary-dev.cmd)

What those scripts do:

- `first-run-setup.cmd`
  - creates `.env` from `.env.example` if needed
  - runs `npm install`
  - prepares storage
  - starts Postgres / Redis / SearXNG
  - runs DB migrations
  - prepares local STT and TTS once

- `start-secretary-dev.cmd`
  - prepares storage
  - starts Postgres / Redis / SearXNG
  - runs DB migrations
  - opens 4 terminal windows for:
    - web
    - worker
    - STT
    - TTS

- `stop-secretary-dev.cmd`
  - closes those 4 dev terminal windows
  - shuts the local stack down

### Manual Start

If you prefer to do it by hand:

1. Install dependencies with `npm install`
2. Copy `.env.example` to `.env`
3. Add your real `TELEGRAM_BOT_TOKEN` only in `.env` if you want to exercise the live Telegram path
4. Optional but recommended: set `APP_AUTH_PASSWORD` and `APP_SESSION_SECRET` in `.env` to enable the single-user sign-in gate
5. Create visible runtime storage folders with `npm run storage:prepare`
6. Start local services with `npm run stack:up`
7. Apply the current schema with `npm run db:migrate`
8. Prepare the local speech services once with:
   - `npm run stt:setup`
   - `npm run tts:setup`
9. Run the apps in separate terminals:
   - `npm run dev:web`
   - `npm run dev:worker`
   - `npm run dev:stt`
   - `npm run dev:tts`

## Deployment Package

This repo now includes a packaged always-on deployment path with:

- `proxy`: Caddy reverse proxy
- `web`: Next.js app
- `worker`: Fastify runtime
- `stt`: faster-whisper speech service
- `tts`: Chatterbox speech service
- `postgres`
- `redis`

Deployment files:

- [`docker-compose.deploy.yml`](/f:/hamcult/docker/compose/docker-compose.deploy.yml)
- [`Caddyfile`](/f:/hamcult/docker/caddy/Caddyfile)
- [`deployment.md`](/f:/hamcult/docs/runbooks/deployment.md)
- [`.env.deploy.example`](/f:/hamcult/.env.deploy.example)

Basic deployment flow:

1. Copy `.env.deploy.example` to `.env.deploy`
2. Set your public host, secrets, and Telegram webhook URL
3. Run `npm run storage:prepare`
4. Run `npm run deploy:up`
5. Run `npm run deploy:migrate`
6. Use `npm run deploy:logs` to watch the stack

Useful deployment commands:

- `npm run deploy:config`
- `npm run deploy:up`
- `npm run deploy:migrate`
- `npm run deploy:logs`
- `npm run deploy:down`

## Current Baseline

- `apps/web`: Next.js `16.2.1` with React `19.2.4`
- shared TypeScript baseline: `5.9.3`
- `packages/db`: Drizzle ORM `0.45.1`
- `packages/config`: Zod `4.3.6`
- `apps/worker`: Fastify runtime with Dotenv `17.3.1`

Primary local surfaces:

- `/`: Desk chat with recent conversations, runtime context, and trace previews
- `/login`: optional single-user sign-in gate when auth is enabled
- `/onboarding`: guided setup checklist for daily-use readiness
- `/health`: dependency, storage, and runtime health dashboard
- `/persona`: Secretary identity editor plus settings export/import
- `/memory`: memory browser/editor with pin and suppress controls
- `/activity`: runtime activity and trace inspection console
- `/tools`: tool registry, approval queue, and execution audit console
- `/channels`: Telegram integration setup, health, test send, and reminder dispatch
- `/voice`: voice profile and speech artifact inspection console

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

## Phase 4 Voice

Phase 4 is now complete for local development. The current checkpoint includes:

- speech storage under `runtime/speech`
- seeded voice profiles and speech artifact tables
- Telegram voice-note intake that stores inbound audio locally
- a local STT hook through `STT_BASE_URL`
- a local Chatterbox TTS hook through `TTS_BASE_URL`
- `/voice` UI for profile editing, sample upload, preview synthesis, browser push-to-talk, and speech artifact inspection
- a repo-native CPU speech service in `services/stt-faster-whisper`
- a repo-native Chatterbox TTS service in `services/tts-chatterbox`
- Telegram spoken replies backed by synthesized local TTS artifacts

### Local STT Setup

The current Phase 4 build uses a local `faster-whisper` service, which the design doc specified as the first STT target.

1. Make sure `ffmpeg` is available on `PATH`
2. Run `npm run stt:setup`
3. Make sure `.env` contains:
   - `STT_BASE_URL=http://127.0.0.1:5001`
   - optional `FFMPEG_PATH=C:\Users\Sean\AppData\Local\Microsoft\WinGet\Links\ffmpeg.exe` if `ffmpeg` is installed but not visible on `PATH`
   - `STT_PORT=5001`
   - `STT_MODEL_SIZE=base`
   - `STT_DEVICE=cpu`
   - `STT_COMPUTE_TYPE=int8`
4. Start the service with `npm run dev:stt`
5. Confirm it is ready:
   - `http://127.0.0.1:5001/health/live`
   - `http://127.0.0.1:5001/health/ready`

The first ready check will download and load the configured Whisper model into `runtime/speech/models`.

### Local TTS Setup

The current Phase 4 voice-output build uses a local Chatterbox service, which is the newer cloned-voice path we selected for this repo.

1. Make sure Python `3.11` is installed and `py -3.11 --version` works on Windows
2. Run `npm run tts:setup`
3. Make sure `.env` contains:
   - `TTS_BASE_URL=http://127.0.0.1:5002`
   - optional `FFMPEG_PATH=C:\Users\Sean\AppData\Local\Microsoft\WinGet\Links\ffmpeg.exe` for Telegram voice-note style replies on Windows
   - `TTS_PORT=5002`
   - `TTS_DEVICE=cpu`
   - `TTS_DEFAULT_ENGINE=chatterbox`
   - `TTS_DEFAULT_LANGUAGE=en`
4. Start the service with `npm run dev:tts`
5. Confirm it is ready:
   - `http://127.0.0.1:5002/health/live`
   - `http://127.0.0.1:5002/health/ready`

The first ready check will download the selected Chatterbox weights into the Python environment cache and keep the default Secretary voice warm for later replies.

If `ffmpeg` is available in the runtime environment, Telegram replies can be sent as voice-note style Opus audio. If it is not available, the worker falls back to sending a normal playable Telegram audio attachment while still keeping the synthesized WAV artifact locally.

## Phase 4 Verification

To verify the current Phase 4 checkpoint:

1. Make sure the core stack is running with `npm run stack:up`
2. Run `npm run phase4:verify`
3. Run `npm run phase4:verify:voice`

The current Phase 4 verifiers check:

- the Phase 4 migration applies
- the worker seeds a default voice profile
- the `/voice` page loads
- voice profile data is available through the web API
- speech artifacts round-trip through the worker and web API
- the web voice-turn endpoint is available for browser push-to-talk
- a Telegram voice note is stored locally
- local STT produces a real transcript
- the transcript is routed into the Secretary chat flow
- local Chatterbox TTS produces a persisted `tts_output` artifact
- Telegram receives a spoken audio reply

## Phase 5 Tools

Phase 5 is now complete for local development. The current checkpoint includes:

- a seeded tool registry for `web_search`, `file_read`, `shell_command`, and `task_create`
- per-tool `always_allow` / `ask_first` / `deny` policy controls
- approval requests in the Desk conversation flow with readable request summaries
- a dedicated `/tools` page for policy editing, pending approvals, audit inspection, and recent execution filtering
- execution audit records with request, response, approval state, and timestamps
- a constrained read-only shell wrapper
- a basic file read tool scoped to the local workspace with text-only safety limits
- task creation through the same approval and audit pipeline
- tool activity traces that make approvals, denials, completion, and failures easier to inspect

## Phase 5 Verification

To verify the current Phase 5 checkpoint:

1. Make sure the core stack is running with `npm run stack:up`
2. Run `npm run phase5:verify`

The Phase 5 verifier checks:

- the Phase 5 migration applies
- the `/tools` page loads
- the tool registry exposes the expected built-in tools
- a direct web-search tool call executes and is logged
- an approval-required shell execution can be approved and completed
- an approval-required file read can be denied safely
- the resulting audit trail is available through the web API

## Phase 6 Polish

Phase 6 is now complete for local development. The current checkpoint includes:

- optional single-user sign-in gate for the web app and web-facing APIs
- `/onboarding` for a guided setup and readiness checklist
- `/health` for dependency, speech, Telegram, storage, and state visibility
- `/persona` for Secretary identity editing and voice attachment
- JSON settings export/import through the web UI
- repo-native backup and restore scripts
- visible runtime backup and export directories
- phase-by-phase operator runbook commands
- deployment notes that keep the worker/web/speech split understandable
- groundwork for future adapter expansion through the existing integrations/admin model

## Phase 6 Verification

To verify the current Phase 6 checkpoint:

1. Make sure the core stack is running with `npm run stack:up`
2. Run `npm run phase6:verify`

The Phase 6 verifier checks:

- `/onboarding`, `/health`, and `/persona` all load
- system health returns dependency, storage, and state data
- persona settings can be updated through the web API
- exported settings can be imported back and restore persona state
- `npm run backup:create` produces a logical backup bundle
- `npm run backup:restore` restores that bundle cleanly

## Phase 6 Runbook

Daily operator commands:

- `npm run stack:up`
- `npm run db:migrate`
- `npm run backup:create`
- `npm run export:settings`
- `npm run phase6:verify`

Restore and import commands:

- `npm run backup:restore -- <backup-directory>`
- `npm run import:settings -- <settings-json-path>`

Deployment notes:

- run `web`, `worker`, `stt`, and `tts` as separate long-lived processes
- keep Postgres and Redis on the visible bind-mounted runtime paths
- use Tailscale or a public tunnel only for the worker when testing Telegram inbound webhooks
- keep secrets in `.env`, not in tracked example files
- treat `runtime/backups` and `runtime/exports` as operator-facing working folders

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
- voice profile seeding, speech artifact persistence, Telegram voice-note intake, and Telegram spoken reply flow
- a local CPU-first faster-whisper speech service with repo-native setup scripts
- a local Chatterbox TTS service with repo-native setup scripts
- approval-gated tools with readable audit and policy controls
- onboarding, health, persona, backup, and export/import operator surfaces
- automated Phase 1 through Phase 6 verification flows
