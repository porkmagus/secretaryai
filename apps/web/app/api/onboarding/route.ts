import type { OnboardingStatusResponse } from "@secretary/core-runtime";
import { proxyWorkerJson } from "../_lib/worker-proxy";

export async function GET() {
  return proxyWorkerJson<OnboardingStatusResponse>("/runtime/onboarding");
}
