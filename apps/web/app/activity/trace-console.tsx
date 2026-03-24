"use client";

import { useEffect, useState } from "react";
import type {
  ActivityTraceResponse,
  ConversationListItem,
  ConversationListResponse,
} from "@secretary/core-runtime";
import { formatTimestamp, formatTracePayload, snippet } from "../lib/presenters";

export function ActivityConsole() {
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [traces, setTraces] = useState<ActivityTraceResponse["traces"]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

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

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "32px 18px 48px",
      }}
    >
      <section
        style={{
          width: "min(1220px, 100%)",
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
            Activity Console
          </p>
          <h1
            style={{
              margin: "12px 0 10px",
              fontSize: "clamp(2.1rem, 4vw, 4rem)",
              lineHeight: 1,
            }}
          >
            Runtime Trace Inspection
          </h1>
          <p
            style={{
              margin: 0,
              maxWidth: 760,
              color: "var(--muted)",
              fontSize: 17,
              lineHeight: 1.6,
            }}
          >
            Walk recent conversations, inspect runtime context assembly, and confirm
            when memory or specialist work shaped a response.
          </p>
        </header>

        <section
          style={{
            display: "grid",
            gap: 20,
            gridTemplateColumns: "minmax(280px, 0.9fr) minmax(0, 1.7fr)",
          }}
        >
          <aside
            style={{
              padding: 20,
              borderRadius: 24,
              border: "1px solid var(--border)",
              background: "var(--panel-strong)",
              display: "grid",
              gap: 12,
              alignContent: "start",
            }}
          >
            <h2 style={{ margin: 0 }}>Recent Conversations</h2>
            <p style={{ margin: 0, color: "var(--muted)", fontSize: 14 }}>
              {error ?? (isLoading ? "Loading conversations..." : `${conversations.length} available`)}
            </p>
            {conversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                onClick={() => setSelectedConversationId(conversation.id)}
                style={{
                  textAlign: "left",
                  borderRadius: 18,
                  border:
                    selectedConversationId === conversation.id
                      ? "1px solid rgba(125, 211, 252, 0.42)"
                      : "1px solid rgba(148, 163, 184, 0.14)",
                  background:
                    selectedConversationId === conversation.id
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
                  {conversation.channelType} · {conversation.messageCount} messages ·{" "}
                  {formatTimestamp(conversation.lastMessageAt)}
                </p>
              </button>
            ))}
          </aside>

          <div
            style={{
              display: "grid",
              gap: 14,
              alignContent: "start",
            }}
          >
            {traces.length === 0 ? (
              <article
                style={{
                  padding: 20,
                  borderRadius: 24,
                  border: "1px solid var(--border)",
                  background: "var(--panel-strong)",
                }}
              >
                <p style={{ margin: 0, color: "var(--muted)" }}>
                  Select a conversation to inspect activity traces.
                </p>
              </article>
            ) : (
              traces.map((trace) => (
                <article
                  key={trace.id}
                  style={{
                    padding: 18,
                    borderRadius: 22,
                    border: "1px solid var(--border)",
                    background: "var(--panel-strong)",
                    display: "grid",
                    gap: 8,
                  }}
                >
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
                        style={{
                          margin: 0,
                          color: "var(--accent)",
                          fontSize: 12,
                          fontWeight: 700,
                          letterSpacing: "0.08em",
                          textTransform: "uppercase",
                        }}
                      >
                        {trace.traceType}
                      </p>
                      <h2 style={{ margin: "6px 0 0", fontSize: 22 }}>{trace.eventName}</h2>
                    </div>
                    <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
                      {formatTimestamp(trace.createdAt)}
                    </p>
                  </div>
                  <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.6 }}>
                    {formatTracePayload(trace.payload)}
                  </p>
                </article>
              ))
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
