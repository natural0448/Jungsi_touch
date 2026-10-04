"""Invented empty-grade and reference-exclusion evidence, never actual policy values."""
from copy import deepcopy
from pathlib import Path
import sys,unittest
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'src'))
from test_overall_analysis_service import synthetic_pack
from test_estimated_profiles import synthetic_scenario
from test_estimated_validation import synthetic_validation_policy,synthetic_validation_reference
from jungsi_touch.exam_pack import ExamPack,_grade
from jungsi_touch.percentile import PercentileError
from jungsi_touch.estimated_profiles import generate_candidate_profiles,digest,EstimationError
from jungsi_touch.estimated_fitting import fit_estimated_joint
from jungsi_touch.estimated_validation import validate_estimate,reference_feasibility_certificate


class EmptyOfficialGradeTests(unittest.TestCase):
    def raw(self):
        raw=deepcopy(synthetic_pack()._data);s=raw['subjects']['국어']
        s['grades'][0].update(lower_score=8,count=2,published_percent='22.22')
        s['grades'][1].update(count=None,lower_score=None,upper_exclusive=None,published_percent=None,
            reported_count_state='published_dash',derived_count_from_frequency=0,empty_grade_verified=True)
        return raw
    def test_official_dash_remains_null_and_no_candidate_is_assigned_empty_grade(self):
        pack=ExamPack(self.raw())
        self.assertIsNone(pack._data['subjects']['국어']['grades'][1]['count'])
        self.assertEqual(pack.reported_score('국어',8)['grade'],1)
        self.assertEqual(pack.reported_score('국어',7)['grade'],3)
    def test_unknown_count_without_explicit_empty_proof_is_not_zero(self):
        for field,value in [('empty_grade_verified',False),('derived_count_from_frequency',1),('reported_count_state','unpublished')]:
            raw=self.raw();raw['subjects']['국어']['grades'][1][field]=value
            with self.subTest(field=field),self.assertRaises(PercentileError):ExamPack(raw)
    def test_empty_claim_must_agree_with_every_frequency_and_total(self):
        raw=self.raw();raw['subjects']['국어']['grades'][0].update(lower_score=9)
        with self.assertRaises(PercentileError):ExamPack(raw)
    def test_no_applicable_nonempty_grade_reports_explicit_failure(self):
        rows=self.raw()['subjects']['국어']['grades'][:2]
        with self.assertRaises(PercentileError) as caught:_grade({'grades':rows},7)
        self.assertEqual(caught.exception.code,'grade_not_found')


class ReferenceExclusionTests(unittest.TestCase):
    def setUp(self):
        self.pack=synthetic_pack();self.p,self.info=generate_candidate_profiles(self.pack,synthetic_scenario(self.pack))
        self.policy=synthetic_validation_policy(self.pack);self.reference=synthetic_validation_reference(self.pack)
        self.reference['points'][0].update(score=36,top_fraction=1)
        certificate=reference_feasibility_certificate(self.pack,self.reference,9,self.info)
        self.policy['validation'].update(reference_validation_role='diagnostic_excluded_incompatible',
            reference_exclusion_evidence=dict(certificate_hash=digest(certificate),source_id=self.reference['source_id'],
                reason='SYNTHETIC fixed marginals imply mean20; all scores36 imply mean36'))
        self.w,self.fit=fit_estimated_joint(self.pack,self.p,self.info,self.reference,self.policy,9)
        self.case=dict(status='validated_sensitivity',proposal_hash='SYNTHETIC-other',input_hash=self.info['input_hash'],
            policy_version=self.policy['version'],policy_hash=digest(self.policy),official_constraints_verified=True,
            dimensions=['seed'],point_estimates=[])
    def validate(self):
        return validate_estimate(self.pack,self.p,self.w,self.info,self.fit,self.reference,self.policy,sensitivity=[self.case])
    def test_mathematically_incompatible_reference_is_diagnostic_in_new_frozen_policy(self):
        result=self.validate();self.assertEqual(result['status'],'self_validated_estimate',result)
        self.assertFalse(result['diagnostic_checks']['reference_max_error'])
        self.assertTrue(all(result['adoption_checks'].values()))
        self.assertEqual(result['reference_feasibility_certificate']['status'],'incompatible')
    def test_old_required_policy_still_fails_original_reference_limit(self):
        self.policy['validation'].pop('reference_validation_role');self.policy['validation'].pop('reference_exclusion_evidence')
        self.w,self.fit=fit_estimated_joint(self.pack,self.p,self.info,self.reference,self.policy,9)
        self.case['policy_hash']=digest(self.policy)
        self.assertEqual(self.validate()['status'],'research_only')
    def test_flag_or_tolerance_change_cannot_forge_exclusion_evidence(self):
        self.policy['validation']['reference_exclusion_evidence']['certificate_hash']='SYNTHETIC-invalid'
        self.w,self.fit=fit_estimated_joint(self.pack,self.p,self.info,self.reference,self.policy,9)
        self.case['policy_hash']=digest(self.policy)
        with self.assertRaises(EstimationError) as caught:self.validate()
        self.assertEqual(caught.exception.code,'reference_exclusion_unverified')
    def test_unknown_validation_limit_is_retained_as_unsupported_and_blocks_adoption(self):
        self.policy['validation']['limits']['SYNTHETIC-unknown']=1
        self.w,self.fit=fit_estimated_joint(self.pack,self.p,self.info,self.reference,self.policy,9);self.case['policy_hash']=digest(self.policy)
        result=self.validate();self.assertEqual(result['status'],'research_only')
        self.assertIn('SYNTHETIC-unknown',result['metrics']['unsupported_policy_limits'])


if __name__=='__main__':unittest.main()
