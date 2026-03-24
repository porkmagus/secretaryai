"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  MemoryRecord,
  MemoryType,
  TaskRecord,
} from "@secretary/core-runtime";
import { AppPage, NoticeBanner, PageHero, StatCard, StatGrid, SurfaceCard } from "../lib/ui";
import { formatTimestamp } from "../lib/presenters";

type MemoryApiResponse = {
  memories: MemoryRecord[];
};

type TaskApiResponse = {
  tasks: TaskRecord[];
};

type EditableMemory = {
  title: string;
  summary: string;
  contentText: string;
  tags: string;
  memoryType: MemoryType;
  pinned: boolean;
  suppressed: boolean;
};

const memoryTypes: Array<MemoryType | "all"> = [
  "all",
  "semantic",
  "episodic",
  "project",
  "relationship",
  "operational",
];

export function MemoryBrowser() {
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<MemoryType | "all">("all");
  const [includeSuppressed, setIncludeSuppressed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, EditableMemory>>({});

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);

      const params = new URLSearchParams();

      if (search.trim()) {
        params.set("search", search.trim());
      }

      if (typeFilter !== "all") {
        params.set("type", typeFilter);
      }

      if (includeSuppressed) {
        params.set("includeSuppressed", "true");
      }

      try {
        const [memoryResponse, taskResponse] = await Promise.all([
          fetch(`/api/memories?${params.toString()}`, {
            cache: "no-store",
          }),
          fetch("/api/tasks", {
            cache: "no-store",
          }),
        ]);

        if (!memoryResponse.ok || !taskResponse.ok) {
          throw new Error("Request failed");
        }

        const memoryData = (await memoryResponse.json()) as MemoryApiResponse;
        const taskData = (await taskResponse.json()) as TaskApiResponse;

        if (cancelled) {
          return;
        }

        setMemories(memoryData.memories);
        setTasks(taskData.tasks);
        setDrafts((current) => {
          const next = { ...current };

          for (const memory of memoryData.memories) {
            next[memory.id] = {
              title: memory.title ?? "",
              summary: memory.summary ?? "",
              contentText: memory.contentText,
              tags: memory.tags.join(", "),
              memoryType: memory.memoryType,
              pinned: memory.pinned,
              suppressed: memory.suppressed,
            };
          }

          return next;
        });
      } catch {
        if (!cancelled) {
          setError("Unable to load memory data.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [includeSuppressed, search, typeFilter]);

  const summary = useMemo(() => {
    const pinned = memories.filter((memory) => memory.pinned).length;
    const suppressed = memories.filter((memory) => memory.suppressed).length;
    const byType = memoryTypes
      .filter((memoryType) => memoryType !== "all")
      .map((memoryType) => ({
        type: memoryType,
        count: memories.filter((memory) => memory.memoryType === memoryType).length,
      }));

    return {
      total: memories.length,
      pinned,
      suppressed,
      byType,
    };
  }, [memories]);

  async function saveMemory(memoryId: string) {
    const draft = drafts[memoryId];

    if (!draft) {
      return;
    }

    setSavingId(memoryId);
    setError(null);

    try {
      const response = await fetch(`/api/memories/${memoryId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: draft.title || null,
          summary: draft.summary || null,
          contentText: draft.contentText,
          tags: draft.tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
          memoryType: draft.memoryType,
          pinned: draft.pinned,
          suppressed: draft.suppressed,
        }),
      });

      if (!response.ok) {
        throw new Error("Request failed");
      }

      const payload = (await response.json()) as {
        memory: MemoryRecord;
      };

      setMemories((current) =>
        current.map((memory) =>
          memory.id === memoryId ? payload.memory : memory,
        ),
      );
      setDrafts((current) => ({
        ...current,
        [memoryId]: {
          title: payload.memory.title ?? "",
          summary: payload.memory.summary ?? "",
          contentText: payload.memory.contentText,
          tags: payload.memory.tags.join(", "),
          memoryType: payload.memory.memoryType,
          pinned: payload.memory.pinned,
          suppressed: payload.memory.suppressed,
        },
      }));
    } catch {
      setError("Memory update failed.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <AppPage>
      <PageHero
        eyebrow="Memory Console"
        title="Memory and context"
        description={
          <p>
            Inspect long-term memory, pin what must always matter, suppress bad entries,
            and keep an eye on reminder hooks created by the Memory Specialist.
          </p>
        }
        meta={
          <p>
            {error ??
              (isLoading
                ? "Loading memory state..."
                : `${summary.total} memories loaded, ${summary.pinned} pinned, ${summary.suppressed} suppressed.`)}
          </p>
        }
      />

      {error ? <NoticeBanner tone="error">{error}</NoticeBanner> : null}

      <section
          style={{
            display: "grid",
            gap: 20,
            gridTemplateColumns: "minmax(0, 2fr) minmax(280px, 0.95fr)",
          }}
        >
          <div
            style={{
              display: "grid",
              gap: 16,
              alignContent: "start",
            }}
          >
            <StatGrid>
              <StatCard label="Memories" value={summary.total} detail="Current long-term memory entries" />
              <StatCard label="Pinned" value={summary.pinned} detail="Always-important memory items" />
              <StatCard label="Suppressed" value={summary.suppressed} detail="Entries hidden from normal recall" />
            </StatGrid>

            <SurfaceCard className="stack-md">
              <div
                style={{
                  display: "grid",
                  gap: 12,
                  gridTemplateColumns: "minmax(0, 1.4fr) minmax(180px, 0.6fr) auto",
                  alignItems: "center",
                }}
              >
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search memory text, summaries, or tags"
                  />
                  <select
                    value={typeFilter}
                    onChange={(event) =>
                      setTypeFilter(event.target.value as MemoryType | "all")
                    }
                  >
                    {memoryTypes.map((memoryType) => (
                      <option key={memoryType} value={memoryType}>
                      {memoryType}
                    </option>
                  ))}
                </select>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    color: "var(--muted)",
                    fontSize: 14,
                  }}
                >
                  <input
                    checked={includeSuppressed}
                    onChange={(event) => setIncludeSuppressed(event.target.checked)}
                    type="checkbox"
                  />
                  Show suppressed
                </label>
              </div>
              <p style={{ margin: 0, color: "var(--muted)", fontSize: 14 }}>
                {error ??
                  (isLoading
                    ? "Loading memory state..."
                    : `${summary.total} memories loaded, ${summary.pinned} pinned, ${summary.suppressed} suppressed.`)}
              </p>
            </SurfaceCard>

            {memories.map((memory) => {
              const draft = drafts[memory.id];

              if (!draft) {
                return null;
              }

              return (
                <article
                  key={memory.id}
                  style={{
                    padding: 20,
                    borderRadius: 24,
                    border: "1px solid var(--border)",
                    background: "var(--panel-strong)",
                    display: "grid",
                    gap: 14,
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
                        {memory.memoryType}
                      </p>
                      <h2 style={{ margin: "8px 0 0", fontSize: 22 }}>
                        {memory.title ?? "Untitled Memory"}
                      </h2>
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gap: 6,
                        justifyItems: "end",
                        color: "var(--muted)",
                        fontSize: 13,
                      }}
                    >
                      <span>importance {memory.importanceScore}</span>
                      <span>confidence {memory.confidenceScore}</span>
                      <span>updated {formatTimestamp(memory.updatedAt)}</span>
                      <span>last accessed {formatTimestamp(memory.lastAccessedAt)}</span>
                    </div>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gap: 12,
                      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                    }}
                  >
                    <input
                      value={draft.title}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [memory.id]: {
                            ...current[memory.id],
                            title: event.target.value,
                          },
                        }))
                      }
                      placeholder="Title"
                    />
                    <input
                      value={draft.tags}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [memory.id]: {
                            ...current[memory.id],
                            tags: event.target.value,
                          },
                        }))
                      }
                      placeholder="tags, comma, separated"
                    />
                  </div>

                  <textarea
                    value={draft.summary}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [memory.id]: {
                          ...current[memory.id],
                          summary: event.target.value,
                        },
                      }))
                    }
                    rows={2}
                    placeholder="Summary"
                  />

                  <textarea
                    value={draft.contentText}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [memory.id]: {
                          ...current[memory.id],
                          contentText: event.target.value,
                        },
                      }))
                    }
                    rows={4}
                    placeholder="Memory content"
                  />

                  <div
                    style={{
                      display: "flex",
                      gap: 16,
                      flexWrap: "wrap",
                      color: "var(--muted)",
                      fontSize: 14,
                    }}
                  >
                    <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input
                        checked={draft.pinned}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [memory.id]: {
                              ...current[memory.id],
                              pinned: event.target.checked,
                            },
                          }))
                        }
                        type="checkbox"
                      />
                      pinned
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input
                        checked={draft.suppressed}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [memory.id]: {
                              ...current[memory.id],
                              suppressed: event.target.checked,
                            },
                          }))
                        }
                        type="checkbox"
                      />
                      suppressed
                    </label>
                    <span>source: {memory.sourceRef ?? "n/a"}</span>
                    {memory.tags.map((tag) => (
                      <span
                        key={`${memory.id}-${tag}`}
                        style={{
                          padding: "4px 8px",
                          borderRadius: 999,
                          background: "rgba(15, 118, 110, 0.08)",
                          color: "var(--accent)",
                          fontSize: 12,
                          fontWeight: 700,
                        }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 16,
                      flexWrap: "wrap",
                      alignItems: "center",
                    }}
                  >
                    <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
                      provenance is currently conversation/message linked in the worker trace chain
                    </p>
                    <button
                      type="button"
                      onClick={() => void saveMemory(memory.id)}
                      disabled={savingId === memory.id}
                      className="button-primary"
                      style={{ opacity: savingId === memory.id ? 0.7 : 1 }}
                    >
                      {savingId === memory.id ? "Saving..." : "Save Memory"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          <aside
            style={{
              display: "grid",
              gap: 20,
              alignContent: "start",
            }}
          >
            <SurfaceCard title="Reminder hooks" className="stack-md">
              <div style={{ display: "grid", gap: 12 }}>
                {tasks.length === 0 ? (
                  <p style={{ margin: 0, color: "var(--muted)" }}>
                    No extracted reminder/task hooks yet.
                  </p>
                ) : (
                  tasks.map((task) => (
                    <article
                      key={task.id}
                      style={{
                        padding: 14,
                        borderRadius: 16,
                        border: "1px solid rgba(64, 89, 112, 0.12)",
                        background: "rgba(255, 255, 255, 0.68)",
                      }}
                    >
                      <p style={{ margin: "0 0 6px", fontWeight: 700 }}>{task.title}</p>
                      <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.5 }}>
                        {task.detail ?? "No extra detail."}
                      </p>
                      <p style={{ margin: "8px 0 0", color: "var(--muted)", fontSize: 12 }}>
                        {task.status} · {formatTimestamp(task.reminderAt ?? task.dueAt)}
                      </p>
                    </article>
                  ))
                )}
              </div>
            </SurfaceCard>

            <SurfaceCard title="Type mix" className="stack-sm">
              <div style={{ display: "grid", gap: 10 }}>
                {summary.byType.map((entry) => (
                  <div
                    key={entry.type}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      color: "var(--muted)",
                    }}
                  >
                    <span>{entry.type}</span>
                    <strong style={{ color: "var(--text)" }}>{entry.count}</strong>
                  </div>
                ))}
              </div>
            </SurfaceCard>
          </aside>
        </section>
    </AppPage>
  );
}
