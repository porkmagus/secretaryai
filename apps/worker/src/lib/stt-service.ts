import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { AppConfig } from "@secretary/config";

type SttResult = {
  text: string;
  durationMs?: number | null;
};

export async function transcribeAudioFile(params: {
  config: AppConfig;
  filePath: string;
  mimeType: string | null;
}) {
  if (!params.config.speech.sttBaseUrl) {
    return null;
  }

  const buffer = await readFile(params.filePath);
  const form = new FormData();
  form.set(
    "file",
    new Blob([buffer], {
      type: params.mimeType ?? "application/octet-stream",
    }),
    basename(params.filePath),
  );

  const response = await fetch(
    `${params.config.speech.sttBaseUrl.replace(/\/+$/g, "")}/transcribe`,
    {
      method: "POST",
      body: form,
    },
  );

  const payload = (await response.json()) as Partial<SttResult> & {
    error?: string;
  };

  if (!response.ok) {
    throw new Error(payload.error ?? `STT transcription failed with ${response.status}.`);
  }

  if (typeof payload.text !== "string" || payload.text.trim().length === 0) {
    throw new Error("STT transcription returned no text.");
  }

  return {
    text: payload.text.trim(),
    durationMs:
      typeof payload.durationMs === "number" && Number.isFinite(payload.durationMs)
        ? payload.durationMs
        : null,
  } satisfies SttResult;
}
