"""Source-only stage guard continuation never re-labels a historical native PASS."""
import copy
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import check_project_consistency as checker


class StageProjectionGuardTests(unittest.TestCase):
    def fixture(self):
        s = json.loads((ROOT / "docs/current/service_spec.json").read_bytes())
        c = s["score_input_policy_contract"]
        rows = []
        for path in checker.STAGE_PROJECTION_SOURCE_PATHS:
            s["edge_harness"]["files"].setdefault(path, {"layer": "verification", "declarations": {}})
            s["edge_harness"]["files"][path]["declarations"]["source_sha256"] = "1" * 64
            rows.append({"path": path, "sha256": "1" * 64})
        source = checker.NATIVE_GUARD_SOURCE_PATH
        c["current_source_bindings"][source] = "1" * 64
        new_test = "tests/edge/test_score_input_stage_projection.ts"
        view = s["read_view_extension_contract"]["verification"]["test_paths"]
        if new_test not in view:
            view.append(new_test)
        s["backend_platform_contract"].pop("native_edge_v5_extension", None)
        s["backend_platform_contract"]["stage_projection_source_extension"] = {
            "format": "jungsi.stage-projection-source-extension/v1",
            "status": "SOURCE_REGISTERED_NOT_ACTIVATED",
            "baseline_commit": checker.RECOVERY_BASELINE_COMMIT,
            "source_bindings": rows,
            "verification": {
                "baseline_foundation_count": 656,
                "baseline_score_input_count": 31,
                "added_stage_count": 4,
                "test_path": new_test,
                "case_names": list(checker.STAGE_PROJECTION_CASE_NAMES),
            },
            "native_API_empty_guard": "NOT_RUN",
            "authenticated_API_verified": False,
            "rollout_approved": False,
            "writes": 0,
        }
        c["native_SQL_preparation_evidence"]["guard_current_source"] = {
            "format": "jungsi.score-input-native-guard-continuation/v1",
            "historical_guard_sha256": checker.NATIVE_GUARD_HISTORY_SHA256,
            "historical_source_commit": checker.RECOVERY_BASELINE_COMMIT,
            "source_path": source,
            "source_sha256": "1" * 64,
            "native_API_empty_guard": "NOT_RUN",
            "authenticated_API_verified": False,
            "rollout_approved": False,
            "writes": 0,
        }
        return s

    def rejected(self, edit):
        s = self.fixture()
        edit(s)
        self.assertTrue(checker.validate_score_input_native_guard(s))

    def test_absent_extension_retains_original_native_boundary(self):
        s = json.loads((ROOT / "docs/current/service_spec.json").read_bytes())
        self.assertEqual(checker.validate_score_input_native_guard(s), [])

    def test_exact_new_source_remains_not_run_and_keeps_native_history(self):
        s = self.fixture()
        historical = copy.deepcopy(s["score_input_policy_contract"]["native_SQL_preparation_evidence"]["guard"])
        self.assertEqual(checker.validate_score_input_native_guard(s), [])
        self.assertEqual(historical, s["score_input_policy_contract"]["native_SQL_preparation_evidence"]["guard"])

    def test_unregistered_continuation_is_rejected(self):
        self.rejected(lambda s: s["backend_platform_contract"].pop("stage_projection_source_extension"))

    def test_modified_historical_receipt_is_rejected(self):
        self.rejected(lambda s: s["score_input_policy_contract"]["native_SQL_preparation_evidence"]["guard"].update(writes=1))

    def test_claiming_native_pass_is_rejected(self):
        self.rejected(lambda s: s["score_input_policy_contract"]["native_SQL_preparation_evidence"]["guard_current_source"].update(native_API_empty_guard="PASS"))

    def test_missing_source_is_rejected(self):
        self.rejected(lambda s: s["backend_platform_contract"]["stage_projection_source_extension"]["source_bindings"].pop())

    def test_unbound_source_hash_is_rejected(self):
        self.rejected(lambda s: s["backend_platform_contract"]["stage_projection_source_extension"]["source_bindings"][0].update(sha256="2" * 64))

    def test_case_name_or_count_drift_is_rejected(self):
        self.rejected(lambda s: s["backend_platform_contract"]["stage_projection_source_extension"]["verification"]["case_names"].pop())

    def test_boolean_test_count_is_rejected(self):
        self.rejected(lambda s: s["backend_platform_contract"]["stage_projection_source_extension"]["verification"].update(added_stage_count=True))

    def test_foundation_overlap_is_rejected(self):
        self.rejected(lambda s: s["edge_harness"]["tests"].append("tests/edge/test_score_input_stage_projection.ts"))

    def test_actual_auth_claim_is_rejected(self):
        self.rejected(lambda s: s["backend_platform_contract"]["stage_projection_source_extension"].update(authenticated_API_verified=True))

    def test_boolean_writes_is_rejected(self):
        self.rejected(lambda s: s["backend_platform_contract"]["stage_projection_source_extension"].update(writes=False))

    def test_boolean_continuation_writes_is_rejected(self):
        self.rejected(lambda s: s["score_input_policy_contract"]["native_SQL_preparation_evidence"]["guard_current_source"].update(writes=False))

    def test_recovery_combination_requires_its_own_reconciliation(self):
        self.rejected(lambda s: s["backend_platform_contract"].update(native_edge_v5_extension={}))

    def test_current_binding_and_source_index_must_match(self):
        self.rejected(lambda s: s["score_input_policy_contract"]["current_source_bindings"].update({checker.NATIVE_GUARD_SOURCE_PATH: "3" * 64}))


if __name__ == "__main__":
    unittest.main()
