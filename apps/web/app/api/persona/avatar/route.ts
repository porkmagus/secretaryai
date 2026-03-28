import { NextResponse } from "next/server";
import type { PersonaSettingsResponse } from "@secretary/core-runtime";
import {
  proxyWorkerBinary,
  proxyWorkerFormDataJson,
} from "../../_lib/worker-proxy";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const storageKey = url.searchParams.get("storageKey");
  const mimeType = url.searchParams.get("mimeType");

  if (!storageKey) {
    return NextResponse.json(
      { error: "storageKey is required." },
      { status: 400 },
    );
  }

  return proxyWorkerBinary("/runtime/persona/avatar/file", {
    query: {
      storageKey,
      mimeType,
    },
    mimeType: mimeType ?? undefined,
  });
}

export async function POST(request: Request) {
  return proxyWorkerFormDataJson<PersonaSettingsResponse>(
    request,
    "/runtime/persona/avatar",
    {
      fileRequiredMessage: "Portrait image file is required.",
    },
  );
}
