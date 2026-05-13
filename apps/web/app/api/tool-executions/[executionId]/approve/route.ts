import type { ToolApprovalDecisionResponse } from "@secretary/core-runtime";
import { NextResponse } from "next/server";

export async function POST(_: Request, context: { params: Promise<{ executionId: string }> }) {
  const workerBaseUrl = process.env.WORKER_BASE_URL ?? "http://127.0.0.1:4000";
  const { executionId } = await context.params;

  try {
    const response = await fetch(
      `${workerBaseUrl}/runtime/tool-executions/${executionId}/approve`,
      {
        method: "POST",
        cache: "no-store",
      },
    );
    const payload = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: payload.error ?? "Worker request failed." },
        { status: response.status },
      );
    }

    return NextResponse.json(payload as ToolApprovalDecisionResponse);
  } catch {
    return NextResponse.json({ error: "Worker is unavailable." }, { status: 503 });
  }
}
