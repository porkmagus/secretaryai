import { NextResponse } from "next/server";
import type {
  InferenceSettingsResponse,
  UpdateInferenceSettingsRequest,
} from "@secretary/core-runtime";

export async function GET() {
  const workerBaseUrl = process.env.WORKER_BASE_URL ?? "http://127.0.0.1:4000";

  try {
    const response = await fetch(`${workerBaseUrl}/runtime/inference`, {
      cache: "no-store",
    });
    const payload = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: payload.error ?? "Worker request failed." },
        { status: response.status },
      );
    }

    return NextResponse.json(payload as InferenceSettingsResponse);
  } catch {
    return NextResponse.json({ error: "Worker is unavailable." }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const workerBaseUrl = process.env.WORKER_BASE_URL ?? "http://127.0.0.1:4000";
  const body = (await request.json()) as UpdateInferenceSettingsRequest;

  try {
    const response = await fetch(`${workerBaseUrl}/runtime/inference`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const payload = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: payload.error ?? "Worker request failed." },
        { status: response.status },
      );
    }

    return NextResponse.json(payload as InferenceSettingsResponse);
  } catch {
    return NextResponse.json({ error: "Worker is unavailable." }, { status: 503 });
  }
}
