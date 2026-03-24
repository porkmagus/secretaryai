import { NextResponse } from "next/server";
import type { ActivityTraceResponse } from "@secretary/core-runtime";

export async function GET(
  _: Request,
  context: { params: Promise<{ conversationId: string }> },
) {
  const workerBaseUrl = process.env.WORKER_BASE_URL ?? "http://127.0.0.1:4000";
  const { conversationId } = await context.params;

  try {
    const response = await fetch(
      `${workerBaseUrl}/runtime/activity/${conversationId}`,
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

    const data = (await response.json()) as ActivityTraceResponse;
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: "Worker is unavailable." },
      { status: 503 },
    );
  }
}
