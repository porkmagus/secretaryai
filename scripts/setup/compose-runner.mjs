import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, "../..");
const composeFile = resolve(root, "docker/compose/docker-compose.yml");
const extraArgs = process.argv.slice(2);
const useShell = process.platform === "win32";

function hasCommand(command) {
  const probe = spawnSync(command, ["--version"], {
    stdio: "ignore",
    shell: useShell,
  });

  return probe.status === 0;
}

function getPodmanMachineInspect() {
  const inspect = spawnSync("podman", ["machine", "inspect"], {
    encoding: "utf8",
    shell: useShell,
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
      args: ["compose", "-f", composeFile, ...extraArgs],
      env: process.env,
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
        args: ["-f", composeFile, ...extraArgs],
        env: { ...process.env, DOCKER_HOST: dockerHost },
      };
    }
  }

  if (hasCommand("podman")) {
    return {
      command: "podman",
      args: ["compose", "-f", composeFile, ...extraArgs],
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
  shell: useShell,
});

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
