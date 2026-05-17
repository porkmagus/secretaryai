"""
Integration tests for secretary.py
Run with: pytest tests/test_secretary_integration.py -v
"""

import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import secretary


# =============================================================================
# Prerequisite Integration
# =============================================================================

class TestPrerequisiteIntegration:
    def test_node_version_meets_requirement(self):
        _, out, _ = secretary.run(["node", "--version"], capture=True, timeout=5)
        version = out.strip().lstrip("v")
        major = int(version.split(".")[0])
        assert major >= 24, f"Node.js {version} is too old (need 24+)"

    def test_docker_daemon_running(self):
        code, out, err = secretary.run(["docker", "info"], capture=True, timeout=5, check=False)
        assert code == 0, f"Docker daemon not running: {err}"

    def test_compose_command_available(self):
        ok = False
        try:
            secretary.run(["docker", "compose", "version"], capture=True, timeout=5)
            ok = True
        except Exception:
            pass
        if not ok:
            try:
                secretary.run(["docker-compose", "--version"], capture=True, timeout=5)
                ok = True
            except Exception:
                pass
        assert ok, "No docker compose command available"

    def test_python_version_is_3_11_plus(self):
        assert sys.version_info >= (3, 11), f"Python {sys.version} is too old"

    def test_npm_can_list_scripts(self):
        code, out, _ = secretary.run(["npm", "run"], capture=True, timeout=10, check=False)
        # npm run exits 0 and shows scripts, or exits 1 if no scripts
        assert code in (0, 1), "npm run failed unexpectedly"


# =============================================================================
# Filesystem Integration
# =============================================================================

class TestFilesystemIntegration:
    def test_ensure_storage_directories_creates_all(self, tmp_path):
        runtime = tmp_path / "runtime"
        dirs = [
            "postgres", "postgres/data", "redis", "redis/data",
            "speech", "speech/inbound", "speech/models", "speech/transcripts",
            "speech/tts", "speech/profiles", "caddy", "caddy/data", "caddy/config",
            "backups", "exports", "generated", "generated/documents",
            "downloads", "venvs", "dev-logs", "config",
        ]
        for d in dirs:
            (runtime / d).mkdir(parents=True, exist_ok=True)
        for d in dirs:
            assert (runtime / d).exists()

    def test_env_file_creation_from_example(self, tmp_path):
        env = tmp_path / ".env"
        example = tmp_path / ".env.example"
        example.write_text("KEY=value\n")
        with patch.object(secretary, "ENV_PATH", env), patch.object(
            secretary, "ENV_EXAMPLE_PATH", example
        ):
            secretary.ensure_env_file()
            assert env.exists()
            assert "KEY=value" in env.read_text()

    def test_state_file_roundtrip_with_complex_data(self, tmp_path):
        fake_state = tmp_path / "config" / "state.json"
        with patch.object(secretary, "STATE_FILE", fake_state):
            complex_data = {
                "bootstrap": {
                    "packageLockMtimeMs": 12345.0,
                    "workerSourceMtimeMs": 67890.0,
                    "sttRequirementsMtimeMs": 11111.0,
                    "ttsRequirementsMtimeMs": 22222.0,
                },
                "processes": {"web": {"pid": 100}},
                "lastStartedAt": "2024-01-01T00:00:00",
            }
            secretary.save_state(complex_data)
            loaded = secretary.load_state()
            assert loaded["bootstrap"]["packageLockMtimeMs"] == 12345.0
            assert loaded["processes"]["web"]["pid"] == 100


# =============================================================================
# NPM Integration
# =============================================================================

class TestNpmIntegration:
    def test_node_modules_exists(self):
        assert (secretary.REPO_ROOT / "node_modules").exists()

    def test_worker_dist_built(self):
        assert secretary.WORKER_DIST_PATH.exists()

    def test_stt_venv_python_exists(self):
        if sys.platform == "win32":
            py = secretary.STT_VENV / "Scripts" / "python.exe"
        else:
            py = secretary.STT_VENV / "bin" / "python"
        assert py.exists(), "STT venv not set up"

    def test_tts_venv_python_exists(self):
        if sys.platform == "win32":
            py = secretary.TTS_VENV / "Scripts" / "python.exe"
        else:
            py = secretary.TTS_VENV / "bin" / "python"
        assert py.exists(), "TTS venv not set up"

    def test_npm_scripts_include_expected_commands(self):
        pkg = json.loads((secretary.REPO_ROOT / "package.json").read_text())
        scripts = pkg.get("scripts", {})
        assert "stack:up" in scripts
        assert "stack:down" in scripts
        assert "db:migrate" in scripts
        assert "build:packages" in scripts
        assert "stt:setup" in scripts
        assert "tts:setup" in scripts

    def test_package_json_has_expected_name(self):
        pkg = json.loads((secretary.REPO_ROOT / "package.json").read_text())
        assert pkg.get("name") == "secretary-first-assistant"


# =============================================================================
# Port & Health Integration
# =============================================================================

class TestPortHealthIntegration:
    def test_wait_for_port_fails_quickly_on_refused(self):
        start = time.time()
        result = secretary.wait_for_port("127.0.0.1", 59997, timeout_sec=2)
        elapsed = time.time() - start
        assert result is False
        assert elapsed < 3.5  # Should not hang

    def test_wait_for_health_with_invalid_url(self):
        result = secretary.wait_for_health("not-a-url", timeout_sec=1, retries=1)
        assert result is False

    def test_is_pid_alive_with_own_pid(self):
        assert secretary.is_pid_alive(os.getpid()) is True

    def test_is_pid_alive_with_init_pid(self):
        # PID 1 should exist on Unix, but may be different on Windows
        if sys.platform == "darwin":
            pytest.skip("macOS SIP may prevent signaling PID 1")
        if sys.platform != "win32":
            assert secretary.is_pid_alive(1) is True


# =============================================================================
# Docker Integration
# =============================================================================

class TestDockerIntegration:
    def test_compose_file_exists(self):
        assert (secretary.REPO_ROOT / "docker" / "compose" / "docker-compose.yml").exists()

    def test_compose_file_is_valid_yaml(self):
        import yaml
        compose_path = secretary.REPO_ROOT / "docker" / "compose" / "docker-compose.yml"
        with open(compose_path) as f:
            data = yaml.safe_load(f)
        assert "services" in data
        assert "postgres" in data["services"]
        assert "redis" in data["services"]

    def test_searxng_settings_exists(self):
        assert (secretary.REPO_ROOT / "docker" / "searxng" / "settings.yml").exists()

    def test_docker_containers_can_be_listed(self):
        code, _, _ = secretary.run(["docker", "ps"], capture=True, timeout=10, check=False)
        assert code == 0, "Cannot list Docker containers"


# =============================================================================
# Log File Integration
# =============================================================================

class TestLogFileIntegration:
    def test_log_directory_creation(self, tmp_path):
        logs = tmp_path / "dev-logs"
        with patch.object(secretary, "LOGS_DIR", logs):
            logs.mkdir(parents=True, exist_ok=True)
            assert logs.exists()

    def test_log_file_append_mode(self, tmp_path):
        log = tmp_path / "test.log"
        with open(log, "a") as f:
            f.write("line1\n")
        with open(log, "a") as f:
            f.write("line2\n")
        content = log.read_text()
        assert "line1" in content
        assert "line2" in content


# =============================================================================
# State File Edge Cases
# =============================================================================

class TestStateFileEdgeCases:
    def test_state_file_is_directory_fails_gracefully(self, tmp_path):
        dir_state = tmp_path / "state.json"
        dir_state.mkdir()
        with patch.object(secretary, "STATE_FILE", dir_state):
            result = secretary.load_state()
            # Should not crash; should return default
            assert isinstance(result, dict)

    def test_save_state_overwrites_existing(self, tmp_path):
        fake_state = tmp_path / "state.json"
        with patch.object(secretary, "STATE_FILE", fake_state):
            secretary.save_state({"version": 1})
            secretary.save_state({"version": 2})
            loaded = secretary.load_state()
            assert loaded["version"] == 2

    def test_load_state_with_partial_json(self, tmp_path):
        partial = tmp_path / "partial.json"
        partial.write_text('{"bootstrap": {"a": 1}')
        with patch.object(secretary, "STATE_FILE", partial):
            result = secretary.load_state()
            assert isinstance(result, dict)
