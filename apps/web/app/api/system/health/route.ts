import { NextResponse } from "next/server";
import type { SystemHealthResponse } from "@secretary/core-runtime";

export async function GET() {
  const workerBaseUrl = process.env.WORKER_BASE_URL ?? "http://127.0.0.1:4000";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(`${workerBaseUrl}/runtime/system/health`, {
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      return NextResponse.json({ error: "Worker request failed." }, { status: 502 });
    }

    const data = (await response.json()) as SystemHealthResponse;
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Worker is unavailable." }, { status: 503 });
  } finally {
    clearTimeout(timeout);
  }
}
