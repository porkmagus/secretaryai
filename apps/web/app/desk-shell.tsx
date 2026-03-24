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
    <main
      style={{
        minHeight: "100vh",
        padding: "32px 18px 48px",
      }}
    >
      <section
        style={{
          width: "min(1100px, 100%)",
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
            backdropFilter: "blur(18px)",
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
            Secretary Desk
          </p>
          <h1
            style={{
              margin: "12px 0 10px",
              fontSize: "clamp(2.1rem, 4vw, 4.2rem)",
              lineHeight: 1,
            }}
          >
            Desk, Memory, and Runtime Context
          </h1>
          <p
            style={{
              margin: 0,
              maxWidth: 720,
              color: "var(--muted)",
              fontSize: 18,
              lineHeight: 1.6,
            }}
          >
            This Desk routes browser messages through a thin Next.js API layer to
            the Fastify worker. The runtime remains deterministic, but it now
            retrieves stored memory, tracks extracted reminder hooks, and can run
            internal specialists plus approval-gated tools before composing a reply.
          </p>
        </header>

        <section
          style={{
            display: "grid",
            gap: 20,
            gridTemplateColumns: "minmax(250px, 0.8fr) minmax(0, 1.9fr) minmax(280px, 0.95fr)",
          }}
        >
          <aside
            style={{
              display: "grid",
              gap: 16,
              alignContent: "start",
            }}
          >
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
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <h2 style={{ margin: 0 }}>Conversations</h2>
                <button
                  type="button"
                  onClick={startFreshConversation}
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
                  New
                </button>
              </div>
              <p style={{ margin: 0, color: "var(--muted)", fontSize: 14 }}>
                {sidebarError ?? `${conversations.length} recent threads`}
              </p>
              <div style={{ display: "grid", gap: 10 }}>
                {conversations.map((conversation) => (
                  <button
                    key={conversation.id}
                    type="button"
                    onClick={() => void openConversation(conversation.id)}
                    style={{
                      textAlign: "left",
                      borderRadius: 18,
                      border:
                        conversationId === conversation.id
                          ? "1px solid rgba(125, 211, 252, 0.42)"
                          : "1px solid rgba(148, 163, 184, 0.14)",
                      background:
                        conversationId === conversation.id
                          ? "rgba(56, 189, 248, 0.12)"
                          : "rgba(2, 6, 23, 0.62)",
                      color: "var(--text)",
                      padding: 14,
                      cursor: "pointer",
                    }}
                  >
                    <p style={{ margin: "0 0 6px", fontWeight: 700 }}>
                      {conversation.title ?? "Untitled conversation"}
                    </p>
                    <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.5 }}>
                      {snippet(conversation.lastMessagePreview)}
                    </p>
                    <p style={{ margin: "8px 0 0", color: "var(--muted)", fontSize: 12 }}>
                      {conversation.channelType} · {conversation.messageCount} messages
                    </p>
                  </button>
                ))}
              </div>
            </article>

            <article
              style={{
                padding: 20,
                borderRadius: 24,
                border: "1px solid var(--border)",
                background: "var(--panel-strong)",
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
                    borderRadius: 16,
                    border: "1px solid rgba(148, 163, 184, 0.14)",
                    background: "rgba(2, 6, 23, 0.62)",
                    color: "var(--text)",
                    padding: 12,
                    cursor: "pointer",
                    font: "inherit",
                  }}
                >
                  {prompt}
                </button>
              ))}
            </article>
          </aside>

          <div
            style={{
              padding: 20,
              borderRadius: 24,
              border: "1px solid var(--border)",
              background: "var(--panel-strong)",
              minHeight: 520,
              display: "grid",
              gridTemplateRows: "1fr auto",
              gap: 16,
            }}
          >
            <div
              style={{
                display: "grid",
                gap: 12,
                alignContent: "start",
              }}
            >
              {messages.map((message) => (
                <article
                  key={message.id}
                  style={{
                    justifySelf: message.role === "user" ? "end" : "start",
                    width: "min(92%, 680px)",
                    padding: "14px 16px",
                    borderRadius: 18,
                    background:
                      message.role === "user"
                        ? "rgba(56, 189, 248, 0.15)"
                        : "rgba(15, 23, 42, 0.95)",
                    border:
                      message.role === "user"
                        ? "1px solid rgba(125, 211, 252, 0.25)"
                        : "1px solid rgba(148, 163, 184, 0.12)",
                  }}
                >
                  <p
                    style={{
                      margin: "0 0 8px",
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color:
                        message.role === "user" ? "var(--accent)" : "var(--muted)",
                    }}
                  >
                    {message.role}
                  </p>
                  <p style={{ margin: 0, lineHeight: 1.6 }}>{message.text}</p>
                </article>
              ))}
            </div>

            <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Ask the Secretary something..."
                rows={4}
                style={{
                  width: "100%",
                  resize: "vertical",
                  borderRadius: 18,
                  border: "1px solid rgba(148, 163, 184, 0.18)",
                  background: "rgba(2, 6, 23, 0.75)",
                  color: "var(--text)",
                  padding: 16,
                  font: "inherit",
                }}
              />
              <div
                style={{
                  display: "flex",
                  gap: 12,
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                }}
              >
                <p style={{ margin: 0, color: "var(--muted)", fontSize: 14 }}>
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
                  style={{
                    border: "none",
                    borderRadius: 999,
                    padding: "12px 18px",
                    font: "inherit",
                    fontWeight: 700,
                    cursor: isSending ? "wait" : "pointer",
                    color: "#03111f",
                    background:
                      "linear-gradient(135deg, var(--accent) 0%, var(--accent-strong) 100%)",
                    opacity: isSending || input.trim().length === 0 ? 0.7 : 1,
                  }}
                >
                  {isSending ? "Sending..." : "Send Message"}
                </button>
              </div>
            </form>
          </div>

          <aside
            style={{
              display: "grid",
              gap: 20,
            }}
          >
            <article
              style={{
                padding: 20,
                borderRadius: 24,
                border: "1px solid var(--border)",
                background: "var(--panel-strong)",
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
                  <dt style={{ color: "var(--muted)", fontSize: 13 }}>Conversation</dt>
                  <dd style={{ margin: "6px 0 0", wordBreak: "break-word" }}>
                    {conversationId ?? "Not started"}
                  </dd>
                </div>
                <div>
                  <dt style={{ color: "var(--muted)", fontSize: 13 }}>Last Trace</dt>
                  <dd style={{ margin: "6px 0 0", wordBreak: "break-word" }}>
                    {lastTraceId ?? "None yet"}
                  </dd>
                </div>
                <div>
                  <dt style={{ color: "var(--muted)", fontSize: 13 }}>Persistence</dt>
                  <dd style={{ margin: "6px 0 0", wordBreak: "break-word" }}>
                    {conversationId
                      ? isRefreshing
                        ? "Loading saved messages"
                        : "Connected to conversation history"
                      : "No persisted conversation yet"}
                  </dd>
                </div>
              </dl>
            </article>

            <article
              style={{
                padding: 20,
                borderRadius: 24,
                border: "1px solid var(--border)",
                background: "var(--panel-strong)",
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
                        padding: 12,
                        borderRadius: 14,
                        border: "1px solid rgba(148, 163, 184, 0.14)",
                        background: "rgba(2, 6, 23, 0.65)",
                        display: "grid",
                        gap: 10,
                      }}
                    >
                      <div>
                        <p style={{ margin: "0 0 4px", fontWeight: 700 }}>
                          {execution.toolName}
                        </p>
                        <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
                          {execution.summary}
                        </p>
                        <p
                          style={{
                            margin: "6px 0 0",
                            color: "var(--muted)",
                            fontSize: 12,
                            lineHeight: 1.5,
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
                          style={{
                            border: "none",
                            borderRadius: 999,
                            padding: "10px 14px",
                            font: "inherit",
                            fontWeight: 700,
                            cursor: approvalBusyId === execution.id ? "wait" : "pointer",
                            color: "#03111f",
                            background:
                              "linear-gradient(135deg, var(--accent) 0%, var(--accent-strong) 100%)",
                          }}
                        >
                          {approvalBusyId === execution.id ? "Working..." : "Approve"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void decideApproval(execution.id, false)}
                          disabled={approvalBusyId === execution.id}
                          style={{
                            border: "1px solid rgba(248, 113, 113, 0.32)",
                            borderRadius: 999,
                            padding: "10px 14px",
                            font: "inherit",
                            cursor: approvalBusyId === execution.id ? "wait" : "pointer",
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
                <a
                  href="/tools"
                  style={{
                    color: "var(--accent)",
                    fontSize: 13,
                    textDecoration: "none",
                  }}
                >
                  Open full tools console
                </a>
              </div>
            </article>

            <article
              style={{
                padding: 20,
                borderRadius: 24,
                border: "1px solid var(--border)",
                background: "var(--panel-strong)",
              }}
            >
              <h2 style={{ marginTop: 0 }}>Memory In Play</h2>
              <div style={{ display: "grid", gap: 12 }}>
                {memoryContext.length === 0 ? (
                  <p style={{ margin: 0, color: "var(--muted)" }}>
                    No strong memory match on the latest turn.
                  </p>
                ) : (
                  memoryContext.map((memory) => (
                    <article
                      key={memory.id}
                      style={{
                        padding: 12,
                        borderRadius: 14,
                        border: "1px solid rgba(148, 163, 184, 0.14)",
                        background: "rgba(2, 6, 23, 0.65)",
                      }}
                    >
                      <p style={{ margin: "0 0 6px", fontWeight: 700 }}>
                        {memory.title ?? memory.summary ?? memory.contentText}
                      </p>
                      <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
                        {memory.memoryType} · importance {memory.importanceScore}
                        {memory.pinned ? " · pinned" : ""}
                      </p>
                    </article>
                  ))
                )}
              </div>
            </article>

            <article
              style={{
                padding: 20,
                borderRadius: 24,
                border: "1px solid var(--border)",
                background: "var(--panel-strong)",
              }}
            >
              <h2 style={{ marginTop: 0 }}>Tasks and Research</h2>
              <div style={{ display: "grid", gap: 12 }}>
                {taskContext.length > 0 ? (
                  taskContext.map((task) => (
                    <article
                      key={task.id}
                      style={{
                        padding: 12,
                        borderRadius: 14,
                        border: "1px solid rgba(148, 163, 184, 0.14)",
                        background: "rgba(2, 6, 23, 0.65)",
                      }}
                    >
                      <p style={{ margin: "0 0 4px", fontWeight: 700 }}>{task.title}</p>
                      <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
                        {task.status} · {formatTimestamp(task.reminderAt ?? task.dueAt)}
                      </p>
                    </article>
                  ))
                ) : (
                  <p style={{ margin: 0, color: "var(--muted)" }}>
                    No active reminder hooks in context.
                  </p>
                )}
                {researchContext ? (
                  <article
                    style={{
                      padding: 12,
                      borderRadius: 14,
                      border: "1px solid rgba(148, 163, 184, 0.14)",
                      background: "rgba(2, 6, 23, 0.65)",
                    }}
                  >
                    <p style={{ margin: "0 0 6px", fontWeight: 700 }}>
                      Research specialist used
                    </p>
                    <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.5 }}>
                      {researchContext.summary}
                    </p>
                  </article>
                ) : null}
              </div>
            </article>

            <article
              style={{
                padding: 20,
                borderRadius: 24,
                border: "1px solid var(--border)",
                background: "var(--panel-strong)",
              }}
            >
              <h2 style={{ marginTop: 0 }}>Recent Trace Events</h2>
              <div style={{ display: "grid", gap: 10 }}>
                {activity.length === 0 ? (
                  <p style={{ margin: 0, color: "var(--muted)" }}>
                    No activity trace loaded yet.
                  </p>
                ) : (
                  activity.map((trace) => (
                    <article
                      key={trace.id}
                      style={{
                        padding: 12,
                        borderRadius: 14,
                        border: "1px solid rgba(148, 163, 184, 0.14)",
                        background: "rgba(2, 6, 23, 0.65)",
                      }}
                    >
                      <p style={{ margin: "0 0 6px", fontWeight: 700 }}>
                        {trace.eventName}
                      </p>
                      <p style={{ margin: "0 0 4px", color: "var(--muted)", fontSize: 13 }}>
                        {formatTimestamp(trace.createdAt)}
                      </p>
                      <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.5 }}>
                        {formatTracePayload(trace.payload)}
                      </p>
                    </article>
                  ))
                )}
              </div>
            </article>
          </aside>
        </section>
      </section>
    </main>
  );
}
