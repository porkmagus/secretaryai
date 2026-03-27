import { NextResponse } from "next/server";
import type { AgentJobDetailResponse } from "@secretary/core-runtime";

export async function GET(
  _: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const workerBaseUrl = process.env.WORKER_BASE_URL ?? "http://127.0.0.1:4000";
  const { jobId } = await context.params;

  try {
    const response = await fetch(`${workerBaseUrl}/runtime/agent-jobs/${jobId}`, {
      cache: "no-store",
    });
    const payload = await response.json();

    if (!response.ok) {
      return NextResponse.json(payload, { status: response.status });
    }

    return NextResponse.json(payload satisfies AgentJobDetailResponse);
  } catch {
    return NextResponse.json({ error: "Worker is unavailable." }, { status: 503 });
  }
}
