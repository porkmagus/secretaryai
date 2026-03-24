import { NextResponse } from "next/server";
import type { UpdateVoiceProfileRequest } from "@secretary/core-runtime";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ profileId: string }> },
) {
  const workerBaseUrl = process.env.WORKER_BASE_URL ?? "http://127.0.0.1:4000";
  const { profileId } = await context.params;
  const body = (await request.json()) as UpdateVoiceProfileRequest;

  try {
    const response = await fetch(`${workerBaseUrl}/runtime/voice/profiles/${profileId}`, {
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
        { error: payload.error ?? "Worker request failed." },
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
