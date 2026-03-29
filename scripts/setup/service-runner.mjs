import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, "../..");

// Service definitions
const services = [
  {
    key: "web",
    label: "Secretary Web",
    port: 3000,
    startupTimeoutMs: 60_000,
    startupDelayMs: 2000,
    healthRetries: 3,
    command: process.platform === "win32" ? "npm.cmd" : "npm",
    args: ["run", "dev", "--workspace", "@secretary/web"],
    healthUrl: "http://127.0.0.1:3000",
    color: "\x1b[36m", // Cyan
  },
  {
    key: "worker",
    label: "Secretary Worker",
    port: 4000,
    startupTimeoutMs: 60_000,
    startupDelayMs: 1000,
    healthRetries: 3,
    command: "node",
    args: ["--env-file=.env", "apps/worker/dist/index.js"],
    healthUrl: "http://127.0.0.1:4000/health/ready",
    color: "\x1b[33m", // Yellow
  },
  {
    key: "stt",
    label: "Secretary STT",
    port: 5001,
    startupTimeoutMs: 120_000,
    startupDelayMs: 3000,
    healthRetries: 5,
    command: "node",
    args: ["scripts/speech/run-stt.mjs"],
    healthUrl: "http://127.0.0.1:5001/health",
    color: "\x1b[32m", // Green
  },
  {
    key: "tts",
    label: "Secretary TTS",
    port: 5002,
    startupTimeoutMs: 150_000,
    startupDelayMs: 3000,
    healthRetries: 5,
    command: "node",
    args: ["scripts/speech/run-tts.mjs"],
    healthUrl: "http://127.0.0.1:5002/health",
    color: "\x1b[35m", // Magenta
  },
];

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

const activeProcesses = new Map();
let isShuttingDown = false;

function log(service, message, isError = false) {
  const timestamp = new Date().toLocaleTimeString();
  const prefix = `${service.color}${BOLD}[${service.label.padEnd(18)}]${RESET}`;
  const stream = isError ? process.stderr : process.stdout;
  stream.write(`${DIM}${timestamp}${RESET} ${prefix} ${message}\n`);
}

function showBanner() {
  console.log("");
  console.log(`${BOLD}  ╔══════════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}  ║              Secretary Development Environment               ║${RESET}`);
  console.log(`${BOLD}  ╚══════════════════════════════════════════════════════════════╝${RESET}`);
  console.log("");

  for (const service of services) {
    console.log(`    ${service.color}${BOLD}[${service.label}]${RESET}  ${DIM}http://127.0.0.1:${service.port}${RESET}`);
  }
  console.log("");
  console.log(`${DIM}  Press Ctrl+C to stop all services${RESET}`);
  console.log("");
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

async function waitForPortReadiness(service) {
  const timeoutMs = service.startupTimeoutMs ?? 45_000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const isOpen = await isPortOpen(service.port);

    if (isOpen) {
      return true;
    }

    await new Promise(resolve => setTimeout(resolve, 1_000));
  }

  return false;
}

async function checkServiceHealth(service) {
  if (!service.healthUrl) {
    return await isPortOpen(service.port);
  }

  try {
    const response = await fetch(service.healthUrl, {
      signal: AbortSignal.timeout(3000),
    });
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}

async function startService(service) {
  const [spawnCommand, spawnArgs] = normalizeWindowsSpawn(service.command, service.args);

  log(service, `Starting...`);

  const child = spawn(spawnCommand, spawnArgs, {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
    shell: false,
    detached: false,
    windowsHide: true,
  });

  activeProcesses.set(service.key, child);

  // Handle stdout
  child.stdout.on("data", (data) => {
    const lines = data.toString().split(/\r?\n/);
    for (const line of lines) {
      if (line.trim()) {
        log(service, line.trim());
      }
    }
  });

  // Handle stderr
  child.stderr.on("data", (data) => {
    const lines = data.toString().split(/\r?\n/);
    for (const line of lines) {
      if (line.trim()) {
        log(service, line.trim(), true);
      }
    }
  });

  child.on("exit", (code, signal) => {
    activeProcesses.delete(service.key);

    if (isShuttingDown) {
      return;
    }

    if (code !== 0) {
      log(service, `Process exited with code ${code} (signal: ${signal})`, true);
    }
  });

  child.on("error", (err) => {
    log(service, `Failed to start: ${err.message}`, true);
    activeProcesses.delete(service.key);
  });

  // Wait for service startup delay
  if (service.startupDelayMs) {
    await new Promise(resolve => setTimeout(resolve, service.startupDelayMs));
  }

  // Wait for port to be ready
  const portReady = await waitForPortReadiness(service);
  if (!portReady) {
    log(service, `Warning: Port ${service.port} not ready after timeout`, true);
  }

  // Check health
  const healthy = await checkServiceHealth(service);
  if (healthy) {
    log(service, `Ready (port ${service.port})`);
  } else {
    log(service, `Started but health check failed`, true);
  }

  return child;
}

async function shutdown() {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log("");
  console.log(`${BOLD}  Shutting down services...${RESET}`);

  // Kill all child processes in parallel for faster shutdown
  const killPromises = Array.from(activeProcesses.entries()).map(async ([key, child]) => {
    const service = services.find(s => s.key === key);
    if (service) {
      log(service, `Stopping...`);
    }

    try {
      // On Windows, we need to kill the process tree
      if (process.platform === "win32") {
        spawnSync("taskkill", ["/pid", String(child.pid), "/f", "/t"], {
          stdio: "ignore",
          windowsHide: true,
        });
      } else {
        child.kill("SIGTERM");
      }
    } catch {
      // Ignore errors during shutdown
    }
  });

  await Promise.allSettled(killPromises);

  // Brief pause to let processes terminate
  await new Promise(resolve => setTimeout(resolve, 500));

  console.log("");
  console.log(`${BOLD}  All services stopped.${RESET}`);
  
  // Force exit immediately to prevent "Terminate batch job?" prompt on Windows
  process.exit(0);
}

async function main() {
  // Set up signal handlers for graceful shutdown
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Show startup banner
  showBanner();

  // Start all services sequentially
  for (const service of services) {
    try {
      await startService(service);
    } catch (error) {
      log(service, `Failed to start: ${error.message}`, true);
    }
  }

  console.log("");
  console.log(`${BOLD}  All services started!${RESET}`);
  console.log(`${DIM}  Logs are streaming below...${RESET}`);
  console.log("");
  console.log(`${BOLD}  ═══════════════════════════════════════════════════════════════${RESET}`);
  console.log("");
}

void main().catch((error) => {
  console.error(`${BOLD}Fatal error: ${error.message}${RESET}`);
  process.exit(1);
});
