"""Invented exact aggregation/population tests. Approval flags exercise guards only."""
from copy import deepcopy
from fractions import Fraction
from pathlib import Path
import json
import sys
import unittest
import numpy as np
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'src'))
from test_overall_analysis_service import synthetic_pack
from test_estimated_profiles import synthetic_scenario,synthetic_missing_pack
from test_estimated_validation import synthetic_validation_policy,synthetic_validation_reference
from test_conversion_rule_synthetic import invented_rule,number_input,inp,const
from jungsi_touch.exam_pack import ExamPack,ExamTotalModel
from jungsi_touch.university_conversion import ConversionRule,ConversionError
from jungsi_touch.admission_result_percentile import UniversityScoreDistribution
from jungsi_touch.estimated_profiles import generate_candidate_profiles,EstimationError
from jungsi_touch.estimated_fitting import fit_estimated_joint
from jungsi_touch.estimated_validation import validate_estimate
from jungsi_touch.estimated_curves import build_total_model,build_university_distribution,decimal_string,serialize_cohort_weights
from jungsi_touch.percentile import POPULATION_ID,StandardScores


def synthetic_curve_metadata():
    return dict(distribution_id='SYNTHETIC-model',source_name='SYNTHETIC',source_date='2026-10-04',
        curve_id='SYNTHETIC-curve',curve_version='SYNTHETIC-curve.v1',population_definition='SYNTHETIC required inputs',
        source_model_id='SYNTHETIC-model',source_model_version='SYNTHETIC-model.v1',source_refs=['SYNTHETIC'],
        comparison_population_id='SYNTHETIC-present-inputs',validation_receipt_version='SYNTHETIC-receipt.v1')


def synthetic_executable_rule(pack,inputs=None,nodes=None):
    raw=invented_rule(inputs or {},nodes or {'score':const('1.234')})
    raw.update(review_status='calculation_verified',data_kind='official_rule',exam_id=pack.exam_id,
        source_pack_version=pack.pack_version,score_scale_id='SYNTHETIC-scale',bonus_treatment='excluded')
    return ConversionRule(raw)


class EstimatedCurvesTests(unittest.TestCase):
    def prepare(self,pack=None):
        raw=deepcopy((pack or synthetic_pack())._data);raw['exam']['exam_type']='csat';pack=ExamPack(raw)
        p,info=generate_candidate_profiles(pack,synthetic_scenario(pack))
        policy=synthetic_validation_policy(pack);reference=synthetic_validation_reference(pack)
        count=pack._data['participants']['target_population']['count']
        w,fit=fit_estimated_joint(pack,p,info,reference,policy,count)
        v=validate_estimate(pack,p,w,info,fit,reference,policy,sensitivity=[])
        return pack,p,info,w,v
    def test_exact_serialization_restores_cohort_count_and_roundtrips(self):
        pack,p,info,w,v=self.prepare();raw,exact=build_total_model(pack,p,w,info,v,synthetic_curve_metadata())
        model=ExamTotalModel.from_json(json.dumps(raw))
        self.assertEqual(sum(exact),9);self.assertEqual(model.distribution.metadata.expected_total_weight,9)
        self.assertEqual(raw['distribution']['metadata']['kind'],'estimated_weights')
        self.assertEqual(raw['distribution']['metadata']['status'],'reference') # no autoapproval
        scores=[row['total_score'] for row in raw['distribution']['rows']]
        tails=[model.distribution.calculate(StandardScores(2027,score,0,0,0),require_approved=False).inclusive_fraction for score in scores]
        self.assertEqual(tails,sorted(tails,reverse=True))
    def test_domain_uses_official_support_even_when_proposal_omits_extremes(self):
        pack,p,info,w,v=self.prepare();w=w.copy();totals=p['korean']+p['math']+p['q1']+p['q2']
        w[(totals==4)|(totals==36)]=0
        from jungsi_touch.estimated_profiles import digest
        v=dict(v,weights_hash=digest(w.tolist()))
        raw,_=build_total_model(pack,p,w,info,v,synthetic_curve_metadata())
        self.assertEqual((raw['distribution']['metadata']['score_min'],raw['distribution']['metadata']['score_max']),(4,36))
        self.assertTrue(all(4<r['total_score']<36 for r in raw['distribution']['rows']))
    def test_builder_cannot_reuse_validation_for_other_weights_or_count(self):
        pack,p,info,w,v=self.prepare()
        with self.assertRaises(EstimationError):build_total_model(pack,p,w*2,info,v,synthetic_curve_metadata())
        with self.assertRaises(EstimationError):build_total_model(pack,p,w,info,dict(v,complete_count='1'),synthetic_curve_metadata())
    def test_exact_university_values_are_not_display_values(self):
        pack,p,info,w,v=self.prepare();rule=synthetic_executable_rule(pack)
        raw,ledger,checks=build_university_distribution(pack,p,w,info,rule,v,synthetic_curve_metadata())
        curve=UniversityScoreDistribution(json.loads(json.dumps(raw)))
        self.assertEqual(curve.bins,((Fraction('1.234'),Fraction(9)),))
        self.assertEqual(curve.tail(Fraction('1.234'),inclusive=True),1)
        self.assertEqual(curve.tail(Fraction('1.234'),inclusive=False),0)
        self.assertEqual(curve.tail(Fraction('1.23'),inclusive=False),1)
        self.assertEqual(ledger['scope'],'whole_complete');self.assertEqual(ledger['population_id'],POPULATION_ID)
        self.assertEqual(raw['metadata']['status'],'research');self.assertTrue(checks)
    def test_missing_english_has_separate_weighted_population_and_reasons(self):
        pack,p,info,w,v=self.prepare(synthetic_missing_pack())
        rule=synthetic_executable_rule(pack,{'english_grade':number_input(1,9)},{'score':inp('english_grade')})
        raw,ledger,_=build_university_distribution(pack,p,w,info,rule,v,synthetic_curve_metadata())
        self.assertEqual(ledger['scope'],'required_rule_inputs_present');self.assertNotEqual(ledger['population_id'],POPULATION_ID)
        self.assertEqual(Fraction(ledger['retained_weight'])+Fraction(ledger['excluded_weight']),8)
        self.assertGreater(Fraction(ledger['excluded_weight']),0)
        self.assertLess(UniversityScoreDistribution(raw).total,8)
        self.assertEqual(ledger['exclusions'][0]['missing_input_fields'],['english_grade'])
        self.assertEqual(ledger['required_input_fields'],['english_grade'])
    def test_unverified_cross_exam_mock_and_missing_scale_rules_are_rejected(self):
        pack,p,info,w,v=self.prepare();original=synthetic_executable_rule(pack).data
        for field,value in [('review_status','source_verified'),('exam_id','SYNTHETIC-other'),
                            ('source_pack_version','SYNTHETIC-other'),('bonus_treatment',None)]:
            rule=ConversionRule(dict(original,**{field:value}))
            with self.subTest(field=field),self.assertRaises(EstimationError):
                build_university_distribution(pack,p,w,info,rule,v,synthetic_curve_metadata())
        raw=deepcopy(pack._data);raw['exam']['exam_type']='september_mock';mock=ExamPack(raw)
        with self.assertRaises(EstimationError):build_university_distribution(mock,p,w,info,synthetic_executable_rule(mock),v,synthetic_curve_metadata())
    def test_rule_calculation_errors_are_not_silently_dropped(self):
        pack,p,info,w,v=self.prepare()
        rule=synthetic_executable_rule(pack,{}, {'score':{'op':'divide','left':const(1),'right':const(0)}})
        with self.assertRaises(ConversionError):build_university_distribution(pack,p,w,info,rule,v,synthetic_curve_metadata())
        rule=synthetic_executable_rule(pack,{}, {'score':{'op':'divide','left':const(1),'right':const(3)}})
        with self.assertRaises(EstimationError) as caught:build_university_distribution(pack,p,w,info,rule,v,synthetic_curve_metadata())
        self.assertEqual(caught.exception.code,'nonterminating_exact_value')
    def test_weight_invalid_or_zero_support_cannot_be_serialized(self):
        for weights in ([0,0],[float('nan'),1],[-1,2]):
            with self.subTest(weights=weights),self.assertRaises(EstimationError):
                serialize_cohort_weights(weights,np.array([True,True]),9)
        self.assertEqual(decimal_string(Fraction('-1.234')),'-1.234')

    def test_exact_saved_weights_are_independently_checked_against_official_margins(self):
        from jungsi_touch.estimated_validation import validate_serialized_weights
        pack,p,info,w,v=self.prepare();raw,exact=build_total_model(pack,p,w,info,v,synthetic_curve_metadata())
        saved=json.loads(json.dumps([decimal_string(value) for value in exact]))
        restored=tuple(Fraction(value) for value in saved)
        result=validate_serialized_weights(pack,p,info,restored,9,synthetic_validation_policy(pack))
        self.assertTrue(result['passed']);self.assertEqual(restored,exact)
        wrong=tuple(Fraction(9) if i==0 else Fraction(0) for i in range(len(exact)))
        result=validate_serialized_weights(pack,p,info,wrong,9,synthetic_validation_policy(pack))
        self.assertFalse(result['passed']);self.assertEqual(result['all_population_weight'],dict(numerator=9,denominator=1))


if __name__=='__main__':unittest.main()
