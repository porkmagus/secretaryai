import { NextResponse } from "next/server";
import type { ConversationHistoryResponse } from "@secretary/core-runtime";

type RouteContext = {
  params: Promise<{
    conversationId: string;
  }>;
};

export async function GET(_: Request, context: RouteContext) {
  const { conversationId } = await context.params;
  const workerBaseUrl = process.env.WORKER_BASE_URL ?? "http://127.0.0.1:4000";

  try {
    const response = await fetch(
      `${workerBaseUrl}/runtime/conversations/${conversationId}`,
      {
        cache: "no-store",
      },
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: "Worker request failed." },
        { status: 502 },
      );
    }

    const data = (await response.json()) as ConversationHistoryResponse;
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: "Worker is unavailable." },
      { status: 503 },
    );
  }
}
