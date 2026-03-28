import type { UpdateVoiceProfileRequest } from "@secretary/core-runtime";
import { proxyWorkerJson } from "../../../_lib/worker-proxy";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ profileId: string }> },
) {
  const { profileId } = await context.params;
  const body = (await request.json()) as UpdateVoiceProfileRequest;

  return proxyWorkerJson(`/runtime/voice/profiles/${profileId}`, {
    method: "PATCH",
    body,
  });
}
