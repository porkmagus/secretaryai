"use client";

import type {
  ToolApprovalDecisionResponse,
  ToolApprovalMode,
  ToolExecutionListResponse,
  ToolExecutionRecord,
  ToolListResponse,
  ToolRecord,
} from "@secretary/core-runtime";
import { useEffect, useMemo, useState } from "react";
import { formatTimestamp, formatTracePayload, snippet } from "../lib/presenters";
import {
  ActionRow,
  AppPage,
  EmptyState,
  LoadingSurface,
  NoticeBanner,
  StatCard,
  StatGrid,
  SurfaceCard,
  ToggleField,
} from "../lib/ui";

type EditableTool = {
  approvalMode: ToolApprovalMode;
  enabled: boolean;
};

type ExecutionFilter = "all" | "pending" | "completed" | "denied" | "failed";
type AccessPreset = "restrictive" | "full_access";

function toolGroupLabel(tool: ToolRecord) {
  switch (tool.key) {
    case "web_search":
    case "download_url":
    case "browser_open":
      return "Discovery and browsing";
    case "file_read":
    case "file_write":
    case "document_create":
    case "shell_command":
      return "Workspace and documents";
    case "task_create":
    case "task_list":
    case "task_update":
    case "memory_write":
      return "Memory and planning";
    case "telegram_send":
      return "Channels";
    case "calendar_create":
    case "email_draft":
    case "email_send":
      return "Future adapters";
    default:
      return "Other";
  }
}

function approvalModeLabel(mode: ToolApprovalMode) {
  switch (mode) {
    case "always_allow":
      return "Always allow";
    case "ask_first":
      return "Ask first";
    case "deny":
      return "Deny";
    default:
      return mode;
  }
}

function approvalModeHint(mode: ToolApprovalMode) {
  switch (mode) {
    case "always_allow":
      return "Runs immediately when the request matches this tool.";
    case "ask_first":
      return "Creates a reviewable approval request before anything executes.";
    case "deny":
      return "The Secretary can explain the request, but execution stays blocked.";
    default:
      return "";
  }
}

function executionTone(execution: ToolExecutionRecord) {
  if (execution.approvalState === "pending") {
    return {
      background: "var(--warning-soft-bg)",
      border: "var(--warning-soft-border)",
      text: "var(--warning-soft-text)",
    };
  }

  if (execution.executionStatus === "failed") {
    return {
      background: "var(--danger-soft-bg)",
      border: "var(--danger-soft-border)",
      text: "var(--danger-soft-text)",
    };
  }

  if (execution.executionStatus === "denied") {
    return {
      background: "var(--plum-soft-bg)",
      border: "var(--plum-soft-border)",
      text: "var(--plum-soft-text)",
    };
  }

  return {
    background: "var(--success-soft-bg)",
    border: "var(--success-soft-border)",
    text: "var(--success-soft-text)",
  };
}

function formatRequest(requestJson: Record<string, unknown>) {
  const text = formatTracePayload(requestJson);
  return text === "no payload" ? "No request payload recorded." : text;
}

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

  async function load() {
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
  }

  useEffect(() => {
    void load();
  }, [load]);

  async function saveTool(tool: ToolRecord) {
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
        formatRequest(execution.requestJson),
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
  const selectedExecution =
    filteredExecutions.find((execution) => execution.id === selectedExecutionId) ??
    filteredExecutions[0] ??
    null;

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
        <aside className="inspector-sidebar">
          <SurfaceCard
            tone="dark"
            title="Tool navigator"
            description={
              <p>
                Pick a capability group, inspect one tool policy, and keep approvals in the same
                lane.
              </p>
            }
            className="stack-sm"
          >
            <ActionRow align="between">
              <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
                {pending.length === 0
                  ? "Nothing is waiting for approval."
                  : `${pending.length} execution${pending.length === 1 ? "" : "s"} waiting for approval.`}
              </p>
              <button
                type="button"
                onClick={() => void load()}
                className="button-secondary"
                aria-label="Refresh tool registry and execution history"
                title="Refresh tool registry and execution history"
              >
                Refresh
              </button>
            </ActionRow>

            {pending.length > 0 ? (
              <>
                <div className="compact-list">
                  {pending.slice(0, 3).map((execution) => (
                    <div key={execution.id} style={{ display: "grid", gap: 8, padding: "10px 0" }}>
                      <div>
                        <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>
                          {execution.toolName}
                        </p>
                        <p
                          style={{
                            margin: "4px 0 0",
                            color: "var(--muted)",
                            fontSize: 12,
                            lineHeight: 1.45,
                          }}
                        >
                          {snippet(execution.summary, 100)}
                        </p>
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          onClick={() => void decide(execution.id, true)}
                          disabled={decisionId === execution.id}
                          aria-label={`Approve ${execution.toolName}`}
                          title={`Approve ${execution.toolName}`}
                          className="button-primary"
                        >
                          {decisionId === execution.id ? "Working..." : "Approve"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void decide(execution.id, false)}
                          disabled={decisionId === execution.id}
                          aria-label={`Deny ${execution.toolName}`}
                          title={`Deny ${execution.toolName}`}
                          className="button-danger"
                        >
                          Deny
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="section-rule" />
              </>
            ) : null}

            <div className="compact-list inspector-list">
              {groupedTools.map((entry) => (
                <div key={entry.group} style={{ display: "grid", gap: 8, padding: "6px 0 10px" }}>
                  <p
                    style={{
                      margin: 0,
                      color: "var(--accent)",
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                    }}
                  >
                    {entry.group}
                  </p>
                  {entry.tools.map((tool) => (
                    <button
                      key={tool.id}
                      type="button"
                      onClick={() => setSelectedToolId(tool.id)}
                      className="inspector-list-row"
                      style={{
                        textAlign: "left",
                        border:
                          selectedTool?.id === tool.id
                            ? "1px solid rgba(164, 141, 100, 0.26)"
                            : "1px solid rgba(196, 180, 154, 0.12)",
                        background:
                          selectedTool?.id === tool.id
                            ? "rgba(164, 141, 100, 0.1)"
                            : "rgba(18, 15, 12, 0.82)",
                        color: "var(--text)",
                        cursor: "pointer",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 10,
                          alignItems: "flex-start",
                        }}
                      >
                        <div>
                          <p style={{ margin: "0 0 4px", fontWeight: 700, fontSize: 14 }}>
                            {tool.name}
                          </p>
                          <p style={{ margin: 0, color: "var(--muted)", fontSize: 12 }}>
                            {tool.key}
                          </p>
                        </div>
                        <span style={{ color: "var(--muted)", fontSize: 11 }}>
                          {tool.enabled ? tool.healthStatus : "disabled"}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </SurfaceCard>
        </aside>

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
              <SurfaceCard
                tone="dark"
                title="Selected tool"
                description={
                  <p>
                    Edit the live policy here, then drop into execution history only when you need
                    the audit trail.
                  </p>
                }
                className="stack-sm"
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 16,
                    flexWrap: "wrap",
                    alignItems: "flex-start",
                  }}
                >
                  <div className="stack-sm" style={{ gap: 6 }}>
                    <p
                      className="eyebrow"
                      style={{
                        marginBottom: 0,
                        color: "var(--accent-strong)",
                        letterSpacing: "0.08em",
                      }}
                    >
                      {toolGroupLabel(selectedTool)}
                    </p>
                    <h2 style={{ margin: 0, fontSize: 24 }}>{selectedTool.name}</h2>
                    <p style={{ margin: 0, color: "var(--muted)", fontSize: 14, lineHeight: 1.5 }}>
                      {selectedTool.description}
                    </p>
                  </div>
                  <div className="desk-live-row" style={{ minWidth: "min(100%, 360px)" }}>
                    <div className="desk-live-chip">
                      <p className="desk-live-chip-label">Key</p>
                      <p className="desk-live-chip-value">{selectedTool.key}</p>
                    </div>
                    <div className="desk-live-chip">
                      <p className="desk-live-chip-label">Health</p>
                      <p className="desk-live-chip-value">{selectedTool.healthStatus}</p>
                    </div>
                    <div className="desk-live-chip">
                      <p className="desk-live-chip-label">Updated</p>
                      <p className="desk-live-chip-value">
                        {formatTimestamp(selectedTool.updatedAt)}
                      </p>
                    </div>
                  </div>
                </div>
              </SurfaceCard>

              <SurfaceCard title="Policy" className="stack-md">
                <div
                  style={{
                    display: "grid",
                    gap: 12,
                    gridTemplateColumns: "minmax(180px, 220px) auto",
                    alignItems: "center",
                  }}
                >
                  <label
                    htmlFor="policy-approval-mode"
                    style={{
                      position: "absolute",
                      width: 1,
                      height: 1,
                      padding: 0,
                      margin: -1,
                      overflow: "hidden",
                      clip: "rect(0, 0, 0, 0)",
                      border: 0,
                    }}
                  >
                    Approval mode
                  </label>
                  <select
                    id="policy-approval-mode"
                    value={selectedDraft.approvalMode}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [selectedTool.id]: {
                          ...current[selectedTool.id],
                          approvalMode: event.target.value as ToolApprovalMode,
                        },
                      }))
                    }
                  >
                    <option value="always_allow">Always allow</option>
                    <option value="ask_first">Ask first</option>
                    <option value="deny">Deny</option>
                  </select>

                  <ToggleField
                    checked={selectedDraft.enabled}
                    onChange={(next) =>
                      setDrafts((current) => ({
                        ...current,
                        [selectedTool.id]: {
                          ...current[selectedTool.id],
                          enabled: next,
                        },
                      }))
                    }
                    label="Tool enabled"
                    hint="Disabled tools remain visible but cannot execute."
                  />
                </div>

                <p style={{ margin: 0, color: "var(--muted)", fontSize: 14, lineHeight: 1.55 }}>
                  {approvalModeLabel(selectedDraft.approvalMode)}:{" "}
                  {approvalModeHint(selectedDraft.approvalMode)}
                  {!selectedDraft.enabled ? " This tool is disabled and will not execute." : ""}
                </p>

                <ActionRow align="between">
                  <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
                    {dirtyToolIds.includes(selectedTool.id)
                      ? "Unsaved policy changes are waiting."
                      : "This tool policy matches the saved registry."}
                  </p>
                  <button
                    type="button"
                    onClick={() => void saveTool(selectedTool)}
                    disabled={savingToolId === selectedTool.id}
                    className="button-primary"
                    style={{
                      opacity:
                        dirtyToolIds.includes(selectedTool.id) || savingToolId === selectedTool.id
                          ? 1
                          : 0.84,
                    }}
                  >
                    {savingToolId === selectedTool.id
                      ? "Saving..."
                      : dirtyToolIds.includes(selectedTool.id)
                        ? "Save Policy"
                        : "Saved"}
                  </button>
                </ActionRow>
              </SurfaceCard>

              <SurfaceCard
                title="Execution browser"
                description={
                  <p>
                    Filter recent runs, then inspect the payloads only for the execution you care
                    about.
                  </p>
                }
                className="stack-md"
              >
                <div
                  style={{
                    display: "grid",
                    gap: 10,
                    gridTemplateColumns:
                      "minmax(0, 1.2fr) minmax(180px, 220px) minmax(160px, 180px)",
                  }}
                >
                  <label
                    htmlFor="execution-search"
                    style={{
                      position: "absolute",
                      width: 1,
                      height: 1,
                      padding: 0,
                      margin: -1,
                      overflow: "hidden",
                      clip: "rect(0, 0, 0, 0)",
                      border: 0,
                    }}
                  >
                    Search executions
                  </label>
                  <input
                    id="execution-search"
                    value={filterText}
                    onChange={(event) => setFilterText(event.target.value)}
                    placeholder="Search tool, summary, request, or error"
                  />
                  <label
                    htmlFor="execution-tool-filter"
                    style={{
                      position: "absolute",
                      width: 1,
                      height: 1,
                      padding: 0,
                      margin: -1,
                      overflow: "hidden",
                      clip: "rect(0, 0, 0, 0)",
                      border: 0,
                    }}
                  >
                    Filter by tool
                  </label>
                  <select
                    id="execution-tool-filter"
                    value={filterToolKey}
                    onChange={(event) => setFilterToolKey(event.target.value)}
                  >
                    <option value="all">All tools</option>
                    {tools.map((tool) => (
                      <option key={tool.id} value={tool.key}>
                        {tool.name}
                      </option>
                    ))}
                  </select>
                  <label
                    htmlFor="execution-state-filter"
                    style={{
                      position: "absolute",
                      width: 1,
                      height: 1,
                      padding: 0,
                      margin: -1,
                      overflow: "hidden",
                      clip: "rect(0, 0, 0, 0)",
                      border: 0,
                    }}
                  >
                    Filter by state
                  </label>
                  <select
                    id="execution-state-filter"
                    value={filterState}
                    onChange={(event) => setFilterState(event.target.value as ExecutionFilter)}
                  >
                    <option value="all">All states</option>
                    <option value="pending">Pending approval</option>
                    <option value="completed">Completed</option>
                    <option value="denied">Denied</option>
                    <option value="failed">Failed</option>
                  </select>
                </div>

                {filteredExecutions.length === 0 ? (
                  <EmptyState
                    title="No executions match these filters"
                    description={
                      <p>
                        Widen the filters or pick another tool if you want to inspect older
                        approvals and runs.
                      </p>
                    }
                  />
                ) : (
                  <>
                    <div className="compact-list inspector-list">
                      {filteredExecutions.slice(0, 10).map((execution) => {
                        const tone = executionTone(execution);

                        return (
                          <button
                            key={execution.id}
                            type="button"
                            onClick={() => setSelectedExecutionId(execution.id)}
                            className="inspector-list-row"
                            style={{
                              textAlign: "left",
                              border:
                                selectedExecution?.id === execution.id
                                  ? "1px solid rgba(164, 141, 100, 0.26)"
                                  : `1px solid ${tone.border}`,
                              background:
                                selectedExecution?.id === execution.id
                                  ? "rgba(164, 141, 100, 0.1)"
                                  : "rgba(18, 15, 12, 0.82)",
                              color: "var(--text)",
                              cursor: "pointer",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                gap: 12,
                                flexWrap: "wrap",
                              }}
                            >
                              <div>
                                <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>
                                  {execution.toolName}
                                </p>
                                <p
                                  style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: 12 }}
                                >
                                  {formatTimestamp(execution.createdAt)}
                                </p>
                              </div>
                              <span
                                style={{
                                  alignSelf: "start",
                                  padding: "5px 9px",
                                  borderRadius: 999,
                                  border: `1px solid ${tone.border}`,
                                  background: tone.background,
                                  color: tone.text,
                                  fontSize: 11,
                                  fontWeight: 700,
                                }}
                              >
                                {execution.executionStatus}
                              </span>
                            </div>
                            <p
                              style={{
                                margin: "6px 0 0",
                                color: "var(--muted)",
                                fontSize: 12,
                                lineHeight: 1.45,
                              }}
                            >
                              {snippet(execution.summary, 140)}
                            </p>
                          </button>
                        );
                      })}
                    </div>

                    {selectedExecution ? (
                      <SurfaceCard tone="dark" className="stack-sm">
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 16,
                            flexWrap: "wrap",
                          }}
                        >
                          <div>
                            <p
                              className="eyebrow"
                              style={{
                                marginBottom: 6,
                                color: "var(--accent-strong)",
                                letterSpacing: "0.08em",
                              }}
                            >
                              {selectedExecution.toolKey}
                            </p>
                            <h2 style={{ margin: 0, fontSize: 22 }}>
                              {selectedExecution.toolName}
                            </h2>
                          </div>
                          <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
                            {formatTimestamp(selectedExecution.createdAt)}
                          </p>
                        </div>

                        <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.5 }}>
                          {selectedExecution.summary}
                        </p>

                        <div style={{ display: "grid", gap: 6 }}>
                          <p
                            style={{
                              margin: 0,
                              fontSize: 12,
                              fontWeight: 700,
                              color: "var(--muted)",
                            }}
                          >
                            Request
                          </p>
                          <pre
                            className="activity-trace-detail"
                            style={{ margin: 0, whiteSpace: "pre-wrap" }}
                          >
                            {formatRequest(selectedExecution.requestJson)}
                          </pre>
                        </div>

                        {selectedExecution.responseJson ? (
                          <div style={{ display: "grid", gap: 6 }}>
                            <p
                              style={{
                                margin: 0,
                                fontSize: 12,
                                fontWeight: 700,
                                color: "var(--muted)",
                              }}
                            >
                              Result
                            </p>
                            <pre
                              className="activity-trace-detail"
                              style={{ margin: 0, whiteSpace: "pre-wrap" }}
                            >
                              {formatTracePayload(selectedExecution.responseJson)}
                            </pre>
                          </div>
                        ) : null}

                        {selectedExecution.errorText ? (
                          <p
                            style={{
                              margin: 0,
                              color: "var(--danger)",
                              fontSize: 13,
                              lineHeight: 1.5,
                            }}
                          >
                            {selectedExecution.errorText}
                          </p>
                        ) : null}
                      </SurfaceCard>
                    ) : null}
                  </>
                )}
              </SurfaceCard>
            </>
          )}
        </div>
      </section>
    </AppPage>
  );
}
