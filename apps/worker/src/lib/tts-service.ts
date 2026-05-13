import { readFile } from "node:fs/promises";
import type { AppConfig } from "@secretary/config";
import { resolveSpeechStoragePath } from "./speech-storage.js";

export async function synthesizeSpeech(params: {
  config: AppConfig;
  text: string;
  engineId?: string | null;
  language?: string | null;
  speakerSampleStorageKey?: string | null;
}) {
  if (!params.config.speech.ttsBaseUrl) {
    return null;
  }

  const form = new FormData();
  form.set("text", params.text);

  if (params.engineId) {
    form.set("engineId", params.engineId);
  }

  if (params.language) {
    form.set("language", params.language);
  }

  if (params.speakerSampleStorageKey) {
    const samplePath = resolveSpeechStoragePath(params.speakerSampleStorageKey);
    const sampleBuffer = await readFile(samplePath);
    form.set("speakerWav", new Blob([sampleBuffer], { type: "audio/wav" }), "speaker.wav");
  }

  const response = await fetch(
    `${params.config.speech.ttsBaseUrl.replace(/\/+$/g, "")}/synthesize`,
    {
      method: "POST",
      body: form,
    },
  );

  if (!response.ok) {
    let errorText = `TTS synthesis failed with ${response.status}.`;

    try {
      const payload = (await response.json()) as { detail?: string };
      errorText = payload.detail ?? errorText;
    } catch {
      // Ignore non-JSON response bodies.
    }

    throw new Error(errorText);
  }

  const durationHeader = response.headers.get("x-secretary-duration-ms");
  const durationMs =
    durationHeader && durationHeader.trim().length > 0 ? Number(durationHeader) : null;

  return {
    audio: Buffer.from(await response.arrayBuffer()),
    durationMs: Number.isFinite(durationMs) ? durationMs : null,
    modelName: response.headers.get("x-secretary-tts-model"),
    mimeType: response.headers.get("content-type") ?? "audio/wav",
  };
}
