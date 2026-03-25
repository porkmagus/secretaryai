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
import { AppPage } from "./lib/ui";
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

const deskVoicePreferenceKey = "secretary.desk.autoSpeak";

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
  const [autoSpeakReplies, setAutoSpeakReplies] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [deskVoiceError, setDeskVoiceError] = useState<string | null>(null);
  const hasLoadedHistory = useRef<string | null>(null);
  const lastPresencePingAtRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioObjectUrlRef = useRef<string | null>(null);
  const selectedConversation = conversations.find(
    (conversation) => conversation.id === conversationId,
  );
  const latestTrace = activity[0] ?? null;
  const primaryPendingApproval = pendingApprovals[0] ?? null;

  function stopMessagePlayback() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }

    if (audioObjectUrlRef.current) {
      URL.revokeObjectURL(audioObjectUrlRef.current);
      audioObjectUrlRef.current = null;
    }

    setSpeakingMessageId(null);
  }

  async function playAssistantMessage(message: DeskMessage) {
    if (message.role !== "assistant") {
      return;
    }

    if (speakingMessageId === message.id) {
      stopMessagePlayback();
      return;
    }

    stopMessagePlayback();
    setDeskVoiceError(null);
    setSpeakingMessageId(message.id);

    try {
      const response = await fetch("/api/voice/preview", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: message.text,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error ?? "Desk voice preview failed.");
      }

      const audioBlob = await response.blob();
      const objectUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(objectUrl);

      audioRef.current = audio;
      audioObjectUrlRef.current = objectUrl;

      audio.onended = () => {
        stopMessagePlayback();
      };
      audio.onerror = () => {
        stopMessagePlayback();
        setDeskVoiceError("Desk voice playback ran into an audio error.");
      };

      await audio.play();
    } catch (playbackError) {
      stopMessagePlayback();
      setDeskVoiceError(
        playbackError instanceof Error
          ? playbackError.message
          : "Desk voice playback is unavailable right now.",
      );
    }
  }

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

  async function reportDeskPresence() {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      return;
    }

    const now = Date.now();
    if (now - lastPresencePingAtRef.current < 15_000) {
      return;
    }

    lastPresencePingAtRef.current = now;

    try {
      await fetch("/api/integrations/telegram/presence", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          surface: "desk",
        }),
      });
    } catch {
      // Presence is best-effort and should never interrupt the Desk.
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
    if (typeof window === "undefined") {
      return;
    }

    const savedPreference = window.localStorage.getItem(deskVoicePreferenceKey);
    setAutoSpeakReplies(savedPreference === "true");
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(deskVoicePreferenceKey, String(autoSpeakReplies));
  }, [autoSpeakReplies]);

  useEffect(() => {
    return () => {
      stopMessagePlayback();
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    void reportDeskPresence();

    const handleVisible = () => {
      if (document.visibilityState === "visible") {
        void reportDeskPresence();
      }
    };
    const handleFocus = () => {
      void reportDeskPresence();
    };
    const handlePointer = () => {
      void reportDeskPresence();
    };
    const interval = window.setInterval(() => {
      void reportDeskPresence();
    }, 45_000);

    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("pointerdown", handlePointer);
    window.addEventListener("keydown", handlePointer);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("pointerdown", handlePointer);
      window.removeEventListener("keydown", handlePointer);
    };
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
    setDeskVoiceError(null);
  }

  function startFreshConversation() {
    stopMessagePlayback();
    setConversationId(undefined);
    setMessages(starterMessages);
    setActivity([]);
    setPendingApprovals([]);
    setError(null);
    hasLoadedHistory.current = null;
    resetComposerState();
  }

  async function openConversation(nextConversationId: string) {
    stopMessagePlayback();
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
        const assistantMessage: DeskMessage = {
          id: data.assistantMessage.id,
          role: "assistant",
          text: data.assistantMessage.text,
        };

        setMessages((current) => [
          ...current,
          assistantMessage,
        ]);
        if (autoSpeakReplies) {
          void playAssistantMessage(assistantMessage);
        }
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
      const assistantMessage: DeskMessage = {
        id: data.messageId,
        role: "assistant",
        text: data.outputText,
      };

      setConversationId(data.conversationId);
      setLastTraceId(data.traceId);
      setMemoryContext(data.contextSummary?.memories ?? []);
      setTaskContext(data.contextSummary?.tasks ?? []);
      setResearchContext(data.contextSummary?.research ?? null);
      setMessages((current) => [...current, assistantMessage]);
      if (autoSpeakReplies) {
        void playAssistantMessage(assistantMessage);
      }
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
    <AppPage width="100%" className="app-page--desk">
      <section className="desk-grid desk-grid--workspace">
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
                {sidebarError ?? `${Math.min(conversations.length, 3)} recent threads in view`}
              </p>
              <div className="desk-list">
                {conversations.slice(0, 3).map((conversation) => (
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
                      padding: 10,
                      cursor: "pointer",
                    }}
                  >
                    <p style={{ margin: "0 0 4px", fontWeight: 700, fontSize: 13 }}>
                      {conversation.title ?? "Untitled conversation"}
                    </p>
                    <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.35, fontSize: 12 }}>
                      {snippet(conversation.lastMessagePreview).slice(0, 72)}
                    </p>
                    <p style={{ margin: "6px 0 0", color: "var(--muted)", fontSize: 11 }}>
                      {conversation.channelType} · {conversation.messageCount} messages
                    </p>
                  </button>
                ))}
                {conversations.length > 3 ? (
                  <p style={{ margin: 0, color: "var(--muted)", fontSize: 12 }}>
                    Showing the 3 most recent threads.
                  </p>
                ) : null}
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
              <h2 style={{ margin: 0 }}>Prompts</h2>
              {[
                "Remember that I prefer short project updates.",
                "What do you remember about my preferences?",
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
                  {message.role === "assistant" ? (
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "flex-end",
                        marginTop: 10,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => void playAssistantMessage(message)}
                        className="button-secondary"
                        style={{
                          padding: "6px 10px",
                          fontSize: 11,
                        }}
                      >
                        {speakingMessageId === message.id ? "Stop" : "Speak"}
                      </button>
                    </div>
                  ) : null}
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
                  {deskVoiceError ??
                    error ??
                    (isSending
                      ? "Sending through the worker..."
                      : isRefreshing
                        ? "Refreshing saved history..."
                        : conversationId
                          ? "History linked and ready"
                          : "Fresh conversation ready")}
                </p>
                <button
                  type="submit"
                  disabled={isSending || input.trim().length === 0}
                  className="button-primary"
                >
                  {isSending ? "Sending..." : "Send message"}
                </button>
              </div>
              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  color: "var(--muted)",
                  fontSize: 12,
                }}
              >
                <input
                  type="checkbox"
                  checked={autoSpeakReplies}
                  onChange={(event) => setAutoSpeakReplies(event.target.checked)}
                />
                Auto-voice Samantha replies
              </label>
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
              <h2 style={{ marginTop: 0, marginBottom: 12 }}>Session</h2>
              <div className="desk-live-row">
                <div className="desk-live-chip">
                  <p className="desk-live-chip-label">Thread</p>
                  <p className="desk-live-chip-value">
                    {selectedConversation?.title ?? (conversationId ? "Saved thread" : "Fresh thread")}
                  </p>
                </div>
                <div className="desk-live-chip">
                  <p className="desk-live-chip-label">Approvals</p>
                  <p className="desk-live-chip-value">
                    {pendingApprovals.length === 0 ? "Clear" : `${pendingApprovals.length} pending`}
                  </p>
                </div>
                <div className="desk-live-chip">
                  <p className="desk-live-chip-label">Traces</p>
                  <p className="desk-live-chip-value">
                    {activity.length === 0 ? "Quiet" : `${activity.length} recent events`}
                  </p>
                </div>
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
                  Context pulse
                </p>
                <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.5 }}>
                  {memoryContext.length > 0
                    ? `${memoryContext.length} memory cue${memoryContext.length === 1 ? "" : "s"}, `
                    : "No memory cues, "}
                  {taskContext.length > 0
                    ? `${taskContext.length} task hook${taskContext.length === 1 ? "" : "s"}`
                    : "no task hooks"}
                  {researchContext ? ", research active." : "."}
                </p>
                <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.5 }}>
                  {latestTrace
                    ? `Latest event: ${latestTrace.eventName} at ${formatTimestamp(latestTrace.createdAt)}.`
                    : conversationId
                      ? "Saved thread loaded. Open Activity for the full runtime record."
                      : "Nothing has executed yet in this fresh thread."}
                </p>
              </div>
              {primaryPendingApproval ? (
                <>
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
                      Needs approval
                    </p>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>
                      {primaryPendingApproval.toolName}
                    </p>
                    <p style={{ margin: 0, color: "var(--muted)", fontSize: 12, lineHeight: 1.45 }}>
                      {primaryPendingApproval.summary}
                    </p>
                    <p style={{ margin: 0, color: "var(--muted)", fontSize: 11, lineHeight: 1.4 }}>
                      {formatApprovalRequest(primaryPendingApproval.requestJson)}
                    </p>
                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => void decideApproval(primaryPendingApproval.id, true)}
                        disabled={approvalBusyId === primaryPendingApproval.id}
                        className="button-primary"
                      >
                        {approvalBusyId === primaryPendingApproval.id ? "Working..." : "Approve"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void decideApproval(primaryPendingApproval.id, false)}
                        disabled={approvalBusyId === primaryPendingApproval.id}
                        className="button-danger"
                      >
                        Deny
                      </button>
                    </div>
                    {pendingApprovals.length > 1 ? (
                      <p style={{ margin: 0, color: "var(--muted)", fontSize: 11 }}>
                        {pendingApprovals.length - 1} more approval request
                        {pendingApprovals.length - 1 === 1 ? "" : "s"} waiting in Tools.
                      </p>
                    ) : null}
                  </div>
                </>
              ) : null}
              <div className="desk-widget-separator" />
              <div
                style={{
                  display: "flex",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <a
                  href="/activity"
                  style={{
                    color: "var(--accent-strong)",
                    fontSize: 12,
                    textDecoration: "none",
                  }}
                >
                  Open activity
                </a>
                <a
                  href="/tools"
                  style={{
                    color: "var(--accent-strong)",
                    fontSize: 12,
                    textDecoration: "none",
                  }}
                >
                  Open tools
                </a>
              </div>
            </article>
          </aside>
      </section>
    </AppPage>
  );
}
