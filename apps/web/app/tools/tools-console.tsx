"use client";

import type {
  ToolApprovalDecisionResponse,
  ToolExecutionListResponse,
  ToolExecutionRecord,
  ToolListResponse,
  ToolRecord,
} from "@secretary/core-runtime";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AppPage,
  EmptyState,
  LoadingSurface,
  NoticeBanner,
  StatCard,
  StatGrid,
  SurfaceCard,
} from "../lib/ui";
import {
  type EditableTool,
  type ExecutionFilter,
  ExecutionTrailPanel,
  ToolNavigator,
  ToolPolicyPanel,
} from "./sections";
import { toolGroupLabel } from "./sections/utils";

type AccessPreset = "restrictive" | "full_access";

function presetLabel(preset: AccessPreset) {
  return preset === "restrictive" ? "Restrictive" : "YOLO / Full access";
}

function presetHint(preset: AccessPreset) {
  return preset === "restrictive"
    ? "Keeps search flowing, but returns enabled tools to ask-first review."
    : "Lets every enabled tool run immediately without approval prompts.";
}

function draftForPreset(tool: ToolRecord, preset: AccessPreset): EditableTool {
  if (preset === "full_access") {
    return {
      approvalMode: tool.enabled ? "always_allow" : tool.approvalMode,
      enabled: tool.enabled,
    };
  }

  if (!tool.enabled) {
    return {
      approvalMode: tool.approvalMode,
      enabled: false,
    };
  }

  if (tool.key === "web_search") {
    return {
      approvalMode: "always_allow",
      enabled: true,
    };
  }

  if (tool.key === "email_send") {
    return {
      approvalMode: "deny",
      enabled: tool.enabled,
    };
  }

  return {
    approvalMode: "ask_first",
    enabled: true,
  };
}

export function ToolsConsole() {
  const [tools, setTools] = useState<ToolRecord[]>([]);
  const [executions, setExecutions] = useState<ToolExecutionRecord[]>([]);
  const [drafts, setDrafts] = useState<Record<string, EditableTool>>({});
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null);
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [savingToolId, setSavingToolId] = useState<string | null>(null);
  const [presetBusy, setPresetBusy] = useState<AccessPreset | null>(null);
  const [decisionId, setDecisionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [filterText, setFilterText] = useState("");
  const [filterToolKey, setFilterToolKey] = useState("all");
  const [filterState, setFilterState] = useState<ExecutionFilter>("all");

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [toolsResponse, executionsResponse] = await Promise.all([
        fetch("/api/tools", { cache: "no-store" }),
        fetch("/api/tool-executions", { cache: "no-store" }),
      ]);
      const [toolsBody, executionsBody] = await Promise.all([
        toolsResponse.json(),
        executionsResponse.json(),
      ]);

      if (!toolsResponse.ok) {
        throw new Error(toolsBody.error ?? "Unable to load tools.");
      }

      if (!executionsResponse.ok) {
        throw new Error(executionsBody.error ?? "Unable to load tool executions.");
      }

      const nextTools = (toolsBody as ToolListResponse).tools;
      const nextExecutions = (executionsBody as ToolExecutionListResponse).executions;

      setTools(nextTools);
      setExecutions(nextExecutions);
      setDrafts((current) => {
        const next = { ...current };

        for (const tool of nextTools) {
          next[tool.id] = current[tool.id] ?? {
            approvalMode: tool.approvalMode,
            enabled: tool.enabled,
          };
        }

        return next;
      });
      setSelectedToolId((current) => {
        if (current && nextTools.some((tool) => tool.id === current)) {
          return current;
        }

        return nextTools[0]?.id ?? null;
      });
      setSelectedExecutionId((current) => {
        if (current && nextExecutions.some((execution) => execution.id === current)) {
          return current;
        }

        return nextExecutions[0]?.id ?? null;
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load tools.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(tool: ToolRecord) {
    const draft = drafts[tool.id];
    if (!draft) {
      return;
    }

    setSavingToolId(tool.id);
    setError(null);
    setStatusMessage(null);

    try {
      const response = await fetch(`/api/tools/${tool.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(draft),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to update tool.");
      }

      setStatusMessage(`${tool.name} policy saved.`);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to update tool.");
    } finally {
      setSavingToolId(null);
    }
  }

  async function decide(executionId: string, approve: boolean) {
    setDecisionId(executionId);
    setError(null);
    setStatusMessage(null);

    try {
      const response = await fetch(
        `/api/tool-executions/${executionId}/${approve ? "approve" : "deny"}`,
        { method: "POST" },
      );
      const payload = (await response.json()) as ToolApprovalDecisionResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to update approval.");
      }

      setStatusMessage(
        approve
          ? `${payload.execution.toolName} was approved and processed.`
          : `${payload.execution.toolName} was denied safely.`,
      );
      await load();
    } catch (decisionError) {
      setError(
        decisionError instanceof Error ? decisionError.message : "Unable to update approval.",
      );
    } finally {
      setDecisionId(null);
    }
  }

  async function applyPreset(preset: AccessPreset) {
    setPresetBusy(preset);
    setError(null);
    setStatusMessage(null);

    const nextDrafts = Object.fromEntries(
      tools.map((tool) => [tool.id, draftForPreset(tool, preset)]),
    ) as Record<string, EditableTool>;

    setDrafts((current) => ({
      ...current,
      ...nextDrafts,
    }));

    try {
      const results = await Promise.all(
        tools.map(async (tool) => {
          const response = await fetch(`/api/tools/${tool.id}`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(nextDrafts[tool.id]),
          });
          const payload = await response.json().catch(() => ({}));

          if (!response.ok) {
            throw new Error(payload.error ?? `Unable to update ${tool.name}.`);
          }

          return true;
        }),
      );

      if (results.length > 0) {
        setStatusMessage(`${presetLabel(preset)} applied across ${tools.length} tools.`);
      }
      await load();
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : "Unable to apply access preset.");
    } finally {
      setPresetBusy(null);
    }
  }

  const dirtyToolIds = useMemo(
    () =>
      tools
        .filter((tool) => {
          const draft = drafts[tool.id];
          return (
            draft && (draft.approvalMode !== tool.approvalMode || draft.enabled !== tool.enabled)
          );
        })
        .map((tool) => tool.id),
    [drafts, tools],
  );

  const filteredExecutions = useMemo(() => {
    return executions.filter((execution) => {
      if (filterToolKey !== "all" && execution.toolKey !== filterToolKey) {
        return false;
      }

      if (filterState === "pending" && execution.approvalState !== "pending") {
        return false;
      }

      if (
        filterState === "completed" &&
        !(execution.executionStatus === "completed" && execution.approvalState !== "pending")
      ) {
        return false;
      }

      if (filterState === "denied" && execution.executionStatus !== "denied") {
        return false;
      }

      if (filterState === "failed" && execution.executionStatus !== "failed") {
        return false;
      }

      if (!filterText.trim()) {
        return true;
      }

      const search = filterText.trim().toLowerCase();
      const haystack = [
        execution.toolName,
        execution.toolKey,
        execution.summary,
        execution.errorText ?? "",
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(search);
    });
  }, [executions, filterState, filterText, filterToolKey]);

  const groupedTools = useMemo(() => {
    const orderedGroups = [
      "Discovery and browsing",
      "Workspace and documents",
      "Memory and planning",
      "Channels",
      "Future adapters",
      "Other",
    ] as const;

    return orderedGroups
      .map((group) => ({
        group,
        tools: tools.filter((tool) => toolGroupLabel(tool) === group),
      }))
      .filter((entry) => entry.tools.length > 0);
  }, [tools]);

  const pending = filteredExecutions.filter((execution) => execution.approvalState === "pending");
  const selectedTool = tools.find((tool) => tool.id === selectedToolId) ?? tools[0] ?? null;
  const selectedDraft = selectedTool ? drafts[selectedTool.id] : null;

  if (isLoading && tools.length === 0 && executions.length === 0) {
    return (
      <AppPage width="1280px">
        <LoadingSurface
          title="Preparing tool controls"
          description={
            <p>
              Gathering tool policies, approval history, and recent executions so the tools surface
              opens with the current control state already in view.
            </p>
          }
          blocks={3}
        />
      </AppPage>
    );
  }

  return (
    <AppPage width="1280px">
      <SurfaceCard
        tone="dark"
        title="Tools"
        description={
          <p>
            Set the rules once, keep approvals calm, and only dive into audit detail when something
            actually matters.
          </p>
        }
      >
        <div className="stack-md">
          <StatGrid>
            <StatCard
              label="Pending"
              value={String(pending.length)}
              detail="Approvals currently waiting"
              tone="soft"
            />
            <StatCard
              label="Completed"
              value={String(
                executions.filter((execution) => execution.executionStatus === "completed").length,
              )}
              detail="Recent successful runs"
              tone="soft"
            />
            <StatCard
              label="Failures"
              value={String(
                executions.filter((execution) => execution.executionStatus === "failed").length,
              )}
              detail="Runs that need a closer look"
              tone="soft"
            />
            <StatCard
              label="Dirty"
              value={String(dirtyToolIds.length)}
              detail="Policies changed but not yet saved"
              tone="soft"
            />
          </StatGrid>
          <div className="persona-action-cluster">
            {(["restrictive", "full_access"] as const).map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => void applyPreset(preset)}
                className={preset === "full_access" ? "button-danger" : "button-secondary"}
                disabled={presetBusy !== null}
                title={presetHint(preset)}
                aria-label={`Apply ${presetLabel(preset)} preset`}
              >
                {presetBusy === preset ? "Applying..." : presetLabel(preset)}
              </button>
            ))}
            <button
              type="button"
              onClick={() => void load()}
              className="button-secondary"
              aria-label="Refresh tool registry and execution history"
              title="Refresh tool registry and execution history"
            >
              {isLoading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.55 }}>
          {error ??
            statusMessage ??
            (isLoading
              ? "Loading tool registry..."
              : `${tools.length} tools loaded with ${executions.length} recent executions.`)}
        </p>
      </SurfaceCard>

      {error || statusMessage ? (
        <NoticeBanner tone={error ? "error" : "success"}>{error ?? statusMessage}</NoticeBanner>
      ) : null}

      <section className="inspector-grid">
        <ToolNavigator
          pending={pending}
          decisionId={decisionId}
          decide={decide}
          load={load}
          groupedTools={groupedTools}
          selectedToolId={selectedToolId}
          onSelectTool={setSelectedToolId}
        />

        <div className="inspector-panel">
          {!selectedTool || !selectedDraft ? (
            <SurfaceCard>
              <EmptyState
                title="Choose a tool to tune"
                description={
                  <p>
                    Pick anything from the navigator to inspect its policy, health, and recent
                    execution trail.
                  </p>
                }
              />
            </SurfaceCard>
          ) : (
            <>
              <ToolPolicyPanel
                selectedTool={selectedTool}
                selectedDraft={selectedDraft}
                dirtyToolIds={dirtyToolIds}
                savingToolId={savingToolId}
                onApprovalModeChange={(mode) =>
                  setDrafts((current) => ({
                    ...current,
                    [selectedTool.id]: {
                      ...current[selectedTool.id],
                      approvalMode: mode,
                    },
                  }))
                }
                onEnabledChange={(enabled) =>
                  setDrafts((current) => ({
                    ...current,
                    [selectedTool.id]: {
                      ...current[selectedTool.id],
                      enabled,
                    },
                  }))
                }
                onSave={() => void save(selectedTool)}
              />
              <ExecutionTrailPanel
                filteredExecutions={filteredExecutions}
                selectedExecutionId={selectedExecutionId}
                onSelectExecution={setSelectedExecutionId}
                filterText={filterText}
                onFilterTextChange={setFilterText}
                filterToolKey={filterToolKey}
                onFilterToolKeyChange={setFilterToolKey}
                filterState={filterState}
                onFilterStateChange={(value) => setFilterState(value)}
                tools={tools}
              />
            </>
          )}
        </div>
      </section>
    </AppPage>
  );
}
