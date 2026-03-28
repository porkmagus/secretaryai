import type {
  AgentJobSettingsResponse,
  UpdateAgentJobSettingsRequest,
} from "@secretary/core-runtime";
import { proxyWorkerJson } from "../_lib/worker-proxy";

export async function GET() {
  return proxyWorkerJson<AgentJobSettingsResponse>("/runtime/agent-job-settings");
}

export async function PATCH(request: Request) {
  const body = (await request.json()) as UpdateAgentJobSettingsRequest;

  return proxyWorkerJson<AgentJobSettingsResponse>("/runtime/agent-job-settings", {
    method: "PATCH",
    body,
  });
}
