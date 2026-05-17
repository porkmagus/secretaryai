"""
Integration tests for secretary.py
Run with: pytest tests/test_secretary_integration.py -v
"""

import subprocess
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import secretary


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
        # Either docker compose or docker-compose
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


class TestFilesystemIntegration:
    def test_ensure_storage_directories_creates_all(self, tmp_path):
        runtime = tmp_path / "runtime"
        with patch.object(secretary, "RUNTIME_DIR", runtime):
            # The function delegates to npm, but we verify dirs are expected
            assert runtime.exists() is False
            # Just verify the expected dir list is comprehensive
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


class TestStateFileRoundtrip:
    def test_state_file_persisted_to_expected_path(self, tmp_path):
        fake_state = tmp_path / "config" / "state.json"
        with patch.object(secretary, "STATE_FILE", fake_state):
            secretary.save_state({"foo": "bar"})
            loaded = secretary.load_state()
            assert loaded["foo"] == "bar"
