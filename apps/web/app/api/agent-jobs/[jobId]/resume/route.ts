import type { AgentJobActionResponse } from "@secretary/core-runtime";
import { proxyWorkerJson } from "../../../_lib/worker-proxy";

export async function POST(
  _: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await context.params;

  return proxyWorkerJson<AgentJobActionResponse>(`/runtime/agent-jobs/${jobId}/resume`, {
    method: "POST",
  });
}
