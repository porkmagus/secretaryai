import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { ToolLoopAgent, stepCountIs, tool, type ModelMessage, type ToolApprovalResponse } from "ai";
import { z } from "zod";
import type { AgentJobApprovalMode, AgentJobSettingsRecord } from "@secretary/core-runtime";
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

function truncateText(text: string, maxLength = MAX_TEXT_OUTPUT) {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength)}\n...[truncated ${text.length - maxLength} chars]`;
}

export function normalizeWorkspacePath(inputPath: string) {
  const trimmed = inputPath.trim();
  const windowsMatch = trimmed.match(/^([A-Za-z]):[\\/](.*)$/);
  const wslMountMatch = trimmed.match(/^\/mnt\/([A-Za-z])\/(.*)$/);
  const isWindowsHost = process.platform === "win32";

  if (windowsMatch) {
    const [, drive, rest] = windowsMatch;
    if (isWindowsHost) {
      const normalizedRest = rest.replaceAll("/", "\\");
      return `${drive.toUpperCase()}:\\${normalizedRest}`;
    }

    const normalizedRest = rest.replaceAll("\\", "/");
    return `/mnt/${drive.toLowerCase()}/${normalizedRest}`;
  }

  if (wslMountMatch) {
    const [, drive, rest] = wslMountMatch;
    if (isWindowsHost) {
      return `${drive.toUpperCase()}:\\${rest.replaceAll("/", "\\")}`;
    }

    return `/mnt/${drive.toLowerCase()}/${rest.replaceAll("\\", "/")}`;
  }

  return isWindowsHost ? trimmed.replaceAll("/", "\\") : trimmed.replaceAll("\\", "/");
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

function commandNeedsApproval(mode: AgentJobApprovalMode, command: string) {
  if (mode === "restrictive") {
    return true;
  }

  if (mode === "full_access") {
    return false;
  }

  return /(^|\s)(sudo|su\b|passwd\b|shutdown\b|reboot\b|mkfs\b|dd\b|mount\b|umount\b|systemctl\b|service\b|chown\b|useradd\b|userdel\b|groupadd\b|groupdel\b|chmod\s+[0-7]{3,4}\b|rm\s+-rf\b|git\s+reset\s+--hard\b|git\s+clean\s+-fd\b|git\s+push\s+--force\b|docker\s+system\s+prune\b|docker\s+volume\s+rm\b)/.test(command);
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

function makeImplementationPrompt(params: {
  request: JobRequestShape;
  inspectionSummary: string;
  priorVerifierNotes: string[];
}) {
  const lines = [
    `Job title: ${params.request.title}`,
    `Goal: ${params.request.goal}`,
    `Workspace: ${params.request.workspacePath}`,
    "",
    "Workspace inspection:",
    params.inspectionSummary,
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
  );

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
  workspacePath: string;
  command: string;
  cwd?: string | null;
  timeoutSeconds: number;
}) {
  const targetCwd = ensureWithinWorkspace(params.workspacePath, params.cwd?.trim() || ".");

  try {
    const { stdout, stderr } = await execFileAsync("/bin/bash", ["-lc", params.command], {
      cwd: targetCwd,
      timeout: params.timeoutSeconds * 1000,
      maxBuffer: 1024 * 1024 * 4,
    });

    return {
      command: params.command,
      cwd: targetCwd,
      exitCode: 0,
      stdout: truncateText(stdout || ""),
      stderr: truncateText(stderr || ""),
    };
  } catch (error) {
    const execError = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
      message?: string;
    };

    return {
      command: params.command,
      cwd: targetCwd,
      exitCode: typeof execError.code === "number" ? execError.code : 1,
      stdout: truncateText(execError.stdout || ""),
      stderr: truncateText(execError.stderr || execError.message || "Command failed."),
    };
  }
}

function createBuildAgent(params: {
  inference: InferenceRuntimeConfig;
  settings: AgentJobSettingsRecord;
  request: JobRequestShape;
  workspacePath: string;
  approvalMode: AgentJobApprovalMode;
  activeTools?: Array<"list_directory" | "search_files" | "read_file" | "write_file" | "replace_in_file" | "make_directory" | "remove_path" | "run_command">;
}) {
  const resolved = resolveInferenceLanguageModel(params.inference);

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
          workspacePath: params.workspacePath,
          command,
          cwd,
          timeoutSeconds: timeoutSeconds ?? params.settings.maxCommandTimeoutSeconds,
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
  activeTools?: Array<"list_directory" | "search_files" | "read_file" | "write_file" | "replace_in_file" | "make_directory" | "remove_path" | "run_command">;
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

  const result = await agent.generate(
    params.messages
      ? {
          messages: params.messages,
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
}

export async function runImplementationAgent(params: {
  inference: InferenceRuntimeConfig;
  settings: AgentJobSettingsRecord;
  request: JobRequestShape;
  workspacePath: string;
  approvalMode: AgentJobApprovalMode;
  inspectionSummary: string;
  priorVerifierNotes: string[];
  messages?: SerializedAgentMessage[];
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
      priorVerifierNotes: params.priorVerifierNotes,
    }),
    messages: params.messages,
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
    }),
    messages: params.messages,
    activeTools: ["list_directory", "search_files", "read_file", "run_command"],
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
