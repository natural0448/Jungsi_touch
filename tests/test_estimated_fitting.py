"""Invented fitting targets only; all operating policies/coefficients remain private."""
from copy import deepcopy
from pathlib import Path
import sys
import unittest
import numpy as np
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'src'))
from test_overall_analysis_service import synthetic_pack
from test_estimated_profiles import synthetic_scenario
from jungsi_touch.estimated_profiles import generate_candidate_profiles, EstimationError, complete_mask
from jungsi_touch.estimated_fitting import fit_estimated_joint, official_constraints, constraint_errors
from jungsi_touch.percentile import METRIC_ID, POPULATION_ID


def synthetic_policy(pack):
    return dict(version='SYNTHETIC-policy.v1',method='entropy_soft_reference/v1',
        exam_id=pack.exam_id,pack_version=pack.pack_version,academic_year=pack.academic_year,population_id=POPULATION_ID,
        optimization=dict(max_iterations=600,hard_tolerance='0.00000001',gradient_tolerance='0.00000001'),
        calibration=dict(source_id=None,point_ids=[],tail_strength='10',mean_strength=0),
        validation=dict(withheld_point_ids=[]))


def synthetic_reference(pack):
    return dict(source_id='SYNTHETIC-reference',exam_id=pack.exam_id,pack_version=pack.pack_version,
        academic_year=pack.academic_year,population_id=POPULATION_ID,metric_id=METRIC_ID,
        tie_policy='include_equal',review_status='reference',points=[dict(point_id='SYNTHETIC-max',score=36,top_fraction='0.9')])


class EstimatedFittingTests(unittest.TestCase):
    def setUp(self):
        self.pack=synthetic_pack();self.p,self.info=generate_candidate_profiles(self.pack,synthetic_scenario(self.pack))
        self.policy=synthetic_policy(self.pack)
    def test_official_margins_are_fitted_and_checked_independently(self):
        before={k:v.copy() for k,v in self.p.items()}
        w,fit=fit_estimated_joint(self.pack,self.p,self.info,None,self.policy,9)
        errors=constraint_errors(w,official_constraints(self.pack,self.p,self.info,9))
        self.assertTrue(fit['converged'],fit);self.assertLess(max(e['max_abs_probability'] for e in errors),1e-8)
        self.assertAlmostEqual(w.sum(),1)
        for key in ('korean','math'):
            for score in range(1,10):self.assertAlmostEqual(float(w[self.p[key]==score].sum()),1/9,places=7)
        for subject in (0,1):
            for score in range(1,10):
                actual=sum(float(w[(self.p[key+'_subject']==subject)&(self.p[key]==score)].sum()) for key in ('q1','q2'))
                self.assertAlmostEqual(actual,1/9,places=7)
        self.assertEqual(fit['status'],'optimized_not_validated');self.assertNotIn('approved',fit)
        for key in self.p:self.assertTrue(np.array_equal(before[key],self.p[key]))
    def test_population_count_or_policy_exam_cannot_bypass_existing_bounds(self):
        with self.assertRaises(EstimationError):fit_estimated_joint(self.pack,self.p,self.info,None,self.policy,1)
        policy=deepcopy(self.policy);policy['exam_id']='SYNTHETIC-other'
        with self.assertRaises(EstimationError):fit_estimated_joint(self.pack,self.p,self.info,None,policy,9)
    def test_missing_positive_support_is_explicit_failure(self):
        self.p['korean'][:]=1
        with self.assertRaises(EstimationError) as caught:fit_estimated_joint(self.pack,self.p,self.info,None,self.policy,9)
        self.assertEqual(caught.exception.code,'missing_positive_constraint_support')
    def test_nonconvergence_is_preserved_and_not_approval(self):
        self.policy['optimization']['max_iterations']=1
        w,fit=fit_estimated_joint(self.pack,self.p,self.info,None,self.policy,9)
        self.assertFalse(fit['converged']);self.assertEqual(fit['reason_code'],'maximum_iterations')
        self.assertTrue(np.all(np.isfinite(w)));self.assertEqual(fit['status'],'optimized_not_validated')
    def test_reference_training_and_withheld_points_are_disjoint(self):
        r=synthetic_reference(self.pack);self.policy['calibration'].update(source_id=r['source_id'],point_ids=['SYNTHETIC-max'])
        self.policy['validation']['withheld_point_ids']=['SYNTHETIC-max']
        with self.assertRaises(EstimationError) as caught:fit_estimated_joint(self.pack,self.p,self.info,r,self.policy,9)
        self.assertEqual(caught.exception.code,'reference_train_validation_overlap')
    def test_impossible_soft_reference_does_not_replace_official_constraints(self):
        r=synthetic_reference(self.pack);self.policy['calibration'].update(source_id=r['source_id'],point_ids=['SYNTHETIC-max'])
        w,fit=fit_estimated_joint(self.pack,self.p,self.info,r,self.policy,9)
        self.assertTrue(fit['converged'],fit)
        errors=constraint_errors(w,official_constraints(self.pack,self.p,self.info,9))
        self.assertLess(max(e['max_abs_probability'] for e in errors),1e-8)
        total=self.p['korean']+self.p['math']+self.p['q1']+self.p['q2'];mask=complete_mask(self.p)
        tail=w[mask&(total>=36)].sum()/w[mask].sum()
        self.assertLessEqual(tail,1/9+1e-8)
        self.assertGreater(abs(tail-.9),.7) # evidence of reference incompatibility, not a forced matching curve


if __name__=='__main__':unittest.main()
