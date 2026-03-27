"use client";

import { useEffect, useMemo, useState } from "react";
import type { MemoryRecord, MemoryType, TaskRecord } from "@secretary/core-runtime";
import { AppPage, NoticeBanner, PageHero, SurfaceCard, ToggleField } from "../lib/ui";
import { formatTimestamp, snippet } from "../lib/presenters";

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
  const [selectedMemoryId, setSelectedMemoryId] = useState<string | null>(null);
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
        setSelectedMemoryId((current) => {
          if (memoryData.memories.length === 0) {
            return null;
          }

          if (current && memoryData.memories.some((memory) => memory.id === current)) {
            return current;
          }

          return memoryData.memories[0]?.id ?? null;
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
      byType,
      pinned,
      suppressed,
      total: memories.length,
    };
  }, [memories]);

  const selectedMemory =
    memories.find((memory) => memory.id === selectedMemoryId) ?? memories[0] ?? null;
  const selectedDraft = selectedMemory ? drafts[selectedMemory.id] : null;
  const visibleTasks = tasks.slice(0, 6);

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

      const payload = (await response.json()) as { memory: MemoryRecord };

      setMemories((current) =>
        current.map((memory) => (memory.id === memoryId ? payload.memory : memory)),
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
            Browse the Secretary&apos;s memory base the same way you inspect traces:
            scan a compact list, then open one item at a time in focus.
          </p>
        }
        meta={
          <p>
            {error ??
              (isLoading
                ? "Loading memory state..."
                : `${summary.total} memories in view, ${summary.pinned} pinned, ${summary.suppressed} suppressed.`)}
          </p>
        }
        tone="dark"
      />

      {error ? <NoticeBanner tone="error">{error}</NoticeBanner> : null}

      <div className="summary-strip">
        {[
          ["Memories", summary.total],
          ["Pinned", summary.pinned],
          ["Suppressed", summary.suppressed],
          ["Reminder hooks", tasks.length],
        ].map(([label, value]) => (
          <div key={String(label)} className="summary-chip">
            <p className="summary-chip-label">{label}</p>
            <p className="summary-chip-value">{value}</p>
          </div>
        ))}
      </div>

      <section className="inspector-grid">
        <aside className="inspector-sidebar">
          <SurfaceCard
            tone="dark"
            title="Memory navigator"
            description={<p>Filter the corpus, then open one memory in the inspector.</p>}
            className="stack-sm"
          >
            <div
              style={{
                display: "grid",
                gap: 10,
              }}
            >
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search memory text, summaries, or tags"
              />
              <select
                value={typeFilter}
                onChange={(event) => setTypeFilter(event.target.value as MemoryType | "all")}
              >
                {memoryTypes.map((memoryType) => (
                  <option key={memoryType} value={memoryType}>
                    {memoryType}
                  </option>
                ))}
              </select>
              <ToggleField
                checked={includeSuppressed}
                onChange={setIncludeSuppressed}
                label="Show suppressed"
                hint="Include hidden or muted memory items in the navigator."
              />
            </div>

            <div className="compact-list inspector-list">
              {memories.length === 0 ? (
                <p style={{ margin: 0, color: "var(--muted)" }}>
                  No memories match the current filters.
                </p>
              ) : (
                memories.map((memory) => (
                  <button
                    key={memory.id}
                    type="button"
                    onClick={() => setSelectedMemoryId(memory.id)}
                    className="inspector-list-row"
                    style={{
                      textAlign: "left",
                      border:
                        selectedMemory?.id === memory.id
                          ? "1px solid rgba(164, 141, 100, 0.26)"
                          : "1px solid rgba(196, 180, 154, 0.12)",
                      background:
                        selectedMemory?.id === memory.id
                          ? "rgba(164, 141, 100, 0.1)"
                          : "rgba(18, 15, 12, 0.82)",
                      color: "var(--text)",
                      cursor: "pointer",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 10,
                        alignItems: "flex-start",
                      }}
                    >
                      <div>
                        <p
                          style={{
                            margin: "0 0 4px",
                            color: "var(--accent)",
                            fontSize: 11,
                            fontWeight: 700,
                            letterSpacing: "0.08em",
                            textTransform: "uppercase",
                          }}
                        >
                          {memory.memoryType}
                        </p>
                        <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>
                          {memory.title ?? "Untitled memory"}
                        </p>
                      </div>
                      <span style={{ color: "var(--muted)", fontSize: 11 }}>
                        {memory.pinned ? "Pinned" : memory.suppressed ? "Suppressed" : ""}
                      </span>
                    </div>
                    <p style={{ margin: "6px 0 0", color: "var(--muted)", fontSize: 12, lineHeight: 1.45 }}>
                      {snippet(memory.summary ?? memory.contentText, 120)}
                    </p>
                  </button>
                ))
              )}
            </div>
          </SurfaceCard>

          <SurfaceCard title="Reminder hooks" className="stack-sm">
            {visibleTasks.length === 0 ? (
              <p style={{ margin: 0, color: "var(--muted)" }}>
                No reminder hooks are visible right now.
              </p>
            ) : (
              <div className="compact-list">
                {visibleTasks.map((task) => (
                  <div key={task.id} style={{ display: "grid", gap: 6, padding: "12px 0" }}>
                    <p style={{ margin: 0, fontWeight: 700 }}>{task.title}</p>
                    <p style={{ margin: 0, color: "var(--muted)", fontSize: 12, lineHeight: 1.45 }}>
                      {task.status} · {formatTimestamp(task.reminderAt ?? task.dueAt)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </SurfaceCard>
        </aside>

        <div className="inspector-panel">
          {!selectedMemory || !selectedDraft ? (
            <SurfaceCard>
              <p style={{ margin: 0, color: "var(--muted)" }}>
                Select a memory from the navigator to inspect it.
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
                    flexWrap: "wrap",
                    alignItems: "flex-start",
                  }}
                >
                  <div className="stack-sm" style={{ gap: 6 }}>
                    <p
                      className="eyebrow"
                      style={{ marginBottom: 0, color: "var(--accent-strong)", letterSpacing: "0.08em" }}
                    >
                      {selectedMemory.memoryType}
                    </p>
                    <h2 style={{ margin: 0, fontSize: 24 }}>
                      {selectedMemory.title ?? "Untitled memory"}
                    </h2>
                    <p style={{ margin: 0, color: "var(--muted)", fontSize: 14, lineHeight: 1.5 }}>
                      Source {selectedMemory.sourceRef ?? "n/a"} · updated {formatTimestamp(selectedMemory.updatedAt)}
                    </p>
                  </div>
                  <div className="desk-live-row" style={{ minWidth: "min(100%, 360px)" }}>
                    <div className="desk-live-chip">
                      <p className="desk-live-chip-label">Importance</p>
                      <p className="desk-live-chip-value">{selectedMemory.importanceScore}</p>
                    </div>
                    <div className="desk-live-chip">
                      <p className="desk-live-chip-label">Confidence</p>
                      <p className="desk-live-chip-value">{selectedMemory.confidenceScore}</p>
                    </div>
                    <div className="desk-live-chip">
                      <p className="desk-live-chip-label">Last used</p>
                      <p className="desk-live-chip-value">
                        {formatTimestamp(selectedMemory.lastAccessedAt)}
                      </p>
                    </div>
                  </div>
                </div>
              </SurfaceCard>

              <SurfaceCard title="Memory inspector" className="stack-md">
                <div
                  style={{
                    display: "grid",
                    gap: 12,
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  }}
                >
                  <input
                    value={selectedDraft.title}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [selectedMemory.id]: {
                          ...current[selectedMemory.id],
                          title: event.target.value,
                        },
                      }))
                    }
                    placeholder="Title"
                  />
                  <input
                    value={selectedDraft.tags}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [selectedMemory.id]: {
                          ...current[selectedMemory.id],
                          tags: event.target.value,
                        },
                      }))
                    }
                    placeholder="tags, comma, separated"
                  />
                </div>

                <textarea
                  value={selectedDraft.summary}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [selectedMemory.id]: {
                        ...current[selectedMemory.id],
                        summary: event.target.value,
                      },
                    }))
                  }
                  rows={3}
                  placeholder="Summary"
                />

                <textarea
                  value={selectedDraft.contentText}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [selectedMemory.id]: {
                        ...current[selectedMemory.id],
                        contentText: event.target.value,
                      },
                    }))
                  }
                  rows={9}
                  placeholder="Memory content"
                />

                <div
                  style={{
                    display: "grid",
                    gap: 12,
                    gridTemplateColumns: "minmax(160px, 220px) auto",
                    alignItems: "center",
                  }}
                >
                  <select
                    value={selectedDraft.memoryType}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [selectedMemory.id]: {
                          ...current[selectedMemory.id],
                          memoryType: event.target.value as MemoryType,
                        },
                      }))
                    }
                  >
                    {memoryTypes
                      .filter((memoryType) => memoryType !== "all")
                      .map((memoryType) => (
                        <option key={memoryType} value={memoryType}>
                          {memoryType}
                        </option>
                      ))}
                  </select>
                  <div
                    style={{
                      display: "flex",
                      gap: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    <ToggleField
                      checked={selectedDraft.pinned}
                      onChange={(next) =>
                        setDrafts((current) => ({
                          ...current,
                          [selectedMemory.id]: {
                            ...current[selectedMemory.id],
                            pinned: next,
                          },
                        }))
                      }
                      label="Pinned"
                      hint="Keep this memory surfaced more aggressively."
                    />
                    <ToggleField
                      checked={selectedDraft.suppressed}
                      onChange={(next) =>
                        setDrafts((current) => ({
                          ...current,
                          [selectedMemory.id]: {
                            ...current[selectedMemory.id],
                            suppressed: next,
                          },
                        }))
                      }
                      label="Suppressed"
                      hint="Hide it from normal recall without deleting it."
                    />
                  </div>
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
                    Tags: {selectedMemory.tags.length > 0 ? selectedMemory.tags.join(", ") : "none yet"}
                  </p>
                  <button
                    type="button"
                    onClick={() => void saveMemory(selectedMemory.id)}
                    disabled={savingId === selectedMemory.id}
                    className="button-primary"
                    style={{ opacity: savingId === selectedMemory.id ? 0.7 : 1 }}
                  >
                    {savingId === selectedMemory.id ? "Saving..." : "Save Memory"}
                  </button>
                </div>
              </SurfaceCard>

              <SurfaceCard title="Type mix" className="stack-sm">
                <div className="summary-strip">
                  {summary.byType.map((entry) => (
                    <div key={entry.type} className="summary-chip">
                      <p className="summary-chip-label">{entry.type}</p>
                      <p className="summary-chip-value">{entry.count}</p>
                    </div>
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
