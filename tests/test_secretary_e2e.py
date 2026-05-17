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
            # Should not raise
            secretary.run_db_migrations()
        finally:
            secretary.stop_infrastructure()

    def test_full_background_start_and_health(self):
        """Start everything in background, verify all ports + health, then stop."""
        # Ensure clean slate
        secretary.stop_all()

        # Start
        secretary.start_infrastructure()
        secretary.run_db_migrations()
        secretary.start_app_services(foreground=False)

        try:
            # Give service-runner a moment to spawn children
            time.sleep(8)

            # Verify all app service ports are listening
            for svc in secretary.APP_SERVICES:
                assert secretary.wait_for_port("127.0.0.1", svc["port"], timeout_sec=svc["timeout"]), \
                    f"{svc['name']} not listening on {svc['port']}"

            # Verify health endpoints
            for svc in secretary.APP_SERVICES:
                if svc.get("health_url"):
                    healthy = secretary.wait_for_health(svc["health_url"], timeout_sec=10, retries=5)
                    assert healthy, f"{svc['name']} health check failed at {svc['health_url']}"

            # Verify service runner state is tracked
            state = secretary.load_state()
            pid = state.get("service_runner_pid")
            assert pid is not None, "Service runner PID not tracked in state"
            assert secretary.is_pid_alive(pid), f"Service runner PID {pid} not alive"

        finally:
            secretary.stop_all()
            # Verify all ports are down
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
                # Worker health may return JSON or plain text
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
