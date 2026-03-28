import { proxyWorkerJson } from "../../../_lib/worker-proxy";

export async function POST() {
  return proxyWorkerJson("/runtime/integrations/reminders/deliver", {
    method: "POST",
    unavailableMessage: "Unable to dispatch due reminders.",
  });
}
