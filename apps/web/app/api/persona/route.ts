import type {
  PersonaSettingsResponse,
  UpdatePersonaSettingsRequest,
} from "@secretary/core-runtime";
import { NextResponse } from "next/server";

export async function GET() {
  const workerBaseUrl = process.env.WORKER_BASE_URL ?? "http://127.0.0.1:4000";

  try {
    const response = await fetch(`${workerBaseUrl}/runtime/persona`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json({ error: "Worker request failed." }, { status: 502 });
    }

    const data = (await response.json()) as PersonaSettingsResponse;
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Worker is unavailable." }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const workerBaseUrl = process.env.WORKER_BASE_URL ?? "http://127.0.0.1:4000";
  const body = (await request.json()) as UpdatePersonaSettingsRequest;

  try {
    const response = await fetch(`${workerBaseUrl}/runtime/persona`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const payload = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: payload.error ?? "Worker request failed." },
        { status: 502 },
      );
    }

    return NextResponse.json(payload);
  } catch {
    return NextResponse.json({ error: "Worker is unavailable." }, { status: 503 });
  }
}
