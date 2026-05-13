import { NextResponse } from "next/server";
import { proxyWorkerJson } from "../../../_lib/worker-proxy";

const supportedChannels = new Set(["discord", "slack", "email", "sms"]);

function resolveChannel(channel: string) {
  if (!supportedChannels.has(channel)) {
    return null;
  }

  return channel;
}

export async function POST(request: Request, context: { params: Promise<{ channel: string }> }) {
  const params = await context.params;
  const channel = resolveChannel(params.channel);

  if (!channel) {
    return NextResponse.json({ error: "Unknown channel." }, { status: 404 });
  }

  const body = await request.json();

  return proxyWorkerJson(`/runtime/integrations/${channel}/test-message`, {
    method: "POST",
    body,
  });
}
