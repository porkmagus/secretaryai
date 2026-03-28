import type { ConversationListResponse } from "@secretary/core-runtime";
import { proxyWorkerJson } from "../_lib/worker-proxy";

export async function GET() {
  return proxyWorkerJson<ConversationListResponse>("/runtime/conversations");
}
