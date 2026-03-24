import { NextResponse } from "next/server";

export async function POST(
  request: Request,
  context: { params: Promise<{ profileId: string }> },
) {
  const workerBaseUrl = process.env.WORKER_BASE_URL ?? "http://127.0.0.1:4000";
  const { profileId } = await context.params;

  try {
    const incoming = await request.formData();
    const file = incoming.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Audio sample file is required." },
        { status: 400 },
      );
    }

    const form = new FormData();
    form.set("file", file, file.name);

    const response = await fetch(
      `${workerBaseUrl}/runtime/voice/profiles/${profileId}/sample`,
      {
        method: "POST",
        body: form,
        cache: "no-store",
      },
    );
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
