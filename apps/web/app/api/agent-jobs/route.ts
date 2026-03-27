import { NextResponse } from "next/server";
import type { AgentJobListResponse, CreateAgentJobRequest } from "@secretary/core-runtime";

const workerBaseUrl = process.env.WORKER_BASE_URL ?? "http://127.0.0.1:4000";

export async function GET() {
  try {
    const response = await fetch(`${workerBaseUrl}/runtime/agent-jobs`, {
      cache: "no-store",
    });
    const payload = await response.json();

    if (!response.ok) {
      return NextResponse.json(payload, { status: response.status });
    }

    return NextResponse.json(payload satisfies AgentJobListResponse);
  } catch {
    return NextResponse.json({ error: "Worker is unavailable." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const body = (await request.json()) as CreateAgentJobRequest;

  try {
    const response = await fetch(`${workerBaseUrl}/runtime/agent-jobs`, {
      method: "POST",
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

    return NextResponse.json(payload, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Worker is unavailable." }, { status: 503 });
  }
}
