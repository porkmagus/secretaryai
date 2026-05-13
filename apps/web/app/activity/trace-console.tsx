"use client";

import type {
  ActivityTraceResponse,
  ConversationListItem,
  ConversationListResponse,
} from "@secretary/core-runtime";
import { useEffect, useState } from "react";
import { formatTimestamp, formatTracePayload, snippet } from "../lib/presenters";
import { AppPage, LoadingSurface, PageHero, SurfaceCard } from "../lib/ui";

export function ActivityConsole() {
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [traces, setTraces] = useState<ActivityTraceResponse["traces"]>([]);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const selectedConversation =
    conversations.find((conversation) => conversation.id === selectedConversationId) ?? null;
  const selectedTrace = traces.find((trace) => trace.id === selectedTraceId) ?? traces[0] ?? null;
  const tracePreview = traces.slice(0, 14);
  const traceTypeCounts = traces.reduce<Record<string, number>>((counts, trace) => {
    counts[trace.traceType] = (counts[trace.traceType] ?? 0) + 1;
    return counts;
  }, {});

  useEffect(() => {
    let cancelled = false;

    async function loadConversations() {
      setIsLoading(true);

      try {
        const response = await fetch("/api/conversations", {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error("Request failed");
        }

        const data = (await response.json()) as ConversationListResponse;

        if (cancelled) {
          return;
        }

        setConversations(data.conversations);
        setSelectedConversationId((current) => current ?? data.conversations[0]?.id ?? null);
      } catch {
        if (!cancelled) {
          setError("Unable to load conversations for activity view.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadConversations();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedConversationId) {
      setTraces([]);
      return;
    }

    let cancelled = false;

    async function loadTraces() {
      try {
        const response = await fetch(`/api/activity/${selectedConversationId}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error("Request failed");
        }

        const data = (await response.json()) as ActivityTraceResponse;

        if (!cancelled) {
          setTraces(data.traces.slice().reverse());
          setSelectedTraceId(data.traces.slice().reverse()[0]?.id ?? null);
          setError(null);
        }
      } catch {
        if (!cancelled) {
          setError("Unable to load activity traces.");
        }
      }
    }

    void loadTraces();

    return () => {
      cancelled = true;
    };
  }, [selectedConversationId]);

  if (isLoading && conversations.length === 0) {
    return (
      <AppPage>
        <LoadingSurface
          title="Preparing runtime activity"
          description={
            <p>
              Pulling recent conversations and trace streams into one inspection surface so the
              activity console opens with context instead of a blank rail.
            </p>
          }
          blocks={3}
        />
      </AppPage>
    );
  }

  return (
    <AppPage>
      <PageHero
        eyebrow="Activity Console"
        title="Runtime trace inspection"
        description={
          <p>
            Walk recent conversations, inspect runtime context assembly, and confirm when memory or
            specialist work shaped a response.
          </p>
        }
        tone="dark"
      />

      <section className="activity-grid">
        <SurfaceCard
          tone="dark"
          title="Recent conversations"
          description={
            <p>
              {error ??
                (isLoading
                  ? "Loading conversations..."
                  : `${Math.min(conversations.length, 8)} recent threads ready to inspect`)}
            </p>
          }
          className="stack-sm activity-sidebar"
        >
          {conversations.slice(0, 8).map((conversation) => (
            <button
              key={conversation.id}
              type="button"
              onClick={() => setSelectedConversationId(conversation.id)}
              style={{
                textAlign: "left",
                borderRadius: 18,
                border:
                  selectedConversationId === conversation.id
                    ? "1px solid rgba(164, 141, 100, 0.26)"
                    : "1px solid var(--border)",
                background:
                  selectedConversationId === conversation.id
                    ? "rgba(164, 141, 100, 0.1)"
                    : "rgba(18, 15, 12, 0.86)",
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
                {conversation.channelType} · {conversation.messageCount} messages ·{" "}
                {formatTimestamp(conversation.lastMessageAt)}
              </p>
            </button>
          ))}
          {conversations.length > 8 ? (
            <p style={{ margin: 0, color: "var(--muted)", fontSize: 12 }}>
              Showing the 8 most recent threads.
            </p>
          ) : null}
        </SurfaceCard>

        <div className="activity-panel">
          {traces.length === 0 ? (
            <SurfaceCard>
              <p style={{ margin: 0, color: "var(--muted)" }}>
                Select a conversation to inspect activity traces.
              </p>
            </SurfaceCard>
          ) : (
            <>
              <SurfaceCard tone="dark" className="stack-sm">
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 16,
                    alignItems: "flex-start",
                    flexWrap: "wrap",
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
                      Activity focus
                    </p>
                    <h2 style={{ margin: 0, fontSize: 24 }}>
                      {selectedConversation?.title ?? "Conversation activity"}
                    </h2>
                    <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.5, fontSize: 14 }}>
                      {selectedConversation
                        ? `${selectedConversation.channelType} thread · ${selectedConversation.messageCount} messages`
                        : "Trace stream ready"}
                    </p>
                  </div>
                  <div className="desk-live-row" style={{ minWidth: "min(100%, 360px)" }}>
                    <div className="desk-live-chip">
                      <p className="desk-live-chip-label">Events</p>
                      <p className="desk-live-chip-value">{traces.length}</p>
                    </div>
                    <div className="desk-live-chip">
                      <p className="desk-live-chip-label">Runtime</p>
                      <p className="desk-live-chip-value">{traceTypeCounts.runtime ?? 0}</p>
                    </div>
                    <div className="desk-live-chip">
                      <p className="desk-live-chip-label">Speech / tools</p>
                      <p className="desk-live-chip-value">
                        {(traceTypeCounts.speech ?? 0) + (traceTypeCounts.tool ?? 0)}
                      </p>
                    </div>
                  </div>
                </div>
              </SurfaceCard>

              <SurfaceCard tone="dark" className="stack-sm">
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 16,
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <p
                      className="eyebrow"
                      style={{
                        marginBottom: 6,
                        color: "var(--accent-strong)",
                        letterSpacing: "0.08em",
                      }}
                    >
                      {selectedTrace?.traceType ?? "trace"}
                    </p>
                    <h2 style={{ margin: 0, fontSize: 22 }}>
                      {selectedTrace?.eventName ?? "Select an event"}
                    </h2>
                  </div>
                  <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
                    {selectedTrace ? formatTimestamp(selectedTrace.createdAt) : "n/a"}
                  </p>
                </div>
                <pre
                  className="activity-trace-detail"
                  style={{
                    margin: 0,
                    padding: 14,
                    borderRadius: 16,
                    background: "rgba(15, 12, 10, 0.92)",
                    color: "var(--surface-dark-text)",
                    overflowX: "auto",
                    whiteSpace: "pre-wrap",
                    fontSize: 13,
                    lineHeight: 1.55,
                  }}
                >
                  {selectedTrace ? formatTracePayload(selectedTrace.payload) : "No trace selected."}
                </pre>
              </SurfaceCard>

              <SurfaceCard tone="dark" className="stack-sm">
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <h2 style={{ margin: 0 }}>Recent events</h2>
                  <p style={{ margin: 0, color: "var(--muted)", fontSize: 12 }}>
                    Select an event to inspect its payload in detail.
                  </p>
                </div>
                <div className="activity-trace-list">
                  {tracePreview.map((trace) => (
                    <button
                      key={trace.id}
                      type="button"
                      onClick={() => setSelectedTraceId(trace.id)}
                      className="activity-trace-row"
                      style={{
                        textAlign: "left",
                        border:
                          selectedTraceId === trace.id
                            ? "1px solid rgba(164, 141, 100, 0.26)"
                            : "1px solid rgba(196, 180, 154, 0.12)",
                        background:
                          selectedTraceId === trace.id
                            ? "rgba(164, 141, 100, 0.1)"
                            : "rgba(18, 15, 12, 0.86)",
                        color: "var(--text)",
                        cursor: "pointer",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 12,
                          alignItems: "flex-start",
                          flexWrap: "wrap",
                        }}
                      >
                        <div>
                          <p
                            style={{
                              margin: "0 0 4px",
                              color: "var(--accent-strong)",
                              fontSize: 11,
                              textTransform: "uppercase",
                              letterSpacing: "0.08em",
                              fontWeight: 700,
                            }}
                          >
                            {trace.traceType}
                          </p>
                          <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>
                            {trace.eventName}
                          </p>
                        </div>
                        <p style={{ margin: 0, color: "var(--muted)", fontSize: 12 }}>
                          {formatTimestamp(trace.createdAt)}
                        </p>
                      </div>
                      <p
                        style={{
                          margin: "6px 0 0",
                          color: "var(--muted)",
                          fontSize: 12,
                          lineHeight: 1.45,
                        }}
                      >
                        {snippet(formatTracePayload(trace.payload), 180)}
                      </p>
                    </button>
                  ))}
                </div>
              </SurfaceCard>
            </>
          )}
        </div>
      </section>
    </AppPage>
  );
}
