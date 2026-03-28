import { proxyWorkerFormDataJson } from "../../../../_lib/worker-proxy";

export async function POST(
  request: Request,
  context: { params: Promise<{ profileId: string }> },
) {
  const { profileId } = await context.params;

  return proxyWorkerFormDataJson(
    request,
    `/runtime/voice/profiles/${profileId}/sample`,
    {
      fileRequiredMessage: "Audio sample file is required.",
    },
  );
}
