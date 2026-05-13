import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, "../..");
const venvDir = resolve(root, "runtime/venvs/tts");
const requirementsPath = resolve(root, "services/tts-chatterbox/requirements.txt");

function resolveVenvPython() {
  return process.platform === "win32"
    ? join(venvDir, "Scripts/python.exe")
    : join(venvDir, "bin/python");
}

function run(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: "inherit",
      shell: false,
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise(undefined);
        return;
      }

      rejectPromise(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

async function main() {
  const pythonCommand = process.env.PYTHON ?? (process.platform === "win32" ? "py" : "python");
  // Use -3.13 on Windows, or let PYTHON env var override
  const pythonArgs = process.platform === "win32" && !process.env.PYTHON ? ["-3.13"] : [];

  if (!existsSync(resolveVenvPython())) {
    await run(pythonCommand, [...pythonArgs, "-m", "venv", venvDir]);
  } else {
  }

  const venvPython = resolveVenvPython();
  await run(venvPython, ["-m", "pip", "install", "--upgrade", "pip"]);
  await run(venvPython, ["-m", "pip", "install", "-r", requirementsPath]);
}

void main().catch((_error) => {
  process.exit(1);
});
