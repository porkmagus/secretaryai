import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, "../..");
const venvDir = resolve(root, "runtime/venvs/tts");
const appDir = resolve(root, "services/tts-chatterbox");

const pythonPath =
  process.platform === "win32"
    ? join(venvDir, "Scripts/python.exe")
    : join(venvDir, "bin/python");

if (!existsSync(pythonPath)) {
  console.error("TTS virtual environment is missing. Run `npm run tts:setup` first.");
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
