import { NextResponse } from "next/server";
import type {
  TelegramIntegrationStatusResponse,
  UpdateTelegramIntegrationRequest,
} from "@secretary/core-runtime";

const workerBaseUrl = process.env.WORKER_BASE_URL ?? "http://127.0.0.1:4000";

export async function GET() {
  try {
    const response = await fetch(`${workerBaseUrl}/runtime/integrations/telegram`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Worker request failed." },
        { status: 502 },
      );
    }

    const data = (await response.json()) as TelegramIntegrationStatusResponse;
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: "Worker is unavailable." },
      { status: 503 },
    );
  }
}

export async function PATCH(request: Request) {
  const body = (await request.json()) as UpdateTelegramIntegrationRequest;

  try {
    const response = await fetch(`${workerBaseUrl}/runtime/integrations/telegram`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const payload = await response.json();

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
