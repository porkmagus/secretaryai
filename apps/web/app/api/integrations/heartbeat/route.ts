import { NextResponse } from "next/server";
import type {
  HeartbeatIntegrationStatusResponse,
  UpdateHeartbeatIntegrationRequest,
} from "@secretary/core-runtime";

const workerBaseUrl = process.env.WORKER_BASE_URL ?? "http://127.0.0.1:4000";

export async function GET() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(`${workerBaseUrl}/runtime/integrations/heartbeat`, {
      cache: "no-store",
      signal: controller.signal,
    });
    const payload = await response.json();

    if (!response.ok) {
      return NextResponse.json(payload, { status: response.status });
    }

    return NextResponse.json(payload satisfies HeartbeatIntegrationStatusResponse);
  } catch {
    return NextResponse.json({ error: "Worker is unavailable." }, { status: 503 });
  } finally {
    clearTimeout(timeout);
  }
}

export async function PATCH(request: Request) {
  const body = (await request.json()) as UpdateHeartbeatIntegrationRequest;

  try {
    const response = await fetch(`${workerBaseUrl}/runtime/integrations/heartbeat`, {
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

    return NextResponse.json(payload satisfies HeartbeatIntegrationStatusResponse);
  } catch {
    return NextResponse.json({ error: "Worker is unavailable." }, { status: 503 });
  }
}
