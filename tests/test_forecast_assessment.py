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
        self.release=dict(release_id='SYNTHETIC-release',context=context,result=calculated,base_result=deepcopy(calculated),policy_version=policy['version'],adjustments=[],approval_hash='a'*64,validation_hash='b'*64,eligibility_policy=dict(status='approved',version='SYNTHETIC-eligibility',requirements=[]))
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
