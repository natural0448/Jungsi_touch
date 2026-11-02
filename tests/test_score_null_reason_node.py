"""Run the score-null evidence projection tests from the retained source snapshot.

Synthetic-only: the runner accesses no DB, network, actual evidence or publication.
Node 24 is the same preinstalled runtime used by the existing P1 checks.
"""
from pathlib import Path
import re
import subprocess
import unittest

from test_p1_concurrency_node import node_runtime

ROOT = Path(__file__).resolve().parents[1]
SOURCE = "supabase/functions/_shared/jungsi/application/score_null_reason_review.ts"
TEST = "tests/service_p1/test_score_null_reason_review.synthetic.mjs"
EXPECTED = 33


class ScoreNullReasonNodeTests(unittest.TestCase):
    def test_scoped_evidence_and_unknown_cells(self):
        self.assertTrue((ROOT / SOURCE).is_file())
        self.assertTrue((ROOT / TEST).is_file())
        result = subprocess.run(
            [node_runtime(), "--experimental-transform-types", "--test", "--test-reporter=tap", TEST],
            cwd=ROOT, capture_output=True, timeout=120,
        )
        output = result.stdout.decode("utf-8", errors="replace")
        self.assertEqual(result.returncode, 0, (output + result.stderr.decode("utf-8", errors="replace"))[-12000:])
        counts = {name: int(value) for name, value in re.findall(
            r"^# (tests|pass|fail|skipped|cancelled) ([0-9]+)$", output, re.M,
        )}
        self.assertEqual(counts.get("tests"), EXPECTED)
        self.assertEqual(counts.get("pass"), EXPECTED)
        for name in ("fail", "skipped", "cancelled"):
            self.assertEqual(counts.get(name), 0)
        print("SCORE_NULL_REASON_SYNTHETIC_CASES=" + str(EXPECTED))


if __name__ == "__main__":
    unittest.main()
