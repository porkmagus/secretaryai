import { NextResponse } from "next/server";
import type { UpdateMemoryRequest } from "@secretary/core-runtime";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ memoryId: string }> },
) {
  const workerBaseUrl = process.env.WORKER_BASE_URL ?? "http://127.0.0.1:4000";
  const body = (await request.json()) as UpdateMemoryRequest;
  const { memoryId } = await context.params;

  try {
    const response = await fetch(`${workerBaseUrl}/runtime/memories/${memoryId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const payload = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        payload,
        { status: response.status },
      );
    }

    return NextResponse.json(payload);
  } catch {
    return NextResponse.json(
      { error: "Worker is unavailable." },
      { status: 503 },
    );
  }
}
