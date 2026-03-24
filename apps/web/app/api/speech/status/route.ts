import { NextResponse } from "next/server";
import type { SpeechServiceStatusResponse } from "@secretary/core-runtime";

export async function GET() {
  const workerBaseUrl = process.env.WORKER_BASE_URL ?? "http://127.0.0.1:4000";

  try {
    const response = await fetch(`${workerBaseUrl}/runtime/speech/status`, {
      cache: "no-store",
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: "Worker request failed." }));
      return NextResponse.json(
        { error: payload.error ?? "Worker request failed." },
        { status: response.status },
      );
    }

    const data = (await response.json()) as SpeechServiceStatusResponse;
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: "Worker is unavailable." },
      { status: 503 },
    );
  }
}
