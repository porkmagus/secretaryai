import { spawn, spawnSync } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
const sttVenvPythonPath =
  process.platform === "win32"
    ? resolve(root, "runtime/venvs/stt/Scripts/python.exe")
    : resolve(root, "runtime/venvs/stt/bin/python");
const ttsVenvPythonPath =
  process.platform === "win32"
    ? resolve(root, "runtime/venvs/tts/Scripts/python.exe")
    : resolve(root, "runtime/venvs/tts/bin/python");

// Global state for signal handling
let isShuttingDown = false;
const activeProcesses = new Map();

const services = [
  {
    key: "web",
    label: "Secretary Web",
    port: 3000,
    startupTimeoutMs: 60_000,
    startupDelayMs: 2000,
    healthRetries: 3,
    windowsCommand: ["npm.cmd", ["run", "dev", "--workspace", "@secretary/web"]],
    unixCommand: ["npm", ["run", "dev", "--workspace", "@secretary/web"]],
    healthUrl: "http://127.0.0.1:3000",
  },
  {
    key: "worker",
    label: "Secretary Worker",
    port: 4000,
    startupTimeoutMs: 60_000,
    startupDelayMs: 1000,
    healthRetries: 3,
    windowsCommand: ["node", ["--env-file=.env", "apps/worker/dist/index.js"]],
    unixCommand: ["node", ["--env-file=.env", "apps/worker/dist/index.js"]],
    healthUrl: "http://127.0.0.1:4000/health/ready",
  },
  {
    key: "stt",
    label: "Secretary STT",
    port: 5001,
    startupTimeoutMs: 120_000,
    startupDelayMs: 3000,
    healthRetries: 5,
    windowsCommand: ["node", ["scripts/speech/run-stt.mjs"]],
    unixCommand: ["node", ["scripts/speech/run-stt.mjs"]],
    healthUrl: "http://127.0.0.1:5001/health",
  },
  {
    key: "tts",
    label: "Secretary TTS",
    port: 5002,
    startupTimeoutMs: 150_000,
    startupDelayMs: 3000,
    healthRetries: 5,
    windowsCommand: ["node", ["scripts/speech/run-tts.mjs"]],
    unixCommand: ["node", ["scripts/speech/run-tts.mjs"]],
    healthUrl: "http://127.0.0.1:5002/health",
  },
];

const infrastructureContainers = [
  "secretary-postgres",
  "secretary-redis",
  "secretary-searxng",
  "secretary-crawl4ai",
];
const infrastructureNetwork = "compose_default";
const infrastructureServices = [
  { label: "Postgres", port: 5432, startupTimeoutMs: 60_000 },
  { label: "Redis", port: 6379, startupTimeoutMs: 30_000 },
  { label: "SearXNG", port: 8080, startupTimeoutMs: 60_000 },
  { label: "Crawl4AI", port: 11235, startupTimeoutMs: 120_000 },
];

function parseArgs(argv) {
  const args = argv.slice(2);
  const command = args.find((value) => !value.startsWith("-")) ?? "start";
  return {
    command,
    dryRun: args.includes("--dry-run"),
    verbose: args.includes("--verbose") || args.includes("-v"),
  };
}

function logSection(_title) {}

function logStep(_label, _detail = null) {}

function logVerbose(verbose, _message) {
  if (verbose) {
  }
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
  try {
    const result = spawnSync(command, args, {
      stdio: "ignore",
      shell: false,
      windowsHide: true,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

function getProcessIdsOnPort(port) {
  if (process.platform !== "win32") {
    return [];
  }

  const command = [
    `$connections = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue;`,
    "if (-not $connections) { exit 0 }",
    "$processIds = $connections | Select-Object -ExpandProperty OwningProcess -Unique;",
    "$processIds | ConvertTo-Json -Compress",
  ].join(" ");

  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], {
    cwd: root,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });

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

  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", script], {
    cwd: root,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });

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

function normalizeWindowsSpawn(command, args) {
  if (process.platform !== "win32") {
    return [command, args];
  }
  const lower = command.toLowerCase();
  if (lower.endsWith(".cmd") || lower.endsWith(".bat")) {
    return ["cmd.exe", ["/c", command, ...args]];
  }
  return [command, args];
}

function runCommand(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const [spawnCommand, spawnArgs] = normalizeWindowsSpawn(command, args);
    const child = spawn(spawnCommand, spawnArgs, {
      cwd: options.cwd ?? root,
      stdio: options.stdio ?? "inherit",
      env: options.env ?? process.env,
      shell: false,
      detached: options.detached ?? false,
      windowsHide: true,
    });

    if (options.track) {
      activeProcesses.set(options.trackKey || `${command}-${args.join("-")}`, child);
    }

    child.on("error", (err) => {
      if (options.track) {
        activeProcesses.delete(options.trackKey || `${command}-${args.join("-")}`);
      }
      rejectPromise(err);
    });

    child.on("exit", (code) => {
      if (options.track) {
        activeProcesses.delete(options.trackKey || `${command}-${args.join("-")}`);
      }
      if (code === 0) {
        resolvePromise(undefined);
        return;
      }

      rejectPromise(new Error(`${command} ${args.join(" ")} exited with ${code ?? "unknown"}`));
    });
  });
}

async function runNpmScript(scriptName, options = {}) {
  // Use npm.cmd on Windows directly without wrapping in cmd.exe to avoid window flashing
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  await runCommand(npmCmd, ["run", scriptName], options);
}

async function runNpmArgs(args, options = {}) {
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  await runCommand(npmCmd, args, options);
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

async function ensureDockerStack({ dryRun, verbose }) {
  logStep("Docker stack", "npm run stack:up");
  if (dryRun) {
    return;
  }

  try {
    await runNpmScript("stack:up");
  } catch (_error) {
    logStep("Docker stack", "encountered stale Docker residue, retrying once");
    await cleanupInfrastructureResidue({ dryRun: false });
    await runNpmScript("stack:up");
  }

  for (const infrastructureService of infrastructureServices) {
    logStep("Waiting for", `${infrastructureService.label} on ${infrastructureService.port}`);
    const ready = await waitForPortReadiness(infrastructureService, verbose);
    if (!ready) {
      throw new Error(
        `${infrastructureService.label} did not become ready on port ${infrastructureService.port}.`,
      );
    }
    logStep("Ready", infrastructureService.label);
  }
}

async function maybeRunWithRetries(
  commandLabel,
  npmScript,
  { dryRun, attempts = 3, delayMs = 5000 },
) {
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

      logStep(
        commandLabel,
        `attempt ${attempt} failed, retrying in ${Math.round(delayMs / 1000)}s`,
      );
      await sleep(delayMs);
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

  logStep("Dependencies", "npm install");
  if (!dryRun) {
    await runNpmArgs(["install"]);
  }
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
  const needsBuild = !buildOutputExists || state.bootstrap.workerSourceMtimeMs !== sourceMtimeMs;

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

  const hasPython =
    canRun("python", ["--version"]) ||
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

async function ensureBootstrap({ installMissing, dryRun, verbose }) {
  await ensureDir(logsRoot);
  await ensureDir(configRoot);
  await ensureEnvFile({ dryRun });
  await ensureSystemDependencies({ installMissing, dryRun });

  let state = await readState();
  state = await ensureNodeModules(state, { dryRun });

  await ensureDockerStack({ dryRun, verbose });
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
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolvePromise(false);
    });
  });
}

async function killProcessByPid(pid, verbose = false) {
  if (!Number.isFinite(pid)) {
    return false;
  }

  logVerbose(verbose, `Killing process ${pid}`);

  if (process.platform === "win32") {
    const result = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      shell: false,
      windowsHide: true,
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

async function killPortListeners(port, verbose = false) {
  const pids = getProcessIdsOnPort(port);
  if (pids.length === 0) {
    return true;
  }

  logVerbose(verbose, `Found ${pids.length} process(es) on port ${port}: ${pids.join(", ")}`);

  let success = true;
  for (const pid of pids) {
    const killed = await killProcessByPid(pid, verbose);
    if (!killed) {
      success = false;
    }
  }

  // Give the OS time to release the port
  if (pids.length > 0) {
    await sleep(500);
  }

  return success;
}

async function stopManagedProcesses({ dryRun, keepDocker = false, verbose = false }) {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  logSection("Stopping Secretary");

  const state = await readState();
  const entries = Object.entries(state.processes ?? {});

  // Stop tracked active processes first
  for (const [key, child] of activeProcesses) {
    logStep("Stopping active process", key);
    if (!dryRun) {
      try {
        child.kill("SIGTERM");
      } catch {
        // Ignore errors
      }
    }
  }

  // Stop managed processes from state
  for (const [, processInfo] of entries) {
    if (!processInfo?.pid) {
      continue;
    }

    logStep("Stopping managed process", `${processInfo.label} (${processInfo.pid})`);
    if (!dryRun) {
      await killProcessByPid(processInfo.pid, verbose);
    }
  }

  // Find and stop stray processes
  const strayProcessIds = getStrayDevProcessIds();
  for (const pid of strayProcessIds) {
    logStep("Stopping stray dev process", String(pid));
    if (!dryRun) {
      await killProcessByPid(pid, verbose);
    }
  }

  // Kill any remaining port listeners
  for (const service of services) {
    const pids = getProcessIdsOnPort(service.port);
    if (pids.length > 0) {
      logStep("Cleaning port", String(service.port));
      if (!dryRun) {
        await killPortListeners(service.port, verbose);
      }
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

  isShuttingDown = false;
}

async function _launchDetachedProcess(service, verbose = false) {
  const outLogPath = resolve(logsRoot, `${service.key}.out.log`);
  const errLogPath = resolve(logsRoot, `${service.key}.err.log`);

  // Ensure log files exist
  await ensureDir(logsRoot);
  await writeFile(
    outLogPath,
    `=== ${service.label} started at ${new Date().toISOString()} ===\n`,
    "utf8",
  );
  await writeFile(errLogPath, "", "utf8");

  const [command, args] =
    process.platform === "win32" ? service.windowsCommand : service.unixCommand;

  logVerbose(verbose, `Launching ${service.label}: ${command} ${args.join(" ")}`);

  // Open log files as file descriptors so they can be passed to spawn stdio
  const outFd = openSync(outLogPath, "a");
  const errFd = openSync(errLogPath, "a");

  const [spawnCommand, spawnArgs] = normalizeWindowsSpawn(command, args);
  const child = spawn(spawnCommand, spawnArgs, {
    cwd: root,
    detached: true,
    stdio: ["ignore", outFd, errFd],
    shell: false,
    windowsHide: true,
  });

  // Store in active processes for cleanup tracking
  activeProcesses.set(service.key, child);

  child.on("exit", () => {
    activeProcesses.delete(service.key);
    try {
      closeSync(outFd);
    } catch {}
    try {
      closeSync(errFd);
    } catch {}
  });

  child.unref();

  return {
    pid: child.pid,
    outLogPath,
    errLogPath,
    startedAt: new Date().toISOString(),
  };
}

function sleep(ms) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

async function waitForPortReadiness(
  { port, startupTimeoutMs },
  verbose = false,
  healthUrl = null,
  healthRetries = 3,
) {
  const timeoutMs = startupTimeoutMs ?? 45_000;
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    const isOpen = await isPortOpen(port);

    if (isOpen && healthUrl) {
      // If we have a health URL, verify it's actually responding
      for (let attempt = 0; attempt < healthRetries; attempt++) {
        try {
          const response = await fetch(healthUrl, {
            signal: AbortSignal.timeout(2000),
          }).catch(() => null);

          if (response?.ok || response?.status === 404) {
            return true;
          }

          logVerbose(
            verbose,
            `Health check attempt ${attempt + 1} for ${healthUrl}: ${response?.status || "failed"}`,
          );
          await sleep(500);
        } catch (err) {
          lastError = err;
          await sleep(500);
        }
      }
    } else if (isOpen) {
      return true;
    }

    await sleep(1_000);
  }

  logVerbose(
    verbose,
    `Timeout waiting for port ${port}. Last error: ${lastError?.message || "none"}`,
  );
  return false;
}

async function _waitForService(service, verbose = false) {
  // Wait initial delay for service to start binding
  if (service.startupDelayMs) {
    logVerbose(
      verbose,
      `Waiting ${service.startupDelayMs}ms for ${service.label} to initialize...`,
    );
    await sleep(service.startupDelayMs);
  }

  return waitForPortReadiness(
    { port: service.port, startupTimeoutMs: service.startupTimeoutMs },
    verbose,
    service.healthUrl,
    service.healthRetries ?? 3,
  );
}

async function _readLogTail(path, lineCount = 40) {
  if (!(await pathExists(path))) {
    return "";
  }

  try {
    const content = await readFile(path, "utf8");
    return content.split(/\r?\n/).filter(Boolean).slice(-lineCount).join("\n");
  } catch {
    return "";
  }
}

async function checkServiceHealth(service, verbose = false) {
  if (!service.healthUrl) {
    return await isPortOpen(service.port);
  }

  try {
    const response = await fetch(service.healthUrl, {
      signal: AbortSignal.timeout(3000),
    });
    return response.ok || response.status === 404;
  } catch (err) {
    logVerbose(verbose, `Health check failed for ${service.label}: ${err.message}`);
    return false;
  }
}

async function startCommand({ dryRun, verbose }) {
  const _state = await ensureBootstrap({ installMissing: false, dryRun, verbose });

  // Set up signal handlers for clean shutdown
  const shutdownHandler = async () => {
    logStep("Shutdown signal received", "cleaning up...");
    await stopManagedProcesses({ dryRun: false, keepDocker: true, verbose });
    process.exit(0);
  };

  process.on("SIGINT", shutdownHandler);
  process.on("SIGTERM", shutdownHandler);

  // Pre-flight: check for existing processes on our ports
  logSection("Pre-flight checks");
  for (const service of services) {
    const existingPids = getProcessIdsOnPort(service.port);
    if (existingPids.length > 0) {
      logStep("Port in use", `${service.port} (PIDs: ${existingPids.join(", ")})`);
      if (!dryRun) {
        await killPortListeners(service.port, verbose);
      }
    }
  }

  await stopManagedProcesses({ dryRun, keepDocker: true, verbose });

  logSection("Starting services");

  if (dryRun) {
    logStep("Services", "Would start web, worker, stt, tts via service runner");
    return;
  }

  // Launch all services using the consolidated service runner
  const serviceRunnerPath = resolve(__dirname, "service-runner.mjs");
  const [spawnCommand, spawnArgs] = normalizeWindowsSpawn("node", [serviceRunnerPath]);

  const child = spawn(spawnCommand, spawnArgs, {
    cwd: root,
    stdio: "inherit", // Pass through all stdio to show consolidated output
    env: process.env,
    shell: false,
    detached: false,
    windowsHide: true,
  });

  // Store in active processes for cleanup tracking
  activeProcesses.set("service-runner", child);

  // Update state with a placeholder for the service runner
  const currentState = await readState();
  const processState = {
    service_runner: {
      label: "Service Runner (consolidated)",
      pid: child.pid,
      port: null,
      logPath: null,
      errorLogPath: null,
      startedAt: new Date().toISOString(),
    },
  };

  await writeState({
    ...currentState,
    processes: processState,
    lastStartedAt: new Date().toISOString(),
  });

  // Wait for the service runner to exit (this will happen on Ctrl+C)
  return new Promise((resolvePromise) => {
    child.on("exit", (code) => {
      activeProcesses.delete("service-runner");

      if (code !== 0) {
      }

      // Clean up state
      const state = readState();
      writeState({
        ...state,
        processes: {},
      });

      resolvePromise();
    });

    child.on("error", (_err) => {
      activeProcesses.delete("service-runner");
      resolvePromise();
    });
  });
}

async function installCommand({ dryRun, verbose }) {
  await ensureBootstrap({ installMissing: true, dryRun, verbose });
  logSection("Install complete");
  logStep("Next step", "Run secretary.cmd start");
}

async function stopCommand({ dryRun, verbose }) {
  await stopManagedProcesses({ dryRun, keepDocker: false, verbose });
}

async function restartCommand({ dryRun, verbose }) {
  await stopManagedProcesses({ dryRun, keepDocker: true, verbose });
  await sleep(2000); // Give processes time to fully terminate
  await startCommand({ dryRun, verbose });
}

async function statusCommand() {
  const state = await readState();

  logSection("Secretary status");
  logStep("Repo", root);
  logStep(".env", (await pathExists(envPath)) ? "present" : "missing");
  logStep("Docker CLI", canRun("docker", ["--version"]) ? "available" : "missing");
  logStep(
    "Python",
    canRun("python", ["--version"]) || canRun("py", ["-3.11", "--version"])
      ? "available"
      : "missing",
  );
  logStep("Last started", formatTimestamp(state.lastStartedAt));
  logStep("Logs", logsRoot);

  for (const service of services) {
    const running = await isPortOpen(service.port);
    const processInfo = state.processes?.[service.key] ?? null;
    const healthStatus =
      service.healthUrl && running
        ? await checkServiceHealth(service).then(
            () => " (healthy)",
            () => " (unhealthy)",
          )
        : "";

    logStep(
      service.label,
      running
        ? `listening on ${service.port}${processInfo?.pid ? ` (pid ${processInfo.pid})` : ""}${healthStatus}${service.healthUrl ? ` -> ${service.healthUrl}` : ""}`
        : "stopped",
    );
  }
}

async function logsCommand({ service, follow = false }) {
  const validServices = services.map((s) => s.key);

  if (!service || !validServices.includes(service)) {
    logSection("Available logs");
    for (const svc of services) {
      const outLog = resolve(logsRoot, `${svc.key}.out.log`);
      const errLog = resolve(logsRoot, `${svc.key}.err.log`);
      const hasOut = await pathExists(outLog);
      const hasErr = await pathExists(errLog);
      logStep(svc.label, hasOut || hasErr ? `${svc.key}.out.log, ${svc.key}.err.log` : "no logs");
    }
    logStep("Usage", "secretary.cmd logs <service> [--follow]");
    logStep("Services", validServices.join(", "));
    return;
  }

  const outLogPath = resolve(logsRoot, `${service}.out.log`);
  const _errLogPath = resolve(logsRoot, `${service}.err.log`);

  if (follow) {
    // Tail the logs
    const tailCmd = process.platform === "win32" ? "powershell.exe" : "tail";
    const tailArgs =
      process.platform === "win32"
        ? ["-NoProfile", "-Command", `Get-Content -Path "${outLogPath}" -Wait -Tail 20`]
        : ["-f", "-n", "20", outLogPath];

    await runCommand(tailCmd, tailArgs, { stdio: "inherit" });
  } else {
  }
}

async function main() {
  const { command, dryRun, verbose } = parseArgs(process.argv);

  // Handle logs command with arguments
  if (command === "logs") {
    const serviceArg = process.argv.find((arg, i) => i > 2 && !arg.startsWith("-"));
    const follow = process.argv.includes("--follow") || process.argv.includes("-f");
    await logsCommand({ service: serviceArg, follow });
    return;
  }

  switch (command) {
    case "install":
      await installCommand({ dryRun, verbose });
      break;
    case "start":
      await startCommand({ dryRun, verbose });
      break;
    case "stop":
      await stopCommand({ dryRun, verbose });
      break;
    case "restart":
      await restartCommand({ dryRun, verbose });
      break;
    case "status":
      await statusCommand();
      break;
    default:
      process.exit(1);
  }
}

void main().catch((_error) => {
  process.exit(1);
});
