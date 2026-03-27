"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  DiscordTestMessageResponse,
  EmailTestMessageResponse,
  OutboundChannelKey,
  OutboundChannelStatusResponse,
  SlackTestMessageResponse,
  SmsTestMessageResponse,
} from "@secretary/core-runtime";
import { ActionRow, EmptyState, NoticeBanner, SurfaceCard, ToggleField } from "../lib/ui";

type OutboundChannelDescriptor = {
  key: OutboundChannelKey;
  label: string;
  description: string;
  bestFor: string;
};

type DraftState = {
  enabled: boolean;
  defaultRecipient: string;
  senderLabel: string;
  targetLabel: string;
};

const initialDraft: DraftState = {
  enabled: false,
  defaultRecipient: "",
  senderLabel: "",
  targetLabel: "",
};

function statusTone(status: string | null | undefined) {
  switch (status) {
    case "ok":
      return { label: "ready", color: "var(--success-soft-text)", border: "var(--success-soft-border)" };
    case "degraded":
      return { label: "needs attention", color: "var(--warning-soft-text)", border: "var(--warning-soft-border)" };
    case "disabled":
      return { label: "disabled", color: "var(--neutral-soft-text)", border: "var(--neutral-soft-border)" };
    default:
      return {
        label: status ?? "not configured",
        color: "var(--danger-soft-text)",
        border: "var(--danger-soft-border)",
      };
  }
}

export function OutboundChannelSettings({
  descriptor,
}: {
  descriptor: OutboundChannelDescriptor;
}) {
  const [status, setStatus] = useState<OutboundChannelStatusResponse["integration"] | null>(null);
  const [draft, setDraft] = useState<DraftState>(initialDraft);
  const [testRecipient, setTestRecipient] = useState("");
  const [testSubject, setTestSubject] = useState("");
  const [testText, setTestText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  const tone = statusTone(status?.healthStatus);

  useEffect(() => {
    void refresh();
  }, [descriptor.key]);

  async function refresh() {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/integrations/${descriptor.key}`, {
        cache: "no-store",
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? `Unable to load ${descriptor.label} settings.`);
      }

      const integration = (payload as OutboundChannelStatusResponse).integration;
      setStatus(integration);
      setDraft({
        enabled: integration.enabled,
        defaultRecipient: integration.defaultRecipient ?? "",
        senderLabel: integration.senderIdentity ?? "",
        targetLabel: integration.targetLabel ?? "",
      });
      setTestRecipient((current) => current || integration.defaultRecipient || "");
      setTestSubject("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : `Unable to load ${descriptor.label} settings.`);
    } finally {
      setIsLoading(false);
    }
  }

  async function saveSettings() {
    setIsSaving(true);
    setError(null);
    setNotice(null);

    const body =
      descriptor.key === "email"
        ? {
            enabled: draft.enabled,
            defaultRecipient: draft.defaultRecipient.trim() || null,
          }
        : descriptor.key === "sms"
          ? {
              enabled: draft.enabled,
              defaultRecipient: draft.defaultRecipient.trim() || null,
              senderLabel: draft.senderLabel.trim() || null,
            }
          : {
              enabled: draft.enabled,
              targetLabel: draft.targetLabel.trim() || null,
            };

    try {
      const response = await fetch(`/api/integrations/${descriptor.key}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? `Unable to save ${descriptor.label} settings.`);
      }

      const integration = (payload as OutboundChannelStatusResponse).integration;
      setStatus(integration);
      setNotice(`${descriptor.label} settings saved.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : `Unable to save ${descriptor.label} settings.`);
    } finally {
      setIsSaving(false);
    }
  }

  async function sendTest() {
    setIsTesting(true);
    setError(null);
    setNotice(null);

    const body =
      descriptor.key === "email"
        ? {
            to: testRecipient.trim() || null,
            subject: testSubject.trim() || null,
            text: testText.trim() || null,
          }
        : descriptor.key === "sms"
          ? {
              to: testRecipient.trim() || null,
              text: testText.trim() || null,
            }
          : {
              text: testText.trim() || null,
            };

    try {
      const response = await fetch(`/api/integrations/${descriptor.key}/test-message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? `Unable to send ${descriptor.label} test message.`);
      }

      if (descriptor.key === "email") {
        const result = payload as EmailTestMessageResponse;
        setNotice(
          result.messageId
            ? `Test email sent to ${result.recipient}.`
            : `Test email delivered to ${result.recipient}.`,
        );
      } else if (descriptor.key === "sms") {
        const result = payload as SmsTestMessageResponse;
        setNotice(`Test SMS sent to ${result.recipient}.`);
      } else if (descriptor.key === "slack") {
        const result = payload as SlackTestMessageResponse;
        setNotice(`Test Slack message delivered to ${result.deliveredTo}.`);
      } else {
        const result = payload as DiscordTestMessageResponse;
        setNotice(`Test Discord message delivered to ${result.deliveredTo}.`);
      }

      await refresh();
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : `Unable to send ${descriptor.label} test message.`);
    } finally {
      setIsTesting(false);
    }
  }

  const readiness = useMemo(
    () => [
      {
        label: "Credentials present",
        done: Boolean(status?.envConfigured),
      },
      {
        label: "Channel enabled",
        done: Boolean(draft.enabled),
      },
      {
        label: descriptor.key === "email" || descriptor.key === "sms" ? "Default recipient saved" : "Target labeled",
        done:
          descriptor.key === "email" || descriptor.key === "sms"
            ? Boolean(draft.defaultRecipient.trim())
            : Boolean(draft.targetLabel.trim() || status?.targetLabel),
      },
    ],
    [descriptor.key, draft.defaultRecipient, draft.enabled, draft.targetLabel, status?.envConfigured, status?.targetLabel],
  );

  return (
    <>
      <SurfaceCard
        tone="dark"
        title={descriptor.label}
        description={<p>{descriptor.description}</p>}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 16,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <div className="persona-summary-strip">
            {[
              ["Health", status?.healthStatus ?? (isLoading ? "loading" : "unknown")],
              ["Provider", status?.providerLabel ?? "Waiting for worker"],
              ["Target", status?.targetLabel ?? status?.defaultRecipient ?? "not set"],
              ["Sender", status?.senderIdentity ?? "n/a"],
            ].map(([label, value]) => (
              <div key={String(label)} className="persona-summary-item">
                <span className="summary-chip-label" style={{ whiteSpace: "nowrap", fontSize: 9 }}>
                  {label}
                </span>
                <span className="summary-chip-value" style={{ fontSize: 12 }}>
                  {value}
                </span>
              </div>
            ))}
          </div>

          <div className="persona-action-cluster">
            <div
              className="pill"
              style={{ borderColor: tone.border, color: tone.color, minWidth: 180, justifyContent: "center" }}
            >
              {descriptor.label}: {isLoading ? "loading" : tone.label}
            </div>
            <button type="button" onClick={() => void refresh()} className="button-secondary">
              {isLoading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.55 }}>
          {error ??
            notice ??
            (isLoading ? `Loading ${descriptor.label} channel...` : status?.healthSummary ?? `${descriptor.label} channel ready.`)}
        </p>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 12, lineHeight: 1.5 }}>
          Best for: {descriptor.bestFor}
        </p>
      </SurfaceCard>

      {error ? <NoticeBanner tone="error">{error}</NoticeBanner> : null}
      {!error && notice ? <NoticeBanner tone="info">{notice}</NoticeBanner> : null}

      <section style={{ display: "grid", gap: 20, gridTemplateColumns: "minmax(0, 1.45fr) minmax(320px, 0.95fr)" }}>
        <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
          <SurfaceCard
            title={`${descriptor.label} settings`}
            description={<p>{status?.healthSummary ?? `Loading ${descriptor.label} integration health...`}</p>}
            className="stack-md"
          >
            <ActionRow align="between">
              <ToggleField
                checked={draft.enabled}
                onChange={(next) => setDraft((current) => ({ ...current, enabled: next }))}
                label={`Enable ${descriptor.label}`}
                hint="Credentials stay in the local environment. This page controls runtime behavior and test routing."
              />
              <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
                Keep each channel focused: one setup surface, one test path, one place to see readiness.
              </p>
            </ActionRow>

            {(descriptor.key === "discord" || descriptor.key === "slack") ? (
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: "var(--muted)", fontSize: 13 }}>Target label for this webhook</span>
                <input
                  value={draft.targetLabel}
                  onChange={(event) => setDraft((current) => ({ ...current, targetLabel: event.target.value }))}
                  placeholder={descriptor.key === "discord" ? "#secretary-updates" : "#ops-secretary"}
                />
              </label>
            ) : (
              <>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ color: "var(--muted)", fontSize: 13 }}>Default recipient</span>
                  <input
                    value={draft.defaultRecipient}
                    onChange={(event) => setDraft((current) => ({ ...current, defaultRecipient: event.target.value }))}
                    placeholder={descriptor.key === "email" ? "name@example.com" : "+15555551234"}
                  />
                </label>

                {descriptor.key === "email" ? null : (
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ color: "var(--muted)", fontSize: 13 }}>Sender label</span>
                    <input
                      value={draft.senderLabel}
                      onChange={(event) => setDraft((current) => ({ ...current, senderLabel: event.target.value }))}
                      placeholder="Secretary alerts"
                    />
                  </label>
                )}
              </>
            )}

            <div className="section-rule" />

            <div style={{ display: "grid", gap: 10 }}>
              <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
                Quick outbound test
              </p>
              {descriptor.key === "email" || descriptor.key === "sms" ? (
                <input
                  value={testRecipient}
                  onChange={(event) => setTestRecipient(event.target.value)}
                  placeholder={descriptor.key === "email" ? "Override recipient email" : "Override recipient number"}
                />
              ) : null}
              {descriptor.key === "email" ? (
                <input
                  value={testSubject}
                  onChange={(event) => setTestSubject(event.target.value)}
                  placeholder="Optional custom test subject"
                />
              ) : null}
              <textarea
                value={testText}
                onChange={(event) => setTestText(event.target.value)}
                rows={3}
                placeholder={`Optional custom ${descriptor.label.toLowerCase()} test message`}
              />
              <p style={{ margin: 0, color: "var(--muted)", fontSize: 12, lineHeight: 1.5 }}>
                {descriptor.key === "email"
                  ? "Emails send through Resend using the from-address in your local environment."
                  : descriptor.key === "sms"
                    ? "SMS sends through Twilio using the configured sender number in your local environment."
                    : `Messages send through the saved ${descriptor.label.toLowerCase()} webhook in your local environment.`}
              </p>
            </div>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button type="button" onClick={() => void saveSettings()} disabled={isSaving} className="button-primary" style={{ opacity: isSaving ? 0.7 : 1 }}>
                {isSaving ? "Saving..." : "Save Settings"}
              </button>
              <button type="button" onClick={() => void sendTest()} disabled={isTesting} className="button-secondary" style={{ opacity: isTesting ? 0.7 : 1 }}>
                {isTesting ? "Sending..." : `Send Test ${descriptor.label}`}
              </button>
            </div>
          </SurfaceCard>
        </div>

        <aside style={{ display: "grid", gap: 20, alignContent: "start" }}>
          <SurfaceCard
            title="Readiness"
            description={<p>Credentials, routing, and sender identity in one compact view.</p>}
            className="stack-md"
          >
            <div className="compact-list">
              {readiness.map((entry) => (
                <div key={entry.label} style={{ display: "flex", justifyContent: "space-between", gap: 12, color: "var(--muted)", padding: "9px 0" }}>
                  <span>{entry.label}</span>
                  <strong style={{ color: entry.done ? "var(--success-soft-text)" : "var(--warning-soft-text)" }}>
                    {entry.done ? "ready" : "missing"}
                  </strong>
                </div>
              ))}
            </div>
            <div className="section-rule" />
            <p style={{ margin: 0, color: "var(--muted)" }}>
              Provider: <strong style={{ color: "var(--text)" }}>{status?.providerLabel ?? "n/a"}</strong>
            </p>
            <p style={{ margin: 0, color: "var(--muted)" }}>
              Sender: <strong style={{ color: "var(--text)" }}>{status?.senderIdentity ?? "n/a"}</strong>
            </p>
            <p style={{ margin: 0, color: "var(--muted)" }}>
              Target: <strong style={{ color: "var(--text)" }}>{status?.targetLabel ?? status?.defaultRecipient ?? "not set"}</strong>
            </p>
            <p style={{ margin: 0, color: "var(--muted)" }}>
              Last check: <strong style={{ color: "var(--text)" }}>{status?.lastCheckedAt ?? "n/a"}</strong>
            </p>
            {status?.lastError ? (
              <NoticeBanner tone="warning">{status.lastError}</NoticeBanner>
            ) : (
              <EmptyState
                title={`${descriptor.label} is staged cleanly`}
                description={
                  <p>
                    Keep credentials in the environment, use this tab for enablement and routing, and use the test button any time you want a quick confidence check.
                  </p>
                }
                tone="warm"
              />
            )}
          </SurfaceCard>
        </aside>
      </section>
    </>
  );
}
