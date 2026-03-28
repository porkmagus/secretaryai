import type { SystemHealthResponse } from "@secretary/core-runtime";
import { proxyWorkerJson } from "../../_lib/worker-proxy";

export async function GET() {
  return proxyWorkerJson<SystemHealthResponse>("/runtime/system/health", {
    timeoutMs: 5000,
  });
}
