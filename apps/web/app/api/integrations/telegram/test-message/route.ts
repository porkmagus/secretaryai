import type {
  TelegramTestMessageRequest,
  TelegramTestMessageResponse,
} from "@secretary/core-runtime";
import { proxyWorkerJson } from "../../../_lib/worker-proxy";

export async function POST(request: Request) {
  const body = (await request.json()) as TelegramTestMessageRequest;

  return proxyWorkerJson<TelegramTestMessageResponse>("/runtime/integrations/telegram/test-message", {
    method: "POST",
    body,
  });
}
