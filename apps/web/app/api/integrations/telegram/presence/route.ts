import type {
  TelegramPresenceUpdateRequest,
  TelegramPresenceUpdateResponse,
} from "@secretary/core-runtime";
import { proxyWorkerJson } from "../../../_lib/worker-proxy";

export async function PATCH(request: Request) {
  const body = (await request.json()) as TelegramPresenceUpdateRequest;

  return proxyWorkerJson<TelegramPresenceUpdateResponse>(
    "/runtime/integrations/telegram/presence",
    {
      method: "PATCH",
      body,
    },
  );
}
