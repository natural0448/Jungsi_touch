"""Independent invented margins/reference/sensitivity guards; no real accuracy claims."""
from copy import deepcopy
from pathlib import Path
import sys
import unittest
import numpy as np
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'src'))
from test_overall_analysis_service import synthetic_pack
from test_estimated_profiles import synthetic_scenario
from test_estimated_fitting import synthetic_policy
from jungsi_touch.estimated_profiles import generate_candidate_profiles, digest, EstimationError
from jungsi_touch.estimated_fitting import fit_estimated_joint
from jungsi_touch.estimated_validation import validate_estimate, official_residuals
from jungsi_touch.percentile import METRIC_ID, POPULATION_ID


def synthetic_validation_policy(pack):
    p=synthetic_policy(pack)
    p['validation'].update(withheld_point_ids=['SYNTHETIC-below','SYNTHETIC-above'],
        minimum_reference_points=2,minimum_sensitivity_cases=1,required_sensitivity_dimensions=['seed'],
        conditional_mean_limits={},limits=dict(normalization='0.000000001',
            official_max_abs_probability='0.00000002',reference_max_error_pp='0.001',reference_mean_error_pp='0.001'))
    return p


def synthetic_validation_reference(pack):
    return dict(source_id='SYNTHETIC-reference',exam_id=pack.exam_id,pack_version=pack.pack_version,
        academic_year=pack.academic_year,population_id=POPULATION_ID,metric_id=METRIC_ID,
        tie_policy='include_equal',review_status='reference',points=[
            dict(point_id='SYNTHETIC-below',score=3,top_fraction=1),
            dict(point_id='SYNTHETIC-above',score=37,top_fraction=0)])


class EstimatedValidationTests(unittest.TestCase):
    def setUp(self):
        self.pack=synthetic_pack();self.p,self.info=generate_candidate_profiles(self.pack,synthetic_scenario(self.pack))
        self.policy=synthetic_validation_policy(self.pack);self.reference=synthetic_validation_reference(self.pack)
        self.w,self.fit=fit_estimated_joint(self.pack,self.p,self.info,self.reference,self.policy,9)
        self.case=dict(status='validated_sensitivity',proposal_hash='SYNTHETIC-different-seed',
            input_hash=self.info['input_hash'],policy_version=self.policy['version'],policy_hash=digest(self.policy),
            official_constraints_verified=True,dimensions=['seed'],
            point_estimates=[dict(point_id='SYNTHETIC-below',top_fraction=1),dict(point_id='SYNTHETIC-above',top_fraction=0)])
    def validate(self,**changes):
        return validate_estimate(self.pack,self.p,changes.get('weights',self.w),self.info,changes.get('fit',self.fit),
            changes.get('reference',self.reference),changes.get('policy',self.policy),sensitivity=changes.get('sensitivity',[self.case]))
    def test_reference_and_sensitivity_evidence_complete_control_flow_only(self):
        result=self.validate();self.assertEqual(result['status'],'self_validated_estimate',result)
        self.assertEqual(result['data_kind'],'estimated_weights')
        self.assertEqual(result['scenario_ranges']['SYNTHETIC-below']['meaning'],'scenario_range_not_95_percent_confidence_interval')
        self.assertTrue(all(r['abs_probability_error']<=2e-8 for r in result['official_residuals']))
    def test_tampered_policy_or_weights_provenance_is_rejected(self):
        policy=deepcopy(self.policy);policy['validation']['limits']['reference_max_error_pp']='100'
        with self.assertRaises(EstimationError) as caught:self.validate(policy=policy)
        self.assertEqual(caught.exception.code,'estimate_provenance_mismatch')
        self.p['prior'][0]*=2
        with self.assertRaises(EstimationError):self.validate()
    def test_independent_margins_detect_normalized_but_wrong_distribution(self):
        w=np.zeros_like(self.w);w[0]=1
        fit=dict(self.fit,weights_hash=digest(w.tolist()))
        result=self.validate(weights=w,fit=fit)
        self.assertEqual(result['status'],'research_only');self.assertFalse(result['checks']['official_constraints'])
        self.assertGreater(result['metrics']['official_max_abs_probability'],.1)
        rows=official_residuals(self.pack,self.p,self.info,self.w,9)
        self.assertEqual(next(r for r in rows if r['name']=='국어:missing')['expected_probability'],0)
    def test_nonconverged_fit_or_missing_sensitivity_cannot_be_published(self):
        fit=deepcopy(self.fit);fit['converged']=False
        self.assertEqual(self.validate(fit=fit)['status'],'research_only')
        self.assertEqual(self.validate(sensitivity=[])['status'],'research_only')
    def test_impossible_withheld_reference_reports_error_instead_of_tolerance_change(self):
        r=deepcopy(self.reference);r['points'][0]['top_fraction']='0.2'
        result=self.validate(reference=r);self.assertEqual(result['status'],'research_only')
        self.assertAlmostEqual(result['metrics']['withheld_max_error_pp'],80)
        self.assertEqual(self.policy['validation']['limits']['reference_max_error_pp'],'0.001')
    def test_nonfinite_weights_and_wrong_reference_context_are_rejected(self):
        for value in (float('nan'),float('inf'),-1):
            w=self.w.copy();w[0]=value
            with self.subTest(value=value),self.assertRaises(EstimationError):self.validate(weights=w)
        r=deepcopy(self.reference);r['exam_id']='SYNTHETIC-other'
        with self.assertRaises(EstimationError):self.validate(reference=r)
    def test_same_proposal_or_wrong_policy_cannot_count_as_sensitivity(self):
        for key,value in [('proposal_hash',self.info['proposal_hash']),('policy_hash','SYNTHETIC-other')]:
            case=deepcopy(self.case);case[key]=value
            with self.subTest(key=key),self.assertRaises(EstimationError):self.validate(sensitivity=[case])


if __name__=='__main__':unittest.main()
