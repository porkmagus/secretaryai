import type { SpeechArtifactListResponse } from "@secretary/core-runtime";
import { proxyWorkerJson } from "../../_lib/worker-proxy";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const conversationId = url.searchParams.get("conversationId");

  return proxyWorkerJson<SpeechArtifactListResponse>("/runtime/speech/artifacts", {
    query: {
      conversationId,
    },
  });
}
