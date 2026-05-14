import { execFile } from "node:child_process";
import { isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";
import type {
  AgentExecutionBackend,
  AgentJobRequirementKind,
  AgentJobSettingsRecord,
} from "@secretary/core-runtime";
import type { ModelMessage } from "ai";

export const execFileAsync = promisify(execFile);
export const MAX_FILE_READ_BYTES = 200_000;
export const MAX_TEXT_OUTPUT = 16_000;
export type JobRequestShape = {
  title: string;
  goal: string;
  workspacePath: string;
  constraints: string[];
  deliverables: string[];
};

export type SerializedAgentMessage = ModelMessage;

export type ApprovalRequestRecord = {
  approvalId: string;
  toolCallId: string;
  toolName: string;
  input: unknown;
};

export type AgentStepSnapshot = {
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

export type CommandLogRecord = {
  command: string;
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type AgentRunOutcome = {
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

export type AgentToolName =
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

export type CommandExecutionResult = {
  command: string;
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type ExecutionRunner = {
  backend: AgentExecutionBackend;
  label: string;
  runShellCommand(params: {
    command: string;
    cwd: string;
    timeoutSeconds: number;
    settings: AgentJobSettingsRecord;
  }): Promise<CommandExecutionResult>;
};

export function truncateText(text: string, maxLength = MAX_TEXT_OUTPUT) {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength)}\n...[truncated ${text.length - maxLength} chars]`;
}

// Tracks whether the WSL fallback warning has been emitted this process lifetime.
let wslFallbackWarned = false;

export function resolveExecutionBackend(backend: AgentExecutionBackend): AgentExecutionBackend {
  if (backend === "wsl_bash" && process.platform !== "win32") {
    if (!wslFallbackWarned) {
      wslFallbackWarned = true;
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

export function normalizePathForWorkspace(value: string) {
  return normalizeWorkspacePath(value).replace(/\/+/g, "/");
}

export function ensureWithinWorkspace(workspacePath: string, targetPath: string) {
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

export function isWorkspaceAllowed(settings: AgentJobSettingsRecord, workspacePath: string) {
  // Empty array means "deny all" — there is no catch-all allowed root.
  // Users populate the list via Settings > Agent > Allowed workspace roots.
  if (settings.allowedWorkspaceRoots.length === 0) {
    return false;
  }

  const candidate = resolve(workspacePath);
  return settings.allowedWorkspaceRoots.some((root) => {
    const allowedRoot = resolve(normalizeWorkspacePath(root, settings.executionBackend));
    return (
      candidate === allowedRoot ||
      candidate.startsWith(`${allowedRoot}\\`) ||
      candidate.startsWith(`${allowedRoot}/`)
    );
  });
}

export function looksLikeNetworkCommand(command: string) {
  return /\b(curl|wget|npm\s+(install|add)|pnpm\s+(install|add)|yarn\s+(add|install)|bun\s+(add|install)|pip\s+install|uv\s+add|git\s+clone|Invoke-WebRequest|iwr|irm)\b/i.test(
    command,
  );
}

export function redactSecrets(text: string) {
  return text
    .replace(/\b(sk-[A-Za-z0-9_-]{12,})\b/g, "[redacted-secret]")
    .replace(/\b(ghp_[A-Za-z0-9]{12,})\b/g, "[redacted-secret]")
    .replace(/\b(xox[baprs]-[A-Za-z0-9-]{12,})\b/g, "[redacted-secret]")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._-]{12,}\b/gi, "$1[redacted-secret]");
}

export async function commandExists(command: string, backend: AgentExecutionBackend) {
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

export function redactCommandResult(
  settings: AgentJobSettingsRecord,
  result: CommandExecutionResult,
) {
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

export function relativeWorkspaceCwd(workspacePath: string, cwd: string) {
  const rel = relative(resolve(workspacePath), resolve(cwd));
  if (!rel || rel === ".") {
    return "/workspace";
  }

  return `/workspace/${rel.replaceAll("\\", "/")}`;
}

export function createExecutionRunner(
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
