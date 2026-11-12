"""Pinned synthetic regression tests for request-local diagnostics and controls."""
import hashlib
import importlib.util
import json
import os
import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXPECTED = {'tests/admin_runtime_observation/admin_observation.test.ts': '3a80b37104ca16030a081035d5fbcb91e5d98439fa6380f77fd29916c85afd53', 'tests/admin_runtime_observation/runtime_admin_observation.test.ts': '96031e1c6e53adbad4a75d557852cbacb1417f25b57add6960cfedaafc59bb54', 'tests/admin_runtime_observation/runtime_bucket_reuse.test.ts': '11ba7953d61b80a98f2b727323c5f743b3b297817ade614c81e38a9c8edc8208'}

def exact_admin_summary(output):
    matches = re.findall(r"^ok \| (\d+) passed \| (\d+) failed(?: \| (\d+) ignored)?(?: \| (\d+) filtered out)? \(", output, re.M)
    return len(matches)==1 and tuple(int(value or 0) for value in matches[0])==(11,0,0,0)


class AdminRuntimeObservationTests(unittest.TestCase):
    def test_exact_summary_rejects_skipped_or_filtered_cases(self):
        self.assertTrue(exact_admin_summary("ok | 11 passed | 0 failed (1s)"))
        for text in ("ok | 11 passed | 0 failed | 1 ignored (1s)",
                     "ok | 11 passed | 0 failed | 1 filtered out (1s)",
                     "ok | 10 passed | 0 failed (1s)",
                     "ok | 11 passed | 1 failed (1s)",
                     "ok | 11 passed | 0 failed (1s)\nok | 11 passed | 0 failed (1s)"):
            with self.subTest(text=text):
                self.assertFalse(exact_admin_summary(text))

    def test_synthetic_diagnostics_and_inflight_controls(self):
        tool_path = ROOT / "tests/test_service_candidate_suites.py"
        module_spec = importlib.util.spec_from_file_location("pinned_candidate_runtime", tool_path)
        self.assertIsNotNone(module_spec)
        self.assertIsNotNone(module_spec.loader)
        tools = importlib.util.module_from_spec(module_spec)
        module_spec.loader.exec_module(tools)
        manifest_raw = (ROOT / "tests/review_suite_manifest.json").read_bytes()
        self.assertEqual(hashlib.sha256(manifest_raw).hexdigest(), tools.MANIFEST_SHA256)
        manifest = json.loads(manifest_raw)
        deno, runtime_sha, _ = tools.selected_runtime(manifest)
        scratch = Path(os.environ.get("JUNGSI_REVIEW_SUITE_SCRATCH", ""))
        self.assertTrue(scratch.is_absolute() and (scratch / "cache").is_dir() and (scratch / "tmp").is_dir())
        self.assertFalse(scratch.resolve().is_relative_to(ROOT.resolve()))
        for name, digest in EXPECTED.items():
            path = ROOT / name
            self.assertTrue(path.is_file() and path.resolve().is_relative_to(ROOT.resolve()))
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), digest)
        env = {"DENO_DIR": str(scratch / "cache"), "TEMP": str(scratch / "tmp"), "TMP": str(scratch / "tmp"),
               "TMPDIR": str(scratch / "tmp"), "DENO_NO_UPDATE_CHECK": "1", "NO_COLOR": "1",
               "SYSTEMROOT": os.environ.get("SYSTEMROOT", ""), "PATH": os.environ.get("PATH", "")}
        cmd = [str(deno), "test", "--fail-fast", "--no-remote", "--no-npm", "--no-lock", "--config", "supabase/functions/deno.json",
               "--allow-read", "--deny-write", "--deny-net", "--deny-env", "--deny-run", "--deny-sys", "--deny-ffi", *EXPECTED]
        result = subprocess.run(cmd, cwd=ROOT, env=env, capture_output=True, text=True, encoding="utf-8", timeout=120)
        self.assertEqual(result.returncode, 0, result.stderr[-2000:])
        self.assertTrue(exact_admin_summary(result.stdout), "admin suite result count or skip mismatch")
        self.assertEqual(hashlib.sha256(deno.read_bytes()).hexdigest(), runtime_sha)
