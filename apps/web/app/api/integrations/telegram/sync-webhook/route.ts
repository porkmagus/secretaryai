import type { TelegramSyncWebhookResponse } from "@secretary/core-runtime";
import { proxyWorkerJson } from "../../../_lib/worker-proxy";

export async function POST() {
  return proxyWorkerJson<TelegramSyncWebhookResponse>("/runtime/integrations/telegram/sync-webhook", {
    method: "POST",
    body: {},
  });
}
