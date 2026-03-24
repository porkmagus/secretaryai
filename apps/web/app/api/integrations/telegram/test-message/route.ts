import { NextResponse } from "next/server";
import type {
  TelegramTestMessageRequest,
  TelegramTestMessageResponse,
} from "@secretary/core-runtime";

const workerBaseUrl = process.env.WORKER_BASE_URL ?? "http://127.0.0.1:4000";

export async function POST(request: Request) {
  const body = (await request.json()) as TelegramTestMessageRequest;

  try {
    const response = await fetch(
      `${workerBaseUrl}/runtime/integrations/telegram/test-message`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        cache: "no-store",
      },
    );

    const payload = await response.json();

    if (!response.ok) {
      return NextResponse.json(payload, { status: response.status });
    }

    return NextResponse.json(payload satisfies TelegramTestMessageResponse);
  } catch {
    return NextResponse.json(
      { error: "Worker is unavailable." },
      { status: 503 },
    );
  }
}
