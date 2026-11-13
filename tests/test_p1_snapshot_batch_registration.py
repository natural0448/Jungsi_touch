"""Synthetic contract tests for the unactivated snapshot batch suite."""
import copy
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import run_edge_tests as runner
from check_project_consistency import SAVED_REPORT_OVERLAY_FIELD, SAVED_REPORT_RECEIPT_PATHS
from saved_report_registration_fixture import current_source_hashes


class SnapshotBatchRegistrationTests(unittest.TestCase):
    def setUp(self):
        self.spec = json.loads((ROOT / "docs/current/service_spec.json").read_text(encoding="utf-8"))
        self.contract = self.spec["current_public_supply_contract"]["snapshot_batch_verification"]
        self.before = current_source_hashes(self.spec, self.contract)

    def test_current_registration_is_pinned(self):
        history = copy.deepcopy(self.contract)
        expected = copy.deepcopy(history)
        overlay = self.spec.get(SAVED_REPORT_OVERLAY_FIELD)
        if overlay is not None:
            pins = overlay["source_bindings"]
            for row in expected["source_bindings"]:
                if row["path"] in SAVED_REPORT_RECEIPT_PATHS["snapshot_batch"]:
                    row["sha256"] = pins[row["path"]]
        self.assertEqual(runner.current_public_snapshot_batch_registration(self.spec, self.before), expected)
        self.assertEqual(self.contract, history)

    def test_missing_registration_fails_when_candidate_exists(self):
        spec = copy.deepcopy(self.spec)
        del spec["current_public_supply_contract"]["snapshot_batch_verification"]
        with self.assertRaisesRegex(runner.EdgeFailure, "snapshot_batch_verification_missing"):
            runner.current_public_snapshot_batch_registration(spec, self.before)

    def test_changed_hash_or_count_is_rejected(self):
        bad_hash = dict(self.before)
        bad_hash[self.contract["test_path"]] = "0" * 64
        with self.assertRaisesRegex(runner.EdgeFailure, "snapshot_batch_source_or_test_binding_invalid"):
            runner.current_public_snapshot_batch_registration(self.spec, bad_hash)
        spec = copy.deepcopy(self.spec)
        spec["current_public_supply_contract"]["snapshot_batch_verification"]["test_count"] = 1
        error = ("saved_report_receipt_source_binding_invalid" if SAVED_REPORT_OVERLAY_FIELD in spec
                 else "snapshot_batch_source_or_test_binding_invalid")
        with self.assertRaisesRegex(runner.EdgeFailure, error):
            runner.current_public_snapshot_batch_registration(spec, self.before)
