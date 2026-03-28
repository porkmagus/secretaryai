import { spawn, spawnSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, "../..");
const runtimeRoot = resolve(root, "runtime");
const configRoot = resolve(runtimeRoot, "config");
const logsRoot = resolve(runtimeRoot, "dev-logs");
const stateFilePath = resolve(configRoot, "dev-orchestrator.json");
const envExamplePath = resolve(root, ".env.example");
const envPath = resolve(root, ".env");
const packageLockPath = resolve(root, "package-lock.json");
const nodeModulesPath = resolve(root, "node_modules");
const workerSourceRoot = resolve(root, "apps/worker/src");
const workerBuildOutputPath = resolve(root, "apps/worker/dist/index.js");
const workerPackagePath = resolve(root, "apps/worker/package.json");
const workerTsconfigPath = resolve(root, "apps/worker/tsconfig.json");
const sttRequirementsPath = resolve(root, "services/stt-faster-whisper/requirements.txt");
const ttsRequirementsPath = resolve(root, "services/tts-chatterbox/requirements.txt");
const sttVenvPythonPath = process.platform === "win32"
  ? resolve(root, "runtime/venvs/stt/Scripts/python.exe")
  : resolve(root, "runtime/venvs/stt/bin/python");
const ttsVenvPythonPath = process.platform === "win32"
  ? resolve(root, "runtime/venvs/tts/Scripts/python.exe")
  : resolve(root, "runtime/venvs/tts/bin/python");

const services = [
  {
    key: "web",
    label: "Secretary Web",
    port: 3000,
    startupTimeoutMs: 45_000,
    windowsCommand: ["cmd.exe", ["/d", "/s", "/c", "npm run dev --workspace @secretary/web"]],
    unixCommand: ["npm", ["run", "dev", "--workspace", "@secretary/web"]],
    healthUrl: "http://127.0.0.1:3000",
  },
  {
    key: "worker",
    label: "Secretary Worker",
    port: 4000,
    startupTimeoutMs: 45_000,
    windowsCommand: ["cmd.exe", ["/d", "/s", "/c", "node --env-file=.env apps/worker/dist/index.js"]],
    unixCommand: ["node", ["--env-file=.env", "apps/worker/dist/index.js"]],
    healthUrl: "http://127.0.0.1:4000/health/ready",
  },
  {
    key: "stt",
    label: "Secretary STT",
    port: 5001,
    startupTimeoutMs: 90_000,
    windowsCommand: ["node", ["scripts/speech/run-stt.mjs"]],
    unixCommand: ["node", ["scripts/speech/run-stt.mjs"]],
    healthUrl: "http://127.0.0.1:5001/health",
  },
  {
    key: "tts",
    label: "Secretary TTS",
    port: 5002,
    startupTimeoutMs: 120_000,
    windowsCommand: ["node", ["scripts/speech/run-tts.mjs"]],
    unixCommand: ["node", ["scripts/speech/run-tts.mjs"]],
    healthUrl: "http://127.0.0.1:5002/health",
  },
];

const infrastructureContainers = [
  "secretary-postgres",
  "secretary-redis",
  "secretary-searxng",
];
const infrastructureNetwork = "compose_default";
const infrastructureServices = [
  { label: "Postgres", port: 5432, startupTimeoutMs: 45_000 },
  { label: "Redis", port: 6379, startupTimeoutMs: 30_000 },
  { label: "SearXNG", port: 8080, startupTimeoutMs: 45_000 },
];

function parseArgs(argv) {
  const args = argv.slice(2);
  const command = args.find((value) => !value.startsWith("-")) ?? "start";
  return {
    command,
    dryRun: args.includes("--dry-run"),
  };
}

function logSection(title) {
  console.log("");
  console.log(`=== ${title} ===`);
}

function logStep(label, detail = null) {
  console.log(detail ? `- ${label}: ${detail}` : `- ${label}`);
}

function formatTimestamp(timestamp) {
  if (!timestamp) {
    return "never";
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return String(timestamp);
  }

  return date.toLocaleString();
}

function canRun(command, args = ["--version"]) {
  const result = spawnSync(command, args, {
    stdio: "ignore",
    shell: false,
  });

  return result.status === 0;
}

function getStrayDevProcessIds() {
  if (process.platform !== "win32") {
    return [];
  }

  const patterns = [
    "npm run dev --workspace @secretary/web",
    "npm run start --workspace @secretary/worker",
    "node --env-file=.env apps/worker/dist/index.js",
    "next dev --port 3000",
    "dist/index.js",
    "scripts/speech/run-stt.mjs",
    "scripts/speech/run-tts.mjs",
  ];
  const script = [
    `$patterns = ${patterns.map((pattern) => `'${pattern}'`).join(",")};`,
    "$currentPid = $PID;",
    "$procs = Get-CimInstance Win32_Process | Where-Object {",
    "  $cmd = $_.CommandLine;",
    "  $cmd -and $_.ProcessId -ne $currentPid -and ($patterns | Where-Object { $cmd -like ('*' + $_ + '*') })",
    "};",
    "$procs | Select-Object -ExpandProperty ProcessId -Unique | ConvertTo-Json -Compress",
  ].join(" ");

  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-Command", script],
    {
      cwd: root,
      encoding: "utf8",
      shell: false,
      windowsHide: true,
    },
  );

  if (result.status !== 0 || !result.stdout.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(result.stdout.trim());
    if (Array.isArray(parsed)) {
      return parsed.filter((value) => Number.isFinite(value));
    }

    return Number.isFinite(parsed) ? [parsed] : [];
  } catch {
    return [];
  }
}

async function ensureDir(path) {
  await mkdir(path, { recursive: true });
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readState() {
  try {
    return JSON.parse(await readFile(stateFilePath, "utf8"));
  } catch {
    return {
      bootstrap: {},
      processes: {},
      lastStartedAt: null,
    };
  }
}

async function writeState(state) {
  await ensureDir(configRoot);
  await writeFile(stateFilePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function runCommand(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? root,
      stdio: options.stdio ?? "inherit",
      env: options.env ?? process.env,
      shell: false,
      detached: options.detached ?? false,
      windowsHide: true,
    });

    child.on("error", rejectPromise);
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise(undefined);
        return;
      }

      rejectPromise(
        new Error(`${command} ${args.join(" ")} exited with ${code ?? "unknown"}`),
      );
    });
  });
}

async function runNpmScript(scriptName, options = {}) {
  if (process.platform === "win32") {
    await runCommand(
      "cmd.exe",
      ["/d", "/s", "/c", `npm run ${scriptName}`],
      options,
    );
    return;
  }

  await runCommand("npm", ["run", scriptName], options);
}

async function runNpmArgs(args, options = {}) {
  if (process.platform === "win32") {
    await runCommand(
      "cmd.exe",
      ["/d", "/s", "/c", `npm ${args.join(" ")}`],
      options,
    );
    return;
  }

  await runCommand("npm", args, options);
}

async function ensureEnvFile({ dryRun }) {
  if (await pathExists(envPath)) {
    logStep(".env", "present");
    return false;
  }

  if (!(await pathExists(envExamplePath))) {
    throw new Error("Missing .env.example; cannot create .env automatically.");
  }

  logStep(".env", "creating from .env.example");
  if (!dryRun) {
    await copyFile(envExamplePath, envPath);
  }
  return true;
}

async function maybeRun(commandLabel, npmScript, { dryRun }) {
  logStep(commandLabel, `npm run ${npmScript}`);
  if (dryRun) {
    return;
  }

  await runNpmScript(npmScript);
}

async function cleanupInfrastructureResidue({ dryRun }) {
  logStep("Docker cleanup", "removing stale infrastructure residue");
  if (dryRun || !canRun("docker", ["--version"])) {
    return;
  }

  spawnSync("docker", ["rm", "-f", ...infrastructureContainers], {
    cwd: root,
    stdio: "ignore",
    shell: false,
    windowsHide: true,
  });
  spawnSync("docker", ["network", "rm", infrastructureNetwork], {
    cwd: root,
    stdio: "ignore",
    shell: false,
    windowsHide: true,
  });
}

async function ensureDockerStack({ dryRun }) {
  logStep("Docker stack", "npm run stack:up");
  if (dryRun) {
    return;
  }

  try {
    await runNpmScript("stack:up");
  } catch (error) {
    logStep("Docker stack", "encountered stale Docker residue, retrying once");
    await cleanupInfrastructureResidue({ dryRun: false });
    await runNpmScript("stack:up");
  }

  for (const infrastructureService of infrastructureServices) {
    logStep("Waiting for", `${infrastructureService.label} on ${infrastructureService.port}`);
    const ready = await waitForPortReadiness(infrastructureService);
    if (!ready) {
      throw new Error(`${infrastructureService.label} did not become ready on port ${infrastructureService.port}.`);
    }
    logStep("Ready", infrastructureService.label);
  }
}

async function maybeRunWithRetries(commandLabel, npmScript, { dryRun, attempts = 3, delayMs = 5000 }) {
  logStep(commandLabel, `npm run ${npmScript}`);
  if (dryRun) {
    return;
  }

  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await runNpmScript(npmScript);
      return;
    } catch (error) {
      lastError = error;
      if (attempt === attempts) {
        break;
      }

      logStep(commandLabel, `attempt ${attempt} failed, retrying in ${Math.round(delayMs / 1000)}s`);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Failed running ${npmScript}`);
}

async function ensureNodeModules(state, { dryRun }) {
  const lockStat = await stat(packageLockPath);
  const packageLockMtimeMs = lockStat.mtimeMs;
  const needsInstall =
    !(await pathExists(nodeModulesPath)) ||
    state.bootstrap.packageLockMtimeMs !== packageLockMtimeMs;

  if (!needsInstall) {
    logStep("Dependencies", "already installed");
    return state;
  }

  await maybeRun("Dependencies", "install", { dryRun });
  return {
    ...state,
    bootstrap: {
      ...state.bootstrap,
      packageLockMtimeMs,
    },
  };
}

async function getLatestMtimeMs(path) {
  const stats = await stat(path);
  if (!stats.isDirectory()) {
    return stats.mtimeMs;
  }

  const fs = await import("node:fs/promises");
  const entries = await fs.readdir(path, { withFileTypes: true });
  let latest = stats.mtimeMs;

  for (const entry of entries) {
    const entryPath = join(path, entry.name);
    if (entry.isDirectory()) {
      latest = Math.max(latest, await getLatestMtimeMs(entryPath));
      continue;
    }

    const entryStats = await stat(entryPath);
    latest = Math.max(latest, entryStats.mtimeMs);
  }

  return latest;
}

async function ensureWorkerBuild(state, { dryRun }) {
  const sourceMtimeMs = Math.max(
    await getLatestMtimeMs(workerSourceRoot),
    await stat(workerPackagePath).then((value) => value.mtimeMs),
    await stat(workerTsconfigPath).then((value) => value.mtimeMs),
  );

  const buildOutputExists = await pathExists(workerBuildOutputPath);
  const needsBuild =
    !buildOutputExists ||
    state.bootstrap.workerSourceMtimeMs !== sourceMtimeMs;

  if (!needsBuild) {
    logStep("Worker build", "ready");
    return {
      ...state,
      bootstrap: {
        ...state.bootstrap,
        workerSourceMtimeMs: sourceMtimeMs,
      },
    };
  }

  logStep("Worker build", "npm run build --workspace @secretary/worker");
  if (!dryRun) {
    await runNpmArgs(["run", "build", "--workspace", "@secretary/worker"]);
  }

  return {
    ...state,
    bootstrap: {
      ...state.bootstrap,
      workerSourceMtimeMs: sourceMtimeMs,
    },
  };
}

async function ensureSpeechSetup(state, { dryRun }) {
  const sttRequirementsStat = await stat(sttRequirementsPath);
  const ttsRequirementsStat = await stat(ttsRequirementsPath);
  const nextState = {
    ...state,
    bootstrap: {
      ...state.bootstrap,
    },
  };

  const shouldSetupStt =
    !(await pathExists(sttVenvPythonPath)) ||
    nextState.bootstrap.sttRequirementsMtimeMs !== sttRequirementsStat.mtimeMs;
  const shouldSetupTts =
    !(await pathExists(ttsVenvPythonPath)) ||
    nextState.bootstrap.ttsRequirementsMtimeMs !== ttsRequirementsStat.mtimeMs;

  if (shouldSetupStt) {
    await maybeRun("STT setup", "stt:setup", { dryRun });
    nextState.bootstrap.sttRequirementsMtimeMs = sttRequirementsStat.mtimeMs;
  } else {
    logStep("STT setup", "ready");
  }

  if (shouldSetupTts) {
    await maybeRun("TTS setup", "tts:setup", { dryRun });
    nextState.bootstrap.ttsRequirementsMtimeMs = ttsRequirementsStat.mtimeMs;
  } else {
    logStep("TTS setup", "ready");
  }

  return nextState;
}

async function ensureSystemDependencies({ installMissing, dryRun }) {
  const missing = [];

  if (!canRun("docker", ["--version"])) {
    missing.push({
      label: "Docker Desktop",
      check: "docker",
      wingetId: "Docker.DockerDesktop",
    });
  }

  const hasPython = canRun("python", ["--version"]) ||
    canRun("py", ["-3.11", "--version"]) ||
    canRun("py", ["-3", "--version"]);

  if (!hasPython) {
    missing.push({
      label: "Python 3.11",
      check: "python",
      wingetId: "Python.Python.3.11",
    });
  }

  if (missing.length === 0) {
    logStep("System dependencies", "ready");
    return;
  }

  if (!installMissing) {
    throw new Error(
      `Missing system dependencies: ${missing.map((entry) => entry.label).join(", ")}. Run "secretary.cmd install" to attempt automatic installation.`,
    );
  }

  if (!canRun("winget")) {
    throw new Error(
      `Missing system dependencies: ${missing.map((entry) => entry.label).join(", ")}. Install them manually or make winget available.`,
    );
  }

  for (const dependency of missing) {
    logStep("Installing system dependency", dependency.label);
    if (dryRun) {
      continue;
    }

    await runCommand("winget", [
      "install",
      "--id",
      dependency.wingetId,
      "-e",
      "--accept-package-agreements",
      "--accept-source-agreements",
    ]);
  }

  logStep("System dependencies", "installation attempted");
}

async function ensureBootstrap({ installMissing, dryRun }) {
  await ensureDir(logsRoot);
  await ensureDir(configRoot);
  await ensureEnvFile({ dryRun });
  await ensureSystemDependencies({ installMissing, dryRun });

  let state = await readState();
  state = await ensureNodeModules(state, { dryRun });

  await ensureDockerStack({ dryRun });
  await maybeRunWithRetries("Database migrations", "db:migrate", {
    dryRun,
    attempts: 5,
    delayMs: 5000,
  });
  state = await ensureWorkerBuild(state, { dryRun });

  state = await ensureSpeechSetup(state, { dryRun });
  if (!dryRun) {
    await writeState(state);
  }
  return state;
}

function isPortOpen(port) {
  return new Promise((resolvePromise) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolvePromise(true);
    });
    socket.once("error", () => {
      resolvePromise(false);
    });
    socket.setTimeout(500, () => {
      socket.destroy();
      resolvePromise(false);
    });
  });
}

async function killProcessByPid(pid) {
  if (!Number.isFinite(pid)) {
    return false;
  }

  if (process.platform === "win32") {
    const result = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      shell: false,
    });
    return result.status === 0;
  }

  try {
    process.kill(-pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

async function killPortListeners(port) {
  if (process.platform === "win32") {
    const command = [
      `$connections = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue;`,
      "if (-not $connections) { exit 0 }",
      "$processIds = $connections | Select-Object -ExpandProperty OwningProcess -Unique;",
      "foreach ($processId in $processIds) {",
      "  try { Stop-Process -Id $processId -Force -ErrorAction Stop } catch { exit 1 }",
      "}",
    ].join(" ");
    const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], {
      stdio: "ignore",
      shell: false,
    });

    return result.status === 0;
  }

  if (canRun("bash", ["-lc", `fuser -k ${port}/tcp`])) {
    return true;
  }

  return false;
}

async function stopManagedProcesses({ dryRun, keepDocker = false }) {
  const state = await readState();
  const entries = Object.entries(state.processes ?? {});

  for (const [, processInfo] of entries) {
    if (!processInfo?.pid) {
      continue;
    }

    logStep("Stopping managed process", `${processInfo.label} (${processInfo.pid})`);
    if (!dryRun) {
      await killProcessByPid(processInfo.pid);
    }
  }

  const strayProcessIds = getStrayDevProcessIds();
  for (const pid of strayProcessIds) {
    logStep("Stopping stray dev process", String(pid));
    if (!dryRun) {
      await killProcessByPid(pid);
    }
  }

  for (const service of services) {
    logStep("Cleaning port", String(service.port));
    if (!dryRun) {
      await killPortListeners(service.port);
    }
  }

  const nextState = {
    ...state,
    processes: {},
  };

  if (!dryRun) {
    await writeState(nextState);
  }

  if (!keepDocker) {
    await maybeRun("Docker stack down", "stack:down", { dryRun });
  }
}

async function launchDetachedProcess(service) {
  const outLogPath = resolve(logsRoot, `${service.key}.out.log`);
  const errLogPath = resolve(logsRoot, `${service.key}.err.log`);
  await writeFile(outLogPath, "", "utf8");
  await writeFile(errLogPath, "", "utf8");
  const [command, args] = process.platform === "win32"
    ? service.windowsCommand
    : service.unixCommand;

  const child = spawn(command, args, {
    cwd: root,
    detached: true,
    stdio: [
      "ignore",
      await openFileForAppend(outLogPath),
      await openFileForAppend(errLogPath),
    ],
    shell: false,
    windowsHide: true,
  });

  child.unref();

  return {
    pid: child.pid,
    outLogPath,
    errLogPath,
    startedAt: new Date().toISOString(),
  };
}

async function openFileForAppend(path) {
  const fs = await import("node:fs");
  return fs.openSync(path, "a");
}

function sleep(ms) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

async function waitForPortReadiness({ port, startupTimeoutMs }) {
  const timeoutMs = startupTimeoutMs ?? 45_000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await isPortOpen(port)) {
      return true;
    }

    await sleep(1_000);
  }

  return false;
}

async function waitForService(service) {
  return waitForPortReadiness({
    port: service.port,
    startupTimeoutMs: service.startupTimeoutMs,
  });
}

async function readLogTail(path, lineCount = 40) {
  if (!(await pathExists(path))) {
    return "";
  }

  const content = await readFile(path, "utf8");
  return content
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-lineCount)
    .join("\n");
}

async function startCommand({ dryRun }) {
  let state = await ensureBootstrap({ installMissing: false, dryRun });
  await stopManagedProcesses({ dryRun, keepDocker: true });

  logSection("Starting background services");
  const processState = {};

  for (const service of services) {
    logStep("Launching", service.label);
    if (dryRun) {
      continue;
    }

    const launched = await launchDetachedProcess(service);
    processState[service.key] = {
      label: service.label,
      pid: launched.pid,
      port: service.port,
      logPath: launched.outLogPath,
      errorLogPath: launched.errLogPath,
      startedAt: launched.startedAt,
    };
  }

  state = {
    ...state,
    processes: processState,
    lastStartedAt: new Date().toISOString(),
  };

  if (!dryRun) {
    await writeState(state);
  }

  if (!dryRun) {
    const failedServices = [];

    for (const service of services) {
      logStep("Waiting for", `${service.label} on ${service.port}`);
      const ready = await waitForService(service);
      if (ready) {
        logStep("Ready", service.label);
        continue;
      }

      const processInfo = processState[service.key];
      const stderrTail = processInfo?.errorLogPath
        ? await readLogTail(processInfo.errorLogPath)
        : "";
      const stdoutTail = processInfo?.logPath
        ? await readLogTail(processInfo.logPath)
        : "";

      failedServices.push({
        service,
        stderrTail,
        stdoutTail,
      });
    }

    if (failedServices.length > 0) {
      await stopManagedProcesses({ dryRun: false, keepDocker: true });
      const details = failedServices.map(({ service, stderrTail, stdoutTail }) => {
        const tail = stderrTail || stdoutTail || "No recent log output.";
        return `${service.label} did not become ready on port ${service.port}.\n${tail}`;
      }).join("\n\n");

      throw new Error(`Secretary startup failed.\n\n${details}`);
    }
  }

  logSection("Secretary startup");
  logStep("Desk", "http://localhost:3000");
  logStep("Worker", "http://127.0.0.1:4000");
  logStep("Speech services", "127.0.0.1:5001 and :5002");
  logStep("Logs", logsRoot);
  logStep("Next check", "Run secretary.cmd status in a few seconds to confirm each service is listening");
}

async function installCommand({ dryRun }) {
  await ensureBootstrap({ installMissing: true, dryRun });
  logSection("Install complete");
  logStep("Next step", "Run secretary.cmd start");
}

async function stopCommand({ dryRun }) {
  logSection("Stopping Secretary");
  await stopManagedProcesses({ dryRun, keepDocker: false });
}

async function statusCommand() {
  const state = await readState();

  logSection("Secretary status");
  logStep("Repo", root);
  logStep(".env", (await pathExists(envPath)) ? "present" : "missing");
  logStep("Docker CLI", canRun("docker", ["--version"]) ? "available" : "missing");
  logStep("Python", canRun("python", ["--version"]) || canRun("py", ["-3.11", "--version"]) ? "available" : "missing");
  logStep("Last started", formatTimestamp(state.lastStartedAt));
  logStep("Logs", logsRoot);

  for (const service of services) {
    const running = await isPortOpen(service.port);
    const processInfo = state.processes?.[service.key] ?? null;
    logStep(
      service.label,
      running
        ? `listening on ${service.port}${processInfo?.pid ? ` (pid ${processInfo.pid})` : ""}${service.healthUrl ? ` -> ${service.healthUrl}` : ""}`
        : "stopped",
    );
  }
}

async function main() {
  const { command, dryRun } = parseArgs(process.argv);

  switch (command) {
    case "install":
      await installCommand({ dryRun });
      break;
    case "start":
      await startCommand({ dryRun });
      break;
    case "stop":
      await stopCommand({ dryRun });
      break;
    case "restart":
      await stopCommand({ dryRun });
      await startCommand({ dryRun });
      break;
    case "status":
      await statusCommand();
      break;
    default:
      throw new Error(`Unknown command "${command}". Use install, start, stop, restart, or status.`);
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
