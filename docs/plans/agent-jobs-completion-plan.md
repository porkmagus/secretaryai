# Agent Jobs Completion Plan

Last updated: March 27, 2026

## Goal

Turn the Secretary agent-job system into a production-grade autonomous software builder that can:

- accept natural-language build/debug/refactor requests from Desk or channel conversations
- convert those requests into durable agent jobs
- plan and execute multi-step work
- pause for approvals or missing runtime requirements
- verify results with strong evidence
- survive disconnects, restarts, and worker failures
- report progress and final outcomes back into the originating conversation

This plan assumes the current repo state already includes:

- durable job records and queue processing
- AI SDK `ToolLoopAgent` execution for implementation and verification
- a Jobs UI for start/review/resume/cancel
- Settings-based agent defaults

## Current State Summary

Implemented now:

- durable agent jobs in the database and worker queue
- job lifecycle endpoints
- AI SDK tool-calling executor
- implementation and verification passes
- approval-mode support
- Activity > Jobs UI
- Settings > Agent configuration UI

Not yet complete:

- Desk and Telegram handoff into jobs
- conversation-linked pending launch state
- checkpoint-level crash-safe execution inside long agent runs
- strong runtime/dependency negotiation
- browser-based verification and evidence capture
- isolated execution backend option
- production-grade safety budgets and policy controls
- qualification suite for real-world software-building scenarios

## Execution Tracker

### Phase 1: Conversational Handoff

- [x] Detect build-worthy agent-job intent in conversation text
- [x] Persist a pending launch intent on the conversation
- [x] Ask for confirmation in normal Desk chat replies
- [x] Handle yes/no confirmation in the same conversation
- [x] Create an agent job automatically after confirmation
- [x] Route the same confirmation logic through Telegram inbound handling
- [ ] Add the optional Desk confirmation card polish on top of the conversational flow

### Phase 2: Conversation-Linked Job Updates

- [x] Post live job progress back into the originating conversation
- [x] Surface approval requests in the originating conversation
- [x] Surface runtime blockers in the originating conversation
- [x] Post completion summaries with a link back to the full job detail

### Phase 3: Stronger Durable Execution

- [x] Add stronger checkpoint artifacts around plan / implement / verify / finalize
- [x] Improve retry vs blocked vs failed distinctions
- [x] Harden resume behavior after worker interruption

### Phase 4: Runtime And Dependency Requirement System

- [ ] Detect missing runtimes, package managers, services, and ports
- [ ] Turn them into first-class requirement records with resolution flows

### Phase 5: Verification And Evidence Upgrade

- [ ] Add HTTP and health probing
- [ ] Add browser verification
- [ ] Capture stronger evidence artifacts for verification
- [ ] Route failed verification back into a repair pass automatically

### Phase 6: Execution Backend Abstraction

- [ ] Introduce a runner abstraction for local and isolated execution backends
- [ ] Expose execution backend selection in Settings > Agent

### Phase 7: Safety And Policy Hardening

- [ ] Add allowed workspace roots and stronger destructive-command protections
- [ ] Add network, budget, timeout, and secret-redaction controls

### Phase 8: Jobs UX Completion

- [ ] Tighten queue grouping, blocker views, artifact browsing, and requirement UX
- [ ] Keep lifecycle controls on Jobs and configuration controls in Settings

### Phase 9: Qualification Suite

- [ ] Prove the system through scaffold / feature / debug / approval / restart / Telegram / browser scenarios

## Definition Of Done

The feature is complete when all of the following are true:

1. A user can ask in Desk or Telegram for software work in normal language, without a magic phrase.
2. The secretary can confirm and launch an agent job in the same conversation.
3. The job can inspect, edit, install, build, test, verify, and summarize work.
4. The job can pause for approval or runtime requirements and resume cleanly.
5. The job survives page reloads, worker restarts, and ordinary interruption.
6. The operator can clearly review queue state, blockers, logs, artifacts, and results.
7. The system can optionally run risky work in an isolated execution backend.
8. The final verification evidence is strong enough that the operator can trust the result.

## Architecture Direction

### 1. Conversational Intake

Natural-language intent should trigger jobs from any supported channel.

Required behaviors:

- detect build/debug/refactor/automation implementation intent in chat
- create a pending launch intent instead of immediately running large jobs in ambiguous cases
- allow plain-language confirmation in Desk or Telegram
- support inline buttons in Desk as an acceleration path only, never as a requirement

Key rule:

- Desk and Telegram should share the same backend launch-intent state machine

### 2. Durable Job Runtime

The job runtime should remain durable and queue-backed, but we need stronger intra-step recovery.

Required behaviors:

- explicit step state transitions
- safe retries for transient failures
- restart-safe resume behavior after worker interruption
- clear blocker states for approval, runtime, dependency, and verification failures
- job-to-conversation progress events

Recommended direction:

- keep the existing queue/job model
- add stronger checkpointing around planning, implementation, verification, and finalize stages
- do not rely on one long opaque agent call as the only unit of durability

### 3. Execution Backend

The current host-execution model is useful for trusted local development, but it is not the only backend we should support long term.

Required capabilities:

- local trusted execution in WSL
- policy-controlled command execution
- workspace root enforcement
- optional isolated backend for untrusted or higher-risk jobs

Recommended direction:

- retain local WSL as the default builder backend
- add an execution-backend abstraction
- support a sandboxed backend later for higher-trust scenarios

### 4. Verification

Verification must become stronger than “the command exited successfully.”

Required evidence types:

- install/build/typecheck/test logs
- app startup evidence
- health/API checks
- browser smoke verification where applicable
- final summary of what was verified vs. what remains uncertain

### 5. Safety And Policy

The system needs stronger safety controls before it can be called complete.

Required controls:

- approval mode per job
- allowed workspace roots
- destructive command protections
- runtime budget limits
- timeouts
- token-step ceilings
- secret-safe logging and redaction

## Phase Plan

## Phase 1: Conversational Handoff

Goal:

Allow Desk and Telegram to naturally launch agent jobs.

Deliverables:

- intent detection for job-worthy requests
- pending launch intent record tied to conversation/channel thread
- conversational confirmation flow
- Desk UI card for confirmation as an optional enhancement
- Telegram/plain-chat confirmation handling
- automatic agent-job creation after confirmation

Implementation areas:

- Desk chat request flow
- worker conversation model
- Telegram inbound message handling
- new persistence for pending launch intents

Success criteria:

- “Build me an app…” in Desk prompts a confirmation and then creates a job
- the same works via Telegram with plain chat replies

## Phase 2: Conversation-Linked Job Updates

Goal:

Keep jobs and conversations unified.

Deliverables:

- job progress messages posted back into originating conversation
- approval requests surfaced in chat
- runtime blockers surfaced in chat
- completion summaries posted in chat with links to full job detail

Success criteria:

- users can start from conversation and keep following progress there
- they do not need to camp on the Jobs page to know what is happening

## Phase 3: Stronger Durable Execution

Goal:

Make job execution survive ordinary failures with less ambiguity.

Deliverables:

- explicit checkpoint artifacts after each major phase
- step-level progress snapshots
- retry policy for transient command/runtime failures
- improved resume logic after worker restart
- better distinction between retryable, blocked, and failed states

Research guidance:

- align with durable workflow concepts from official Workflow guidance
- borrow pause/resume/retry concepts without forcing a premature platform migration

Success criteria:

- restarting the worker during a job does not corrupt the run state
- active jobs can be resumed from meaningful checkpoints

## Phase 4: Runtime And Dependency Requirement System

Goal:

Handle missing prerequisites cleanly instead of failing blindly.

Deliverables:

- detect missing package managers, runtimes, services, and ports
- create first-class requirement records for:
  - runtime installation
  - dependency installation approval
  - service startup
  - workspace access
  - network access
- requirement resolution flow from Desk, Telegram, or Jobs UI
- improved operator guidance when a job is blocked

Success criteria:

- a job that needs something unavailable becomes clearly `waiting_for_runtime` or `waiting_for_approval`
- the operator can resolve and resume without losing context

## Phase 5: Verification And Evidence Upgrade

Goal:

Prove that builds actually work.

Deliverables:

- stronger verification command selection
- HTTP/health probing tools
- browser verification pass
- evidence artifacts for:
  - command logs
  - screenshots
  - health responses
  - build/test output
- verification repair loop that can route failed verification back into implementation

Recommended tools:

- browser automation for local app smoke tests
- structured API probe tooling

Success criteria:

- completed jobs show concrete evidence, not just a generated summary

## Phase 6: Execution Backend Abstraction

Goal:

Separate orchestration from execution environment.

Deliverables:

- backend interface for command/file/browser execution
- default local WSL executor
- optional isolated executor contract
- configuration in Settings > Agent for execution mode

Stretch direction:

- sandboxed microVM backend for untrusted code or stronger isolation

Success criteria:

- the agent runtime does not assume a single host-exec implementation forever

## Phase 7: Safety And Policy Hardening

Goal:

Make autonomous building safe enough to trust.

Deliverables:

- allowed workspace root list
- command denylist / risk classifier improvements
- secret redaction for logs and artifacts
- network policy controls
- time budget and token budget enforcement
- artifact retention policy
- explicit destructive-action confirmation rules

Success criteria:

- jobs respect system safety defaults even under YOLO mode
- logs do not casually leak secrets

## Phase 8: Jobs UX Completion

Goal:

Make the operator experience clean and understandable.

Deliverables:

- clearer queue groupings
- better completed/blocked/active views
- richer step timeline
- artifact browser improvements
- better requirement and approval presentation
- job templates or presets later, if useful

Key product rule:

- outside Settings, only lifecycle controls should exist
- all system configuration lives in Settings > Agent

Success criteria:

- Jobs page is clean, focused, and operational
- Settings contains the deeper controls

## Phase 9: Qualification Suite

Goal:

Prove the system works on real software-building tasks.

Required scenarios:

1. Scaffold a new small app from a spec
2. Add a feature to an existing repo
3. Fix a failing test/build
4. Pause for approval and continue
5. Launch from Desk
6. Launch from Telegram
7. Resume after worker restart
8. Complete verification with browser/API evidence

Artifacts to collect:

- logs
- changed files
- screenshots
- result summaries
- failure postmortems

Success criteria:

- the system succeeds consistently enough across these scenarios to be considered a core feature

## Implementation Checklist

### Backend

- add pending launch intent persistence
- connect conversation model to job-intent creation
- connect Telegram response handling to intent resolution
- strengthen job checkpoints and retry semantics
- add requirement detection/resolution expansion
- add verification probe/browser tooling
- add execution-backend abstraction
- add policy and budget enforcement

### Web

- Desk confirmation flow for job-worthy requests
- conversation-linked progress rendering
- improved Jobs queue/detail experience
- Agent settings expansion for execution backend and policy controls

### Channels

- Telegram confirmation prompts
- Telegram job-status updates
- approval and blocker resolution through chat replies

## Settings That Should Ultimately Live In Settings > Agent

- default workspace path
- default access mode
- max agent steps
- command timeout
- verification repair passes
- allowed workspace roots
- execution backend selection
- network access policy
- artifact retention policy
- browser verification defaults
- secret redaction behavior
- budget/time ceilings

## Jobs Page Scope Rule

Jobs UI should remain limited to usability and lifecycle controls:

- start job
- title
- goal/description
- stop/cancel
- resume
- approve/deny blocker
- view queue
- view completed jobs
- inspect steps/logs/artifacts

Anything more system-level belongs in Settings.

## Risks To Watch

- overusing one giant agent call instead of durable checkpoints
- conflating chat messages with durable execution state
- letting Desk-only assumptions leak into Telegram behavior
- trusting build success without browser/API verification
- letting local host execution become the only supported backend forever
- exposing too many config controls in the Jobs page

## Recommended Execution Order

1. Conversational handoff
2. Conversation-linked progress updates
3. Stronger durable execution checkpoints
4. Runtime/dependency requirements
5. Verification and evidence
6. Execution backend abstraction
7. Safety/policy hardening
8. Jobs UX completion
9. Qualification suite

## Notes

- Keep using AI SDK-native agent patterns instead of inventing parallel abstractions where the SDK already gives us a clean primitive.
- Use the workflow guidance as durability inspiration for retries, pause/resume, and crash-safe orchestration.
- Treat execution isolation as an execution backend concern, not as a reason to rewrite the job model.
