import type { SettingsExportResponse } from "@secretary/core-runtime";
import { proxyWorkerJson } from "../../_lib/worker-proxy";

export async function GET() {
  return proxyWorkerJson<SettingsExportResponse>("/runtime/export/settings");
}
