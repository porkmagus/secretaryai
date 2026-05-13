import type { ToolApprovalMode } from "@secretary/core-runtime";

// ─── Types ──────────────────────────────────────────────────────────────────

export type BuiltInTool = {
  key: string;
  name: string;
  description: string;
  approvalMode: ToolApprovalMode;
  enabled?: boolean;
  healthStatus?: string;
};

export type ToolIntent = {
  requestJson: Record<string, unknown>;
  summary: string;
  toolKey:
    | "task_create"
    | "task_list"
    | "task_update"
    | "web_search"
    | "web_scrape"
    | "file_read"
    | "file_write"
    | "document_create"
    | "download_url"
    | "memory_write"
    | "memory_read"
    | "note_to_self"
    | "telegram_send"
    | "shell_command"
    | "browser_open"
    | "calendar_create"
    | "email_draft"
    | "email_send";
};

// ─── Constants ──────────────────────────────────────────────────────────────

export const FILE_PREVIEW_LIMIT = 1500;
export const MAX_FILE_READ_BYTES = 256 * 1024;
export const MAX_DOWNLOAD_BYTES = 4 * 1024 * 1024;
export const SHELL_TIMEOUT_MS = 20_000;
export const GENERATED_DOCUMENTS_DIR = "runtime/generated/documents";
export const EMAIL_DRAFTS_DIR = "runtime/generated/email-drafts";
export const CALENDAR_EXPORTS_DIR = "runtime/generated/calendar-events";
export const BROWSER_TARGETS_DIR = "runtime/generated/browser-targets";
export const DOWNLOADS_DIR = "runtime/downloads";

// ─── Built-in Tool Registry ─────────────────────────────────────────────────

export const builtInTools: BuiltInTool[] = [
  {
    key: "web_search",
    name: "Web Search",
    description: "Look up current public information through the local SearXNG search wrapper.",
    approvalMode: "always_allow",
  },
  {
    key: "crawl4ai_light",
    name: "Crawl4AI Light Crawl",
    description: "Extract the main text content from a URL using Crawl4AI in fast mode.",
    approvalMode: "always_allow",
  },
  {
    key: "crawl4ai_deep",
    name: "Crawl4AI Deep Crawl",
    description:
      "Extract structured content from a URL with Crawl4AI, including metadata and links.",
    approvalMode: "always_allow",
  },
  {
    key: "crawl4ai_variable",
    name: "Crawl4AI Variable Extraction",
    description: "Extract specific fields from a page using Crawl4AI extraction schema.",
    approvalMode: "always_allow",
  },
  {
    key: "file_read",
    name: "File Read",
    description: "Read the contents of a file from the workspace or runtime directory.",
    approvalMode: "ask_first",
  },
  {
    key: "file_write",
    name: "File Write",
    description: "Write content to a file in the workspace or runtime directory.",
    approvalMode: "ask_first",
  },
  {
    key: "document_create",
    name: "Document Create",
    description: "Create a formatted document (markdown, text, or code) in the runtime directory.",
    approvalMode: "always_allow",
  },
  {
    key: "download_url",
    name: "Download URL",
    description: "Download a file from a URL to the runtime downloads directory.",
    approvalMode: "always_allow",
  },
  {
    key: "task_create",
    name: "Task Create",
    description: "Create a new task with a title, description, priority, and optional schedule.",
    approvalMode: "always_allow",
  },
  {
    key: "task_list",
    name: "Task List",
    description: "List tasks filtered by status, priority, or search query.",
    approvalMode: "always_allow",
  },
  {
    key: "task_update",
    name: "Task Update",
    description: "Update a task's title, description, status, priority, or schedule.",
    approvalMode: "always_allow",
  },
  {
    key: "memory_write",
    name: "Memory Write",
    description: "Save a new memory entry with content, tags, and optional source reference.",
    approvalMode: "always_allow",
  },
  {
    key: "memory_read",
    name: "Memory Read",
    description: "Search memories by query, tags, or source reference.",
    approvalMode: "always_allow",
  },
  {
    key: "note_to_self",
    name: "Note to Self",
    description: "Save a quick note or reminder for later review.",
    approvalMode: "always_allow",
  },
  {
    key: "telegram_send",
    name: "Telegram Send",
    description: "Send a message to a specific Telegram chat.",
    approvalMode: "ask_first",
  },
  {
    key: "shell_command",
    name: "Shell Command",
    description:
      "Execute a shell command on the host machine. Restricted to safe read-only commands by default.",
    approvalMode: "ask_first",
  },
  {
    key: "browser_open",
    name: "Browser Open",
    description: "Open a URL in the default browser and capture the page title.",
    approvalMode: "always_allow",
  },
  {
    key: "calendar_create",
    name: "Calendar Create",
    description: "Create a calendar event with title, date, time, and location.",
    approvalMode: "always_allow",
  },
  {
    key: "email_draft",
    name: "Email Draft",
    description: "Draft an email with subject, body, recipients, and attachments.",
    approvalMode: "always_allow",
  },
  {
    key: "email_send",
    name: "Email Send",
    description: "Send an email with subject, body, recipients, and optional attachments.",
    approvalMode: "ask_first",
  },
];
