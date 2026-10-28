"""Synthetic checks for separate Edge suite totals; no external files or network."""
from copy import deepcopy
import unittest

from run_committed_tests import summarize_edge_units


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


if __name__ == "__main__":
    unittest.main()