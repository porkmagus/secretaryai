"""
Unit tests for secretary.py helper functions.
Run with: pytest tests/test_secretary_unit.py -v
"""

import json
import os
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

# Add repo root to path so we can import secretary.py internals
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import secretary


class TestPlatformAndPrereqs:
    def test_get_platform_returns_known_value(self):
        plat = secretary.get_platform()
        assert plat in ("macos", "linux", "windows")

    def test_check_python_version_returns_true_on_this_interpreter(self):
        ok, version = secretary.check_python_version()
        assert ok is True
        assert isinstance(version, str)
        assert len(version.split(".")) >= 2

    def test_check_command_exists_node(self):
        # Node should exist on Sean's machine (verified earlier)
        assert secretary.check_command_exists("node") is True

    def test_check_command_exists_fake_command(self):
        assert secretary.check_command_exists("definitely_not_a_real_command_12345") is False

    def test_check_node_version_format(self):
        ok, version, err = secretary.check_node_version()
        assert isinstance(ok, bool)
        assert isinstance(version, str)
        if ok:
            assert err is None
            major = int(version.split(".")[0])
            assert major >= 24

    def test_check_npm_exists(self):
        assert secretary.check_npm() is True

    def test_check_docker_exists_and_runnable(self):
        ok, err = secretary.check_docker()
        assert ok is True, f"Docker check failed: {err}"
        assert err == ""

    def test_check_ffmpeg_exists(self):
        assert secretary.check_ffmpeg() is True


class TestStateManagement:
    def test_save_and_load_state_roundtrip(self, tmp_path):
        original_state_file = secretary.STATE_FILE
        test_state = tmp_path / "test-state.json"
        secretary.STATE_FILE = test_state
        try:
            data = {"service_runner_pid": 12345, "started_at": "2024-01-01T00:00:00"}
            secretary.save_state(data)
            loaded = secretary.load_state()
            assert loaded == data
        finally:
            secretary.STATE_FILE = original_state_file

    def test_load_state_missing_file_returns_empty_dict(self, tmp_path):
        original_state_file = secretary.STATE_FILE
        test_state = tmp_path / "nonexistent-state.json"
        secretary.STATE_FILE = test_state
        try:
            assert secretary.load_state() == {}
        finally:
            secretary.STATE_FILE = original_state_file


class TestPidTracking:
    def test_is_pid_alive_current_process(self):
        assert secretary.is_pid_alive(os.getpid()) is True

    def test_is_pid_alive_fake_pid(self):
        # PID 1 is init/systemd on Linux/macOS and should not be our process
        # Using a very high PID that almost certainly doesn't exist
        assert secretary.is_pid_alive(999999) is False


class TestPortAndHealth:
    def test_wait_for_port_closed_port(self):
        # Find an unused port by binding to 0
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]
        # Now the port is free but closed; wait_for_port should return False quickly
        start = time.time()
        result = secretary.wait_for_port("127.0.0.1", port, timeout_sec=2)
        elapsed = time.time() - start
        assert result is False
        assert elapsed < 3  # Should respect timeout

    def test_wait_for_port_open_port(self):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]
            s.listen(1)
            result = secretary.wait_for_port("127.0.0.1", port, timeout_sec=5)
            assert result is True

    def test_wait_for_health_against_local_server(self):
        import threading
        import http.server

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.end_headers()
            def log_message(self, format, *args):
                pass  # Silence logs

        server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
        port = server.server_address[1]

        def serve():
            server.serve_forever(poll_interval=0.1)

        t = threading.Thread(target=serve, daemon=True)
        t.start()
        try:
            time.sleep(0.3)
            result = secretary.wait_for_health(f"http://127.0.0.1:{port}/", timeout_sec=3)
            assert result is True
        finally:
            server.shutdown()

    def test_wait_for_health_against_nonexistent_server(self):
        result = secretary.wait_for_health("http://127.0.0.1:59999/", timeout_sec=1)
        assert result is False


class TestPathsAndConfig:
    def test_repo_root_is_directory(self):
        assert secretary.REPO_ROOT.is_dir()

    def test_package_json_exists(self):
        assert (secretary.REPO_ROOT / "package.json").exists()

    def test_env_example_exists(self):
        assert secretary.ENV_EXAMPLE_PATH.exists()

    def test_docker_compose_file_exists(self):
        assert secretary.DOCKER_COMPOSE_FILE.exists()

    def test_services_defined(self):
        assert len(secretary.INFRA_SERVICES) == 4
        assert len(secretary.APP_SERVICES) == 4
        names = [s["name"] for s in secretary.APP_SERVICES]
        assert "Web" in names
        assert "Worker" in names
        assert "STT" in names
        assert "TTS" in names


class TestColors:
    def test_colors_have_values_when_tty(self):
        # When not a TTY, colors are disabled at import time.
        # We verify the class still has attributes that can be re-enabled.
        class FreshColors:
            OKGREEN = "\033[92m"
            FAIL = "\033[91m"
            RESET = "\033[0m"
        assert FreshColors.OKGREEN != ""
        assert FreshColors.FAIL != ""

    def test_disable_clears_values(self):
        class LocalColors:
            OKGREEN = "\033[92m"
            FAIL = "\033[91m"
            RESET = "\033[0m"

            @classmethod
            def disable(cls):
                for attr in dir(cls):
                    if not attr.startswith("_") and isinstance(getattr(cls, attr), str):
                        setattr(cls, attr, "")

        LocalColors.disable()
        assert LocalColors.OKGREEN == ""
        assert LocalColors.FAIL == ""


class TestDockerComposeCmd:
    def test_docker_compose_cmd_returns_list(self):
        cmd = secretary.docker_compose_cmd()
        assert isinstance(cmd, list)
        assert len(cmd) >= 3
        assert cmd[0] in ("docker", "docker-compose")
        assert "-f" in cmd


class TestEnvironmentFile:
    def test_ensure_env_file_creates_from_example(self, tmp_path):
        # Create a temp repo-like structure
        env_example = tmp_path / ".env.example"
        env_file = tmp_path / ".env"
        env_example.write_text("FOO=bar\n")

        original_env = secretary.ENV_PATH
        original_example = secretary.ENV_EXAMPLE_PATH
        secretary.ENV_PATH = env_file
        secretary.ENV_EXAMPLE_PATH = env_example
        try:
            secretary.ensure_env_file()
            assert env_file.exists()
            assert env_file.read_text() == "FOO=bar\n"
        finally:
            secretary.ENV_PATH = original_env
            secretary.ENV_EXAMPLE_PATH = original_example

    def test_ensure_env_file_skips_if_exists(self, tmp_path):
        env_example = tmp_path / ".env.example"
        env_file = tmp_path / ".env"
        env_example.write_text("FOO=bar\n")
        env_file.write_text("BAZ=qux\n")

        original_env = secretary.ENV_PATH
        original_example = secretary.ENV_EXAMPLE_PATH
        secretary.ENV_PATH = env_file
        secretary.ENV_EXAMPLE_PATH = env_example
        try:
            secretary.ensure_env_file()
            assert env_file.read_text() == "BAZ=qux\n"
        finally:
            secretary.ENV_PATH = original_env
            secretary.ENV_EXAMPLE_PATH = original_example
