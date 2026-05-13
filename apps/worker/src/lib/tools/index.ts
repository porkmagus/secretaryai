// Public API for tools module

export {
  buildToolContext,
  createExecution,
  decideToolExecution,
  ensureConversationEnvelope,
  // Public API
  handleToolAwareTurn,
  // Context & persistence
  insertActivityTrace,
  persistAssistantResult,
  recordToolTrace,
} from "./context.js";
export {
  allowedShellCommand,
  executeBrowserOpen,
  executeCalendarCreate,
  executeCrawl4aiDeep,
  // Executors
  executeCrawl4aiLight,
  executeCrawl4aiVariable,
  executeDocumentCreate,
  executeDownloadUrl,
  executeEmailDraft,
  executeEmailSend,
  executeFileRead,
  executeFileWrite,
  executeMemoryWrite,
  executeShellCommand,
  executeTaskCreate,
  executeTaskList,
  executeTaskUpdate,
  executeTelegramSend,
  executeToolRequest,
  executeWebSearch,
} from "./executors.js";
export { detectToolIntent } from "./parsers.js";
export {
  ensureToolRegistry,
  getToolByKey,
  listToolExecutions,
  listTools,
  // Tool registry
  toToolExecutionRecord,
  updateTool,
} from "./registry.js";
export {
  BROWSER_TARGETS_DIR,
  type BuiltInTool,
  // Types & constants
  builtInTools,
  CALENDAR_EXPORTS_DIR,
  DOWNLOADS_DIR,
  EMAIL_DRAFTS_DIR,
  FILE_PREVIEW_LIMIT,
  GENERATED_DOCUMENTS_DIR,
  MAX_DOWNLOAD_BYTES,
  MAX_FILE_READ_BYTES,
  SHELL_TIMEOUT_MS,
  type ToolIntent,
} from "./types.js";

export {
  ensureRuntimeGeneratedPath,
  hasBinaryLikeContent,
  isPathInsideWorkspace,
  isWindowsPlatform,
  resolveRuntimePath,
  resolveWorkspacePath,
  // Utility helpers
  shortSnippet,
} from "./utils.js";
