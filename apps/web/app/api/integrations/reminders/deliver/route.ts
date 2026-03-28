import { NextResponse } from "next/server";

export async function POST() {
  const workerBaseUrl = process.env.WORKER_BASE_URL ?? "http://127.0.0.1:4000";

  try {
    const response = await fetch(`${workerBaseUrl}/runtime/integrations/reminders/deliver`, {
      method: "POST",
      cache: "no-store",
    });
    const payload = await response.json();

    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to dispatch due reminders.",
      },
      { status: 500 },
    );
  }
}
