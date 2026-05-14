import { execSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import type { AgentJobApprovalMode, AgentJobSettingsRecord } from "@secretary/core-runtime";
import type { DetectedExecutionRequirement } from "./utils.js";
import {
  commandExists,
  isWorkspaceAllowed,
  type JobRequestShape,
  normalizeWorkspacePath,
  resolveExecutionBackend,
} from "./utils.js";

export async function detectExecutionRequirements(params: {
  settings: AgentJobSettingsRecord;
  workspacePath: string;
}) {
  const requirements: DetectedExecutionRequirement[] = [];
  const backend = resolveExecutionBackend(params.settings.executionBackend);
  const normalizedWorkspacePath = normalizeWorkspacePath(params.workspacePath, backend);

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
        detail:
          "Switch the execution backend to host native / WSL, or ensure the Docker daemon is running and accessible.",
      });
    }
  }

  if (backend === "wsl_bash" && process.platform === "win32") {
    const hasWsl = await commandExists("wsl", "host_native");
    if (!hasWsl) {
      requirements.push({
        kind: "runtime",
        label: "WSL is required for the selected execution backend",
        detail:
          "Switch the execution backend to host native or install and enable WSL before continuing.",
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
        detail:
          "Jobs can still work locally, but installs, remote fetches, and browser-heavy verification will stay blocked until network access is enabled.",
      });
    }

    return requirements;
  }

  if (entrySet.has("package.json")) {
    if (!(await commandExists("node", params.settings.executionBackend))) {
      requirements.push({
        kind: "runtime",
        label: "Node.js runtime is required",
        detail:
          "This workspace has a package.json, so Node.js must be available before the job can continue.",
      });
    }

    const packageManager = entrySet.has("pnpm-lock.yaml")
      ? "pnpm"
      : entrySet.has("yarn.lock")
        ? "yarn"
        : entrySet.has("bun.lock") || entrySet.has("bun.lockb")
          ? "bun"
          : "npm";

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
    if (
      !(await commandExists("python", params.settings.executionBackend)) &&
      !(await commandExists("python3", params.settings.executionBackend))
    ) {
      requirements.push({
        kind: "runtime",
        label: "Python runtime is required",
        detail:
          "This workspace includes Python project files, so Python must be available before the job can continue.",
      });
    }
  }

  if (
    (entrySet.has("docker-compose.yml") ||
      entrySet.has("compose.yml") ||
      entrySet.has("dockerfile")) &&
    !(await commandExists("docker", params.settings.executionBackend))
  ) {
    requirements.push({
      kind: "service",
      label: "Docker is required for this workspace",
      detail:
        "This workspace includes Docker resources, so Docker must be available before the job can continue.",
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

export function commandNeedsApproval(mode: AgentJobApprovalMode, command: string) {
  if (mode === "restrictive") {
    return true;
  }

  if (mode === "full_access") {
    return false;
  }

  return /(^|\s)(sudo|su\b|passwd\b|shutdown\b|reboot\b|mkfs\b|dd\b|mount\b|umount\b|systemctl\b|service\b|chown\b|useradd\b|userdel\b|groupadd\b|groupdel\b|chmod\s+[0-7]{3,4}\b|rm\s+-rf\b|git\s+reset\s+--hard\b|git\s+clean\s+-fd\b|git\s+push\s+--force\b|docker\s+system\s+prune\b|docker\s+volume\s+rm\b)/.test(
    command,
  );
}

export function isForbiddenCommand(command: string) {
  return /(^|\s)(shutdown\b|reboot\b|halt\b|poweroff\b|mkfs\b|fdisk\b|diskpart\b|format\b|bcdedit\b|reg\s+delete\b|cipher\s+\/w\b|rm\s+-rf\s+\/($|\s)|del\s+\/s\s+\/q\s+c:\\|Remove-Item\s+.+-Recurse.+[A-Za-z]:\\($|\s))/i.test(
    command,
  );
}

export function makeAgentInstructions(request: JobRequestShape) {
  const lines = [
    "You are the autonomous build executor for a durable software job.",
    "Work only inside the provided workspace.",
    "Inspect before editing. Prefer targeted edits over blind rewrites.",
    "Run commands to install, build, lint, typecheck, and test when that helps finish the job.",
    "If a tool approval is denied, do not retry the same operation without changing approach.",
    "Before finishing, make sure the workspace changes actually satisfy the requested goal.",
    request.constraints.length > 0 ? `Hard constraints: ${request.constraints.join("; ")}` : null,
    request.deliverables.length > 0
      ? `Deliverables to cover: ${request.deliverables.join("; ")}`
      : null,
  ];

  return lines.filter((line): line is string => Boolean(line)).join("\n");
}

export function makeDraftingPrompt(params: {
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

export function makeImplementationPrompt(params: {
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

export function makeVerificationPrompt(params: {
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

export function guessVerificationCommands(
  _workspacePath: string,
  packageMetadata: Record<string, unknown>,
) {
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
