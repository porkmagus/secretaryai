import type { ConversationHistoryResponse } from "@secretary/core-runtime";
import { proxyWorkerJson } from "../../_lib/worker-proxy";

type RouteContext = {
  params: Promise<{
    conversationId: string;
  }>;
};

export async function GET(_: Request, context: RouteContext) {
  const { conversationId } = await context.params;

  return proxyWorkerJson<ConversationHistoryResponse>(`/runtime/conversations/${conversationId}`);
}
