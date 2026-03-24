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
      return { label: "healthy", color: "#86efac", border: "rgba(74, 222, 128, 0.28)" };
    case "degraded":
      return { label: "needs attention", color: "#fde68a", border: "rgba(251, 191, 36, 0.28)" };
    case "disabled":
      return { label: "disabled", color: "#cbd5e1", border: "rgba(148, 163, 184, 0.24)" };
    default:
      return { label: status ?? "not configured", color: "#fca5a5", border: "rgba(248, 113, 113, 0.24)" };
  }
}

function describeReminder(task: TaskRecord) {
  if (task.lastDeliveryError) {
    return {
      label: "failed",
      detail: task.lastDeliveryError,
      color: "#fca5a5",
    };
  }

  if (task.deliveredAt) {
    return {
      label: "delivered",
      detail: `Delivered ${formatTimestamp(task.deliveredAt)}`,
      color: "#86efac",
    };
  }

  if (task.reminderAt) {
    return {
      label: "scheduled",
      detail: `Due ${formatTimestamp(task.reminderAt)}`,
      color: "#7dd3fc",
    };
  }

  return {
    label: "queued",
    detail: "Waiting for a reminder timestamp.",
    color: "#cbd5e1",
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
    <main style={{ minHeight: "100vh", padding: "32px 18px 48px" }}>
      <section style={{ width: "min(1220px, 100%)", margin: "0 auto", display: "grid", gap: 20 }}>
        <header
          style={{
            padding: 28,
            borderRadius: 28,
            border: "1px solid var(--border)",
            background: "var(--panel)",
            boxShadow: "var(--shadow)",
            display: "grid",
            gap: 18,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <p style={{ margin: 0, color: "var(--accent)", letterSpacing: "0.12em", textTransform: "uppercase", fontSize: 12, fontWeight: 700 }}>
                Channels
              </p>
              <h1 style={{ margin: "12px 0 10px", fontSize: "clamp(2.1rem, 4vw, 4rem)", lineHeight: 1 }}>
                Telegram Integration
              </h1>
              <p style={{ margin: 0, maxWidth: 780, color: "var(--muted)", fontSize: 17, lineHeight: 1.6 }}>
                Operate the live Telegram channel, verify webhook health, test outbound delivery,
                and keep an eye on routed chats and reminder delivery from one surface.
              </p>
            </div>

            <div
              style={{
                padding: "12px 16px",
                borderRadius: 18,
                border: `1px solid ${tone.border}`,
                background: "rgba(2, 6, 23, 0.55)",
                minWidth: 220,
              }}
            >
              <p style={{ margin: 0, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: tone.color, fontWeight: 700 }}>
                Telegram status
              </p>
              <p style={{ margin: "8px 0 0", fontSize: 22, fontWeight: 700 }}>
                {isLoading ? "Loading..." : tone.label}
              </p>
            </div>
          </div>

          <section style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
            {[
              { label: "Health", value: state.telegram?.healthStatus ?? (isLoading ? "loading" : "unknown") },
              { label: "Telegram Conversations", value: String(state.telegram?.conversationCount ?? 0) },
              { label: "Telegram Messages", value: String(state.telegram?.messageCount ?? 0) },
              { label: "Due Reminders", value: String(state.telegram?.dueReminderCount ?? 0) },
            ].map((card) => (
              <article key={card.label} style={{ padding: 18, borderRadius: 22, border: "1px solid var(--border)", background: "var(--panel-strong)" }}>
                <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>{card.label}</p>
                <p style={{ margin: "8px 0 0", fontSize: 28, fontWeight: 700 }}>{card.value}</p>
              </article>
            ))}
          </section>
        </header>

        <section style={{ display: "grid", gap: 20, gridTemplateColumns: "minmax(0, 1.45fr) minmax(320px, 0.95fr)" }}>
          <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
            <article style={{ padding: 22, borderRadius: 24, border: "1px solid var(--border)", background: "var(--panel-strong)", display: "grid", gap: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
                <div>
                  <h2 style={{ margin: 0 }}>Integration Settings</h2>
                  <p style={{ margin: "6px 0 0", color: "var(--muted)" }}>
                    {state.telegram?.healthSummary ?? "Loading Telegram integration health..."}
                  </p>
                </div>
                <button type="button" onClick={() => void refresh()} style={{ borderRadius: 999, border: "1px solid rgba(148, 163, 184, 0.18)", background: "rgba(2, 6, 23, 0.68)", color: "var(--text)", padding: "10px 16px", font: "inherit", cursor: "pointer" }}>
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
                  style={{ width: "100%", borderRadius: 14, border: "1px solid rgba(148, 163, 184, 0.18)", background: "rgba(2, 6, 23, 0.75)", color: "var(--text)", padding: "12px 14px", font: "inherit" }}
                />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ color: "var(--muted)", fontSize: 13 }}>Default Telegram chat id for tests and fallback reminders</span>
                <input
                  value={draft.defaultChatId}
                  onChange={(event) => setDraft((current) => ({ ...current, defaultChatId: event.target.value }))}
                  placeholder="123456789"
                  style={{ width: "100%", borderRadius: 14, border: "1px solid rgba(148, 163, 184, 0.18)", background: "rgba(2, 6, 23, 0.75)", color: "var(--text)", padding: "12px 14px", font: "inherit" }}
                />
              </label>

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <button type="button" onClick={() => void saveSettings()} disabled={isSaving} style={{ border: "none", borderRadius: 999, padding: "12px 18px", font: "inherit", fontWeight: 700, cursor: isSaving ? "wait" : "pointer", color: "#03111f", background: "linear-gradient(135deg, var(--accent) 0%, var(--accent-strong) 100%)", opacity: isSaving ? 0.7 : 1 }}>
                  {isSaving ? "Saving..." : "Save Settings"}
                </button>
                <button type="button" onClick={() => void syncWebhook()} disabled={isSyncing} style={{ borderRadius: 999, border: "1px solid rgba(148, 163, 184, 0.18)", background: "rgba(2, 6, 23, 0.68)", color: "var(--text)", padding: "12px 18px", font: "inherit", cursor: isSyncing ? "wait" : "pointer", opacity: isSyncing ? 0.7 : 1 }}>
                  {isSyncing ? "Syncing..." : "Sync Webhook"}
                </button>
                <button type="button" onClick={() => void dispatchReminders()} disabled={isDispatching} style={{ borderRadius: 999, border: "1px solid rgba(148, 163, 184, 0.18)", background: "rgba(2, 6, 23, 0.68)", color: "var(--text)", padding: "12px 18px", font: "inherit", cursor: isDispatching ? "wait" : "pointer", opacity: isDispatching ? 0.7 : 1 }}>
                  {isDispatching ? "Dispatching..." : "Deliver Due Reminders"}
                </button>
              </div>

              <div style={{ padding: 14, borderRadius: 18, border: "1px solid rgba(148, 163, 184, 0.14)", background: "rgba(2, 6, 23, 0.55)", color: error ? "#fca5a5" : "var(--muted)" }}>
                {error ?? notice ?? "The bot token stays in your local environment. This page only manages runtime state and webhook-facing configuration."}
              </div>
            </article>

            <article style={{ padding: 22, borderRadius: 24, border: "1px solid var(--border)", background: "var(--panel-strong)", display: "grid", gap: 14 }}>
              <h2 style={{ margin: 0 }}>Outbound Test</h2>
              <p style={{ margin: 0, color: "var(--muted)" }}>
                Send a real Telegram message without waiting for an inbound webhook event.
              </p>
              <input
                value={testChatId}
                onChange={(event) => setTestChatId(event.target.value)}
                placeholder="Test chat id"
                style={{ width: "100%", borderRadius: 14, border: "1px solid rgba(148, 163, 184, 0.18)", background: "rgba(2, 6, 23, 0.75)", color: "var(--text)", padding: "12px 14px", font: "inherit" }}
              />
              <textarea
                value={testText}
                onChange={(event) => setTestText(event.target.value)}
                rows={3}
                placeholder="Optional custom test message"
                style={{ width: "100%", resize: "vertical", borderRadius: 14, border: "1px solid rgba(148, 163, 184, 0.18)", background: "rgba(2, 6, 23, 0.75)", color: "var(--text)", padding: "12px 14px", font: "inherit" }}
              />
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <button type="button" onClick={() => void sendTestMessage()} disabled={isTesting} style={{ borderRadius: 999, border: "1px solid rgba(148, 163, 184, 0.18)", background: "rgba(2, 6, 23, 0.68)", color: "var(--text)", padding: "12px 18px", font: "inherit", cursor: isTesting ? "wait" : "pointer", opacity: isTesting ? 0.7 : 1 }}>
                  {isTesting ? "Sending..." : "Send Test Message"}
                </button>
                <button type="button" onClick={() => setTestText("Secretary test: live outbound Telegram delivery is working from the Channels page.")} style={{ borderRadius: 999, border: "1px solid rgba(148, 163, 184, 0.18)", background: "rgba(2, 6, 23, 0.68)", color: "var(--text)", padding: "12px 18px", font: "inherit", cursor: "pointer" }}>
                  Fill Sample
                </button>
              </div>
            </article>

            <article style={{ padding: 22, borderRadius: 24, border: "1px solid var(--border)", background: "var(--panel-strong)", display: "grid", gap: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
                <div>
                  <h2 style={{ margin: 0 }}>Recent Telegram Conversations</h2>
                  <p style={{ margin: "6px 0 0", color: "var(--muted)" }}>
                    Quick visibility into chats already routed into the shared memory core.
                  </p>
                </div>
                <Link href="/activity" style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 700 }}>
                  Open Activity
                </Link>
              </div>

              {telegramConversations.length === 0 ? (
                <p style={{ margin: 0, color: "var(--muted)" }}>No Telegram conversations have been recorded yet.</p>
              ) : (
                telegramConversations.map((conversation) => (
                  <article key={conversation.id} style={{ padding: 14, borderRadius: 18, border: "1px solid rgba(148, 163, 184, 0.14)", background: "rgba(2, 6, 23, 0.62)", display: "grid", gap: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                      <p style={{ margin: 0, fontWeight: 700 }}>{conversation.title ?? "Telegram conversation"}</p>
                      <span style={{ padding: "4px 8px", borderRadius: 999, background: "rgba(56, 189, 248, 0.1)", color: "var(--accent)", fontSize: 12, fontWeight: 700 }}>
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
            </article>
          </div>

          <aside style={{ display: "grid", gap: 20, alignContent: "start" }}>
            <article style={{ padding: 20, borderRadius: 24, border: "1px solid var(--border)", background: "var(--panel-strong)", display: "grid", gap: 10 }}>
              <h2 style={{ margin: 0 }}>Readiness Checklist</h2>
              {readiness.map((entry) => (
                <div key={entry.label} style={{ display: "flex", justifyContent: "space-between", gap: 12, color: "var(--muted)" }}>
                  <span>{entry.label}</span>
                  <strong style={{ color: entry.done ? "#86efac" : "#fca5a5" }}>
                    {entry.done ? "ready" : "missing"}
                  </strong>
                </div>
              ))}
            </article>

            <article style={{ padding: 20, borderRadius: 24, border: "1px solid var(--border)", background: "var(--panel-strong)", display: "grid", gap: 10 }}>
              <h2 style={{ margin: 0 }}>Current Bot State</h2>
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
            </article>

            <article style={{ padding: 20, borderRadius: 24, border: "1px solid var(--border)", background: "var(--panel-strong)", display: "grid", gap: 10 }}>
              <h2 style={{ margin: 0 }}>Webhook</h2>
              <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.6 }}>
                Saved target: {state.telegram?.desiredWebhookUrl ?? "not set"}
              </p>
              <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.6 }}>
                Healthy target: {state.telegram?.webhookUrl ?? "not synced"}
              </p>
              {state.telegram?.lastError ? (
                <p style={{ margin: 0, color: "#fca5a5", lineHeight: 1.6 }}>
                  Last Telegram error: {state.telegram.lastError}
                </p>
              ) : null}
            </article>

            <article style={{ padding: 20, borderRadius: 24, border: "1px solid var(--border)", background: "var(--panel-strong)", display: "grid", gap: 12 }}>
              <h2 style={{ margin: 0 }}>Reminder Delivery Queue</h2>
              {telegramTasks.length === 0 ? (
                <p style={{ margin: 0, color: "var(--muted)" }}>No Telegram reminder tasks are visible yet.</p>
              ) : (
                telegramTasks.map((task) => {
                  const reminder = describeReminder(task);

                  return (
                    <article key={task.id} style={{ padding: 14, borderRadius: 18, border: "1px solid rgba(148, 163, 184, 0.14)", background: "rgba(2, 6, 23, 0.62)", display: "grid", gap: 8 }}>
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
            </article>
          </aside>
        </section>
      </section>
    </main>
  );
}
