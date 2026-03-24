import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, "../..");
const composeFile = resolve(root, "docker/compose/docker-compose.deploy.yml");
const envFile = resolve(root, ".env.deploy");
const extraArgs = process.argv.slice(2);
const dockerDesktopExe =
  process.platform === "win32"
    ? "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe"
    : null;
const dockerDesktopBin =
  process.platform === "win32" && dockerDesktopExe ? dirname(dockerDesktopExe) : null;

if (!existsSync(envFile)) {
  throw new Error(
    "Deployment env file is missing. Copy .env.deploy.example to .env.deploy first.",
  );
}

function hasCommand(command) {
  const probe = spawnSync(command, ["--version"], {
    stdio: "ignore",
  });

  return probe.status === 0;
}

function hasDockerDesktopCli() {
  return Boolean(dockerDesktopExe && existsSync(dockerDesktopExe));
}

function withDockerDesktopPath(env) {
  if (!dockerDesktopBin) {
    return env;
  }

  const currentPath = env.PATH ?? env.Path ?? "";
  const pathParts = currentPath.split(delimiter).filter(Boolean);

  if (pathParts.includes(dockerDesktopBin)) {
    return env;
  }

  return {
    ...env,
    PATH: `${dockerDesktopBin}${delimiter}${currentPath}`,
  };
}

function getPodmanMachineInspect() {
  const inspect = spawnSync("podman", ["machine", "inspect"], {
    encoding: "utf8",
  });

  if (inspect.status !== 0) {
    return null;
  }

  try {
    const [machine] = JSON.parse(inspect.stdout);
    return machine ?? null;
  } catch {
    return null;
  }
}

function detectComposeRunner() {
  if (hasCommand("docker")) {
    return {
      command: "docker",
      args: ["compose", "--env-file", envFile, "-f", composeFile, ...extraArgs],
      env: process.env,
    };
  }

  if (hasDockerDesktopCli()) {
    return {
      command: dockerDesktopExe,
      args: ["compose", "--env-file", envFile, "-f", composeFile, ...extraArgs],
      env: withDockerDesktopPath(process.env),
    };
  }

  if (hasCommand("docker-compose")) {
    const machine = getPodmanMachineInspect();

    if (machine?.SSHConfig?.Port) {
      const socketPath = machine.Rootful
        ? "/run/podman/podman.sock"
        : "/run/user/1000/podman/podman.sock";
      const dockerHost = `ssh://${machine.Rootful ? "root" : "user"}@127.0.0.1:${machine.SSHConfig.Port}${socketPath}`;

      return {
        command: "docker-compose",
        args: ["--env-file", envFile, "-f", composeFile, ...extraArgs],
        env: { ...process.env, DOCKER_HOST: dockerHost },
      };
    }

    return {
      command: "docker-compose",
      args: ["--env-file", envFile, "-f", composeFile, ...extraArgs],
      env: withDockerDesktopPath(process.env),
    };
  }

  if (hasCommand("podman")) {
    return {
      command: "podman",
      args: ["compose", "--env-file", envFile, "-f", composeFile, ...extraArgs],
      env: process.env,
    };
  }

  throw new Error("Neither docker nor podman is available on PATH.");
}

const runner = detectComposeRunner();
const child = spawn(runner.command, runner.args, {
  cwd: root,
  env: runner.env,
  stdio: "inherit",
});

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
