"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import type {
  ActivityTraceResponse,
  ConversationHistoryResponse,
  ConversationListItem,
  ConversationListResponse,
  ResearchSpecialistResult,
  RuntimeChatResponse,
  RuntimeMemoryContextItem,
  RuntimeTaskContextItem,
  ToolApprovalDecisionResponse,
  ToolExecutionListResponse,
  ToolExecutionRecord,
} from "@secretary/core-runtime";
import { AppPage, NoticeBanner, PageHero, StatCard, StatGrid } from "./lib/ui";
import { formatTimestamp, formatTracePayload, snippet } from "./lib/presenters";

type DeskMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "tool" | "specialist";
  text: string;
};

const starterMessages: DeskMessage[] = [
  {
    id: "assistant-intro",
    role: "assistant",
    text: "Secretary is online with memory, channels, voice, and the new Phase 5 action layer. Ask for help, request a tool action, or approve a pending operation.",
  },
];

function formatApprovalRequest(requestJson: Record<string, unknown>) {
  const rendered = formatTracePayload(requestJson);
  return rendered === "no payload" ? "No request payload recorded yet." : rendered;
}

export function DeskShell() {
  const [messages, setMessages] = useState<DeskMessage[]>(starterMessages);
  const [input, setInput] = useState("");
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [isSending, setIsSending] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastTraceId, setLastTraceId] = useState<string | null>(null);
  const [memoryContext, setMemoryContext] = useState<RuntimeMemoryContextItem[]>([]);
  const [taskContext, setTaskContext] = useState<RuntimeTaskContextItem[]>([]);
  const [researchContext, setResearchContext] = useState<ResearchSpecialistResult | null>(
    null,
  );
  const [activity, setActivity] = useState<ActivityTraceResponse["traces"]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<ToolExecutionRecord[]>([]);
  const [approvalBusyId, setApprovalBusyId] = useState<string | null>(null);
  const [sidebarError, setSidebarError] = useState<string | null>(null);
  const hasLoadedHistory = useRef<string | null>(null);

  async function loadConversations() {
    try {
      const response = await fetch("/api/conversations", {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("Request failed");
      }

      const data = (await response.json()) as ConversationListResponse;
      setConversations(data.conversations);
      setSidebarError(null);
    } catch {
      setSidebarError("Recent conversations are unavailable.");
    }
  }

  async function loadPendingApprovals(nextConversationId: string) {
    try {
      const response = await fetch(
        `/api/tool-executions?conversationId=${encodeURIComponent(nextConversationId)}&approvalState=pending`,
        {
          cache: "no-store",
        },
      );

      if (!response.ok) {
        throw new Error("Request failed");
      }

      const data = (await response.json()) as ToolExecutionListResponse;
      setPendingApprovals(data.executions);
    } catch {
      setPendingApprovals([]);
    }
  }

  useEffect(() => {
    void loadConversations();
  }, []);

  useEffect(() => {
    if (!conversationId || hasLoadedHistory.current === conversationId) {
      return;
    }

    let cancelled = false;

    async function loadConversationHistory() {
      setIsRefreshing(true);

      try {
        const response = await fetch(`/api/conversations/${conversationId}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error("Request failed");
        }

        const data = (await response.json()) as ConversationHistoryResponse;

        if (cancelled) {
          return;
        }

        setMessages(
          data.messages.length > 0
            ? data.messages.map((message) => ({
                id: message.id,
                role: message.role,
                text: message.text,
              }))
            : starterMessages,
        );
        hasLoadedHistory.current = data.conversationId;
        void loadPendingApprovals(data.conversationId);
      } catch {
        if (!cancelled) {
          setError("Saved conversation history could not be loaded.");
        }
      } finally {
        if (!cancelled) {
          setIsRefreshing(false);
        }
      }
    }

    void loadConversationHistory();

    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) {
      setActivity([]);
      setPendingApprovals([]);
      return;
    }

    let cancelled = false;

    async function loadActivity() {
      try {
        const response = await fetch(`/api/activity/${conversationId}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error("Request failed");
        }

        const data = (await response.json()) as ActivityTraceResponse;

        if (!cancelled) {
          setActivity(data.traces.slice(-8).reverse());
        }
      } catch {
        if (!cancelled) {
          setActivity([]);
        }
      }
    }

    void loadActivity();

    return () => {
      cancelled = true;
    };
  }, [conversationId, lastTraceId]);

  function resetComposerState() {
    setMemoryContext([]);
    setTaskContext([]);
    setResearchContext(null);
    setLastTraceId(null);
  }

  function startFreshConversation() {
    setConversationId(undefined);
    setMessages(starterMessages);
    setActivity([]);
    setPendingApprovals([]);
    setError(null);
    hasLoadedHistory.current = null;
    resetComposerState();
  }

  async function openConversation(nextConversationId: string) {
    setConversationId(nextConversationId);
    setPendingApprovals([]);
    setError(null);
    hasLoadedHistory.current = null;
    resetComposerState();
  }

  async function decideApproval(executionId: string, approve: boolean) {
    setApprovalBusyId(executionId);
    setError(null);

    try {
      const response = await fetch(
        `/api/tool-executions/${executionId}/${approve ? "approve" : "deny"}`,
        {
          method: "POST",
        },
      );

      if (!response.ok) {
        throw new Error("Request failed");
      }

      const data = (await response.json()) as ToolApprovalDecisionResponse;

      if (data.assistantMessage) {
        setMessages((current) => [
          ...current,
          {
            id: data.assistantMessage!.id,
            role: "assistant",
            text: data.assistantMessage!.text,
          },
        ]);
      }

      if (data.conversationId) {
        await loadPendingApprovals(data.conversationId);
        setConversationId(data.conversationId);
        setLastTraceId(data.execution.updatedAt);
      } else {
        setPendingApprovals((current) =>
          current.filter((execution) => execution.id !== executionId),
        );
      }

      void loadConversations();
    } catch {
      setError("Approval action failed. Try again.");
    } finally {
      setApprovalBusyId(null);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const text = input.trim();

    if (!text || isSending) {
      return;
    }

    const userMessage: DeskMessage = {
      id: `local-user-${Date.now()}`,
      role: "user",
      text,
    };

    setMessages((current) => [...current, userMessage]);
    setInput("");
    setIsSending(true);
    setError(null);
    hasLoadedHistory.current = null;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversationId,
          text,
        }),
      });

      if (!response.ok) {
        throw new Error("Request failed");
      }

      const data = (await response.json()) as RuntimeChatResponse;

      setConversationId(data.conversationId);
      setLastTraceId(data.traceId);
      setMemoryContext(data.contextSummary?.memories ?? []);
      setTaskContext(data.contextSummary?.tasks ?? []);
      setResearchContext(data.contextSummary?.research ?? null);
      setMessages((current) => [
        ...current,
        {
          id: data.messageId,
          role: "assistant",
          text: data.outputText,
        },
      ]);
      if (data.conversationId) {
        void loadPendingApprovals(data.conversationId);
      }
      void loadConversations();
    } catch {
      setError("The Desk could not reach the worker. Check the worker process and try again.");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <AppPage width="1280px">
      <div style={{ order: 1 }}>
      <section className="desk-grid">
          <aside className="desk-rail desk-rail--sticky">
            <article
              style={{
                padding: 16,
                borderRadius: 16,
                border: "1px solid var(--border)",
                background: "rgba(22, 18, 14, 0.94)",
                display: "grid",
                gap: 12,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <h2 style={{ margin: 0 }}>Conversations</h2>
                <button
                  type="button"
                  onClick={startFreshConversation}
                  className="button-secondary"
                >
                  New
                </button>
              </div>
              <p style={{ margin: 0, color: "var(--muted)", fontSize: 14 }}>
                {sidebarError ?? `${conversations.length} recent threads`}
              </p>
              <div className="desk-list desk-list--scroll">
                {conversations.map((conversation) => (
                  <button
                    key={conversation.id}
                    type="button"
                    onClick={() => void openConversation(conversation.id)}
                    style={{
                      textAlign: "left",
                      borderRadius: 12,
                      border:
                        conversationId === conversation.id
                          ? "1px solid rgba(164, 141, 100, 0.24)"
                          : "1px solid rgba(196, 180, 154, 0.12)",
                      background:
                        conversationId === conversation.id
                          ? "rgba(164, 141, 100, 0.14)"
                          : "rgba(18, 15, 12, 0.82)",
                      color: "var(--text)",
                      padding: 12,
                      cursor: "pointer",
                    }}
                  >
                    <p style={{ margin: "0 0 5px", fontWeight: 700, fontSize: 14 }}>
                      {conversation.title ?? "Untitled conversation"}
                    </p>
                    <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.4, fontSize: 13 }}>
                      {snippet(conversation.lastMessagePreview)}
                    </p>
                    <p style={{ margin: "7px 0 0", color: "var(--muted)", fontSize: 11 }}>
                      {conversation.channelType} · {conversation.messageCount} messages
                    </p>
                  </button>
                ))}
              </div>
            </article>

            <article
              style={{
                padding: 16,
                borderRadius: 16,
                border: "1px solid var(--border)",
                background: "rgba(22, 18, 14, 0.94)",
                display: "grid",
                gap: 10,
              }}
            >
              <h2 style={{ margin: 0 }}>Quick Prompts</h2>
              {[
                "Remember that I prefer short project updates.",
                "What do you remember about my preferences?",
                "Remind me to review the checkpoint tomorrow.",
                "Compare Docker and Podman for this repo.",
              ].map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => setInput(prompt)}
                  style={{
                    textAlign: "left",
                    borderRadius: 10,
                    border: "1px solid rgba(196, 180, 154, 0.12)",
                    background: "rgba(18, 15, 12, 0.82)",
                    color: "var(--text)",
                    padding: 11,
                    cursor: "pointer",
                    font: "inherit",
                    lineHeight: 1.4,
                    width: "100%",
                    whiteSpace: "normal",
                  }}
                >
                  {prompt}
                </button>
              ))}
            </article>
          </aside>

          <div
            className="desk-chat-shell"
            style={{
              padding: 16,
              borderRadius: 16,
              border: "1px solid var(--border)",
              background: "linear-gradient(180deg, rgba(16, 13, 11, 0.98), rgba(11, 9, 8, 0.96))",
              boxShadow: "var(--shadow-soft)",
            }}
          >
            <div className="desk-live-row">
              <div className="desk-live-chip">
                <p className="desk-live-chip-label">Thread</p>
                <p className="desk-live-chip-value">{conversationId ? "attached" : "fresh"}</p>
              </div>
              <div className="desk-live-chip">
                <p className="desk-live-chip-label">Persistence</p>
                <p className="desk-live-chip-value">
                  {conversationId ? (isRefreshing ? "refreshing" : "history linked") : "not saved"}
                </p>
              </div>
              <div className="desk-live-chip">
                <p className="desk-live-chip-label">Memory</p>
                <p className="desk-live-chip-value">{memoryContext.length} in context</p>
              </div>
              <div className="desk-live-chip">
                <p className="desk-live-chip-label">Approvals</p>
                <p className="desk-live-chip-value">{pendingApprovals.length} waiting</p>
              </div>
              <div className="desk-live-chip">
                <p className="desk-live-chip-label">Trace feed</p>
                <p className="desk-live-chip-value">{activity.length} events</p>
              </div>
            </div>
            <div className="desk-message-stream">
              {messages.map((message) => (
                <article
                  key={message.id}
                  style={{
                    justifySelf: message.role === "user" ? "end" : "start",
                    width: "min(94%, 700px)",
                    padding: "12px 14px",
                    borderRadius: 12,
                    background:
                      message.role === "user"
                        ? "rgba(164, 141, 100, 0.16)"
                        : "rgba(20, 17, 14, 0.94)",
                    border:
                      message.role === "user"
                        ? "1px solid rgba(164, 141, 100, 0.22)"
                        : "1px solid rgba(196, 180, 154, 0.1)",
                    boxShadow: "var(--shadow-soft)",
                  }}
                >
                  <p
                    style={{
                      margin: "0 0 6px",
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      color:
                        message.role === "user" ? "var(--accent-strong)" : "var(--muted)",
                    }}
                  >
                    {message.role}
                  </p>
                  <p style={{ margin: 0, lineHeight: 1.5, fontSize: 14 }}>{message.text}</p>
                </article>
              ))}
            </div>

            <form onSubmit={onSubmit} style={{ display: "grid", gap: 10 }}>
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Ask the Secretary something..."
                rows={4}
                style={{
                  width: "100%",
                  resize: "vertical",
                  borderRadius: 12,
                  padding: 14,
                  minHeight: 112,
                }}
              />
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                }}
              >
                <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
                  {error ??
                    (isSending
                      ? "Sending through the worker..."
                      : isRefreshing
                        ? "Refreshing saved history..."
                        : "Ready")}
                </p>
                <button
                  type="submit"
                  disabled={isSending || input.trim().length === 0}
                  className="button-primary"
                >
                  {isSending ? "Sending..." : "Send message"}
                </button>
              </div>
            </form>
          </div>

          <aside className="desk-rail desk-rail--sticky">
            <article
              style={{
                padding: 16,
                borderRadius: 16,
                border: "1px solid var(--border)",
                background: "rgba(16, 13, 11, 0.96)",
                boxShadow: "var(--shadow-soft)",
              }}
            >
              <h2 style={{ marginTop: 0 }}>Turn State</h2>
              <dl
                style={{
                  display: "grid",
                  gap: 12,
                  margin: 0,
                }}
              >
                <div>
                  <dt style={{ color: "var(--muted)", fontSize: 12 }}>Conversation</dt>
                  <dd style={{ margin: "6px 0 0", wordBreak: "break-word" }}>
                    {conversationId ?? "Not started"}
                  </dd>
                </div>
                <div>
                  <dt style={{ color: "var(--muted)", fontSize: 12 }}>Last Trace</dt>
                  <dd style={{ margin: "6px 0 0", wordBreak: "break-word" }}>
                    {lastTraceId ?? "None yet"}
                  </dd>
                </div>
                <div>
                  <dt style={{ color: "var(--muted)", fontSize: 12 }}>Persistence</dt>
                  <dd style={{ margin: "6px 0 0", wordBreak: "break-word" }}>
                    {conversationId
                      ? isRefreshing
                        ? "Loading saved messages"
                        : "Connected to conversation history"
                      : "No persisted conversation yet"}
                  </dd>
                </div>
              </dl>
              <div className="desk-widget-separator" />
              <div className="stack-sm">
                <p
                  style={{
                    margin: 0,
                    fontSize: 12,
                    color: "var(--muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.12em",
                  }}
                >
                  Memory in play
                </p>
                {memoryContext.length === 0 ? (
                  <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
                    No strong memory match on the latest turn.
                  </p>
                ) : (
                  memoryContext.slice(0, 3).map((memory) => (
                    <article
                      key={memory.id}
                      style={{
                        padding: 10,
                        borderRadius: 10,
                        border: "1px solid rgba(196, 180, 154, 0.12)",
                        background: "rgba(24, 20, 16, 0.9)",
                      }}
                    >
                      <p style={{ margin: "0 0 4px", fontWeight: 700, fontSize: 13 }}>
                        {memory.title ?? memory.summary ?? memory.contentText}
                      </p>
                      <p style={{ margin: 0, color: "var(--muted)", fontSize: 12 }}>
                        {memory.memoryType} · importance {memory.importanceScore}
                        {memory.pinned ? " · pinned" : ""}
                      </p>
                    </article>
                  ))
                )}
              </div>
              <div className="desk-widget-separator" />
              <div className="stack-sm">
                <p
                  style={{
                    margin: 0,
                    fontSize: 12,
                    color: "var(--muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.12em",
                  }}
                >
                  Tasks and research
                </p>
                {taskContext.length > 0 ? (
                  taskContext.slice(0, 2).map((task) => (
                    <article
                      key={task.id}
                      style={{
                        padding: 10,
                        borderRadius: 10,
                        border: "1px solid rgba(196, 180, 154, 0.12)",
                        background: "rgba(24, 20, 16, 0.9)",
                      }}
                    >
                      <p style={{ margin: "0 0 4px", fontWeight: 700, fontSize: 13 }}>
                        {task.title}
                      </p>
                      <p style={{ margin: 0, color: "var(--muted)", fontSize: 12 }}>
                        {task.status} · {formatTimestamp(task.reminderAt ?? task.dueAt)}
                      </p>
                    </article>
                  ))
                ) : (
                  <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
                    No active reminder hooks in context.
                  </p>
                )}
                {researchContext ? (
                  <article
                    style={{
                      padding: 10,
                      borderRadius: 10,
                      border: "1px solid rgba(196, 180, 154, 0.12)",
                      background: "rgba(24, 20, 16, 0.9)",
                    }}
                  >
                    <p style={{ margin: "0 0 4px", fontWeight: 700, fontSize: 13 }}>
                      Research specialist used
                    </p>
                    <p
                      style={{
                        margin: 0,
                        color: "var(--muted)",
                        lineHeight: 1.45,
                        fontSize: 12,
                      }}
                    >
                      {researchContext.summary}
                    </p>
                  </article>
                ) : null}
              </div>
            </article>

            <article
              style={{
                padding: 16,
                borderRadius: 16,
                border: "1px solid var(--border)",
                background: "rgba(16, 13, 11, 0.96)",
                boxShadow: "var(--shadow-soft)",
              }}
            >
              <h2 style={{ marginTop: 0 }}>Pending Approvals</h2>
              <div style={{ display: "grid", gap: 12 }}>
                {pendingApprovals.length === 0 ? (
                  <p style={{ margin: 0, color: "var(--muted)" }}>
                    No approval requests waiting in this conversation.
                  </p>
                ) : (
                  pendingApprovals.map((execution) => (
                    <article
                      key={execution.id}
                      style={{
                        padding: 10,
                        borderRadius: 10,
                        border: "1px solid rgba(196, 180, 154, 0.12)",
                        background: "rgba(24, 20, 16, 0.9)",
                        display: "grid",
                        gap: 8,
                      }}
                    >
                      <div>
                        <p style={{ margin: "0 0 4px", fontWeight: 700, fontSize: 13 }}>
                          {execution.toolName}
                        </p>
                        <p style={{ margin: 0, color: "var(--muted)", fontSize: 12 }}>
                          {execution.summary}
                        </p>
                        <p
                          style={{
                            margin: "6px 0 0",
                            color: "var(--muted)",
                            fontSize: 11,
                            lineHeight: 1.4,
                          }}
                        >
                          Request: {formatApprovalRequest(execution.requestJson)}
                        </p>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          gap: 8,
                          flexWrap: "wrap",
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => void decideApproval(execution.id, true)}
                          disabled={approvalBusyId === execution.id}
                          className="button-primary"
                        >
                          {approvalBusyId === execution.id ? "Working..." : "Approve"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void decideApproval(execution.id, false)}
                          disabled={approvalBusyId === execution.id}
                          className="button-danger"
                        >
                          Deny
                        </button>
                      </div>
                    </article>
                  ))
                )}
                <a
                  href="/tools"
                  style={{
                    color: "var(--accent-strong)",
                    fontSize: 12,
                    textDecoration: "none",
                  }}
                >
                  Open full tools console
                </a>
              </div>
            </article>

            <article
              style={{
                padding: 16,
                borderRadius: 16,
                border: "1px solid var(--border)",
                background: "rgba(16, 13, 11, 0.96)",
                boxShadow: "var(--shadow-soft)",
              }}
            >
              <h2 style={{ marginTop: 0 }}>Recent Trace Events</h2>
              <div className="desk-list desk-list--scroll">
                {activity.length === 0 ? (
                  <p style={{ margin: 0, color: "var(--muted)" }}>
                    No activity trace loaded yet.
                  </p>
                ) : (
                  activity.map((trace) => (
                    <article
                      key={trace.id}
                      style={{
                        padding: 10,
                        borderRadius: 10,
                        border: "1px solid rgba(196, 180, 154, 0.12)",
                        background: "rgba(24, 20, 16, 0.9)",
                      }}
                    >
                      <p style={{ margin: "0 0 5px", fontWeight: 700, fontSize: 13 }}>
                        {trace.eventName}
                      </p>
                      <p style={{ margin: "0 0 4px", color: "var(--muted)", fontSize: 11 }}>
                        {formatTimestamp(trace.createdAt)}
                      </p>
                      <p style={{ margin: 0, color: "var(--muted)", fontSize: 12, lineHeight: 1.45 }}>
                        {formatTracePayload(trace.payload)}
                      </p>
                    </article>
                  ))
                )}
              </div>
            </article>
          </aside>
      </section>
      </div>
      <div style={{ order: 2, display: "grid", gap: 18 }}>
        <PageHero
          eyebrow="Secretary Desk"
          title="Desk and live runtime"
          description={
            <p>
              Live turns, current memory pressure, approvals, and runtime traces stay in
              view here without making the whole page feel like a spreadsheet of cards.
            </p>
          }
          meta={
            <p>
              {error ??
                (isSending
                  ? "Sending through the worker..."
                  : isRefreshing
                    ? "Refreshing saved history..."
                    : "Ready for the next turn.")}
            </p>
          }
          actions={
            <button type="button" className="button-primary" onClick={startFreshConversation}>
              New conversation
            </button>
          }
        />

        <StatGrid>
          <StatCard label="Threads" value={conversations.length} detail="Recent saved conversations" />
          <StatCard label="Pending approvals" value={pendingApprovals.length} detail="Actions waiting on you" />
          <StatCard label="Memory hits" value={memoryContext.length} detail="Active memory items in the latest turn" />
          <StatCard
            label="Runtime traces"
            value={activity.length}
            detail={conversationId ? "Recent events for the active thread" : "Start a thread to inspect traces"}
            tone="soft"
          />
        </StatGrid>

        {error ? <NoticeBanner tone="warning">{error}</NoticeBanner> : null}
      </div>
    </AppPage>
  );
}
