"use client";

import type { ToolExecutionRecord, ToolRecord } from "@secretary/core-runtime";
import { snippet } from "../../lib/presenters";
import { ActionRow, SurfaceCard } from "../../lib/ui";

type ToolNavigatorProps = {
  pending: ToolExecutionRecord[];
  decisionId: string | null;
  decide: (executionId: string, approve: boolean) => void;
  load: () => void;
  groupedTools: Array<{ group: string; tools: ToolRecord[] }>;
  selectedToolId: string | null;
  onSelectTool: (id: string) => void;
};

export function ToolNavigator({
  pending,
  decisionId,
  decide,
  load,
  groupedTools,
  selectedToolId,
  onSelectTool,
}: ToolNavigatorProps) {
  return (
    <aside className="inspector-sidebar">
      <SurfaceCard
        tone="dark"
        title="Tool navigator"
        description={
          <p>
            Pick a capability group, inspect one tool policy, and keep approvals in the same lane.
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
                    <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>{execution.toolName}</p>
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
                  onClick={() => onSelectTool(tool.id)}
                  className="inspector-list-row"
                  style={{
                    textAlign: "left",
                    border:
                      selectedToolId === tool.id
                        ? "1px solid rgba(164, 141, 100, 0.26)"
                        : "1px solid rgba(196, 180, 154, 0.12)",
                    background:
                      selectedToolId === tool.id
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
                      <p style={{ margin: 0, color: "var(--muted)", fontSize: 12 }}>{tool.key}</p>
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
  );
}
