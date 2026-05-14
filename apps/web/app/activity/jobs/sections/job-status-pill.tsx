import type { AgentJobArtifactRecord } from "@secretary/core-runtime";

function statusTone(status: string) {
  if (status === "completed") {
    return {
      background: "var(--success-soft-bg)",
      border: "var(--success-soft-border)",
      text: "var(--success-soft-text)",
    };
  }

  if (status === "failed" || status === "blocked" || status === "waiting_for_runtime") {
    return {
      background: "var(--danger-soft-bg)",
      border: "var(--danger-soft-border)",
      text: "var(--danger-soft-text)",
    };
  }

  if (
    status === "running" ||
    status === "ready" ||
    status === "planning" ||
    status === "retrying"
  ) {
    return {
      background: "var(--warning-soft-bg)",
      border: "var(--warning-soft-border)",
      text: "var(--warning-soft-text)",
    };
  }

  return {
    background: "var(--neutral-soft-bg)",
    border: "var(--neutral-soft-border)",
    text: "var(--neutral-soft-text)",
  };
}

export function JobStatusPill({ status }: { status: string }) {
  const tone = statusTone(status);

  return (
    <span
      style={{
        padding: "4px 9px",
        borderRadius: 999,
        background: tone.background,
        border: `1px solid ${tone.border}`,
        color: tone.text,
        fontSize: 11,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
      }}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}

export function ArtifactContent({ artifact }: { artifact: AgentJobArtifactRecord }) {
  return (
    <pre
      style={{
        fontSize: 12,
        lineHeight: 1.55,
        color: "var(--muted)",
      }}
    >
      {artifact.contentText}
    </pre>
  );
}
