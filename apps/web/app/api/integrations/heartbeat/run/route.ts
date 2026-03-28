import type { HeartbeatRunResponse } from "@secretary/core-runtime";
import { proxyWorkerJson } from "../../../_lib/worker-proxy";

export async function POST() {
  return proxyWorkerJson<HeartbeatRunResponse>("/runtime/integrations/heartbeat/run", {
    method: "POST",
    body: {},
  });
}
