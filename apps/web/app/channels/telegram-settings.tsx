"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type {
  ConversationListItem,
  ConversationListResponse,
  TaskListResponse,
  TaskRecord,
  TelegramIntegrationStatusResponse,
  TelegramReminderDispatchResponse,
  TelegramSyncWebhookResponse,
  TelegramTestMessageResponse,
} from "@secretary/core-runtime";
import { ActionRow, AppPage, EmptyState, NoticeBanner, SurfaceCard, ToggleField } from "../lib/ui";
import { formatTimestamp, snippet } from "../lib/presenters";

type DraftState = {
  deliveryMode: "web_only" | "mirror_all" | "telegram_when_away" | "important_only";
  enabled: boolean;
  idleTimeoutMinutes: number;
  mode: "webhook" | "polling";
  webhookUrl: string;
  defaultChatId: string;
};

type PageState = {
  telegram: TelegramIntegrationStatusResponse["integration"] | null;
  conversations: ConversationListItem[];
  tasks: TaskRecord[];
};

function statusTone(status: string | null | undefined) {
  switch (status) {
    case "ok":
      return { label: "healthy", color: "var(--success-soft-text)", border: "var(--success-soft-border)" };
    case "degraded":
      return { label: "needs attention", color: "var(--warning-soft-text)", border: "var(--warning-soft-border)" };
    case "disabled":
      return { label: "disabled", color: "var(--neutral-soft-text)", border: "var(--neutral-soft-border)" };
    default:
      return { label: status ?? "not configured", color: "var(--danger-soft-text)", border: "var(--danger-soft-border)" };
  }
}

function describeReminder(task: TaskRecord) {
  if (task.lastDeliveryError) {
    return {
      label: "failed",
      detail: task.lastDeliveryError,
      color: "var(--danger-soft-text)",
    };
  }

  if (task.deliveredAt) {
    return {
      label: "delivered",
      detail: `Delivered ${formatTimestamp(task.deliveredAt)}`,
      color: "var(--success-soft-text)",
    };
  }

  if (task.reminderAt) {
    return {
      label: "scheduled",
      detail: `Due ${formatTimestamp(task.reminderAt)}`,
      color: "var(--accent)",
    };
  }

  return {
    label: "queued",
    detail: "Waiting for a reminder timestamp.",
    color: "var(--neutral-soft-text)",
  };
}

export function TelegramSettings() {
  const [state, setState] = useState<PageState>({
    telegram: null,
    conversations: [],
    tasks: [],
  });
  const [draft, setDraft] = useState<DraftState>({
    deliveryMode: "web_only",
    enabled: false,
    idleTimeoutMinutes: 15,
    mode: "polling",
    webhookUrl: "",
    defaultChatId: "",
  });
  const [testChatId, setTestChatId] = useState("");
  const [testText, setTestText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isDispatching, setIsDispatching] = useState(false);

  useEffect(() => {
    void refresh();
  }, []);

  const telegramConversations = useMemo(
    () => state.conversations.filter((entry) => entry.channelType === "telegram").slice(0, 6),
    [state.conversations],
  );
  const telegramTasks = useMemo(
    () => state.tasks.filter((entry) => entry.deliveryChannelType === "telegram" || Boolean(entry.deliveryTargetRef)).slice(0, 8),
    [state.tasks],
  );

  async function refresh() {
    setIsLoading(true);
    setError(null);

    try {
      const [telegramResponse, conversationsResponse, tasksResponse] = await Promise.all([
        fetch("/api/integrations/telegram", { cache: "no-store" }),
        fetch("/api/conversations", { cache: "no-store" }),
        fetch("/api/tasks", { cache: "no-store" }),
      ]);

      const [telegramPayload, conversationsPayload, tasksPayload] = await Promise.all([
        telegramResponse.json(),
        conversationsResponse.json(),
        tasksResponse.json(),
      ]);

      if (!telegramResponse.ok) {
        throw new Error(telegramPayload.error ?? "Unable to load Telegram status.");
      }

      if (!conversationsResponse.ok) {
        throw new Error(conversationsPayload.error ?? "Unable to load conversations.");
      }

      if (!tasksResponse.ok) {
        throw new Error(tasksPayload.error ?? "Unable to load tasks.");
      }

      const telegram = (telegramPayload as TelegramIntegrationStatusResponse).integration;

      setState({
        telegram,
        conversations: (conversationsPayload as ConversationListResponse).conversations,
        tasks: (tasksPayload as TaskListResponse).tasks,
      });
      setDraft({
        deliveryMode: telegram.deliveryMode,
        enabled: telegram.enabled,
        idleTimeoutMinutes: telegram.idleTimeoutMinutes,
        mode: telegram.mode,
        webhookUrl: telegram.desiredWebhookUrl ?? "",
        defaultChatId: telegram.defaultChatId ?? "",
      });
      setTestChatId((current) => current || telegram.defaultChatId || "");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load Telegram status.");
    } finally {
      setIsLoading(false);
    }
  }

  async function saveSettings() {
    setIsSaving(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch("/api/integrations/telegram", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: draft.enabled,
          deliveryMode: draft.deliveryMode,
          idleTimeoutMinutes: draft.idleTimeoutMinutes,
          mode: draft.mode,
          webhookUrl: draft.webhookUrl.trim() || null,
          defaultChatId: draft.defaultChatId.trim() || null,
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to save Telegram settings.");
      }

      setState((current) => ({
        ...current,
        telegram: (payload as TelegramIntegrationStatusResponse).integration,
      }));
      setNotice("Telegram settings saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save Telegram settings.");
    } finally {
      setIsSaving(false);
    }
  }

  async function syncWebhook() {
    setIsSyncing(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch("/api/integrations/telegram/sync-webhook", { method: "POST" });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to sync webhook.");
      }

      const result = payload as TelegramSyncWebhookResponse;
      setNotice(
        draft.mode === "polling"
          ? "Polling mode applied. Telegram inbound now comes from local long-polling."
          : result.webhookUrl
            ? `Webhook synced to ${result.webhookUrl}.`
            : "Webhook removed because Telegram is disabled.",
      );
      await refresh();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Unable to sync webhook.");
    } finally {
      setIsSyncing(false);
    }
  }

  async function sendTestMessage() {
    setIsTesting(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch("/api/integrations/telegram/test-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId: testChatId.trim() || null,
          text: testText.trim() || null,
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to send test message.");
      }

      const result = payload as TelegramTestMessageResponse;
      setNotice(`Test message sent to ${result.chatId} as ${result.sentMessageIds.length} chunk${result.sentMessageIds.length === 1 ? "" : "s"}.`);
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : "Unable to send test message.");
    } finally {
      setIsTesting(false);
    }
  }

  async function dispatchReminders() {
    setIsDispatching(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch("/api/integrations/telegram/deliver-reminders", { method: "POST" });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to deliver reminders.");
      }

      const result = payload as TelegramReminderDispatchResponse;
      setNotice(`Reminder dispatch scanned ${result.scanned}, delivered ${result.delivered}, failed ${result.failed}.`);
      await refresh();
    } catch (dispatchError) {
      setError(dispatchError instanceof Error ? dispatchError.message : "Unable to deliver reminders.");
    } finally {
      setIsDispatching(false);
    }
  }

  const tone = statusTone(state.telegram?.healthStatus);
  const readiness = [
    { label: "Bot token in environment", done: Boolean(state.telegram?.envConfigured) },
    { label: "Bot identity resolves", done: Boolean(state.telegram?.botConfigured) },
    { label: "Integration enabled", done: Boolean(state.telegram?.enabled) },
    { label: draft.mode === "polling" ? "Polling selected" : "Webhook target saved", done: draft.mode === "polling" ? true : Boolean(state.telegram?.desiredWebhookUrl) },
    { label: "Fallback chat id set", done: Boolean(state.telegram?.defaultChatId) },
  ];

  return (
    <AppPage>
      <SurfaceCard
        tone="dark"
        title="Channels"
        description={<p>Keep Telegram setup, delivery behavior, and follow-through in one quieter control surface.</p>}
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
              ["Health", state.telegram?.healthStatus ?? (isLoading ? "loading" : "unknown")],
              ["Mode", state.telegram?.mode ?? draft.mode],
              [
                "Delivery",
                draft.deliveryMode === "mirror_all"
                  ? "mirror"
                  : draft.deliveryMode === "telegram_when_away"
                    ? "when away"
                    : draft.deliveryMode === "important_only"
                      ? "important only"
                      : "web only",
              ],
              ["Conversations", String(state.telegram?.conversationCount ?? 0)],
              ["Due", String(state.telegram?.dueReminderCount ?? 0)],
            ].map(([label, value], index) => (
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
              Telegram: {isLoading ? "loading" : tone.label}
            </div>
            <button type="button" onClick={() => void refresh()} className="button-secondary">
              {isLoading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.55 }}>
          {error ??
            notice ??
            (isLoading ? "Loading Telegram workspace..." : state.telegram?.healthSummary ?? "Telegram integration ready.")}
        </p>
      </SurfaceCard>

      {error ? <NoticeBanner tone="error">{error}</NoticeBanner> : null}
      {!error && notice ? <NoticeBanner tone="info">{notice}</NoticeBanner> : null}

      <section style={{ display: "grid", gap: 20, gridTemplateColumns: "minmax(0, 1.45fr) minmax(320px, 0.95fr)" }}>
          <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
            <SurfaceCard title="Telegram settings" description={<p>{state.telegram?.healthSummary ?? "Loading Telegram integration health..."}</p>} className="stack-md">
              <ActionRow align="between">
                <ToggleField
                  checked={draft.enabled}
                  onChange={(next) => setDraft((current) => ({ ...current, enabled: next }))}
                  label="Enable Telegram integration"
                  hint="Turns the Telegram channel on or off without changing the saved bot token."
                />
                <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
                  Keep Telegram setup here, then use the status card for runtime context.
                </p>
              </ActionRow>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: "var(--muted)", fontSize: 13 }}>Inbound transport mode</span>
                <select
                  value={draft.mode}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      mode: event.target.value as "webhook" | "polling",
                    }))
                  }
                >
                  <option value="polling">Polling (best for local computer use)</option>
                  <option value="webhook">Webhook / tunnel (best for public worker URLs)</option>
                </select>
              </label>

              {draft.mode === "webhook" ? (
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ color: "var(--muted)", fontSize: 13 }}>Public worker URL or full webhook URL</span>
                  <input
                    value={draft.webhookUrl}
                    onChange={(event) => setDraft((current) => ({ ...current, webhookUrl: event.target.value }))}
                    placeholder="https://your-worker-host.example.com"
                  />
                </label>
              ) : (
                <div className="notice-banner notice-banner--info">
                  Polling mode keeps Telegram inbound local. No public worker URL is required.
                </div>
              )}

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: "var(--muted)", fontSize: 13 }}>Default Telegram chat id for tests and fallback reminders</span>
                <input
                  value={draft.defaultChatId}
                  onChange={(event) => setDraft((current) => ({ ...current, defaultChatId: event.target.value }))}
                  placeholder="123456789"
                />
              </label>

              <div className="section-rule" />

              <div style={{ display: "grid", gap: 12 }}>
                <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
                  Outbound delivery policy
                </p>

                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ color: "var(--muted)", fontSize: 13 }}>How the secretary should reach you</span>
                  <select
                    value={draft.deliveryMode}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        deliveryMode: event.target.value as DraftState["deliveryMode"],
                      }))
                    }
                  >
                    <option value="web_only">Web only</option>
                    <option value="mirror_all">Mirror every secretary reply to Telegram</option>
                    <option value="telegram_when_away">Send to Telegram when the Desk has gone idle</option>
                    <option value="important_only">Telegram only for approvals, heartbeat, and important items</option>
                  </select>
                </label>

                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ color: "var(--muted)", fontSize: 13 }}>Desk idle timeout before Telegram takes over</span>
                  <input
                    type="number"
                    min={1}
                    max={480}
                    value={draft.idleTimeoutMinutes}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        idleTimeoutMinutes: Number(event.target.value) || 15,
                      }))
                    }
                  />
                </label>
                <p style={{ margin: 0, color: "var(--muted)", fontSize: 12, lineHeight: 1.5 }}>
                  The Desk reports light presence while it is open and visible. In <strong style={{ color: "var(--text)" }}>when away</strong> mode,
                  The secretary mirrors replies to Telegram after that idle window passes.
                </p>
              </div>

              <div className="section-rule" />

              <div style={{ display: "grid", gap: 10 }}>
                <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
                  Quick outbound test
                </p>
                <input
                  value={testChatId}
                  onChange={(event) => setTestChatId(event.target.value)}
                  placeholder="Test chat id"
                />
                <textarea
                  value={testText}
                  onChange={(event) => setTestText(event.target.value)}
                  rows={3}
                  placeholder="Optional custom test message"
                />
              </div>

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <button type="button" onClick={() => void saveSettings()} disabled={isSaving} className="button-primary" style={{ opacity: isSaving ? 0.7 : 1 }}>
                  {isSaving ? "Saving..." : "Save Settings"}
                </button>
                <button type="button" onClick={() => void syncWebhook()} disabled={isSyncing} className="button-secondary" style={{ opacity: isSyncing ? 0.7 : 1 }}>
                  {isSyncing ? "Applying..." : draft.mode === "polling" ? "Apply Polling" : "Sync Webhook"}
                </button>
                <button type="button" onClick={() => void dispatchReminders()} disabled={isDispatching} className="button-secondary" style={{ opacity: isDispatching ? 0.7 : 1 }}>
                  {isDispatching ? "Dispatching..." : "Deliver Due Reminders"}
                </button>
                <button type="button" onClick={() => void sendTestMessage()} disabled={isTesting} className="button-secondary" style={{ opacity: isTesting ? 0.7 : 1 }}>
                  {isTesting ? "Sending..." : "Send Test Message"}
                </button>
              </div>

              <div className="notice-banner notice-banner--info">
                {error ?? notice ?? "The bot token stays in your local environment. This page only manages runtime state and webhook-facing configuration."}
              </div>
            </SurfaceCard>

          </div>

          <aside style={{ display: "grid", gap: 20, alignContent: "start" }}>
            <SurfaceCard
              title="Status and delivery"
              description={<p>Connection health, due reminders, and recent Telegram traffic in one compact column.</p>}
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
                Mode: <strong style={{ color: "var(--text)" }}>{state.telegram?.mode ?? draft.mode}</strong>
              </p>
              <p style={{ margin: 0, color: "var(--muted)" }}>
                Bot user: <strong style={{ color: "var(--text)" }}>{state.telegram?.botUser?.displayName ?? "not resolved yet"}</strong>
              </p>
              <p style={{ margin: 0, color: "var(--muted)" }}>
                Username: <strong style={{ color: "var(--text)" }}>{state.telegram?.botUser?.username ?? "n/a"}</strong>
              </p>
              <p style={{ margin: 0, color: "var(--muted)" }}>
                Pending updates: <strong style={{ color: "var(--text)" }}>{state.telegram?.pendingUpdateCount ?? "n/a"}</strong>
              </p>
              <p style={{ margin: 0, color: "var(--muted)" }}>
                Delivery: <strong style={{ color: "var(--text)" }}>
                  {state.telegram?.deliveryMode === "mirror_all"
                    ? "Mirror every reply"
                    : state.telegram?.deliveryMode === "telegram_when_away"
                      ? "Send when away"
                      : state.telegram?.deliveryMode === "important_only"
                        ? "Important only"
                        : "Web only"}
                </strong>
              </p>
              <p style={{ margin: 0, color: "var(--muted)" }}>
                Desk last seen: <strong style={{ color: "var(--text)" }}>{formatTimestamp(state.telegram?.lastWebPresenceAt ?? null)}</strong>
              </p>
              <p style={{ margin: 0, color: "var(--muted)" }}>
                Last check: <strong style={{ color: "var(--text)" }}>{formatTimestamp(state.telegram?.lastCheckedAt ?? null)}</strong>
              </p>
              {state.telegram?.mode === "webhook" ? (
                <>
                  <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.6 }}>
                    Saved target: {state.telegram?.desiredWebhookUrl ?? "not set"}
                  </p>
                  <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.6 }}>
                    Healthy target: {state.telegram?.webhookUrl ?? "not synced"}
                  </p>
                </>
              ) : (
                <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.6 }}>
                  Polling mode is active, so no webhook target is needed.
                </p>
              )}
              {state.telegram?.lastError ? (
                <p style={{ margin: 0, color: "var(--danger)", lineHeight: 1.6 }}>
                  Last Telegram error: {state.telegram.lastError}
                </p>
              ) : null}
              <div className="section-rule" />
              <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
                <h3 style={{ margin: 0, fontSize: 16 }}>Reminder queue</h3>
                <Link href="/activity/tasks" style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 700 }}>
                  Open tasks
                </Link>
              </div>
              {telegramTasks.length === 0 ? (
                <EmptyState
                  title="No Telegram reminder tasks yet"
                  description={<p>Due reminders and queued follow-through for Telegram will appear here once they exist.</p>}
                />
              ) : (
                <div className="compact-list">
                  {telegramTasks.map((task) => {
                    const reminder = describeReminder(task);

                    return (
                      <div key={task.id} style={{ display: "grid", gap: 6, padding: "12px 0" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                          <p style={{ margin: 0, fontWeight: 700 }}>{task.title}</p>
                          <span style={{ color: reminder.color, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                            {reminder.label}
                          </span>
                        </div>
                        <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.5 }}>
                          {task.detail ?? "No extra reminder detail."}
                        </p>
                        <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>{reminder.detail}</p>
                        <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
                          target chat {task.deliveryTargetRef ?? state.telegram?.defaultChatId ?? "n/a"}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="section-rule" />
              <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
                <h3 style={{ margin: 0, fontSize: 16 }}>Recent Telegram conversations</h3>
                <Link href="/activity" style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 700 }}>
                  Open activity
                </Link>
              </div>

              {telegramConversations.length === 0 ? (
                <EmptyState
                  title="No Telegram conversations yet"
                  description={<p>Once Telegram becomes active, recent channel threads will appear here for quick inspection.</p>}
                />
              ) : (
                <div className="compact-list">
                  {telegramConversations.map((conversation) => (
                    <div key={conversation.id} style={{ display: "grid", gap: 6, padding: "12px 0" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                        <p style={{ margin: 0, fontWeight: 700 }}>{conversation.title ?? "Telegram conversation"}</p>
                        <span style={{ color: "var(--accent-strong)", fontSize: 12, fontWeight: 700 }}>
                          {conversation.messageCount} messages
                        </span>
                      </div>
                      <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.5 }}>
                        {snippet(conversation.lastMessagePreview, 140)}
                      </p>
                      <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
                        Last activity {formatTimestamp(conversation.lastMessageAt)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </SurfaceCard>
          </aside>
        </section>
    </AppPage>
  );
}
