import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import type { AgentExecutionBackend, AgentJobApprovalMode } from "@secretary/core-runtime";

/**
 * Check if a path exists.
 */
export async function pathExists(path: string) {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate and normalize AgentJobApprovalMode.
 */
export function normalizeApprovalMode(value: unknown): AgentJobApprovalMode {
  if (value === "restrictive" || value === "full_access") {
    return value;
  }

  return "builder";
}

/**
 * Validate and normalize AgentExecutionBackend.
 */
export function normalizeExecutionBackend(value: unknown): AgentExecutionBackend {
  if (value === "wsl_bash" || value === "docker_sandbox") {
    return value;
  }

  return "host_native";
}

/**
 * Standardized JSON logging for worker errors to avoid bare catch blocks.
 */
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
