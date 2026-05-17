import { spawn } from "node:child_process";
import { lookup } from "node:dns/promises";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { AppConfig } from "@secretary/config";
import { createMessageId } from "@secretary/core-runtime";
import type { DbClient } from "@secretary/db";
import { memoryEntries, tasks } from "@secretary/db";
import { createTelegramClient } from "@secretary/integrations";
import { asc, desc, eq } from "drizzle-orm";
import { retrieveRelevantMemories } from "../memory-engine/index.js";
import { sendConfiguredEmail } from "../outbound-channel-integrations.js";
import { defaultSecretaryName } from "../persona-soul.js";
import { normalizeTaskTitle, summarizeTaskSchedule } from "../task-runtime.js";
import { repoRoot } from "../utils.js";
import {
  BROWSER_TARGETS_DIR,
  CALENDAR_EXPORTS_DIR,
  DOWNLOADS_DIR,
  EMAIL_DRAFTS_DIR,
  FILE_PREVIEW_LIMIT,
  GENERATED_DOCUMENTS_DIR,
  MAX_DOWNLOAD_BYTES,
  MAX_FILE_READ_BYTES,
  SHELL_TIMEOUT_MS,
} from "./types.js";
import {
  ensureRuntimeGeneratedPath,
  hasBinaryLikeContent,
  resolveRuntimePath,
  resolveWorkspacePath,
} from "./utils.js";

const ALLOWED_DOWNLOAD_HOSTS: readonly string[] = process.env.ALLOWED_DOWNLOAD_HOSTS
  ? process.env.ALLOWED_DOWNLOAD_HOSTS.split(",").map((h) => h.trim().toLowerCase())
  : ["example.com"];

function sanitizeFileNamePart(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 72) || `item-${Date.now()}`
  );
}

function assertAllowedDownloadHost(hostname: string): void {
  const normalized = hostname.trim().toLowerCase();
  const allowed = ALLOWED_DOWNLOAD_HOSTS.some(
    (entry) => normalized === entry || normalized.endsWith(`.${entry}`),
  );
  if (!allowed) {
    throw new Error("Download URL host is not in the allowed list.");
  }
}

function parseAndValidateExternalUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Download URL must be a valid absolute URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only HTTP(S) download URLs are allowed.");
  }

  if (parsed.username || parsed.password) {
    throw new Error("Download URL must not include credentials.");
  }

  if (isPrivateOrLocalHost(parsed.hostname)) {
    throw new Error("Download URL targets a non-public host, which is not allowed.");
  }

  return parsed;
}

function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();

  if (!host) {
    return true;
  }

  if (host === "localhost" || host.endsWith(".localhost")) {
    return true;
  }

  // IPv6 literals in URLs may be bracketed.
  const normalized = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;

  // Common local/unsafe IPv6 forms.
  if (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd")
  ) {
    return true;
  }

  // Basic IPv4 literal detection and private/special range checks.
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized)) {
    const parts = normalized.split(".").map((part) => Number(part));
    if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
      return true;
    }

    const [a, b] = parts;
    if (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    ) {
      return true;
    }
  }

  return false;
}

function isPrivateOrLocalIp(address: string): boolean {
  const value = address.trim().toLowerCase();
  if (!value) {
    return true;
  }

  if (value.includes(":")) {
    return (
      value === "::1" ||
      value === "::" ||
      value.startsWith("fc") ||
      value.startsWith("fd") ||
      value.startsWith("fe80:") ||
      value.startsWith("::ffff:127.") ||
      value.startsWith("::ffff:10.") ||
      value.startsWith("::ffff:192.168.") ||
      /^::ffff:172\.(1[6-9]|2\d|3[0-1])\./.test(value)
    );
  }

  if (value === "0.0.0.0") {
    return true;
  }

  if (
    value.startsWith("10.") ||
    value.startsWith("127.") ||
    value.startsWith("169.254.") ||
    value.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(value)
  ) {
    return true;
  }

  return false;
}

async function assertPublicResolvedHost(hostname: string): Promise<void> {
  let resolved;
  try {
    resolved = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("Download URL hostname could not be resolved.");
  }

  if (!resolved.length) {
    throw new Error("Download URL hostname did not resolve to any address.");
  }

  for (const entry of resolved) {
    if (isPrivateOrLocalIp(entry.address)) {
      throw new Error("Download URL resolves to a non-public address, which is not allowed.");
    }
  }
}

export async function executeCrawl4aiLight(config: AppConfig, url: string) {
  if (!config.crawl4ai?.baseUrl) {
    throw new Error("Crawl4AI is not configured.");
  }
  const apiUrl = new URL("/crawl", config.crawl4ai.baseUrl);
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      urls: [url],
      crawler_config: { type: "CrawlerRunConfig", params: { stream: false, cache_mode: "bypass" } },
      browser_config: { type: "BrowserConfig", params: { headless: true } },
    }),
  });
  if (!response.ok) throw new Error(`Crawl4AI Light Crawl failed: ${response.status}`);
  const result = await response.json();
  const data = result.results?.[0] || result;
  const content = data.markdown || data.html || "";
  const title = data.title || "Untitled Page";
  return {
    responseJson: data,
    text: `Crawl4AI Light: "${title}"\n\n${content.slice(0, 8000)}${content.length > 8000 ? "...\n\n[Content truncated]" : ""}`,
  };
}

export async function executeCrawl4aiDeep(config: AppConfig, url: string) {
  if (!config.crawl4ai?.baseUrl) {
    throw new Error("Crawl4AI is not configured.");
  }
  const apiUrl = new URL("/crawl", config.crawl4ai.baseUrl);
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      urls: [url],
      crawler_config: {
        type: "CrawlerRunConfig",
        params: {
          stream: false,
          cache_mode: "bypass",
          extraction_strategy: { type: "JsonCssExtractionStrategy", params: {} },
        },
      },
      browser_config: {
        type: "BrowserConfig",
        params: {
          headless: true,
          viewport: { type: "dict", value: { width: 1920, height: 1080 } },
        },
      },
    }),
  });
  if (!response.ok) throw new Error(`Crawl4AI Deep Crawl failed: ${response.status}`);
  const result = await response.json();
  const data = result.results?.[0] || result;
  const content = data.markdown || data.html || "";
  const title = data.title || "Untitled Page";
  return {
    responseJson: data,
    text: `Crawl4AI Deep: "${title}"\n\n${content.slice(0, 8000)}${content.length > 8000 ? "...\n\n[Content truncated]" : ""}`,
  };
}

export async function executeCrawl4aiVariable(
  config: AppConfig,
  url: string,
  options: Record<string, unknown>,
) {
  if (!config.crawl4ai?.baseUrl) {
    throw new Error("Crawl4AI is not configured.");
  }
  const apiUrl = new URL("/crawl", config.crawl4ai.baseUrl);
  const payload = Object.assign({ urls: [url] }, options);
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Crawl4AI Variable Crawl failed: ${response.status}`);
  const result = await response.json();
  const data = result.results?.[0] || result;
  const content = data.markdown || data.html || "";
  const title = data.title || "Untitled Page";
  return {
    responseJson: data,
    text: `Crawl4AI Variable: "${title}"\n\n${content.slice(0, 8000)}${content.length > 8000 ? "...\n\n[Content truncated]" : ""}`,
  };
}

export async function executeWebSearch(config: AppConfig, query: string) {
  if (config.search.searxngBaseUrl) {
    const url = new URL("/search", config.search.searxngBaseUrl);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("language", "en-US");
    url.searchParams.set("safesearch", "1");

    const response = await fetch(url, {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`SearXNG search failed with ${response.status}.`);
    }

    const payload = (await response.json()) as {
      answers?: string[];
      results?: Array<{ title?: string; url?: string; content?: string }>;
    };
    const topResults = (payload.results ?? []).slice(0, 4).map((result) => ({
      summary: result.content?.trim() || null,
      title: result.title?.trim() || "Untitled result",
      url: result.url?.trim() || null,
    }));

    const shortSnippet = (text: string, max = 120) =>
      text.length > max ? `${text.slice(0, max - 3).trimEnd()}...` : text;

    const lines = [
      ...(payload.answers ?? []).slice(0, 2),
      ...topResults.map(
        (result, index) =>
          `${index + 1}. ${result.title}${result.url ? ` (${result.url})` : ""}${result.summary ? ` - ${shortSnippet(result.summary, 120)}` : ""}`,
      ),
    ].filter(Boolean);

    return {
      responseJson: {
        provider: "searxng",
        query,
        results: topResults,
      },
      text:
        lines.length > 0
          ? `I searched the web for "${query}" through SearXNG. ${lines.join(" ")}`
          : `I searched the web for "${query}" through SearXNG, but it did not return a strong summary.`,
    };
  }

  const url = new URL("https://api.duckduckgo.com/");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("no_html", "1");
  url.searchParams.set("skip_disambig", "1");

  const response = await fetch(url, {
    cache: "no-store",
  });
  const payload = (await response.json()) as {
    AbstractText?: string;
    AbstractURL?: string;
    RelatedTopics?: Array<{ FirstURL?: string; Text?: string }>;
  };

  const topResults = (payload.RelatedTopics ?? [])
    .flatMap((entry) =>
      "Text" in entry && entry.Text ? [{ title: entry.Text, url: entry.FirstURL ?? null }] : [],
    )
    .slice(0, 3);

  const lines = [
    payload.AbstractText?.trim() || null,
    ...topResults.map(
      (result, index) => `${index + 1}. ${result.title}${result.url ? ` (${result.url})` : ""}`,
    ),
  ].filter(Boolean) as string[];

  return {
    responseJson: {
      abstractUrl: payload.AbstractURL ?? null,
      provider: "duckduckgo_fallback",
      query,
      results: topResults,
    },
    text:
      lines.length > 0
        ? `I searched the web for "${query}". ${lines.join(" ")}`
        : `I searched the web for "${query}", but the search wrapper did not return a strong summary.`,
  };
}

export async function executeFileRead(pathInput: string) {
  const filePath = resolveWorkspacePath(pathInput);
  const raw = await readFile(filePath);

  if (raw.byteLength > MAX_FILE_READ_BYTES) {
    throw new Error("Requested file is too large for the safe preview limit.");
  }

  if (hasBinaryLikeContent(raw)) {
    throw new Error("Requested file looks binary and cannot be shown in the text reader.");
  }

  const text = raw.toString("utf8");
  const preview = text.slice(0, FILE_PREVIEW_LIMIT);
  const truncated = text.length > FILE_PREVIEW_LIMIT;

  return {
    responseJson: {
      bytes: raw.byteLength,
      path: pathInput,
      preview,
      truncated,
    },
    text: truncated
      ? `Here's the start of ${pathInput} (truncated):\n\n${preview}`
      : `Here's ${pathInput}:\n\n${preview}`,
  };
}

export async function executeFileWrite(pathInput: string, content: string) {
  const filePath = resolveWorkspacePath(pathInput);
  await mkdir(resolve(filePath, ".."), { recursive: true });
  await writeFile(filePath, content, "utf8");

  return {
    responseJson: {
      bytes: Buffer.byteLength(content, "utf8"),
      path: pathInput,
    },
    text: `I wrote ${pathInput} safely inside the workspace.`,
  };
}

export async function executeDocumentCreate(requestJson: Record<string, unknown>) {
  const title =
    typeof requestJson.title === "string" && requestJson.title.trim()
      ? requestJson.title.trim()
      : "Secretary Note";
  const content =
    typeof requestJson.content === "string" && requestJson.content.trim()
      ? requestJson.content.trim()
      : `# ${title}\n`;
  const filename = `${sanitizeFileNamePart(title)}.md`;
  const relativePath = `${GENERATED_DOCUMENTS_DIR}/${filename}`;
  const fullPath = resolveRuntimePath(relativePath);
  await mkdir(resolve(fullPath, ".."), { recursive: true });
  await writeFile(fullPath, content, "utf8");

  return {
    responseJson: {
      path: relativePath,
      title,
    },
    text: `Created "${title}" — saved to ${relativePath}.`,
  };
}

export async function executeDownloadUrl(requestJson: Record<string, unknown>) {
  const url = typeof requestJson.url === "string" ? requestJson.url.trim() : "";
  if (!url) {
    throw new Error("Download URL is required.");
  }

  const parsedUrl = parseAndValidateExternalUrl(url);
  assertAllowedDownloadHost(parsedUrl.hostname);
  await assertPublicResolvedHost(parsedUrl.hostname);
  const normalizedUrl = parsedUrl.toString();

  const response = await fetch(normalizedUrl, { cache: "no-store", redirect: "error" });
  if (!response.ok) {
    throw new Error(`Download failed with ${response.status}.`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MAX_DOWNLOAD_BYTES) {
    throw new Error("Downloaded file exceeded the safe size limit.");
  }

  const customPath =
    typeof requestJson.path === "string" && requestJson.path.trim()
      ? requestJson.path.trim()
      : null;
  const fallbackName = basename(parsedUrl.pathname) || `download-${Date.now()}`;
  const filename = sanitizeFileNamePart(customPath ? basename(customPath) : fallbackName);
  const relativePath = customPath ?? `${DOWNLOADS_DIR}/${filename}`;
  const targetPath = resolveWorkspacePath(relativePath);
  await mkdir(resolve(targetPath, ".."), { recursive: true });
  await writeFile(targetPath, bytes);

  return {
    responseJson: {
      bytes: bytes.byteLength,
      path: relativePath,
      url: normalizedUrl,
    },
    text: `Downloaded ${normalizedUrl} to ${relativePath}.`,
  };
}

export function allowedShellCommand(command: string) {
  const normalized = command.trim();
  const allowedPatterns = [
    /^git status$/i,
    /^git diff --stat$/i,
    /^git log --oneline(?:\s+-\d+)?$/i,
    /^git branch(?:\s+--list)?$/i,
    /^git remote -v$/i,
    /^npm run (build|typecheck|lint|test)$/i,
    /^npm ls(?:\s+--depth=\d+)?$/i,
    /^node --version$/i,
    /^Get-ChildItem(?:\s|$)/i,
    /^Get-Content(?:\s|$)/i,
    /^dir(?:\s|$)/i,
    /^ls(?:\s+-[a-zA-Z]+)?(?:\s+[^;|&<>]+)?$/i,
    /^cat\s+[^;|&<>]+$/i,
    /^pwd$/i,
    /^echo\s+[^;|&<>]+$/i,
  ];

  return allowedPatterns.some((pattern) => pattern.test(normalized));
}

export async function executeShellCommand(command: string) {
  if (!allowedShellCommand(command)) {
    throw new Error("Shell command is outside the constrained allowlist.");
  }

  const shellCommand = process.platform === "win32" ? "powershell" : "bash";
  const shellArgs =
    process.platform === "win32" ? ["-NoProfile", "-Command", command] : ["-lc", command];

  const output = await new Promise<{ durationMs: number; stderr: string; stdout: string }>(
    (resolvePromise, rejectPromise) => {
      const startedAt = Date.now();
      const child = spawn(shellCommand, shellArgs, {
        cwd: repoRoot,
        shell: false,
      });
      let stdout = "";
      let stderr = "";
      const timeout = setTimeout(() => {
        child.kill();
        rejectPromise(
          new Error(`Command exceeded the ${SHELL_TIMEOUT_MS / 1000}s safety timeout.`),
        );
      }, SHELL_TIMEOUT_MS);

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => {
        clearTimeout(timeout);
        rejectPromise(error);
      });
      child.on("exit", (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolvePromise({ durationMs: Date.now() - startedAt, stdout, stderr });
          return;
        }

        rejectPromise(new Error(stderr || `Command exited with ${code}`));
      });
    },
  );

  return {
    responseJson: {
      command,
      durationMs: output.durationMs,
      stderr: output.stderr.slice(0, 4000),
      stdout: output.stdout.slice(0, 4000),
    },
    text: `\`${command}\` output:\n\n${(output.stdout || output.stderr || "No output.").slice(0, 1200)}`,
  };
}

export async function executeTaskList(
  dbClient: DbClient,
  userId: string,
  requestJson: Record<string, unknown>,
) {
  const status =
    requestJson.status === "done" || requestJson.status === "all" ? requestJson.status : "open";
  const limit =
    typeof requestJson.limit === "number" && Number.isFinite(requestJson.limit)
      ? Math.max(1, Math.min(20, Math.round(requestJson.limit)))
      : 12;

  const records = await dbClient.db.query.tasks.findMany({
    where: eq(tasks.userId, userId),
    orderBy: [asc(tasks.reminderAt), asc(tasks.dueAt), desc(tasks.updatedAt)],
    limit,
  });

  const filtered = records.filter((task) =>
    status === "all"
      ? true
      : status === "done"
        ? task.status === "done"
        : task.status === "open" || task.status === "in_progress",
  );

  return {
    responseJson: {
      status,
      tasks: filtered.map((task) => ({
        dueAt: task.dueAt?.toISOString() ?? null,
        id: task.id,
        reminderAt: task.reminderAt?.toISOString() ?? null,
        status: task.status,
        title: task.title,
      })),
    },
    text:
      filtered.length === 0
        ? status === "done"
          ? "No completed tasks yet."
          : "No open tasks right now."
        : `${filtered.length} task${filtered.length === 1 ? "" : "s"}: ${filtered
            .map((task) => {
              const timing = task.reminderAt
                ? `reminder ${task.reminderAt.toLocaleString()}`
                : task.dueAt
                  ? `due ${task.dueAt.toLocaleString()}`
                  : task.status;
              return `${task.title} (${timing})`;
            })
            .join("; ")}`,
  };
}

export async function executeTaskCreate(
  dbClient: DbClient,
  userId: string,
  requestJson: Record<string, unknown>,
  context: { channel: string; telegramChatId?: string | null },
) {
  const title = typeof requestJson.title === "string" ? requestJson.title.trim() : "";
  if (!title) {
    throw new Error("Task title is required.");
  }

  const recentTasks = await dbClient.db.query.tasks.findMany({
    where: eq(tasks.userId, userId),
    orderBy: [desc(tasks.updatedAt)],
    limit: 40,
  });
  const existing = recentTasks.find(
    (task) =>
      normalizeTaskTitle(task.title) === normalizeTaskTitle(title) &&
      (task.status === "open" || task.status === "in_progress"),
  );

  if (existing) {
    return {
      responseJson: {
        existing: true,
        taskId: existing.id,
        title: existing.title,
      },
      text: `"${existing.title}" is already on your list — I left it as is.`,
    };
  }

  const taskId = createMessageId();
  const detail =
    typeof requestJson.detail === "string" && requestJson.detail.trim()
      ? requestJson.detail.trim()
      : "Created from an explicit secretary task request.";
  const dueAt =
    typeof requestJson.dueAt === "string" && requestJson.dueAt ? new Date(requestJson.dueAt) : null;
  const reminderAt =
    typeof requestJson.reminderAt === "string" && requestJson.reminderAt
      ? new Date(requestJson.reminderAt)
      : null;
  const deliveryChannelType =
    typeof requestJson.deliveryChannelType === "string" && requestJson.deliveryChannelType.trim()
      ? requestJson.deliveryChannelType.trim()
      : context.channel === "telegram" && context.telegramChatId
        ? "telegram"
        : null;
  const deliveryTargetRef =
    typeof requestJson.deliveryTargetRef === "string" && requestJson.deliveryTargetRef.trim()
      ? requestJson.deliveryTargetRef.trim()
      : context.channel === "telegram" && context.telegramChatId
        ? context.telegramChatId
        : null;

  await dbClient.db.insert(tasks).values({
    id: taskId,
    userId,
    conversationId: null,
    title,
    detail,
    status: "open",
    dueAt,
    reminderAt,
    deliveryChannelType,
    deliveryTargetRef,
    sourceKind: "tool",
    sourceRef: "task_create",
  });

  const taskDraft = {
    title,
    dueAt,
    reminderAt,
  };

  return {
    responseJson: {
      dueAt: dueAt?.toISOString() ?? null,
      deliveryChannelType,
      deliveryTargetRef,
      reminderAt: reminderAt?.toISOString() ?? null,
      taskId,
      title,
    },
    text: summarizeTaskSchedule(taskDraft),
  };
}

async function findTaskByReference(dbClient: DbClient, userId: string, reference: string) {
  const exact = await dbClient.db.query.tasks.findFirst({
    where: eq(tasks.id, reference),
  });

  if (exact && exact.userId === userId) {
    return exact;
  }

  const recent = await dbClient.db.query.tasks.findMany({
    where: eq(tasks.userId, userId),
    orderBy: [desc(tasks.updatedAt)],
    limit: 25,
  });

  const normalizedReference = normalizeTaskTitle(reference);
  return (
    recent.find((task) => normalizeTaskTitle(task.title) === normalizedReference) ??
    recent.find((task) => normalizeTaskTitle(task.title).includes(normalizedReference)) ??
    null
  );
}

export async function executeTaskUpdate(
  dbClient: DbClient,
  userId: string,
  requestJson: Record<string, unknown>,
) {
  const reference = typeof requestJson.reference === "string" ? requestJson.reference.trim() : "";
  if (!reference) {
    throw new Error("Task reference is required.");
  }

  const task = await findTaskByReference(dbClient, userId, reference);
  if (!task) {
    throw new Error(`No matching task was found for "${reference}".`);
  }

  const nextStatus =
    typeof requestJson.status === "string" && requestJson.status.trim()
      ? requestJson.status.trim()
      : task.status;
  const dueAt =
    typeof requestJson.dueAt === "string" && requestJson.dueAt
      ? new Date(requestJson.dueAt)
      : task.dueAt;
  const reminderAt =
    typeof requestJson.reminderAt === "string" && requestJson.reminderAt
      ? new Date(requestJson.reminderAt)
      : task.reminderAt;
  const detail =
    typeof requestJson.detail === "string" && requestJson.detail.trim()
      ? requestJson.detail.trim()
      : task.detail;

  await dbClient.db
    .update(tasks)
    .set({
      detail,
      dueAt,
      reminderAt,
      status: nextStatus,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, task.id));

  return {
    responseJson: {
      dueAt: dueAt?.toISOString() ?? null,
      reminderAt: reminderAt?.toISOString() ?? null,
      status: nextStatus,
      taskId: task.id,
      title: task.title,
    },
    text:
      nextStatus === "done"
        ? `I marked "${task.title}" as done.`
        : `I updated "${task.title}"${reminderAt ? ` and set its reminder to ${reminderAt.toLocaleString()}` : dueAt ? ` and set it due ${dueAt.toLocaleString()}` : ""}.`,
  };
}

async function findMemoryByReference(dbClient: DbClient, reference: string) {
  const exact = await dbClient.db.query.memoryEntries.findFirst({
    where: eq(memoryEntries.id, reference),
  });

  if (exact) {
    return exact;
  }

  const recent = await dbClient.db.query.memoryEntries.findMany({
    orderBy: [desc(memoryEntries.updatedAt)],
    limit: 30,
  });
  const normalizedReference = reference.toLowerCase();
  return (
    recent.find((memory) => (memory.title ?? "").toLowerCase() === normalizedReference) ??
    recent.find((memory) => memory.contentText.toLowerCase().includes(normalizedReference)) ??
    null
  );
}

export async function executeMemoryWrite(dbClient: DbClient, requestJson: Record<string, unknown>) {
  const operation = typeof requestJson.operation === "string" ? requestJson.operation.trim() : "";

  if (operation === "create") {
    const contentText =
      typeof requestJson.contentText === "string" ? requestJson.contentText.trim() : "";
    if (!contentText) {
      throw new Error("Memory content is required.");
    }

    const memoryId = createMessageId();
    const title =
      typeof requestJson.title === "string" && requestJson.title.trim()
        ? requestJson.title.trim()
        : contentText.slice(0, 60);

    await dbClient.db.insert(memoryEntries).values({
      id: memoryId,
      memoryType: "semantic",
      title,
      summary: contentText.slice(0, 120) + (contentText.length > 120 ? "..." : ""),
      contentText,
      contentJson: {},
      tags: ["explicit"],
      sourceKind: "tool",
      sourceRef: "memory_write",
      importanceScore: 70,
      confidenceScore: 90,
      pinned: false,
      suppressed: false,
    });

    return {
      responseJson: {
        memoryId,
        operation,
        title,
      },
      text: `Remembered: "${title}"`,
    };
  }

  const reference = typeof requestJson.reference === "string" ? requestJson.reference.trim() : "";
  if (!reference) {
    throw new Error("Memory reference is required.");
  }

  const memory = await findMemoryByReference(dbClient, reference);
  if (!memory) {
    throw new Error(`No matching memory was found for "${reference}".`);
  }

  await dbClient.db
    .update(memoryEntries)
    .set({
      pinned: operation === "pin" ? true : memory.pinned,
      suppressed:
        operation === "suppress" ? true : operation === "unsuppress" ? false : memory.suppressed,
      updatedAt: new Date(),
    })
    .where(eq(memoryEntries.id, memory.id));

  return {
    responseJson: {
      memoryId: memory.id,
      operation,
      title: memory.title ?? null,
    },
    text:
      operation === "pin"
        ? `Pinned "${memory.title ?? memory.id}".`
        : operation === "suppress"
          ? `Removed "${memory.title ?? memory.id}" from active memory.`
          : `Restored "${memory.title ?? memory.id}".`,
  };
}

export async function executeTelegramSend(config: AppConfig, requestJson: Record<string, unknown>) {
  const message = typeof requestJson.message === "string" ? requestJson.message.trim() : "";
  const chatId =
    typeof requestJson.chatId === "string" && requestJson.chatId.trim()
      ? requestJson.chatId.trim()
      : config.telegram.defaultChatId;

  if (!config.telegram.botToken) {
    throw new Error("Telegram bot token is not configured.");
  }

  if (!chatId) {
    throw new Error("No Telegram chat id is configured for proactive sends.");
  }

  if (!message) {
    throw new Error("Telegram message content is required.");
  }

  const client = createTelegramClient({
    apiBaseUrl: config.telegram.apiBaseUrl,
    botToken: config.telegram.botToken,
  });
  const sentMessageIds = await client.sendMessageChunks(chatId, message);

  return {
    responseJson: {
      chatId,
      message,
      sentMessageIds,
    },
    text: `Sent to Telegram.`,
  };
}

export async function executeBrowserOpen(requestJson: Record<string, unknown>) {
  const target = typeof requestJson.target === "string" ? requestJson.target.trim() : "";
  if (!target) {
    throw new Error("Browser target is required.");
  }

  const targetDir = await ensureRuntimeGeneratedPath(BROWSER_TARGETS_DIR);
  const createdAt = new Date().toISOString();
  const note = typeof requestJson.note === "string" ? requestJson.note.trim() : "";
  const fileName = `${Date.now()}-${sanitizeFileNamePart(new URL(target).hostname)}.md`;
  const relativePath = `${BROWSER_TARGETS_DIR}/${fileName}`;
  const content = [
    `# Browser follow-up`,
    "",
    `Target: ${target}`,
    `Created: ${createdAt}`,
    note
      ? `Next action: ${note}`
      : "Next action: Review this page and continue the follow-up from the Activity history.",
    "",
    "This target was saved by the secretary for follow-through.",
  ].join("\n");

  await writeFile(resolve(targetDir, fileName), content, "utf8");

  return {
    responseJson: {
      createdAt,
      path: relativePath,
      target,
    },
    text: `Saved ${target} to ${relativePath}.`,
  };
}

export async function executeCalendarCreate(requestJson: Record<string, unknown>) {
  const title = typeof requestJson.title === "string" ? requestJson.title.trim() : "";
  const startAt = typeof requestJson.startAt === "string" ? new Date(requestJson.startAt) : null;
  const durationMinutes =
    typeof requestJson.durationMinutes === "number" && Number.isFinite(requestJson.durationMinutes)
      ? Math.max(15, Math.round(requestJson.durationMinutes))
      : 60;
  const detail = typeof requestJson.detail === "string" ? requestJson.detail.trim() : "";

  if (!title || !startAt || Number.isNaN(startAt.getTime())) {
    throw new Error("Calendar event title and start time are required.");
  }

  const endAt = new Date(startAt.getTime() + durationMinutes * 60_000);
  const targetDir = await ensureRuntimeGeneratedPath(CALENDAR_EXPORTS_DIR);
  const fileName = `${Date.now()}-${sanitizeFileNamePart(title)}.ics`;
  const relativePath = `${CALENDAR_EXPORTS_DIR}/${fileName}`;
  const formatIcsDate = (value: Date) =>
    value
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z");
  const content = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Secretary//Light Work//EN",
    "BEGIN:VEVENT",
    `UID:${createMessageId()}@secretary.local`,
    `DTSTAMP:${formatIcsDate(new Date())}`,
    `DTSTART:${formatIcsDate(startAt)}`,
    `DTEND:${formatIcsDate(endAt)}`,
    `SUMMARY:${title.replace(/[\\,;]/g, "")}`,
    detail ? `DESCRIPTION:${detail.replace(/\n/g, "\\n").replace(/[\\,;]/g, "")}` : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");

  await writeFile(resolve(targetDir, fileName), content, "utf8");

  return {
    responseJson: {
      durationMinutes,
      endAt: endAt.toISOString(),
      path: relativePath,
      startAt: startAt.toISOString(),
      title,
    },
    text: `Drafted "${title}" for ${startAt.toLocaleString()} (${durationMinutes} mins) — saved to ${relativePath}.`,
  };
}

export async function executeEmailDraft(requestJson: Record<string, unknown>) {
  const to = typeof requestJson.to === "string" ? requestJson.to.trim() : "";
  const subject = typeof requestJson.subject === "string" ? requestJson.subject.trim() : "";
  const body = typeof requestJson.body === "string" ? requestJson.body.trim() : "";

  if (!to || !subject) {
    throw new Error("Email drafts need a recipient and subject.");
  }

  const targetDir = await ensureRuntimeGeneratedPath(EMAIL_DRAFTS_DIR);
  const fileName = `${Date.now()}-${sanitizeFileNamePart(to)}-${sanitizeFileNamePart(subject)}.md`;
  const relativePath = `${EMAIL_DRAFTS_DIR}/${fileName}`;
  const draftBody = body || `Hi ${to},\n\n${subject}\n\nBest,\n${defaultSecretaryName}`;
  const content = [
    `# Email Draft`,
    "",
    `To: ${to}`,
    `Subject: ${subject}`,
    `Created: ${new Date().toISOString()}`,
    "",
    draftBody,
    "",
    "_Drafted by the secretary for review before sending._",
  ].join("\n");

  await writeFile(resolve(targetDir, fileName), content, "utf8");

  return {
    responseJson: {
      path: relativePath,
      subject,
      to,
    },
    text: `Drafted email to ${to} — saved to ${relativePath}.`,
  };
}

export async function executeEmailSend(
  config: AppConfig,
  dbClient: DbClient,
  requestJson: Record<string, unknown>,
) {
  const to = typeof requestJson.to === "string" ? requestJson.to.trim() : "";
  const subject = typeof requestJson.subject === "string" ? requestJson.subject.trim() : "";
  const body = typeof requestJson.body === "string" ? requestJson.body.trim() : "";

  if (!to || !subject) {
    throw new Error("Email sends need a recipient and subject.");
  }

  const result = await sendConfiguredEmail({
    config,
    dbClient,
    recipient: to,
    subject,
    text: body || subject,
  });

  return {
    responseJson: {
      messageId: result.messageId,
      subject,
      to: result.recipient,
    },
    text: `Email sent to ${result.recipient}.`,
  };
}

async function resolveTaskExecutionContext(
  dbClient: DbClient,
  conversationId: string | null | undefined,
) {
  if (!conversationId) {
    return {
      channel: "web" as const,
      telegramChatId: null,
    };
  }

  const { conversations } = await import("@secretary/db");
  const conversation = await dbClient.db.query.conversations.findFirst({
    where: eq(conversations.id, conversationId),
  });

  return {
    channel: conversation?.channelType === "telegram" ? ("telegram" as const) : ("web" as const),
    telegramChatId: conversation?.channelType === "telegram" ? conversation.channelRef : null,
  };
}

export async function executeToolRequest(params: {
  config: AppConfig;
  conversationId?: string | null;
  dbClient: DbClient;
  requestJson: Record<string, unknown>;
  requestedBy: string;
  toolKey: string;
}) {
  switch (params.toolKey) {
    case "web_search":
      return executeWebSearch(params.config, String(params.requestJson.query ?? ""));
    case "crawl4ai_light":
      return executeCrawl4aiLight(params.config, String(params.requestJson.url ?? ""));
    case "crawl4ai_deep":
      return executeCrawl4aiDeep(params.config, String(params.requestJson.url ?? ""));
    case "crawl4ai_variable":
      return executeCrawl4aiVariable(
        params.config,
        String(params.requestJson.url ?? ""),
        params.requestJson.options && typeof params.requestJson.options === "object"
          ? (params.requestJson.options as Record<string, unknown>)
          : {},
      );
    case "file_read":
      return executeFileRead(String(params.requestJson.path ?? ""));
    case "file_write":
      return executeFileWrite(
        String(params.requestJson.path ?? ""),
        String(params.requestJson.content ?? ""),
      );
    case "document_create":
      return executeDocumentCreate(params.requestJson);
    case "download_url":
      return executeDownloadUrl(params.requestJson);
    case "shell_command":
      return executeShellCommand(String(params.requestJson.command ?? ""));
    case "task_create":
      return executeTaskCreate(
        params.dbClient,
        params.requestedBy,
        params.requestJson,
        await resolveTaskExecutionContext(params.dbClient, params.conversationId),
      );
    case "task_list":
      return executeTaskList(params.dbClient, params.requestedBy, params.requestJson);
    case "task_update":
      return executeTaskUpdate(params.dbClient, params.requestedBy, params.requestJson);
    case "memory_write":
      return executeMemoryWrite(params.dbClient, params.requestJson);
    case "telegram_send":
      return executeTelegramSend(params.config, params.requestJson);
    case "browser_open":
      return executeBrowserOpen(params.requestJson);
    case "calendar_create":
      return executeCalendarCreate(params.requestJson);
    case "email_draft":
      return executeEmailDraft(params.requestJson);
    case "email_send":
      return executeEmailSend(params.config, params.dbClient, params.requestJson);
    case "memory_read": {
      const query = String(params.requestJson.query ?? "");
      if (!query) {
        throw new Error("Memory search query is required.");
      }
      const results = await retrieveRelevantMemories(params.dbClient, query);
      const lines = results.map((m) => {
        const body = m.summary || m.contentText || "";
        return m.title ? `[${m.title}] ${body}` : body;
      });
      return {
        responseJson: { query, count: results.length, results },
        text:
          lines.length > 0
            ? `${lines.join(" | ")}`
            : `I don't remember anything about "${query}" yet.`,
      };
    }
    case "note_to_self": {
      const contentText = String(params.requestJson.contentText ?? "").trim();
      if (!contentText) {
        throw new Error("Note content is required.");
      }
      const title = String(params.requestJson.title ?? contentText.slice(0, 60)).trim();
      const memoryId = createMessageId();
      await params.dbClient.db.insert(memoryEntries).values({
        id: memoryId,
        memoryType: "semantic",
        title,
        summary: contentText.slice(0, 140),
        contentText,
        contentJson: { source: "note_to_self" },
        tags: ["note", "proactive"],
        sourceKind: "tool",
        sourceRef: "note_to_self",
        importanceScore: 68,
        confidenceScore: 85,
        pinned: false,
        suppressed: false,
      });
      return {
        responseJson: { memoryId, title },
        text: `Noted: "${title}"`,
      };
    }
    default:
      throw new Error(`Unsupported tool key ${params.toolKey}.`);
  }
}
