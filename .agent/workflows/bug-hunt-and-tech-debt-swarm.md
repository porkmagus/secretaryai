---
description: "High-intelligence, agent-autonomous workflow for swarm-based bug hunting and technical debt resolution."
---

# Master Workflow: Agentic Swarm Bug-Hunting & Tech-Debt Eradication

This specification defines the foundational protocol for an agent to transition from a reactive "fix-it" mode into a proactive, "Search-and-Destroy" (SnD) mission against codebase rot, silent failures, and performance regressions.

---

## Phase 0: The Philosophy of the Swarm Hunt

### A. Defining the Enemy: "Nuisance Bugs" and "Rot"
Most bugs are not catastrophic failures; they are "nuisances"—silent errors, race conditions that only fire at 3 AM, or misaligned UI elements that degrade user trust. "Rot" is the accumulation of code that was "good enough" for a prototype but has become a mental and computational burden.

**The Three Pillars of the Swarm Hunt:**
1.  **Zero-Tolerance Integrity**: No warning is acceptable. No `todo` is left unindexed.
2.  **Lindy Effect Architecture**: Systems that survive bugs longer are more reliable. We aim to remove code that hasn't proven its worth.
3.  **Proactive Eradication**: We do not wait for a user report. We use trace logs, latency spikes, and structural complexity to hunt for bugs before they manifest.

### B. The Swarm Mental Model
While you may operate as a single agent, you must think as a **Swarm Leader**. You will partition the workspace, assign "virtual roles" to your sub-processes, and consolidate findings into a unified tactical map.

**Swarm Roles:**
-   **The Scout**: Performs non-destructive reconnaissance, searches for patterns, and identifies "hotspots" of complexity or failure.
-   **The Janitor**: Focuses on "low-hanging debt"—type mismatches, unused imports, outdated dependencies, and style inconsistencies.
-   **The Architect**: Analyzes structural debt, looks for monolithic files that need splitting, and identifies missing abstractions.
-   **The Benchmarker**: Measures the system. Records P99 latencies, token consumption counts, and memory footprints.

---

## Phase I: Deep Reconnaissance & Discovery

Before a single line of code is changed, the Scout must map the battlefield. This phase uses **evidence-based discovery** rather than intuition.

### Step 1: Activity Trace Diving
The `activityTraces` table is your most powerful tool. It contains the "Black Box" data of every previous interaction.

**Protocol:**
1.  **Failure Clustering**: Search for `eventName` patterns that correlate with `errorText` or `finishReason: error`. 
    ```sql
    -- Pseudo-query to find failure clusters
    SELECT eventName, count(*) as failure_freq 
    FROM activityTraces 
    WHERE payloadJson->>'status' = 'failed' 
    GROUP BY eventName ORDER BY failure_freq DESC;
    ```
2.  **Latency Anomaly detection**: Identify tools or routes that take >5 seconds. These are your primary candidates for the **Efficiency Audit**.

### Step 2: Code Archaeology & Static Debt Audit
We look for structural decay using standard and custom tooling.

**A. Complexity Mapping:**
-   Identify files with >500 lines or functions with >5 levels of nesting.
-   Run `npm run build` or `npm run typecheck` and treat *every* suppressed warning as a "nuisance bug."

**B. Dependency Rot:**
-   **The `npm audit` Pass**: Check for security vulnerabilities.
-   **The Use-Only-What-You-Need Audit**: Verify if imported libraries are actually utilized (using `depcheck` or similar patterns).

### Step 3: Heuristic "Smell" Analysis
Agents often introduce specific types of noise. Scan for these "AI Anti-Patterns":
1.  **The Recursive Hallucination**: Imports that reference non-existent local files.
2.  **The Prompt Bloat**: Large strings in the worker that could be extracted to constants.
3.  **Variable Shadowing**: Duplicate names in long functions that lead to subtle logic errors.

### Step 4: The Discovery Map (Artifact Creation)
Consolidate all Phase I findings into a `discovery_map.md` artifact. This map MUST categorize findings into:
-   **CRITICAL BUGS**: Active failures (Priority 0).
-   **SILENT NUISANCES**: Logic edge cases, CSS glitches (Priority 1).
-   **STRUCTURAL DEBT**: Complex files, missing tests (Priority 2).
-   **EFFICIENCY LEAKS**: Slow routes, high token usage (Audit Target).

---

## Phase II: Swarm Initialization & Coordination

Once the Discovery Map is complete, the agent must orchestrate a **Multi-Pass Swarm Execution**. In the absence of native parallel sub-agents, you will simulate a swarm by partitioning your high-level goal into discrete, isolated execution branches.


### Step 1: Hive Mind Partitioning
Do not attempt to fix all bugs in a single go. This leads to **context collapse** and broad-spectrum regressions. Instead, partition the work by module or "Role."

**The Partitioning Logic:**
1.  **The Core Worker Swarm**: Focuses on `apps/worker` logic, DB consistency, and tool security.
2.  **The Frontend Polish Swarm**: Focuses on `apps/web`, UI/UX bugs, and accessibility debt.
3.  **The Shared Infrastructure Swarm**: Focuses on `packages/*`, shared types, and build configs.

### Step 2: The Swarm Playbooks (Role-Based Depth)

To reach maximum efficiency, each simulated sub-agent must follow a dedicated **Playbook**.

#### Playbook A: The Scout (Discovery Specialist)
-   **Trace Isolation**: Dive into `activityTraces` for every tool invocation. Look for the "Golden Path" vs. the "Failure Path." 
-   **Semantic Search Sniffing**: Use `grep` to find "Comment Debt"—places where developers (or past agents) left `TODO`, `FIXME`, or `HACK`.
-   **Dependency Sniffing**: Analyze `package.json` for unused version-pinned libraries. Look for "Dependency Bloat" (e.g., using a 50KB library for a single function that could be 10 lines of TS).

#### Playbook B: The Janitor (Technical Debt Eradication)
-   **Type-Standardization**: Search for `any` or `unknown` types in high-traffic interfaces. Replace them with strict interfaces or Zod schemas.
-   **Import Scrubbing**: Use automated scripts to identify and remove unused imports. 
-   **Style Unification**: Ensure every file in the module follows the project's Prettier and ESLint standards. Do not ignore "Minor" lint warnings; they are the seeds of future bugs.

#### Playbook C: The Architect (Structural Optimization)
-   **Monolith Decomposition**: Identify any function with a Cyclomatic Complexity score >10. Break it into pure, testable sub-functions.
-   **Abstraction Alignment**: If a pattern (like DB access or LLM calling) is repeated across 3 files with slight variations, create a shared higher-order effect or utility in `packages/core`.
-   **Error Handling Refactoring**: Ensure every `try/catch` block includes specific error categorization rather than generic "Error occurred" logs.

#### Playbook D: The Benchmarker (Performance & Efficiency)
-   **Execution Profiling**: Create a "Profiling Wrapper" around suspected slow functions to measure actual CPU time vs. wall-clock time.
-   **Token Tallying**: Audit the token count of the worker's prompt for every major tool. Identify "Static Bloat"—instructions that are always true and could be moved to the system prompt.
-   **Memory Leak Hunting**: Perform a series of "Dry Run" tool calls and monitor the heap growth using `process.memoryUsage()` to identify non-garbage-collected closure leaks.

### Step 3: Role-Based Instruction (The Sub-Agent Protocol)
For each partition, you will generate a **Specific Agent Instruction** block. This prevents "task drift."

**Instruction Skeleton:**
> "Role: [The Janitor | The Architect]
> Objective: Eradicate debt in [Path].
> Deliverables: [Deliverable 1, Deliverable 2].
> Constraint: No breaking changes to public APIs. Verification pass must include typecheck."

### Step 3: Asynchronous Progress Tracking
The swarm maintains a "Central Heartbeat" using a `swarm_heartbeat.md` artifact. Every 10 minutes of execution, the agent must update this heartbeat with:
-   **Active Module**: Which file is being "Scrubbed."
-   **Latest Eradication**: What debt was removed.
-   **Blocked Status**: Any findings that require a "Leader Decision."

### Step 4: The Merging Protocol (Conflict Resolution)
If multiple "Swarm Threads" (sequential sub-tasks) affect the same central files (like types or DB schemas), they must be handled first.

**The "Bottom-Up" Merge Strategy:**
1.  Fix the shared types first.
2.  Fix the worker's data access layer second.
3.  Fix the frontend consumption layer last.

---

## Phase III: Tactical Eradication

This is the "Search and Destroy" phase. Action is taken based on the Discovery Map and Swarm Partitioning.

### Step 1: The Strangler Pattern for Tech Debt
When dealing with a monolithic, debt-ridden file, do not rewrite it from scratch. Use the **Strangler Pattern**.

**Procedure:**
1.  Identify a single logical unit inside the file (e.g., a specific helper function).
2.  Extract it into a new, typed utility file.
3.  Update the original file to import from the new utility.
4.  Verify the original file still works.
5.  Repeat until the original file is small enough to be "choked out."

### Step 2: Regression-Safe Bug Eradication
For every "nuisance bug," follow the **Triple-Shot Verification** method:
1.  **Reproduce**: Write a minimal script or run a command that triggers the nuisance.
2.  **Fix**: Apply the targeted patch.
3.  **Verify**: Re-run the reproduction script and confirm the "Negative Result."

### Step 3: "Shadow" Refactoring
When renaming or restructuring code to reduce debt:
1.  **Keep the Old Export Temporarily**: Use `@deprecated` tags.
2.  **Point the New Code to the New Export**.
3.  **Cleanup the Old Export** only after the entire workspace is re-checked by `grep`.


### Step 4: The Swarm Peer-Review Protocol
In a swarm, no single modification should be considered "Final" until it has been cross-referenced by a simulated "Reviewer" role.

**Cross-Reference Checklist:**
1.  **Semantic Consistency**: Does the fix in `apps/worker` violate an assumption made in `apps/web`?
2.  **Breadcrumb Audit**: Did the refactoring remove any "Activity Tracing" calls that the Benchmarker relies on?
3.  **The "Why" Test**: Is the code change self-documenting? If a future agent looks at this refactor, will it understand the "Debt Rationale" or just see "Code Noise"?

### Step 5: Global State & Environment Hardening
Technical debt often hides in global states, environment variables, and unmapped config files.

**The Hardening Workflow:**
-   **Config Decentralization**: Identify monolithic `config.ts` files and break them into domain-specific schemas (e.g., `ai-config.ts`, `db-config.ts`).
-   **Environment Variable Validation**: Use Zod to validate `process.env` at startup. If a required secret is missing or malformed, the system should fail-fast with a clear error rather than a "nuisance bug" later.
-   **Singleton Scrubbing**: Audit the use of Global Singletons. Replace them with Dependency Injection patterns where possible to increase testability and reduce hard-to-track state bugs.

### Step 6: Documentation Synchronicity
Code changes without documentation updates are just **Delayed Technical Debt**.
-   Every new tool or utility must have a JSDoc block with `@param`, `@returns`, and `@throws` definitions.
-   Identify outdated READMEs in the monorepo and update them to reflect the current stack.
-   **Technical Debt Log**: Maintain a `DEBT.md` at the root of the workspace to track *intentional* debt that was too high-effort to fix during the current hunt.
