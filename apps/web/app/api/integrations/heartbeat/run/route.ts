import { NextResponse } from "next/server";
import type { HeartbeatRunResponse } from "@secretary/core-runtime";

const workerBaseUrl = process.env.WORKER_BASE_URL ?? "http://127.0.0.1:4000";

export async function POST() {
  try {
    const response = await fetch(`${workerBaseUrl}/runtime/integrations/heartbeat/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: "{}",
      cache: "no-store",
    });
    const payload = await response.json();

    if (!response.ok) {
      return NextResponse.json(payload, { status: response.status });
    }

    return NextResponse.json(payload satisfies HeartbeatRunResponse);
  } catch {
    return NextResponse.json({ error: "Worker is unavailable." }, { status: 503 });
  }
}
