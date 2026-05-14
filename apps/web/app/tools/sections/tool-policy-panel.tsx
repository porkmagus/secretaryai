"use client";

import type { ToolApprovalMode, ToolRecord } from "@secretary/core-runtime";
import { formatTimestamp } from "../../lib/presenters";
import { ActionRow, SurfaceCard, ToggleField } from "../../lib/ui";
import type { EditableTool } from "./utils";
import { toolGroupLabel } from "./utils";

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

type ToolPolicyPanelProps = {
  selectedTool: ToolRecord;
  selectedDraft: EditableTool;
  dirtyToolIds: string[];
  savingToolId: string | null;
  onApprovalModeChange: (mode: ToolApprovalMode) => void;
  onEnabledChange: (enabled: boolean) => void;
  onSave: () => void;
};

export function ToolPolicyPanel({
  selectedTool,
  selectedDraft,
  dirtyToolIds,
  savingToolId,
  onApprovalModeChange,
  onEnabledChange,
  onSave,
}: ToolPolicyPanelProps) {
  return (
    <>
      <SurfaceCard
        tone="dark"
        title="Selected tool"
        description={
          <p>
            Edit the live policy here, then drop into execution history only when you need the audit
            trail.
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
              <p className="desk-live-chip-value">{formatTimestamp(selectedTool.updatedAt)}</p>
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
            onChange={(event) => onApprovalModeChange(event.target.value as ToolApprovalMode)}
          >
            <option value="always_allow">Always allow</option>
            <option value="ask_first">Ask first</option>
            <option value="deny">Deny</option>
          </select>

          <ToggleField
            checked={selectedDraft.enabled}
            onChange={onEnabledChange}
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
            onClick={onSave}
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
    </>
  );
}
