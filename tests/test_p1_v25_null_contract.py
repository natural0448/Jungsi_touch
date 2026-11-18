"""Run changed P1 and private member-result contracts in the fixed Git snapshot."""
from __future__ import annotations

import os
from pathlib import Path
import re
import subprocess
import unittest


class P1AndMemberResultsContractTest(unittest.TestCase):
    def test_changed_contracts_with_the_registered_deno(self) -> None:
        root = Path(__file__).resolve().parents[1]
        executable = Path(os.environ.get("JUNGSI_DENO", ""))
        scratch = Path(os.environ.get("JUNGSI_REVIEW_SUITE_SCRATCH", ""))
        self.assertTrue(executable.is_absolute() and executable.is_file(),
                        "The retained suite requires its explicitly configured Deno")
        self.assertTrue(scratch.is_absolute() and scratch.is_dir(),
                        "The retained suite requires its explicitly configured scratch")
        env = os.environ.copy()
        env.update({"DENO_DIR": str(scratch / "cache" / "p1-v25-null"),
                    "DENO_NO_UPDATE_CHECK": "1", "TEMP": str(scratch / "tmp"),
                    "TMP": str(scratch / "tmp"), "TMPDIR": str(scratch / "tmp")})
        result = subprocess.run(
            [str(executable), "test", "--no-remote", "--no-npm", "--no-lock",
             "tests/member_results_review_20261113/test_v25_null_preservation.synthetic.ts",
             "tests/member_results_review_20261113/test_member_school_results.synthetic.mjs",
             "tests/member_results_review_20261113/test_member_school_results_storage.synthetic.ts",
             "tests/member_results_review_20261113/test_member_school_results_batches.synthetic.ts",
             "tests/edge/test_member_shortlist_storage_bridge.synthetic.mjs",
             "tests/member_results_review_20261113/test_member_school_results_writer.synthetic.ts"],
            cwd=root, env=env, capture_output=True, timeout=60,
        )
        self.assertEqual(result.returncode, 0, "Changed contracts failed in the fixed snapshot")
        output = result.stdout.decode("utf-8", errors="replace")
        self.assertRegex(output, re.compile(r"\b42 passed\b[^\n]*\b0 failed\b"))
        self.assertNotIn("ignored", output)


if __name__ == "__main__":
    unittest.main()
