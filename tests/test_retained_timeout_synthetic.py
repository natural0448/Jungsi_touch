"""Synthetic timeout regressions: all fixture directories and failure files are retained."""
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import run_committed_tests as runner


class SyntheticTimeoutTests(unittest.TestCase):
    def setUp(self):
        self.base = ROOT / "outputs" / "retained_timeout_tests" / uuid4().hex
        self.base.mkdir(parents=True, exist_ok=False)
        self.scratch = self.base / "scratch"
        self.scratch.mkdir()
        self.files = {
            "docs/current/service_spec.json": json.dumps({"baseline_commit": "synthetic"}).encode(),
            "tests/test_synthetic.py": b"# synthetic only\n",
        }

    def fake_snapshot(self):
        files = self.files
        return SimpleNamespace(paths=list(files), revision=None,
            read=lambda name: files[name], text=lambda name: files[name].decode())

    def outer_timeout(self, use_scratch):
        environment = dict(os.environ)
        environment.pop("JUNGSI_RETAINED_RESULTS_ROOT", None)
        if use_scratch:
            environment["JUNGSI_RETAINED_RESULTS_ROOT"] = str(self.scratch)
        timeout = subprocess.TimeoutExpired(["synthetic-child"], 2200,
            output=b"OUTER-SYN-OUT", stderr=b"OUTER-SYN-ERR")
        calls = []
        def invoke(args, **kwargs):
            calls.append((args, kwargs))
            raise timeout
        with patch.object(runner, "ROOT", self.base), \
             patch.object(runner, "GitSnapshot", return_value=self.fake_snapshot()), \
             patch.object(runner, "validate_content", return_value=[]), \
             patch.object(runner, "validate_changed_paths", return_value=[]), \
             patch.object(runner, "snapshot_changed_paths", return_value=[]), \
             patch.object(runner, "validate_snapshot_baseline", return_value=[]), \
             patch.object(runner.subprocess, "run", side_effect=invoke), \
             patch.dict(os.environ, environment, clear=True), \
             patch.object(sys, "argv", ["runner", "--staged"]), \
             contextlib.redirect_stdout(io.StringIO()):
            code = runner.main()
        self.assertEqual(code, 1)
        self.assertEqual(len(calls), 1)
        run_base = self.base / "outputs" / "committed_test_runs"
        destination, = tuple(run_base.iterdir())
        self.assertEqual((destination / "runner.stdout").read_bytes(), b"OUTER-SYN-OUT")
        self.assertEqual((destination / "runner.stderr").read_bytes(), b"OUTER-SYN-ERR")
        failure = json.loads((destination / "runner_failure.json").read_bytes())
        self.assertFalse(failure["successful"])
        self.assertEqual(failure["status"], "RETAINED_RUNNER_TIMEOUT")
        self.assertTrue(failure["timeout"])
        self.assertEqual(failure["source_manifest_sha256"],
            hashlib.sha256((destination / "source_manifest.json").read_bytes()).hexdigest())
        selected_env = calls[0][1]["env"]
        self.assertEqual(selected_env["PYTHONDONTWRITEBYTECODE"], "1")
        if use_scratch:
            location = json.loads((destination / "retained_results_location.json").read_bytes())
            result_path = Path(location["directory"])
            self.assertTrue(result_path.is_relative_to(self.scratch))
            self.assertEqual(failure["retained_results_directory"], str(result_path))
            for name in ("TEMP", "TMP", "TMPDIR", "DENO_DIR"):
                self.assertTrue(Path(selected_env[name]).is_relative_to(self.scratch))
        else:
            self.assertFalse((destination / "retained_results_location.json").exists())
            self.assertEqual(Path(failure["retained_results_directory"]), destination / "results")

    def test_outer_timeout_preserves_partial_output_and_scratch_pointer(self):
        self.outer_timeout(True)

    def test_outer_timeout_keeps_default_ci_routing(self):
        self.outer_timeout(False)

    def test_default_ci_success_keeps_gates_snapshot_and_exit_zero(self):
        environment = dict(os.environ)
        environment.pop("JUNGSI_RETAINED_RESULTS_ROOT", None)
        calls = []
        def invoke(args, **kwargs):
            calls.append((args, kwargs))
            manifest = Path(args[args.index("--source-manifest") + 1]).read_bytes()
            result = Path(args[args.index("--output-root") + 1])
            result.mkdir(parents=True, exist_ok=False)
            (result / "verification.json").write_bytes(runner.encode({
                "successful": True, "source_manifest_sha256": hashlib.sha256(manifest).hexdigest()}))
            return SimpleNamespace(returncode=0, stdout=b"PASS-SYN", stderr=b"")
        with patch.object(runner, "ROOT", self.base), \
             patch.object(runner, "GitSnapshot", return_value=self.fake_snapshot()), \
             patch.object(runner, "validate_content", return_value=[]) as content, \
             patch.object(runner, "validate_changed_paths", return_value=[]) as changed, \
             patch.object(runner, "snapshot_changed_paths", return_value=[]) as staged, \
             patch.object(runner, "validate_snapshot_baseline", return_value=[]) as baseline, \
             patch.object(runner.subprocess, "run", side_effect=invoke), \
             patch.dict(os.environ, environment, clear=True), \
             patch.object(sys, "argv", ["runner", "--staged"]), \
             contextlib.redirect_stdout(io.StringIO()):
            code = runner.main()
        self.assertEqual(code, 0)
        self.assertEqual(len(calls), 1)
        self.assertEqual(content.call_count, 1)
        self.assertEqual(changed.call_count, 1)
        self.assertEqual(baseline.call_count, 1)
        self.assertEqual(staged.call_count, 2)
        destination, = tuple((self.base / "outputs" / "committed_test_runs").iterdir())
        self.assertTrue((destination / "results" / "verification.json").is_file())
        self.assertFalse((destination / "retained_results_location.json").exists())
        self.assertEqual((destination / "runner.stdout").read_bytes(), b"PASS-SYN")

    def test_inner_edge_timeout_writes_failure_and_preserves_source(self):
        workspace = self.base / "workspace"
        for name, data in self.files.items():
            p = workspace / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(data)
        manifest = {"format": "jungsi.retained-snapshot/v1", "snapshot": "synthetic",
            "files": {name: hashlib.sha256(data).hexdigest() for name, data in self.files.items()}}
        manifest_path = self.base / "input_manifest.json"
        manifest_path.write_bytes(runner.encode(manifest))
        destination = self.scratch / "results"
        python = SimpleNamespace(returncode=0, stdout=b'JUNGSI_TEST_RESULT={"tests_run":1,"failures":0,"errors":0,"skipped":0,"successful":true}\n',
            stderr=b"PY-SYN-ERR")
        edge_timeout = subprocess.TimeoutExpired(["synthetic-edge"], 300,
            output=b"EDGE-SYN-OUT", stderr=b"EDGE-SYN-ERR")
        calls = []
        def invoke(args, **kwargs):
            calls.append((args, kwargs))
            if len(calls) == 1:
                return python
            raise edge_timeout
        with patch.object(runner, "validate_content", return_value=[]), \
             patch.object(runner, "classify_sources", return_value={"foundation_active":["SYN"],"coexisting_bound":[]}), \
             patch.object(runner.subprocess, "run", side_effect=invoke), \
             patch.object(sys, "argv", ["runner", "--snapshot-root", str(workspace),
                 "--source-manifest", str(manifest_path), "--output-root", str(destination)]), \
             contextlib.redirect_stdout(io.StringIO()):
            code = runner.main()
        self.assertEqual(code, 1)
        self.assertEqual(len(calls), 2)
        self.assertEqual((destination / "python.stdout").read_bytes(), python.stdout)
        self.assertEqual((destination / "python.stderr").read_bytes(), python.stderr)
        self.assertEqual((destination / "edge.stdout").read_bytes(), b"EDGE-SYN-OUT")
        self.assertEqual((destination / "edge.stderr").read_bytes(), b"EDGE-SYN-ERR")
        receipt = json.loads((destination / "verification.json").read_bytes())
        self.assertFalse(receipt["successful"])
        self.assertTrue(receipt["source_preserved"])
        self.assertEqual(receipt["edge"]["status"], "EDGE_TIMEOUT")
        self.assertTrue(receipt["edge"]["timeout"])
        self.assertEqual(receipt["edge"]["retained_results_directory"], str(destination.resolve()))
        self.assertEqual(receipt["source_manifest_sha256"], hashlib.sha256(runner.encode(manifest)).hexdigest())
        for name, data in self.files.items():
            self.assertEqual((workspace / name).read_bytes(), data)


if __name__ == "__main__":
    unittest.main()
