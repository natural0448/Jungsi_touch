"""과목 간 조합 차이가 총점 분포에 실제로 보존되는지 검증한다. 가상 자료만 사용."""
from dataclasses import replace
from fractions import Fraction
from pathlib import Path
import sys
import unittest

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from jungsi_touch.joint_distribution import JointScoreCount, JointScoreDistribution
from jungsi_touch.percentile import (
    DistributionMetadata, METRIC_ID, POPULATION_ID, PercentileError, StandardScores,
)


def metadata(**changes):
    base = DistributionMetadata(
        distribution_id="synthetic-joint-demo", academic_year=2026,
        source_name="가상 성적 조합 검산", source_date="2026-09-27",
        metric_id=METRIC_ID, population_id=POPULATION_ID,
        kind="observed_counts", status="synthetic", population_verified=False,
        complete=True, score_min=0, score_max=500, expected_total_weight=100,
    )
    return replace(base, **changes)


def cell(k, m, q1, q2, count, year=2026):
    return JointScoreCount(StandardScores(year, k, m, q1, q2), count)


def spread():
    # 수학 80점인 100명의 국어 점수가 50/70/90점으로 나뉜 가상 분포.
    return JointScoreDistribution(metadata(), [
        cell(50, 80, 40, 50, 20), cell(70, 80, 40, 50, 50), cell(90, 80, 40, 50, 30),
    ])


class JointDistributionTests(unittest.TestCase):
    def test_fixed_math_has_multiple_korean_scores(self):
        model = spread()
        self.assertEqual(model.conditional_counts(target="korean", given={"math": 80}), {50: 20, 70: 50, 90: 30})
        self.assertEqual({row.total_score: row.weight for row in model.total_frequencies}, {220: 20, 240: 50, 260: 30})
        result = model.to_total_distribution().calculate(StandardScores(2026, 70, 80, 40, 50), require_approved=False)
        self.assertEqual(result.top_percent, 80)
        self.assertEqual(result.above_weight, 30)
        self.assertEqual(result.equal_weight, 50)

    def test_same_marginals_different_pairings_have_different_total_tails(self):
        together = JointScoreDistribution(metadata(), [cell(80, 80, 30, 30, 50), cell(40, 40, 30, 30, 50)])
        apart = JointScoreDistribution(metadata(), [cell(80, 40, 30, 30, 50), cell(40, 80, 30, 30, 50)])
        for area in ("korean", "math", "inquiry1", "inquiry2"):
            self.assertEqual(together.conditional_counts(target=area, given={}), apart.conditional_counts(target=area, given={}))
        student = StandardScores(2026, 80, 40, 30, 30)
        top_a = together.to_total_distribution().calculate(student, require_approved=False)
        top_b = apart.to_total_distribution().calculate(student, require_approved=False)
        self.assertEqual(top_a.top_percent, 50)
        self.assertEqual(top_b.top_percent, 100)

    def test_inquiry_pairings_are_not_reconstructed_independently(self):
        model = JointScoreDistribution(metadata(), [cell(100, 100, 70, 30, 40), cell(100, 100, 30, 70, 60)])
        self.assertEqual(model.conditional_counts(target="inquiry2", given={"inquiry1": 70}), {30: 40})
        self.assertEqual(model.conditional_counts(target="inquiry2", given={"inquiry1": 30}), {70: 60})
        self.assertEqual({row.total_score: row.weight for row in model.total_frequencies}, {300: 100})

    def test_total_tail_matches_direct_four_subject_count(self):
        model = spread()
        for total in (0, 219, 220, 230, 240, 260, 261, 500):
            student = StandardScores(2026, total, 0, 0, 0)
            result = model.to_total_distribution().calculate(student, require_approved=False)
            direct = sum(c.count for c in model.cells if c.scores.total >= total)
            self.assertEqual(result.top_fraction, direct / 100)

    def test_input_order_does_not_change_distribution(self):
        model = spread()
        reversed_model = JointScoreDistribution(model.metadata, reversed(model.cells))
        self.assertEqual(model, reversed_model)

    def test_unapproved_input_stays_unapproved(self):
        model = spread()
        self.assertIs(model.to_total_distribution().metadata, model.metadata)
        with self.assertRaises(PercentileError) as caught:
            model.to_total_distribution().calculate(StandardScores(2026, 70, 80, 40, 50))
        self.assertEqual(caught.exception.code, "model_not_ready")

    def test_duplicate_cells_rejected(self):
        with self.assertRaises(PercentileError) as caught:
            JointScoreDistribution(metadata(), [cell(70, 80, 40, 50, 50), cell(70, 80, 40, 50, 50)])
        self.assertEqual(caught.exception.code, "duplicate_joint_cell")

    def test_mixed_year_rejected(self):
        with self.assertRaises(PercentileError) as caught:
            JointScoreDistribution(metadata(), [cell(70, 80, 40, 50, 100, year=2025)])
        self.assertEqual(caught.exception.code, "academic_year_mismatch")

    def test_population_total_checked(self):
        with self.assertRaises(PercentileError) as caught:
            JointScoreDistribution(metadata(), [cell(70, 80, 40, 50, 99)])
        self.assertEqual(caught.exception.code, "population_total_mismatch")

    def test_fractional_observed_cells_rejected_before_aggregation(self):
        with self.assertRaises(PercentileError) as caught:
            JointScoreDistribution(metadata(expected_total_weight=1), [cell(70, 80, 40, 50, "0.5"), cell(80, 70, 40, 50, "0.5")])
        self.assertEqual(caught.exception.code, "fractional_count")

    def test_estimated_counts_keep_exact_fraction(self):
        model = JointScoreDistribution(metadata(kind="estimated_weights", expected_total_weight="0.3"), [
            cell(50, 80, 40, 50, "0.1"), cell(90, 80, 40, 50, "0.2"),
        ])
        result = model.to_total_distribution().calculate(StandardScores(2026, 90, 80, 40, 50), require_approved=False)
        self.assertEqual(result.top_fraction, Fraction(2, 3))

    def test_absent_condition_not_interpolated(self):
        self.assertEqual(spread().conditional_counts(target="korean", given={"math": 79}), {})

    def test_invalid_cells_counts_and_conditions_rejected(self):
        for bad_count in (0, -1, True, 1.5, "NaN", "Infinity"):
            with self.subTest(count=bad_count), self.assertRaises(PercentileError):
                cell(50, 80, 40, 50, bad_count)
        for bad in (None, {"korean": {50: 100}}, [50, 80, 40, 50, 100]):
            with self.subTest(cell=bad), self.assertRaises(PercentileError):
                JointScoreDistribution(metadata(), [bad])
        for target, given in (("english", {}), ("korean", {"math": True}), ("korean", {"math": -1}), ("korean", {"english": 80}), ("korean", [])):
            with self.subTest(target=target, given=given), self.assertRaises(PercentileError):
                spread().conditional_counts(target=target, given=given)


if __name__ == "__main__":
    unittest.main()