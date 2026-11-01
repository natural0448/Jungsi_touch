"""Synthetic regression for an additive, exactly registered service test suite."""
from __future__ import annotations
import copy
import json
import sys
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import check_project_consistency as checker
import run_edge_tests as edge
import run_committed_tests as runner

def loaded():
    return json.loads((ROOT / "docs/current/service_spec.json").read_bytes())

def junit_bytes(cases):
    root = ET.Element("testsuites")
    suite = ET.SubElement(root, "testsuite")
    for path, names in cases.items():
        for name in names:
            ET.SubElement(suite, "testcase", classname="./" + path, name=name)
    return ET.tostring(root, encoding="utf-8")

class ServiceAuxRegistrationTests(unittest.TestCase):
    def setUp(self):
        self.spec = loaded()
        self.ext = self.spec["backend_platform_contract"]["service_aux_test_extension"]

    def test_exact_registration_and_original_guard_are_valid(self):
        registration, errors = checker.service_aux_registration(self.spec)
        self.assertEqual(errors, [])
        self.assertEqual(registration["test_count"], 14)
        self.assertEqual(checker.validate_score_input_native_guard(self.spec), [])
        self.assertEqual(self.spec["edge_harness"]["unit_count"], 656)
        self.assertEqual(self.spec["score_input_policy_contract"]["native_SQL_preparation_evidence"]["guard_current_source"]["native_API_empty_guard"], "NOT_RUN")

    def test_missing_or_bad_registration_never_hides_extra_tests(self):
        del self.spec["backend_platform_contract"]["service_aux_test_extension"]
        self.assertIn("Read-view separate exact suite registration drift", checker.validate_read_view_extension(self.spec))
        self.spec["backend_platform_contract"]["service_aux_test_extension"] = self.ext
        self.ext["test_count"] = 13
        self.assertEqual(checker.service_aux_registration(self.spec)[1], ["Service auxiliary exact separate source/test registration invalid"])
        self.assertIn("Read-view separate exact suite registration drift", checker.validate_read_view_extension(self.spec))

    def test_tampered_case_source_status_or_overlap_fails_closed(self):
        mutations = [
            lambda x: x["case_names_by_path"][x["test_paths"][0]].append("extra"),
            lambda x: x["source_bindings"][0].update(sha256="0" * 64),
            lambda x: x.update(native_acceptance="PASS"),
            lambda x: x.update(operating_writes=1),
            lambda x: x.update(test_count=True),
        ]
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                spec = loaded(); ext = spec["backend_platform_contract"]["service_aux_test_extension"]
                mutate(ext)
                self.assertTrue(checker.service_aux_registration(spec)[1])
        self.spec["read_view_extension_contract"]["verification"]["test_paths"].append(self.ext["test_paths"][0])
        self.assertTrue(checker.service_aux_registration(self.spec)[1])

    def test_live_selected_source_hash_is_required(self):
        hashes = {row["path"]: row["sha256"] for row in self.ext["source_bindings"]}
        hashes[self.ext["regression_test"]["path"]] = self.ext["regression_test"]["sha256"]
        self.assertEqual(checker.service_aux_registration(self.spec, hashes)[1], [])
        hashes[self.ext["test_paths"][1]] = "0" * 64
        self.assertTrue(checker.service_aux_registration(self.spec, hashes)[1])

    def test_junit_requires_same_14_paths_and_names(self):
        cases = self.ext["case_names_by_path"]
        with patch.object(Path, "read_bytes", return_value=junit_bytes(cases)):
            edge.require_auxiliary_junit_identities("synthetic.xml", cases)
        changed = copy.deepcopy(cases)
        changed[self.ext["test_paths"][0]][0] += " changed"
        with patch.object(Path, "read_bytes", return_value=junit_bytes(changed)):
            with self.assertRaises(edge.EdgeFailure): edge.require_auxiliary_junit_identities("synthetic.xml", cases)

    def test_summary_requires_new_suite_and_refuses_skip(self):
        base = {"unit": {"tests_run": 656, "failures": 0, "errors": 0, "skipped": 0}}
        with self.assertRaises(ValueError): runner.summarize_edge_units(base, 656, False, True)
        base["service_candidate_aux_unit"] = {"tests_run": 14, "failures": 0, "errors": 0, "skipped": 0}
        self.assertEqual(runner.summarize_edge_units(base, 656, False, True)["total_tests"], 670)
        base["service_candidate_aux_unit"]["skipped"] = 1
        with self.assertRaises(ValueError): runner.summarize_edge_units(base, 656, False, True)
        with self.assertRaises(ValueError): runner.summarize_edge_units(base, 656, False, False)

if __name__ == "__main__":
    unittest.main()
