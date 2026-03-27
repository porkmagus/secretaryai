# Chat and Task Hardening Plan

## Completed

- [x] Unified task timing and task-title normalization into a shared runtime helper.
- [x] Upgraded explicit task creation to store richer detail, due/reminder timing, and Telegram delivery metadata when the request comes from Telegram.
- [x] Added `task_list` as a lightweight always-available tool for "what's on my list" style requests.
- [x] Improved task update parsing so the secretary can mark tasks done or reschedule them without requiring quoted references.
- [x] Made lightweight task tools run immediately by default instead of forcing approval for safe reminder work.
- [x] Brought Telegram turns onto the same tool-aware and requirement-aware routing path as Desk chat.
- [x] Added conversational tool approval handling so "yes/no" can resolve pending tool requests inside the chat thread.
- [x] Added worker unit tests for shared task parsing/runtime helpers.
- [x] Extended phase 5 verification to cover:
  - [x] web search tool flow
  - [x] approval-required shell tool flow
  - [x] denied file-read tool flow
  - [x] explicit task create/list/update flow
  - [x] Telegram-style task creation with delivery metadata
  - [x] Telegram-style conversational tool approval

## Next High-Value Work

- [ ] Add a shared turn-orchestration helper so web, Telegram, voice, and future channels stop duplicating turn-routing logic.
- [ ] Add richer conversational handling for pending job launches and tool approvals beyond strict yes/no.
- [ ] Add more light-work tools that are genuinely useful day to day:
  - [ ] local calendar draft/event export
  - [ ] email draft generation
  - [ ] browser target queue with visible follow-up
- [ ] Add focused regression coverage for:
  - [ ] Desk streaming reply + task creation interaction
  - [ ] agent job launch confirmation in web and Telegram
  - [ ] pending job requirement approvals in conversation
- [ ] Add a maintenance/admin action for resetting task/tool test fixtures separately from real history.
