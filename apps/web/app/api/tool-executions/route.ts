import type { ToolExecutionListResponse } from "@secretary/core-runtime";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const workerBaseUrl = process.env.WORKER_BASE_URL ?? "http://127.0.0.1:4000";
  const url = new URL(request.url);
  const workerUrl = new URL(`${workerBaseUrl}/runtime/tool-executions`);
  const conversationId = url.searchParams.get("conversationId");
  const approvalState = url.searchParams.get("approvalState");

  if (conversationId) {
    workerUrl.searchParams.set("conversationId", conversationId);
  }

  if (approvalState) {
    workerUrl.searchParams.set("approvalState", approvalState);
  }

  try {
    const response = await fetch(workerUrl, {
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json({ error: "Worker request failed." }, { status: 502 });
    }

    const data = (await response.json()) as ToolExecutionListResponse;
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Worker is unavailable." }, { status: 503 });
  }
}
