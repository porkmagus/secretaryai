import { execFile, execSync } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import net from "node:net";
import { promisify } from "node:util";
import { ToolLoopAgent, stepCountIs, tool, type ModelMessage, type ToolApprovalResponse } from "ai";
import { z } from "zod";
import type {
  AgentExecutionBackend,
  AgentJobApprovalMode,
  AgentJobRequirementKind,
  AgentJobSettingsRecord,
} from "@secretary/core-runtime";
import {
  createAgentJobArtifactStorageKey,
  ensureAgentJobArtifactStoragePath,
} from "./agent-job-artifact-storage.js";
import { resolveInferenceLanguageModel, type InferenceRuntimeConfig } from "./ai-sdk-registry.js";

const execFileAsync = promisify(execFile);
const MAX_FILE_READ_BYTES = 200_000;
const MAX_TEXT_OUTPUT = 16_000;

type JobRequestShape = {
  title: string;
  goal: string;
  workspacePath: string;
  constraints: string[];
  deliverables: string[];
};

type SerializedAgentMessage = ModelMessage;

type ApprovalRequestRecord = {
  approvalId: string;
  toolCallId: string;
  toolName: string;
  input: unknown;
};

type AgentStepSnapshot = {
  stepNumber: number;
  finishReason: string;
  text: string;
  reasoningText: string | null;
  toolCalls: Array<{
    toolCallId: string;
    toolName: string;
    input: unknown;
  }>;
  toolResults: Array<{
    toolCallId: string;
    toolName: string;
    output: unknown;
  }>;
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  };
};

type CommandLogRecord = {
  command: string;
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
};

type AgentRunOutcome = {
  kind: "completed" | "needs_approval";
  finalText: string;
  blockerSummary: string | null;
  messages: SerializedAgentMessage[];
  approvalRequests: ApprovalRequestRecord[];
  stepSnapshots: AgentStepSnapshot[];
  commandLogs: CommandLogRecord[];
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  };
};

export type DetectedExecutionRequirement = {
  kind: AgentJobRequirementKind;
  label: string;
  detail: string;
  metadataJson?: Record<string, unknown>;
};

type AgentToolName =
  | "list_directory"
  | "search_files"
  | "read_file"
  | "write_file"
  | "replace_in_file"
  | "make_directory"
  | "remove_path"
  | "run_command"
  | "probe_http"
  | "check_port"
  | "browser_visit"
  | "web_search"
  | "fetch_url"
  | "download_url"
  | "site_crawl";

type CommandExecutionResult = {
  command: string;
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
};

type ExecutionRunner = {
  backend: AgentExecutionBackend;
  label: string;
  runShellCommand(params: {
    command: string;
    cwd: string;
    timeoutSeconds: number;
    settings: AgentJobSettingsRecord;
  }): Promise<CommandExecutionResult>;
};

function truncateText(text: string, maxLength = MAX_TEXT_OUTPUT) {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength)}\n...[truncated ${text.length - maxLength} chars]`;
}

// Tracks whether the WSL fallback warning has been emitted this process lifetime.
let wslFallbackWarned = false;

function resolveExecutionBackend(backend: AgentExecutionBackend): AgentExecutionBackend {
  if (backend === "wsl_bash" && process.platform !== "win32") {
    if (!wslFallbackWarned) {
      wslFallbackWarned = true;
      // eslint-disable-next-line no-console
      console.warn(
        "[Secretary] executionBackend is set to 'wsl_bash' but WSL is only available on Windows. " +
          "Falling back to 'host_native'. Set executionBackend to 'host_native' to silence this.",
      );
    }
    return "host_native";
  }

  return backend;
}

export function normalizeWorkspacePath(
  inputPath: string,
  backend: AgentExecutionBackend = "host_native",
) {
  const trimmed = inputPath.trim();
  const windowsMatch = trimmed.match(/^([A-Za-z]):[\\/](.*)$/);
  const wslMountMatch = trimmed.match(/^\/mnt\/([A-Za-z])\/(.*)$/);
  const isWindowsHost = process.platform === "win32";
  const resolvedBackend = resolveExecutionBackend(backend);
  const wantsWslPath = resolvedBackend === "wsl_bash";

  if (windowsMatch) {
    const [, drive, rest] = windowsMatch;
    if (isWindowsHost && !wantsWslPath) {
      const normalizedRest = rest.replaceAll("/", "\\");
      return `${drive.toUpperCase()}:\\${normalizedRest}`;
    }

    const normalizedRest = rest.replaceAll("\\", "/");
    return `/mnt/${drive.toLowerCase()}/${normalizedRest}`;
  }

  if (wslMountMatch) {
    const [, drive, rest] = wslMountMatch;
    if (isWindowsHost && !wantsWslPath) {
      return `${drive.toUpperCase()}:\\${rest.replaceAll("/", "\\")}`;
    }

    return `/mnt/${drive.toLowerCase()}/${rest.replaceAll("\\", "/")}`;
  }

  if (isWindowsHost && !wantsWslPath) {
    return trimmed.replaceAll("/", "\\");
  }

  return trimmed.replaceAll("\\", "/");
}

function normalizePathForWorkspace(value: string) {
  return normalizeWorkspacePath(value).replace(/\/+/g, "/");
}

function ensureWithinWorkspace(workspacePath: string, targetPath: string) {
  const workspaceRoot = resolve(workspacePath);
  const normalizedTarget = normalizePathForWorkspace(targetPath);
  const absoluteTarget = isAbsolute(normalizedTarget)
    ? resolve(normalizedTarget)
    : resolve(workspaceRoot, normalizedTarget);

  if (absoluteTarget !== workspaceRoot && !absoluteTarget.startsWith(`${workspaceRoot}/`)) {
    throw new Error(`Path must stay inside the workspace root: ${targetPath}`);
  }

  return absoluteTarget;
}

function isWorkspaceAllowed(
  settings: AgentJobSettingsRecord,
  workspacePath: string,
) {
  // Empty array means "deny all" — there is no catch-all allowed root.
  // Users populate the list via Settings > Agent > Allowed workspace roots.
  if (settings.allowedWorkspaceRoots.length === 0) {
    return false;
  }

  const candidate = resolve(workspacePath);
  return settings.allowedWorkspaceRoots.some((root) => {
    const allowedRoot = resolve(
      normalizeWorkspacePath(root, settings.executionBackend),
    );
    return candidate === allowedRoot || candidate.startsWith(`${allowedRoot}\\`) || candidate.startsWith(`${allowedRoot}/`);
  });
}

function looksLikeNetworkCommand(command: string) {
  return /\b(curl|wget|npm\s+(install|add)|pnpm\s+(install|add)|yarn\s+(add|install)|bun\s+(add|install)|pip\s+install|uv\s+add|git\s+clone|Invoke-WebRequest|iwr|irm)\b/i.test(
    command,
  );
}

function redactSecrets(text: string) {
  return text
    .replace(/\b(sk-[A-Za-z0-9_\-]{12,})\b/g, "[redacted-secret]")
    .replace(/\b(ghp_[A-Za-z0-9]{12,})\b/g, "[redacted-secret]")
    .replace(/\b(xox[baprs]-[A-Za-z0-9-]{12,})\b/g, "[redacted-secret]")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._\-]{12,}\b/gi, "$1[redacted-secret]");
}

async function commandExists(command: string, backend: AgentExecutionBackend) {
  const resolvedBackend = resolveExecutionBackend(backend);

  try {
    if (process.platform === "win32" && resolvedBackend === "host_native") {
      await execFileAsync("where.exe", [command], { windowsHide: true });
      return true;
    }

    if (process.platform === "win32" && resolvedBackend === "wsl_bash") {
      await execFileAsync("wsl.exe", ["-e", "bash", "-lc", `command -v ${command}`], {
        windowsHide: true,
      });
      return true;
    }

    await execFileAsync("bash", ["-lc", `command -v ${command}`], { windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

function redactCommandResult(settings: AgentJobSettingsRecord, result: CommandExecutionResult) {
  return {
    ...result,
    stdout: truncateText(
      settings.redactSecretsInArtifacts ? redactSecrets(result.stdout || "") : result.stdout || "",
    ),
    stderr: truncateText(
      settings.redactSecretsInArtifacts ? redactSecrets(result.stderr || "") : result.stderr || "",
    ),
  };
}

function relativeWorkspaceCwd(workspacePath: string, cwd: string) {
  const rel = relative(resolve(workspacePath), resolve(cwd));
  if (!rel || rel === ".") {
    return "/workspace";
  }

  return `/workspace/${rel.replaceAll("\\", "/")}`;
}

function createExecutionRunner(
  settings: AgentJobSettingsRecord,
  workspacePath: string,
): ExecutionRunner {
  const backend = resolveExecutionBackend(settings.executionBackend);

  if (backend === "docker_sandbox") {
    return {
      backend,
      label: "Docker sandbox",
      async runShellCommand(params) {
        const dockerArgs = [
          "run",
          "--rm",
          "--init",
          "-v",
          `${resolve(workspacePath)}:/workspace`,
          "-w",
          relativeWorkspaceCwd(workspacePath, params.cwd),
        ];

        if (!settings.allowNetworkAccess) {
          dockerArgs.push("--network", "none");
        }

        dockerArgs.push(
          "mcr.microsoft.com/playwright:v1.52.0-noble",
          "bash",
          "-lc",
          params.command,
        );

        try {
          const { stdout, stderr } = await execFileAsync("docker", dockerArgs, {
            cwd: workspacePath,
            timeout: params.timeoutSeconds * 1000,
            maxBuffer: 1024 * 1024 * 4,
            windowsHide: true,
          });

          return redactCommandResult(settings, {
            command: params.command,
            cwd: params.cwd,
            exitCode: 0,
            stdout: stdout || "",
            stderr: stderr || "",
          });
        } catch (error) {
          const execError = error as {
            code?: number;
            stdout?: string;
            stderr?: string;
            message?: string;
          };

          return redactCommandResult(settings, {
            command: params.command,
            cwd: params.cwd,
            exitCode: typeof execError.code === "number" ? execError.code : 1,
            stdout: execError.stdout || "",
            stderr: execError.stderr || execError.message || "Command failed.",
          });
        }
      },
    };
  }

  if (process.platform === "win32" && backend === "wsl_bash") {
    return {
      backend,
      label: "WSL bash",
      async runShellCommand(params) {
        try {
          const { stdout, stderr } = await execFileAsync(
            "wsl.exe",
            ["-e", "bash", "-lc", params.command],
            {
              cwd: params.cwd,
              timeout: params.timeoutSeconds * 1000,
              maxBuffer: 1024 * 1024 * 4,
              windowsHide: true,
            },
          );

          return redactCommandResult(settings, {
            command: params.command,
            cwd: params.cwd,
            exitCode: 0,
            stdout: stdout || "",
            stderr: stderr || "",
          });
        } catch (error) {
          const execError = error as {
            code?: number;
            stdout?: string;
            stderr?: string;
            message?: string;
          };

          return redactCommandResult(settings, {
            command: params.command,
            cwd: params.cwd,
            exitCode: typeof execError.code === "number" ? execError.code : 1,
            stdout: execError.stdout || "",
            stderr: execError.stderr || execError.message || "Command failed.",
          });
        }
      },
    };
  }

  if (process.platform === "win32" && backend === "host_native") {
    return {
      backend,
      label: "Host native shell",
      async runShellCommand(params) {
        try {
          const { stdout, stderr } = await execFileAsync(
            "powershell.exe",
            ["-NoProfile", "-Command", params.command],
            {
              cwd: params.cwd,
              timeout: params.timeoutSeconds * 1000,
              maxBuffer: 1024 * 1024 * 4,
              windowsHide: true,
            },
          );

          return redactCommandResult(settings, {
            command: params.command,
            cwd: params.cwd,
            exitCode: 0,
            stdout: stdout || "",
            stderr: stderr || "",
          });
        } catch (error) {
          const execError = error as {
            code?: number;
            stdout?: string;
            stderr?: string;
            message?: string;
          };

          return redactCommandResult(settings, {
            command: params.command,
            cwd: params.cwd,
            exitCode: typeof execError.code === "number" ? execError.code : 1,
            stdout: execError.stdout || "",
            stderr: execError.stderr || execError.message || "Command failed.",
          });
        }
      },
    };
  }

  return {
    backend: "host_native",
    label: "Host bash",
    async runShellCommand(params) {
      try {
        const { stdout, stderr } = await execFileAsync("bash", ["-lc", params.command], {
          cwd: params.cwd,
          timeout: params.timeoutSeconds * 1000,
          maxBuffer: 1024 * 1024 * 4,
          windowsHide: true,
        });

        return redactCommandResult(settings, {
          command: params.command,
          cwd: params.cwd,
          exitCode: 0,
          stdout: stdout || "",
          stderr: stderr || "",
        });
      } catch (error) {
        const execError = error as {
          code?: number;
          stdout?: string;
          stderr?: string;
          message?: string;
        };

        return redactCommandResult(settings, {
          command: params.command,
          cwd: params.cwd,
          exitCode: typeof execError.code === "number" ? execError.code : 1,
          stdout: execError.stdout || "",
          stderr: execError.stderr || execError.message || "Command failed.",
        });
      }
    },
  };
}

export async function detectExecutionRequirements(params: {
  settings: AgentJobSettingsRecord;
  workspacePath: string;
}) {
  const requirements: DetectedExecutionRequirement[] = [];
  const backend = resolveExecutionBackend(params.settings.executionBackend);
  const normalizedWorkspacePath = normalizeWorkspacePath(
    params.workspacePath,
    backend,
  );

  if (!isWorkspaceAllowed(params.settings, normalizedWorkspacePath)) {
    requirements.push({
      kind: "runtime",
      label: "Workspace root is outside the allowed roots",
      detail: `The workspace ${normalizedWorkspacePath} is not inside the allowed workspace roots configured for agent jobs.`,
      metadataJson: {
        workspacePath: normalizedWorkspacePath,
        allowedWorkspaceRoots: params.settings.allowedWorkspaceRoots,
      },
    });
  }

  if (backend === "docker_sandbox") {
    let dockerHealthy = false;
    try {
      // execSync is appropriate here — we need a hard check, not an async probe,
      // and the Docker daemon is local (no network latency concern).
      execSync("docker info", { stdio: "ignore", timeout: 8_000 });
      dockerHealthy = true;
    } catch {
      dockerHealthy = false;
    }
    if (!dockerHealthy) {
      requirements.push({
        kind: "service",
        label: "Docker daemon is not reachable",
        detail: "Switch the execution backend to host native / WSL, or ensure the Docker daemon is running and accessible.",
      });
    }
  }

  if (backend === "wsl_bash" && process.platform === "win32") {
    const hasWsl = await commandExists("wsl", "host_native");
    if (!hasWsl) {
      requirements.push({
        kind: "runtime",
        label: "WSL is required for the selected execution backend",
        detail: "Switch the execution backend to host native or install and enable WSL before continuing.",
      });
    }
  }

  const entries = await readdir(normalizedWorkspacePath).catch(() => []);
  const entrySet = new Set(entries.map((entry) => entry.toLowerCase()));

  if (backend === "docker_sandbox") {
    if (!params.settings.allowNetworkAccess) {
      requirements.push({
        kind: "network",
        label: "Network access is disabled",
        detail: "Jobs can still work locally, but installs, remote fetches, and browser-heavy verification will stay blocked until network access is enabled.",
      });
    }

    return requirements;
  }

  if (entrySet.has("package.json")) {
    if (!(await commandExists("node", params.settings.executionBackend))) {
      requirements.push({
        kind: "runtime",
        label: "Node.js runtime is required",
        detail: "This workspace has a package.json, so Node.js must be available before the job can continue.",
      });
    }

    const packageManager =
      entrySet.has("pnpm-lock.yaml") ? "pnpm" :
      entrySet.has("yarn.lock") ? "yarn" :
      entrySet.has("bun.lock") || entrySet.has("bun.lockb") ? "bun" :
      "npm";

    if (!(await commandExists(packageManager, params.settings.executionBackend))) {
      requirements.push({
        kind: "package_manager",
        label: `${packageManager} is required for this workspace`,
        detail: `The workspace appears to use ${packageManager}, but that package manager is not available on the selected execution backend.`,
        metadataJson: {
          packageManager,
        },
      });
    }
  }

  if (entrySet.has("pyproject.toml") || entrySet.has("requirements.txt")) {
    if (!(await commandExists("python", params.settings.executionBackend)) &&
        !(await commandExists("python3", params.settings.executionBackend))) {
      requirements.push({
        kind: "runtime",
        label: "Python runtime is required",
        detail: "This workspace includes Python project files, so Python must be available before the job can continue.",
      });
    }
  }

  if ((entrySet.has("docker-compose.yml") || entrySet.has("compose.yml") || entrySet.has("dockerfile")) &&
      !(await commandExists("docker", params.settings.executionBackend))) {
    requirements.push({
      kind: "service",
      label: "Docker is required for this workspace",
      detail: "This workspace includes Docker resources, so Docker must be available before the job can continue.",
    });
  }

  if (!(await commandExists("git", params.settings.executionBackend))) {
    requirements.push({
      kind: "runtime",
      label: "Git is required for autonomous coding work",
      detail: "The agent expects git to be available for safe inspection and handoff flows.",
    });
  }

  return requirements;
}

function commandNeedsApproval(mode: AgentJobApprovalMode, command: string) {
  if (mode === "restrictive") {
    return true;
  }

  if (mode === "full_access") {
    return false;
  }

  return /(^|\s)(sudo|su\b|passwd\b|shutdown\b|reboot\b|mkfs\b|dd\b|mount\b|umount\b|systemctl\b|service\b|chown\b|useradd\b|userdel\b|groupadd\b|groupdel\b|chmod\s+[0-7]{3,4}\b|rm\s+-rf\b|git\s+reset\s+--hard\b|git\s+clean\s+-fd\b|git\s+push\s+--force\b|docker\s+system\s+prune\b|docker\s+volume\s+rm\b)/.test(command);
}

function isForbiddenCommand(command: string) {
  return /(^|\s)(shutdown\b|reboot\b|halt\b|poweroff\b|mkfs\b|fdisk\b|diskpart\b|format\b|bcdedit\b|reg\s+delete\b|cipher\s+\/w\b|rm\s+-rf\s+\/($|\s)|del\s+\/s\s+\/q\s+c:\\|Remove-Item\s+.+-Recurse.+[A-Za-z]:\\($|\s))/i.test(
    command,
  );
}

function makeAgentInstructions(request: JobRequestShape) {
  const lines = [
    "You are the autonomous build executor for a durable software job.",
    "Work only inside the provided workspace.",
    "Inspect before editing. Prefer targeted edits over blind rewrites.",
    "Run commands to install, build, lint, typecheck, and test when that helps finish the job.",
    "If a tool approval is denied, do not retry the same operation without changing approach.",
    "Before finishing, make sure the workspace changes actually satisfy the requested goal.",
    request.constraints.length > 0
      ? `Hard constraints: ${request.constraints.join("; ")}`
      : null,
    request.deliverables.length > 0
      ? `Deliverables to cover: ${request.deliverables.join("; ")}`
      : null,
  ];

  return lines.filter((line): line is string => Boolean(line)).join("\n");
}

function makeDraftingPrompt(params: {
  request: JobRequestShape;
  inspectionSummary: string;
}) {
  const lines = [
    `Job title: ${params.request.title}`,
    `Goal: ${params.request.goal}`,
    `Workspace: ${params.request.workspacePath}`,
    "",
    "Workspace inspection:",
    params.inspectionSummary,
    "",
    "Drafting expectations:",
    "- Explore the codebase using read and search tools only.",
    "- Do not write code or apply fixes yet.",
    "- Identify the files that need changes and the exact logic to implement the goal.",
    "- Finish by summarizing your explicit, step-by-step plan for the next agent.",
  ];

  return lines.join("\n");
}

function makeImplementationPrompt(params: {
  request: JobRequestShape;
  inspectionSummary: string;
  draftSummary: string;
  priorVerifierNotes: string[];
}) {
  const lines = [
    `Job title: ${params.request.title}`,
    `Goal: ${params.request.goal}`,
    `Workspace: ${params.request.workspacePath}`,
    "",
    "Workspace inspection:",
    params.inspectionSummary,
    "",
    "Execution plan to follow:",
    params.draftSummary || "No detailed plan was drafted. Explore before editing.",
  ];

  if (params.priorVerifierNotes.length > 0) {
    lines.push("", "Verification blockers to address:");
    for (const note of params.priorVerifierNotes) {
      lines.push(`- ${note}`);
    }
  }

  lines.push(
    "",
    "Execution expectations:",
    "- Use the tools to inspect, edit, and verify the workspace until the goal is satisfied.",
    "- Prefer read/search tools before writing.",
    "- After meaningful edits, run the strongest relevant project checks.",
    "- Finish with a short summary of what changed and any residual risk.",
  );

  return lines.join("\n");
}

function makeVerificationPrompt(params: {
  request: JobRequestShape;
  candidateCommands: string[];
  implementationSummary: string;
  browserVerificationEnabled?: boolean;
}) {
  const lines = [
    `Verify whether the job goal has been completed for: ${params.request.goal}`,
    `Workspace: ${params.request.workspacePath}`,
    "",
    "Implementation summary:",
    params.implementationSummary || "No implementation summary was recorded.",
    "",
    "Run the strongest relevant checks you can. Use these commands first when they make sense:",
  ];

  for (const command of params.candidateCommands) {
    lines.push(`- ${command}`);
  }

  lines.push(
    "",
    "When you finish, answer with whether the build is verified, what evidence you collected, and any remaining blocker.",
    "Use check_port and probe_http when the app exposes a local service or endpoint worth checking.",
  );

  if (params.browserVerificationEnabled) {
    lines.push("Use browser_visit for a browser-level smoke pass once the app is reachable.");
  }

  return lines.join("\n");
}

function guessVerificationCommands(workspacePath: string, packageMetadata: Record<string, unknown>) {
  const commands: string[] = [];
  const scripts =
    packageMetadata && typeof packageMetadata.scripts === "object" && packageMetadata.scripts
      ? (packageMetadata.scripts as Record<string, unknown>)
      : {};

  if (typeof scripts.typecheck === "string") {
    commands.push("npm run typecheck");
  }

  if (typeof scripts.test === "string") {
    commands.push("npm run test");
  }

  if (typeof scripts.build === "string") {
    commands.push("npm run build");
  }

  if (commands.length === 0) {
    commands.push("npm run typecheck", "npm run build");
  }

  return commands;
}

async function listDirectoryImpl(workspacePath: string, pathValue: string) {
  const targetPath = ensureWithinWorkspace(workspacePath, pathValue || ".");
  const entries = await readdir(targetPath, { withFileTypes: true });
  return {
    path: targetPath,
    entries: entries
      .map((entry) => ({
        name: entry.name,
        kind: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 200),
  };
}

async function searchFilesImpl(workspacePath: string, pattern: string, cwd?: string | null, maxResults = 40) {
  const targetCwd = ensureWithinWorkspace(workspacePath, cwd?.trim() || ".");
  const { stdout } = await execFileAsync("rg", [
    "-n",
    "--no-heading",
    "--color",
    "never",
    "-m",
    String(Math.max(1, Math.min(200, maxResults))),
    pattern,
    targetCwd,
  ], {
    cwd: workspacePath,
    maxBuffer: 1024 * 1024,
  });

  return {
    cwd: targetCwd,
    pattern,
    matches: stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, maxResults),
  };
}

async function readFileImpl(workspacePath: string, pathValue: string) {
  const targetPath = ensureWithinWorkspace(workspacePath, pathValue);
  const content = await readFile(targetPath, "utf8");
  return {
    path: targetPath,
    content: truncateText(content, MAX_FILE_READ_BYTES),
  };
}

async function writeFileImpl(workspacePath: string, pathValue: string, content: string) {
  const targetPath = ensureWithinWorkspace(workspacePath, pathValue);
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content, "utf8");
  return {
    path: targetPath,
    bytesWritten: Buffer.byteLength(content, "utf8"),
  };
}

async function replaceInFileImpl(params: {
  workspacePath: string;
  pathValue: string;
  searchText: string;
  replaceText: string;
  replaceAll: boolean;
}) {
  const targetPath = ensureWithinWorkspace(params.workspacePath, params.pathValue);
  const existing = await readFile(targetPath, "utf8");

  if (!existing.includes(params.searchText)) {
    return {
      path: targetPath,
      replaced: false,
      replacements: 0,
    };
  }

  const next = params.replaceAll
    ? existing.split(params.searchText).join(params.replaceText)
    : existing.replace(params.searchText, params.replaceText);
  const replacements = params.replaceAll
    ? existing.split(params.searchText).length - 1
    : 1;

  await writeFile(targetPath, next, "utf8");

  return {
    path: targetPath,
    replaced: true,
    replacements,
  };
}

async function makeDirectoryImpl(workspacePath: string, pathValue: string) {
  const targetPath = ensureWithinWorkspace(workspacePath, pathValue);
  await mkdir(targetPath, { recursive: true });
  return {
    path: targetPath,
    created: true,
  };
}

async function removePathImpl(workspacePath: string, pathValue: string) {
  const targetPath = ensureWithinWorkspace(workspacePath, pathValue);
  await rm(targetPath, { recursive: true, force: true });
  return {
    path: targetPath,
    removed: true,
  };
}

async function runCommandImpl(params: {
  settings: AgentJobSettingsRecord;
  workspacePath: string;
  command: string;
  cwd?: string | null;
  timeoutSeconds: number;
}) {
  const targetCwd = ensureWithinWorkspace(params.workspacePath, params.cwd?.trim() || ".");

  if (!params.settings.allowNetworkAccess && looksLikeNetworkCommand(params.command)) {
    return {
      command: params.command,
      cwd: targetCwd,
      exitCode: 1,
      stdout: "",
      stderr: "Blocked by agent settings: network access is disabled for this job.",
    };
  }

  if (isForbiddenCommand(params.command)) {
    return {
      command: params.command,
      cwd: targetCwd,
      exitCode: 1,
      stdout: "",
      stderr: "Blocked by agent safety policy: this command is too destructive to run automatically.",
    };
  }

  const runner = createExecutionRunner(params.settings, params.workspacePath);
  return runner.runShellCommand({
    command: params.command,
    cwd: targetCwd,
    timeoutSeconds: params.timeoutSeconds,
    settings: params.settings,
  });
}

async function probeHttpImpl(url: string) {
  const response = await fetch(url, {
    method: "GET",
    redirect: "follow",
  });
  const text = await response.text();
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return {
    url,
    status: response.status,
    ok: response.ok,
    headers,
    bodyPreview: truncateText(text, 4_000),
  };
}

async function checkPortImpl(host: string, port: number, timeoutMs = 2_000) {
  return new Promise<{ host: string; port: number; open: boolean; error: string | null }>((resolvePromise) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (open: boolean, error: string | null) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolvePromise({
        host,
        port,
        open,
        error,
      });
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true, null));
    socket.once("timeout", () => finish(false, "Timed out"));
    socket.once("error", (error) => finish(false, error.message));
    socket.connect(port, host);
  });
}

async function browserVisitImpl(params: {
  url: string;
  waitForText?: string | null;
  timeoutMs?: number;
}) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 960 },
    });
    const response = await page.goto(params.url, {
      waitUntil: "networkidle",
      timeout: params.timeoutMs ?? 20_000,
    });

    if (params.waitForText?.trim()) {
      await page.getByText(params.waitForText.trim(), { exact: false }).first().waitFor({
        timeout: params.timeoutMs ?? 10_000,
      });
    }

    const title = await page.title();
    const bodyText = await page.locator("body").innerText().catch(() => "");
    const screenshot = await page.screenshot({ type: "png", fullPage: true });
    const storageKey = createAgentJobArtifactStorageKey("browser", "verification.png");
    const storagePath = await ensureAgentJobArtifactStoragePath(storageKey);
    await writeFile(storagePath, screenshot);

    return {
      url: params.url,
      finalUrl: page.url(),
      title,
      status: response?.status() ?? null,
      waitForText: params.waitForText?.trim() || null,
      bodyPreview: truncateText(bodyText, 4_000),
      screenshot: {
        storageKey,
        mimeType: "image/png",
      },
    };
  } finally {
    await browser.close();
  }
}

// Web search implementation using SearXNG
async function webSearchImpl(query: string, maxResults: number) {
  const searxngUrl = process.env.SEARXNG_BASE_URL ?? "http://localhost:8080";
  const searchUrl = new URL(`${searxngUrl}/search`);
  searchUrl.searchParams.set("q", query);
  searchUrl.searchParams.set("format", "json");

  const response = await fetch(searchUrl.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`SearXNG search failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    query: string;
    number_of_results: number;
    results: Array<{
      url: string;
      title: string;
      content?: string;
      publishedDate?: string | null;
      engine?: string;
    }>;
  };

  const results = data.results.slice(0, maxResults).map((r) => ({
    url: r.url,
    title: r.title,
    content: r.content ?? "",
    publishedDate: r.publishedDate,
    engine: r.engine,
  }));

  return {
    query: data.query,
    totalResults: data.number_of_results,
    returnedResults: results.length,
    results,
  };
}

// Fetch URL content implementation
async function fetchUrlImpl(url: string, maxLength: number) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.0",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const isHtml = contentType.includes("text/html");

  if (isHtml) {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      const title = await page.title().catch(() => "");
      const text = await page.locator("body").innerText().catch(() => "");
      return {
        url,
        title,
        content: truncateText(text, maxLength),
        contentType,
        length: text.length,
      };
    } finally {
      await browser.close();
    }
  }

  const text = await response.text();
  return {
    url,
    title: "",
    content: truncateText(text, maxLength),
    contentType,
    length: text.length,
  };
}

// Download URL implementation
async function downloadUrlImpl(params: {
  workspacePath: string;
  url: string;
  filename?: string;
  subdir?: string;
}) {
  const response = await fetch(params.url, {
    method: "GET",
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; Secretary/1.0)",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
  }

  const urlPath = new URL(params.url).pathname;
  const basename = params.filename ?? urlPath.split("/").pop() ?? "downloaded-file";

  const targetDir = params.subdir
    ? resolve(params.workspacePath, params.subdir)
    : params.workspacePath;

  await mkdir(targetDir, { recursive: true });

  const filePath = resolve(targetDir, basename);
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(filePath, buffer);

  return {
    url: params.url,
    savedTo: params.subdir ? `${params.subdir}/${basename}` : basename,
    fullPath: filePath,
    sizeBytes: buffer.length,
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
  };
}

// Site crawl implementation using wget
async function siteCrawlImpl(params: {
  workspacePath: string;
  url: string;
  maxDepth: number;
  maxPages: number;
  sameDomain: boolean;
  outputDir: string;
}) {
  const outputPath = resolve(params.workspacePath, params.outputDir);
  await mkdir(outputPath, { recursive: true });

  const urlObj = new URL(params.url);
  const domain = urlObj.hostname;

  const args = [
    "--recursive",
    "--level", String(params.maxDepth),
    "--no-clobber",
    "--page-requisites",
    "--html-extension",
    "--convert-links",
    "--restrict-file-names=unix",
    "--no-parent",
    "--robots=on",
    "--tries=3",
    "--timeout=30",
    "--user-agent=Mozilla/5.0 (compatible; SecretaryBot/1.0)",
  ];

  if (params.sameDomain) {
    args.push("--domains", domain);
  }

  // Limit number of pages with quota
  args.push("--quota", `${params.maxPages}m`);

  args.push("-P", outputPath, params.url);

  const { execa } = await import("execa");
  try {
    const result = await execa("wget", args, {
      timeout: 300_000, // 5 minute timeout
      reject: false,
    });

    return {
      success: result.exitCode === 0 || result.exitCode === 8, // 8 is partial success in wget
      url: params.url,
      outputDir: params.outputDir,
      exitCode: result.exitCode,
      stdout: truncateText(result.stdout, 2000),
      stderr: truncateText(result.stderr, 2000),
    };
  } catch (error) {
    const err = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      url: params.url,
      outputDir: params.outputDir,
      exitCode: -1,
      error: err,
    };
  }
}

function createBuildAgent(params: {
  inference: InferenceRuntimeConfig;
  settings: AgentJobSettingsRecord;
  request: JobRequestShape;
  workspacePath: string;
  approvalMode: AgentJobApprovalMode;
  activeTools?: AgentToolName[];
}) {
  const resolved = resolveInferenceLanguageModel(params.inference, {
    purpose: "agent_job",
    workspacePath: params.workspacePath,
  });

  if (!resolved) {
    throw new Error("Inference provider is not ready for autonomous job execution.");
  }

  const allTools = {
    list_directory: tool({
      description: "List files and folders inside the workspace.",
      inputSchema: z.object({
        path: z.string().default(".").describe("Path relative to the workspace root."),
      }),
      execute: async ({ path }) => listDirectoryImpl(params.workspacePath, path),
    }),
    search_files: tool({
      description: "Search text in workspace files using ripgrep.",
      inputSchema: z.object({
        pattern: z.string().describe("Literal text or regex to search for."),
        cwd: z.string().nullable().optional().describe("Optional subdirectory inside the workspace."),
        maxResults: z.number().int().min(1).max(100).default(40),
      }),
      execute: async ({ pattern, cwd, maxResults }) =>
        searchFilesImpl(params.workspacePath, pattern, cwd, maxResults),
    }),
    read_file: tool({
      description: "Read a UTF-8 text file from the workspace.",
      inputSchema: z.object({
        path: z.string().describe("File path relative to the workspace root."),
      }),
      execute: async ({ path }) => readFileImpl(params.workspacePath, path),
    }),
    write_file: tool({
      description: "Write a UTF-8 text file inside the workspace.",
      inputSchema: z.object({
        path: z.string().describe("File path relative to the workspace root."),
        content: z.string().describe("Full UTF-8 file contents to write."),
      }),
      needsApproval:
        params.approvalMode === "restrictive"
          ? true
          : false,
      execute: async ({ path, content }) => writeFileImpl(params.workspacePath, path, content),
    }),
    replace_in_file: tool({
      description: "Replace existing text inside a workspace file.",
      inputSchema: z.object({
        path: z.string().describe("File path relative to the workspace root."),
        searchText: z.string().describe("Exact text to find."),
        replaceText: z.string().describe("Replacement text."),
        replaceAll: z.boolean().default(false),
      }),
      needsApproval:
        params.approvalMode === "restrictive"
          ? true
          : false,
      execute: async ({ path, searchText, replaceText, replaceAll }) =>
        replaceInFileImpl({
          workspacePath: params.workspacePath,
          pathValue: path,
          searchText,
          replaceText,
          replaceAll,
        }),
    }),
    make_directory: tool({
      description: "Create a directory inside the workspace.",
      inputSchema: z.object({
        path: z.string().describe("Directory path relative to the workspace root."),
      }),
      needsApproval:
        params.approvalMode === "restrictive"
          ? true
          : false,
      execute: async ({ path }) => makeDirectoryImpl(params.workspacePath, path),
    }),
    remove_path: tool({
      description: "Remove a file or directory inside the workspace.",
      inputSchema: z.object({
        path: z.string().describe("Path relative to the workspace root."),
      }),
      needsApproval: async ({ path }) =>
        params.approvalMode !== "full_access" || path.includes("node_modules"),
      execute: async ({ path }) => removePathImpl(params.workspacePath, path),
    }),
    run_command: tool({
      description: "Run a shell command inside the workspace and return stdout, stderr, and exit code.",
      inputSchema: z.object({
        command: z.string().describe("Shell command to execute."),
        cwd: z.string().nullable().optional().describe("Optional working directory inside the workspace."),
        timeoutSeconds: z.number().int().min(5).max(600).optional(),
      }),
      needsApproval: async ({ command }) => commandNeedsApproval(params.approvalMode, command),
      execute: async ({ command, cwd, timeoutSeconds }) =>
        runCommandImpl({
          settings: params.settings,
          workspacePath: params.workspacePath,
          command,
          cwd,
          timeoutSeconds: timeoutSeconds ?? params.settings.maxCommandTimeoutSeconds,
        }),
    }),
    probe_http: tool({
      description: "Fetch an HTTP endpoint and capture status, headers, and a short response preview.",
      inputSchema: z.object({
        url: z.string().url(),
      }),
      needsApproval: !params.settings.allowNetworkAccess,
      execute: async ({ url }) => probeHttpImpl(url),
    }),
    check_port: tool({
      description: "Check whether a TCP host and port are accepting connections.",
      inputSchema: z.object({
        host: z.string().default("127.0.0.1"),
        port: z.number().int().min(1).max(65535),
      }),
      execute: async ({ host, port }) => checkPortImpl(host, port),
    }),
    browser_visit: tool({
      description: "Open a URL in a headless browser, capture page metadata, and save a screenshot artifact.",
      inputSchema: z.object({
        url: z.string().url(),
        waitForText: z.string().nullable().optional(),
        timeoutMs: z.number().int().min(1_000).max(60_000).optional(),
      }),
      needsApproval: !params.settings.allowNetworkAccess,
      execute: async ({ url, waitForText, timeoutMs }) =>
        browserVisitImpl({
          url,
          waitForText,
          timeoutMs,
        }),
    }),
    web_search: tool({
      description: "Search the web using SearXNG for current information, documentation, or research.",
      inputSchema: z.object({
        query: z.string().describe("Search query to look up."),
        maxResults: z.number().int().min(1).max(10).optional().describe("Maximum results to return (default: 5)."),
      }),
      needsApproval: !params.settings.allowNetworkAccess,
      execute: async ({ query, maxResults }) => webSearchImpl(query, maxResults ?? 5),
    }),
    fetch_url: tool({
      description: "Fetch and extract text content from a URL (useful for reading docs, articles, etc.)",
      inputSchema: z.object({
        url: z.string().url().describe("URL to fetch content from."),
        maxLength: z.number().int().min(100).max(50000).optional().describe("Maximum characters to return (default: 10000)."),
      }),
      needsApproval: !params.settings.allowNetworkAccess,
      execute: async ({ url, maxLength }) => fetchUrlImpl(url, maxLength ?? 10000),
    }),
    download_url: tool({
      description: "Download a file from a URL and save it to the workspace.",
      inputSchema: z.object({
        url: z.string().url().describe("URL of the file to download."),
        filename: z.string().optional().describe("Optional filename to save as (defaults to URL basename)."),
        path: z.string().optional().describe("Optional subdirectory within workspace to save to."),
      }),
      needsApproval: !params.settings.allowNetworkAccess,
      execute: async ({ url, filename, path }) =>
        downloadUrlImpl({
          workspacePath: params.workspacePath,
          url,
          filename,
          subdir: path,
        }),
    }),
    site_crawl: tool({
      description: "Crawl a website and save pages locally using wget (respects robots.txt by default).",
      inputSchema: z.object({
        url: z.string().url().describe("Starting URL to crawl."),
        maxDepth: z.number().int().min(1).max(5).optional().describe("Maximum crawl depth (default: 2)."),
        maxPages: z.number().int().min(1).max(100).optional().describe("Maximum pages to download (default: 50)."),
        sameDomain: z.boolean().optional().describe("Only crawl same domain (default: true)."),
        outputDir: z.string().optional().describe("Output directory name (default: 'crawled-site')."),
      }),
      needsApproval: !params.settings.allowNetworkAccess,
      execute: async ({ url, maxDepth, maxPages, sameDomain, outputDir }) =>
        siteCrawlImpl({
          workspacePath: params.workspacePath,
          url,
          maxDepth: maxDepth ?? 2,
          maxPages: maxPages ?? 50,
          sameDomain: sameDomain ?? true,
          outputDir: outputDir ?? "crawled-site",
        }),
    }),
  };

  return new ToolLoopAgent({
    model: resolved.model,
    providerOptions: resolved.providerOptions,
    instructions: makeAgentInstructions(params.request),
    tools: allTools,
    activeTools: params.activeTools,
    stopWhen: stepCountIs(params.settings.maxAgentSteps),
    maxOutputTokens: params.inference.maxOutputTokens ?? undefined,
  });
}

function serializeStepSnapshots(stepResults: Array<{
  stepNumber: number;
  finishReason: string;
  text: string;
  reasoningText?: string;
  toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }>;
  toolResults: Array<{ toolCallId: string; toolName: string; output: unknown }>;
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
}>): AgentStepSnapshot[] {
  return stepResults.map((step) => ({
    stepNumber: step.stepNumber,
    finishReason: step.finishReason,
    text: truncateText(step.text || "", 4000),
    reasoningText: step.reasoningText ? truncateText(step.reasoningText, 4000) : null,
    toolCalls: step.toolCalls,
    toolResults: step.toolResults,
    usage: {
      inputTokens: step.usage.inputTokens ?? null,
      outputTokens: step.usage.outputTokens ?? null,
      totalTokens: step.usage.totalTokens ?? null,
    },
  }));
}

function collectApprovalRequests(content: Array<{ type: string; [key: string]: unknown }>) {
  return content
    .filter((part) => part.type === "tool-approval-request")
    .map((part) => {
      const toolCall = part.toolCall as { toolCallId?: string; toolName?: string; input?: unknown } | undefined;
      return {
        approvalId: String(part.approvalId),
        toolCallId: toolCall?.toolCallId ?? String(part.approvalId),
        toolName: toolCall?.toolName ?? "unknown",
        input: toolCall?.input ?? null,
      } satisfies ApprovalRequestRecord;
    });
}

function collectCommandLogs(stepSnapshots: AgentStepSnapshot[]) {
  const logs: CommandLogRecord[] = [];

  for (const step of stepSnapshots) {
    for (const result of step.toolResults) {
      if (result.toolName !== "run_command" || typeof result.output !== "object" || !result.output) {
        continue;
      }

      const output = result.output as Record<string, unknown>;
      logs.push({
        command: typeof output.command === "string" ? output.command : "",
        cwd: typeof output.cwd === "string" ? output.cwd : "",
        exitCode: typeof output.exitCode === "number" ? output.exitCode : 1,
        stdout: typeof output.stdout === "string" ? output.stdout : "",
        stderr: typeof output.stderr === "string" ? output.stderr : "",
      });
    }
  }

  return logs;
}

async function runAgentLoop(params: {
  inference: InferenceRuntimeConfig;
  settings: AgentJobSettingsRecord;
  request: JobRequestShape;
  workspacePath: string;
  approvalMode: AgentJobApprovalMode;
  prompt?: string;
  messages?: SerializedAgentMessage[];
  activeTools?: AgentToolName[];
}) {
  const agent = createBuildAgent({
    inference: params.inference,
    settings: params.settings,
    request: params.request,
    workspacePath: params.workspacePath,
    approvalMode: params.approvalMode,
    activeTools: params.activeTools,
  });

  const stepSnapshots: AgentStepSnapshot[] = [];
  const runtimeBudgetMs = Math.max(1, params.settings.maxJobRuntimeMinutes) * 60 * 1000;
  const abortController = new AbortController();
  const abortTimer = setTimeout(() => {
    abortController.abort();
  }, runtimeBudgetMs);

  try {
    const result = await agent.generate(
      params.messages
        ? {
            messages: params.messages,
            abortSignal: abortController.signal,
            onStepFinish(step) {
              stepSnapshots.push({
                stepNumber: step.stepNumber,
                finishReason: step.finishReason,
                text: step.text,
                reasoningText: step.reasoningText ?? null,
                toolCalls: step.toolCalls.map((call) => ({
                  toolCallId: call.toolCallId,
                  toolName: call.toolName,
                  input: call.input,
                })),
                toolResults: step.toolResults.map((toolResult) => ({
                  toolCallId: toolResult.toolCallId,
                  toolName: toolResult.toolName,
                  output: toolResult.output,
                })),
                usage: {
                  inputTokens: step.usage.inputTokens ?? null,
                  outputTokens: step.usage.outputTokens ?? null,
                  totalTokens: step.usage.totalTokens ?? null,
                },
              });
            },
          }
        : {
            prompt: params.prompt ?? "",
            abortSignal: abortController.signal,
            onStepFinish(step) {
              stepSnapshots.push({
                stepNumber: step.stepNumber,
                finishReason: step.finishReason,
                text: step.text,
                reasoningText: step.reasoningText ?? null,
                toolCalls: step.toolCalls.map((call) => ({
                  toolCallId: call.toolCallId,
                  toolName: call.toolName,
                  input: call.input,
                })),
                toolResults: step.toolResults.map((toolResult) => ({
                  toolCallId: toolResult.toolCallId,
                  toolName: toolResult.toolName,
                  output: toolResult.output,
                })),
                usage: {
                  inputTokens: step.usage.inputTokens ?? null,
                  outputTokens: step.usage.outputTokens ?? null,
                  totalTokens: step.usage.totalTokens ?? null,
                },
              });
            },
          },
    );

    const baseMessages = params.messages ?? [{ role: "user", content: params.prompt ?? "" } satisfies ModelMessage];
    const nextMessages = [...baseMessages, ...result.response.messages] as SerializedAgentMessage[];
    const approvalRequests = collectApprovalRequests(result.content as Array<{ type: string; [key: string]: unknown }>);
    const serializedSteps = stepSnapshots.length > 0 ? stepSnapshots : serializeStepSnapshots(result.steps.map((step) => ({
      stepNumber: step.stepNumber,
      finishReason: step.finishReason,
      text: step.text,
      reasoningText: step.reasoningText ?? undefined,
      toolCalls: step.toolCalls.map((call) => ({
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        input: call.input,
      })),
      toolResults: step.toolResults.map((toolResult) => ({
        toolCallId: toolResult.toolCallId,
        toolName: toolResult.toolName,
        output: toolResult.output,
      })),
      usage: {
        inputTokens: step.usage.inputTokens,
        outputTokens: step.usage.outputTokens,
        totalTokens: step.usage.totalTokens,
      },
    })) );

    return {
      kind: approvalRequests.length > 0 ? "needs_approval" : "completed",
      finalText: result.text?.trim() || "",
      blockerSummary:
        approvalRequests.length > 0
          ? `${approvalRequests.length} tool approval${approvalRequests.length === 1 ? "" : "s"} required before execution can continue.`
          : null,
      messages: nextMessages,
      approvalRequests,
      stepSnapshots: serializedSteps,
      commandLogs: collectCommandLogs(serializedSteps),
      usage: {
        inputTokens: result.totalUsage.inputTokens ?? null,
        outputTokens: result.totalUsage.outputTokens ?? null,
        totalTokens: result.totalUsage.totalTokens ?? null,
      },
    } satisfies AgentRunOutcome;
  } catch (error) {
    if (abortController.signal.aborted) {
      throw new Error(
        `Autonomous job exceeded its ${params.settings.maxJobRuntimeMinutes}-minute runtime budget.`,
      );
    }

    throw error;
  } finally {
    clearTimeout(abortTimer);
  }
}

export async function runDraftingAgent(params: {
  inference: InferenceRuntimeConfig;
  settings: AgentJobSettingsRecord;
  request: JobRequestShape;
  workspacePath: string;
  approvalMode: AgentJobApprovalMode;
  inspectionSummary: string;
  messages?: SerializedAgentMessage[];
}) {
  return runAgentLoop({
    inference: params.inference,
    settings: params.settings,
    request: params.request,
    workspacePath: params.workspacePath,
    approvalMode: params.approvalMode,
    prompt: makeDraftingPrompt({
      request: params.request,
      inspectionSummary: params.inspectionSummary,
    }),
    messages: params.messages,
    activeTools: [
      "list_directory",
      "search_files",
      "read_file",
      "write_file",
      "run_command",
      "web_search",
      "fetch_url",
      "download_url",
      "site_crawl",
    ],
  });
}

export async function runImplementationAgent(params: {
  inference: InferenceRuntimeConfig;
  settings: AgentJobSettingsRecord;
  request: JobRequestShape;
  workspacePath: string;
  approvalMode: AgentJobApprovalMode;
  inspectionSummary: string;
  draftSummary: string;
  priorVerifierNotes: string[];
  messages?: SerializedAgentMessage[];
  activeTools?: AgentToolName[];
}) {
  return runAgentLoop({
    inference: params.inference,
    settings: params.settings,
    request: params.request,
    workspacePath: params.workspacePath,
    approvalMode: params.approvalMode,
    prompt: makeImplementationPrompt({
      request: params.request,
      inspectionSummary: params.inspectionSummary,
      draftSummary: params.draftSummary,
      priorVerifierNotes: params.priorVerifierNotes,
    }),
    messages: params.messages,
    activeTools: params.activeTools,
  });
}

export async function runVerificationAgent(params: {
  inference: InferenceRuntimeConfig;
  settings: AgentJobSettingsRecord;
  request: JobRequestShape;
  workspacePath: string;
  approvalMode: AgentJobApprovalMode;
  implementationSummary: string;
  packageMetadata: Record<string, unknown>;
  messages?: SerializedAgentMessage[];
  activeTools?: AgentToolName[];
}) {
  return runAgentLoop({
    inference: params.inference,
    settings: params.settings,
    request: params.request,
    workspacePath: params.workspacePath,
    approvalMode: params.approvalMode,
    prompt: makeVerificationPrompt({
      request: params.request,
      candidateCommands: guessVerificationCommands(params.workspacePath, params.packageMetadata),
      implementationSummary: params.implementationSummary,
      browserVerificationEnabled: params.settings.browserVerificationEnabled,
    }),
    messages: params.messages,
    activeTools:
      params.activeTools ??
      [
        "list_directory",
        "search_files",
        "read_file",
        "run_command",
        "probe_http",
        "check_port",
        ...(params.settings.browserVerificationEnabled ? (["browser_visit"] as const) : []),
      ],
  });
}

export function buildApprovalResponseMessages(params: {
  approvalDecisions: Array<{ approvalId: string; approved: boolean; reason?: string | null }>;
}) {
  const approvals: ToolApprovalResponse[] = params.approvalDecisions.map((decision) => ({
    type: "tool-approval-response",
    approvalId: decision.approvalId,
    approved: decision.approved,
    reason: decision.reason ?? undefined,
  }));

  return approvals.length > 0
    ? ([{ role: "tool", content: approvals }] satisfies SerializedAgentMessage[])
    : ([] satisfies SerializedAgentMessage[]);
}
