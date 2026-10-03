"""1차 학교 탐색의 지표·연도·동점·승인·경계·중복 검증. 전부 가상 자료."""
from dataclasses import replace
from fractions import Fraction
from pathlib import Path
import sys
import unittest
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from jungsi_touch.percentile import DistributionMetadata, ScoreFrequency, StandardScores, TotalScoreDistribution, METRIC_ID, POPULATION_ID
from jungsi_touch.school_screening import ComparisonBasis, ScreeningScore, SchoolBand, ScreeningError, recommend_schools, OVERALL_TOP_PERCENT, MEAN_GRADE, GRADE_SCALE


def distribution(status="approved"):
    # 승인 경로도 테스트하기 위한 가상 메타데이터. 운영 자료가 아니다.
    meta = DistributionMetadata("SYNTHETIC-total-v1", 2027, "가상 테스트", "2026-09-29",
        METRIC_ID, POPULATION_ID, "observed_counts", status, status == "approved", True, 0, 600, 1000)
    return TotalScoreDistribution(meta, [ScoreFrequency(380,880), ScoreFrequency(382,60), ScoreFrequency(400,60)])


def point():
    return ScreeningScore.from_overall(distribution().calculate(StandardScores(2027,126,128,63,65)))


def band(key="A", lower="10", upper="15", basis=None, **changes):
    values=dict(band_id=f"band-{key}", school_key=f"SYN-{key}", school_name=f"가상{key}대학교",
        campus_label="가상캠퍼스", scope_label="일반 모집단위 참고 범위", basis=basis or point().basis,
        lower=lower, upper=upper, status="approved", basis_kind="counselor_reference",
        source_ref="IN_MEMORY_TEST_ONLY", source_as_of="2026-09-29")
    values.update(changes)
    return SchoolBand(**values)


class SchoolScreeningTests(unittest.TestCase):
    def assert_code(self, code, function, *args, **kwargs):
        with self.assertRaises(ScreeningError) as caught:
            function(*args, **kwargs)
        self.assertEqual(caught.exception.code, code)

    def test_total_score_integration_and_wide_candidate_groups(self):
        p=point()
        self.assertEqual(p.value, 12)
        result=recommend_schools(p, [band(),band("B","8","11"),band("C","16","22"),band("D","1","4")],challenge_margin=2,stronger_margin=5)
        self.assertEqual([s['school_key'] for s in result['schools']], ['SYN-A','SYN-C','SYN-B'])
        self.assertEqual([s['matched_scopes'][0]['relation'] for s in result['schools']], ['within_band','student_stronger','student_weaker'])
        self.assertEqual(result['omitted_bands'],[{'band_id':'band-D','reason':'outside_search_window'}])

    def test_same_total_different_subjects_same_first_pass(self):
        d=distribution()
        a=ScreeningScore.from_overall(d.calculate(StandardScores(2027,126,128,63,65)))
        b=ScreeningScore.from_overall(d.calculate(StandardScores(2027,130,124,63,65)))
        self.assertEqual(recommend_schools(a,[band()]),recommend_schools(b,[band()]))

    def test_school_group_preserves_multiple_matching_scopes(self):
        scopes=[band(),band(band_id='A-engineering',scope_label='가상 공학 모집단위',lower=12,upper=18)]
        result=recommend_schools(point(),scopes)
        self.assertEqual(len(result['schools']),1)
        self.assertEqual(len(result['schools'][0]['matched_scopes']),2)

    def test_grade_average_has_separate_scale_and_exact_result(self):
        p=ScreeningScore.from_grades(2027,2,3,3,4)
        self.assertEqual(p.value,3)
        self.assertEqual(p.basis.metric_id,MEAN_GRADE)
        result=recommend_schools(p,[band(lower='2.5',upper='3.5',basis=p.basis)])
        self.assertEqual(result['unit'],'grade')
        self.assertEqual(len(result['schools']),1)

    def test_percentile_does_not_match_grade_band(self):
        grade=ScreeningScore.from_grades(2027,2,3,3,4)
        result=recommend_schools(point(),[band(lower='2.5',upper='3.5',basis=grade.basis)])
        self.assertEqual(result['schools'],[])
        self.assertEqual(result['status'],'reference_not_ready')

    def test_missing_and_invalid_grades_are_rejected(self):
        for grade in (None,True,0,10,2.5,'3'):
            with self.subTest(grade=grade):
                self.assert_code('invalid_grades',ScreeningScore.from_grades,2027,grade,3,3,4)

    def test_year_mismatch_is_omitted_even_if_school_name_changed(self):
        other=replace(point().basis,academic_year=2026)
        result=recommend_schools(point(),[band(),band(band_id='older',basis=other,school_name='가상 구교명')])
        self.assertEqual(len(result['schools']),1)
        self.assertEqual(result['omitted_bands'][0]['reason'],'comparison_basis_mismatch')

    def test_curve_version_mismatch_is_omitted(self):
        other=replace(point().basis,scale_version_id='OTHER-v1')
        self.assertEqual(recommend_schools(point(),[band(basis=other)])['schools'],[])

    def test_tie_policy_mismatch_is_omitted(self):
        other=replace(point().basis,tie_policy='exclude_equal')
        self.assertEqual(recommend_schools(point(),[band(basis=other)])['schools'],[])

    def test_conditional_population_cannot_be_used_as_all_students(self):
        self.assert_code('population_mismatch',ComparisonBasis,2027,OVERALL_TOP_PERCENT,'humanities_only','v1','include_equal')

    def test_unapproved_distribution_is_rejected_by_default(self):
        d=distribution('synthetic')
        p=ScreeningScore.from_overall(d.calculate(StandardScores(2027,126,128,63,65),require_approved=False))
        self.assert_code('distribution_not_approved',recommend_schools,p,[band()])

    def test_unapproved_school_band_is_omitted(self):
        result=recommend_schools(point(),[band(status='reference')])
        self.assertEqual(result['status'],'reference_not_ready')
        self.assertEqual(result['omitted_bands'][0]['reason'],'band_not_approved')

    def test_demo_requires_explicit_nonproduction_override(self):
        d=distribution('synthetic')
        p=ScreeningScore.from_overall(d.calculate(StandardScores(2027,126,128,63,65),require_approved=False))
        result=recommend_schools(p,[band(status='synthetic',basis_kind='synthetic')],require_approved=False)
        self.assertEqual(len(result['schools']),1)
        self.assertFalse(result['production_gates_enforced'])
        self.assertEqual(result['schools'][0]['matched_scopes'][0]['reference_status'],'synthetic')

    def test_synthetic_band_cannot_be_labelled_approved(self):
        self.assert_code('synthetic_status_mismatch',band,basis_kind='synthetic')

    def test_exact_band_endpoints_match(self):
        for lower,upper in [('12','15'),('10','12'),('12','12')]:
            with self.subTest(lower=lower,upper=upper):
                self.assertEqual(len(recommend_schools(point(),[band(lower=lower,upper=upper)])['schools']),1)

    def test_margin_endpoint_and_just_beyond(self):
        b=band(lower=8,upper=10)
        self.assertEqual(len(recommend_schools(point(),[b],challenge_margin=2)['schools']),1)
        p=replace(point(),value=Fraction(120000001,10000000))
        self.assertEqual(recommend_schools(p,[b],challenge_margin=2)['schools'],[])

    def test_display_rounding_does_not_decide_match(self):
        p=replace(point(),value=Fraction(150000001,10000000))
        result=recommend_schools(p,[band()])
        self.assertEqual(result['student_value'],'15.000000')
        self.assertEqual(result['schools'],[])

    def test_no_implicit_search_margin(self):
        result=recommend_schools(point(),[band(lower=13,upper=15)])
        self.assertEqual(result['status'],'no_candidates_in_window')

    def test_invalid_numeric_inputs_and_reversed_band(self):
        for value in (float('nan'),True,'Infinity','NaN',object()):
            with self.subTest(value=value):
                self.assert_code('invalid_number',band,lower=value)
        self.assert_code('invalid_band',band,lower=30,upper=10)

    def test_duplicate_band_ids_are_rejected(self):
        self.assert_code('duplicate_band',recommend_schools,point(),[band(),band()])

    def test_same_school_key_conflicting_identity_rejected(self):
        self.assert_code('school_identity_conflict',recommend_schools,point(),[band(),band(band_id='other',campus_label='다른 캠퍼스')])

    def test_invalid_margins_and_approval_flag(self):
        self.assert_code('invalid_margin',recommend_schools,point(),[band()],challenge_margin=-1)
        self.assert_code('invalid_approval_option',recommend_schools,point(),[band()],require_approved=1)

    def test_empty_catalog_is_not_a_negative_admission_decision(self):
        result=recommend_schools(point(),[])
        self.assertEqual(result['status'],'reference_not_ready')
        self.assertEqual(result['schools'],[])


if __name__ == '__main__':
    unittest.main()
