import { NextResponse } from "next/server";
import type { VoicePreviewRequest } from "@secretary/core-runtime";

export async function POST(request: Request) {
  const workerBaseUrl = process.env.WORKER_BASE_URL ?? "http://127.0.0.1:4000";
  const body = (await request.json()) as VoicePreviewRequest;

  try {
    const response = await fetch(`${workerBaseUrl}/runtime/voice/preview`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: "Worker request failed." }));
      return NextResponse.json(
        { error: payload.error ?? "Worker request failed." },
        { status: response.status },
      );
    }

    return new NextResponse(await response.arrayBuffer(), {
      status: 200,
      headers: {
        "Content-Type": response.headers.get("content-type") ?? "audio/wav",
        "X-Secretary-Artifact-Id":
          response.headers.get("x-secretary-artifact-id") ?? "",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Worker is unavailable." },
      { status: 503 },
    );
  }
}
