# HamCult - Secretary-First Personal Assistant System Design

## 1. Executive Summary

This document defines the architecture, technology stack, product model, implementation phases, and validation checkpoints for a self-hosted personal secretary assistant system. The system is designed for a single primary user and is intended to run primarily on a Mac mini M4 with 24 GB RAM, with optional migration or split deployment to a VPS later.

The product is not a general-purpose multi-user SaaS in v1. It is a secretary-first personal assistant platform with one front-facing assistant personality and a small set of hidden specialist helpers. The secretary is the main relationship interface across web chat, Telegram, and voice. Specialist agents are internal subsystems used only when necessary.

The system is designed around five non-negotiables:

1. Telegram bot access
2. Ease and cleanliness of setup and code
3. Self-hosted core
4. Voice cloning and chatting
5. Beautiful and enjoyable web frontend for daily use and administration

The design prioritizes maintainability, local data control, hybrid inference flexibility, strong memory, and phase-based implementation with stop-and-test checkpoints.

---

## 2. Product Vision

### 2.1 Core Product Concept

The system presents one primary assistant, referred to here as the **Secretary**.

The Secretary:
- is the only default front-facing personality
- remembers the user over time
- manages tasks, reminders, information retrieval, and coordination
- can communicate via web chat and Telegram in v1
- can accept and respond to voice interactions
- may delegate tasks internally to specialist modules without exposing those modules as independent personalities unless explicitly desired later

### 2.2 Product Philosophy

This is a **self-hosted-first, hybrid-capable** assistant system.

That means:
- core data remains on the installation host by default
- memory, logs, embeddings, tool configuration, files, and assistant state are stored locally
- local models handle speech, memory operations, retrieval, and other privacy-sensitive helper tasks
- paid cloud models may be used selectively for the Secretary’s primary reasoning when explicitly permitted
- the system must support a path to becoming fully local later without a redesign

### 2.3 v1 Scope

Included in v1:
- single-user installation
- one admin/operator
- one primary Secretary persona
- web chat interface
- Telegram text messaging
- memory system with retrieval and editing
- delegated helper modules for research, memory processing, and tool execution
- tool registry with approval policy controls
- local embeddings and retrieval
- local speech transcription
- initial cloned voice support
- backup-friendly Docker deployment
- basic activity traces and logs

Excluded from v1:
- public multi-user SaaS
- public signup/login flows
- deep WhatsApp support
- full Signal parity
- advanced mobile app
- large marketplace of tools/plugins
- LiveKit-first full duplex real-time call system
- many front-facing personalities

---

## 3. User and Deployment Model

### 3.1 User Model

Primary user model:
- one human owner/operator
- no public accounts
- no tenant complexity in v1
- local operating system access serves as primary trust boundary

### 3.2 Deployment Targets

Primary host:
- Mac mini M4, 24 GB RAM

Optional future host:
- VPS for selective remote hosting, ingress, or split services

### 3.3 Operational Goals

- low maintenance
- elegant onboarding
- simple backup and restore
- portable containerized deployment
- clear file layout for persistence
- ability to stop after each implementation phase and verify correctness before continuing

---

## 4. Final Recommended Technology Stack

### 4.1 Frontend

**Next.js** with TypeScript

Reasons:
- strong support for polished chat/admin UI
- cohesive developer experience
- easy routing for desk, memory, tools, voice, and activity pages
- works well with AI-oriented streaming UI patterns
- easy future expansion if the system later becomes a hosted app

### 4.2 Backend and Runtime

**Two-application model:**
- `web` application: Next.js frontend plus thin API routes for session-safe UI interactions
- `worker` application: Fastify-based background/runtime service for Secretary orchestration, queues, tools, Telegram handling, memory jobs, and speech pipelines

Reasons:
- keeps UI and orchestration concerns separate
- avoids stuffing all runtime logic into route handlers
- still simple enough to manage in one repository
- allows independent restarts and diagnostics

### 4.3 Database

**PostgreSQL**

Reasons:
- durable storage for memory, conversations, jobs, tool audits, and config
- cleaner long-term platform core than SQLite for this use case
- easier expansion later if services split across machines
- mature backup tooling

### 4.4 Vector Layer

**pgvector** inside PostgreSQL

Reasons:
- one database, one backup surface
- simple retrieval architecture
- avoids separate vector database operational overhead
- fits single-user and medium-scale memory systems well

### 4.5 Queue and Async Jobs

**Redis + BullMQ**

Reasons:
- practical fit for TypeScript background jobs
- easy scheduling for reminders, memory compaction, ingestion, Telegram work, and delegated specialist tasks
- clear operational model

### 4.6 Local Model Runtime

**Ollama**

Reasons:
- familiar local model runner
- appropriate for embeddings, helper tasks, and future local fallback inference
- enough ecosystem momentum to remain a sensible default

### 4.7 Speech-to-Text

**Local STT service using faster-whisper**

Reasons:
- strong local transcription baseline
- suitable for voice notes and initial web push-to-talk
- private by default

### 4.8 Text-to-Speech / Voice Cloning

**Self-hosted cloning-capable TTS service** behind a local internal speech API

Design guidance:
- start with a local model/service combination optimized for acceptable quality and simpler operations rather than best-in-world voice realism
- expose a stable internal API so the backing engine can be swapped later

### 4.9 Messaging Channel

**Telegram Bot integration** in v1

Reasons:
- best remote control channel for MVP
- supports text and voice note workflows
- simpler than WhatsApp for self-hosted personal use

### 4.10 Remote Access

**Tailscale-first** for private browser access

Optional later:
- public domain with auth and reverse proxy

### 4.11 Observability

**Structured logs + lightweight traces + activity records in database**

Reasons:
- enough traceability for v1
- avoids introducing a heavy observability stack too early
- can expand later if needed

### 4.12 Packaging

**Docker Compose**, split into logical stacks

Reasons:
- portable
- backup-friendly
- easy to stop and move
- consistent local deployment

---

## 5. High-Level System Architecture

### 5.1 Major Components

1. **Web Frontend**
   - Secretary desk/chat UI
   - admin/settings UI
   - memory browser/editor
   - tools page
   - voice settings page
   - activity and traces

2. **Secretary Runtime**
   - receives all incoming requests
   - assembles context
   - decides direct response vs delegation vs tool use vs approval request
   - enforces privacy policy and tool policy

3. **Specialist Modules**
   - Research Specialist
   - Memory Specialist
   - Tool/Ops Specialist
   - optional Document Specialist later

4. **Memory Engine**
   - stores memories
   - retrieves contextual memory
   - summarizes and compacts records
   - marks importance and relevance

5. **Tool Execution Layer**
   - tool registry
   - permission modes
   - execution wrapper
   - audit logs

6. **Telegram Adapter**
   - webhook or polling handler
   - voice note capture and handoff
   - response formatting and sending

7. **Speech Services**
   - STT service
   - TTS/voice clone service

8. **Persistence Layer**
   - PostgreSQL + pgvector
   - Redis queue state
   - uploaded file storage
   - config and backup directories

### 5.2 Core Interaction Flow

#### Web Chat Message
1. User sends message from web UI
2. Web API forwards request to Secretary runtime
3. Runtime loads recent conversation window
4. Runtime requests relevant memory records
5. Runtime checks pending tasks/reminders/context
6. Runtime decides:
   - answer directly
   - call local tools
   - delegate to specialist
   - ask permission
7. Final answer is saved to message history
8. Any extracted memory candidates are queued for async processing
9. Response streams back to UI

#### Telegram Text Message
1. Telegram sends incoming message to adapter
2. Adapter normalizes content and channel metadata
3. Request is forwarded to Secretary runtime
4. Runtime processes like web flow
5. Final answer is sent back through Telegram adapter
6. Conversation and activity are persisted locally

#### Telegram Voice Note
1. Telegram voice note is received
2. Media is downloaded locally
3. STT service transcribes audio
4. Transcript is sent to Secretary runtime
5. Runtime processes transcript
6. Response is returned as text and optionally as generated voice note
7. Transcript, response, and trace data are persisted

#### Delegation Flow
1. Secretary determines specialist help is needed
2. Runtime creates a structured subtask request
3. Job is processed by the relevant specialist module
4. Specialist returns structured result, not final user-facing prose unless desired
5. Secretary integrates result into final response
6. Logs and traces link parent and child operations

---

## 6. Data Model

### 6.1 Core Entities

#### `users`
Single-owner schema still keeps a user record for future expansion.

Essential fields:
- id
- display_name
- created_at
- updated_at
- default_persona_id

#### `personas`
Stores Secretary presentation settings.

Essential fields:
- id
- name
- tone_profile
- behavior_rules
- voice_profile_id
- prompt_template
- is_default

#### `conversations`
Tracks sessions by channel and context.

Essential fields:
- id
- channel_type (`web`, `telegram`, etc.)
- title
- status
- created_at
- updated_at
- last_message_at

#### `messages`
Stores conversation entries.

Essential fields:
- id
- conversation_id
- role (`user`, `assistant`, `system`, `tool`, `specialist`)
- content_text
- content_json
- channel_message_id
- created_at
- parent_message_id

#### `memory_entries`
Stores long-term memory objects.

Essential fields:
- id
- memory_type (`semantic`, `episodic`, `project`, `relationship`, `operational`)
- title
- content_text
- content_json
- importance_score
- confidence_score
- source_kind
- source_ref
- embedding
- created_at
- updated_at
- last_accessed_at
- pinned
- suppressed

#### `memory_links`
Relates memories to conversations, files, people, or projects.

Essential fields:
- id
- memory_entry_id
- link_type
- linked_entity_type
- linked_entity_id

#### `projects`
Tracks ongoing workstreams, topics, or goals.

Essential fields:
- id
- name
- description
- status
- created_at
- updated_at

#### `tasks`
Tracks user tasks and assistant action items.

Essential fields:
- id
- title
- description
- status
- due_at
- priority
- source_conversation_id
- created_at
- updated_at

#### `jobs`
Stores async runtime tasks.

Essential fields:
- id
- job_type
- status
- payload_json
- result_json
- parent_job_id
- scheduled_for
- started_at
- finished_at
- error_text

#### `tools`
Tool registry definitions.

Essential fields:
- id
- key
- name
- description
- enabled
- approval_mode (`always_allow`, `ask_first`, `deny`)
- config_schema_json
- created_at
- updated_at

#### `tool_executions`
Audit trail of tool calls.

Essential fields:
- id
- tool_id
- conversation_id
- requested_by
- execution_status
- request_json
- response_json
- started_at
- finished_at
- approval_state

#### `integrations`
Channel and service connections.

Essential fields:
- id
- integration_type (`telegram`, `calendar`, `email`, etc.)
- enabled
- config_json
- health_status
- created_at
- updated_at

#### `model_providers`
Configured inference backends.

Essential fields:
- id
- provider_type (`ollama`, `cloud`)
- name
- enabled
- config_json
- privacy_policy_json
- health_status

#### `voice_profiles`
Voice clone and TTS settings.

Essential fields:
- id
- name
- engine_type
- sample_metadata_json
- synthesis_settings_json
- active
- created_at
- updated_at

#### `activity_traces`
Lightweight execution trace records.

Essential fields:
- id
- trace_type
- parent_trace_id
- conversation_id
- job_id
- event_name
- payload_json
- created_at

---

## 7. Memory System Design

### 7.1 Memory Goals

The memory system must support:
- preferences
- relationships and recurring people context
- long-running projects
- past conversations
- reminders and commitments
- file-derived facts
- editability and longevity

### 7.2 Memory Categories

#### Semantic Memory
Stable personal facts and preferences.
Examples:
- preferred tone
- preferred tools
- device locations
- recurring habits

#### Episodic Memory
What happened, when it happened, and why it mattered.
Examples:
- user discussed hosting change
- user asked to remember a plan
- assistant scheduled a reminder

#### Project Memory
Long-running contexts.
Examples:
- app architecture decisions
- current deployment plan
- current workstreams

#### Relationship Memory
Information about recurring contacts and how they matter.

#### Operational Memory
System settings, allowed tools, installation facts, integration setup, and local environment notes.

### 7.3 Memory Lifecycle

1. user interaction occurs
2. candidate memory facts are extracted asynchronously
3. Memory Specialist scores importance and confidence
4. approved memories are stored with category and links
5. retrieval occurs during future conversations
6. periodic summarization/compaction jobs reduce clutter
7. user may pin, edit, suppress, or delete memories from UI

### 7.4 Retrieval Strategy

At runtime the Secretary builds a context packet using:
- recent conversation turns
- top semantic memory matches
- project-linked memories
- pending tasks/reminders
- pinned important memories
- optional file or doc context

Retrieval should use a hybrid method:
- embedding similarity via pgvector
- category filters
- source recency
- importance ranking
- pinned boosts

### 7.5 Memory UI Requirements

The Memory page must support:
- global search
- filter by category
- pin/suppress/delete/edit
- view memory provenance
- project grouping
- relationship grouping
- last accessed indicator

---

## 8. Secretary Runtime Design

### 8.1 Secretary Responsibilities

The Secretary runtime is responsible for:
- receiving all user requests first
- building context
- selecting reasoning mode
- enforcing privacy policy
- deciding whether specialist help is needed
- deciding whether approval is needed before tool use
- composing final user-facing replies

### 8.2 Runtime Decision Modes

On each turn the Secretary may:
1. respond directly
2. retrieve memory and respond
3. call a tool directly
4. ask user permission before sensitive action
5. delegate to specialist
6. create or schedule a background job

### 8.3 Specialist Modules for v1

#### Research Specialist
Purpose:
- web lookups
- synthesis
- product comparison
- factual gathering

#### Memory Specialist
Purpose:
- candidate memory extraction
- summarization
- compaction
- tagging
- importance scoring

#### Tool/Ops Specialist
Purpose:
- controlled tool execution
- formatting tool outputs
- shell/file operation envelopes
- adapter calls

#### Optional Document Specialist (v2)
Purpose:
- deeper document ingestion
- extraction from uploaded files
- summaries and metadata generation

### 8.4 Why Specialists Are Internal

Specialists are not primary personas in v1 because:
- the product focus is one coherent Secretary relationship
- delegation complexity should remain behind the curtain
- a simpler UI is better for a single-user operator
- the system should feel like one assistant with depth, not a chatroom of coworkers

---

## 9. Tooling and Permission System

### 9.1 Tool Registry Model

Each tool is registered with:
- stable key
- metadata
- config schema
- enabled state
- approval mode
- health check support

### 9.2 Approval Modes

- `always_allow`
- `ask_first`
- `deny`

### 9.3 Sensitive Defaults

Default `ask_first` for:
- calendar modifications
- sending messages/emails
- shell command execution
- file edits or deletions
- smart home actions
- posting externally

### 9.4 v1 Tool Candidates

Include stubs or real integrations for:
- web search
- local file access
- shell execution wrapper
- Telegram
- note/document storage
- calendar placeholder integration
- email placeholder integration

### 9.5 Audit Requirements

Every tool call must record:
- who requested it
- whether it required approval
- approval result
- inputs
- outputs
- timestamps
- errors

---

## 10. Speech and Voice System

### 10.1 Voice Goals

The system should support:
- voice note transcription
- text-to-speech responses
- cloned Secretary voice
- web push-to-talk in earlier phases
- future live streaming voice

### 10.2 v1 Voice Pipeline

#### Incoming Voice Note
1. receive audio file
2. save locally
3. transcribe via local STT service
4. send transcript to Secretary runtime
5. save transcript and trace

#### Outgoing Voice Note
1. Secretary generates response text
2. send text to local TTS service
3. synthesize using active voice profile
4. save output file locally if needed
5. deliver via Telegram or web UI

### 10.3 Voice Profile Requirements

A voice profile should contain:
- human-readable name
- backing engine identifier
- clone sample metadata
- quality settings
- speaking style preferences
- activation status

### 10.4 Future Voice Expansion

Later phases may add:
- streaming browser voice
- interruption handling
- low-latency duplex voice session
- optional WebRTC transport

---

## 11. Integrations and Channels

### 11.1 Telegram v1

Telegram must support:
- text in
- text out
- voice note in
- optional voice note out
- reminders and notifications
- channel-level traces

### 11.2 Signal v2

Signal may be added later through an adapter layer once the core architecture is proven stable.

### 11.3 Calendar and Email

The system should be designed so calendar and email adapters can be added without reworking the core runtime.

Behavior rule:
- the Secretary may draft and suggest actions
- the Secretary should ask before booking or sending something unless allowed by explicit policy

---

## 12. Security and Privacy Model

### 12.1 Trust Boundary

In v1, the operating system and host machine are the primary trust boundary.

### 12.2 Privacy Rules

By default:
- memory stays local
- uploaded files stay local
- transcriptions stay local
- embeddings stay local
- logs stay local
- cloud inference may only be used under explicit policy

### 12.3 Provider Privacy Gate

Before content is sent to a cloud provider, runtime should support:
- local-only mode
- per-conversation cloud toggle
- redact mode for sensitive details
- provider tagging and audit logging

### 12.4 Secret Handling

Store sensitive secrets in:
- local environment files or secure secret mounts
- explicit config directory outside ephemeral container layers
- never hardcode provider credentials or bot tokens in app code

---

## 13. Deployment and Storage Layout

### 13.1 Compose Topology

#### Stack A: Core
- web
- worker
- postgres
- redis

#### Stack B: AI Services
- ollama
- stt-service
- tts-service

#### Stack C: Remote/Ingress (optional)
- tailscale or reverse proxy utilities

### 13.2 Repository Layout

Suggested monorepo layout:

```text
/apps
  /web
  /worker
/packages
  /ui
  /db
  /core-runtime
  /memory
  /tools
  /integrations
  /speech
  /config
  /observability
/docker
  /compose
  /env
/docs
  /design
  /runbooks
  /phase-checklists
/scripts
  /setup
  /backup
  /restore
  /health
```

### 13.3 Host Storage Layout

Suggested runtime directories:

```text
/srv/secretary/
  postgres/
  redis/
  ollama/
  uploads/
  memory/
  config/
  logs/
  backups/
  speech/
```

### 13.4 Backup Strategy

Minimum backup targets:
- PostgreSQL dumps and/or volume snapshots
- uploads directory
- config directory
- voice profiles / samples
- logs and trace exports if needed

Backup goals:
- one-command backup script
- one-command restore path
- ability to destroy and recreate containers without losing state

---

## 14. Frontend and UX Design

### 14.1 Main Information Architecture

#### Desk
Primary daily chat interface.
Must include:
- Secretary conversation view
- streaming responses
- quick action row
- voice input control
- task/reminder glance panel
- current status indicators

#### Memory
Memory browser and editor.

#### Tools
Tool registry, health, approval policies.

#### Channels
Telegram setup and health.

#### Voice
Voice profile management and preview.

#### Activity
Recent jobs, delegations, traces, tool runs.

#### Settings
Model providers, privacy settings, export/backup, personas.

### 14.2 Onboarding Flow

Onboarding should guide the user through:
1. installation validation
2. Secretary persona selection or customization
3. model provider policy
4. Telegram setup
5. tool approvals baseline
6. voice profile setup
7. memory preference calibration
8. first test conversation

### 14.3 UX Principles

- clean and calm design
- one primary assistant identity
- hidden complexity when possible
- strong admin transparency when wanted
- friction only where safety demands it

---

## 15. Phase Plan With Breakpoints and Validation Gates

This project should be built in controlled phases. Each phase ends in a stop-and-test checkpoint before the next phase begins.

### [x] Phase 1: Foundation and Local Core

#### Goal
Establish the repository, core services, persistence, and basic Secretary web chat without external channels or voice.

#### Deliverables
- [x] monorepo scaffold
- [x] Docker Compose for core services
- [x] Postgres + pgvector running
- [x] Redis running
- [x] Next.js app running
- [x] Fastify worker running
- [x] initial schema and migrations
- [x] basic Secretary runtime skeleton
- [x] Desk page with simple chat
- [x] conversation/message persistence
- [x] first memory tables
- [x] basic structured logging

#### What must work before phase is complete
- [x] compose-based core stack starts successfully
- [x] web UI loads reliably
- [x] user can send a message in web chat
- [x] Secretary returns a simple reply
- [x] conversation is saved to database
- [x] memory candidate job can be enqueued and observed
- [x] logs show end-to-end request path

#### Breakpoint test checklist
- [ ] install from clean environment succeeds
- [x] DB schema initializes cleanly
- [x] chat request/response persists correctly
- [x] app survives restart without data loss
- [x] core storage paths are visible and organized

#### Stop condition
- [x] persistent local web chat is working
- [ ] clean-install verification is complete

---

### [ ] Phase 2: Memory and Secretary Intelligence Loop

#### Goal
Turn the app from a persistent chat shell into an actual secretary core with retrieval-based memory and internal task flow.

#### Deliverables
- memory retrieval service
- memory extraction pipeline
- memory importance scoring
- Memory page UI
- memory edit/suppress/pin controls
- context assembly pipeline
- first Research Specialist
- first Memory Specialist
- task/reminder basic schema and UI hooks

#### What must work before phase is complete
- Secretary retrieves relevant memory during chat
- memory extraction jobs create useful long-term memory entries
- pinned memories affect behavior predictably
- user can inspect and edit memories in UI
- delegated research task returns structured result to Secretary

#### Breakpoint test checklist
- repeated conversation shows memory continuity
- irrelevant memories do not dominate responses
- user can suppress bad memory entries
- memory retrieval remains fast enough for interactive use
- traces show what memory was used for a response

#### Stop condition
Do not proceed until the memory system feels durable, inspectable, and clearly beneficial.

---

### [ ] Phase 3: Telegram Integration

#### Goal
Add remote assistant access through Telegram text while preserving the same Secretary behavior and local data model.

#### Deliverables
- Telegram adapter service/module
- incoming message handler
- outbound reply support
- conversation routing by Telegram chat
- Telegram integration settings page
- message traces linked to conversation records
- remote reminder delivery

#### What must work before phase is complete
- Telegram text messages reach the Secretary reliably
- Secretary replies correctly through Telegram
- message history is stored locally
- Telegram and web channels share the same memory core where appropriate
- integration can be turned on/off cleanly from admin UI or config

#### Breakpoint test checklist
- bot setup is straightforward
- text roundtrip is reliable
- multiple Telegram exchanges preserve context
- user can test integration from onboarding or settings
- errors are surfaced clearly in UI/logs

#### Stop condition
Do not proceed until Telegram text feels stable enough for everyday remote use.

---

### [ ] Phase 4: Speech and Cloned Voice

#### Goal
Add local voice note processing and cloned Secretary voice responses.

#### Deliverables
- STT service container
- TTS/voice clone service container
- voice profile storage
- Telegram voice note transcription
- optional voice note response generation
- Voice page UI
- web push-to-talk prototype
- speech trace records

#### What must work before phase is complete
- user can send Telegram voice note
- local STT produces useful transcript
- Secretary responds based on transcript
- Secretary can generate a voice reply using active voice profile
- voice settings are manageable in UI

#### Breakpoint test checklist
- transcription is acceptable for intended use
- cloned voice is good enough and stable
- speech files remain local
- speech pipeline errors are debuggable
- performance remains acceptable on Mac mini host

#### Stop condition
Do not proceed until voice feels truly usable, not just technically present.

---

### [ ] Phase 5: Tools, Permissions, and Action Layer

#### Goal
Allow the Secretary to do work safely through tools and approval policies.

#### Deliverables
- tool registry
- per-tool approval policy UI
- execution audit table
- basic file tool
- shell tool wrapper
- web search tool
- task/reminder tool flow
- approval request UX
- Tool/Ops Specialist

#### What must work before phase is complete
- Secretary can propose action
- user can approve or deny action cleanly
- approved action executes and is logged
- audit trail is inspectable in UI
- denied actions fail safely

#### Breakpoint test checklist
- approval prompts are clear
- tools respect allow/ask/deny states
- shell wrapper is constrained and observable
- tool logs are readable and actionable
- Secretary behavior remains coherent after tool results

#### Stop condition
Do not proceed until tool execution is safe, reviewable, and understandable.

---

### [ ] Phase 6: Polish, Onboarding, and Optional Expansion

#### Goal
Refine the product into a clean daily-use assistant with strong setup and admin experience.

#### Deliverables
- onboarding flow
- health dashboard
- backup/restore scripts
- export/import support
- persona customization UI
- optional Signal adapter groundwork
- optional calendar/email adapter groundwork
- phase-by-phase runbooks
- deployment documentation

#### What must work before phase is complete
- a new install can be brought up smoothly
- onboarding teaches the system correctly
- backups are easy to create and verify
- daily admin work is pleasant
- phase runbooks are accurate and sufficient

#### Breakpoint test checklist
- fresh install experience is smooth
- backup/restore is verified
- health checks accurately reflect service state
- UI feels cohesive and production-minded
- config changes survive restart

#### Stop condition
This phase ends when the system feels installable, maintainable, and pleasant enough for real daily use.

---

## 16. Testing Strategy

### 16.1 Testing Levels

- unit tests for core memory and runtime decision functions
- integration tests for DB and queue flows
- end-to-end tests for web chat and major UI pages
- manual acceptance tests at each phase breakpoint

### 16.2 Mandatory Acceptance Style

Each phase should include:
- environment bring-up test
- functional test
- persistence test
- restart/resilience test
- admin usability check

### 16.3 Golden Path Tests

Examples:
- web chat request and memory retrieval
- Telegram text message to response roundtrip
- Telegram voice note to transcript to response
- approval required tool flow
- backup/restore verification

---

## 17. Risks and Mitigations

### Risk: voice stack complexity
Mitigation:
- keep a stable internal speech API
- use voice notes first, streaming later
- avoid overcommitting to complex real-time infra early

### Risk: memory quality drift
Mitigation:
- editable memory UI
- pinned memories
- suppression controls
- transparent traces
- conservative extraction in early phases

### Risk: cloud leakage of sensitive data
Mitigation:
- explicit provider privacy gate
- local-only defaults
- audit records for provider usage
- redact mode support

### Risk: tool execution becoming dangerous
Mitigation:
- approval policies
- safe defaults
- audit logs
- constrained wrappers

### Risk: deployment mess
Mitigation:
- organized host storage layout
- phase runbooks
- one-command setup scripts
- container separation by role

---

## 18. Final Recommendation

Build the system as a **Secretary-first, single-user, self-hosted personal assistant platform** with:
- Next.js frontend
- Fastify worker runtime
- PostgreSQL + pgvector
- Redis + BullMQ
- Ollama for local helper models
- local speech services
- Telegram as first remote channel
- custom Secretary orchestration logic
- editable long-term memory system
- Docker Compose deployment with explicit bind-mounted persistence

This is the cleanest architecture that satisfies the user’s priorities without overengineering or locking the system into a framework worldview that would conflict with the product’s actual differentiators.

---

## 19. Immediate Next Engineering Step

Begin with **Phase 1 only**.

Do not implement Telegram, speech, or tools until the following are true:
- the repository structure is stable
- core services come up cleanly
- local web chat works reliably
- messages persist correctly
- memory jobs can be queued and inspected

Once that checkpoint is passed, move to Phase 2.

---

## 20. Detailed Phase 1 Implementation Blueprint

This section translates the Phase 1 goal into a concrete engineering build order so implementation can proceed without unnecessary architectural churn.

### 20.1 Phase 1 Build Sequence

Recommended order:

1. initialize monorepo structure
2. create Docker Compose for `web`, `worker`, `postgres`, and `redis`
3. add shared configuration loading and environment validation
4. create database package and first migration set
5. create worker health server and queue bootstrap
6. create web app shell and Desk page
7. implement message send API from web to worker
8. persist conversations and messages
9. return stub Secretary responses
10. enqueue memory-candidate job after each assistant turn
11. add activity trace logging for end-to-end visibility

### 20.2 Initial Monorepo Responsibilities

#### `/apps/web`
Responsibilities:
- Desk UI
- admin pages introduced gradually
- authenticated browser session handling if auth is added
- server actions or API routes that proxy to worker/runtime

#### `/apps/worker`
Responsibilities:
- Secretary runtime entrypoint
- job workers
- integration adapters
- internal orchestration APIs
- health and readiness endpoints

#### `/packages/db`
Responsibilities:
- schema definitions
- migrations
- typed database access
- seed helpers if needed

#### `/packages/core-runtime`
Responsibilities:
- request envelope types
- response envelope types
- context assembly skeleton
- Secretary orchestration logic

#### `/packages/memory`
Responsibilities:
- memory entity definitions
- retrieval interfaces
- extraction job contracts

#### `/packages/tools`
Responsibilities:
- tool registry types
- approval policy enums
- future execution wrappers

#### `/packages/integrations`
Responsibilities:
- Telegram adapter contracts
- future calendar/email adapters

#### `/packages/speech`
Responsibilities:
- STT and TTS client abstractions
- speech job payloads

#### `/packages/config`
Responsibilities:
- typed env parsing
- runtime config assembly
- config defaults and validation

#### `/packages/observability`
Responsibilities:
- structured logger
- trace/event helpers
- correlation ID helpers

### 20.3 Minimum Database Schema for Phase 1

Phase 1 should create only the tables required for persistent chat and observable async work:

- `users`
- `personas`
- `conversations`
- `messages`
- `memory_entries`
- `jobs`
- `activity_traces`

Notes:
- `memory_entries` can initially ship without full lifecycle metadata if migration simplicity matters
- `tasks`, `tools`, `tool_executions`, and `integrations` can wait until later phases unless needed for shared enums or references

### 20.4 Minimum Runtime Interfaces for Phase 1

The worker should expose a small, stable interface surface:

- `POST /health/live`
- `POST /health/ready`
- `POST /runtime/chat`
- `GET /runtime/conversations/:id`
- `GET /runtime/activity/:conversationId`

Behavior guidance:
- `POST /runtime/chat` accepts a normalized chat request
- the worker persists the inbound message
- the worker generates a stub or simple assistant reply
- the worker persists the assistant reply
- the worker enqueues a memory candidate job
- the worker records a trace chain for the turn

### 20.5 Phase 1 Non-Goals

Avoid adding these in Phase 1:
- tool execution
- Telegram webhook handling
- voice transport
- cloud model routing matrix
- complex auth systems
- document upload pipelines
- rich multi-persona controls

The point of Phase 1 is not feature breadth. It is a clean persistent core.

---

## 21. API and Internal Contract Design

### 21.1 Canonical Chat Request Shape

All channels should normalize into one runtime request structure:

```ts
type RuntimeChatRequest = {
  conversationId?: string;
  channel: "web" | "telegram";
  userId: string;
  message: {
    text: string;
    attachments?: Array<{
      kind: "audio" | "image" | "file";
      storageKey: string;
      mimeType: string;
    }>;
  };
  metadata?: {
    sourceMessageId?: string;
    telegramChatId?: string;
    requestId?: string;
  };
};
```

Reason:
- keeps channel adapters thin
- centralizes Secretary behavior
- makes tracing and testing easier

### 21.2 Canonical Chat Response Shape

```ts
type RuntimeChatResponse = {
  conversationId: string;
  messageId: string;
  outputText: string;
  actions?: Array<{
    kind: "task_created" | "approval_requested" | "memory_written";
    payload: Record<string, unknown>;
  }>;
  traceId: string;
};
```

### 21.3 Internal Job Payloads

At minimum define typed payloads for:
- `memory.extract_candidates`
- `memory.compact`
- `research.run`
- `speech.transcribe`
- `speech.synthesize`
- `reminder.dispatch`

Even if some of these jobs are not active in Phase 1, defining the envelope pattern early reduces migration pain later.

### 21.4 Event and Correlation Rules

Every inbound request should receive:
- `request_id`
- `conversation_id`
- `trace_id`
- `parent_trace_id` when work is delegated or queued

This is important because the system will eventually span UI requests, queue jobs, Telegram events, and speech pipelines.

### 21.5 Error Contract Guidance

User-facing responses should never expose raw stack traces.

Preferred structure:
- safe message for UI/channel
- machine-readable error code
- trace identifier for support/debugging
- full detailed error only in logs

---

## 22. Configuration and Environment Strategy

### 22.1 Configuration Precedence

Use this precedence order:

1. environment variables
2. mounted config files
3. repository defaults

This keeps local development simple while still allowing stable production-like overrides.

### 22.2 Environment Profiles

Define at least:
- `development`
- `local-production`
- `vps-split` later

`local-production` should represent the real Mac mini deployment shape as closely as possible.

### 22.3 Core Environment Variables

Minimum initial variables:
- `NODE_ENV`
- `DATABASE_URL`
- `REDIS_URL`
- `WORKER_PORT`
- `WEB_PORT`
- `APP_BASE_URL`
- `LOG_LEVEL`
- `DEFAULT_USER_ID`
- `DEFAULT_PERSONA_ID`

Later variables:
- `OLLAMA_BASE_URL`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `STT_BASE_URL`
- `TTS_BASE_URL`
- provider API keys if cloud inference is enabled

### 22.4 Secrets Separation Rule

Separate configuration into:
- non-secret operational config
- secret credentials/tokens

Operational rule:
- secrets should be mounted or injected, not committed
- example env files may exist, but real secret files must be ignored

### 22.5 Configuration Validation

Startup should fail fast if required configuration is missing or invalid.

Validation should include:
- URL parsing
- required ports
- required secrets for enabled integrations
- path existence for bind-mounted persistence directories where applicable

---

## 23. Operational Standards and Acceptance Targets

### 23.1 Performance Targets for v1

These are practical targets, not hard SLAs:

- basic web chat response starts streaming within 2 to 4 seconds under normal local conditions
- memory retrieval adds minimal latency relative to model inference
- Telegram text roundtrip feels near-immediate for personal use
- voice note transcription completes within a tolerable delay for asynchronous conversation

### 23.2 Reliability Targets for v1

- clean restart without schema corruption
- queued jobs survive worker restart where possible
- no silent loss of messages
- traceability from inbound request to final stored response

### 23.3 Required Health Endpoints

Every deployable service should expose:
- liveness
- readiness
- optional dependency detail for admin diagnostics

Suggested checks:
- web can reach worker
- worker can reach postgres
- worker can reach redis
- optional AI services report availability when enabled

### 23.4 Backup Acceptance Standard

A backup strategy is not complete until it is restore-tested.

Minimum acceptance test:
1. create conversation and memory data
2. run backup
3. destroy containers
4. restore data into fresh containers
5. verify the conversation, memory, and config state return correctly

### 23.5 Logging Standard

All services should log in structured JSON in production-like modes.

Each log record should prefer these fields:
- timestamp
- service
- level
- message
- request_id
- trace_id
- conversation_id
- job_id
- error_code when applicable

---

## 24. Architectural Decisions to Lock Early

These decisions should be converted into short ADRs before implementation accelerates.

### ADR 1: ORM / Query Layer Choice

Choose one approach and standardize:
- Prisma
- Drizzle
- Kysely plus migration tool
- direct SQL with a light helper layer

Decision criteria:
- migration clarity
- pgvector support
- type safety
- operational simplicity

### ADR 2: Web-to-Worker Communication Style

Choose one primary path:
- direct HTTP from web server to worker
- queue-backed request handoff for some flows
- shared package call path only for local monolith development

Recommendation:
- use HTTP for synchronous chat and admin actions
- use BullMQ for background work

### ADR 3: Authentication Posture for v1

Possible options:
- no app auth, rely on Tailscale/private host access only
- simple single-user password gate
- OAuth/SSO later

Recommendation:
- start with private-network-only access if the deployment is strictly personal
- add a simple password gate before any public ingress exposure

### ADR 4: Storage Strategy for Uploads and Audio

Choose whether uploaded files and generated audio are stored:
- on local disk with DB references
- in S3-compatible object storage later

Recommendation:
- use local disk plus DB metadata in v1
- preserve a storage interface so the backend can swap later

### ADR 5: Initial Model Routing Policy

Decide whether the first runnable build uses:
- all-local stubbed reasoning
- local helper models plus optional cloud primary model
- cloud-first temporary reasoning with local memory only

Recommendation:
- start with deterministic or stub responses in Phase 1
- add the first real reasoning provider only after persistence and traces are stable

---

## 25. Immediate Build Checklist

If implementation starts now, the first concrete work items should be:

1. scaffold monorepo directories and workspace config
2. write Docker Compose for core services only
3. choose DB/query stack and record it as ADR 1
4. implement typed config loader and startup validation
5. create first DB migrations for conversations, messages, jobs, and traces
6. build worker `POST /runtime/chat` with stub response
7. build Desk UI with send/receive flow
8. persist chat records and display conversation history
9. enqueue and inspect a placeholder memory extraction job
10. verify restart persistence and document the Phase 1 checkpoint result
