"use client";

import { useEffect, useMemo, useState } from "react";
import type { TaskListResponse, TaskRecord } from "@secretary/core-runtime";
import { AppPage, NoticeBanner, PageHero, SurfaceCard } from "../../lib/ui";
import { formatTimestamp } from "../../lib/presenters";

function taskTone(task: TaskRecord) {
  if (task.lastDeliveryError) {
    return {
      badge: "var(--danger-soft-text)",
      border: "var(--danger-soft-border)",
      background: "var(--danger-soft-bg)",
      label: "delivery error",
    };
  }

  if (task.deliveredAt) {
    return {
      badge: "var(--success-soft-text)",
      border: "var(--success-soft-border)",
      background: "var(--success-soft-bg)",
      label: "delivered",
    };
  }

  if (task.reminderAt) {
    return {
      badge: "var(--warning-soft-text)",
      border: "var(--warning-soft-border)",
      background: "var(--warning-soft-bg)",
      label: "scheduled",
    };
  }

  return {
    badge: "var(--neutral-soft-text)",
    border: "var(--neutral-soft-border)",
    background: "var(--neutral-soft-bg)",
    label: task.status,
  };
}

export function TasksConsole() {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/tasks", { cache: "no-store" });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error ?? "Unable to load tasks.");
        }

        if (!cancelled) {
          setTasks((payload as TaskListResponse).tasks);
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load tasks.");
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
  }, []);

  const summary = useMemo(
    () => ({
      open: tasks.filter((task) => task.status === "open" || task.status === "in_progress").length,
      delivered: tasks.filter((task) => Boolean(task.deliveredAt)).length,
      pendingReminder: tasks.filter((task) => Boolean(task.reminderAt) && !task.deliveredAt).length,
      failed: tasks.filter((task) => Boolean(task.lastDeliveryError)).length,
    }),
    [tasks],
  );

  return (
    <AppPage>
      <PageHero
        eyebrow="Activity"
        title="Tasks and follow-through"
        description={
          <p>
            Tasks are part of the secretary&apos;s activity stream for now: reminders,
            delivery attempts, and open follow-through items that may grow into a fuller
            tasking system later.
          </p>
        }
        meta={
          <p>
            {error ??
              (isLoading
                ? "Loading tasks..."
                : `${summary.open} open, ${summary.pendingReminder} waiting on reminders, ${summary.failed} with delivery issues.`)}
          </p>
        }
        tone="dark"
      />

      {error ? <NoticeBanner tone="error">{error}</NoticeBanner> : null}

      <div className="summary-strip">
        {[
          ["Open", summary.open],
          ["Delivered", summary.delivered],
          ["Reminder queue", summary.pendingReminder],
          ["Delivery issues", summary.failed],
        ].map(([label, value]) => (
          <div key={String(label)} className="summary-chip">
            <p className="summary-chip-label">{label}</p>
            <p className="summary-chip-value">{value}</p>
          </div>
        ))}
      </div>

      <SurfaceCard
        tone="dark"
        title="Task queue"
        description={<p>Current reminder hooks and lightweight follow-through items.</p>}
      >
        {tasks.length === 0 ? (
          <p style={{ margin: 0, color: "var(--muted)" }}>No tasks are visible right now.</p>
        ) : (
          <div className="compact-list">
            {tasks.map((task) => {
              const tone = taskTone(task);

              return (
                <div
                  key={task.id}
                  style={{
                    display: "grid",
                    gap: 8,
                    padding: "12px 0",
                    gridTemplateColumns: "minmax(220px, 320px) auto",
                    alignItems: "start",
                  }}
                >
                  <div className="stack-sm" style={{ gap: 6 }}>
                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        alignItems: "center",
                        flexWrap: "wrap",
                      }}
                    >
                      <span
                        style={{
                          padding: "4px 9px",
                          borderRadius: 999,
                          background: tone.background,
                          border: `1px solid ${tone.border}`,
                          color: tone.badge,
                          fontSize: 11,
                          fontWeight: 700,
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                        }}
                      >
                        {tone.label}
                      </span>
                      <strong style={{ fontSize: 14 }}>{task.title}</strong>
                    </div>
                    <p style={{ margin: 0, color: "var(--muted)", fontSize: 12 }}>
                      {task.status} · due {formatTimestamp(task.dueAt)} · reminder {formatTimestamp(task.reminderAt)}
                    </p>
                  </div>
                  <div className="stack-sm" style={{ gap: 6 }}>
                    <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.5 }}>
                      {task.detail ?? "No extra task detail recorded."}
                    </p>
                    <p style={{ margin: 0, color: "var(--muted)", fontSize: 12 }}>
                      Delivery channel:{" "}
                      <strong style={{ color: "var(--text)" }}>
                        {task.deliveryChannelType ?? "not set"}
                      </strong>
                      {task.deliveryTargetRef ? ` · ${task.deliveryTargetRef}` : ""}
                    </p>
                    {task.lastDeliveryError ? (
                      <p style={{ margin: 0, color: "var(--danger-soft-text)", fontSize: 12, lineHeight: 1.45 }}>
                        {task.lastDeliveryError}
                      </p>
                    ) : task.deliveredAt ? (
                      <p style={{ margin: 0, color: "var(--success-soft-text)", fontSize: 12 }}>
                        Delivered {formatTimestamp(task.deliveredAt)}
                      </p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SurfaceCard>
    </AppPage>
  );
}
