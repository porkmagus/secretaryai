import { NextRequest, NextResponse } from "next/server";

function getWorkerBaseUrl() {
  return process.env.WORKER_BASE_URL ?? "http://127.0.0.1:4000";
}

export async function GET(request: NextRequest) {
  const storageKey = request.nextUrl.searchParams.get("storageKey");
  const mimeType = request.nextUrl.searchParams.get("mimeType");

  if (!storageKey) {
    return NextResponse.json(
      {
        error: "storageKey is required.",
      },
      { status: 400 },
    );
  }

  const workerBaseUrl = getWorkerBaseUrl();
  const response = await fetch(
    `${workerBaseUrl}/runtime/agent-jobs/artifacts/file?storageKey=${encodeURIComponent(storageKey)}${
      mimeType ? `&mimeType=${encodeURIComponent(mimeType)}` : ""
    }`,
    {
      cache: "no-store",
    },
  );

  if (!response.ok) {
    const payload = await response.text();
    return NextResponse.json(
      {
        error: payload || "Unable to load agent job artifact.",
      },
      { status: response.status },
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  return new NextResponse(arrayBuffer, {
    status: 200,
    headers: {
      "Content-Type": response.headers.get("content-type") ?? "application/octet-stream",
    },
  });
}
