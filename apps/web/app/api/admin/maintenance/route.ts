import type {
  AdminMaintenanceAction,
  AdminMaintenanceActionResponse,
  AdminMaintenanceOverviewResponse,
} from "@secretary/core-runtime";
import { proxyWorkerJson } from "../../_lib/worker-proxy";

export async function GET() {
  return proxyWorkerJson<AdminMaintenanceOverviewResponse>("/runtime/admin/maintenance");
}

export async function POST(request: Request) {
  const body = (await request.json()) as { action: AdminMaintenanceAction };

  return proxyWorkerJson<AdminMaintenanceActionResponse>("/runtime/admin/maintenance", {
    method: "POST",
    body,
  });
}
