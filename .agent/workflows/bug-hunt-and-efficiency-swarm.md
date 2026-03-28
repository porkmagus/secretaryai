---
description: "High-intelligence, agent-autonomous workflow for swarm-based bug hunting, technical debt resolution, and project-wide efficiency audits."
---

# Master Workflow: Agentic Swarm Bug-Hunting & Efficiency Audit

This specification defines the foundational protocol for an agent to transition from a reactive "fix-it" mode into a proactive, "Search-and-Destroy" (SnD) mission against codebase rot, silent failures, and performance regressions. 

The goal of this workflow is not just to fix individual bugs, but to fundamentally upgrade the **system integrity** and **runtime efficiency** of the HamCult ecosystem through systematic, collective intelligence.

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


## Phase IV: The Great Efficiency Audit

After the bugs are eradicated and the technical debt is cleared, the swarm must focus on **Efficiency Optimization**. This is where we move from "Working" to "Extreme Performance."


### Step 1: Tool & API Performance Benchmarking
Every tool and API call has a "Cost Budget"—both in time (latency) and resource consumption.

**The P99 Audit Protocol:**
1.  **P99 Latency Measurement**: For every tool in `tools-runtime.ts`, perform a batch execution and record the P99 latency. Identify the bottom 3 performers.
2.  **Bottleneck Isolation**: Are the bottlenecks IO-bound (DB queries), CPU-bound (Large data parsing), or Network-bound (External API calls)?
3.  **The "Pre-flight" Optimization**: Replace heavy synchronous checks with lightweight "probe" checks before committing to a full tool execution.

### Step 2: The Agentic Profiling Toolkit
Performance auditing requires specific instruments. If they do not exist, the swarm must create them.

**Toolkit Components:**
-   **The `trace-highlighter` script**: A manual or utility-based script that scans `activityTraces` and highlights "Hot Paths" where the same function is called 5+ times in a single loop.
-   **The `heap-snapshot` probe**: A Node.js snippet that uses `v8.getHeapStatistics()` before and after a massive file-read to ensure the garbage-collector is reclaiming memory in a timely fashion.
-   **The `async-leak-detector`**: Identification of non-awaited promises or long-running timers that keep the worker process alive unnecessarily.

### Step 3: Token-Cost Audit (LLM Specific)
In an agentic system, **Tokens are Currency**. Every redundant token increases the prompt-to-response latency and the operational cost.

**Efficiency Framework:**
-   **Prompt Compression**: Audit the `systemPrompt` and `persona-soul`. Strip "Fluff" words (e.g., "Please", "Kindly", "You are very helpful") and replace with technical directives that have higher "attention weight."
-   **The RAG Relevance Audit**: If the worker uses a vector-search or memory retrieval, audit the "Noise-to-Signal" ratio. If 80% of retrieved context is never used in the reasoning phase, your retrieval "k" value is too high.
-   **Chunking Strategy Optimization**: Ensure that when reading large files, the agent uses "Overlapping Chunks" only where strictly necessary for context, reducing the total token-read count by 15-20%.

### Step 4: Database Efficiency & Query Audit
With thousands of `activityTraces` and `agentJobSteps`, the database can become a massive performance drag.

**The Index & Query Scrub:**
1.  **Drizzle-Diving**: Review every `db.select()` call. Are we selecting 50 columns when we only need `status` and `id`? Use non-star schemas for bulk operations.
2.  **Ghost Writes Audit**: Identify tools that write to the database during "Read-Only" operations. Every DB write incurs a WAL (Write Ahead Log) cost and should be minimized.
3.  **Join Optimization**: Replace heavy N+1 query patterns (e.g., selecting jobs then selecting steps in a loop) with a single, efficient Left Join across the `jobs` and `agentJobSteps` tables.

### Step 5: The "Efficiency Proof" (Artifact Creation)
Generate an `efficiency_audit.md` comparing the "Pre-Audit" metrics to the "Post-Audit" benchmarks. 

**Wait! Before Implementing:**
The swarm must use a **Cost-Benefit Matrix** to decide which optimizations to pursue.
-   **High Impact / Low Effort**: (e.g., Adding a missing DB index) -> **IMMEDIATE ACTION**.
-   **High Impact / High Effort**: (e.g., Migrating from ESM to Vite-bundling) -> **PROPOSE TO OPERATOR**.
-   **Low Impact / High Effort**: (e.g., Micro-optimizing string concatenation) -> **DISCARD**.

### Step 4: Bundle & Build Optimization
Efficiency also applies to the **Developer Experience (DX)**. If `npm install` or `npm run dev` takes 2 minutes, productivity suffers.

**DX Performance Audit:**
-   **Transpilation Speed**: Evaluate if migration to SWC or Vite sub-bundling can reduce the hot-reload time for `apps/web`.
-   **Dependency Tree Shaking**: Identify "Phantom Dependencies"—libraries included in the bundle that are never imported.
-   **Monorepo Symlink health**: Run a scan to ensure `node_modules` are properly hoisted and not duplicated across `apps/*` and `packages/*`.

### Step 5: The "Efficiency Proof" (Artifact Creation)
Generate an `efficiency_audit.md` comparing the "Pre-Audit" metrics to the "Post-Audit" benchmarks. This proof document MUST include:
-   **Latency Delta**: Before vs. After timing for the 3 slowest tools.
-   **Token Delta**: Total tokens consumed for a standard "Hello World" task.
-   **Build Delta**: Time to complete a clean build.

---

## Phase V: Hardening & Post-Mission Optimization

The final phase of the Swarm Hunt is ensuring that the bugs do not return and the debt does not reform. This is the "Post-Project" hardening cycle.

### Step 1: Installing "Automated Watchdogs"
Transform your manual discoveries into permanent CI/CD checks.

**Hardening Techniques:**
1.  **Strict Lint Rules**: If you found common variable-shadowing bugs, install a custom ESLint rule to prevent them permanently.
2.  **Custom Git Hooks**: Prevent commits that include large, unformatted strings or console logs.
3.  **Runtime "Health-Checks"**: Implement a `health-check` tool the agent can run at the start of every session to verify the environment's integrity.

### Step 2: Documentation as "Living Code"
Update the project's **Onboarding & Standards** README.
-   Document the "Swarm Partitioning" logic used during this mission so future agents can follow the same pattern.
-   Publish the "Efficiency Benchmarks" as the new performance baseline.

### Step 3: The "Final Handover" Summary
Consolidate the entire mission into a **Master Completion Report**. This report is the final deliverable for the human operator.

**The Completion Report Structure:**
-   **The Hunt Summary**: "X bugs found, Y bugs eradicated."
-   **The Debt Ledger**: "Z files refactored, complexity reduced by W%."
-   **The Efficiency Score**: "Average latency reduced by T ms."
-   **Next-Steps Strategy**: Where the swarm should hunt next.


### Step 4: Theoretical Edge-Case Simulations ("Battle Testing")
Before concluding the mission, the swarm must use a **Simulated Failure Mode** to "Battle Test" the new fixes and hardening checks.

**Simulation Playbook:**
1.  **Network Flicker Simulation**: Use tools (or code modification) to simulate a 30% failure rate for an external LLM API. Does the worker's new error handling degrade gracefully or crash?
2.  **Concurrency Stress Test**: Trigger 5 simultaneous build jobs in the dev environment. Identify if any "Race Condition Debt" remains in the DB access layer.
3.  **Boundary Value Injection**: Inject malformed or massive data payloads into the most frequently audited tool. Verify the Zod schemas correctly reject the junk data with helpful error logs.

### Step 5: Post-Mission Knowledge Injection
Efficiency and debt-prevention are only permanent if future models and agents can learn from the "Hunt."

**Knowledge Synthesis:**
-   **Update `.agent/PIPELINE.md`**: (If it exists) or create a project-level "Agentic Lessons Learned" file.
-   **Create a "Common Pitfalls" Wiki**: Document the top 5 most common "Nuisance Bugs" found during the hunt so future contributors avoid making the same mistakes.
-   **LLM "Memory Seeding"**: Use the `note_to_self` tool to record the new performance baseline and the most critical refactoring changes into the agent's long-term memory.

### Step 6: The Clean Exit (Artifact Scrubging)
Before ending the mission:
1.  **Remove Scratch Files**: Delete all temporary `.tmp` or `.log` files created during the hunt.
2.  **Archive Mission Artifacts**: Move `discovery_map.md` and `efficiency_audit.md` into the `docs/archives` directory for historical reference.
3.  **Final Verification Pass**: Run a full workspace `npm run typecheck` to ensure the final state is pristine.

---
*This specification defines the ultimate engineering standard for autonomous system integrity within the HamCult ecosystem.*
*Version 1.0 - Swarm-Ready.*
