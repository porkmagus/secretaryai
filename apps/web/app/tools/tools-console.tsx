"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  ToolApprovalMode,
  ToolApprovalDecisionResponse,
  ToolExecutionListResponse,
  ToolExecutionRecord,
  ToolListResponse,
  ToolRecord,
} from "@secretary/core-runtime";
import { formatTimestamp, formatTracePayload, snippet } from "../lib/presenters";

type EditableTool = {
  approvalMode: ToolApprovalMode;
  enabled: boolean;
};

type ExecutionFilter = "all" | "pending" | "completed" | "denied" | "failed";

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
      background: "rgba(217, 119, 6, 0.16)",
      border: "rgba(251, 191, 36, 0.28)",
      text: "#fde68a",
    };
  }

  if (execution.executionStatus === "failed") {
    return {
      background: "rgba(127, 29, 29, 0.24)",
      border: "rgba(248, 113, 113, 0.28)",
      text: "#fecaca",
    };
  }

  if (execution.executionStatus === "denied") {
    return {
      background: "rgba(88, 28, 135, 0.18)",
      border: "rgba(216, 180, 254, 0.28)",
      text: "#e9d5ff",
    };
  }

  return {
    background: "rgba(5, 46, 22, 0.24)",
    border: "rgba(134, 239, 172, 0.24)",
    text: "#bbf7d0",
  };
}

function formatRequest(requestJson: Record<string, unknown>) {
  const text = formatTracePayload(requestJson);
  return text === "no payload" ? "No request payload recorded." : text;
}

export function ToolsConsole() {
  const [tools, setTools] = useState<ToolRecord[]>([]);
  const [executions, setExecutions] = useState<ToolExecutionRecord[]>([]);
  const [drafts, setDrafts] = useState<Record<string, EditableTool>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [savingToolId, setSavingToolId] = useState<string | null>(null);
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
      setTools(nextTools);
      setExecutions((executionsBody as ToolExecutionListResponse).executions);
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
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load tools.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

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
        decisionError instanceof Error
          ? decisionError.message
          : "Unable to update approval.",
      );
    } finally {
      setDecisionId(null);
    }
  }

  const dirtyToolIds = useMemo(
    () =>
      tools
        .filter((tool) => {
          const draft = drafts[tool.id];
          return (
            draft &&
            (draft.approvalMode !== tool.approvalMode || draft.enabled !== tool.enabled)
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

  const pending = filteredExecutions.filter(
    (execution) => execution.approvalState === "pending",
  );
  const recentFailures = executions.filter(
    (execution) => execution.executionStatus === "failed",
  ).length;
  const completedCount = executions.filter(
    (execution) => execution.executionStatus === "completed",
  ).length;

  return (
    <main style={{ minHeight: "100vh", padding: "32px 18px 48px" }}>
      <section
        style={{
          width: "min(1280px, 100%)",
          margin: "0 auto",
          display: "grid",
          gap: 20,
        }}
      >
        <header
          style={{
            padding: 28,
            borderRadius: 28,
            border: "1px solid var(--border)",
            background: "var(--panel)",
            boxShadow: "var(--shadow)",
          }}
        >
          <p
            style={{
              margin: 0,
              color: "var(--accent)",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            Tools Console
          </p>
          <h1
            style={{
              margin: "12px 0 10px",
              fontSize: "clamp(2.1rem, 4vw, 4rem)",
              lineHeight: 1,
            }}
          >
            Phase 5 Tools, Policies, and Audit
          </h1>
          <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.6, maxWidth: 780 }}>
            Review which tools run automatically, which require approval, and exactly
            what happened when the Secretary tried to take action.
          </p>
          <p style={{ margin: "12px 0 0", color: "var(--muted)", fontSize: 14 }}>
            {error ??
              statusMessage ??
              (isLoading
                ? "Loading tool registry..."
                : `${tools.length} tools · ${executions.length} recent executions · ${dirtyToolIds.length} unsaved policies`)}
          </p>
        </header>

        <section
          style={{
            display: "grid",
            gap: 16,
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          }}
        >
          {[
            { label: "Pending approvals", value: pending.length, note: "Needs review before execution" },
            { label: "Completed actions", value: completedCount, note: "Successful runs in the recent audit window" },
            { label: "Recent failures", value: recentFailures, note: "Safe failures that need inspection if unexpected" },
            { label: "Policy changes", value: dirtyToolIds.length, note: "Tool cards with unsaved edits" },
          ].map((stat) => (
            <article
              key={stat.label}
              style={{
                padding: 18,
                borderRadius: 22,
                border: "1px solid var(--border)",
                background: "var(--panel-strong)",
                display: "grid",
                gap: 6,
              }}
            >
              <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>{stat.label}</p>
              <p style={{ margin: 0, fontSize: 32, fontWeight: 800 }}>{stat.value}</p>
              <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.5 }}>
                {stat.note}
              </p>
            </article>
          ))}
        </section>

        <section
          style={{
            display: "grid",
            gap: 20,
            gridTemplateColumns: "minmax(0, 1.05fr) minmax(0, 1.25fr)",
          }}
        >
          <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
            {tools.map((tool) => {
              const draft = drafts[tool.id];
              if (!draft) {
                return null;
              }

              const isDirty =
                draft.approvalMode !== tool.approvalMode || draft.enabled !== tool.enabled;

              return (
                <article
                  key={tool.id}
                  style={{
                    padding: 20,
                    borderRadius: 24,
                    border: isDirty
                      ? "1px solid rgba(125, 211, 252, 0.32)"
                      : "1px solid var(--border)",
                    background: "var(--panel-strong)",
                    display: "grid",
                    gap: 14,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
                    <div>
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
                        {tool.key}
                      </p>
                      <h2 style={{ margin: "8px 0 4px", fontSize: 22 }}>{tool.name}</h2>
                      <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.5 }}>
                        {tool.description}
                      </p>
                    </div>
                    <div style={{ textAlign: "right", color: "var(--muted)", fontSize: 13 }}>
                      <div>{tool.healthStatus}</div>
                      <div>{formatTimestamp(tool.updatedAt)}</div>
                    </div>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gap: 12,
                      gridTemplateColumns: "minmax(180px, 220px) auto",
                    }}
                  >
                    <select
                      value={draft.approvalMode}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [tool.id]: {
                            ...current[tool.id],
                            approvalMode: event.target.value as ToolApprovalMode,
                          },
                        }))
                      }
                      style={{
                        borderRadius: 12,
                        border: "1px solid rgba(148, 163, 184, 0.18)",
                        background: "rgba(2, 6, 23, 0.75)",
                        color: "var(--text)",
                        padding: "10px 12px",
                        font: "inherit",
                      }}
                    >
                      <option value="always_allow">Always allow</option>
                      <option value="ask_first">Ask first</option>
                      <option value="deny">Deny</option>
                    </select>
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        color: "var(--muted)",
                        fontSize: 14,
                      }}
                    >
                      <input
                        checked={draft.enabled}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [tool.id]: {
                              ...current[tool.id],
                              enabled: event.target.checked,
                            },
                          }))
                        }
                        type="checkbox"
                      />
                      enabled
                    </label>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
                      {approvalModeLabel(draft.approvalMode)}: {approvalModeHint(draft.approvalMode)}
                      {!draft.enabled ? " Tool is disabled." : ""}
                      {isDirty ? " Unsaved changes are waiting." : ""}
                    </p>
                    <button
                      type="button"
                      onClick={() => void saveTool(tool)}
                      disabled={savingToolId === tool.id}
                      style={{
                        border: "none",
                        borderRadius: 999,
                        padding: "10px 16px",
                        font: "inherit",
                        fontWeight: 700,
                        cursor: savingToolId === tool.id ? "wait" : "pointer",
                        color: "#03111f",
                        background:
                          "linear-gradient(135deg, var(--accent) 0%, var(--accent-strong) 100%)",
                        opacity: isDirty || savingToolId === tool.id ? 1 : 0.84,
                      }}
                    >
                      {savingToolId === tool.id ? "Saving..." : isDirty ? "Save Policy" : "Policy Saved"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          <div style={{ display: "grid", gap: 20, alignContent: "start" }}>
            <article
              style={{
                padding: 20,
                borderRadius: 24,
                border: "1px solid var(--border)",
                background: "var(--panel-strong)",
                display: "grid",
                gap: 12,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <h2 style={{ margin: 0 }}>Pending Approvals</h2>
                <button
                  type="button"
                  onClick={() => void load()}
                  style={{
                    border: "1px solid rgba(125, 211, 252, 0.2)",
                    borderRadius: 999,
                    padding: "8px 12px",
                    background: "rgba(56, 189, 248, 0.08)",
                    color: "var(--text)",
                    font: "inherit",
                    cursor: "pointer",
                  }}
                >
                  Refresh
                </button>
              </div>
              {pending.length === 0 ? (
                <p style={{ margin: 0, color: "var(--muted)" }}>
                  Nothing is waiting for approval right now.
                </p>
              ) : (
                pending.map((execution) => (
                  <article
                    key={execution.id}
                    style={{
                      padding: 14,
                      borderRadius: 16,
                      border: "1px solid rgba(148, 163, 184, 0.14)",
                      background: "rgba(2, 6, 23, 0.65)",
                      display: "grid",
                      gap: 10,
                    }}
                  >
                    <div>
                      <p style={{ margin: "0 0 6px", fontWeight: 700 }}>{execution.toolName}</p>
                      <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.5 }}>
                        {execution.summary}
                      </p>
                    </div>
                    <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.5 }}>
                      Request: {formatRequest(execution.requestJson)}
                    </p>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        onClick={() => void decide(execution.id, true)}
                        disabled={decisionId === execution.id}
                        style={{
                          border: "none",
                          borderRadius: 999,
                          padding: "10px 14px",
                          font: "inherit",
                          fontWeight: 700,
                          cursor: decisionId === execution.id ? "wait" : "pointer",
                          color: "#03111f",
                          background:
                            "linear-gradient(135deg, var(--accent) 0%, var(--accent-strong) 100%)",
                        }}
                      >
                        {decisionId === execution.id ? "Working..." : "Approve"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void decide(execution.id, false)}
                        disabled={decisionId === execution.id}
                        style={{
                          border: "1px solid rgba(248, 113, 113, 0.32)",
                          borderRadius: 999,
                          padding: "10px 14px",
                          font: "inherit",
                          cursor: decisionId === execution.id ? "wait" : "pointer",
                          color: "var(--text)",
                          background: "rgba(127, 29, 29, 0.24)",
                        }}
                      >
                        Deny
                      </button>
                    </div>
                  </article>
                ))
              )}
            </article>

            <article
              style={{
                padding: 20,
                borderRadius: 24,
                border: "1px solid var(--border)",
                background: "var(--panel-strong)",
                display: "grid",
                gap: 14,
              }}
            >
              <div style={{ display: "grid", gap: 10 }}>
                <h2 style={{ margin: 0 }}>Recent Executions</h2>
                <div
                  style={{
                    display: "grid",
                    gap: 10,
                    gridTemplateColumns: "minmax(0, 1.2fr) minmax(180px, 220px) minmax(160px, 180px)",
                  }}
                >
                  <input
                    value={filterText}
                    onChange={(event) => setFilterText(event.target.value)}
                    placeholder="Search tool, summary, request, or error"
                    style={{
                      borderRadius: 12,
                      border: "1px solid rgba(148, 163, 184, 0.18)",
                      background: "rgba(2, 6, 23, 0.75)",
                      color: "var(--text)",
                      padding: "10px 12px",
                      font: "inherit",
                    }}
                  />
                  <select
                    value={filterToolKey}
                    onChange={(event) => setFilterToolKey(event.target.value)}
                    style={{
                      borderRadius: 12,
                      border: "1px solid rgba(148, 163, 184, 0.18)",
                      background: "rgba(2, 6, 23, 0.75)",
                      color: "var(--text)",
                      padding: "10px 12px",
                      font: "inherit",
                    }}
                  >
                    <option value="all">All tools</option>
                    {tools.map((tool) => (
                      <option key={tool.id} value={tool.key}>
                        {tool.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={filterState}
                    onChange={(event) => setFilterState(event.target.value as ExecutionFilter)}
                    style={{
                      borderRadius: 12,
                      border: "1px solid rgba(148, 163, 184, 0.18)",
                      background: "rgba(2, 6, 23, 0.75)",
                      color: "var(--text)",
                      padding: "10px 12px",
                      font: "inherit",
                    }}
                  >
                    <option value="all">All states</option>
                    <option value="pending">Pending approval</option>
                    <option value="completed">Completed</option>
                    <option value="denied">Denied</option>
                    <option value="failed">Failed</option>
                  </select>
                </div>
              </div>

              {filteredExecutions.length === 0 ? (
                <p style={{ margin: 0, color: "var(--muted)" }}>
                  No tool executions match the current filters.
                </p>
              ) : (
                filteredExecutions.map((execution) => {
                  const tone = executionTone(execution);

                  return (
                    <article
                      key={execution.id}
                      style={{
                        padding: 14,
                        borderRadius: 16,
                        border: "1px solid rgba(148, 163, 184, 0.14)",
                        background: "rgba(2, 6, 23, 0.65)",
                        display: "grid",
                        gap: 10,
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
                          <p style={{ margin: 0, fontWeight: 700 }}>{execution.toolName}</p>
                          <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: 12 }}>
                            {formatTimestamp(execution.createdAt)}
                            {execution.conversationId ? ` · ${snippet(execution.conversationId, 24)}` : ""}
                          </p>
                        </div>
                        <span
                          style={{
                            alignSelf: "start",
                            padding: "6px 10px",
                            borderRadius: 999,
                            border: `1px solid ${tone.border}`,
                            background: tone.background,
                            color: tone.text,
                            fontSize: 12,
                            fontWeight: 700,
                          }}
                        >
                          {execution.executionStatus} · {execution.approvalState}
                        </span>
                      </div>

                      <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.5 }}>
                        {execution.summary}
                      </p>

                      <div style={{ display: "grid", gap: 6 }}>
                        <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>
                          Request
                        </p>
                        <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.5 }}>
                          {formatRequest(execution.requestJson)}
                        </p>
                      </div>

                      {execution.responseJson ? (
                        <div style={{ display: "grid", gap: 6 }}>
                          <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>
                            Result
                          </p>
                          <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.5 }}>
                            {snippet(formatTracePayload(execution.responseJson), 260)}
                          </p>
                        </div>
                      ) : null}

                      {execution.errorText ? (
                        <p style={{ margin: 0, color: "#fca5a5", fontSize: 13, lineHeight: 1.5 }}>
                          {execution.errorText}
                        </p>
                      ) : null}
                    </article>
                  );
                })
              )}
            </article>
          </div>
        </section>
      </section>
    </main>
  );
}
