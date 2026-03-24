import { NextResponse } from "next/server";
import type { ConversationListResponse } from "@secretary/core-runtime";

export async function GET() {
  const workerBaseUrl = process.env.WORKER_BASE_URL ?? "http://127.0.0.1:4000";

  try {
    const response = await fetch(`${workerBaseUrl}/runtime/conversations`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Worker request failed." },
        { status: 502 },
      );
    }

    const data = (await response.json()) as ConversationListResponse;
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: "Worker is unavailable." },
      { status: 503 },
    );
  }
}
