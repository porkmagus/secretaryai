import { NextResponse } from "next/server";
import type {
  TelegramPresenceUpdateRequest,
  TelegramPresenceUpdateResponse,
} from "@secretary/core-runtime";

const workerBaseUrl = process.env.WORKER_BASE_URL ?? "http://127.0.0.1:4000";

export async function POST(request: Request) {
  const body = (await request.json()) as TelegramPresenceUpdateRequest;

  try {
    const response = await fetch(`${workerBaseUrl}/runtime/integrations/telegram/presence`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const payload = (await response.json()) as TelegramPresenceUpdateResponse | { error?: string };

    if (!response.ok) {
      return NextResponse.json(payload, { status: response.status });
    }

    return NextResponse.json(payload);
  } catch {
    return NextResponse.json(
      { error: "Worker is unavailable." },
      { status: 503 },
    );
  }
}
