"""Run real professional BFF-origin cases from the retained source snapshot."""
from pathlib import Path
import re
import subprocess
import unittest

from test_p1_concurrency_node import node_runtime

ROOT = Path(__file__).resolve().parents[1]


class ProfessionalBffNodeTests(unittest.TestCase):
    def test_original_request_origin_required_before_write(self):
        result = subprocess.run([node_runtime(), "--experimental-transform-types", "--test", "--test-reporter=tap", "tests/professional-bff-origin.test.mjs"],
                                cwd=ROOT / "apps/web", capture_output=True, timeout=60)
        output = result.stdout.decode("utf-8", errors="replace")
        self.assertEqual(result.returncode, 0, (output + result.stderr.decode("utf-8", errors="replace"))[-12000:])
        counts = {name: int(value) for name, value in re.findall(r"^# (tests|pass|fail|skipped|cancelled) ([0-9]+)$", output, re.M)}
        self.assertGreaterEqual(counts.get("tests", 0), 13)
        self.assertEqual(counts.get("pass"), counts["tests"])
        for name in ("fail", "skipped", "cancelled"):
            self.assertEqual(counts.get(name), 0)
        print("PROFESSIONAL_BFF_NODE_CASES=" + str(counts["tests"]))


if __name__ == "__main__":
    unittest.main()
