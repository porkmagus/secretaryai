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
*(Phase II and beyond to follow...)*
