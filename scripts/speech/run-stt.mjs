import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, "../..");
const venvDir = resolve(root, "runtime/venvs/stt");
const appDir = resolve(root, "services/stt-faster-whisper");

const pythonPath =
  process.platform === "win32"
    ? join(venvDir, "Scripts/python.exe")
    : join(venvDir, "bin/python");

if (!existsSync(pythonPath)) {
  console.error("STT virtual environment is missing. Run `npm run stt:setup` first.");
  process.exit(1);
}

const port = process.env.STT_PORT ?? "5001";
const child = spawn(
  pythonPath,
  ["-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", port, "--app-dir", appDir],
  {
    cwd: root,
    stdio: "inherit",
    shell: false,
    env: {
      ...process.env,
    },
  },
);

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
