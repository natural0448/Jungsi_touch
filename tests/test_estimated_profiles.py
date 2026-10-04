"""Invented proposal parameters and frequencies; not production weights."""
from copy import deepcopy
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
import sys
import unittest
import numpy as np
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'src'))
from test_overall_analysis_service import synthetic_pack
from jungsi_touch.exam_pack import ExamPack
from jungsi_touch.estimated_profiles import generate_candidate_profiles, validate_candidate_profiles, complete_mask, EstimationError


def synthetic_scenario(pack):
    return dict(exam_id=pack.exam_id,pack_version=pack.pack_version,academic_year=pack.academic_year,
        version='SYNTHETIC-proposal.v1',seed=19,n=300,assumptions=['SYNTHETIC factor/choice/missingness only'],
        support_repetitions=1,support_prior_mass='0.03',
        proposal=dict(latent_mixture=[dict(weight='0.8',mean=0),dict(weight='0.2',mean='1.5')],
            shared_loadings={k:'0.4' for k in ['korean','math','q1','q2','english','history']},
            inquiry_loading='0.2',missing_loading='0.1',
            availability_loadings={k:'0.3' for k in ['korean','math','english','inquiry_group']},
            choice_strength='0.2',choice_affinity={k:'0.1' for k in
                ['가상탐구가','가상탐구나','가상국어선택','가상수학선택']}))


def synthetic_missing_pack():
    data=deepcopy(synthetic_pack()._data)
    for name in ('수학','영어'):
        s=data['subjects'][name];s['denominator']=8;s['grades'][0]['count']=0
        for g in s['grades']:
            g['published_percent']=str((Decimal(g['count'])*100/8).quantize(Decimal('.01'),rounding=ROUND_HALF_UP))
        if name=='수학':
            s['frequencies']=s['frequencies'][1:];s['published_total']=8
            for i,r in enumerate(s['frequencies'],1):r['cumulative_count']=i
        data['participants']['by_subject'][name]=8
    data['participants']['choice_counts']['수학']['가상수학선택']=8
    data['participants']['target_population'].update(count=8,count_lower_bound=8,count_upper_bound=8)
    return ExamPack(data)


class EstimatedCandidateTests(unittest.TestCase):
    def setUp(self):self.pack=synthetic_pack();self.scenario=synthetic_scenario(self.pack)
    def test_seed_reproduces_dependent_full_profiles_and_preserves_source(self):
        before=deepcopy(self.pack._data);a,info=generate_candidate_profiles(self.pack,self.scenario)
        b,second=generate_candidate_profiles(self.pack,self.scenario)
        self.assertEqual(info,second)
        for key in a:self.assertTrue(np.array_equal(a[key],b[key]),key)
        self.assertEqual(self.pack._data,before);self.assertAlmostEqual(a['prior'].sum(),1)
        self.assertTrue(np.all(a['q1_subject']!=a['q2_subject']))
        self.assertTrue(np.all(complete_mask(a)));self.assertFalse(info['coefficients_are_observations'])
        self.assertGreater(len(set(zip(a['korean'],a['math']))),9) # not one fixed rank combination per score
    def test_positive_official_cells_receive_support_and_different_seed_changes_draw(self):
        a,info=generate_candidate_profiles(self.pack,self.scenario)
        for key in ('korean','math','q1','q2'):self.assertEqual(set(a[key]),set(range(1,10)))
        scenario=deepcopy(self.scenario);scenario['seed']+=1;b,_=generate_candidate_profiles(self.pack,scenario)
        self.assertFalse(np.array_equal(a['korean'][:300],b['korean'][:300]))
        self.assertGreater(info['support_augmentation_rows'],0)
    def test_missing_exam_scores_remain_absent_and_do_not_become_zero_or_grade_nine(self):
        pack=synthetic_missing_pack();a,info=generate_candidate_profiles(pack,synthetic_scenario(pack))
        self.assertTrue(np.any(a['math']==-1));self.assertTrue(np.any(a['english']==-1))
        self.assertTrue(np.any(~complete_mask(a)));self.assertTrue(np.all(a['history']>=1))
        self.assertTrue(np.array_equal(a['math']<0,a['math_choice']<0))
    def test_parameter_context_nonfinite_and_invalid_loading_are_rejected(self):
        for key,value in [('exam_id','SYNTHETIC-other'),('pack_version','SYNTHETIC-other'),('seed',True),('n',0)]:
            s=deepcopy(self.scenario);s[key]=value
            with self.subTest(key=key),self.assertRaises(EstimationError):generate_candidate_profiles(self.pack,s)
        for value in ('NaN','Infinity',True,'1'):
            s=deepcopy(self.scenario);s['proposal']['shared_loadings']['korean']=value
            with self.subTest(value=value),self.assertRaises(EstimationError):generate_candidate_profiles(self.pack,s)
    def test_candidate_mutation_context_duplicate_subject_or_invalid_grade_cannot_pass(self):
        original,info=generate_candidate_profiles(self.pack,self.scenario)
        for mutation in ('context','duplicate','grade','weight','population'):
            a=deepcopy(original);i=deepcopy(info)
            if mutation=='context':i['pack_version']='SYNTHETIC-other'
            elif mutation=='duplicate':a['q2_subject'][0]=a['q1_subject'][0]
            elif mutation=='grade':a['english'][0]=0
            elif mutation=='population':i['inquiry_group_counts'][2]+=1
            else:a['prior'][0]=float('nan')
            with self.subTest(mutation=mutation),self.assertRaises(EstimationError):validate_candidate_profiles(self.pack,a,i)
    def test_zero_count_choice_is_not_generated_or_declared_observed(self):
        raw=deepcopy(self.pack._data);raw['participants']['choice_counts']['국어']['가상미사용선택']=0
        p=ExamPack(raw);s=synthetic_scenario(p);s['proposal']['choice_affinity']['가상미사용선택']='0.9'
        a,i=generate_candidate_profiles(p,s);zero=i['choice_labels']['korean'].index('가상미사용선택')
        self.assertFalse(np.any(a['korean_choice']==zero))
        a['korean_choice'][0]=zero
        with self.assertRaises(EstimationError):validate_candidate_profiles(p,a,i)


if __name__=='__main__':unittest.main()
