import { NextResponse } from "next/server";
import type { SpeechArtifactListResponse } from "@secretary/core-runtime";

export async function GET(request: Request) {
  const workerBaseUrl = process.env.WORKER_BASE_URL ?? "http://127.0.0.1:4000";
  const url = new URL(request.url);
  const conversationId = url.searchParams.get("conversationId");
  const workerUrl = new URL(`${workerBaseUrl}/runtime/speech/artifacts`);

  if (conversationId) {
    workerUrl.searchParams.set("conversationId", conversationId);
  }

  try {
    const response = await fetch(workerUrl, {
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Worker request failed." },
        { status: 502 },
      );
    }

    const data = (await response.json()) as SpeechArtifactListResponse;
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: "Worker is unavailable." },
      { status: 503 },
    );
  }
}
