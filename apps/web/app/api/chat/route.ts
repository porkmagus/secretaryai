import { NextResponse } from "next/server";
import type { RuntimeChatRequest, RuntimeChatResponse } from "@secretary/core-runtime";

type IncomingBody = {
  conversationId?: string;
  text?: string;
};

export async function POST(request: Request) {
  const body = (await request.json()) as IncomingBody;
  const text = body.text?.trim();

  if (!text) {
    return NextResponse.json(
      { error: "Message text is required." },
      { status: 400 },
    );
  }

  const workerBaseUrl =
    process.env.WORKER_BASE_URL ?? "http://127.0.0.1:4000";

  const payload: RuntimeChatRequest = {
    conversationId: body.conversationId,
    channel: "web",
    userId: process.env.DEFAULT_USER_ID ?? "local-owner",
    message: {
      text,
    },
    metadata: {
      requestId: `web_${crypto.randomUUID()}`,
    },
  };

  try {
    const response = await fetch(`${workerBaseUrl}/runtime/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Worker request failed." },
        { status: 502 },
      );
    }

    const data = (await response.json()) as RuntimeChatResponse;
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: "Worker is unavailable." },
      { status: 503 },
    );
  }
}
