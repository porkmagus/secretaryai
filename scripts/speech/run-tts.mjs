import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Load .env file manually
function loadEnvFile() {
  const envPath = resolve(root, ".env");
  if (!existsSync(envPath)) return;

  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    // Remove quotes if present
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, "../..");

// Load environment variables from .env
loadEnvFile();

const venvDir = resolve(root, "runtime/venvs/tts");
const appDir = resolve(root, "services/tts-chatterbox");

const pythonPath =
  process.platform === "win32" ? join(venvDir, "Scripts/python.exe") : join(venvDir, "bin/python");

if (!existsSync(pythonPath)) {
  process.exit(1);
}

const port = process.env.TTS_PORT ?? "5002";
const child = spawn(
  pythonPath,
  ["-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", port, "--app-dir", appDir],
  {
    cwd: root,
    stdio: "inherit",
    shell: false,
    env: {
      ...process.env,
      HF_TOKEN: process.env.HF_TOKEN || process.env.HUGGING_FACE_HUB_TOKEN,
    },
  },
);

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
