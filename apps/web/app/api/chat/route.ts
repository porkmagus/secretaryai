import type { RuntimeChatStreamRequest } from "@secretary/core-runtime";
import { NextResponse } from "next/server";

type IncomingBody = {
  conversationId?: string;
  messageId?: string;
  text?: string;
};

export async function POST(request: Request) {
  const body = (await request.json()) as IncomingBody;
  const text = body.text?.trim();

  if (!text) {
    return NextResponse.json({ error: "Message text is required." }, { status: 400 });
  }

  const workerBaseUrl = process.env.WORKER_BASE_URL ?? "http://127.0.0.1:4000";
  const payload: RuntimeChatStreamRequest = {
    conversationId: body.conversationId,
    messageId: body.messageId,
    text,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const response = await fetch(`${workerBaseUrl}/runtime/chat/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorPayload = (await response.json().catch(() => null)) as { error?: string } | null;

      return NextResponse.json(
        { error: errorPayload?.error ?? "Worker request failed." },
        { status: response.status === 400 ? 400 : 502 },
      );
    }

    return new Response(response.body, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": response.headers.get("Content-Type") ?? "text/event-stream",
      },
      status: response.status,
      statusText: response.statusText,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return NextResponse.json({ error: "Worker request timed out." }, { status: 504 });
    }
    console.error("[chat] Worker stream request failed:", err);
    return NextResponse.json({ error: "Worker is unavailable." }, { status: 503 });
  } finally {
    clearTimeout(timeout);
  }
}
