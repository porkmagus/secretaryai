import type { AgentJobListResponse, CreateAgentJobRequest } from "@secretary/core-runtime";
import { proxyWorkerJson } from "../_lib/worker-proxy";

export async function GET() {
  return proxyWorkerJson<AgentJobListResponse>("/runtime/agent-jobs");
}

export async function POST(request: Request) {
  const body = (await request.json()) as CreateAgentJobRequest;

  return proxyWorkerJson("/runtime/agent-jobs", {
    method: "POST",
    body,
    successStatus: 201,
  });
}
