"use client";

import { useEffect, useState } from "react";
import type {
  ActivityTraceResponse,
  ConversationListItem,
  ConversationListResponse,
} from "@secretary/core-runtime";
import { AppPage, PageHero, SurfaceCard } from "../lib/ui";
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
    <AppPage>
      <PageHero
        eyebrow="Activity Console"
        title="Runtime trace inspection"
        description={
          <p>
            Walk recent conversations, inspect runtime context assembly, and confirm
            when memory or specialist work shaped a response.
          </p>
        }
        tone="dark"
      />

      <section
        style={{
          display: "grid",
          gap: 20,
          gridTemplateColumns: "minmax(280px, 0.9fr) minmax(0, 1.7fr)",
        }}
      >
        <SurfaceCard
          title="Recent conversations"
          description={
            <p>
              {error ??
                (isLoading ? "Loading conversations..." : `${conversations.length} available`)}
            </p>
          }
          className="stack-sm"
        >
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
                    ? "1px solid rgba(15, 118, 110, 0.26)"
                    : "1px solid rgba(64, 89, 112, 0.12)",
                background:
                  selectedConversationId === conversation.id
                    ? "rgba(15, 118, 110, 0.08)"
                    : "rgba(255, 255, 255, 0.58)",
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
        </SurfaceCard>

        <div
          style={{
            display: "grid",
            gap: 14,
            alignContent: "start",
          }}
        >
          {traces.length === 0 ? (
            <SurfaceCard>
              <p style={{ margin: 0, color: "var(--muted)" }}>
                Select a conversation to inspect activity traces.
              </p>
            </SurfaceCard>
          ) : (
            traces.map((trace) => (
              <SurfaceCard key={trace.id} tone="dark" className="stack-sm">
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
                      style={{ marginBottom: 6, color: "#7dd3fc", letterSpacing: "0.08em" }}
                    >
                      {trace.traceType}
                    </p>
                    <h2 style={{ margin: 0, fontSize: 22 }}>{trace.eventName}</h2>
                  </div>
                  <p style={{ margin: 0, color: "rgba(237, 245, 255, 0.68)", fontSize: 13 }}>
                    {formatTimestamp(trace.createdAt)}
                  </p>
                </div>
                <pre
                  style={{
                    margin: 0,
                    padding: 14,
                    borderRadius: 16,
                    background: "rgba(8, 15, 23, 0.38)",
                    color: "#dbeafe",
                    overflowX: "auto",
                    whiteSpace: "pre-wrap",
                    fontSize: 13,
                    lineHeight: 1.55,
                  }}
                >
                  {formatTracePayload(trace.payload)}
                </pre>
              </SurfaceCard>
            ))
          )}
        </div>
      </section>
    </AppPage>
  );
}
