---
description: "High-intelligence, agent-autonomous workflow for swarm-based efficiency audits and project-wide hardening."
---

# Master Workflow: Agentic Efficiency Audit & Hardening Swarm

This specification defines the protocol for an agent to move from "Functional" to "High-Performance" by auditing latencies, token costs, and system hardening.

---

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

### Step 6: The Clean Exit (Artifact Scrubbing)
Before ending the mission:
1.  **Remove Scratch Files**: Delete all temporary `.tmp` or `.log` files created during the hunt.
2.  **Archive Mission Artifacts**: Move `discovery_map.md` and `efficiency_audit.md` into the `docs/archives` directory for historical reference.
3.  **Final Verification Pass**: Run a full workspace `npm run typecheck` to ensure the final state is pristine.

---
*This specification defines the ultimate engineering standard for autonomous system integrity within the HamCult ecosystem.*
*Version 1.0 - Swarm-Ready.*
