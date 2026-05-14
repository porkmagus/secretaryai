import type {
  MemoryRecord,
  MemoryType,
  RuntimeMemoryContextItem,
  RuntimeTaskContextItem,
  TaskRecord,
} from "@secretary/core-runtime";
import type { memoryEntries, tasks } from "@secretary/db";

export function toMemoryRecord(record: typeof memoryEntries.$inferSelect): MemoryRecord {
  return {
    id: record.id,
    memoryType: record.memoryType as MemoryType,
    title: record.title,
    summary: record.summary,
    contentText: record.contentText,
    importanceScore: record.importanceScore,
    confidenceScore: record.confidenceScore,
    pinned: record.pinned,
    suppressed: record.suppressed,
    sourceKind: record.sourceKind,
    sourceRef: record.sourceRef,
    tags: record.tags ?? [],
    lastAccessedAt: record.lastAccessedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function toRuntimeMemoryContextItem(
  record: typeof memoryEntries.$inferSelect,
): RuntimeMemoryContextItem {
  return {
    id: record.id,
    memoryType: record.memoryType as MemoryType,
    title: record.title,
    summary: record.summary,
    contentText: record.contentText,
    importanceScore: record.importanceScore,
    confidenceScore: record.confidenceScore,
    pinned: record.pinned,
    sourceRef: record.sourceRef,
    tags: record.tags ?? [],
  };
}

export function toRuntimeTaskContextItem(
  record: typeof tasks.$inferSelect,
): RuntimeTaskContextItem {
  return {
    id: record.id,
    title: record.title,
    detail: record.detail,
    status: record.status,
    dueAt: record.dueAt?.toISOString() ?? null,
    reminderAt: record.reminderAt?.toISOString() ?? null,
  };
}

export function toTaskRecord(record: typeof tasks.$inferSelect): TaskRecord {
  return {
    id: record.id,
    title: record.title,
    detail: record.detail,
    status: record.status,
    dueAt: record.dueAt?.toISOString() ?? null,
    reminderAt: record.reminderAt?.toISOString() ?? null,
    deliveredAt: record.deliveredAt?.toISOString() ?? null,
    deliveryChannelType: record.deliveryChannelType,
    deliveryTargetRef: record.deliveryTargetRef,
    lastDeliveryError: record.lastDeliveryError,
  };
}
