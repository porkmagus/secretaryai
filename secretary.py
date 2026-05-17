#!/usr/bin/env python3
"""
Secretary AI - Interactive Setup, Launch & Control
==================================================
Cross-platform installer, process manager, and launcher for the
Secretary-First Personal Assistant.

One-liner usage (no flags = interactive menu):
    python3 secretary.py

Flag usage (CI / scripts):
    python3 secretary.py --install       # Install & build only
    python3 secretary.py --start         # Start services in background
    python3 secretary.py --foreground  # Start services in foreground
    python3 secretary.py --stop          # Stop all services + Docker
    python3 secretary.py --status        # Quick health check
    python3 secretary.py --logs          # Tail service-runner log
    python3 secretary.py --help          # Show help

Prerequisites:
    - Python 3.11+     (you have this if you're running this script)
    - Node.js 24.0+    (https://nodejs.org/)
    - npm              (bundled with Node.js)
    - Docker Desktop   (https://www.docker.com/products/docker-desktop/)
    - ffmpeg           (optional, required for voice-note features)

Platform install hints (if prerequisites are missing):
    macOS:   brew install node ffmpeg && brew install --cask docker
    Ubuntu:  sudo apt install nodejs npm ffmpeg docker.io docker-compose-plugin
    Windows: winget install OpenJS.NodeJS Docker.DockerDesktop Gyan.FFmpeg
"""

from __future__ import annotations

import argparse
import os
import sys
import subprocess
import shutil
import time
import socket
import json
import signal
import platform
from pathlib import Path
from typing import List, Optional, Tuple, Dict, Any

# =============================================================================
# Colors and Formatting
# =============================================================================

class Colors:
    HEADER = "\033[95m"
    OKBLUE = "\033[94m"
    OKCYAN = "\033[96m"
    OKGREEN = "\033[92m"
    WARNING = "\033[93m"
    FAIL = "\033[91m"
    BOLD = "\033[1m"
    DIM = "\033[2m"
    RESET = "\033[0m"

    @classmethod
    def disable(cls):
        for attr in dir(cls):
            if not attr.startswith("_") and isinstance(getattr(cls, attr), str):
                setattr(cls, attr, "")

if os.environ.get("NO_COLOR") or not sys.stdout.isatty():
    Colors.disable()

# =============================================================================
# Paths and Configuration
# =============================================================================

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR
ENV_PATH = REPO_ROOT / ".env"
ENV_EXAMPLE_PATH = REPO_ROOT / ".env.example"
RUNTIME_DIR = REPO_ROOT / "runtime"
VENV_DIR = RUNTIME_DIR / "venvs"
STT_VENV = VENV_DIR / "stt"
TTS_VENV = VENV_DIR / "tts"
STT_REQUIREMENTS = REPO_ROOT / "services" / "stt-faster-whisper" / "requirements.txt"
TTS_REQUIREMENTS = REPO_ROOT / "services" / "tts-chatterbox" / "requirements.txt"
DOCKER_COMPOSE_FILE = REPO_ROOT / "docker" / "compose" / "docker-compose.yml"
LOGS_DIR = RUNTIME_DIR / "dev-logs"
STATE_FILE = RUNTIME_DIR / "config" / "secretary-py-state.json"

INFRA_SERVICES = [
    {"name": "Postgres", "port": 5432, "timeout": 60},
    {"name": "Redis", "port": 6379, "timeout": 30},
    {"name": "SearXNG", "port": 8080, "timeout": 60},
    {"name": "Crawl4AI", "port": 11235, "timeout": 120},
]

APP_SERVICES = [
    {"name": "Web", "port": 3000, "health_url": "http://127.0.0.1:3000", "timeout": 60},
    {"name": "Worker", "port": 4000, "health_url": "http://127.0.0.1:4000/health/ready", "timeout": 60},
    {"name": "STT", "port": 5001, "health_url": "http://127.0.0.1:5001/health", "timeout": 120},
    {"name": "TTS", "port": 5002, "health_url": "http://127.0.0.1:5002/health", "timeout": 150},
]

# =============================================================================
# Logging Helpers
# =============================================================================

def log_section(title: str):
    print(f"\n{Colors.BOLD}{Colors.OKCYAN}== {title} =={Colors.RESET}\n")

def log_step(label: str, detail: str = ""):
    if detail:
        print(f"  [{Colors.OKGREEN}{label}{Colors.RESET}] {detail}")
    else:
        print(f"  [{Colors.OKGREEN}{label}{Colors.RESET}]")

def log_warn(label: str, detail: str = ""):
    print(f"  [{Colors.WARNING}{label}{Colors.RESET}] {detail}")

def log_error(label: str, detail: str = ""):
    print(f"  [{Colors.FAIL}{label}{Colors.RESET}] {detail}")

def log_info(detail: str):
    print(f"  {Colors.DIM}{detail}{Colors.RESET}")

def get_python_cmd() -> str:
    if shutil.which("python3"):
        return "python3"
    if shutil.which("python"):
        return "python"
    return Path(sys.executable).name

# =============================================================================
# State / PID Tracking
# =============================================================================

def load_state() -> dict:
    try:
        with open(STATE_FILE) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}

def save_state(data: dict):
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(STATE_FILE, "w") as f:
        json.dump(data, f, indent=2)

def is_pid_alive(pid: int) -> bool:
    if PLATFORM == "windows":
        try:
            _, stdout, _ = run_command(
                ["tasklist", "/FI", f"PID eq {pid}", "/NH"],
                capture=True, timeout=5, check=False
            )
            return str(pid) in stdout
        except Exception:
            return False
    else:
        try:
            os.kill(pid, 0)
            return True
        except (OSError, ProcessLookupError):
            return False

# =============================================================================
# Command Execution
# =============================================================================

def run_command(
    cmd: List[str],
    cwd: Optional[Path] = None,
    env: Optional[Dict[str, str]] = None,
    capture: bool = False,
    timeout: Optional[int] = None,
    check: bool = True,
) -> Tuple[int, str, str]:
    if cwd is None:
        cwd = REPO_ROOT
    merged_env = {**os.environ, **(env or {})}
    if capture:
        result = subprocess.run(cmd, cwd=str(cwd), env=merged_env, capture_output=True, text=True, timeout=timeout)
        stdout: str = result.stdout or ""
        stderr: str = result.stderr or ""
    else:
        result = subprocess.run(cmd, cwd=str(cwd), env=merged_env, timeout=timeout)
        stdout = ""
        stderr = ""
    if check and result.returncode != 0:
        raise subprocess.CalledProcessError(result.returncode, cmd, output=stdout, stderr=stderr)
    return result.returncode, stdout, stderr

def run_command_stream(cmd: List[str], cwd: Optional[Path] = None, env: Optional[Dict[str, str]] = None) -> subprocess.Popen:
    if cwd is None:
        cwd = REPO_ROOT
    merged_env = {**os.environ, **(env or {})}
    return subprocess.Popen(cmd, cwd=str(cwd), env=merged_env, stdout=sys.stdout, stderr=sys.stderr)

# =============================================================================
# Prerequisite Checks
# =============================================================================

def get_platform() -> str:
    system = platform.system().lower()
    if system == "darwin":
        return "macos"
    if system in ("windows", "win32"):
        return "windows"
    return "linux"

PLATFORM = get_platform()

def check_command_exists(command: str, args: Optional[List[str]] = None) -> bool:
    if args is None:
        args = ["--version"]
    try:
        run_command([command] + args, capture=True, timeout=5, check=False)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
        return False

def check_node_version() -> Tuple[bool, str, Optional[str]]:
    if not check_command_exists("node"):
        return False, "", "Node.js is not installed or not on PATH."
    try:
        _, stdout, _ = run_command(["node", "--version"], capture=True, timeout=5)
        version = stdout.strip().lstrip("v")
        major = int(version.split(".")[0])
        if major >= 24:
            return True, version, None
        return False, version, f"Node.js {version} is too old. Version 24.0.0 or higher is required."
    except Exception as e:
        return False, "", f"Failed to check Node.js version: {e}"

def check_npm() -> bool:
    return check_command_exists("npm")

def check_docker_daemon() -> Tuple[bool, str]:
    try:
        run_command(["docker", "info"], capture=True, timeout=5)
        return True, ""
    except subprocess.CalledProcessError:
        return False, "Docker is installed but the daemon is not running. Start Docker Desktop."
    except FileNotFoundError:
        return False, "Docker is not installed or not on PATH."

def check_docker() -> Tuple[bool, str]:
    if not check_command_exists("docker"):
        return False, "Docker is not installed or not on PATH."
    compose_ok = False
    try:
        run_command(["docker", "compose", "version"], capture=True, timeout=5)
        compose_ok = True
    except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
        pass
    if not compose_ok:
        try:
            run_command(["docker-compose", "--version"], capture=True, timeout=5)
            compose_ok = True
        except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
            pass
    if not compose_ok:
        return False, "Docker is installed but 'docker compose' is not available."
    daemon_ok, daemon_err = check_docker_daemon()
    if not daemon_ok:
        return False, daemon_err
    return True, ""

def check_ffmpeg() -> bool:
    return check_command_exists("ffmpeg", ["-version"])

def check_python_version() -> Tuple[bool, str]:
    version = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
    if sys.version_info >= (3, 11):
        return True, version
    return False, version

def print_prerequisite_install_help():
    log_section("How to Install Missing Prerequisites")
    print(f"  Your platform: {Colors.BOLD}{PLATFORM}{Colors.RESET}")
    print()
    print(f"  {Colors.BOLD}Node.js 24+ & npm:{Colors.RESET}")
    if PLATFORM == "macos":
        print("    brew install node")
    elif PLATFORM == "linux":
        print("    sudo apt install nodejs npm")
    elif PLATFORM == "windows":
        print("    winget install OpenJS.NodeJS")
    print()
    print(f"  {Colors.BOLD}Docker Desktop:{Colors.RESET}")
    if PLATFORM == "macos":
        print("    brew install --cask docker")
    elif PLATFORM == "linux":
        print("    sudo apt install docker.io docker-compose-plugin")
    elif PLATFORM == "windows":
        print("    winget install Docker.DockerDesktop")
    print()
    print(f"  {Colors.BOLD}ffmpeg (optional, for voice):{Colors.RESET}")
    if PLATFORM == "macos":
        print("    brew install ffmpeg")
    elif PLATFORM == "linux":
        print("    sudo apt install ffmpeg")
    elif PLATFORM == "windows":
        print("    winget install Gyan.FFmpeg")
    print()
    print(f"  {Colors.BOLD}Python 3.11+:{Colors.RESET}")
    if PLATFORM == "macos":
        print("    brew install python@3.11")
    elif PLATFORM == "linux":
        print("    sudo apt install python3.11 python3.11-venv python3.11-pip")
    elif PLATFORM == "windows":
        print("    winget install Python.Python.3.11")
    print()

def check_all_prerequisites(allow_missing_ffmpeg: bool = True) -> Tuple[bool, List[str]]:
    errors = []
    warnings = []
    py_ok, py_version = check_python_version()
    if py_ok:
        log_step("Python", f"{py_version} OK")
    else:
        errors.append(f"Python {py_version} is too old. Python 3.11+ is required.")
        log_error("Python", f"{py_version} FAIL (need 3.11+)")
    node_ok, node_version, node_err = check_node_version()
    if node_ok:
        log_step("Node.js", f"{node_version} OK")
    else:
        errors.append(node_err)
        log_error("Node.js", f"FAIL: {node_err}")
    if check_npm():
        log_step("npm", "OK")
    else:
        errors.append("npm is not installed or not on PATH.")
        log_error("npm", "FAIL")
    docker_ok, docker_err = check_docker()
    if docker_ok:
        log_step("Docker", "OK")
    else:
        errors.append(docker_err)
        log_error("Docker", f"FAIL: {docker_err}")
    if check_ffmpeg():
        log_step("ffmpeg", "OK")
    else:
        msg = "ffmpeg not found (optional, needed for voice-note features)"
        if allow_missing_ffmpeg:
            warnings.append(msg)
            log_warn("ffmpeg", "MISSING (optional)")
        else:
            errors.append(msg)
            log_error("ffmpeg", "MISSING")
    if warnings:
        for w in warnings:
            log_warn("Warning", w)
    return len(errors) == 0, errors

# =============================================================================
# Setup / Install Functions
# =============================================================================

def ensure_env_file():
    if ENV_PATH.exists():
        log_step(".env", "already exists")
        return
    if not ENV_EXAMPLE_PATH.exists():
        log_error(".env", "cannot create: .env.example is missing")
        raise RuntimeError("Missing .env.example")
    log_step(".env", "creating from .env.example")
    shutil.copy(ENV_EXAMPLE_PATH, ENV_PATH)

def ensure_storage_directories():
    dirs = [
        "runtime/postgres", "runtime/postgres/data",
        "runtime/redis", "runtime/redis/data",
        "runtime/speech", "runtime/speech/inbound", "runtime/speech/models",
        "runtime/speech/transcripts", "runtime/speech/tts", "runtime/speech/profiles",
        "runtime/caddy", "runtime/caddy/data", "runtime/caddy/config",
        "runtime/backups", "runtime/exports",
        "runtime/generated", "runtime/generated/documents",
        "runtime/downloads", "runtime/venvs", "runtime/dev-logs",
    ]
    for d in dirs:
        (REPO_ROOT / d).mkdir(parents=True, exist_ok=True)
    log_step("Storage", f"{len(dirs)} directories ready")

def ensure_node_modules():
    node_modules = REPO_ROOT / "node_modules"
    package_lock = REPO_ROOT / "package-lock.json"
    if node_modules.exists() and package_lock.exists():
        log_step("npm", "node_modules exists (skipping install)")
        return
    log_step("npm", "install (this may take a few minutes)...")
    run_command(["npm", "install"], timeout=300)
    log_step("npm", "install complete")

def build_packages_and_worker():
    worker_dist = REPO_ROOT / "apps" / "worker" / "dist" / "index.js"
    if worker_dist.exists():
        log_step("Build", "worker dist exists (skipping)")
        log_step("Build", "npm run build:packages")
        run_command(["npm", "run", "build:packages"], timeout=120)
        return
    log_step("Build", "npm run build:packages")
    run_command(["npm", "run", "build:packages"], timeout=120)
    log_step("Build", "npm run build --workspace @secretary/worker")
    run_command(["npm", "run", "build", "--workspace", "@secretary/worker"], timeout=120)

def ensure_venv_python(venv_path: Path) -> Path:
    if PLATFORM == "windows":
        python_bin = venv_path / "Scripts" / "python.exe"
    else:
        python_bin = venv_path / "bin" / "python"
    if not python_bin.exists():
        log_step("Venv", f"creating at {venv_path}")
        run_command([sys.executable, "-m", "venv", str(venv_path)], timeout=60)
    return python_bin

def setup_stt_venv():
    python_bin = ensure_venv_python(STT_VENV)
    if not STT_REQUIREMENTS.exists():
        log_warn("STT", "requirements.txt not found, skipping")
        return
    log_step("STT", "upgrading pip")
    run_command([str(python_bin), "-m", "pip", "install", "--upgrade", "pip"], timeout=60)
    log_step("STT", "installing requirements")
    run_command([str(python_bin), "-m", "pip", "install", "-r", str(STT_REQUIREMENTS)], timeout=180)

def setup_tts_venv():
    python_bin = ensure_venv_python(TTS_VENV)
    if not TTS_REQUIREMENTS.exists():
        log_warn("TTS", "requirements.txt not found, skipping")
        return
    log_step("TTS", "upgrading pip")
    run_command([str(python_bin), "-m", "pip", "install", "--upgrade", "pip"], timeout=60)
    log_step("TTS", "installing requirements")
    run_command([str(python_bin), "-m", "pip", "install", "-r", str(TTS_REQUIREMENTS)], timeout=180)

def docker_compose_cmd() -> List[str]:
    try:
        run_command(["docker", "compose", "version"], capture=True, timeout=5)
        return ["docker", "compose", "-f", str(DOCKER_COMPOSE_FILE)]
    except (subprocess.CalledProcessError, FileNotFoundError):
        pass
    try:
        run_command(["docker-compose", "--version"], capture=True, timeout=5)
        return ["docker-compose", "-f", str(DOCKER_COMPOSE_FILE)]
    except (subprocess.CalledProcessError, FileNotFoundError):
        pass
    raise RuntimeError("No docker compose command found")

def ensure_docker_stack():
    cmd = docker_compose_cmd()
    log_step("Docker", "starting infrastructure stack...")
    try:
        run_command(cmd + ["up", "-d"], timeout=120)
    except subprocess.CalledProcessError:
        log_warn("Docker", "first up failed, cleaning residue and retrying...")
        run_command(cmd + ["down"], timeout=60, check=False)
        run_command(cmd + ["up", "-d"], timeout=120)

def wait_for_port(host: str, port: int, timeout_sec: int = 60) -> bool:
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        try:
            with socket.create_connection((host, port), timeout=1):
                return True
        except (socket.timeout, ConnectionRefusedError, OSError):
            time.sleep(1)
    return False

def wait_for_health(url: str, timeout_sec: int = 30, retries: int = 3) -> bool:
    import urllib.request
    deadline = time.time() + timeout_sec
    attempt = 0
    while time.time() < deadline and attempt < retries:
        try:
            req = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(req, timeout=2) as resp:
                if resp.status in (200, 204, 404):
                    return True
        except Exception:
            pass
        attempt += 1
        time.sleep(1)
    return False

def wait_for_infrastructure():
    log_section("Waiting for Infrastructure")
    all_ready = True
    for svc in INFRA_SERVICES:
        log_step("Wait", f"{svc['name']} on port {svc['port']}...")
        ready = wait_for_port("127.0.0.1", svc["port"], svc["timeout"])
        if ready:
            log_step("Ready", svc["name"])
        else:
            log_error("Timeout", svc["name"])
            all_ready = False
    if not all_ready:
        raise RuntimeError("Infrastructure services did not become ready in time.")

def run_db_migrations(retries: int = 5, delay: int = 5):
    log_step("DB", "running migrations...")
    for attempt in range(1, retries + 1):
        try:
            run_command(["npm", "run", "db:migrate"], timeout=60)
            log_step("DB", "migrations applied")
            return
        except subprocess.CalledProcessError as e:
            if attempt == retries:
                raise RuntimeError(f"DB migrations failed after {retries} attempts: {e}")
            log_warn("DB", f"attempt {attempt} failed, retrying in {delay}s...")
            time.sleep(delay)

# =============================================================================
# Start / Stop / Status
# =============================================================================

def start_infrastructure():
    ensure_docker_stack()
    wait_for_infrastructure()

def start_app_services(foreground: bool = False):
    runner = REPO_ROOT / "scripts" / "setup" / "service-runner.mjs"
    if not runner.exists():
        log_error("Start", "service-runner.mjs not found")
        raise RuntimeError("Missing service-runner.mjs")

    if foreground:
        log_section("Starting App Services")
        log_info("Delegating to service-runner.mjs (Press Ctrl+C to stop)")
        log_info("Services: Web (3000), Worker (4000), STT (5001), TTS (5002)")
        print()
        proc = run_command_stream(["node", str(runner)])
        try:
            proc.wait()
        except KeyboardInterrupt:
            log_section("Shutdown signal received")
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
            stop_infrastructure()
            sys.exit(0)
        return

    state = load_state()
    existing_pid = state.get("service_runner_pid")
    if existing_pid and is_pid_alive(existing_pid):
        log_warn("Start", f"Service runner already running (PID {existing_pid})")
        log_info(f"Logs: {LOGS_DIR / 'service-runner.log'}")
        log_info(f"Stop with: {get_python_cmd()} secretary.py --stop")
        return

    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    log_path = LOGS_DIR / "service-runner.log"

    log_section("Starting App Services")
    log_step("Launch", f"Service runner -> {log_path}")

    with open(log_path, "a") as log_file:
        log_file.write(f"\n=== Service runner started at {time.strftime('%c')} ===\n")
        log_file.flush()
        popen_kwargs: Dict[str, Any] = {
            "stdout": log_file,
            "stderr": subprocess.STDOUT,
            "stdin": subprocess.DEVNULL,
        }
        if PLATFORM == "windows":
            popen_kwargs["creationflags"] = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        else:
            popen_kwargs["start_new_session"] = True
        proc = subprocess.Popen(["node", str(runner)], cwd=str(REPO_ROOT), **popen_kwargs)

    save_state({
        "service_runner_pid": proc.pid,
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
    })

    log_step("PID", str(proc.pid))
    log_info(f"Logs: {log_path}")
    log_info(f"Stop with: {get_python_cmd()} secretary.py --stop")

def stop_infrastructure():
    try:
        cmd = docker_compose_cmd()
        log_step("Docker", "stopping infrastructure...")
        run_command(cmd + ["down"], timeout=60, check=False)
    except Exception as e:
        log_warn("Docker", f"stop issue: {e}")

def stop_app_services():
    log_section("Stopping App Services")
    for svc in APP_SERVICES:
        port = svc["port"]
        if PLATFORM == "windows":
            ps_cmd = (
                f"Get-NetTCPConnection -LocalPort {port} -State Listen -ErrorAction SilentlyContinue | "
                f"ForEach-Object {{ Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }}"
            )
            run_command(["powershell", "-NoProfile", "-Command", ps_cmd], timeout=10, check=False)
        elif PLATFORM in ("macos", "linux"):
            try:
                _, stdout, _ = run_command(["lsof", "-ti", f":{port}"], capture=True, timeout=5, check=False)
                pids = [p for p in stdout.strip().split("\n") if p.strip().isdigit()]
                for pid in pids:
                    run_command(["kill", "-9", pid], timeout=5, check=False)
            except Exception:
                pass
        else:
            pass
        log_step("Stop", f"{svc['name']} (port {port})")

    if PLATFORM in ("macos", "linux"):
        patterns = ["next dev", "apps/worker/dist/index.js", "run-stt.mjs", "run-tts.mjs"]
        for pat in patterns:
            try:
                _, stdout, _ = run_command(["pgrep", "-f", pat], capture=True, timeout=5, check=False)
                pids = [p for p in stdout.strip().split("\n") if p.strip().isdigit()]
                for pid in pids:
                    run_command(["kill", "-9", pid], timeout=5, check=False)
            except Exception:
                pass

def stop_all():
    state = load_state()
    pid = state.get("service_runner_pid")
    if pid and is_pid_alive(pid):
        log_step("Stop", f"Service runner (PID {pid})")
        if PLATFORM == "windows":
            run_command(["taskkill", "/PID", str(pid), "/T", "/F"], timeout=10, check=False)
        else:
            try:
                os.kill(pid, signal.SIGTERM)
            except Exception:
                pass
            for _ in range(10):
                if not is_pid_alive(pid):
                    break
                time.sleep(0.5)
            if is_pid_alive(pid):
                log_warn("Stop", "Force killing service runner")
                try:
                    os.kill(pid, signal.SIGKILL)
                except Exception:
                    pass
                time.sleep(0.5)
    stop_app_services()
    stop_infrastructure()
    if STATE_FILE.exists():
        STATE_FILE.unlink()
    log_step("Stop", "complete")

def show_status():
    log_section("Secretary Status")
    log_step("Repo", str(REPO_ROOT))
    log_step(".env", "present" if ENV_PATH.exists() else "missing")
    _, node_version, _ = check_node_version()
    log_step("Node.js", node_version or "missing")
    log_step("npm", "OK" if check_npm() else "missing")
    docker_ok, _ = check_docker()
    log_step("Docker", "OK" if docker_ok else "missing")
    log_step("ffmpeg", "OK" if check_ffmpeg() else "missing")

    state = load_state()
    runner_pid = state.get("service_runner_pid")
    if runner_pid:
        alive = is_pid_alive(runner_pid)
        status = f"PID {runner_pid} ({Colors.OKGREEN}running{Colors.RESET})" if alive else f"PID {runner_pid} ({Colors.DIM}dead{Colors.RESET})"
        log_step("Service runner", status)
    else:
        log_step("Service runner", "not started")

    print()
    log_section("Infrastructure Ports")
    for svc in INFRA_SERVICES:
        open_port = wait_for_port("127.0.0.1", svc["port"], timeout_sec=1)
        status = f"{Colors.OKGREEN}listening{Colors.RESET}" if open_port else f"{Colors.DIM}down{Colors.RESET}"
        print(f"  {svc['name']:12} port {svc['port']} -> {status}")

    print()
    log_section("App Service Ports")
    for svc in APP_SERVICES:
        open_port = wait_for_port("127.0.0.1", svc["port"], timeout_sec=1)
        health = ""
        if open_port and svc.get("health_url"):
            healthy = wait_for_health(svc["health_url"], timeout_sec=2, retries=1)
            health = f" ({Colors.OKGREEN}healthy{Colors.RESET})" if healthy else f" ({Colors.WARNING}unhealthy{Colors.RESET})"
        status = f"{Colors.OKGREEN}listening{Colors.RESET}" if open_port else f"{Colors.DIM}down{Colors.RESET}"
        print(f"  {svc['name']:12} port {svc['port']} -> {status}{health}")
    print()

def tail_logs():
    log_path = LOGS_DIR / "service-runner.log"
    if not log_path.exists():
        log_error("Logs", f"No log file found at {log_path}")
        return
    log_step("Logs", f"Tailing {log_path}")
    if PLATFORM == "windows":
        run_command(["powershell", "-NoProfile", "-Command", f"Get-Content -Path '{log_path}' -Wait -Tail 30"], check=False)
    else:
        run_command(["tail", "-f", "-n", "30", str(log_path)], check=False)

# =============================================================================
# Main Install Flow
# =============================================================================

def run_install(skip_if_exists: bool = False):
    log_section("Prerequisites")
    ok, errors = check_all_prerequisites(allow_missing_ffmpeg=True)
    if not ok:
        log_section("Missing Prerequisites")
        for err in errors:
            log_error("Missing", err)
        print()
        print_prerequisite_install_help()
        sys.exit(1)

    log_section("Install")
    ensure_env_file()
    ensure_storage_directories()
    ensure_node_modules()
    build_packages_and_worker()
    setup_stt_venv()
    setup_tts_venv()
    log_section("Install Complete")

# =============================================================================
# Interactive Menu
# =============================================================================

def show_menu():
    state = load_state()
    runner_pid = state.get("service_runner_pid")
    runner_alive = runner_pid and is_pid_alive(runner_pid)

    print()
    print(f"{Colors.BOLD}{Colors.OKCYAN}  ╔══════════════════════════════════════════════════════╗{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.OKCYAN}  ║        Secretary AI - Control Panel                 ║{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.OKCYAN}  ╠══════════════════════════════════════════════════════╣{Colors.RESET}")

    status_line = f"{Colors.OKGREEN}● Running (PID {runner_pid}){Colors.RESET}" if runner_alive else f"{Colors.DIM}○ Stopped{Colors.RESET}"
    print(f"{Colors.BOLD}{Colors.OKCYAN}  ║{Colors.RESET}  Status: {status_line:<36}{Colors.BOLD}{Colors.OKCYAN}║{Colors.RESET}")

    print(f"{Colors.BOLD}{Colors.OKCYAN}  ╠══════════════════════════════════════════════════════╣{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.OKCYAN}  ║{Colors.RESET}  [1]  Install & Build (deps, venvs, compile)          {Colors.BOLD}{Colors.OKCYAN}║{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.OKCYAN}  ║{Colors.RESET}  [2]  Start All  (background)                         {Colors.BOLD}{Colors.OKCYAN}║{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.OKCYAN}  ║{Colors.RESET}  [3]  Start All  (foreground / live logs)             {Colors.BOLD}{Colors.OKCYAN}║{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.OKCYAN}  ║{Colors.RESET}  [4]  Stop All    (kill processes, docker down)       {Colors.BOLD}{Colors.OKCYAN}║{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.OKCYAN}  ║{Colors.RESET}  [5]  Status      (health check all ports)             {Colors.BOLD}{Colors.OKCYAN}║{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.OKCYAN}  ║{Colors.RESET}  [6]  Logs        (tail service-runner output)        {Colors.BOLD}{Colors.OKCYAN}║{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.OKCYAN}  ║{Colors.RESET}  [7]  Full Reset  (stop + wipe runtime state)         {Colors.BOLD}{Colors.OKCYAN}║{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.OKCYAN}  ║{Colors.RESET}  [0]  Exit                                            {Colors.BOLD}{Colors.OKCYAN}║{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.OKCYAN}  ╚══════════════════════════════════════════════════════╝{Colors.RESET}")
    print()

def menu_loop():
    while True:
        show_menu()
        try:
            choice = input(f"  {Colors.BOLD}Select [0-7]:{Colors.RESET} ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break

        if choice == "0" or choice.lower() in ("q", "quit", "exit"):
            print(f"\n  {Colors.DIM}Goodbye.{Colors.RESET}\n")
            break
        elif choice == "1":
            try:
                run_install()
            except Exception as e:
                log_error("Install failed", str(e))
        elif choice == "2":
            try:
                start_infrastructure()
                run_db_migrations()
                start_app_services(foreground=False)
            except Exception as e:
                log_error("Start failed", str(e))
        elif choice == "3":
            try:
                start_infrastructure()
                run_db_migrations()
                start_app_services(foreground=True)
            except Exception as e:
                log_error("Start failed", str(e))
        elif choice == "4":
            try:
                stop_all()
            except Exception as e:
                log_error("Stop failed", str(e))
        elif choice == "5":
            show_status()
        elif choice == "6":
            try:
                tail_logs()
            except Exception as e:
                log_error("Logs failed", str(e))
        elif choice == "7":
            try:
                stop_all()
                if RUNTIME_DIR.exists():
                    log_step("Reset", "wiping runtime state files")
                    for f in [STATE_FILE]:
                        if f.exists():
                            f.unlink()
                log_step("Reset", "complete")
            except Exception as e:
                log_error("Reset failed", str(e))
        else:
            log_warn("Invalid", f"'{choice}' is not a valid option")

        input(f"\n  {Colors.DIM}Press Enter to return to menu...{Colors.RESET}")
        print()

# =============================================================================
# CLI
# =============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="Secretary AI - Interactive Setup and Launch",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=f"""
Examples:
  {get_python_cmd()} secretary.py                  # Interactive menu
  {get_python_cmd()} secretary.py --install        # Install & build only
  {get_python_cmd()} secretary.py --start          # Start services in background
  {get_python_cmd()} secretary.py --foreground   # Start services in foreground
  {get_python_cmd()} secretary.py --stop           # Stop all services
  {get_python_cmd()} secretary.py --status         # Check status
  {get_python_cmd()} secretary.py --logs           # Tail service-runner log
        """,
    )
    parser.add_argument("--install", action="store_true", help="Install dependencies and build only")
    parser.add_argument("--start", action="store_true", help="Start services in background")
    parser.add_argument("--foreground", action="store_true", help="Start services in foreground (blocks terminal)")
    parser.add_argument("--stop", action="store_true", help="Stop all services and Docker stack")
    parser.add_argument("--status", action="store_true", help="Show status of dependencies and services")
    parser.add_argument("--logs", action="store_true", help="Tail service-runner log")
    parser.add_argument("--no-color", action="store_true", help="Disable colored output")
    parser.add_argument("--menu", action="store_true", help="Force interactive menu even with other args")

    args = parser.parse_args()

    if args.no_color:
        Colors.disable()

    package_json = REPO_ROOT / "package.json"
    if not package_json.exists():
        log_error("Error", "package.json not found. Run this script from the repo root.")
        sys.exit(1)
    try:
        with open(package_json) as f:
            data = json.load(f)
        if data.get("name") != "secretary-first-assistant":
            log_warn("Warning", f"Unexpected package name: {data.get('name')}")
    except Exception:
        pass

    # Determine if we should show the menu or run flags
    has_flags = any([args.install, args.start, args.foreground, args.stop, args.status, args.logs])
    use_menu = args.menu or (not has_flags and sys.stdin.isatty() and sys.stdout.isatty())

    if use_menu:
        menu_loop()
        return

    if args.status:
        show_status()
        return
    if args.stop:
        stop_all()
        return
    if args.logs:
        tail_logs()
        return
    if args.install:
        run_install()
        return
    if args.foreground:
        start_infrastructure()
        run_db_migrations()
        start_app_services(foreground=True)
        return
    if args.start:
        start_infrastructure()
        run_db_migrations()
        start_app_services(foreground=False)
        return

    # Default: install + start (background)
    run_install()
    start_infrastructure()
    run_db_migrations()
    start_app_services(foreground=False)

if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as e:
        log_section("Fatal Error")
        log_error("Command failed", f"{' '.join(str(x) for x in e.cmd)}")
        if e.stderr:
            log_error("stderr", e.stderr.strip()[:500])
        log_info("Fix the issue above and re-run the script.")
        sys.exit(1)
    except KeyboardInterrupt:
        log_section("Interrupted")
        log_info("Shutdown initiated.")
        sys.exit(130)
    except RuntimeError as e:
        log_section("Fatal Error")
        log_error("Runtime error", str(e))
        log_info("Fix the issue above and re-run the script.")
        sys.exit(1)
