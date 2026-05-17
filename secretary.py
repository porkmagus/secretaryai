#!/usr/bin/env python3
"""
Secretary AI - Interactive Setup, Launch & Control
====================================================
Cross-platform installer, process manager, and launcher for the
Secretary-First Personal Assistant.

One-liner usage (no flags = interactive menu):
    python3 secretary.py

Flag usage (CI / scripts):
    python3 secretary.py --install       # Install & build only
    python3 secretary.py --start          # Start services in background
    python3 secretary.py --foreground     # Start services in foreground
    python3 secretary.py --stop           # Stop all services + Docker
    python3 secretary.py --status         # Quick health check
    python3 secretary.py --logs           # Tail service-runner log

This script delegates to the existing npm/Node.js infrastructure where
possible (storage:prepare, stack:up, db:migrate, build:packages, stt:setup,
tts:setup, service-runner) and only reimplements what's needed for a
cross-platform Python entrypoint.
"""

from __future__ import annotations

import argparse
import atexit
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.error import HTTPError, URLError

# =============================================================================
# Colors
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
    def disable(cls) -> None:
        for attr in dir(cls):
            if not attr.startswith("_") and isinstance(getattr(cls, attr), str):
                setattr(cls, attr, "")

if os.environ.get("NO_COLOR") or not sys.stdout.isatty():
    Colors.disable()


def log_section(title: str) -> None:
    print(f"\n{Colors.BOLD}{Colors.OKCYAN}== {title} =={Colors.RESET}\n")


def log_step(label: str, detail: str = "") -> None:
    if detail:
        print(f"  [{Colors.OKGREEN}{label}{Colors.RESET}] {detail}")
    else:
        print(f"  [{Colors.OKGREEN}{label}{Colors.RESET}]")


def log_warn(label: str, detail: str = "") -> None:
    print(f"  [{Colors.WARNING}{label}{Colors.RESET}] {detail}")


def log_error(label: str, detail: str = "") -> None:
    print(f"  [{Colors.FAIL}{label}{Colors.RESET}] {detail}")


def log_info(detail: str) -> None:
    print(f"  {Colors.DIM}{detail}{Colors.RESET}")


# =============================================================================
# Paths
# =============================================================================

REPO_ROOT = Path(__file__).resolve().parent
ENV_PATH = REPO_ROOT / ".env"
ENV_EXAMPLE_PATH = REPO_ROOT / ".env.example"
RUNTIME_DIR = REPO_ROOT / "runtime"
CONFIG_DIR = RUNTIME_DIR / "config"
LOGS_DIR = RUNTIME_DIR / "dev-logs"
STATE_FILE = CONFIG_DIR / "secretary-py-state.json"

PACKAGE_LOCK_PATH = REPO_ROOT / "package-lock.json"
NODE_MODULES_PATH = REPO_ROOT / "node_modules"
WORKER_SOURCE_ROOT = REPO_ROOT / "apps" / "worker" / "src"
WORKER_DIST_PATH = REPO_ROOT / "apps" / "worker" / "dist" / "index.js"
WORKER_PACKAGE_PATH = REPO_ROOT / "apps" / "worker" / "package.json"
WORKER_TSCONFIG_PATH = REPO_ROOT / "apps" / "worker" / "tsconfig.json"

STT_REQUIREMENTS = REPO_ROOT / "services" / "stt-faster-whisper" / "requirements.txt"
TTS_REQUIREMENTS = REPO_ROOT / "services" / "tts-chatterbox" / "requirements.txt"
STT_VENV = RUNTIME_DIR / "venvs" / "stt"
TTS_VENV = RUNTIME_DIR / "venvs" / "tts"

SERVICE_RUNNER = REPO_ROOT / "scripts" / "setup" / "service-runner.mjs"

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
# Process Tracking (zombie reaping)
# =============================================================================

_runner_proc: Optional[subprocess.Popen] = None


def _reap_runner() -> None:
    """Non-blocking poll to reap a dead service-runner and avoid zombies."""
    global _runner_proc
    if _runner_proc is not None:
        _runner_proc.poll()


atexit.register(_reap_runner)


# =============================================================================
# Atomic State Management
# =============================================================================

def _default_state() -> dict:
    return {"bootstrap": {}, "processes": {}, "lastStartedAt": None}


def load_state() -> dict:
    if not STATE_FILE.exists():
        return _default_state()
    try:
        with open(STATE_FILE, "r") as f:
            data = json.load(f)
            if not isinstance(data, dict):
                return _default_state()
            return data
    except (FileNotFoundError, json.JSONDecodeError, IsADirectoryError, PermissionError):
        return _default_state()


def save_state(data: dict) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE_FILE.with_suffix(".tmp")
    try:
        with open(tmp, "w") as f:
            json.dump(data, f, indent=2)
            f.write("\n")
            f.flush()
            os.fsync(f.fileno())
        tmp.replace(STATE_FILE)
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except (OSError, PermissionError):
                pass


def is_pid_alive(pid: int) -> bool:
    if not isinstance(pid, int) or pid <= 0:
        return False
    # Reap our own tracked runner first to avoid zombie false-positives.
    global _runner_proc
    if _runner_proc is not None and _runner_proc.pid == pid:
        if _runner_proc.poll() is not None:
            return False
    if sys.platform == "win32":
        try:
            result = subprocess.run(
                ["tasklist", "/FI", f"PID eq {pid}", "/NH"],
                capture_output=True, text=True, timeout=5
            )
            return str(pid) in result.stdout
        except (subprocess.TimeoutExpired, OSError):
            return False
    else:
        try:
            os.kill(pid, 0)
            return True
        except PermissionError:
            return True
        except (OSError, ProcessLookupError):
            return False


# =============================================================================
# Command Execution
# =============================================================================

def run(
    cmd: List[str],
    *,
    cwd: Optional[Path] = None,
    capture: bool = False,
    timeout: Optional[int] = None,
    check: bool = True,
    env: Optional[Dict[str, str]] = None,
) -> Tuple[int, str, str]:
    if cwd is None:
        cwd = REPO_ROOT
    merged_env = {**os.environ, **(env or {})}
    if capture:
        result = subprocess.run(
            cmd, cwd=str(cwd), env=merged_env, capture_output=True, text=True, timeout=timeout
        )
        stdout = result.stdout or ""
        stderr = result.stderr or ""
    else:
        result = subprocess.run(cmd, cwd=str(cwd), env=merged_env, timeout=timeout)
        stdout = ""
        stderr = ""
    if check and result.returncode != 0:
        raise subprocess.CalledProcessError(result.returncode, cmd, output=stdout, stderr=stderr)
    return result.returncode, stdout, stderr


def run_stream(
    cmd: List[str], cwd: Optional[Path] = None, env: Optional[Dict[str, str]] = None
) -> subprocess.Popen:
    if cwd is None:
        cwd = REPO_ROOT
    merged_env = {**os.environ, **(env or {})}
    return subprocess.Popen(cmd, cwd=str(cwd), env=merged_env, stdout=sys.stdout, stderr=sys.stderr)


def npm(
    args: List[str], capture: bool = False, timeout: Optional[int] = None, check: bool = True
):
    npm_cmd = "npm.cmd" if sys.platform == "win32" else "npm"
    return run([npm_cmd] + args, capture=capture, timeout=timeout, check=check)


# =============================================================================
# Prerequisite Checks
# =============================================================================

def check_cmd(command: str, args: Optional[List[str]] = None) -> bool:
    if args is None:
        args = ["--version"]
    try:
        run([command] + args, capture=True, timeout=5, check=False)
        return True
    except (subprocess.TimeoutExpired, OSError, FileNotFoundError):
        return False


def check_prerequisites() -> Tuple[bool, List[str]]:
    errors: List[str] = []

    py_version = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
    if sys.version_info >= (3, 11):
        log_step("Python", f"{py_version} OK")
    else:
        errors.append(f"Python {py_version} is too old. Python 3.11+ is required.")
        log_error("Python", f"{py_version} FAIL (need 3.11+)")

    if check_cmd("node"):
        _, out, _ = run(["node", "--version"], capture=True, timeout=5)
        node_version = out.strip().lstrip("v")
        try:
            major = int(node_version.split(".")[0])
            if major >= 24:
                log_step("Node.js", f"{node_version} OK")
            else:
                errors.append(f"Node.js {node_version} is too old. Need 24+.")
                log_error("Node.js", f"{node_version} FAIL (need 24+)")
        except ValueError:
            log_step("Node.js", f"{node_version} (version parse failed)")
    else:
        errors.append("Node.js is not installed or not on PATH.")
        log_error("Node.js", "FAIL")

    if check_cmd("npm"):
        log_step("npm", "OK")
    else:
        errors.append("npm is not installed or not on PATH.")
        log_error("npm", "FAIL")

    docker_ok = False
    if check_cmd("docker"):
        try:
            run(["docker", "info"], capture=True, timeout=5)
            try:
                run(["docker", "compose", "version"], capture=True, timeout=5)
                docker_ok = True
            except (subprocess.TimeoutExpired, OSError, subprocess.CalledProcessError):
                try:
                    run(["docker-compose", "--version"], capture=True, timeout=5)
                    docker_ok = True
                except (subprocess.TimeoutExpired, OSError, subprocess.CalledProcessError):
                    errors.append("Docker is installed but 'docker compose' is not available.")
                    log_error("Docker", "FAIL (no compose)")
        except (subprocess.TimeoutExpired, OSError, subprocess.CalledProcessError):
            errors.append("Docker daemon is not running. Start Docker Desktop.")
            log_error("Docker", "FAIL (daemon not running)")
    else:
        errors.append("Docker is not installed or not on PATH.")
        log_error("Docker", "FAIL")

    if docker_ok:
        log_step("Docker", "OK")

    if check_cmd("ffmpeg", ["-version"]):
        log_step("ffmpeg", "OK")
    else:
        log_warn("ffmpeg", "MISSING (optional, needed for voice-note features)")

    return len(errors) == 0, errors


def print_install_help() -> None:
    log_section("How to Install Missing Prerequisites")
    plat = "macOS" if sys.platform == "darwin" else "Windows" if sys.platform == "win32" else "Linux"
    print(f"  Your platform: {Colors.BOLD}{plat}{Colors.RESET}")
    print()
    print(f"  {Colors.BOLD}Node.js 24+ & npm:{Colors.RESET}")
    if sys.platform == "darwin":
        print("    brew install node")
    elif sys.platform == "win32":
        print("    winget install OpenJS.NodeJS")
    else:
        print("    sudo apt install nodejs npm")
    print()
    print(f"  {Colors.BOLD}Docker Desktop:{Colors.RESET}")
    if sys.platform == "darwin":
        print("    brew install --cask docker")
    elif sys.platform == "win32":
        print("    winget install Docker.DockerDesktop")
    else:
        print("    sudo apt install docker.io docker-compose-plugin")
    print()
    print(f"  {Colors.BOLD}ffmpeg (optional):{Colors.RESET}")
    if sys.platform == "darwin":
        print("    brew install ffmpeg")
    elif sys.platform == "win32":
        print("    winget install Gyan.FFmpeg")
    else:
        print("    sudo apt install ffmpeg")
    print()


# =============================================================================
# Bootstrap Helpers
# =============================================================================

def ensure_env_file() -> None:
    if ENV_PATH.exists():
        if ENV_PATH.is_dir():
            raise RuntimeError(f".env exists but is a directory: {ENV_PATH}")
        log_step(".env", "present")
        return
    if not ENV_EXAMPLE_PATH.exists():
        raise RuntimeError("Missing .env.example; cannot create .env automatically.")
    log_step(".env", "creating from .env.example")
    shutil.copy(ENV_EXAMPLE_PATH, ENV_PATH)


def _get_latest_mtime(path: Path) -> float:
    """Return the latest mtime of a file or any file under a directory tree."""
    if not path.exists():
        raise FileNotFoundError(path)
    if path.is_file():
        return path.stat().st_mtime
    if path.is_dir():
        latest = 0.0
        for root, _dirs, files in os.walk(path):
            for name in files:
                try:
                    fp = os.path.join(root, name)
                    m = os.stat(fp).st_mtime
                    if m > latest:
                        latest = m
                except (OSError, FileNotFoundError):
                    continue
        if latest > 0:
            return latest
        return path.stat().st_mtime
    return 0.0


def ensure_node_modules(state: dict) -> dict:
    if not PACKAGE_LOCK_PATH.exists():
        log_step("Dependencies", "npm install")
        npm(["install"], timeout=300)
        return {**state, "bootstrap": {**state.get("bootstrap", {}), "packageLockMtimeMs": 0}}

    lock_mtime = PACKAGE_LOCK_PATH.stat().st_mtime
    needs = (
        not NODE_MODULES_PATH.exists()
        or state.get("bootstrap", {}).get("packageLockMtimeMs") != lock_mtime
    )
    if not needs:
        log_step("Dependencies", "already installed")
        return state

    log_step("Dependencies", "npm install")
    npm(["install"], timeout=300)
    return {**state, "bootstrap": {**state.get("bootstrap", {}), "packageLockMtimeMs": lock_mtime}}


def ensure_worker_build(state: dict) -> dict:
    source_mtime = max(
        _get_latest_mtime(WORKER_SOURCE_ROOT),
        WORKER_PACKAGE_PATH.stat().st_mtime,
        WORKER_TSCONFIG_PATH.stat().st_mtime,
    )
    dist_exists = WORKER_DIST_PATH.exists()
    needs = not dist_exists or state.get("bootstrap", {}).get("workerSourceMtimeMs") != source_mtime

    if not needs:
        log_step("Worker build", "ready")
        return {**state, "bootstrap": {**state.get("bootstrap", {}), "workerSourceMtimeMs": source_mtime}}

    log_step("Packages build", "npm run build:packages")
    npm(["run", "build:packages"], timeout=120)
    log_step("Worker build", "npm run build --workspace @secretary/worker")
    npm(["run", "build", "--workspace", "@secretary/worker"], timeout=120)
    return {**state, "bootstrap": {**state.get("bootstrap", {}), "workerSourceMtimeMs": source_mtime}}


def ensure_speech_setup(state: dict) -> dict:
    stt_req_mtime = STT_REQUIREMENTS.stat().st_mtime
    tts_req_mtime = TTS_REQUIREMENTS.stat().st_mtime
    bootstrap = state.get("bootstrap", {})

    stt_ready = STT_VENV.exists() and bootstrap.get("sttRequirementsMtimeMs") == stt_req_mtime
    tts_ready = TTS_VENV.exists() and bootstrap.get("ttsRequirementsMtimeMs") == tts_req_mtime

    if stt_ready:
        log_step("STT setup", "ready")
    else:
        log_step("STT setup", "npm run stt:setup")
        npm(["run", "stt:setup"], timeout=300)
        bootstrap = {**bootstrap, "sttRequirementsMtimeMs": stt_req_mtime}

    if tts_ready:
        log_step("TTS setup", "ready")
    else:
        log_step("TTS setup", "npm run tts:setup")
        npm(["run", "tts:setup"], timeout=300)
        bootstrap = {**bootstrap, "ttsRequirementsMtimeMs": tts_req_mtime}

    return {**state, "bootstrap": bootstrap}


def ensure_docker_stack() -> None:
    log_step("Docker stack", "npm run stack:up")
    try:
        npm(["run", "stack:up"], timeout=120)
    except subprocess.CalledProcessError:
        log_warn("Docker", "first up failed, cleaning residue and retrying...")
        npm(["run", "stack:down"], timeout=60, check=False)
        npm(["run", "stack:up"], timeout=120)


def wait_for_port(host: str, port: int, timeout_sec: int = 60) -> bool:
    deadline = time.time() + max(0, timeout_sec)
    while True:
        try:
            conn = socket.create_connection((host, port), timeout=1)
            conn.close()
            return True
        except (socket.timeout, ConnectionRefusedError, OSError):
            if time.time() >= deadline:
                return False
            time.sleep(1)


def wait_for_health(url: str, timeout_sec: int = 30, retries: int = 3) -> bool:
    import urllib.request

    deadline = time.time() + max(0, timeout_sec)
    attempt = 0
    while time.time() < deadline and attempt < retries:
        try:
            req = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(req, timeout=2) as resp:
                if resp.status in (200, 204, 404):
                    return True
        except HTTPError as e:
            if e.code in (200, 204, 404):
                return True
        except (URLError, socket.timeout, OSError, ValueError):
            pass
        attempt += 1
        time.sleep(1)
    return False


def wait_for_infrastructure() -> None:
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


def run_db_migrations(retries: int = 5, delay: int = 5) -> None:
    if not isinstance(retries, int) or retries <= 0:
        raise RuntimeError("run_db_migrations called with invalid retries (must be > 0)")
    log_step("DB", "running migrations...")
    for attempt in range(1, retries + 1):
        try:
            npm(["run", "db:migrate"], timeout=60)
            log_step("DB", "migrations applied")
            return
        except subprocess.CalledProcessError as e:
            if attempt == retries:
                raise RuntimeError(f"DB migrations failed after {retries} attempts: {e}")
            log_warn("DB", f"attempt {attempt} failed, retrying in {delay}s...")
            time.sleep(delay)


# =============================================================================
# Install Flow
# =============================================================================

def run_install() -> None:
    log_section("Prerequisites")
    ok, errors = check_prerequisites()
    if not ok:
        log_section("Missing Prerequisites")
        for err in errors:
            log_error("Missing", err)
        print()
        print_install_help()
        sys.exit(1)

    log_section("Install")
    ensure_env_file()
    log_step("Storage", "npm run storage:prepare")
    npm(["run", "storage:prepare"], timeout=30)

    state = load_state()
    state = ensure_node_modules(state)
    ensure_docker_stack()
    wait_for_infrastructure()
    run_db_migrations()
    state = ensure_worker_build(state)
    state = ensure_speech_setup(state)
    save_state(state)
    log_section("Install Complete")
    log_step("Next step", "Run: python3 secretary.py --start")


# =============================================================================
# Start / Stop
# =============================================================================

def _do_start(foreground: bool = False) -> None:
    """Shared start sequence used by CLI and menu."""
    start_infrastructure()
    run_db_migrations()
    start_app_services(foreground=foreground)


def start_infrastructure() -> None:
    ensure_docker_stack()
    wait_for_infrastructure()


def start_app_services(foreground: bool = False) -> None:
    global _runner_proc
    if not SERVICE_RUNNER.exists():
        raise RuntimeError("Missing service-runner.mjs")

    if foreground:
        log_section("Starting App Services")
        log_info("Delegating to service-runner.mjs (Press Ctrl+C to stop)")
        print()
        proc = run_stream(["node", str(SERVICE_RUNNER)])
        try:
            proc.wait()
        except KeyboardInterrupt:
            log_section("Shutdown signal received")
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=2)
            stop_infrastructure()
            sys.exit(0)
        return

    state = load_state()
    existing_pid = state.get("service_runner_pid")
    if existing_pid and is_pid_alive(existing_pid):
        log_warn("Start", f"Service runner already running (PID {existing_pid})")
        log_info(f"Logs: {LOGS_DIR / 'service-runner.log'}")
        log_info("Stop with: python3 secretary.py --stop")
        return

    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    log_path = LOGS_DIR / "service-runner.log"

    log_section("Starting App Services")
    log_step("Launch", f"Service runner -> {log_path}")

    with open(log_path, "a") as log_file:
        log_file.write(f"\n=== Service runner started at {time.strftime('%c')} ===\n")
        log_file.flush()
        kwargs: Dict[str, Any] = {
            "stdout": log_file,
            "stderr": subprocess.STDOUT,
            "stdin": subprocess.DEVNULL,
        }
        if sys.platform == "win32":
            kwargs["creationflags"] = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        else:
            kwargs["start_new_session"] = True
        proc = subprocess.Popen(["node", str(SERVICE_RUNNER)], cwd=str(REPO_ROOT), **kwargs)
        _runner_proc = proc

    save_state({
        **state,
        "service_runner_pid": proc.pid,
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
    })

    log_step("PID", str(proc.pid))
    log_info(f"Logs: {log_path}")
    log_info("Stop with: python3 secretary.py --stop")


def _safe_kill(pid: int, timeout: float = 5.0) -> None:
    """Send SIGTERM, wait, then SIGKILL if necessary. Handles PID reuse safely."""
    if sys.platform == "win32":
        run(["taskkill", "/PID", str(pid), "/T", "/F"], timeout=10, check=False)
        return

    try:
        os.kill(pid, signal.SIGTERM)
    except PermissionError:
        try:
            os.kill(pid, signal.SIGKILL)
        except (OSError, ProcessLookupError, PermissionError):
            pass
        return
    except (OSError, ProcessLookupError):
        return

    deadline = time.time() + timeout
    while time.time() < deadline:
        if not is_pid_alive(pid):
            return
        time.sleep(0.2)

    if is_pid_alive(pid):
        try:
            os.kill(pid, signal.SIGKILL)
        except (OSError, ProcessLookupError):
            pass
        time.sleep(0.3)


def _kill_port_processes(port: int) -> None:
    """Kill processes listening on a specific port."""
    if sys.platform == "win32":
        ps = (
            f"Get-NetTCPConnection -LocalPort {port} -State Listen -ErrorAction SilentlyContinue | "
            f"ForEach-Object {{ Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }}"
        )
        run(["powershell", "-NoProfile", "-Command", ps], timeout=10, check=False)
        return

    try:
        _, out, _ = run(["lsof", "-ti", f":{port}"], capture=True, timeout=5, check=False)
        for p in out.strip().split():
            if p.isdigit():
                _safe_kill(int(p), timeout=2.0)
    except (subprocess.TimeoutExpired, OSError):
        pass


def _kill_by_patterns(patterns: List[str]) -> None:
    """Kill stray processes matching pgrep patterns."""
    if sys.platform == "win32":
        return
    for pat in patterns:
        try:
            _, out, _ = run(["pgrep", "-f", pat], capture=True, timeout=5, check=False)
            for p in out.strip().split():
                if p.isdigit():
                    _safe_kill(int(p), timeout=2.0)
        except (subprocess.TimeoutExpired, OSError):
            pass


def stop_app_services() -> None:
    log_section("Stopping App Services")
    state = load_state()
    pid = state.get("service_runner_pid")
    if pid and isinstance(pid, int) and pid > 0:
        _safe_kill(pid)

    for svc in APP_SERVICES:
        port = svc["port"]
        if wait_for_port("127.0.0.1", port, timeout_sec=1):
            _kill_port_processes(port)
        log_step("Stop", f"{svc['name']} (port {port})")

    _kill_by_patterns(["next dev", "apps/worker/dist/index.js", "run-stt.mjs", "run-tts.mjs"])


def stop_infrastructure() -> None:
    try:
        log_step("Docker", "stopping infrastructure...")
        npm(["run", "stack:down"], timeout=60, check=False)
    except (subprocess.TimeoutExpired, OSError) as e:
        log_warn("Docker", f"stop issue: {e}")


def stop_all() -> None:
    stop_app_services()
    stop_infrastructure()
    if STATE_FILE.exists():
        try:
            STATE_FILE.unlink()
        except (OSError, PermissionError):
            pass
    log_step("Stop", "complete")


# =============================================================================
# Status / Logs
# =============================================================================

def show_status() -> None:
    log_section("Secretary Status")
    log_step("Repo", str(REPO_ROOT))
    log_step(".env", "present" if ENV_PATH.exists() else "missing")
    if check_cmd("node"):
        _, out, _ = run(["node", "--version"], capture=True, timeout=5)
        log_step("Node.js", out.strip().lstrip("v"))
    else:
        log_step("Node.js", "missing")
    log_step("npm", "OK" if check_cmd("npm") else "missing")
    try:
        run(["docker", "info"], capture=True, timeout=3)
        log_step("Docker", "OK")
    except (subprocess.TimeoutExpired, OSError, subprocess.CalledProcessError):
        log_step("Docker", "missing")
    log_step("ffmpeg", "OK" if check_cmd("ffmpeg", ["-version"]) else "missing")

    state = load_state()
    runner_pid = state.get("service_runner_pid")
    if runner_pid:
        alive = is_pid_alive(runner_pid)
        status = (
            f"PID {runner_pid} ({Colors.OKGREEN}running{Colors.RESET})"
            if alive
            else f"PID {runner_pid} ({Colors.DIM}dead{Colors.RESET})"
        )
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


def tail_logs() -> None:
    log_path = LOGS_DIR / "service-runner.log"
    if not log_path.exists():
        log_error("Logs", f"No log file found at {log_path}")
        return
    log_step("Logs", f"Tailing {log_path}")
    if sys.platform == "win32":
        run(
            ["powershell", "-NoProfile", "-Command", f"Get-Content -Path '{log_path}' -Wait -Tail 30"],
            check=False,
        )
    else:
        run(["tail", "-f", "-n", "30", str(log_path)], check=False)


# =============================================================================
# Interactive Menu
# =============================================================================

def show_menu() -> None:
    state = load_state()
    runner_pid = state.get("service_runner_pid")
    runner_alive = runner_pid and is_pid_alive(runner_pid)

    print()
    print(f"{Colors.BOLD}{Colors.OKCYAN}  ╔══════════════════════════════════════════════════════════╗{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.OKCYAN}  ║        Secretary AI - Control Panel                       ║{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.OKCYAN}  ╠══════════════════════════════════════════════════════════╣{Colors.RESET}")
    status_line = f"{Colors.OKGREEN}● Running (PID {runner_pid}){Colors.RESET}" if runner_alive else f"{Colors.DIM}○ Stopped{Colors.RESET}"
    print(f"{Colors.BOLD}{Colors.OKCYAN}  ║{Colors.RESET}  Status: {status_line:<42}{Colors.BOLD}{Colors.OKCYAN}║{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.OKCYAN}  ╠══════════════════════════════════════════════════════════╣{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.OKCYAN}  ║{Colors.RESET}  [1]  Install & Build (deps, venvs, compile)              {Colors.BOLD}{Colors.OKCYAN}║{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.OKCYAN}  ║{Colors.RESET}  [2]  Start All  (background)                           {Colors.BOLD}{Colors.OKCYAN}║{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.OKCYAN}  ║{Colors.RESET}  [3]  Start All  (foreground / live logs)               {Colors.BOLD}{Colors.OKCYAN}║{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.OKCYAN}  ║{Colors.RESET}  [4]  Stop All    (kill processes, docker down)          {Colors.BOLD}{Colors.OKCYAN}║{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.OKCYAN}  ║{Colors.RESET}  [5]  Status      (health check all ports)               {Colors.BOLD}{Colors.OKCYAN}║{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.OKCYAN}  ║{Colors.RESET}  [6]  Logs        (tail service-runner output)           {Colors.BOLD}{Colors.OKCYAN}║{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.OKCYAN}  ║{Colors.RESET}  [7]  Full Reset  (stop + wipe runtime state)             {Colors.BOLD}{Colors.OKCYAN}║{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.OKCYAN}  ║{Colors.RESET}  [0]  Exit                                                {Colors.BOLD}{Colors.OKCYAN}║{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.OKCYAN}  ╚══════════════════════════════════════════════════════════╝{Colors.RESET}")
    print()


def _menu_install() -> None:
    try:
        run_install()
    except Exception as e:
        log_error("Install failed", str(e))


def _menu_start(foreground: bool) -> None:
    try:
        _do_start(foreground=foreground)
    except Exception as e:
        log_error("Start failed", str(e))


def _menu_stop() -> None:
    try:
        stop_all()
    except Exception as e:
        log_error("Stop failed", str(e))


def _menu_logs() -> None:
    try:
        tail_logs()
    except Exception as e:
        log_error("Logs failed", str(e))


def _menu_reset() -> None:
    try:
        stop_all()
        log_step("Reset", "complete")
    except Exception as e:
        log_error("Reset failed", str(e))


def menu_loop() -> None:
    dispatch = {
        "1": _menu_install,
        "2": lambda: _menu_start(False),
        "3": lambda: _menu_start(True),
        "4": _menu_stop,
        "5": show_status,
        "6": _menu_logs,
        "7": _menu_reset,
    }

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

        handler = dispatch.get(choice)
        if handler:
            handler()
        else:
            log_warn("Invalid", f"'{choice}' is not a valid option")

        try:
            input(f"\n  {Colors.DIM}Press Enter to return to menu...{Colors.RESET}")
        except (EOFError, KeyboardInterrupt):
            print()
            break
        print()


# =============================================================================
# CLI
# =============================================================================

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Secretary AI - Interactive Setup and Launch",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python3 secretary.py                  # Interactive menu
  python3 secretary.py --install        # Install & build only
  python3 secretary.py --start          # Start services in background
  python3 secretary.py --foreground     # Start services in foreground
  python3 secretary.py --stop           # Stop all services
  python3 secretary.py --status         # Check status
  python3 secretary.py --logs           # Tail service-runner log
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

    has_flags = any([args.install, args.start, args.foreground, args.stop, args.status, args.logs])
    use_menu = args.menu or (not has_flags and sys.stdin.isatty() and sys.stdout.isatty())

    if use_menu:
        menu_loop()
        return

    if args.status:
        show_status()
    elif args.stop:
        stop_all()
    elif args.logs:
        tail_logs()
    elif args.install:
        run_install()
    elif args.foreground:
        _do_start(foreground=True)
    elif args.start:
        _do_start(foreground=False)
    else:
        run_install()
        start_app_services(foreground=False)


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as e:
        log_section("Fatal Error")
        log_error("Command failed", " ".join(str(x) for x in e.cmd))
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
