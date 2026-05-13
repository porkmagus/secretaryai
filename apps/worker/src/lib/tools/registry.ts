import type {
  ToolApprovalMode,
  ToolExecutionListResponse,
  ToolExecutionRecord,
  ToolListResponse,
  ToolRecord,
  UpdateToolRequest,
} from "@secretary/core-runtime";
import { createMessageId } from "@secretary/core-runtime";
import type { DbClient } from "@secretary/db";
import { toolExecutions, tools } from "@secretary/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { builtInTools } from "./types.js";

function toToolRecord(record: typeof tools.$inferSelect): ToolRecord {
  return {
    id: record.id,
    key: record.key,
    name: record.name,
    description: record.description,
    enabled: record.enabled,
    approvalMode: record.approvalMode as ToolApprovalMode,
    healthStatus: record.healthStatus,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function toToolExecutionRecord(
  record: typeof toolExecutions.$inferSelect,
  tool: typeof tools.$inferSelect | undefined,
): ToolExecutionRecord {
  return {
    id: record.id,
    toolId: record.toolId,
    toolKey: tool?.key ?? "unknown",
    toolName: tool?.name ?? "Unknown tool",
    conversationId: record.conversationId,
    requestedBy: record.requestedBy,
    executionStatus: record.executionStatus as ToolExecutionRecord["executionStatus"],
    approvalState: record.approvalState as ToolExecutionRecord["approvalState"],
    requestJson: record.requestJson,
    responseJson: record.responseJson ?? null,
    summary: record.summary,
    errorText: record.errorText ?? null,
    startedAt: record.startedAt?.toISOString() ?? null,
    finishedAt: record.finishedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export async function ensureToolRegistry(dbClient: DbClient) {
  if (builtInTools.length === 0) return;

  await dbClient.db
    .insert(tools)
    .values(
      builtInTools.map((tool) => ({
        id: createMessageId(),
        key: tool.key,
        name: tool.name,
        description: tool.description,
        enabled: tool.enabled ?? true,
        approvalMode: tool.approvalMode,
        configSchemaJson: {},
        healthStatus: tool.healthStatus ?? "ok",
      })),
    )
    .onConflictDoUpdate({
      target: tools.key,
      set: {
        description: sql`excluded.description`,
        enabled: sql`case when ${tools.healthStatus} = 'not_configured' then excluded.enabled else ${tools.enabled} end`,
        healthStatus: sql`excluded.health_status`,
        name: sql`excluded.name`,
        approvalMode: sql`case when ${tools.healthStatus} = 'not_configured' then excluded.approval_mode else ${tools.approvalMode} end`,
        updatedAt: new Date(),
      },
    });
}

export async function getToolByKey(dbClient: DbClient, key: string) {
  await ensureToolRegistry(dbClient);
  return dbClient.db.query.tools.findFirst({
    where: eq(tools.key, key),
  });
}

export async function listTools(dbClient: DbClient): Promise<ToolListResponse> {
  await ensureToolRegistry(dbClient);
  const records = await dbClient.db.query.tools.findMany({
    orderBy: asc(tools.name),
  });

  return {
    tools: records.map(toToolRecord),
  };
}

export async function updateTool(dbClient: DbClient, toolId: string, request: UpdateToolRequest) {
  const existing = await dbClient.db.query.tools.findFirst({
    where: eq(tools.id, toolId),
  });

  if (!existing) {
    return null;
  }

  await dbClient.db
    .update(tools)
    .set({
      approvalMode: request.approvalMode ?? existing.approvalMode,
      enabled: request.enabled ?? existing.enabled,
      updatedAt: new Date(),
    })
    .where(eq(tools.id, toolId));

  return dbClient.db.query.tools.findFirst({
    where: eq(tools.id, toolId),
  });
}

export async function listToolExecutions(params: {
  approvalState?: string;
  conversationId?: string;
  dbClient: DbClient;
}): Promise<ToolExecutionListResponse> {
  const records = await params.dbClient.db.query.toolExecutions.findMany({
    where:
      params.conversationId && params.approvalState
        ? and(
            eq(toolExecutions.conversationId, params.conversationId),
            eq(toolExecutions.approvalState, params.approvalState),
          )
        : params.conversationId
          ? eq(toolExecutions.conversationId, params.conversationId)
          : params.approvalState
            ? eq(toolExecutions.approvalState, params.approvalState)
            : undefined,
    orderBy: (fields, { desc }) => [desc(fields.createdAt)],
    limit: 50,
  });
  const toolMap = new Map(
    (await params.dbClient.db.query.tools.findMany()).map((tool) => [tool.id, tool]),
  );

  return {
    executions: records.map((record) => toToolExecutionRecord(record, toolMap.get(record.toolId))),
  };
}
