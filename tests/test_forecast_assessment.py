import unittest
from copy import deepcopy
from fractions import Fraction
from jungsi_touch.application.forecast_assessment import evaluate_release
from jungsi_touch.application.university_scoring import ScoringResult
from jungsi_touch.application.university_percentile import PercentileResult
from jungsi_touch.forecasting import generate,digest
from forecast_synthetic_fixture import fixture,CONTEXT

class ForecastAssessmentTests(unittest.TestCase):
    def setUp(self):
        inputs,policy=fixture();context=inputs['context'];context.update(rule_id='SYNTHETIC-rule-id',score_scope='csat_component',bonus_treatment='included')
        policy['context']=deepcopy(context)
        calculated=generate(inputs,policy)
        self.inputs=inputs;self.policy=policy
        self.release=dict(release_id='SYNTHETIC-release',context=context,result=calculated,base_result=deepcopy(calculated),policy_version=policy['version'],input_version=inputs['version'],adjustments=[],approval_hash='a'*64,validation_hash='b'*64,eligibility_policy=dict(status='approved',version='SYNTHETIC-eligibility',requirements=[]))
        self.release['release_hash']=digest(self.release)
        self.offering=dict(offering_id=CONTEXT['offering_id'],academic_year=2027)
        self.profile=dict(profile_id='SYNTHETIC-profile',scores={})
        self.scoring=ScoringResult(2027,'SYNTHETIC-profile','SYNTHETIC-pack',CONTEXT['exam_id'],reason_code=None,score=Fraction(56),converted_score='56',rule_version=CONTEXT['rule_version'],release_version='SYNTHETIC-conversion',context=tuple(context.items()))
        self.percentile=PercentileResult(2027,CONTEXT['exam_id'],'SYNTHETIC-profile','SYNTHETIC-pack','actual_exam',CONTEXT['rule_version'],reason_code=None,inclusive=Fraction(1,10),exclusive=Fraction(9,100),population_id=CONTEXT['population_id'],curve_version=CONTEXT['curve_version'],context=tuple(context.items()))
    def run_assessment(self):return evaluate_release(self.offering,self.profile,self.scoring,self.percentile,self.release)
    def test_published_policy_drives_category_and_keeps_conversion(self):
        result=self.run_assessment();self.assertEqual(result['category'],'core');self.assertEqual(result['conversion']['status'],'ready');self.assertEqual(result['decision_evidence']['forecast_70']['value'],'56')
    def test_mismatched_or_tampered_policy_never_discards_score(self):
        self.release['context']['population_id']='OTHER';result=self.run_assessment()
        self.assertEqual(result['status'],'pending');self.assertEqual(result['conversion']['status'],'ready');self.assertEqual(result['converted_score'],'56')
    def test_missing_acceptance_does_not_rename_70_cut(self):
        self.release['result']['acceptance_range'].update(status='pending',reason_code='acceptance_evidence_missing',lower=None,upper=None)
        self.release.pop('release_hash');self.release['release_hash']=digest(self.release)
        result=self.run_assessment();self.assertEqual(result['reason_code'],'acceptance_evidence_missing');self.assertEqual(result['decision_evidence']['forecast_70']['value'],'56')

    def regenerate(self):
        calculated=generate(self.inputs,self.policy);self.release.update(context=deepcopy(self.inputs['context']),result=calculated,base_result=deepcopy(calculated))
        self.release.pop('release_hash',None);self.release['release_hash']=digest(self.release)

    def test_display_rounding_never_changes_exact_boundary_membership(self):
        from dataclasses import replace
        for history in ('history_70','acceptance_history'):
            for row in self.inputs[history]:row['comparison_value']=str(Fraction(row['comparison_value'])+Fraction(4,1000))
        self.regenerate();self.scoring=replace(self.scoring,score=Fraction('54.001'),converted_score='54.00')
        self.assertEqual(self.release['result']['category_ranges'][1]['lower'],'54')
        self.assertEqual(self.run_assessment()['category'],'challenge')
        self.scoring=replace(self.scoring,score=Fraction('54.004'));self.assertEqual(self.run_assessment()['category'],'core')
        self.scoring=replace(self.scoring,score=Fraction('58.004'));self.assertEqual(self.run_assessment()['category'],'room')

    def test_university_percentile_policy_uses_exact_inclusive_tail(self):
        self.inputs['context'].update(unit='%',comparison_metric='university_top_percent',direction='lower_is_better',tie_policy='include_equal')
        self.policy['context']=deepcopy(self.inputs['context'])
        for key in ('forecast_70','acceptance_range'):
            spec=self.policy[key];spec.update(comparison_metric='university_top_percent',direction='lower_is_better',tie_policy='include_equal',method='latest_comparable')
        spec=self.policy['acceptance_range'];spec['category_offsets'][0]['category']='room';spec['category_offsets'][2]['category']='challenge'
        for history in ('history_70','acceptance_history'):
            for row in self.inputs[history]:row.update(unit='%',comparison_value='10')
        self.regenerate();result=self.run_assessment()
        self.assertEqual(result['status'],'ready',result);self.assertEqual(result['category'],'core')
        self.assertEqual(result['converted_score'],'56');self.assertEqual(result['converted_percentile'],'10.000000')

    def test_wrong_metric_direction_unit_or_tie_preserves_successes(self):
        for field,value in [('comparison_metric','overall_top_percent'),('direction','lower_is_better'),('unit','등급'),('tie_policy','exclude_equal')]:
            with self.subTest(field=field):
                context=self.release['context'];original=context[field];context[field]=value
                self.release['result']['context']=deepcopy(context)
                self.release.pop('release_hash');self.release['release_hash']=digest(self.release)
                result=self.run_assessment();self.assertEqual(result['status'],'pending');self.assertEqual(result['conversion']['status'],'ready');self.assertEqual(result['percentile']['status'],'ready')
                context[field]=original;self.release['result']['context']=deepcopy(context)

    def test_prior_official_metrics_are_preserved_as_separate_evidence(self):
        history=[dict(academic_year=2024,metric_name='가상 발표 평균',value='50',unit='점')]
        result=evaluate_release(self.offering,self.profile,self.scoring,self.percentile,self.release,historical_metrics=history)
        self.assertEqual(result['decision_evidence']['historical_metrics'],history)
        self.assertEqual(result['decision_evidence']['forecast_70']['value'],'56')
        history[0]['value']='999';self.assertEqual(result['decision_evidence']['historical_metrics'][0]['value'],'50')

    def test_forecast_and_official_history_survive_pending_percentile(self):
        from dataclasses import replace
        self.percentile=replace(self.percentile,inclusive=None,reason_code='percentile_release_missing')
        history=[dict(academic_year=2024,metric_name='가상 발표 평균',value='50',unit='점')]
        result=evaluate_release(self.offering,self.profile,self.scoring,self.percentile,self.release,historical_metrics=history)
        self.assertEqual(result['status'],'pending');self.assertEqual(result['conversion']['status'],'ready')
        self.assertEqual(result['decision_evidence']['historical_metrics'],history);self.assertEqual(result['decision_evidence']['forecast_70']['status'],'ready')
