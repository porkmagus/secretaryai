"use client";

import type { ToolExecutionRecord, ToolRecord } from "@secretary/core-runtime";
import { formatTimestamp, formatTracePayload, snippet } from "../../lib/presenters";
import { EmptyState, SurfaceCard } from "../../lib/ui";
import type { ExecutionFilter } from "./utils";

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

type ExecutionTrailPanelProps = {
  filteredExecutions: ToolExecutionRecord[];
  selectedExecutionId: string | null;
  onSelectExecution: (id: string) => void;
  filterText: string;
  onFilterTextChange: (value: string) => void;
  filterToolKey: string;
  onFilterToolKeyChange: (value: string) => void;
  filterState: ExecutionFilter;
  onFilterStateChange: (value: ExecutionFilter) => void;
  tools: ToolRecord[];
};

export function ExecutionTrailPanel({
  filteredExecutions,
  selectedExecutionId,
  onSelectExecution,
  filterText,
  onFilterTextChange,
  filterToolKey,
  onFilterToolKeyChange,
  filterState,
  onFilterStateChange,
  tools,
}: ExecutionTrailPanelProps) {
  const selectedExecution =
    filteredExecutions.find((execution) => execution.id === selectedExecutionId) ??
    filteredExecutions[0] ??
    null;

  return (
    <SurfaceCard
      title="Execution browser"
      description={
        <p>Filter recent runs, then inspect the payloads only for the execution you care about.</p>
      }
      className="stack-md"
    >
      <div
        style={{
          display: "grid",
          gap: 10,
          gridTemplateColumns: "minmax(0, 1.2fr) minmax(180px, 220px) minmax(160px, 180px)",
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
          onChange={(event) => onFilterTextChange(event.target.value)}
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
          onChange={(event) => onFilterToolKeyChange(event.target.value)}
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
          onChange={(event) => onFilterStateChange(event.target.value as ExecutionFilter)}
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
              Widen the filters or pick another tool if you want to inspect older approvals and
              runs.
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
                  onClick={() => onSelectExecution(execution.id)}
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
                      <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: 12 }}>
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
                  <h2 style={{ margin: 0, fontSize: 22 }}>{selectedExecution.toolName}</h2>
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
  );
}
