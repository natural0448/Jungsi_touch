import unittest
from copy import deepcopy
from jungsi_touch.forecasting import generate,project,decimal,validate_result
from jungsi_touch.application.platform_ports import PlatformError
from forecast_synthetic_fixture import fixture

class ForecastCalculationTests(unittest.TestCase):
    def test_separate_outputs_from_approved_comparison_values(self):
        inputs,policy=fixture();result=generate(inputs,policy)
        self.assertEqual(result['forecast_70']['value'],'56');self.assertEqual(result['acceptance_range']['lower'],'54')
        self.assertIsNone(result['issue_summaries'][0]['effect']);self.assertEqual(validate_result(result)['status'],'passed')
    def test_only_70_data_does_not_generate_acceptance_range(self):
        inputs,policy=fixture();inputs['acceptance_history']=[];result=generate(inputs,policy)
        self.assertEqual(result['forecast_70']['status'],'ready');self.assertEqual(result['acceptance_range']['status'],'pending')
    def test_each_comparison_binding_must_match(self):
        for field,value,reason in [('unit','등급','forecast_comparison_mismatch'),('population_id','OTHER','forecast_comparison_mismatch'),('offering_lineage_id','OTHER','forecast_offering_mismatch'),('metric_definition','OTHER','forecast_metric_mismatch'),('bridge_status','draft','history_bridge_unapproved')]:
            with self.subTest(field=field):
                inputs,policy=fixture();inputs['history_70'][0][field]=value
                self.assertEqual(generate(inputs,policy)['forecast_70']['reason_code'],reason)
    def test_no_implicit_approval_or_trend_default(self):
        inputs,policy=fixture();policy.pop('require_independent_approver')
        with self.assertRaises(PlatformError):generate(inputs,policy)
        inputs,policy=fixture();policy['forecast_70']['trend_adopted']=False
        self.assertEqual(generate(inputs,policy)['forecast_70']['reason_code'],'forecast_trend_unapproved')
    def test_latest_and_weighted_mean_are_policy_driven(self):
        inputs,policy=fixture();spec=policy['forecast_70'];spec['method']='latest_comparable'
        self.assertEqual(generate(inputs,policy)['forecast_70']['value'],'54')
        spec.update(method='weighted_mean',weights={'2024':'1','2025':'2','2026':'1'})
        self.assertEqual(generate(inputs,policy)['forecast_70']['value'],'52')
    def test_nonterminating_values_never_silently_round(self):
        with self.assertRaises(PlatformError):decimal('1/3')
    def test_unknown_issue_is_not_numeric_zero(self):
        inputs,policy=fixture();inputs['issues'][0]['effect']='1'
        with self.assertRaises(PlatformError):generate(inputs,policy)

    def test_policy_rounding_and_trend_limit_are_explicit(self):
        inputs,policy=fixture();spec=policy['forecast_70']
        spec.update(method='weighted_mean',weights={'2024':'1','2025':'1','2026':'1'})
        inputs['history_70'][2]['comparison_value']='55'
        self.assertEqual(generate(inputs,policy)['forecast_70']['value'],'52.33')
        spec['display_places']=None
        self.assertEqual(generate(inputs,policy)['forecast_70']['reason_code'],'forecast_precision_policy_missing')
        inputs,policy=fixture();policy['forecast_70']['max_abs_trend_per_year']='1'
        self.assertEqual(generate(inputs,policy)['forecast_70']['reason_code'],'forecast_trend_limit_exceeded')
    def test_lower_is_better_needs_reversed_categories(self):
        inputs,policy=fixture();spec=policy['acceptance_range'];spec['direction']='lower_is_better'
        inputs['context']['direction']='lower_is_better';policy['context']=deepcopy(inputs['context'])
        result=generate(inputs,policy);self.assertEqual(result['acceptance_range']['reason_code'],'forecast_category_direction_mismatch')
        spec['category_offsets'][0]['category']='room';spec['category_offsets'][2]['category']='challenge'
        self.assertEqual(generate(inputs,policy)['acceptance_range']['status'],'ready')
