import { NextResponse } from "next/server";
import type { AgentJobActionResponse, AgentJobRequirementDecisionRequest } from "@secretary/core-runtime";

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string; requirementId: string }> },
) {
  const workerBaseUrl = process.env.WORKER_BASE_URL ?? "http://127.0.0.1:4000";
  const { jobId, requirementId } = await context.params;
  const body = (await request.json()) as AgentJobRequirementDecisionRequest;

  try {
    const response = await fetch(`${workerBaseUrl}/runtime/agent-jobs/${jobId}/requirements/${requirementId}/decision`, {
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

    return NextResponse.json(payload satisfies AgentJobActionResponse);
  } catch {
    return NextResponse.json({ error: "Worker is unavailable." }, { status: 503 });
  }
}
