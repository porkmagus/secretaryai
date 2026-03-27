import { NextResponse } from "next/server";
import type { AgentJobSettingsResponse, UpdateAgentJobSettingsRequest } from "@secretary/core-runtime";

const workerBaseUrl = process.env.WORKER_BASE_URL ?? "http://127.0.0.1:4000";

export async function GET() {
  try {
    const response = await fetch(`${workerBaseUrl}/runtime/agent-job-settings`, {
      cache: "no-store",
    });
    const payload = await response.json();

    if (!response.ok) {
      return NextResponse.json(payload, { status: response.status });
    }

    return NextResponse.json(payload satisfies AgentJobSettingsResponse);
  } catch {
    return NextResponse.json({ error: "Worker is unavailable." }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const body = (await request.json()) as UpdateAgentJobSettingsRequest;

  try {
    const response = await fetch(`${workerBaseUrl}/runtime/agent-job-settings`, {
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

    return NextResponse.json(payload satisfies AgentJobSettingsResponse);
  } catch {
    return NextResponse.json({ error: "Worker is unavailable." }, { status: 503 });
  }
}
