import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type {
  AgentJobApprovalMode,
  AgentExecutionBackend,
  AgentJobSettingsRecord,
  AgentJobSettingsResponse,
  UpdateAgentJobSettingsRequest,
} from "@secretary/core-runtime";
import { normalizeApprovalMode, normalizeExecutionBackend } from "./utils.js";
import { repoRoot } from "./utils/index.js";

// Lazy initialization to avoid circular dependency issues
function getSettingsFilePath() { return resolve(repoRoot, "runtime/config/agent-jobs.json"); }

// Sentinel value written to settings on first initialization.
// Used to distinguish a fresh install from an existing one that was
// created when [] meant "allow all" (the old pickup-and-run default).
const INITIALIZED_FLAG = "initialized";

const defaultSettings: AgentJobSettingsRecord = {
  defaultWorkspacePath: null,
  defaultApprovalMode: "builder",
  executionBackend: "host_native",
  maxAgentSteps: 24,
  maxCommandTimeoutSeconds: 120,
  maxVerificationAttempts: 2,
  maxJobRuntimeMinutes: 45,
  allowNetworkAccess: true,
  browserVerificationEnabled: false,
  redactSecretsInArtifacts: true,
  // Fresh installs get [repoRoot] — safe default that still allows the agent
  // to work on project code without manual configuration.
  allowedWorkspaceRoots: [repoRoot],
};

function clampInteger(value: unknown, minimum: number, maximum: number, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}


function parseSettings(raw: Record<string, unknown> | null | undefined): AgentJobSettingsRecord {
  return {
    defaultWorkspacePath:
      typeof raw?.defaultWorkspacePath === "string" && raw.defaultWorkspacePath.trim().length > 0
        ? raw.defaultWorkspacePath.trim()
        : null,
    defaultApprovalMode: normalizeApprovalMode(raw?.defaultApprovalMode),
    executionBackend: normalizeExecutionBackend(raw?.executionBackend),
    maxAgentSteps: clampInteger(raw?.maxAgentSteps, 4, 60, defaultSettings.maxAgentSteps),
    maxCommandTimeoutSeconds: clampInteger(
      raw?.maxCommandTimeoutSeconds,
      10,
      10 * 60,
      defaultSettings.maxCommandTimeoutSeconds,
    ),
    maxVerificationAttempts: clampInteger(
      raw?.maxVerificationAttempts,
      1,
      5,
      defaultSettings.maxVerificationAttempts,
    ),
    maxJobRuntimeMinutes: clampInteger(
      raw?.maxJobRuntimeMinutes,
      5,
      8 * 60,
      defaultSettings.maxJobRuntimeMinutes,
    ),
    allowNetworkAccess: raw?.allowNetworkAccess !== false,
    browserVerificationEnabled: raw?.browserVerificationEnabled === true,
    redactSecretsInArtifacts: raw?.redactSecretsInArtifacts !== false,
    allowedWorkspaceRoots: Array.isArray(raw?.allowedWorkspaceRoots)
      ? raw.allowedWorkspaceRoots
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim())
          .filter(Boolean)
      : [],
  };
}

async function writeSettingsFile(settings: AgentJobSettingsRecord) {
  const path = getSettingsFilePath();
  await mkdir(dirname(path), { recursive: true });
  // Include _initialized sentinel so future first-run detections are reliable.
  const withSentinel = { _initialized: INITIALIZED_FLAG, ...settings };
  await writeFile(path, `${JSON.stringify(withSentinel, null, 2)}
`, "utf8");
}

export async function loadAgentJobSettings(): Promise<AgentJobSettingsRecord> {
  try {
    const parsed = JSON.parse(await readFile(getSettingsFilePath(), "utf8")) as Record<string, unknown>;
    const settings = parseSettings(parsed);

    // Migrate pre-initialized installs: if _initialized is absent and
    // allowedWorkspaceRoots is [], the old default meant "allow all".
    // Upgrade to [repoRoot] (the monorepo root) for a sane out-of-the-box
    // security boundary that still lets the agent work on project code.
    if (!parsed._initialized && settings.allowedWorkspaceRoots.length === 0) {
      const migrated = { ...settings, allowedWorkspaceRoots: [repoRoot] };
      await writeSettingsFile(migrated);
      return migrated;
    }

    return settings;
  } catch {
    await writeSettingsFile(defaultSettings);
    return defaultSettings;
  }
}

export async function getAgentJobSettings(): Promise<AgentJobSettingsResponse> {
  return {
    settings: await loadAgentJobSettings(),
  };
}

// Lock file path for serializing settings updates across concurrent worker processes.
// Lazily resolved so it is never evaluated during module initialization,
// avoiding any possibility of a TDZ hit if repoRoot is somehow accessed prematurely.
function getSettingsLockPath() {
  return join(repoRoot, "runtime", ".settings.lock");
}

async function withSettingsLock<T>(fn: () => Promise<T>): Promise<T> {
  const lockDir = getSettingsLockPath();
  let acquired = false;
  const maxAttempts = 50;
  const delayMs = 100;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await mkdir(dirname(lockDir), { recursive: true });
      await writeFile(lockDir, `${process.pid}`, { flag: "wx" });
      acquired = true;
      break;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
        throw err;
      }
      // Lock is held by another process; wait and retry.
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  if (!acquired) {
    throw new Error(
      `Could not acquire settings lock after ${maxAttempts} attempts (${lockDir}). ` +
        "Another worker process may be updating settings concurrently.",
    );
  }

  try {
    return await fn();
  } finally {
    try {
      await unlink(lockDir);
    } catch {
      // Best-effort cleanup; stale locks expire naturally on next contention.
    }
  }
}

export async function updateAgentJobSettings(
  patch: UpdateAgentJobSettingsRequest,
): Promise<AgentJobSettingsResponse> {
  return withSettingsLock(async () => {
    const current = await loadAgentJobSettings();
    const next = parseSettings({
      ...current,
      ...patch,
    });

    await writeSettingsFile(next);

    return {
      settings: next,
    };
  });
}
