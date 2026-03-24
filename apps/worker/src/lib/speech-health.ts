import { spawn } from "node:child_process";
import type { AppConfig } from "@secretary/config";
import type { SpeechServiceStatusResponse } from "@secretary/core-runtime";

function resolveFfmpegCommand() {
  return process.env.FFMPEG_PATH?.trim() || "ffmpeg";
}

function runCommand(command: string, args: string[]) {
  return new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      stdio: "ignore",
      shell: false,
    });

    child.on("error", rejectPromise);
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      rejectPromise(new Error(`${command} exited with ${code}`));
    });
  });
}

async function probeHttpReady(url: string | null) {
  if (!url) {
    return {
      configured: false,
      healthStatus: "not_configured" as const,
      summary: "Not configured.",
      url: null,
    };
  }

  const readyUrl = `${url.replace(/\/+$/g, "")}/health/ready`;

  try {
    const response = await fetch(readyUrl, {
      cache: "no-store",
    });

    if (response.ok) {
      return {
        configured: true,
        healthStatus: "ok" as const,
        summary: "Ready.",
        url,
      };
    }

    return {
      configured: true,
      healthStatus: "degraded" as const,
      summary: `Returned ${response.status}.`,
      url,
    };
  } catch (error) {
    return {
      configured: true,
      healthStatus: "degraded" as const,
      summary: error instanceof Error ? error.message : "Unreachable.",
      url,
    };
  }
}

export async function getSpeechServiceStatus(
  config: AppConfig,
): Promise<SpeechServiceStatusResponse> {
  const [stt, tts, ffmpeg] = await Promise.all([
    probeHttpReady(config.speech.sttBaseUrl),
    probeHttpReady(config.speech.ttsBaseUrl),
    runCommand(resolveFfmpegCommand(), ["-version"])
      .then(() => ({
        available: true,
        configuredPath: process.env.FFMPEG_PATH?.trim() || null,
        summary: "Ready.",
      }))
      .catch((error) => ({
        available: false,
        configuredPath: process.env.FFMPEG_PATH?.trim() || null,
        summary: error instanceof Error ? error.message : "Unavailable.",
      })),
  ]);

  return {
    services: {
      ffmpeg,
      stt,
      tts,
    },
  };
}
