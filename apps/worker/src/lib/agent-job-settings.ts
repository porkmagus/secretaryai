import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AgentJobApprovalMode,
  AgentJobSettingsRecord,
  AgentJobSettingsResponse,
  UpdateAgentJobSettingsRequest,
} from "@secretary/core-runtime";

const repoRoot = resolve(fileURLToPath(new URL("../../../../", import.meta.url)));
const settingsFilePath = resolve(repoRoot, "runtime/config/agent-jobs.json");

const defaultSettings: AgentJobSettingsRecord = {
  defaultWorkspacePath: null,
  defaultApprovalMode: "builder",
  maxAgentSteps: 24,
  maxCommandTimeoutSeconds: 120,
  maxVerificationAttempts: 2,
};

function clampInteger(value: unknown, minimum: number, maximum: number, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function normalizeApprovalMode(value: unknown): AgentJobApprovalMode {
  if (value === "restrictive" || value === "full_access") {
    return value;
  }

  return "builder";
}

function parseSettings(raw: Record<string, unknown> | null | undefined): AgentJobSettingsRecord {
  return {
    defaultWorkspacePath:
      typeof raw?.defaultWorkspacePath === "string" && raw.defaultWorkspacePath.trim().length > 0
        ? raw.defaultWorkspacePath.trim()
        : null,
    defaultApprovalMode: normalizeApprovalMode(raw?.defaultApprovalMode),
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
  };
}

async function writeSettingsFile(settings: AgentJobSettingsRecord) {
  await mkdir(dirname(settingsFilePath), { recursive: true });
  await writeFile(settingsFilePath, `${JSON.stringify(settings, null, 2)}
`, "utf8");
}

export async function loadAgentJobSettings(): Promise<AgentJobSettingsRecord> {
  try {
    const parsed = JSON.parse(await readFile(settingsFilePath, "utf8")) as Record<string, unknown>;
    return parseSettings(parsed);
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

export async function updateAgentJobSettings(
  patch: UpdateAgentJobSettingsRequest,
): Promise<AgentJobSettingsResponse> {
  const current = await loadAgentJobSettings();
  const next = parseSettings({
    ...current,
    ...patch,
  });

  await writeSettingsFile(next);

  return {
    settings: next,
  };
}
