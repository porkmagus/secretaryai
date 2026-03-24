import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

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
  const pythonCommand =
    process.env.PYTHON ??
    (process.platform === "win32" ? "py" : "python");
  const pythonArgs =
    process.platform === "win32" && !process.env.PYTHON ? ["-3.11"] : [];

  if (!existsSync(resolveVenvPython())) {
    console.log(`Creating TTS virtual environment at ${venvDir}`);
    await run(pythonCommand, [...pythonArgs, "-m", "venv", venvDir]);
  } else {
    console.log(`Using existing TTS virtual environment at ${venvDir}`);
  }

  const venvPython = resolveVenvPython();
  await run(venvPython, ["-m", "pip", "install", "--upgrade", "pip"]);
  await run(venvPython, ["-m", "pip", "install", "-r", requirementsPath]);

  console.log("TTS service dependencies are ready.");
  console.log("Run the local service with: npm run dev:tts");
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
