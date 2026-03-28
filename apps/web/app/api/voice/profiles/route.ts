import type {
  CreateVoiceProfileRequest,
  VoiceProfileListResponse,
} from "@secretary/core-runtime";
import { proxyWorkerJson } from "../../_lib/worker-proxy";

export async function GET() {
  return proxyWorkerJson<VoiceProfileListResponse>("/runtime/voice/profiles");
}

export async function POST(request: Request) {
  const body = (await request.json()) as CreateVoiceProfileRequest;

  return proxyWorkerJson("/runtime/voice/profiles", {
    method: "POST",
    body,
  });
}
