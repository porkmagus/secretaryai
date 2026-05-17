"""
Integration tests for secretary.py — tests that touch the filesystem,
Docker, and npm but do not start the full service stack.
Run with: pytest tests/test_secretary_integration.py -v
"""

import json
import os
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import secretary


class TestPrerequisitesIntegration:
    def test_check_all_prerequisites_passes_on_this_machine(self):
        ok, errors = secretary.check_all_prerequisites(allow_missing_ffmpeg=True)
        assert ok is True, f"Prerequisites failed: {errors}"
        assert len(errors) == 0

    def test_docker_daemon_check_passes(self):
        ok, err = secretary.check_docker_daemon()
        assert ok is True, f"Docker daemon check failed: {err}"

    def test_docker_compose_command_found(self):
        cmd = secretary.docker_compose_cmd()
        assert isinstance(cmd, list)
        assert len(cmd) >= 3


class TestStorageDirectories:
    def test_ensure_storage_directories_creates_all(self, tmp_path):
        original_root = secretary.REPO_ROOT
        original_runtime = secretary.RUNTIME_DIR
        secretary.REPO_ROOT = tmp_path
        secretary.RUNTIME_DIR = tmp_path / "runtime"
        secretary.VENV_DIR = secretary.RUNTIME_DIR / "venvs"
        secretary.LOGS_DIR = secretary.RUNTIME_DIR / "dev-logs"
        try:
            secretary.ensure_storage_directories()
            expected = [
                "runtime/postgres", "runtime/postgres/data",
                "runtime/redis", "runtime/redis/data",
                "runtime/speech", "runtime/speech/inbound", "runtime/speech/models",
                "runtime/speech/transcripts", "runtime/speech/tts", "runtime/speech/profiles",
                "runtime/caddy", "runtime/caddy/data", "runtime/caddy/config",
                "runtime/backups", "runtime/exports",
                "runtime/generated", "runtime/generated/documents",
                "runtime/downloads", "runtime/venvs", "runtime/dev-logs",
            ]
            for d in expected:
                assert (secretary.REPO_ROOT / d).is_dir(), f"Missing directory: {d}"
        finally:
            secretary.REPO_ROOT = original_root
            secretary.RUNTIME_DIR = original_runtime
            secretary.VENV_DIR = original_runtime / "venvs"
            secretary.LOGS_DIR = original_runtime / "dev-logs"


class TestEnvFileIntegration:
    def test_env_file_created_from_example(self):
        # If .env already exists this is a no-op; test just validates the function runs
        secretary.ensure_env_file()
        assert secretary.ENV_PATH.exists()


class TestNpmBuild:
    def test_worker_dist_exists_after_build(self):
        worker_dist = secretary.REPO_ROOT / "apps" / "worker" / "dist" / "index.js"
        if not worker_dist.exists():
            secretary.build_packages_and_worker()
        assert worker_dist.exists(), "Worker dist should exist after build"

    def test_node_modules_exists(self):
        assert (secretary.REPO_ROOT / "node_modules").is_dir()


class TestPythonVenvs:
    def test_stt_venv_python_exists(self):
        if secretary.PLATFORM == "windows":
            python_bin = secretary.STT_VENV / "Scripts" / "python.exe"
        else:
            python_bin = secretary.STT_VENV / "bin" / "python"
        if not python_bin.exists():
            secretary.setup_stt_venv()
        assert python_bin.exists()

    def test_tts_venv_python_exists(self):
        if secretary.PLATFORM == "windows":
            python_bin = secretary.TTS_VENV / "Scripts" / "python.exe"
        else:
            python_bin = secretary.TTS_VENV / "bin" / "python"
        if not python_bin.exists():
            secretary.setup_tts_venv()
        assert python_bin.exists()


class TestStateFile:
    def test_state_file_roundtrip_in_real_runtime(self):
        secretary.save_state({"test_key": "test_value"})
        loaded = secretary.load_state()
        assert loaded.get("test_key") == "test_value"
        # Clean up
        if secretary.STATE_FILE.exists():
            secretary.STATE_FILE.unlink()
