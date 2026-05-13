import type { UpdateToolRequest } from "@secretary/core-runtime";
import { proxyWorkerJson } from "../../_lib/worker-proxy";

export async function PATCH(request: Request, context: { params: Promise<{ toolId: string }> }) {
  const body = (await request.json()) as UpdateToolRequest;
  const { toolId } = await context.params;

  return proxyWorkerJson(`/runtime/tools/${toolId}`, {
    method: "PATCH",
    body,
  });
}
