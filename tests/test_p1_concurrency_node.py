"""Run the checked-in BFF/actor suite inside the retained source snapshot.

No install, network, cloud credentials, local source-copy fallback or skip is used.
Node 24 is supplied explicitly, on PATH, or by the hosted runner's existing tool cache.
"""
from pathlib import Path
import os
import re
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]


def node_runtime():
    explicit = os.environ.get("JUNGSI_NODE")
    if explicit:
        candidates = [Path(explicit)]
    else:
        candidates = [Path(value) for value in [shutil.which("node")] if value]
        cache = os.environ.get("RUNNER_TOOL_CACHE")
        if cache:
            base = Path(cache) / "node"
            candidates.extend(sorted(base.glob("24.*/x64/bin/node"), reverse=True))
            candidates.extend(sorted(base.glob("24.*/x64/node.exe"), reverse=True))
    for candidate in candidates:
        result = subprocess.run([str(candidate), "--version"], capture_output=True, timeout=10)
        if result.returncode == 0 and re.fullmatch(rb"v24\.[0-9]+\.[0-9]+\s*", result.stdout):
            return str(candidate)
        if explicit:
            break
    raise RuntimeError("Existing Node 24 is required for P1 concurrency verification; set JUNGSI_NODE. No install or skip fallback.")


class P1ConcurrencyNodeTests(unittest.TestCase):
    def test_fixed_snapshot_actor_and_bff_cases(self):
        web = ROOT / "apps/web"
        cases = ["tests/p1-coordinator.test.mjs", "tests/p1-snapshot.test.mjs"]
        self.assertTrue(all((web / path).is_file() for path in cases), "Registered Node suites are missing from the retained snapshot")
        result = subprocess.run([node_runtime(), "--experimental-transform-types", "--test", "--test-reporter=tap", *cases],
                                cwd=web, capture_output=True, timeout=120)
        output = result.stdout.decode("utf-8", errors="replace")
        self.assertEqual(result.returncode, 0, (output + result.stderr.decode("utf-8", errors="replace"))[-12000:])
        counts = {name: int(value) for name, value in re.findall(r"^# (tests|pass|fail|skipped|cancelled) ([0-9]+)$", output, re.M)}
        self.assertGreaterEqual(counts.get("tests", 0), 36)
        self.assertEqual(counts.get("pass"), counts["tests"])
        for name in ("fail", "skipped", "cancelled"):
            self.assertEqual(counts.get(name), 0)
        print("P1_NODE_CASES=" + str(counts["tests"]))


if __name__ == "__main__":
    unittest.main()
