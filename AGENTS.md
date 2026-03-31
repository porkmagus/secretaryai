# AGENTS

This document provides comprehensive information about the Secretary-First Personal Assistant project for AI coding agents.

## Project Overview

Secretary is a self-hosted, single-user AI personal assistant system with a web-based "Desk" interface and multi-channel integration support (Telegram, Discord, Email, Slack, SMS). The system features memory management, task scheduling, voice interaction, tool execution with approval workflows, and agent job capabilities.

**Project Name:** `secretary-first-assistant`  
**Version:** 0.1.0  
**Node.js Requirement:** >= 24.0.0  
**TypeScript:** 5.9.3

## Architecture Overview

This is a TypeScript monorepo using npm workspaces with the following runtime components:

### Applications (`apps/`)

| App | Port | Technology | Purpose |
|-----|------|------------|---------|
| `apps/web` | 3000 | Next.js 16.2.1, React 19.2.4 | Web UI (Desk), thin API proxy |
| `apps/worker` | 4000 | Fastify 5.3.2, BullMQ | Chat orchestration, async processing |

### Shared Packages (`packages/`)

| Package | Purpose | Key Dependencies |
|---------|---------|------------------|
| `@secretary/config` | Environment parsing, runtime config | Zod 4.3.6 |
| `@secretary/core-runtime` | Runtime contracts, types, deterministic fallback logic | None (pure types/contracts) |
| `@secretary/db` | Database schema, migrations, client | Drizzle ORM 0.45.1, pg |
| `@secretary/integrations` | External service types and clients | None (pure types/utilities) |
| `@secretary/observability` | Logger and trace helpers | None |

### Services (`services/`)

| Service | Port | Technology | Purpose |
|---------|------|------------|---------|
| `services/stt-faster-whisper` | 5001 | Python, faster-whisper | Local CPU-first STT |
| `services/tts-chatterbox` | 5002 | Python, Chatterbox | Local TTS |

### Infrastructure Services (Docker)

The following containers are managed by the orchestrator:

| Service | Port | Image | Purpose |
|---------|------|-------|---------|
| Postgres | 5432 | pgvector/pgvector:pg17 | Main database with pgvector |
| Redis | 6379 | redis:7.4-alpine | Cache and job queue (BullMQ) |
| SearXNG | 8080 | searxng/searxng | Web search aggregator |
| Crawl4AI | 11235 | unclecode/crawl4ai:latest | Web scraping service |

## Workspace Structure

```
├── apps/
│   ├── web/               # Next.js Desk UI
│   └── worker/            # Fastify runtime
├── packages/
│   ├── config/            # Environment parsing
│   ├── core-runtime/      # Runtime contracts
│   ├── db/                # Database schema
│   ├── integrations/      # Integration types
│   └── observability/     # Logger
├── services/
│   ├── stt-faster-whisper/# Local STT service
│   └── tts-chatterbox/    # Local TTS service
├── docker/
│   ├── compose/           # Docker Compose files
│   └── caddy/             # Caddy configuration
├── scripts/
│   ├── admin/             # Admin utilities
│   ├── backup/            # Backup/restore
│   ├── phase1-6/          # Phase verification scripts
│   ├── setup/             # Setup orchestrators
│   └── speech/            # STT/TTS setup
└── runtime/               # Runtime storage (gitignored)
    ├── postgres/          # Postgres data
    ├── redis/             # Redis data
    ├── speech/            # Speech artifacts
    ├── backups/           # Backup files
    └── exports/           # Export files
```

## Technology Stack

### Core Framework
- **Frontend:** Next.js 16.2.1, React 19.2.4, TypeScript 5.9.3
- **Backend:** Fastify 5.3.2, Node.js >= 24.0.0
- **Database:** PostgreSQL 17 (pgvector), Drizzle ORM 0.45.1
- **Queue:** Redis 7.4, BullMQ 5.56.4

### AI/ML
- **AI SDK:** `ai` ^6.0.140, `@ai-sdk/react` ^3.0.142
- **Inference Providers:** OpenAI, Anthropic, Google, Azure, Groq, Mistral, DeepSeek, and many others via AI SDK
- **STT:** faster-whisper (local CPU)
- **TTS:** Chatterbox (Resemble AI, local)

### Integrations
- **Telegram:** Bot API with webhook/polling support
- **Discord:** Webhook-based messaging
- **Email:** Resend API
- **Slack:** Webhook-based messaging
- **SMS:** Twilio API

### Development Tools
- **TypeScript:** 5.9.3 with strict mode
- **Module System:** ESNext with Bundler resolution
- **Process Manager:** Custom orchestrator scripts

## Environment Configuration

Configuration is loaded from `.env` (development) or `.env.deploy` (production).

### Required Environment Variables

```bash
# Core
NODE_ENV=development
APP_BASE_URL=http://localhost:3000
WORKER_BASE_URL=http://localhost:4000
DATABASE_URL=postgres://postgres:postgres@localhost:5432/secretary
REDIS_URL=redis://localhost:6379
DEFAULT_USER_ID=local-owner
DEFAULT_PERSONA_ID=secretary-default

# Web/Worker Ports
WEB_PORT=3000
WORKER_PORT=4000

# Inference (at least one provider recommended)
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5

# Speech Services
STT_BASE_URL=http://localhost:5001
TTS_BASE_URL=http://localhost:5002
```

See `.env.example` for full configuration options.

## Build and Development Commands

### Setup (First Run)

```powershell
# Windows: Double-click or run
.\first-run-setup.cmd

# Or via command line
.\secretary.cmd install
```

### Daily Development

```powershell
# Start all services
.\start-secretary-dev.cmd
# Or: .\secretary.cmd start

# Check status
.\secretary.cmd status

# Stop all services
.\stop-secretary-dev.cmd
# Or: .\secretary.cmd stop
```

### Manual Development Commands

```bash
# Install dependencies
npm install

# Prepare storage directories
npm run storage:prepare

# Start infrastructure services
npm run stack:up

# Apply database migrations
npm run db:migrate

# Build all packages
npm run build:packages

# Build everything
npm run build

# Run web app (port 3000)
npm run dev:web

# Run worker (port 4000)
npm run dev:worker

# Run STT service (port 5001)
npm run dev:stt

# Run TTS service (port 5002)
npm run dev:tts
```

### Type Checking

```bash
# Type-check all packages and apps
npm run typecheck
```

### Verification Commands

```bash
npm run phase1:verify      # Core conversation flow
npm run phase2:verify      # Memory and tasks
npm run phase3:verify      # Telegram integration
npm run phase4:verify      # Voice services
npm run phase4:verify:voice# Voice note flow
npm run phase5:verify      # Tools and approvals
npm run phase6:verify      # Polish features
```

## Deployment

### Production Deployment

```bash
# Prepare environment
cp .env.deploy.example .env.deploy
# Edit .env.deploy with your production values

# Start production stack
npm run storage:prepare
npm run deploy:up
npm run deploy:migrate

# View logs
npm run deploy:logs

# Stop production stack
npm run deploy:down
```

### Deployment Services

The production compose file includes:
- `postgres` - Database
- `redis` - Cache/queue
- `searxng` - Search aggregator
- `stt` - Speech-to-text service
- `tts` - Text-to-speech service
- `worker` - Fastify backend
- `web` - Next.js frontend
- `migrate` - Database migration job
- `proxy` - Caddy reverse proxy

## Database Schema

The database uses Drizzle ORM with the following main tables:

### Phase 1 (Core)
- `users` - User accounts
- `personas` - AI persona configurations
- `conversations` - Chat conversations
- `messages` - Individual messages
- `memory_entries` - Long-term memory storage
- `jobs` - Background job queue
- `activity_traces` - Event logging

### Phase 2 (Memory Enhancement)
- `memory_links` - Memory relationships
- `tasks` - Task/reminder management

### Phase 3 (Integrations)
- `integrations` - External service integrations

### Phase 4 (Voice)
- `voice_profiles` - Voice configurations
- `speech_artifacts` - Audio file records

### Phase 5 (Tools)
- `tools` - Tool registry
- `tool_executions` - Tool execution audit

### Phase 6 (Agent Jobs)
- `agent_jobs` - Agent job records
- `agent_job_launch_intents` - Pending agent requests
- `agent_job_steps` - Job execution steps
- `agent_job_artifacts` - Job outputs
- `agent_job_requirements` - Job requirements

## Code Style Guidelines

### TypeScript Configuration
- Target: ES2023
- Module: ESNext with Bundler resolution
- Strict mode enabled
- Isolated modules enabled
- Force consistent casing in file names

### File Naming
- Components: PascalCase (e.g., `DeskShell.tsx`)
- Utilities: camelCase (e.g., `chat-persistence.ts`)
- Constants: UPPER_SNAKE_CASE or camelCase

### Import Style
```typescript
// Use .js extension for TypeScript imports (Node ESM)
import { buildServer } from "./server.js";

// Use @secretary/* for workspace packages
import { loadAppConfig } from "@secretary/config";
import type { RuntimeChatRequest } from "@secretary/core-runtime";
```

### Error Handling
- Use structured logging via `@secretary/observability`
- Log events with service name, event name, and payload
- Include trace IDs for request tracking

## Testing

### Running Tests

```bash
# Run worker tests
npm run test --workspace @secretary/worker
```

Worker tests use Node.js built-in test runner:
```typescript
import { test } from "node:test";
import assert from "node:assert";

test("description", () => {
  assert.equal(actual, expected);
});
```

### Verification Scripts

The project uses phase-based verification scripts that test end-to-end functionality:
- Located in `scripts/phase*/verify.mjs`
- Can be run via `npm run phaseN:verify`

## Web UI Routes

| Route | Description |
|-------|-------------|
| `/` | Desk chat interface |
| `/login` | Authentication gate (if enabled) |
| `/onboarding` | Setup checklist |
| `/health` | System health dashboard |
| `/persona` | Secretary identity editor |
| `/memory` | Memory browser/editor |
| `/activity` | Runtime activity and traces |
| `/tools` | Tool registry and approvals |
| `/channels` | Integration management |
| `/voice` | Voice profile management |

## Worker API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/health/live` | GET | Liveness probe |
| `/health/ready` | GET | Readiness probe |
| `/chat` | POST | Main chat endpoint |
| `/chat/stream` | POST | Streaming chat |
| `/conversations` | GET | List conversations |
| `/conversations/:id/messages` | GET | Get conversation history |
| `/memories` | GET/PUT | Memory management |
| `/tasks` | GET | Task list |
| `/tools` | GET/PUT | Tool registry |
| `/tools/executions` | GET/POST | Tool executions |
| `/integrations/telegram/*` | Various | Telegram webhook/settings |
| `/speech/*` | Various | Speech services |
| `/agent-jobs/*` | Various | Agent job management |
| `/admin/*` | Various | Admin operations |

## Key Architectural Patterns

### Deterministic Fallback
When inference providers are unavailable, the system returns reason-based fallback replies:
- Inference outage: "Inference provider unavailable. Update your provider settings to continue."
- Safety guard: "Response unavailable due to a safety guard. Please try again."

The `deterministicFallbackMode` flag is surfaced in the web UI.

### Memory System
- Memory payloads are created via `createMemoryPayload` in `chat-persistence.ts` and `tools-runtime.ts`
- Queued as memory candidate jobs
- Processed by `memory-engine.ts` before storage
- `retrieveRelevantMemories` scores entries via token overlap, type/age boosts, and recency decay
- Memories only inject when the latest user message carries personal/task cues

### Tool Execution Flow
1. Tool call requested by model
2. Approval check based on tool policy (`always_allow`, `ask_first`, `deny`)
3. If approval required, execution is paused pending user decision
4. Execution result recorded in audit log
5. Reply generated with tool results

### Agent Job System
- Jobs created via `/agent-jobs` endpoint
- Support multiple approval modes: `restrictive`, `builder`, `full_access`
- Steps tracked with dependencies
- Artifacts stored with storage keys
- Requirements tracked and resolved

## Security Considerations

### Authentication
- Optional single-user sign-in gate via `APP_AUTH_PASSWORD` and `APP_SESSION_SECRET`
- Session-based authentication for web UI
- API endpoints respect auth middleware when enabled

### Secrets Management
- All secrets stored in `.env` or `.env.deploy`
- Never commit secrets to version control
- Example files (`.env.example`, `.env.deploy.example`) contain placeholder values only

### Tool Safety
- Tools have configurable approval modes
- Shell commands run through constrained read-only wrapper
- File read scoped to local workspace with text-only limits
- Audit trail for all tool executions

### Telegram Webhook
- Supports webhook secret token verification
- Webhook URL should be HTTPS in production

## Backup and Restore

```bash
# Create backup
npm run backup:create

# Restore backup
npm run backup:restore -- <backup-directory>

# Export settings
npm run export:settings

# Import settings
npm run import:settings -- <settings-json-path>
```

## Runtime Storage

All runtime data is stored in the `runtime/` directory (gitignored):

```
runtime/
├── postgres/data/      # PostgreSQL cluster data
├── redis/data/         # Redis persistence
├── speech/             # Speech artifacts and models
├── caddy/              # Caddy config and certificates
├── backups/            # Backup files
└── exports/            # Export files
```

## Infrastructure Services

The following Docker containers are automatically started by the orchestrator (`secretary.cmd`):
- **Postgres** (port 5432) - Main database with pgvector extension
- **Redis** (port 6379) - Cache and job queue
- **SearXNG** (port 8080) - Web search aggregator
- **Firecrawl** (port 3002) - Web scraping service

## Development Scripts Reference

| Script | Purpose |
|--------|---------|
| `secretary:install` | First-time setup |
| `secretary:start` | Start development stack |
| `secretary:stop` | Stop development stack |
| `secretary:status` | Check stack status |
| `stack:up` | Start Docker infrastructure |
| `stack:down` | Stop Docker infrastructure |
| `db:migrate` | Apply database migrations |
| `stt:setup` | Setup local STT service |
| `tts:setup` | Setup local TTS service |
| `dev:stt` | Run STT service |
| `dev:tts` | Run TTS service |
| `backup:create` | Create logical backup |
| `backup:restore` | Restore from backup |
| `export:settings` | Export settings to JSON |
| `import:settings` | Import settings from JSON |

## Troubleshooting

### Common Issues

1. **Ports already in use:** The orchestrator will detect and report port conflicts
2. **Database connection errors:** Ensure `npm run stack:up` has been run
3. **Missing speech services:** Run `npm run stt:setup` and `npm run tts:setup`
4. **Build errors:** Run `npm run build:packages` first

### Health Checks

Access `/health` in the web UI or call the worker health endpoints:
- `GET http://localhost:4000/health/live`
- `GET http://localhost:4000/health/ready`

## Documentation References

- `README.md` - User-facing documentation and setup guide
- `docs/adr/` - Architectural Decision Records
- `docs/runbooks/` - Operational runbooks
- `docs/plans/` - Implementation plans

---

*Last updated: 2026-03-31*
