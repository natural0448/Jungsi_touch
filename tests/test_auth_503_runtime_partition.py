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
    followup = deepcopy(original["supabase_deployment_contract"]["live_execution"]["auth_503_cancel_followup_20261112"])
    paths = set(AUTH_503_SOURCE_PATHS) | {AUTH_503_RUNTIME_TEST_PATH}
    edge = original["edge_harness"]
    files = {p: deepcopy(edge["files"][p]) for p in paths}
    index = original["workflow"]["documentation_sync"]["code_index"]["edge_sources"]["files"]
    entries = [deepcopy(item) for item in index if item["path"] in paths]
    return {"supabase_deployment_contract": {"live_execution": {"auth_503_cancel_followup_20261112": followup}},
            "edge_harness": {"files": files, "tests": list(edge["tests"]), "unit_count": edge["unit_count"]},
            "workflow": {"documentation_sync": {"code_index": {"edge_sources": {"files": entries}}}}}


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

    def test_historical_27_only_registration_remains_valid_but_unregistered_five_fail(self):
        historical = deepcopy(self.spec)
        historical["supabase_deployment_contract"]["live_execution"]["auth_503_cancel_followup_20261112"].pop("runtime_integration_suite")
        self.assertEqual(auth_503_runtime_registration(historical), (None, []))
        with self.assertRaises(EdgeFailure):
            partition(junit(), 656, None)


if __name__ == "__main__":
    unittest.main()
