import type { ToolApprovalMode, ToolRecord } from "@secretary/core-runtime";

export type EditableTool = {
  approvalMode: ToolApprovalMode;
  enabled: boolean;
};

export type ExecutionFilter = "all" | "pending" | "completed" | "denied" | "failed";

export function toolGroupLabel(tool: ToolRecord) {
  switch (tool.key) {
    case "web_search":
    case "download_url":
    case "browser_open":
      return "Discovery and browsing";
    case "file_read":
    case "file_write":
    case "document_create":
    case "shell_command":
      return "Workspace and documents";
    case "task_create":
    case "task_list":
    case "task_update":
    case "memory_write":
      return "Memory and planning";
    case "telegram_send":
      return "Channels";
    case "calendar_create":
    case "email_draft":
    case "email_send":
      return "Future adapters";
    default:
      return "Other";
  }
}
