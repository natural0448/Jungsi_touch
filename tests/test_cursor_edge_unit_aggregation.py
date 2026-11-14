"""Require all 22 distinct cursor checks without changing existing suites."""
from copy import deepcopy
import unittest
from run_committed_tests import summarize_edge_units,cursor_unit_required

def unit(n):return {'tests_run':n,'failures':0,'errors':0,'skipped':0}

class CursorUnitAggregationTests(unittest.TestCase):
    def setUp(self):self.good={'unit':unit(656),'cursor_contract_review_unit':unit(22)}

    def test_registered_22_are_counted(self):
        self.assertEqual(summarize_edge_units(self.good,656,False,cursor_required=True)['total_tests'],678)

    def test_missing_or_unregistered_unit_fails(self):
        with self.assertRaises(ValueError):summarize_edge_units({'unit':unit(656)},656,False,cursor_required=True)
        with self.assertRaises(ValueError):summarize_edge_units(self.good,656,False,cursor_required=False)

    def test_wrong_count_failures_errors_and_skips_fail(self):
        for field,value in [('tests_run',21),('tests_run',23),('failures',1),('errors',1),('skipped',1)]:
            bad=deepcopy(self.good);bad['cursor_contract_review_unit'][field]=value
            with self.subTest(field=field,value=value),self.assertRaises(ValueError):
                summarize_edge_units(bad,656,False,cursor_required=True)

    def test_nonboolean_flag_and_unknown_unit_fail(self):
        with self.assertRaises(ValueError):summarize_edge_units(self.good,656,False,cursor_required=1)
        with self.assertRaises(ValueError):summarize_edge_units({**self.good,'unexpected_unit':unit(1)},656,False,cursor_required=True)

    def test_existing_p1_and_baseline_stay_strict(self):
        edge={**self.good,'p1_recruitment_score_review_unit':unit(72),'p1_selection_bridge_review_unit':unit(17),'service_end_score_cutoff_unit':unit(3)}
        flags=dict(cursor_required=True,p1_review_required=True,p1_selection_required=True,service_end_required=True)
        self.assertEqual(summarize_edge_units(edge,656,False,**flags)['total_tests'],770)
        edge['p1_selection_bridge_review_unit']['tests_run']=16
        with self.assertRaises(ValueError):summarize_edge_units(edge,656,False,**flags)

    def test_registration_presence_controls_requirement(self):
        self.assertFalse(cursor_unit_required({}))
        self.assertTrue(cursor_unit_required({'cursor_contract_offline_graph_verification':None}))
        with self.assertRaises(ValueError):cursor_unit_required(None)

if __name__=='__main__': unittest.main()
