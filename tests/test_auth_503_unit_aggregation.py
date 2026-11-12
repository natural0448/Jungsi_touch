"""Require the separately registered authentication cancellation suite."""
from copy import deepcopy
import unittest
from run_committed_tests import auth_503_runtime_unit_required, auth_503_unit_required, summarize_edge_units


def unit(count):
    return {"tests_run": count, "failures": 0, "errors": 0, "skipped": 0}


class Auth503AggregationTests(unittest.TestCase):
    def test_registered_suite_is_additive(self):
        result = summarize_edge_units({"unit": unit(656), "auth_503_unit": unit(27),
                                       "auth_503_runtime_unit": unit(5)},
                                      656, False, auth_503_required=True, auth_503_runtime_required=True)
        self.assertEqual(result["total_tests"], 688)
        self.assertEqual(result["by_suite"]["unit"], 656)
        self.assertEqual(result["by_suite"]["auth_503_runtime_unit"], 5)

    def test_missing_or_unregistered_suite_is_rejected(self):
        with self.assertRaises(ValueError):
            summarize_edge_units({"unit": unit(656)}, 656, False, auth_503_required=True)
        with self.assertRaises(ValueError):
            summarize_edge_units({"unit": unit(656), "auth_503_unit": unit(27)}, 656, False)
        with self.assertRaises(ValueError):
            summarize_edge_units({"unit": unit(656), "auth_503_unit": unit(27)},
                                 656, False, auth_503_required=True, auth_503_runtime_required=True)
        with self.assertRaises(ValueError):
            summarize_edge_units({"unit": unit(656), "auth_503_runtime_unit": unit(5)},
                                 656, False, auth_503_required=True, auth_503_runtime_required=True)

    def test_historical_27_only_suite_remains_valid(self):
        result = summarize_edge_units({"unit": unit(656), "auth_503_unit": unit(27)},
                                      656, False, auth_503_required=True)
        self.assertEqual(result["total_tests"], 683)

    def test_wrong_counts_failures_and_skips_are_rejected(self):
        good = {"unit": unit(656), "auth_503_unit": unit(27), "auth_503_runtime_unit": unit(5)}
        for key, value in (("tests_run", 26), ("tests_run", 28), ("failures", 1),
                           ("errors", 1), ("skipped", 1)):
            bad = deepcopy(good)
            bad["auth_503_unit"][key] = value
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                summarize_edge_units(bad, 656, False, auth_503_required=True, auth_503_runtime_required=True)
        for key, value in (("tests_run", 4), ("tests_run", 6), ("failures", 1),
                           ("errors", 1), ("skipped", 1)):
            bad = deepcopy(good)
            bad["auth_503_runtime_unit"][key] = value
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                summarize_edge_units(bad, 656, False, auth_503_required=True, auth_503_runtime_required=True)

    def test_registration_detection_and_invalid_shape(self):
        self.assertFalse(auth_503_unit_required({}))
        self.assertFalse(auth_503_runtime_unit_required({}))
        spec = {"supabase_deployment_contract": {"live_execution": {
            "auth_503_cancel_followup_20261112": {"synthetic_suite": {}}}}}
        self.assertTrue(auth_503_unit_required(spec))
        self.assertFalse(auth_503_runtime_unit_required(spec))
        spec["supabase_deployment_contract"]["live_execution"]["auth_503_cancel_followup_20261112"]["runtime_integration_suite"] = {}
        self.assertTrue(auth_503_runtime_unit_required(spec))
        with self.assertRaises(ValueError):
            auth_503_unit_required({"supabase_deployment_contract": {"live_execution": []}})
        with self.assertRaises(ValueError):
            summarize_edge_units({"unit": unit(656)}, 656, False, auth_503_required=1)


if __name__ == "__main__":
    unittest.main()
