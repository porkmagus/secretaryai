import { NextResponse } from "next/server";
import { proxyWorkerBinary } from "../../_lib/worker-proxy";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const storageKey = url.searchParams.get("storageKey");
  const mimeType = url.searchParams.get("mimeType");

  if (!storageKey) {
    return NextResponse.json({ error: "storageKey is required." }, { status: 400 });
  }

  return proxyWorkerBinary("/runtime/speech/file", {
    query: {
      storageKey,
      mimeType,
    },
    mimeType: mimeType ?? undefined,
  });
}
