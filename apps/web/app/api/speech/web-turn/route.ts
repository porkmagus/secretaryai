import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const workerBaseUrl = process.env.WORKER_BASE_URL ?? "http://127.0.0.1:4000";

  try {
    const incoming = await request.formData();
    const audio = incoming.get("audio");

    if (!(audio instanceof File)) {
      return NextResponse.json(
        { error: "Audio recording is required." },
        { status: 400 },
      );
    }

    const form = new FormData();
    form.set("audio", audio, audio.name || "recording.webm");

    const conversationId = incoming.get("conversationId");
    if (typeof conversationId === "string" && conversationId.trim()) {
      form.set("conversationId", conversationId.trim());
    }

    const response = await fetch(`${workerBaseUrl}/runtime/speech/web-turn`, {
      method: "POST",
      body: form,
      cache: "no-store",
    });
    const payload = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: payload.error ?? "Worker request failed." },
        { status: response.status },
      );
    }

    return NextResponse.json(payload);
  } catch {
    return NextResponse.json(
      { error: "Worker is unavailable." },
      { status: 503 },
    );
  }
}
