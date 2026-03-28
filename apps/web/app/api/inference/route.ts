import type {
  InferenceSettingsResponse,
  UpdateInferenceSettingsRequest,
} from "@secretary/core-runtime";
import { proxyWorkerJson } from "../_lib/worker-proxy";

export async function GET() {
  return proxyWorkerJson<InferenceSettingsResponse>("/runtime/inference");
}

export async function PATCH(request: Request) {
  const body = (await request.json()) as UpdateInferenceSettingsRequest;

  return proxyWorkerJson<InferenceSettingsResponse>("/runtime/inference", {
    method: "PATCH",
    body,
  });
}
