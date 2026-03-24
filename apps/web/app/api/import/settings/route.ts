import { NextResponse } from "next/server";
import type { SettingsImportRequest, SettingsImportResponse } from "@secretary/core-runtime";

export async function POST(request: Request) {
  const workerBaseUrl = process.env.WORKER_BASE_URL ?? "http://127.0.0.1:4000";
  const body = (await request.json()) as SettingsImportRequest;

  try {
    const response = await fetch(`${workerBaseUrl}/runtime/import/settings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as SettingsImportResponse & { error?: string };

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
