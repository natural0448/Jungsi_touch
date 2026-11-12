"""Synthetic checks for separate Edge suite totals; no external files or network."""
from copy import deepcopy
import unittest

from run_committed_tests import (reference_db_unit_count, summarize_edge_units,
                                 university_cancellation_unit_required)


def unit(count):
    return {"tests_run": count, "failures": 0, "errors": 0, "skipped": 0}


class EdgeUnitAggregationTests(unittest.TestCase):
    def test_includes_recovery_and_keeps_oracle_out_of_test_total(self):
        edge = {
            "unit": unit(656),
            "owner_review_unit": unit(43),
            "incident_recovery_unit": unit(50),
            "oracle": {"case_count": 993, "mismatch_count": 0},
        }
        result = summarize_edge_units(edge, 656, True)
        self.assertEqual(result["total_tests"], 749)
        self.assertEqual(result["by_suite"]["incident_recovery_unit"], 50)
        self.assertNotIn("oracle", result["by_suite"])

    def test_preserves_legacy_suite_count_without_recovery(self):
        result = summarize_edge_units({"unit": unit(656), "owner_review_unit": unit(36)}, 656, False)
        self.assertEqual(result["total_tests"], 692)

    def test_missing_unregistered_failed_unknown_or_wrong_count_fails(self):
        good = {"unit": unit(656), "incident_recovery_unit": unit(50)}
        variants = []
        missing = deepcopy(good)
        del missing["incident_recovery_unit"]
        variants.append((missing, True))
        variants.append((deepcopy(good), False))
        for key, value in [
            ("incident_recovery_unit", {"tests_run": 49, "failures": 0, "errors": 0, "skipped": 0}),
            ("incident_recovery_unit", {"tests_run": 50, "failures": 0, "errors": 0, "skipped": 1}),
            ("unit", unit(655)),
            ("unknown_unit", unit(1)),
        ]:
            changed = deepcopy(good)
            changed[key] = value
            variants.append((changed, True))
        for edge, required in variants:
            with self.assertRaises(ValueError):
                summarize_edge_units(edge, 656, required)


    def test_reference_db_counts_are_required_and_cannot_be_fabricated(self):
        base = {"unit": unit(656)}
        complete = {**base, "reference_db_unit": unit(193)}
        result = summarize_edge_units(complete, 656, False, reference_db_count=193)
        self.assertEqual(result["total_tests"], 849)
        self.assertEqual(result["by_suite"]["reference_db_unit"], 193)
        for edge, count in ((base, 193), (complete, None), (complete, 192),
                            ({**base, "reference_db_unit": unit(192)}, 193),
                            (complete, True), (complete, 0)):
            with self.subTest(count=count), self.assertRaises(ValueError):
                summarize_edge_units(edge, 656, False, reference_db_count=count)

    def test_reference_db_count_is_taken_from_registered_spec(self):
        self.assertIsNone(reference_db_unit_count({}))
        self.assertEqual(reference_db_unit_count(
            {"backend_platform_contract": {"reference_db_test_extension": {"test_count": 193}}}
        ), 193)
        for value in (True, 0, "193"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                reference_db_unit_count(
                    {"backend_platform_contract": {"reference_db_test_extension": {"test_count": value}}}
                )

    def test_registered_university_cancellation_suite_is_counted_separately(self):
        edge = {"unit": unit(656), "university_cancellation_unit": unit(6)}
        result = summarize_edge_units(edge, 656, False, university_cancellation_required=True)
        self.assertEqual(result["total_tests"], 662)
        self.assertEqual(result["by_suite"]["unit"], 656)
        self.assertEqual(result["by_suite"]["university_cancellation_unit"], 6)
        self.assertEqual(summarize_edge_units({"unit": unit(656)}, 656, False)["total_tests"], 656)

    def test_cancellation_result_cannot_be_missing_unregistered_or_incomplete(self):
        base = {"unit": unit(656)}
        good = {**base, "university_cancellation_unit": unit(6)}
        variants = [(base, True), (good, False)]
        for key, value in (("tests_run", 5), ("tests_run", 7), ("tests_run", True),
                           ("failures", 1), ("errors", 1), ("skipped", 1)):
            changed = deepcopy(good)
            changed["university_cancellation_unit"][key] = value
            variants.append((changed, True))
        for edge, required in variants:
            with self.subTest(edge=edge, required=required), self.assertRaises(ValueError):
                summarize_edge_units(edge, 656, False, university_cancellation_required=required)
        with self.assertRaises(ValueError):
            summarize_edge_units(good, 656, False, university_cancellation_required=1)

    def test_cancellation_requirement_rejects_malformed_registration(self):
        self.assertFalse(university_cancellation_unit_required({}))
        ext = {
            "format": "jungsi.university-cancellation-tests/v1",
            "status": "SOURCE_REGISTERED_NOT_EXECUTED",
            "test_count": 6,
            "test_paths": ["tests/edge/test_university_analysis_cancellation.ts"],
        }
        self.assertTrue(university_cancellation_unit_required(
            {"backend_platform_contract": {"university_cancellation_test_extension": ext}}
        ))
        for key, value in (("format", "other"), ("status", "PASS"), ("test_count", 5),
                           ("test_count", True), ("test_paths", [])):
            invalid = deepcopy(ext)
            invalid[key] = value
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                university_cancellation_unit_required(
                    {"backend_platform_contract": {"university_cancellation_test_extension": invalid}}
                )
        for invalid in (None, [], "invalid"):
            with self.subTest(value=invalid), self.assertRaises(ValueError):
                university_cancellation_unit_required(
                    {"backend_platform_contract": {"university_cancellation_test_extension": invalid}}
                )


if __name__ == "__main__":
    unittest.main()
