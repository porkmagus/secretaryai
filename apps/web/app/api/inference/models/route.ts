import { NextResponse } from "next/server";
import type { InferenceModelListResponse } from "@secretary/core-runtime";

export async function GET(request: Request) {
  const workerBaseUrl = process.env.WORKER_BASE_URL ?? "http://127.0.0.1:4000";
  const { searchParams } = new URL(request.url);
  const providerId = searchParams.get("providerId");
  const upstreamUrl = providerId
    ? `${workerBaseUrl}/runtime/inference/models?providerId=${encodeURIComponent(providerId)}`
    : `${workerBaseUrl}/runtime/inference/models`;

  try {
    const response = await fetch(upstreamUrl, {
      cache: "no-store",
    });
    const payload = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: payload.error ?? "Worker request failed." },
        { status: response.status },
      );
    }

    return NextResponse.json(payload as InferenceModelListResponse);
  } catch {
    return NextResponse.json({ error: "Worker is unavailable." }, { status: 503 });
  }
}
