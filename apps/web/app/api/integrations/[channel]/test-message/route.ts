import { NextResponse } from "next/server";

const workerBaseUrl = process.env.WORKER_BASE_URL ?? "http://127.0.0.1:4000";
const supportedChannels = new Set(["discord", "slack", "email", "sms"]);

function resolveChannel(channel: string) {
  if (!supportedChannels.has(channel)) {
    return null;
  }

  return channel;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ channel: string }> },
) {
  const params = await context.params;
  const channel = resolveChannel(params.channel);

  if (!channel) {
    return NextResponse.json({ error: "Unknown channel." }, { status: 404 });
  }

  const body = await request.json();

  try {
    const response = await fetch(
      `${workerBaseUrl}/runtime/integrations/${channel}/test-message`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        cache: "no-store",
      },
    );
    const payload = await response.json();

    if (!response.ok) {
      return NextResponse.json(payload, { status: response.status });
    }

    return NextResponse.json(payload);
  } catch {
    return NextResponse.json(
      { error: "Worker is unavailable." },
      { status: 503 },
    );
  }
}
