import { NextResponse } from "next/server";
import type { PersonaSettingsResponse } from "@secretary/core-runtime";

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

  const workerUrl = new URL(`${workerBaseUrl}/runtime/persona/avatar/file`);
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

export async function POST(request: Request) {
  const workerBaseUrl = process.env.WORKER_BASE_URL ?? "http://127.0.0.1:4000";

  try {
    const incoming = await request.formData();
    const file = incoming.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Portrait image file is required." },
        { status: 400 },
      );
    }

    const form = new FormData();
    form.set("file", file, file.name);

    const response = await fetch(`${workerBaseUrl}/runtime/persona/avatar`, {
      method: "POST",
      body: form,
      cache: "no-store",
    });
    const payload = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: payload.error ?? "Worker request failed." },
        { status: response.status },
      );
    }

    return NextResponse.json(payload as PersonaSettingsResponse);
  } catch {
    return NextResponse.json(
      { error: "Worker is unavailable." },
      { status: 503 },
    );
  }
}
