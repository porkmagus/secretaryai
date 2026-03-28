import type {
  HeartbeatIntegrationStatusResponse,
  UpdateHeartbeatIntegrationRequest,
} from "@secretary/core-runtime";
import { proxyWorkerJson } from "../../_lib/worker-proxy";

export async function GET() {
  return proxyWorkerJson<HeartbeatIntegrationStatusResponse>("/runtime/integrations/heartbeat", {
    timeoutMs: 5000,
  });
}

export async function PATCH(request: Request) {
  const body = (await request.json()) as UpdateHeartbeatIntegrationRequest;

  return proxyWorkerJson<HeartbeatIntegrationStatusResponse>("/runtime/integrations/heartbeat", {
    method: "PATCH",
    body,
  });
}
