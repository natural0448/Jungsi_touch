"""The 503 runtime cases share one JUnit run without changing the frozen baseline."""
from copy import deepcopy
import json
from pathlib import Path
import re
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET

from check_edge_contract import EdgeFailure
from check_project_consistency import (
    AUTH_503_RUNTIME_CASE_NAMES, AUTH_503_RUNTIME_TEST_PATH,
    AUTH_503_SOURCE_PATHS, auth_503_runtime_registration,
)
from run_edge_tests import require_no_auth_runtime_overlap, split_auth_runtime_foundation
from run_committed_tests import summarize_edge_units

ROOT = Path(__file__).resolve().parents[1]


def compact_spec():
    original = json.loads((ROOT / "docs/current/service_spec.json").read_text(encoding="utf-8"))
    _, errors = auth_503_runtime_registration(original)
    if errors:
        raise AssertionError("invalid original AUTH-503 registration: " + ", ".join(errors))
    followup = deepcopy(original["supabase_deployment_contract"]["live_execution"]["auth_503_cancel_followup_20261112"])
    paths = set(AUTH_503_SOURCE_PATHS) | {AUTH_503_RUNTIME_TEST_PATH}
    edge = original["edge_harness"]
    files = {p: deepcopy(edge["files"][p]) for p in paths}
    index = original["workflow"]["documentation_sync"]["code_index"]["edge_sources"]["files"]
    entries = [deepcopy(item) for item in index if item["path"] in paths]
    result = {"supabase_deployment_contract": {"live_execution": {"auth_503_cancel_followup_20261112": followup}},
              "edge_harness": {"files": files, "tests": list(edge["tests"]), "unit_count": edge["unit_count"]},
              "workflow": {"documentation_sync": {"code_index": {"edge_sources": {"files": entries}}}}}
    if "current_source_rebounds_20261113" in original:
        result["current_source_rebounds_20261113"] = deepcopy(original["current_source_rebounds_20261113"])
    overlay_name = "member_school_results_current_source_overlay_20261113"
    if overlay_name in original:
        overlay = original[overlay_name]
        result[overlay_name] = deepcopy(overlay)
        result["current_aux_source_rebounds_20261113"] = deepcopy(original["current_aux_source_rebounds_20261113"])
        result["university_scoring_contract"] = {"scoped_reference_contract": {
            "verification_current_source_rebound_20261113_v2": deepcopy(
                original["university_scoring_contract"]["scoped_reference_contract"]
                ["verification_current_source_rebound_20261113_v2"]),
        }}
        result["backend_platform_contract"] = {
            key: deepcopy(original["backend_platform_contract"][key])
            for key in ("university_cancellation_test_extension", "stage_projection_source_extension")
        }
        pins = set(overlay["source_bindings"])
        for path in pins:
            if not path.startswith("scripts/"):
                result["edge_harness"]["files"][path] = deepcopy(edge["files"][path])
        code_index = original["workflow"]["documentation_sync"]["code_index"]
        target_index = result["workflow"]["documentation_sync"]["code_index"]
        target_index["files"] = [deepcopy(row) for row in code_index["files"] if row["path"] in pins]
        target_index["edge_sources"]["files"] = [deepcopy(row) for row in index if row["path"] in paths | pins]
    saved_name = "saved_report_current_source_overlay_20261113_v1"
    if saved_name in original:
        # Keep the current source overlay together with its original pinned
        # historical receipts; a truncated overlay is not a valid fixture.
        saved = original[saved_name]
        result[saved_name] = deepcopy(saved)
        pins = set(saved["source_bindings"]) | set(result[overlay_name]["source_bindings"])
        for path in pins:
            if path in edge["files"]:
                result["edge_harness"]["files"][path] = deepcopy(edge["files"][path])
        code_index = original["workflow"]["documentation_sync"]["code_index"]
        target_index = result["workflow"]["documentation_sync"]["code_index"]
        target_index["files"] = [deepcopy(row) for row in code_index["files"] if row["path"] in pins]
        target_index["edge_sources"]["files"] = [deepcopy(row) for row in index if row["path"] in paths | pins]
        supply = original["current_public_supply_contract"]
        result["current_public_supply_contract"] = {
            key: deepcopy(supply[key]) for key in (
                "verification", "own_2027_batch_verification", "snapshot_batch_verification",
                "current_page_projection_verification",
            )
        }
        result["p1_selection_bridge_review_verification"] = deepcopy(
            original["p1_selection_bridge_review_verification"]
        )
    return result


def runtime_names():
    source = (ROOT / AUTH_503_RUNTIME_TEST_PATH).read_text(encoding="utf-8")
    names = re.findall(r"Deno\.test\(\s*[\"']([^\"']+)", source)
    if len(names) != 30 or tuple(names[-5:]) != AUTH_503_RUNTIME_CASE_NAMES:
        raise AssertionError("runtime fixture does not match the fixed 25+5 registration")
    return names


def junit(base_count=656):
    root = ET.Element("testsuites")
    for index in range(base_count - 25):
        ET.SubElement(root, "testcase", classname="./tests/edge/synthetic_baseline.ts", name=f"baseline-{index}", time="0.001")
    for name in runtime_names():
        ET.SubElement(root, "testcase", classname="./" + AUTH_503_RUNTIME_TEST_PATH, name=name, time="0.001")
    return root


def partition(tree, baseline, suite):
    content = ET.tostring(tree, encoding="utf-8")
    with patch.object(Path, "is_file", return_value=True), patch.object(Path, "read_bytes", return_value=content):
        return split_auth_runtime_foundation("synthetic.junit.xml", baseline, suite)


class Runtime503PartitionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec = compact_spec()
        cls.suite, errors = auth_503_runtime_registration(cls.spec)
        if errors or cls.suite is None:
            raise AssertionError(errors)

    def test_foundation_and_runtime_cases_share_one_junit_without_double_count(self):
        base, extra = partition(junit(), 656, self.suite)
        self.assertEqual((base["tests_run"], extra["tests_run"]), (656, 5))
        result = summarize_edge_units({"unit": base, "auth_503_unit": {"tests_run": 27, "failures": 0, "errors": 0, "skipped": 0},
                                       "auth_503_runtime_unit": extra}, 656, False, auth_503_required=True, auth_503_runtime_required=True)
        self.assertEqual(result["total_tests"], 688)

    def test_recovery_partition_keeps_625_plus_31_baseline_and_five_extra(self):
        base, extra = partition(junit(625), 625, self.suite)
        self.assertEqual((base["tests_run"] + 31, extra["tests_run"]), (656, 5))

    def test_missing_duplicated_replaced_or_cross_file_case_fails_closed(self):
        for kind in ("missing", "duplicate", "replace_old", "other_file", "skip", "failure"):
            tree = junit()
            cases = list(tree)
            if kind == "missing":
                tree.remove(cases[-1])
            elif kind == "duplicate":
                cases[0].set("classname", "./" + AUTH_503_RUNTIME_TEST_PATH)
                cases[0].set("name", AUTH_503_RUNTIME_CASE_NAMES[0])
            elif kind == "replace_old":
                cases[-6].set("name", "replacement baseline case")
            elif kind == "other_file":
                cases[0].set("name", AUTH_503_RUNTIME_CASE_NAMES[0])
            elif kind == "skip":
                ET.SubElement(cases[-1], "skipped")
            else:
                ET.SubElement(cases[-1], "failure")
            with self.subTest(kind=kind), self.assertRaises(EdgeFailure):
                partition(tree, 656, self.suite)

    def test_historical_foundation_without_extension_is_unchanged(self):
        tree = junit()
        for case in list(tree)[-5:]:
            tree.remove(case)
        base, extra = partition(tree, 656, None)
        self.assertEqual(base["tests_run"], 656)
        self.assertIsNone(extra)
        self.assertEqual(auth_503_runtime_registration({}), (None, []))

    def test_separate_auth_suite_cannot_repeat_runtime_case_names(self):
        tree = ET.Element("testsuites")
        ET.SubElement(tree, "testcase", classname="./tests/edge/test_auth_exchange_observation.synthetic.ts",
                      name=AUTH_503_RUNTIME_CASE_NAMES[0], time="0.001")
        content = ET.tostring(tree, encoding="utf-8")
        with patch.object(Path, "read_bytes", return_value=content), self.assertRaises(EdgeFailure):
            require_no_auth_runtime_overlap("synthetic-auth.junit.xml", self.suite)

    def test_registration_rejects_missing_or_forged_source_and_cases(self):
        for kind in ("wrong_name", "wrong_sha", "duplicate_index", "bool_count", "missing_auth", "missing_foundation_path"):
            candidate = deepcopy(self.spec)
            followup = candidate["supabase_deployment_contract"]["live_execution"]["auth_503_cancel_followup_20261112"]
            suite = followup["runtime_integration_suite"]
            if kind == "wrong_name":
                suite["case_names"][0] = "replacement"
            elif kind == "wrong_sha":
                suite["test_source_sha256"] = "0" * 64
            elif kind == "duplicate_index":
                entries = candidate["workflow"]["documentation_sync"]["code_index"]["edge_sources"]["files"]
                entries.extend([{"path": AUTH_503_RUNTIME_TEST_PATH, "source_sha256": suite["test_source_sha256"]}] * 2)
            elif kind == "bool_count":
                suite["test_count"] = True
            elif kind == "missing_auth":
                followup.pop("synthetic_suite")
            else:
                candidate["edge_harness"]["tests"].remove(AUTH_503_RUNTIME_TEST_PATH)
            with self.subTest(kind=kind):
                result, errors = auth_503_runtime_registration(candidate)
                self.assertIsNone(result)
                self.assertTrue(errors)

    def test_current_rebound_projection_preserves_and_validates_original(self):
        original = json.loads((ROOT / "docs/current/service_spec.json").read_text(encoding="utf-8"))
        if "current_source_rebounds_20261113" not in original:
            self.skipTest("historical fixture does not declare the current rebound")
        untouched = deepcopy(original)
        compact = compact_spec()
        self.assertEqual(compact["current_source_rebounds_20261113"], original["current_source_rebounds_20261113"])
        self.assertIsNot(compact["current_source_rebounds_20261113"], original["current_source_rebounds_20261113"])
        self.assertEqual(auth_503_runtime_registration(compact)[1], [])
        self.assertEqual(original, untouched)
        path = next(iter(original["current_source_rebounds_20261113"]["families"]["auth"]["changed_source_bindings"]))
        for kind in ("missing_sibling", "missing_family", "forged_sibling", "missing_edge", "missing_index", "forged_index"):
            damaged = deepcopy(original)
            marker = damaged["current_source_rebounds_20261113"]
            if kind == "missing_sibling": damaged.pop("current_source_rebounds_20261113")
            elif kind == "missing_family": marker["families"].pop("auth")
            elif kind == "forged_sibling": marker["families"]["auth"]["changed_source_bindings"][path] = "0" * 64
            elif kind == "missing_edge": damaged["edge_harness"]["files"].pop(path)
            else:
                rows = damaged["workflow"]["documentation_sync"]["code_index"]["edge_sources"]["files"]
                if kind == "missing_index": rows[:] = [row for row in rows if row.get("path") != path]
                else: next(row for row in rows if row.get("path") == path)["source_sha256"] = "0" * 64
            with self.subTest(kind=kind), patch.object(Path, "read_text", return_value=json.dumps(damaged)):
                with self.assertRaisesRegex(AssertionError, "invalid original AUTH-503 registration"):
                    compact_spec()

    def test_saved_report_projection_preserves_receipts_and_rejects_promotion(self):
        original = json.loads((ROOT / "docs/current/service_spec.json").read_bytes())
        name = "saved_report_current_source_overlay_20261113_v1"
        if name not in original:
            self.skipTest("historical fixture does not declare the saved report overlay")
        compact = compact_spec()
        self.assertEqual(compact[name], original[name])
        self.assertIsNot(compact[name], original[name])
        self.assertEqual(auth_503_runtime_registration(compact)[1], [])
        damaged = deepcopy(original)
        damaged[name]["activation_status"] = "PASS"
        with patch.object(Path, "read_text", return_value=json.dumps(damaged)):
            with self.assertRaisesRegex(AssertionError, "invalid original AUTH-503 registration"):
                compact_spec()

    def test_historical_27_only_registration_remains_valid_but_unregistered_five_fail(self):
        historical = deepcopy(self.spec)
        historical["supabase_deployment_contract"]["live_execution"]["auth_503_cancel_followup_20261112"].pop("runtime_integration_suite")
        self.assertEqual(auth_503_runtime_registration(historical), (None, []))
        with self.assertRaises(EdgeFailure):
            partition(junit(), 656, None)


if __name__ == "__main__":
    unittest.main()
