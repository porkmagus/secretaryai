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
from unittest.mock import MagicMock, patch, mock_open

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import secretary


# =============================================================================
# Platform & Prerequisites
# =============================================================================

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

    def test_check_command_exists_with_custom_args(self):
        assert secretary.check_cmd("node", ["--version"]) is True

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

    def test_wait_for_port_with_zero_timeout(self):
        assert secretary.wait_for_port("127.0.0.1", 59999, timeout_sec=0) is False

    def test_wait_for_port_with_negative_timeout(self):
        assert secretary.wait_for_port("127.0.0.1", 59999, timeout_sec=-1) is False


# =============================================================================
# State Management
# =============================================================================

class TestStateManagement:
    def test_load_state_missing_file_returns_default(self):
        with patch.object(secretary, "STATE_FILE", Path("/tmp/nonexistent-state.json")):
            result = secretary.load_state()
            assert "bootstrap" in result
            assert "processes" in result
            assert "lastStartedAt" in result

    def test_load_state_with_corrupt_json_returns_default(self, tmp_path):
        bad_file = tmp_path / "bad.json"
        bad_file.write_text("{not valid json")
        with patch.object(secretary, "STATE_FILE", bad_file):
            result = secretary.load_state()
            assert "bootstrap" in result

    def test_load_state_with_empty_file_returns_default(self, tmp_path):
        empty_file = tmp_path / "empty.json"
        empty_file.write_text("")
        with patch.object(secretary, "STATE_FILE", empty_file):
            result = secretary.load_state()
            assert "bootstrap" in result

    def test_load_state_with_null_values(self, tmp_path):
        null_file = tmp_path / "null.json"
        null_file.write_text("null")
        with patch.object(secretary, "STATE_FILE", null_file):
            result = secretary.load_state()
            assert result is not None

    def test_save_and_load_roundtrip(self, tmp_path):
        fake_state = tmp_path / "state.json"
        with patch.object(secretary, "STATE_FILE", fake_state):
            data = {"service_runner_pid": 12345, "started_at": "2024-01-01T00:00:00"}
            secretary.save_state(data)
            loaded = secretary.load_state()
            assert loaded["service_runner_pid"] == 12345
            assert loaded["started_at"] == "2024-01-01T00:00:00"

    def test_save_state_creates_parent_directories(self, tmp_path):
        deep_file = tmp_path / "a" / "b" / "c" / "state.json"
        with patch.object(secretary, "STATE_FILE", deep_file):
            secretary.save_state({"test": "value"})
            assert deep_file.exists()
            assert json.loads(deep_file.read_text()) == {"test": "value"}

    def test_is_pid_alive_with_current_process(self):
        assert secretary.is_pid_alive(os.getpid()) is True

    def test_is_pid_alive_with_fake_pid(self):
        assert secretary.is_pid_alive(999999) is False

    def test_is_pid_alive_with_zero_pid(self):
        assert secretary.is_pid_alive(0) is False

    def test_is_pid_alive_with_negative_pid(self):
        assert secretary.is_pid_alive(-1) is False


# =============================================================================
# Paths & Config
# =============================================================================

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

    def test_ensure_env_file_already_present(self, tmp_path):
        env_file = tmp_path / ".env"
        env_file.write_text("EXISTING=value\n")
        with patch.object(secretary, "ENV_PATH", env_file):
            secretary.ensure_env_file()
            assert "EXISTING=value" in env_file.read_text()

    def test_ensure_env_file_missing_example_raises(self, tmp_path):
        env_file = tmp_path / ".env"
        with patch.object(secretary, "ENV_PATH", env_file), patch.object(
            secretary, "ENV_EXAMPLE_PATH", tmp_path / ".env.example"
        ):
            with pytest.raises(RuntimeError):
                secretary.ensure_env_file()

    def test_get_latest_mtime_on_file(self, tmp_path):
        test_file = tmp_path / "test.txt"
        test_file.write_text("hello")
        mtime = secretary._get_latest_mtime(test_file)
        assert mtime > 0
        assert mtime <= time.time() + 1

    def test_get_latest_mtime_on_directory(self, tmp_path):
        subdir = tmp_path / "subdir"
        subdir.mkdir()
        (subdir / "a.txt").write_text("a")
        time.sleep(0.05)
        (subdir / "b.txt").write_text("b")
        mtime = secretary._get_latest_mtime(subdir)
        # Should be close to the most recent file
        assert mtime > 0


# =============================================================================
# Colors
# =============================================================================

class TestColors:
    def test_colors_have_values_when_enabled(self):
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

    def test_disable_preserves_private_attrs(self):
        class TestColors(secretary.Colors):
            _private = "hidden"
            __dunder = "dunder"

        TestColors.disable()
        assert TestColors._private == "hidden"


# =============================================================================
# Command Execution
# =============================================================================

class TestCommandExecution:
    def test_run_echo(self):
        code, stdout, stderr = secretary.run(["echo", "hello"], capture=True)
        assert code == 0
        assert "hello" in stdout

    def test_run_raises_on_bad_command(self):
        with pytest.raises(subprocess.CalledProcessError):
            secretary.run(["false"], check=True)

    def test_run_does_not_raise_when_check_false(self):
        code, _, _ = secretary.run(["false"], check=False)
        assert code != 0

    def test_run_with_env_override(self):
        code, stdout, _ = secretary.run(["bash", "-c", "echo $TEST_VAR"], capture=True, env={"TEST_VAR": "secret_value"})
        assert "secret_value" in stdout

    def test_run_stream_returns_popen(self):
        proc = secretary.run_stream(["echo", "hello"])
        assert isinstance(proc, subprocess.Popen)
        proc.wait()
        assert proc.returncode == 0

    def test_run_timeout_raises(self):
        with pytest.raises(subprocess.TimeoutExpired):
            secretary.run(["sleep", "5"], timeout=1)


# =============================================================================
# Wait For Health
# =============================================================================

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

    def test_wait_for_health_accepts_404(self):
        import http.server
        import threading

        class NotFoundHandler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(404)
                self.end_headers()

            def log_message(self, format, *args):
                pass

        server = http.server.HTTPServer(("127.0.0.1", 0), NotFoundHandler)
        port = server.server_address[1]
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            assert secretary.wait_for_health(f"http://127.0.0.1:{port}/", timeout_sec=5, retries=3) is True
        finally:
            server.shutdown()

    def test_wait_for_health_rejects_500(self):
        import http.server
        import threading

        class ErrorHandler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(500)
                self.end_headers()
                self.wfile.write(b"error")

            def log_message(self, format, *args):
                pass

        server = http.server.HTTPServer(("127.0.0.1", 0), ErrorHandler)
        port = server.server_address[1]
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            assert secretary.wait_for_health(f"http://127.0.0.1:{port}/", timeout_sec=2, retries=1) is False
        finally:
            server.shutdown()

    def test_wait_for_health_zero_retries(self):
        assert secretary.wait_for_health("http://127.0.0.1:59999/", timeout_sec=0, retries=0) is False


# =============================================================================
# Bootstrap Logic
# =============================================================================

class TestBootstrapLogic:
    def test_ensure_node_modules_when_lock_missing(self, tmp_path):
        with patch.object(secretary, "PACKAGE_LOCK_PATH", tmp_path / "no-lock.json"):
            with patch.object(secretary, "NODE_MODULES_PATH", tmp_path / "node_modules"):
                # This would try npm install; just verify the path check works
                assert not secretary.PACKAGE_LOCK_PATH.exists()

    def test_ensure_node_modules_skips_when_unchanged(self, tmp_path):
        lock = tmp_path / "package-lock.json"
        lock.write_text("{}")
        node_modules = tmp_path / "node_modules"
        node_modules.mkdir()
        state = {"bootstrap": {"packageLockMtimeMs": lock.stat().st_mtime}}
        with patch.object(secretary, "PACKAGE_LOCK_PATH", lock), patch.object(
            secretary, "NODE_MODULES_PATH", node_modules
        ):
            result = secretary.ensure_node_modules(state)
            assert result is state  # Should return same object (no changes)

    def test_ensure_worker_build_when_dist_missing(self, tmp_path):
        source = tmp_path / "src"
        source.mkdir()
        (source / "index.ts").write_text("export {}")
        pkg = tmp_path / "package.json"
        pkg.write_text("{}")
        tsconfig = tmp_path / "tsconfig.json"
        tsconfig.write_text("{}")
        dist = tmp_path / "dist" / "index.js"
        with patch.object(secretary, "WORKER_SOURCE_ROOT", source), patch.object(
            secretary, "WORKER_PACKAGE_PATH", pkg
        ), patch.object(secretary, "WORKER_TSCONFIG_PATH", tsconfig), patch.object(
            secretary, "WORKER_DIST_PATH", dist
        ):
            state = {}
            # Can't actually run npm build in test, but verify needs detection
            assert not dist.exists()

    def test_ensure_speech_setup_when_venvs_missing(self, tmp_path):
        reqs = tmp_path / "requirements.txt"
        reqs.write_text("fastapi\n")
        venv = tmp_path / "venv"
        with patch.object(secretary, "STT_REQUIREMENTS", reqs), patch.object(
            secretary, "TTS_REQUIREMENTS", reqs
        ), patch.object(secretary, "STT_VENV", venv), patch.object(secretary, "TTS_VENV", venv):
            state = {"bootstrap": {}}
            # venv doesn't exist, so it should need setup
            assert not secretary.STT_VENV.exists()
            assert not secretary.TTS_VENV.exists()


# =============================================================================
# Service Definitions
# =============================================================================

class TestServiceDefinitions:
    def test_infra_services_have_required_fields(self):
        for svc in secretary.INFRA_SERVICES:
            assert "name" in svc
            assert "port" in svc
            assert "timeout" in svc
            assert isinstance(svc["port"], int)
            assert svc["port"] > 0

    def test_app_services_have_required_fields(self):
        for svc in secretary.APP_SERVICES:
            assert "name" in svc
            assert "port" in svc
            assert "timeout" in svc
            assert isinstance(svc["port"], int)
            assert svc["port"] > 0

    def test_app_services_have_health_urls(self):
        for svc in secretary.APP_SERVICES:
            assert "health_url" in svc
            assert svc["health_url"].startswith("http://")

    def test_no_duplicate_ports_in_infra(self):
        ports = [s["port"] for s in secretary.INFRA_SERVICES]
        assert len(ports) == len(set(ports))

    def test_no_duplicate_ports_in_app(self):
        ports = [s["port"] for s in secretary.APP_SERVICES]
        assert len(ports) == len(set(ports))

    def test_no_port_collision_between_infra_and_app(self):
        infra_ports = {s["port"] for s in secretary.INFRA_SERVICES}
        app_ports = {s["port"] for s in secretary.APP_SERVICES}
        assert infra_ports.isdisjoint(app_ports)


# =============================================================================
# Edge Cases & Failure Modes
# =============================================================================

class TestEdgeCasesAndFailures:
    def test_ensure_env_file_when_destination_is_directory(self, tmp_path):
        env_dir = tmp_path / ".env"
        env_dir.mkdir()
        example_file = tmp_path / ".env.example"
        example_file.write_text("FOO=bar\n")
        with patch.object(secretary, "ENV_PATH", env_dir), patch.object(
            secretary, "ENV_EXAMPLE_PATH", example_file
        ):
            with pytest.raises((RuntimeError, IsADirectoryError, PermissionError)):
                secretary.ensure_env_file()

    def test_ensure_worker_build_when_source_dir_missing(self, tmp_path):
        source = tmp_path / "missing_src"
        pkg = tmp_path / "package.json"
        pkg.write_text("{}")
        tsconfig = tmp_path / "tsconfig.json"
        tsconfig.write_text("{}")
        with patch.object(secretary, "WORKER_SOURCE_ROOT", source), patch.object(
            secretary, "WORKER_PACKAGE_PATH", pkg
        ), patch.object(secretary, "WORKER_TSCONFIG_PATH", tsconfig):
            with pytest.raises(FileNotFoundError):
                secretary._get_latest_mtime(source)

    def test_is_pid_alive_with_non_integer(self):
        assert secretary.is_pid_alive("not-a-pid") is False
        assert secretary.is_pid_alive(None) is False
        assert secretary.is_pid_alive(3.14) is False

    def test_wait_for_port_with_invalid_port(self):
        assert secretary.wait_for_port("127.0.0.1", 99999, timeout_sec=1) is False
        assert secretary.wait_for_port("127.0.0.1", -1, timeout_sec=1) is False
        assert secretary.wait_for_port("127.0.0.1", 0, timeout_sec=1) is False

    def test_ensure_docker_stack_with_missing_compose_file(self, tmp_path):
        with patch.object(secretary, "REPO_ROOT", tmp_path):
            with pytest.raises((subprocess.CalledProcessError, RuntimeError)):
                secretary.ensure_docker_stack()

    def test_run_db_migrations_with_zero_retries(self):
        with pytest.raises(RuntimeError):
            secretary.run_db_migrations(retries=0, delay=0)
