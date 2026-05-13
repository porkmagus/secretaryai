import type { VoicePreviewRequest } from "@secretary/core-runtime";
import { NextResponse } from "next/server";
import { workerUrl } from "../../_lib/worker-proxy";

export async function POST(request: Request) {
  const body = (await request.json()) as VoicePreviewRequest;

  try {
    const response = await fetch(workerUrl("/runtime/voice/preview"), {
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
        "X-Secretary-Artifact-Id": response.headers.get("x-secretary-artifact-id") ?? "",
      },
    });
  } catch {
    return NextResponse.json({ error: "Worker is unavailable." }, { status: 503 });
  }
}
