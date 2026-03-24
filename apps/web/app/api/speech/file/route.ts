import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const workerBaseUrl = process.env.WORKER_BASE_URL ?? "http://127.0.0.1:4000";
  const url = new URL(request.url);
  const storageKey = url.searchParams.get("storageKey");
  const mimeType = url.searchParams.get("mimeType");

  if (!storageKey) {
    return NextResponse.json(
      { error: "storageKey is required." },
      { status: 400 },
    );
  }

  const workerUrl = new URL(`${workerBaseUrl}/runtime/speech/file`);
  workerUrl.searchParams.set("storageKey", storageKey);

  if (mimeType) {
    workerUrl.searchParams.set("mimeType", mimeType);
  }

  try {
    const response = await fetch(workerUrl, {
      cache: "no-store",
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: "Worker request failed." }));
      return NextResponse.json(
        { error: payload.error ?? "Worker request failed." },
        { status: response.status },
      );
    }

    return new NextResponse(await response.arrayBuffer(), {
      status: 200,
      headers: {
        "Content-Type": response.headers.get("content-type") ?? "application/octet-stream",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Worker is unavailable." },
      { status: 503 },
    );
  }
}
