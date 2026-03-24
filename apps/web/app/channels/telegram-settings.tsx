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
import { AppPage, NoticeBanner, PageHero, StatCard, StatGrid, SurfaceCard } from "../lib/ui";
import { formatTimestamp, snippet } from "../lib/presenters";

type DraftState = {
  enabled: boolean;
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
    enabled: false,
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
        enabled: telegram.enabled,
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
      setNotice(result.webhookUrl ? `Webhook synced to ${result.webhookUrl}.` : "Webhook removed because Telegram is disabled.");
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
    { label: "Webhook target saved", done: Boolean(state.telegram?.desiredWebhookUrl) },
    { label: "Fallback chat id set", done: Boolean(state.telegram?.defaultChatId) },
  ];

  return (
    <AppPage>
      <PageHero
        eyebrow="Channels"
        title="Telegram integration"
        description={
          <p>
            Operate the live Telegram channel, verify webhook health, test outbound
            delivery, and keep an eye on routed chats and reminder delivery from one surface.
          </p>
        }
        meta={
          <p>
            {error ?? notice ?? (isLoading ? "Loading Telegram workspace..." : state.telegram?.healthSummary ?? "Telegram integration ready.")}
          </p>
        }
        actions={
          <div className="pill" style={{ borderColor: tone.border, color: tone.color, minWidth: 220, justifyContent: "center" }}>
            Telegram status: {isLoading ? "loading" : tone.label}
          </div>
        }
      />

      <StatGrid>
        {[
          { label: "Health", value: state.telegram?.healthStatus ?? (isLoading ? "loading" : "unknown") },
          { label: "Telegram conversations", value: String(state.telegram?.conversationCount ?? 0) },
          { label: "Telegram messages", value: String(state.telegram?.messageCount ?? 0) },
          { label: "Due reminders", value: String(state.telegram?.dueReminderCount ?? 0) },
        ].map((card) => (
          <StatCard key={card.label} label={card.label} value={card.value} detail="Current integration snapshot" />
        ))}
      </StatGrid>

      {error ? <NoticeBanner tone="error">{error}</NoticeBanner> : null}
      {!error && notice ? <NoticeBanner tone="info">{notice}</NoticeBanner> : null}

      <section style={{ display: "grid", gap: 20, gridTemplateColumns: "minmax(0, 1.45fr) minmax(320px, 0.95fr)" }}>
          <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
            <SurfaceCard title="Integration settings" description={<p>{state.telegram?.healthSummary ?? "Loading Telegram integration health..."}</p>} className="stack-md">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
                <button type="button" onClick={() => void refresh()} className="button-secondary">
                  Refresh
                </button>
              </div>

              <label style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--text)", fontWeight: 600 }}>
                <input checked={draft.enabled} onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))} type="checkbox" />
                Enable Telegram integration
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: "var(--muted)", fontSize: 13 }}>Public worker URL or full webhook URL</span>
                <input
                  value={draft.webhookUrl}
                  onChange={(event) => setDraft((current) => ({ ...current, webhookUrl: event.target.value }))}
                  placeholder="https://your-worker-host.example.com"
                />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: "var(--muted)", fontSize: 13 }}>Default Telegram chat id for tests and fallback reminders</span>
                <input
                  value={draft.defaultChatId}
                  onChange={(event) => setDraft((current) => ({ ...current, defaultChatId: event.target.value }))}
                  placeholder="123456789"
                />
              </label>

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <button type="button" onClick={() => void saveSettings()} disabled={isSaving} className="button-primary" style={{ opacity: isSaving ? 0.7 : 1 }}>
                  {isSaving ? "Saving..." : "Save Settings"}
                </button>
                <button type="button" onClick={() => void syncWebhook()} disabled={isSyncing} className="button-secondary" style={{ opacity: isSyncing ? 0.7 : 1 }}>
                  {isSyncing ? "Syncing..." : "Sync Webhook"}
                </button>
                <button type="button" onClick={() => void dispatchReminders()} disabled={isDispatching} className="button-secondary" style={{ opacity: isDispatching ? 0.7 : 1 }}>
                  {isDispatching ? "Dispatching..." : "Deliver Due Reminders"}
                </button>
              </div>

              <div className="notice-banner notice-banner--info">
                {error ?? notice ?? "The bot token stays in your local environment. This page only manages runtime state and webhook-facing configuration."}
              </div>
            </SurfaceCard>

            <SurfaceCard title="Outbound test" description={<p>Send a real Telegram message without waiting for an inbound webhook event.</p>} className="stack-md">
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
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <button type="button" onClick={() => void sendTestMessage()} disabled={isTesting} className="button-secondary" style={{ opacity: isTesting ? 0.7 : 1 }}>
                  {isTesting ? "Sending..." : "Send Test Message"}
                </button>
                <button type="button" onClick={() => setTestText("Secretary test: live outbound Telegram delivery is working from the Channels page.")} className="button-secondary">
                  Fill Sample
                </button>
              </div>
            </SurfaceCard>

            <SurfaceCard
              title="Recent Telegram conversations"
              description={<p>Quick visibility into chats already routed into the shared memory core.</p>}
              className="stack-md"
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
                <Link href="/activity" style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 700 }}>
                  Open Activity
                </Link>
              </div>

              {telegramConversations.length === 0 ? (
                <p style={{ margin: 0, color: "var(--muted)" }}>No Telegram conversations have been recorded yet.</p>
              ) : (
                telegramConversations.map((conversation) => (
                  <article key={conversation.id} style={{ padding: 14, borderRadius: 18, border: "1px solid rgba(64, 89, 112, 0.12)", background: "rgba(255, 255, 255, 0.68)", display: "grid", gap: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                      <p style={{ margin: 0, fontWeight: 700 }}>{conversation.title ?? "Telegram conversation"}</p>
                      <span style={{ padding: "4px 8px", borderRadius: 999, background: "rgba(15, 118, 110, 0.08)", color: "var(--accent)", fontSize: 12, fontWeight: 700 }}>
                        {conversation.messageCount} messages
                      </span>
                    </div>
                    <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.5 }}>
                      {snippet(conversation.lastMessagePreview, 140)}
                    </p>
                    <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
                      Last activity {formatTimestamp(conversation.lastMessageAt)}
                    </p>
                  </article>
                ))
              )}
            </SurfaceCard>
          </div>

          <aside style={{ display: "grid", gap: 20, alignContent: "start" }}>
            <SurfaceCard title="Readiness checklist" className="stack-sm">
              {readiness.map((entry) => (
                <div key={entry.label} style={{ display: "flex", justifyContent: "space-between", gap: 12, color: "var(--muted)" }}>
                  <span>{entry.label}</span>
                  <strong style={{ color: entry.done ? "var(--success)" : "var(--danger)" }}>
                    {entry.done ? "ready" : "missing"}
                  </strong>
                </div>
              ))}
            </SurfaceCard>

            <SurfaceCard title="Current bot state" className="stack-sm">
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
                Last check: <strong style={{ color: "var(--text)" }}>{formatTimestamp(state.telegram?.lastCheckedAt ?? null)}</strong>
              </p>
            </SurfaceCard>

            <SurfaceCard title="Webhook" className="stack-sm">
              <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.6 }}>
                Saved target: {state.telegram?.desiredWebhookUrl ?? "not set"}
              </p>
              <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.6 }}>
                Healthy target: {state.telegram?.webhookUrl ?? "not synced"}
              </p>
              {state.telegram?.lastError ? (
                <p style={{ margin: 0, color: "var(--danger)", lineHeight: 1.6 }}>
                  Last Telegram error: {state.telegram.lastError}
                </p>
              ) : null}
            </SurfaceCard>

            <SurfaceCard title="Reminder delivery queue" className="stack-md">
              {telegramTasks.length === 0 ? (
                <p style={{ margin: 0, color: "var(--muted)" }}>No Telegram reminder tasks are visible yet.</p>
              ) : (
                telegramTasks.map((task) => {
                  const reminder = describeReminder(task);

                  return (
                    <article key={task.id} style={{ padding: 14, borderRadius: 18, border: "1px solid rgba(64, 89, 112, 0.12)", background: "rgba(255, 255, 255, 0.68)", display: "grid", gap: 8 }}>
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
                    </article>
                  );
                })
              )}
            </SurfaceCard>
          </aside>
        </section>
    </AppPage>
  );
}
