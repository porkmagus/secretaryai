---
description: Optimize-Agent-Memory-Autonomy
---

# Agent Workflow: Optimize Agent Memory & Autonomy

## 1. Objective
Transform the agent from a **reactive** assistant into a **proactive** partner by optimizing the Observe-Remember-Think-Act (ORTA) cycle. Focus on high-fidelity memory capture and intelligent, approval-gated autonomy.

---

## 2. The ORTA Framework
Traditional agents operate in a stateless OTA cycle. An optimized agent persists a "Memory Horizon" that informs every turn.
- **Breadth**: Capture relationship, schedule, and preference signals.
- **Precision**: Use a scoring formula to avoid "Blind Injection" of noise.
- **Proactivity**: Predict needs through "Notice Prepends" in the prompt.

---

## 3. Phase 1: Memory Extraction & Signal Domains
Expand the extraction logic in `memory-engine.ts` to capture these 8 high-impact signal domains.

| Domain | Triggers | Example |
|---|---|---|
| **Social** | `wife`, `boss`, `friend`, `name` | "Sarah is my manager." |
| **Schedule** | `every`, `weekly`, `standup`, `at` | "The sync is Mondays at 9am." |
| **Tools** | `use`, `IDE`, `Vim`, `code in` | "I develop in VS Code." |
| **Stack** | `React`, `Python`, `Node`, `Docker` | "I'm deploying the API now." |
| **Geography** | `based in`, `timezone`, `CST` | "I'm working from Austin." |
| **Life Events**| `moving`, `new job`, `vacation` | "I'm traveling in April." |
| **Preferences**| `prefer`, `like`, `hate`, `don't like`| "I really prefer dark mode." |
| **Explicit** | `remember that`, `save this` | "Please remember X." |

**Optimization Strategy**:
- **Candidate Filter**: Initial low-cost regex scan.
- **Canonical Keys**: Deduplicate facts (e.g., `pref:theme:dark`) to prevent redundant entries.
- **Fact Ageing**: Reduce importance of items not updated in >6 months.

---

## 4. Phase 2: Retrieval Intelligence & Scoring
Replace naive token-counting with a 5-variable scoring formula.

$$Score = (P \times 100) + (I \times 0.7) + (O \times 28) + R + C$$

- **$P$ (Pinned)**: Surface only if query overlap $\ge 1$.
- **$I$ (Importance)**: Use extraction-time priority (1-100).
- **$O$ (Overlap)**: unique shared keyword tokens.
- **$R$ (Recency Decay)**: **CRITICAL**. Penalize recently-accessed memories (e.g., -20 points if used in <30m) to force variety and avoid stale repetition.
- **$C$ (Intent Boost)**: Boost `relationship` type on "who" queries; `episodic` on "when" queries.

---

## 5. Phase 3: Proactive Autonomy
Move beyond reacting to explicit commands by implementing "Observation Triggers."

### 5.1 The `note_to_self` Tool
Detect high-signal personal context (e.g., "My daughter's birthday is tomorrow") and trigger a silent, approval-gated memory write. This turns conversation into stored knowledge without a "remember this" command.

### 5.2 Contextual "Notice" Prepends
Prepend environment signals directly to the system prompt to guide the LLM's attention:
- **Reminders**: "⏰ Task 'Sync' due in 45m."
- **Social**: "🎂 It's Sarah's birthday."
- **Continuity**: "🌅 Last session you finished at /apps/worker."

---

## 6. Phase 4: Persona & Soul Integration
Avoid reciting memories like a database. Anchor the persona to "weave" context naturally.
- **Natural Weaving**: "How did Sarah's new job go?" vs "I remember Sarah started a job."
- **Silent Machinery**: Never narrate the search process. The persona should feel perceptive and omniscient, not algorithmic.
- **Conflict Resolution**: If a new preference ("I like VS Code") contradicts an old one ("I use Vim"), proactively ask the user which to keep as primary.

---

## 7. Verification & Benchmarking
- **Recall Bench**: Test retrieval rank for core facts (Expectation: Rank < 3).
- **Latency**: Ensure retrieval adds < 150ms to the turn lifecycle.
- **Efficiency**: Truncate `contentText` to 800 chars in prompts; keep full source in DB.

---
*This specification defines the foundational memory architecture for the Secretary ecosystem.*