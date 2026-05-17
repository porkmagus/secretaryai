"""
End-to-end tests for secretary.py
These start the full stack, verify services, hit endpoints, then shut down.

Run with: pytest tests/test_secretary_e2e.py -v --timeout=300
Requires: Docker running, node_modules installed, worker built.
"""

import json
import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import secretary


class TestFullStackLifecycle:
    """Start infrastructure + apps, verify health, stop everything."""

    def test_start_infrastructure_ports_open(self):
        secretary.start_infrastructure()
        try:
            for svc in secretary.INFRA_SERVICES:
                assert secretary.wait_for_port("127.0.0.1", svc["port"], timeout_sec=svc["timeout"]), \
                    f"{svc['name']} not listening on {svc['port']}"
        finally:
            secretary.stop_infrastructure()

    def test_db_migrations_apply_cleanly(self):
        secretary.start_infrastructure()
        try:
            secretary.run_db_migrations()
        finally:
            secretary.stop_infrastructure()

    def test_full_background_start_and_health(self):
        """Start everything in background, verify all ports + health, then stop."""
        secretary.stop_all()
        secretary.start_infrastructure()
        secretary.run_db_migrations()
        secretary.start_app_services(foreground=False)

        try:
            time.sleep(8)

            for svc in secretary.APP_SERVICES:
                assert secretary.wait_for_port("127.0.0.1", svc["port"], timeout_sec=svc["timeout"]), \
                    f"{svc['name']} not listening on {svc['port']}"

            for svc in secretary.APP_SERVICES:
                if svc.get("health_url"):
                    healthy = secretary.wait_for_health(svc["health_url"], timeout_sec=10, retries=5)
                    assert healthy, f"{svc['name']} health check failed at {svc['health_url']}"

            state = secretary.load_state()
            pid = state.get("service_runner_pid")
            assert pid is not None, "Service runner PID not tracked in state"
            assert secretary.is_pid_alive(pid), f"Service runner PID {pid} not alive"

        finally:
            secretary.stop_all()
            for svc in secretary.APP_SERVICES:
                assert secretary.wait_for_port("127.0.0.1", svc["port"], timeout_sec=2) is False, \
                    f"{svc['name']} still listening on {svc['port']} after stop"
            for svc in secretary.INFRA_SERVICES:
                assert secretary.wait_for_port("127.0.0.1", svc["port"], timeout_sec=2) is False, \
                    f"{svc['name']} still listening on {svc['port']} after stop"

    def test_web_page_loads_and_contains_title(self):
        """Start stack, fetch the Desk page, verify HTML structure."""
        secretary.stop_all()
        secretary.start_infrastructure()
        secretary.run_db_migrations()
        secretary.start_app_services(foreground=False)

        try:
            time.sleep(8)
            url = "http://127.0.0.1:3000"
            req = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(req, timeout=10) as resp:
                body = resp.read().decode("utf-8")
                assert resp.status == 200
                assert "Secretary" in body or "secretary" in body.lower()
                assert "<!DOCTYPE html>" in body or "<html" in body
        finally:
            secretary.stop_all()

    def test_worker_api_health_endpoint(self):
        """Start stack, hit worker /health/ready, verify JSON response."""
        secretary.stop_all()
        secretary.start_infrastructure()
        secretary.run_db_migrations()
        secretary.start_app_services(foreground=False)

        try:
            time.sleep(8)
            url = "http://127.0.0.1:4000/health/ready"
            req = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(req, timeout=10) as resp:
                body = resp.read().decode("utf-8")
                assert resp.status == 200
                assert len(body) > 0
        finally:
            secretary.stop_all()

    def test_stt_and_tts_health_endpoints(self):
        """Start stack, verify STT and TTS report healthy."""
        secretary.stop_all()
        secretary.start_infrastructure()
        secretary.run_db_migrations()
        secretary.start_app_services(foreground=False)

        try:
            time.sleep(10)
            for url in ["http://127.0.0.1:5001/health", "http://127.0.0.1:5002/health"]:
                req = urllib.request.Request(url, method="GET")
                with urllib.request.urlopen(req, timeout=10) as resp:
                    body = resp.read().decode("utf-8")
                    assert resp.status == 200, f"{url} returned {resp.status}"
                    data = json.loads(body)
                    assert data.get("ok") is True, f"{url} health not ok: {body}"
        finally:
            secretary.stop_all()

    def test_stop_all_clears_state_file(self):
        """After stop_all(), the state file should be removed."""
        secretary.stop_all()
        assert not secretary.STATE_FILE.exists(), "State file should not exist after stop_all"

    def test_cli_status_after_stop_reports_all_down(self):
        """Run status after stop — every port should be down."""
        secretary.stop_all()
        time.sleep(2)
        for svc in secretary.APP_SERVICES:
            assert secretary.wait_for_port("127.0.0.1", svc["port"], timeout_sec=1) is False
        for svc in secretary.INFRA_SERVICES:
            assert secretary.wait_for_port("127.0.0.1", svc["port"], timeout_sec=1) is False

    def test_double_stop_is_safe(self):
        """Calling stop_all twice should not crash."""
        secretary.stop_all()
        time.sleep(1)
        secretary.stop_all()
        assert not secretary.STATE_FILE.exists()

    def test_start_after_stop_recovers_cleanly(self):
        """Full stop then full start should work."""
        secretary.stop_all()
        time.sleep(2)
        secretary.start_infrastructure()
        secretary.run_db_migrations()
        secretary.start_app_services(foreground=False)
        try:
            time.sleep(8)
            for svc in secretary.APP_SERVICES:
                assert secretary.wait_for_port("127.0.0.1", svc["port"], timeout_sec=30), \
                    f"{svc['name']} not listening after restart"
        finally:
            secretary.stop_all()

    def test_web_app_routes_exist(self):
        """Verify key pages return 200."""
        secretary.stop_all()
        secretary.start_infrastructure()
        secretary.run_db_migrations()
        secretary.start_app_services(foreground=False)
        try:
            time.sleep(10)
            routes = ["/", "/overview", "/settings"]
            for route in routes:
                url = f"http://127.0.0.1:3000{route}"
                req = urllib.request.Request(url, method="GET")
                with urllib.request.urlopen(req, timeout=10) as resp:
                    assert resp.status == 200, f"{route} returned {resp.status}"
        finally:
            secretary.stop_all()

    def test_worker_health_depends_on_postgres_and_redis(self):
        """Verify worker health includes dependency checks."""
        secretary.stop_all()
        secretary.start_infrastructure()
        secretary.run_db_migrations()
        secretary.start_app_services(foreground=False)
        try:
            time.sleep(8)
            url = "http://127.0.0.1:4000/health/ready"
            req = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(req, timeout=10) as resp:
                body = json.loads(resp.read().decode("utf-8"))
                assert body.get("ok") is True
                assert body.get("dependencies", {}).get("postgres") == "ok"
                assert body.get("dependencies", {}).get("redis") == "ok"
        finally:
            secretary.stop_all()


class TestCommandLineInvocation:
    """Verify the script can be invoked via subprocess with various flags."""

    def test_cli_help_returns_zero(self):
        result = subprocess.run(
            [sys.executable, "secretary.py", "--help"],
            cwd=str(secretary.REPO_ROOT),
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0
        assert "Secretary AI" in result.stdout

    def test_cli_status_returns_zero(self):
        result = subprocess.run(
            [sys.executable, "secretary.py", "--status", "--no-color"],
            cwd=str(secretary.REPO_ROOT),
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0
        assert "Secretary Status" in result.stdout

    def test_cli_stop_returns_zero_when_nothing_running(self):
        secretary.stop_all()
        result = subprocess.run(
            [sys.executable, "secretary.py", "--stop", "--no-color"],
            cwd=str(secretary.REPO_ROOT),
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0

    def test_cli_no_color_flag_disables_ansi(self):
        result = subprocess.run(
            [sys.executable, "secretary.py", "--status", "--no-color"],
            cwd=str(secretary.REPO_ROOT),
            capture_output=True,
            text=True,
        )
        assert "\033[" not in result.stdout, "ANSI codes found in --no-color output"

    def test_cli_invalid_flag_shows_help(self):
        result = subprocess.run(
            [sys.executable, "secretary.py", "--not-a-real-flag"],
            cwd=str(secretary.REPO_ROOT),
            capture_output=True,
            text=True,
        )
        assert result.returncode != 0
        assert "unrecognized arguments" in (result.stderr + result.stdout).lower()

    def test_cli_status_with_services_running(self):
        secretary.stop_all()
        secretary.start_infrastructure()
        secretary.run_db_migrations()
        secretary.start_app_services(foreground=False)
        try:
            time.sleep(5)
            result = subprocess.run(
                [sys.executable, "secretary.py", "--status", "--no-color"],
                cwd=str(secretary.REPO_ROOT),
                capture_output=True,
                text=True,
            )
            assert result.returncode == 0
            assert "listening" in result.stdout or "running" in result.stdout
        finally:
            secretary.stop_all()

    def test_cli_logs_when_no_log_file_exists(self):
        secretary.stop_all()
        if secretary.LOGS_DIR.exists():
            for f in secretary.LOGS_DIR.iterdir():
                f.unlink()
        result = subprocess.run(
            [sys.executable, "secretary.py", "--logs", "--no-color"],
            cwd=str(secretary.REPO_ROOT),
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0
        assert "no log file" in (result.stderr + result.stdout).lower() or "no log" in (result.stderr + result.stdout).lower()


class TestFailureRecovery:
    """Test how the system behaves under failures and partial states."""

    def test_start_without_install_still_works_if_already_installed(self):
        """--start should work if the repo was previously installed."""
        secretary.stop_all()
        time.sleep(2)
        # start should bootstrap infra + apps
        secretary.start_infrastructure()
        secretary.run_db_migrations()
        secretary.start_app_services(foreground=False)
        try:
            time.sleep(8)
            assert secretary.wait_for_port("127.0.0.1", 3000, timeout_sec=30)
        finally:
            secretary.stop_all()

    def test_state_file_with_stale_pid_is_overwritten(self):
        """If state has a dead PID, starting should overwrite it."""
        secretary.stop_all()
        secretary.save_state({"service_runner_pid": 99999, "started_at": "old"})
        # The PID is fake/dead
        assert not secretary.is_pid_alive(99999)
        secretary.start_infrastructure()
        secretary.run_db_migrations()
        secretary.start_app_services(foreground=False)
        try:
            time.sleep(8)
            state = secretary.load_state()
            new_pid = state.get("service_runner_pid")
            assert new_pid is not None
            assert new_pid != 99999
            assert secretary.is_pid_alive(new_pid)
        finally:
            secretary.stop_all()

    def test_corrupt_state_file_is_handled(self):
        """A corrupt state file should not prevent start/stop."""
        secretary.stop_all()
        secretary.STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        secretary.STATE_FILE.write_text("{invalid json")
        # stop_all should handle this
        secretary.stop_all()
        assert not secretary.STATE_FILE.exists()

    def test_missing_service_runner_is_detected(self):
        """If service-runner.mjs is missing, start should fail clearly."""
        with patch.object(secretary, "SERVICE_RUNNER", Path("/nonexistent/runner.mjs")):
            try:
                secretary.start_app_services(foreground=False)
                assert False, "Should have raised RuntimeError"
            except RuntimeError as e:
                assert "service-runner" in str(e).lower()
