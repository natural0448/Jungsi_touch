"""동일 총점의 강점 차이와 학년도·과목 분포·연결 의존성 검증."""
from dataclasses import replace
from fractions import Fraction
from pathlib import Path
import sys
import unittest

sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'src'))
sys.path.insert(0,str(ROOT/'scripts'))
from demo_profile_percentile import build_demo, make_profile
from jungsi_touch.percentile import PercentileError
from jungsi_touch.profile_percentile import (
    ExamProfile, JointRecord, ProfilePercentileModel, ProfileRule,
    SubjectDistribution, SubjectMark, WeightedECDF, make_research_weighted_rule,
)


class ProfilePercentileTests(unittest.TestCase):
    def setUp(self):
        self.model,self.rules,self.students,self.tables,self.records=build_demo()

    def code(self,code,function,*args,**kwargs):
        with self.assertRaises(PercentileError) as error:
            function(*args,**kwargs)
        self.assertEqual(error.exception.code,code)

    def rank(self,student,rule):
        return self.model.rank(self.students[student],self.rules[rule],require_approved=False)

    def test_same_total_baseline_is_equal_but_math_emphasis_distinguishes(self):
        self.assertEqual({p.standard_total for p in self.students.values()},{400})
        self.assertEqual({self.rank(name,'total_baseline')['top_percent'] for name in self.students},{'35.000000'})
        self.assertEqual(self.rank('수학 강점형','math_emphasis')['top_percent'],'20.000000')
        self.assertEqual(self.rank('균형형','math_emphasis')['top_percent'],'30.000000')
        self.assertEqual(self.rank('국어 강점형','math_emphasis')['top_percent'],'50.000000')

    def test_language_and_math_preferences_reverse(self):
        self.assertEqual(self.rank('국어 강점형','korean_emphasis')['top_percent'],'20.000000')
        self.assertEqual(self.rank('수학 강점형','korean_emphasis')['top_percent'],'40.000000')

    def test_midrank_composite_is_not_reported_as_percentile_itself(self):
        result=self.rank('균형형','subject_position_balanced')
        self.assertEqual(result['composite_score_exact'],'89/120')
        self.assertEqual(result['top_percent'],'25.000000')
        self.assertNotEqual(Fraction(result['composite_score_exact'])*100,Fraction(result['top_percent']))

    def test_all_rules_remain_explicit_research_choices(self):
        for rule in self.rules.values():
            self.assertFalse(rule.approved)
            self.code('model_not_ready',self.model.rank,self.students['균형형'],rule)

    def test_subject_only_keeps_national_percentile_empty(self):
        model=ProfilePercentileModel(2026,self.tables,model_id='marginals-only')
        description=model.describe(self.students['수학 강점형'])
        self.assertIsNone(description['national_top_percent'])
        self.assertEqual(description['national_status'],'joint_distribution_required')
        self.assertEqual(len(description['subjects']),4)
        self.code('missing_joint_distribution',model.rank,self.students['수학 강점형'],self.rules['math_emphasis'],require_approved=False)

    def test_linked_data_still_requires_explicit_score_rule(self):
        result=self.model.describe(self.students['균형형'])
        self.assertIsNone(result['national_top_percent'])
        self.assertEqual(result['national_status'],'scoring_rule_required')

    def test_year_specific_subject_distribution_changes_position(self):
        a=SubjectDistribution(2026,'math','m',[(100,90),(130,10)],distribution_id='y26',population_label='가상',expected_count=100,complete=True,status='synthetic')
        b=SubjectDistribution(2027,'math','m',[(100,60),(130,40)],distribution_id='y27',population_label='가상',expected_count=100,complete=True,status='synthetic')
        mark=SubjectMark('math','m',130)
        self.assertEqual(a.upper_fractions(mark)[1],Fraction(1,10))
        self.assertEqual(b.upper_fractions(mark)[1],Fraction(2,5))
        self.assertNotEqual(a.midrank_fraction(mark),b.midrank_fraction(mark))

    def test_equal_marginals_different_joint_structure_different_tail(self):
        p=lambda k,m:ExamProfile(2026,SubjectMark('korean','k',k),SubjectMark('math','m',m),SubjectMark('inquiry','a',50),SubjectMark('inquiry','b',50))
        tables=[SubjectDistribution(2026,area,subject,counts,distribution_id='syn-'+subject,population_label='가상',expected_count=100,complete=True,status='synthetic')
                for area,subject,counts in [('korean','k',[(0,50),(100,50)]),('math','m',[(0,50),(100,50)]),('inquiry','a',[(50,100)]),('inquiry','b',[(50,100)])]]
        joint_a=[JointRecord('a1',p(100,100),50),JointRecord('a2',p(0,0),50)]
        joint_b=[JointRecord('b1',p(100,0),50),JointRecord('b2',p(0,100),50)]
        models=[ProfilePercentileModel(2026,tables,model_id='synthetic-'+name,records=rows,expected_joint_weight=100,status='synthetic') for name,rows in [('a',joint_a),('b',joint_b)]]
        rule=make_research_weighted_rule('synthetic-km',2026,korean='0.5',math='0.5',inquiry=0,basis='subject_midrank')
        results=[m.rank(p(100,0),rule,require_approved=False)['top_percent'] for m in models]
        self.assertEqual(results,['50.000000','100.000000'])
        self.assertEqual(models[0].describe(p(100,0))['subjects'],models[1].describe(p(100,0))['subjects'])

    def test_inquiry_order_does_not_change_result(self):
        student=self.students['수학 강점형']
        swapped=replace(student,inquiry1=student.inquiry2,inquiry2=student.inquiry1)
        for rule in self.rules.values():
            self.assertEqual(self.model.rank(student,rule,require_approved=False),self.model.rank(swapped,rule,require_approved=False))

    def test_english_retained_but_not_silently_added_to_general_metric(self):
        a=self.students['균형형'];b=replace(a,english_grade=1)
        self.assertNotEqual(a.english_grade,b.english_grade)
        self.assertEqual(a.standard_total,b.standard_total)
        self.assertEqual(self.model.rank(a,self.rules['math_emphasis'],require_approved=False),self.model.rank(b,self.rules['math_emphasis'],require_approved=False))

    def test_custom_server_rule_can_use_full_profile(self):
        rule=ProfileRule('synthetic-english-effect',2026,'가상 확장 예제',lambda p,m: p.standard_total-(p.english_grade-1)*5)
        first=self.model.rank(self.students['균형형'],rule,require_approved=False)
        second=self.model.rank(replace(self.students['균형형'],english_grade=1),rule,require_approved=False)
        self.assertNotEqual(first['composite_score_exact'],second['composite_score_exact'])

    def test_rule_distribution_cached_without_dropping_profile_fields(self):
        calls=[]
        def scoring(p,m):
            calls.append(p)
            return p.standard_total
        rule=ProfileRule('synthetic-cache',2026,'가상',scoring)
        self.model.rank(self.students['균형형'],rule,require_approved=False)
        self.assertEqual(len(calls),len(self.records)+1)
        self.model.rank(self.students['수학 강점형'],rule,require_approved=False)
        self.assertEqual(len(calls),len(self.records)+2)

    def test_unhashable_callable_supported_and_rule_instances_kept_separate(self):
        class Scorer:
            __hash__=None
            def __call__(self,p,m):
                return p.standard_total
        rule=ProfileRule('callable-instance',2026,'가상',Scorer())
        self.assertEqual(self.model.rank(self.students['균형형'],rule,require_approved=False)['top_percent'],'35.000000')
        changed=ProfileRule('callable-instance',2026,'캐시 혼동 방지 가상',lambda p,m:p.math.standard_score)
        self.assertEqual(self.model.rank(self.students['수학 강점형'],changed,require_approved=False)['top_percent'],'10.000000')

    def test_supported_points_are_exact_and_never_interpolated(self):
        changed=replace(self.students['균형형'],math=SubjectMark('math','demo-math',131))
        self.code('unsupported_subject_score',self.model.describe,changed)

    def test_academic_year_rejected_for_profile_table_and_rule(self):
        self.code('academic_year_mismatch',self.model.describe,replace(self.students['균형형'],academic_year=2027))
        self.code('academic_year_mismatch',self.model.rank,self.students['균형형'],replace(self.rules['math_emphasis'],academic_year=2027),require_approved=False)
        self.code('academic_year_mismatch',ProfilePercentileModel,2027,self.tables,model_id='wrong-year')

    def test_inquiry_duplicates_missing_fields_and_area_mismatch_rejected(self):
        profile=self.students['균형형']
        self.code('duplicate_inquiry',replace,profile,inquiry2=profile.inquiry1)
        self.code('invalid_profile',replace,profile,math=None)
        self.code('invalid_profile',replace,profile,math=profile.korean)
        self.code('invalid_grade',replace,profile,english_grade=10)

    def test_unverified_choice_distribution_not_fabricated(self):
        changed=replace(self.students['균형형'],inquiry2=SubjectMark('inquiry','new-subject',70))
        self.code('missing_subject_distribution',self.model.describe,changed)

    def test_no_default_or_invalid_weights(self):
        for weights in [('0.2','0.5','0.2'),('-0.1','0.5','0.6')]:
            with self.assertRaises(PercentileError):
                make_research_weighted_rule('invalid',2026,korean=weights[0],math=weights[1],inquiry=weights[2],basis='subject_midrank')
        self.code('invalid_rule_basis',make_research_weighted_rule,'invalid',2026,korean='0.2',math='0.5',inquiry='0.3',basis='percentile_product')

    def test_duplicate_joint_and_subject_inputs_rejected(self):
        self.code('duplicate_joint_record',ProfilePercentileModel,2026,self.tables,model_id='bad',records=[self.records[0],self.records[0]],expected_joint_weight=20)
        self.code('duplicate_subject',ProfilePercentileModel,2026,[self.tables[0],self.tables[0]],model_id='bad')

    def test_joint_mass_and_empty_reference_rejected(self):
        self.code('population_total_mismatch',ProfilePercentileModel,2026,self.tables,model_id='bad',records=self.records,expected_joint_weight=101)
        self.code('missing_joint_distribution',ProfilePercentileModel,2026,self.tables,model_id='bad',records=[],expected_joint_weight=100)
        self.code('missing_joint_distribution',ProfilePercentileModel,2026,self.tables,model_id='bad',expected_joint_weight=100)

    def test_invalid_subject_histogram_rejected(self):
        base=dict(distribution_id='bad',population_label='가상',expected_count=100,complete=True)
        self.code('duplicate_score',SubjectDistribution,2026,'math','m',[(100,50),(100,50)],**base)
        self.code('population_total_mismatch',SubjectDistribution,2026,'math','m',[(100,90)],**base)
        base['complete']=False
        self.code('incomplete_distribution',SubjectDistribution,2026,'math','m',[(100,100)],**base)

    def test_approval_cannot_skip_linked_population_or_subject_validation(self):
        self.code('model_not_ready',ProfilePercentileModel,2026,self.tables,model_id='bad',records=self.records,expected_joint_weight=100,status='approved',population_verified=True)
        self.code('population_mismatch',ProfilePercentileModel,2026,self.tables,model_id='bad',population_id='humanities_only')

    def test_fractional_reference_weights_remain_exact(self):
        cdf=WeightedECDF([(10,'0.1'),(20,'0.2')],'0.3')
        self.assertEqual(cdf.fractions(20),(0,Fraction(2,3)))
        self.assertEqual(cdf.fractions(15),(Fraction(2,3),Fraction(2,3)))
        self.assertEqual(cdf.fractions(30),(0,0))


if __name__=='__main__':
    unittest.main(verbosity=2)