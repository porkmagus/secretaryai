import type {
  TelegramIntegrationStatusResponse,
  UpdateTelegramIntegrationRequest,
} from "@secretary/core-runtime";
import { proxyWorkerJson } from "../../_lib/worker-proxy";

export async function GET() {
  return proxyWorkerJson<TelegramIntegrationStatusResponse>("/runtime/integrations/telegram");
}

export async function PATCH(request: Request) {
  const body = (await request.json()) as UpdateTelegramIntegrationRequest;

  return proxyWorkerJson<TelegramIntegrationStatusResponse>("/runtime/integrations/telegram", {
    method: "PATCH",
    body,
  });
}
