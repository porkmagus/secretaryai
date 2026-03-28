import type {
  AgentJobActionResponse,
  AgentJobRequirementDecisionRequest,
} from "@secretary/core-runtime";
import { proxyWorkerJson } from "../../../../../_lib/worker-proxy";

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string; requirementId: string }> },
) {
  const { jobId, requirementId } = await context.params;
  const body = (await request.json()) as AgentJobRequirementDecisionRequest;

  return proxyWorkerJson<AgentJobActionResponse>(
    `/runtime/agent-jobs/${jobId}/requirements/${requirementId}/decision`,
    {
      method: "POST",
      body,
    },
  );
}
