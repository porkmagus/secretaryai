import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import type { AgentJobApprovalMode, AgentJobSettingsRecord } from "@secretary/core-runtime";
import { stepCountIs, ToolLoopAgent, tool } from "ai";
import { z } from "zod";
import {
  createAgentJobArtifactStorageKey,
  ensureAgentJobArtifactStoragePath,
} from "../agent-job-artifact-storage.js";
import { type InferenceRuntimeConfig, resolveInferenceLanguageModel } from "../ai-sdk-registry.js";
import { commandNeedsApproval, isForbiddenCommand, makeAgentInstructions } from "./requirements.js";
import type { AgentStepSnapshot, ApprovalRequestRecord, CommandLogRecord } from "./utils.js";
import {
  type AgentToolName,
  createExecutionRunner,
  ensureWithinWorkspace,
  type JobRequestShape,
  looksLikeNetworkCommand,
  truncateText,
} from "./utils.js";

const execFileAsync = promisify(execFile);
const MAX_FILE_READ_BYTES = 200_000;
const _MAX_TEXT_OUTPUT = 16_000;

export async function listDirectoryImpl(workspacePath: string, pathValue: string) {
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

export async function searchFilesImpl(
  workspacePath: string,
  pattern: string,
  cwd?: string | null,
  maxResults = 40,
) {
  const targetCwd = ensureWithinWorkspace(workspacePath, cwd?.trim() || ".");
  const { stdout } = await execFileAsync(
    "rg",
    [
      "-n",
      "--no-heading",
      "--color",
      "never",
      "-m",
      String(Math.max(1, Math.min(200, maxResults))),
      pattern,
      targetCwd,
    ],
    {
      cwd: workspacePath,
      maxBuffer: 1024 * 1024,
    },
  );

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

export async function readFileImpl(workspacePath: string, pathValue: string) {
  const targetPath = ensureWithinWorkspace(workspacePath, pathValue);
  const content = await readFile(targetPath, "utf8");
  return {
    path: targetPath,
    content: truncateText(content, MAX_FILE_READ_BYTES),
  };
}

export async function writeFileImpl(workspacePath: string, pathValue: string, content: string) {
  const targetPath = ensureWithinWorkspace(workspacePath, pathValue);
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content, "utf8");
  return {
    path: targetPath,
    bytesWritten: Buffer.byteLength(content, "utf8"),
  };
}

export async function replaceInFileImpl(params: {
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
  const replacements = params.replaceAll ? existing.split(params.searchText).length - 1 : 1;

  await writeFile(targetPath, next, "utf8");

  return {
    path: targetPath,
    replaced: true,
    replacements,
  };
}

export async function makeDirectoryImpl(workspacePath: string, pathValue: string) {
  const targetPath = ensureWithinWorkspace(workspacePath, pathValue);
  await mkdir(targetPath, { recursive: true });
  return {
    path: targetPath,
    created: true,
  };
}

export async function removePathImpl(workspacePath: string, pathValue: string) {
  const targetPath = ensureWithinWorkspace(workspacePath, pathValue);
  await rm(targetPath, { recursive: true, force: true });
  return {
    path: targetPath,
    removed: true,
  };
}

export async function runCommandImpl(params: {
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
      stderr:
        "Blocked by agent safety policy: this command is too destructive to run automatically.",
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

export async function probeHttpImpl(url: string) {
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

export async function checkPortImpl(host: string, port: number, timeoutMs = 2_000) {
  return new Promise<{ host: string; port: number; open: boolean; error: string | null }>(
    (resolvePromise) => {
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
    },
  );
}

export async function browserVisitImpl(params: {
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
      await page
        .getByText(params.waitForText.trim(), { exact: false })
        .first()
        .waitFor({
          timeout: params.timeoutMs ?? 10_000,
        });
    }

    const title = await page.title();
    const bodyText = await page
      .locator("body")
      .innerText()
      .catch(() => "");
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
export async function webSearchImpl(query: string, maxResults: number) {
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
export async function fetchUrlImpl(url: string, maxLength: number) {
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
      const text = await page
        .locator("body")
        .innerText()
        .catch(() => "");
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
export async function downloadUrlImpl(params: {
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
export async function siteCrawlImpl(params: {
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
    "--level",
    String(params.maxDepth),
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

  // Use -- to separate options from arguments to prevent command injection
  args.push("-P", outputPath, "--", params.url);

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

export function createBuildAgent(params: {
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
        cwd: z
          .string()
          .nullable()
          .optional()
          .describe("Optional subdirectory inside the workspace."),
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
      needsApproval: params.approvalMode === "restrictive",
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
      needsApproval: params.approvalMode === "restrictive",
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
      needsApproval: params.approvalMode === "restrictive",
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
      description:
        "Run a shell command inside the workspace and return stdout, stderr, and exit code.",
      inputSchema: z.object({
        command: z.string().describe("Shell command to execute."),
        cwd: z
          .string()
          .nullable()
          .optional()
          .describe("Optional working directory inside the workspace."),
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
      description:
        "Fetch an HTTP endpoint and capture status, headers, and a short response preview.",
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
      description:
        "Open a URL in a headless browser, capture page metadata, and save a screenshot artifact.",
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
      description:
        "Search the web using SearXNG for current information, documentation, or research.",
      inputSchema: z.object({
        query: z.string().describe("Search query to look up."),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(10)
          .optional()
          .describe("Maximum results to return (default: 5)."),
      }),
      needsApproval: !params.settings.allowNetworkAccess,
      execute: async ({ query, maxResults }) => webSearchImpl(query, maxResults ?? 5),
    }),
    fetch_url: tool({
      description:
        "Fetch and extract text content from a URL (useful for reading docs, articles, etc.)",
      inputSchema: z.object({
        url: z.string().url().describe("URL to fetch content from."),
        maxLength: z
          .number()
          .int()
          .min(100)
          .max(50000)
          .optional()
          .describe("Maximum characters to return (default: 10000)."),
      }),
      needsApproval: !params.settings.allowNetworkAccess,
      execute: async ({ url, maxLength }) => fetchUrlImpl(url, maxLength ?? 10000),
    }),
    download_url: tool({
      description: "Download a file from a URL and save it to the workspace.",
      inputSchema: z.object({
        url: z.string().url().describe("URL of the file to download."),
        filename: z
          .string()
          .optional()
          .describe("Optional filename to save as (defaults to URL basename)."),
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
      description:
        "Crawl a website and save pages locally using wget (respects robots.txt by default).",
      inputSchema: z.object({
        url: z.string().url().describe("Starting URL to crawl."),
        maxDepth: z
          .number()
          .int()
          .min(1)
          .max(5)
          .optional()
          .describe("Maximum crawl depth (default: 2)."),
        maxPages: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Maximum pages to download (default: 50)."),
        sameDomain: z.boolean().optional().describe("Only crawl same domain (default: true)."),
        outputDir: z
          .string()
          .optional()
          .describe("Output directory name (default: 'crawled-site')."),
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

export function serializeStepSnapshots(
  stepResults: Array<{
    stepNumber: number;
    finishReason: string;
    text: string;
    reasoningText?: string;
    toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }>;
    toolResults: Array<{ toolCallId: string; toolName: string; output: unknown }>;
    usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  }>,
): AgentStepSnapshot[] {
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

export function collectApprovalRequests(content: Array<{ type: string; [key: string]: unknown }>) {
  return content
    .filter((part) => part.type === "tool-approval-request")
    .map((part) => {
      const toolCall = part.toolCall as
        | { toolCallId?: string; toolName?: string; input?: unknown }
        | undefined;
      return {
        approvalId: String(part.approvalId),
        toolCallId: toolCall?.toolCallId ?? String(part.approvalId),
        toolName: toolCall?.toolName ?? "unknown",
        input: toolCall?.input ?? null,
      } satisfies ApprovalRequestRecord;
    });
}

export function collectCommandLogs(stepSnapshots: AgentStepSnapshot[]) {
  const logs: CommandLogRecord[] = [];

  for (const step of stepSnapshots) {
    for (const result of step.toolResults) {
      if (
        result.toolName !== "run_command" ||
        typeof result.output !== "object" ||
        !result.output
      ) {
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
