"""Synthetic aggregation checks; no DB, network or operational state."""
from copy import deepcopy
import unittest
from run_committed_tests import summarize_edge_units, additional_p1_unit_flags

def unit(n):
    return {"tests_run":n, "failures":0, "errors":0, "skipped":0}

class P1EdgeAggregationTests(unittest.TestCase):
    def setUp(self):
        self.good={"unit":unit(656),"p1_recruitment_score_review_unit":unit(72),
                   "p1_selection_bridge_review_unit":unit(17),"service_end_score_cutoff_unit":unit(3)}
        self.flags=dict(p1_review_required=True,p1_selection_required=True,service_end_required=True)

    def test_all_three_exact_counts_are_included(self):
        result=summarize_edge_units(self.good,656,False,**self.flags)
        self.assertEqual(result["total_tests"],748)
        self.assertEqual(result["by_suite"]["p1_selection_bridge_review_unit"],17)

    def test_each_missing_registered_unit_is_rejected(self):
        for name in list(self.good)[1:]:
            with self.subTest(name=name):
                edge=deepcopy(self.good);del edge[name]
                with self.assertRaises(ValueError):summarize_edge_units(edge,656,False,**self.flags)

    def test_each_unregistered_unit_is_rejected(self):
        for flag in self.flags:
            with self.subTest(flag=flag):
                flags=dict(self.flags);flags[flag]=False
                with self.assertRaises(ValueError):summarize_edge_units(self.good,656,False,**flags)

    def test_every_wrong_count_and_nonzero_status_is_rejected(self):
        for name in list(self.good)[1:]:
            for key in ("tests_run","failures","errors","skipped"):
                for value in ((self.good[name]["tests_run"]-1,self.good[name]["tests_run"]+1) if key=="tests_run" else (1,)):
                    with self.subTest(name=name,key=key,value=value):
                        edge=deepcopy(self.good);edge[name][key]=value
                        with self.assertRaises(ValueError):summarize_edge_units(edge,656,False,**self.flags)

    def test_invalid_flags_and_unrecognized_suite_are_rejected(self):
        for flag in self.flags:
            with self.subTest(flag=flag):
                flags=dict(self.flags);flags[flag]=1
                with self.assertRaises(ValueError):summarize_edge_units(self.good,656,False,**flags)
        edge=deepcopy(self.good);edge["unknown_unit"]=unit(1)
        with self.assertRaises(ValueError):summarize_edge_units(edge,656,False,**self.flags)

    def test_old_gates_remain_enforced_alongside_new_gates(self):
        edge=deepcopy(self.good)
        edge.update(incident_recovery_unit=unit(50),service_candidate_aux_unit=unit(14),
                    service_staged_aux_unit=unit(76),service_wildcard_unit=unit(97))
        self.assertEqual(summarize_edge_units(edge,656,True,True,True,True,**self.flags)["total_tests"],985)
        edge["service_wildcard_unit"]["tests_run"]=96
        with self.assertRaises(ValueError):summarize_edge_units(edge,656,True,True,True,True,**self.flags)

    def test_independent_subset_of_registered_extensions(self):
        edge={"unit":unit(656),"p1_selection_bridge_review_unit":unit(17)}
        self.assertEqual(summarize_edge_units(edge,656,False,p1_selection_required=True)["total_tests"],673)
        self.assertEqual(summarize_edge_units({"unit":unit(656)},656,False)["total_tests"],656)

    def test_snapshot_registration_presence_requires_the_matching_unit(self):
        keys=["p1_recruitment_score_review_verification","p1_selection_bridge_review_verification",
              "service_end_score_cutoff_synthetic_verification"]
        self.assertEqual(additional_p1_unit_flags({}),dict(p1_review_required=False,p1_selection_required=False,service_end_required=False))
        flags=additional_p1_unit_flags({key:None for key in keys})
        self.assertEqual(flags,self.flags)
        self.assertEqual(summarize_edge_units(self.good,656,False,**flags)["total_tests"],748)
        missing=deepcopy(self.good);del missing["p1_selection_bridge_review_unit"]
        with self.assertRaises(ValueError):summarize_edge_units(missing,656,False,**flags)
        with self.assertRaises(ValueError):additional_p1_unit_flags(None)

if __name__=="__main__":
    unittest.main()
