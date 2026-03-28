import type { TaskListResponse } from "@secretary/core-runtime";
import { proxyWorkerJson } from "../_lib/worker-proxy";

export async function GET() {
  return proxyWorkerJson<TaskListResponse>("/runtime/tasks");
}
