import { constants as fsConstants, statSync } from "node:fs";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AgentExecutionBackend,
  AgentJobApprovalMode,
  RuntimeChatRequest,
} from "@secretary/core-runtime";
import type { DbClient } from "@secretary/db";
import { findConversationIdByChannelRef } from "./chat-persistence.js";

// ─── Path helpers ───────────────────────────────────────────────────────────

function fileExists(p: string): boolean {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

function computeRepoRoot(): string {
  try {
    const fromFile = fileURLToPath(import.meta.url);
    let dir = resolve(fromFile, "..");
    for (let i = 0; i < 8; i++) {
      if (fileExists(resolve(dir, "apps")) && fileExists(resolve(dir, "packages"))) {
        return dir;
      }
      dir = resolve(dir, "..");
    }
    return resolve(fromFile, "../../../../");
  } catch {
    return resolve();
  }
}

const _computedRepoRoot = computeRepoRoot();
try {
  if (!fileExists(_computedRepoRoot)) {
    throw new Error(`repoRoot fallback path does not exist: ${_computedRepoRoot}`);
  }
} catch (err) {
  throw new Error(
    `Failed to initialize repoRoot: ${err instanceof Error ? err.message : String(err)}`,
  );
}

export const repoRoot = _computedRepoRoot;

export function resolveRepoPath(...segments: string[]): string {
  return resolve(repoRoot, ...segments);
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

export function sanitizeFileNamePart(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

// ─── Text helpers ───────────────────────────────────────────────────────────

export function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export function cleanTextPreserveCase(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// ─── Conversation helpers ───────────────────────────────────────────────────

export async function resolveConversationId(
  dbClient: DbClient,
  request: RuntimeChatRequest,
): Promise<string | null> {
  if (request.conversationId) {
    return request.conversationId;
  }
  if (request.channel === "telegram" && request.metadata?.telegramChatId) {
    return findConversationIdByChannelRef(dbClient, "telegram", request.metadata.telegramChatId);
  }
  return null;
}

// ─── Observability ──────────────────────────────────────────────────────────

export function logAgentEvent(_event: {
  type: string;
  reason?: string;
  textPreview?: string;
  toolKey?: string;
  durationMs?: number;
  resultCount?: number;
  [key: string]: unknown;
}) {}

export function logFallbackTriggered(reason: string, text: string) {
  logAgentEvent({
    type: "fallback.triggered",
    reason,
    textPreview: text.slice(0, 100),
  });
}

export function logToolExecution(params: {
  toolKey: string;
  durationMs: number;
  success: boolean;
  resultCount?: number;
  error?: string;
}) {
  logAgentEvent({
    type: "tool.execution",
    ...params,
  });
}

export function logMemoryRetrieval(params: {
  query: string;
  durationMs: number;
  resultsCount: number;
  topScore?: number;
}) {
  logAgentEvent({
    type: "memory.retrieval",
    ...params,
  });
}

export function logError(params: {
  service: string;
  event: string;
  error: unknown;
  traceId?: string | null;
  metadataJson?: Record<string, unknown>;
}) {
  const _errorObj =
    params.error instanceof Error
      ? {
          name: params.error.name,
          message: params.error.message,
          stack: params.error.stack,
        }
      : params.error;
}

// ─── Normalization helpers ──────────────────────────────────────────────────

export function normalizeApprovalMode(value: unknown): AgentJobApprovalMode {
  if (value === "restrictive" || value === "full_access") {
    return value;
  }
  return "builder";
}

export function normalizeExecutionBackend(value: unknown): AgentExecutionBackend {
  if (value === "wsl_bash" || value === "docker_sandbox") {
    return value;
  }
  return "host_native";
}
