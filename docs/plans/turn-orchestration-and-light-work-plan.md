# Turn Orchestration and Light Work Plan

## Goal

Make the secretary dependable for everyday work before expanding into broader autonomous tasking by:

- unifying turn routing across Desk, Telegram, voice, and future channels
- expanding useful low-risk connectors
- increasing verification coverage around chat, tasking, approvals, and follow-through

## Phase 1: Shared Turn Orchestration

- [x] Extract one shared incoming-turn pipeline used by:
  - [x] Desk web chat
  - [x] Telegram updates
  - [x] web speech / voice turns
  - [x] heartbeat / system-originated follow-up where applicable
- [x] Standardize the resolution order:
  - [x] safe tool intent
  - [x] pending tool approval reply
  - [x] pending job requirement reply
  - [x] pending agent-job launch reply
  - [x] normal streamed/model reply
- [x] Standardize the persisted-turn shape so every path carries the same fields.
- [x] Eliminate duplicated envelope/setup logic where practical.

## Phase 2: Better Conversational Resolution

- [x] Loosen rigid yes/no handling for:
  - [x] tool approvals
  - [x] agent job launch confirmation
  - [x] requirement approvals
- [x] Support short natural confirmations like:
  - [x] "go for it"
  - [x] "not yet"
  - [x] "yes, use this folder"
  - [x] "no, keep it in chat"
- [x] Improve confirmation copy so it sounds like a secretary, not a workflow engine.

## Phase 3: Light-Work Connector Expansion

- [x] Email draft tool
  - [x] generate a draft
  - [x] store/review it
  - [x] keep sending blocked until an actual adapter is configured
- [x] Calendar event draft/export tool
  - [x] create a structured event draft
  - [x] export to a portable format
  - [x] keep real provider sync optional
- [x] Browser/follow-up helper
  - [x] open target queue
  - [x] carry forward the target into activity/history
  - [x] present clear next action
- [x] Attachment/export helper
  - [x] save generated notes or checklists cleanly for follow-through

## Phase 4: Verification Expansion

- [x] Add regression checks for:
  - [x] Desk streamed chat + task create/list/update
  - [x] Telegram chat + tasking + tool approvals
  - [x] job launch confirmation in conversation
  - [x] job requirement approvals in conversation
  - [ ] voice turn -> task/memory follow-through where supported
- [x] Keep the checks runnable from scripts, not only manual UI testing.

## Phase 5: UX Tightening

- [ ] Surface pending approvals and pending launch intents in a friendlier way.
- [ ] Make task/list/follow-through feedback more human and less mechanical.
- [ ] Add better empty states and recovery hints around lightweight work.

## Done When

- [x] Desk and Telegram no longer feel like different secretaries.
- [x] Small everyday requests work reliably without awkward approval friction.
- [x] Follow-through features are easy to trust because the regression scripts prove them.
