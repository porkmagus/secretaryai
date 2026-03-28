import type { SpeechServiceStatusResponse } from "@secretary/core-runtime";
import { proxyWorkerJson } from "../../_lib/worker-proxy";

export async function GET() {
  return proxyWorkerJson<SpeechServiceStatusResponse>("/runtime/speech/status");
}
