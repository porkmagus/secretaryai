# SecretaryAI - Secretary-First Personal Assistant

A self-hosted, single-user Secretary-first assistant system with a Next.js Desk UI, Fastify worker runtime, local STT/TTS speech services, and integrated memory, tools, and channel support.

```
python3 secretary.py
```

That's it. One command installs the app dependencies, starts Docker infrastructure, runs database migrations, builds the project, and launches all services.

> **Note:** The command above is how you *run the app*. Before your first run, install the system prerequisites (Node.js, Docker, ffmpeg) using the platform one-liner below.

---

## Quick Start

### Prerequisites

- **Python 3.11+**
- **Node.js 24+** (bundles npm)
- **Docker Desktop** with `docker compose`
- **ffmpeg** (optional, required for voice-note features)

| Platform | Install system dependencies (one-liner) |
|----------|-------------------------------------------|
| macOS | `brew install node ffmpeg && brew install --cask docker` |
| Ubuntu | `sudo apt install nodejs npm ffmpeg docker.io docker-compose-plugin` |
| Windows | `winget install OpenJS.NodeJS Docker.DockerDesktop Gyan.FFmpeg` |

These commands install **Node.js**, **Docker**, and **ffmpeg** on your machine. They do not install the Secretary app itself.

### Run the App

Once the system dependencies above are in place, run the app with any of these:

```bash
# Standard Python entrypoint
python3 secretary.py

# Or, if you use uv
uv run secretary.py
```

Running `python3 secretary.py` with no flags opens an **interactive menu**:

```
  ╔══════════════════════════════════════════════════════════╗
  ║        Secretary AI - Control Panel                      ║
  ╠══════════════════════════════════════════════════════════╣
  ║  Status: ● Running (PID 27266)                           ║
  ╠══════════════════════════════════════════════════════════╣
  ║  [1]  Install & Build (deps, venvs, compile)             ║
  ║  [2]  Start All  (background)                            ║
  ║  [3]  Start All  (foreground / live logs)                ║
  ║  [4]  Stop All    (kill processes, docker down)          ║
  ║  [5]  Status      (health check all ports)               ║
  ║  [6]  Logs        (tail service-runner output)           ║
  ║  [7]  Full Reset  (stop + wipe runtime state)            ║
  ║  [0]  Exit                                               ║
  ╚══════════════════════════════════════════════════════════╝
```

Running `python3 secretary.py` with no flags opens the **interactive menu** shown above. You can also use flags directly:

```bash
# Install and build only (no start)
python3 secretary.py --install

# Start services in background (skips install if already done)
python3 secretary.py --start

# Start services in foreground with live colored logs
python3 secretary.py --foreground

# Stop everything cleanly
python3 secretary.py --stop

# Check what is running and what is missing
python3 secretary.py --status

# Tail service-runner logs
python3 secretary.py --logs
```

### After Starting

Open http://localhost:3000 in your browser.

| Service | Port | Purpose |
|---------|------|---------|
| Web (Next.js Desk) | 3000 | Chat UI, settings, tools, channels, voice |
| Worker (Fastify) | 4000 | Chat orchestration, async jobs, webhooks |
| STT (faster-whisper) | 5001 | Speech-to-text |
| TTS (Chatterbox) | 5002 | Text-to-speech |
| Postgres | 5432 | Database with pgvector |
| Redis | 6379 | Job queue, caching |
| SearXNG | 8080 | Local search engine |
| Crawl4AI | 11235 | Web crawling |

---

## What `secretary.py` Does

The script is a cross-platform launcher and process manager. It delegates to the existing Node.js/npm infrastructure wherever possible and only implements what Python does better (cross-platform process detection, TUI menu, prerequisite checks).

**Install flow (`--install`):**
1. Checks prerequisites (Python, Node, Docker, ffmpeg)
2. Creates `.env` from `.env.example` if missing
3. Creates runtime storage directories (`runtime/postgres`, `runtime/redis`, `runtime/speech`, ...)
4. Runs `npm install` when `package-lock.json` changes
5. Starts Docker infrastructure (Postgres, Redis, SearXNG, Crawl4AI)
6. Runs database migrations with retry
7. Builds shared packages and the worker (skips when source is unchanged)
8. Sets up Python venvs for STT and TTS (skips when `requirements.txt` is unchanged)

**Start flow (`--start` / `--foreground`):**
1. Ensures Docker infrastructure is running
2. Runs database migrations
3. Launches `scripts/setup/service-runner.mjs` which starts Web, Worker, STT, TTS
4. Tracks the service runner PID in `runtime/config/secretary-py-state.json`

**Stop flow (`--stop`):**
1. Kills the service runner and any tracked child processes
2. Cleans stray listeners on known ports
3. Shuts down Docker infrastructure
4. Removes the state file

---

## Architecture

```
╔═══════════════════════════════════════════════════════════════════════════╗
║                                Secretary AI Stack                         ║
╠═══════════════════════════════════════════════════════════════════════════╣
║                                                                           ║
║   ┌──────────────────────────────────────────────────────────────────────┐║
║   │  Web (Next.js 16)    http://localhost:3000                           │║
║   │  - Desk chat, Onboarding, Health, Persona, Memory, Activity, voice   │║
║   │  - Channels (Telegram integration setup)                             │║
║   └──────────────────────────────────────────────────────────────────────┘║
║                                      │                                    ║
║   ┌──────────────────────────────────────────────────────────────────────┐║
║   │  Worker (Fastify)    http://localhost:4000                           │║
║   │  - Chat orchestration, async jobs (BullMQ/Redis)                     │║
║   │  - Memory extraction, research, tool execution                       │║
║   │  - Telegram webhook handler                                          │║
║   └──────────────────────────────────────────────────────────────────────┘║
║                                      │                                    ║
║   ┌──────────────────────────────────────────────────────────────────────┐║
║   │  STT (faster-whisper) http://localhost:5001  │TTS (Chatterbox) :5002 │║
║   └──────────────────────────────────────────────────────────────────────┘║
║                                      │                                    ║
║   ┌──────────────────────────────────────────────────────────────────────┐║
║   │  Postgres (pgvector) :5432 Redis :6379 SearXNG :8080 Crawl4AI :11235 │║
║   └──────────────────────────────────────────────────────────────────────┘║
║                                                                           ║
╚═══════════════════════════════════════════════════════════════════════════╝
```

### Workspace Layout

| Path | What |
|------|------|
| `apps/web` | Next.js Desk UI and thin web-facing APIs |
| `apps/worker` | Fastify runtime for chat orchestration and async processing |
| `packages/config` | Shared environment parsing and runtime config helpers |
| `packages/core-runtime` | Normalized runtime contracts and deterministic fallback reply logic |
| `packages/db` | Database schema and migration home (Drizzle ORM) |
| `packages/integrations` | Telegram, Discord, Slack, email, SMS adapters |
| `packages/observability` | Logger and trace helpers |
| `services/stt-faster-whisper` | Local CPU-first STT service |
| `services/tts-chatterbox` | Local Chatterbox TTS service |
| `docker/compose` | Local infrastructure definitions |
| `docker/caddy` | Reverse proxy config for deployment |
| `docs/adr` | Architectural decision records |
| `docs/runbooks` | Operator runbooks |
| `scripts/setup` | Orchestrator, service runner, compose runner, storage prep |
| `scripts/speech` | STT/TTS setup and run scripts |
| `scripts/phase1..6` | Phase verification scripts |
| `scripts/backup` | Backup and restore scripts |
| `runtime/` | Runtime storage (postgres, redis, speech, logs, venvs, backups) |

---

## Troubleshooting

### Docker daemon not running
```
[Docker] FAIL (daemon not running)
```
Start Docker Desktop and wait for it to show "Engine running".

### Port already in use
```
[Stop] Web (port 3000)
```
The script attempts to clean up stale listeners automatically. If a port is still blocked:
```bash
# macOS/Linux
lsof -ti :3000 | xargs kill -9

# Windows (PowerShell)
Get-NetTCPConnection -LocalPort 3000 | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

### Node.js too old
```
[Node.js] 20.5.0 FAIL (need 24+)
```
Upgrade Node.js. On macOS: `brew upgrade node`. On Windows: `winget upgrade OpenJS.NodeJS`.

### Missing `.env`
```
[.env] creating from .env.example
```
The script auto-creates `.env` from `.env.example` on first run. Open `.env` and add any API keys you need (Telegram, OpenAI, etc.).

### Migrations fail
```
[DB] attempt 1 failed, retrying in 5s...
```
The script retries migrations up to 5 times. If they keep failing, check that Postgres is healthy:
```bash
docker logs secretary-postgres
```

### STT/TTS model download is slow
The first time the STT or TTS services start, they download models from Hugging Face. This can take several minutes on a slow connection. The services will show as "starting" during this time.

---

## Development

### Manual Start (without secretary.py)

If you prefer to run each step manually:

```bash
npm install
cp .env.example .env
npm run storage:prepare
npm run stack:up
npm run db:migrate
npm run build:packages
npm run build --workspace @secretary/worker
npm run stt:setup
npm run tts:setup
npm run dev:web      # Terminal 1
npm run dev:worker   # Terminal 2
npm run dev:stt      # Terminal 3
npm run dev:tts      # Terminal 4
```

### Testing

```bash
# Run the full test suite (requires pytest in the STT venv)
runtime/venvs/stt/bin/python -m pytest tests/ -v

# Run only unit tests
runtime/venvs/stt/bin/python -m pytest tests/test_secretary_unit.py -v

# Run only integration tests
runtime/venvs/stt/bin/python -m pytest tests/test_secretary_integration.py -v

# Run only E2E tests (starts/stops the full stack)
runtime/venvs/stt/bin/python -m pytest tests/test_secretary_e2e.py -v
```

### Phase Verification

```bash
# Phase 1: Desk, chat, conversation persistence
npm run phase1:verify

# Phase 2: Memory extraction, pin/suppress, reminders
npm run phase2:verify

# Phase 3: Telegram webhook, inbound/outbound, conversation routing
npm run phase3:verify

# Phase 4: Voice profiles, STT, TTS, voice notes
npm run phase4:verify
npm run phase4:verify:voice

# Phase 5: Tool registry, approvals, audit
npm run phase5:verify

# Phase 6: Onboarding, health, persona, backup/export
npm run phase6:verify
```

---

## Deployment

For an always-on deployment with Caddy reverse proxy:

```bash
cp .env.deploy.example .env.deploy
# Edit .env.deploy with your public host and secrets
npm run storage:prepare
npm run deploy:up
npm run deploy:migrate
npm run deploy:logs
```

See [`docs/runbooks/deployment.md`](./docs/runbooks/deployment.md) for full details.

---

## Legacy Windows Workflow

If you prefer the native Windows batch files, they still work and delegate to the same Node.js infrastructure underneath:

- `first-run-setup.cmd` - delegates to `secretary.cmd install`
- `start-secretary-dev.cmd` - delegates to `secretary.cmd start`
- `stop-secretary-dev.cmd` - delegates to `secretary.cmd stop`
- `secretary.cmd` - wraps `node scripts/setup/secretary-dev-orchestrator.mjs`

The Python script (`secretary.py`) is the recommended cross-platform entry point.

---

## Current Baseline

- Next.js `16.2.6` with React `19.2.4`
- TypeScript `5.9.3`
- Drizzle ORM `0.45.1`
- Zod `4.3.6`
- Fastify with Dotenv `17.3.1`
- faster-whisper `1.2.1` for STT
- Chatterbox (kokoro-onnx) for TTS

---

## License

MIT - See individual package `package.json` files for specifics.
