import type { AgentJobApprovalMode, AgentJobSettingsRecord } from "@secretary/core-runtime";
import type { ModelMessage, ToolApprovalResponse } from "ai";
import type { InferenceRuntimeConfig } from "../ai-sdk-registry.js";
import {
  guessVerificationCommands,
  makeDraftingPrompt,
  makeImplementationPrompt,
  makeVerificationPrompt,
} from "./requirements.js";
import {
  collectApprovalRequests,
  collectCommandLogs,
  createBuildAgent,
  serializeStepSnapshots,
} from "./tools.js";
import type {
  AgentRunOutcome,
  AgentStepSnapshot,
  AgentToolName,
  JobRequestShape,
  SerializedAgentMessage,
} from "./utils.js";

export async function runAgentLoop(params: {
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

    const baseMessages = params.messages ?? [
      { role: "user", content: params.prompt ?? "" } satisfies ModelMessage,
    ];
    const nextMessages = [...baseMessages, ...result.response.messages] as SerializedAgentMessage[];
    const approvalRequests = collectApprovalRequests(
      result.content as Array<{ type: string; [key: string]: unknown }>,
    );
    const serializedSteps =
      stepSnapshots.length > 0
        ? stepSnapshots
        : serializeStepSnapshots(
            result.steps.map((step) => ({
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
            })),
          );

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
    activeTools: params.activeTools ?? [
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
