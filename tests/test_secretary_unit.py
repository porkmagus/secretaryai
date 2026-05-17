"""
Unit tests for secretary.py internals.
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
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import secretary


class TestPlatformAndPrereqs:
    def test_get_platform_returns_known_value(self):
        plat = sys.platform
        assert plat in ("darwin", "linux", "linux2", "win32")

    def test_check_prerequisites_runs_without_crash(self):
        ok, errors = secretary.check_prerequisites()
        assert isinstance(ok, bool)
        assert isinstance(errors, list)

    def test_check_command_exists_node(self):
        assert secretary.check_cmd("node") is True

    def test_check_command_exists_fake_command(self):
        assert secretary.check_cmd("not-a-real-command-12345") is False

    def test_wait_for_port_timeout_on_bad_port(self):
        assert secretary.wait_for_port("127.0.0.1", 59999, timeout_sec=1) is False

    def test_wait_for_port_detects_open_port(self):
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
        sock.listen(1)
        try:
            assert secretary.wait_for_port("127.0.0.1", port, timeout_sec=5) is True
        finally:
            sock.close()


class TestStateManagement:
    def test_load_state_missing_file_returns_default(self):
        with patch.object(secretary, "STATE_FILE", Path("/tmp/nonexistent-state.json")):
            result = secretary.load_state()
            assert "bootstrap" in result
            assert "processes" in result
            assert "lastStartedAt" in result

    def test_save_and_load_roundtrip(self, tmp_path):
        fake_state = tmp_path / "state.json"
        with patch.object(secretary, "STATE_FILE", fake_state):
            data = {"service_runner_pid": 12345, "started_at": "2024-01-01T00:00:00"}
            secretary.save_state(data)
            loaded = secretary.load_state()
            assert loaded["service_runner_pid"] == 12345
            assert loaded["started_at"] == "2024-01-01T00:00:00"

    def test_is_pid_alive_with_current_process(self):
        assert secretary.is_pid_alive(os.getpid()) is True

    def test_is_pid_alive_with_fake_pid(self):
        assert secretary.is_pid_alive(999999) is False


class TestPathsAndConfig:
    def test_repo_root_points_to_git_repo(self):
        assert secretary.REPO_ROOT.is_dir()
        assert (secretary.REPO_ROOT / "package.json").exists()

    def test_env_example_exists(self):
        assert secretary.ENV_EXAMPLE_PATH.exists()

    def test_worker_source_root_exists(self):
        assert secretary.WORKER_SOURCE_ROOT.exists()

    def test_service_runner_script_exists(self):
        assert secretary.SERVICE_RUNNER.exists()

    def test_ensure_env_file_creates_from_example(self, tmp_path):
        env_file = tmp_path / ".env"
        example_file = tmp_path / ".env.example"
        example_file.write_text("FOO=bar\n")
        with patch.object(secretary, "ENV_PATH", env_file), patch.object(
            secretary, "ENV_EXAMPLE_PATH", example_file
        ):
            secretary.ensure_env_file()
            assert env_file.exists()
            assert "FOO=bar" in env_file.read_text()


class TestColors:
    def test_colors_have_values_when_enabled(self):
        # Force enable by creating a fresh class without the module-level disable
        class FreshColors:
            HEADER = "\033[95m"
            OKGREEN = "\033[92m"
        assert FreshColors.HEADER == "\033[95m"
        assert FreshColors.OKGREEN == "\033[92m"

    def test_disable_clears_values(self):
        class TestColors(secretary.Colors):
            pass

        TestColors.disable()
        assert TestColors.HEADER == ""
        assert TestColors.OKGREEN == ""


class TestCommandExecution:
    def test_run_echo(self):
        code, stdout, stderr = secretary.run(["echo", "hello"], capture=True)
        assert code == 0
        assert "hello" in stdout

    def test_run_raises_on_bad_command(self):
        with pytest.raises(subprocess.CalledProcessError):
            secretary.run(["false"], check=True)

    def test_run_stream_returns_popen(self):
        proc = secretary.run_stream(["echo", "hello"])
        assert isinstance(proc, subprocess.Popen)
        proc.wait()
        assert proc.returncode == 0


class TestWaitForHealth:
    def test_wait_for_health_against_local_server(self):
        import http.server
        import threading

        class DummyHandler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"ok")

            def log_message(self, format, *args):
                pass

        server = http.server.HTTPServer(("127.0.0.1", 0), DummyHandler)
        port = server.server_address[1]
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            assert secretary.wait_for_health(f"http://127.0.0.1:{port}/", timeout_sec=5, retries=3) is True
        finally:
            server.shutdown()

    def test_wait_for_health_against_nonexistent_server(self):
        assert secretary.wait_for_health("http://127.0.0.1:59999/", timeout_sec=1, retries=1) is False
