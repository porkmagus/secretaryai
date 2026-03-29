/**
 * Structured logging for agent behavior analysis
 */
export function logAgentEvent(event: {
  type: string;
  reason?: string;
  textPreview?: string;
  toolKey?: string;
  durationMs?: number;
  resultCount?: number;
  [key: string]: unknown;
}) {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      service: "worker",
      ...event,
    }),
  );
}

/**
 * Log when fallback response is triggered
 */
export function logFallbackTriggered(reason: string, text: string) {
  logAgentEvent({
    type: "fallback.triggered",
    reason,
    textPreview: text.slice(0, 100),
  });
}

/**
 * Log tool execution metrics
 */
export function logToolExecution(params: {
  toolKey: string;
  durationMs: number;
  success: boolean;
  resultCount?: number;
  error?: string;
}) {
  logAgentEvent({
    type: "tool.execution",
    ...params,
  });
}

/**
 * Log memory retrieval metrics
 */
export function logMemoryRetrieval(params: {
  query: string;
  durationMs: number;
  resultsCount: number;
  topScore?: number;
}) {
  logAgentEvent({
    type: "memory.retrieval",
    ...params,
  });
}
