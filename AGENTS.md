# AGENTS

## Repository Notes
- Fallback replies are now reason-based. Inference outages return: "Inference provider unavailable. Update your provider settings to continue."
- Prompt-leakage guard fallback returns: "Response unavailable due to a safety guard. Please try again."
- Fallback reasons are set in `apps/worker/src/lib/conversation-model.ts` and formatted in `packages/core-runtime/src/index.ts`.
- Memory payloads are created via `createMemoryPayload` in `chat-persistence.ts` and `tools-runtime.ts`, queued as memory candidate jobs, and processed by `memory-engine.ts` before storage.
- `retrieveRelevantMemories` scores entries via token overlap, type/age boosts, and recency decay; it updates `lastAccessedAt` and avoids injection unless there is sufficient query signal (pinned entries still require overlap).
- Prompt assembly through `buildConversationInstructions` only adds remembered facts/tasks when the latest user message carries personal/task cues (short factual queries omit memories) before feeding the model.
- The web UI reflects deterministic fallback state through the `deterministicFallbackMode` flag and a badge rendered in `apps/web/app/desk-shell.tsx`.
