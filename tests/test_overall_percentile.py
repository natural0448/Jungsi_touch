"""누적 방향·동점·가중치·모집단·자료 상태 및 CLI 계약 검증. 파일 삭제 없음."""
from contextlib import redirect_stdout, redirect_stderr
from dataclasses import replace
from decimal import Decimal, Inexact, localcontext
from fractions import Fraction
from io import StringIO
import json
from pathlib import Path
import random
import sys
import unittest

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from jungsi_touch.percentile import (
    DistributionMetadata, PercentileError, ScoreFrequency, StandardScores,
    TotalScoreDistribution, load_distribution_json,
)
from jungsi_touch.percentile_cli import main

FIXTURE = ROOT / "examples/percentile/distribution.synthetic.json"


def profile(total=400, year=2026):
    q, remainder = divmod(total, 4)
    return StandardScores(year, q + remainder, q, q, q)


class OverallPercentileTests(unittest.TestCase):
    def setUp(self):
        self.text = FIXTURE.read_text(encoding="utf-8")
        self.distribution = load_distribution_json(self.text)
        self.metadata = self.distribution.metadata

    def assert_code(self, expected, function, *args, **kwargs):
        with self.assertRaises(PercentileError) as error:
            function(*args, **kwargs)
        self.assertEqual(error.exception.code, expected)

    def calculate(self, total=400, **kwargs):
        return self.distribution.calculate(profile(total), require_approved=False, **kwargs)

    def test_default_includes_ties(self):
        result = self.calculate()
        self.assertEqual(result.total_score, 400)
        self.assertEqual(result.top_percent, 30)
        self.assertEqual(result.above_weight, 10)
        self.assertEqual(result.equal_weight, 20)
        self.assertEqual(result.inclusive_fraction, Fraction(3,10))
        self.assertEqual(result.exclusive_fraction, Fraction(1,10))

    def test_explicit_excludes_ties(self):
        result = self.calculate(tie_policy="exclude_equal")
        self.assertEqual(result.top_percent, 10)
        self.assertEqual(result.inclusive_fraction, Fraction(3,10))

    def test_same_total_different_subjects_same_percentile(self):
        a = self.distribution.calculate(StandardScores(2026,137,133,65,65), require_approved=False)
        b = self.distribution.calculate(StandardScores(2026,132,138,66,64), require_approved=False)
        self.assertEqual(a.top_fraction,b.top_fraction)
        self.assertEqual(a.to_dict(),b.to_dict())

    def test_missing_score_is_rejected(self):
        self.assert_code("invalid_integer",StandardScores,2026,137,None,65,65)

    def test_non_integer_negative_and_boolean_scores_rejected(self):
        for bad in (-1,True,False,100.5,"137",Decimal("137")):
            with self.subTest(bad=bad):
                self.assert_code("invalid_integer",StandardScores,2026,bad,133,65,65)

    def test_year_mismatch_is_rejected(self):
        self.assert_code("academic_year_mismatch",self.distribution.calculate,profile(400,2027),require_approved=False)

    def test_source_range_is_enforced(self):
        self.assert_code("score_outside_domain",self.distribution.calculate,profile(501),require_approved=False)

    def test_gap_in_complete_histogram_means_zero_tie_mass(self):
        result = self.calculate(395)
        self.assertEqual(result.top_percent,30)
        self.assertEqual(result.equal_weight,0)
        self.assertEqual(result.inclusive_fraction,result.exclusive_fraction)

    def test_full_histogram_tail_boundaries(self):
        self.assertEqual(self.calculate(380).top_percent,100)
        self.assertEqual(self.calculate(410).top_percent,10)
        self.assertEqual(self.calculate(0).top_percent,100)
        self.assertEqual(self.calculate(500).top_percent,0)

    def test_all_candidates_tied(self):
        dist = TotalScoreDistribution(self.metadata,[ScoreFrequency(400,100)])
        result = dist.calculate(profile(), require_approved=False)
        self.assertEqual(result.inclusive_fraction,1)
        self.assertEqual(result.exclusive_fraction,0)

    def test_observed_counts_cannot_be_fractional(self):
        self.assert_code("fractional_count",TotalScoreDistribution,self.metadata,[ScoreFrequency(400,"99.5"),ScoreFrequency(410,"0.5")])
        self.assert_code("fractional_count",replace,self.metadata,expected_total_weight="99.5")

    def test_negative_nonfinite_and_binary_float_weights_rejected(self):
        for bad in (-1,"-0.5","NaN","Infinity",Decimal("NaN"),True,0.1,None):
            with self.subTest(bad=bad):
                with self.assertRaises(PercentileError): ScoreFrequency(400,bad)

    def test_decimal_weights_exact_not_rounded_population_count(self):
        metadata = replace(self.metadata,kind="estimated_weights",expected_total_weight="0.3")
        dist = TotalScoreDistribution(metadata,[ScoreFrequency(400,"0.2"),ScoreFrequency(410,"0.1")])
        result = dist.calculate(profile(410),require_approved=False)
        self.assertEqual(result.top_fraction,Fraction(1,3))
        self.assertEqual(result.total_weight,Fraction(3,10))
        self.assertEqual(result.to_dict()["top_percent"],"33.333333")
        self.assertEqual(result.to_dict()["distribution_kind"],"estimated_weights")

    def test_decimal_json_loader_preserves_exact_weights(self):
        data = json.loads(self.text)
        data["metadata"].update(kind="estimated_weights",expected_total_weight="0.3")
        data["rows"]=[{"total_score":400,"weight":0.1},{"total_score":410,"weight":0.2}]
        dist=load_distribution_json(json.dumps(data))
        self.assertEqual(dist.calculate(profile(410),require_approved=False).top_fraction,Fraction(2,3))

    def test_caller_decimal_context_does_not_change_results(self):
        with localcontext() as context:
            context.prec=2
            self.assertEqual(self.calculate().to_dict()["top_percent"],"30.000000")

    def test_caller_decimal_traps_do_not_break_percent_formatting(self):
        metadata=replace(self.metadata,kind="estimated_weights",expected_total_weight=3)
        dist=TotalScoreDistribution(metadata,[ScoreFrequency(400,2),ScoreFrequency(410,1)])
        with localcontext() as context:
            context.traps[Inexact]=True
            self.assertEqual(dist.calculate(profile(410),require_approved=False).to_dict()["top_percent"],"33.333333")

    def test_population_sum_mismatch_is_rejected(self):
        self.assert_code("population_total_mismatch",TotalScoreDistribution,self.metadata,[ScoreFrequency(400,99)])

    def test_empty_and_zero_populations_rejected(self):
        self.assert_code("empty_distribution",TotalScoreDistribution,self.metadata,[])
        self.assert_code("empty_population",TotalScoreDistribution,self.metadata,[ScoreFrequency(400,0)])
        self.assert_code("empty_population",replace,self.metadata,expected_total_weight=0)

    def test_duplicate_score_rows_rejected(self):
        self.assert_code("duplicate_score",TotalScoreDistribution,self.metadata,[ScoreFrequency(400,50),ScoreFrequency(400,50)])

    def test_frequency_domain_rejected(self):
        self.assert_code("score_outside_domain",TotalScoreDistribution,self.metadata,[ScoreFrequency(501,100)])

    def test_split_population_or_other_metric_rejected(self):
        self.assert_code("population_mismatch",replace,self.metadata,population_id="humanities_only")
        self.assert_code("metric_mismatch",replace,self.metadata,metric_id="sum_of_percentile_scores")

    def test_incomplete_distribution_rejected(self):
        self.assert_code("incomplete_distribution",replace,self.metadata,complete=False)

    def test_synthetic_distribution_blocked_by_default(self):
        self.assert_code("model_not_ready",self.distribution.calculate,profile())

    def test_reference_distribution_also_requires_explicit_research(self):
        dist=TotalScoreDistribution(replace(self.metadata,status="reference"),[ScoreFrequency(400,100)])
        self.assert_code("model_not_ready",dist.calculate,profile())
        self.assertEqual(dist.calculate(profile(),require_approved=False).to_dict()["distribution_status"],"reference")

    def test_approved_requires_verified_population(self):
        self.assert_code("unverified_population",replace,self.metadata,status="approved")

    def test_approved_metadata_execution_path(self):
        # 승인 분기만 검증하는 메모리 내 가상 자료이며 실제 분포 승인으로 저장하지 않는다.
        metadata=replace(self.metadata,status="approved",population_verified=True)
        dist=TotalScoreDistribution(metadata,[ScoreFrequency(400,100)])
        self.assertEqual(dist.calculate(profile()).top_percent,100)

    def test_invalid_policy_and_approval_option(self):
        for policy in ("midrank",None,[],True):
            self.assert_code("invalid_tie_policy",self.calculate,tie_policy=policy)
        self.assert_code("invalid_approval_option",self.distribution.calculate,profile(),require_approved="false")

    def test_metadata_flags_domain_and_date_validated(self):
        for change in ({"complete":"true"},{"population_verified":1},{"score_min":501},{"source_date":"bad"},{"distribution_id":""},{"academic_year":True}):
            with self.subTest(change=change):
                with self.assertRaises(PercentileError): replace(self.metadata,**change)

    def test_not_a_cumulative_table_or_subject_marginal_table(self):
        data=json.loads(self.text)
        data["format"]="cumulative_percentile/v1"
        self.assert_code("invalid_format",load_distribution_json,json.dumps(data))
        data["format"]="total_score_frequency/v1"
        data["rows"][0]={"total_score":380,"cumulative_percent":100}
        self.assert_code("invalid_schema",load_distribution_json,json.dumps(data))

    def test_json_duplicate_keys_nonfinite_and_unknown_fields_rejected(self):
        duplicate=self.text.replace('"academic_year": 2026','"academic_year": 2026, "academic_year": 2025')
        self.assert_code("duplicate_json_key",load_distribution_json,duplicate)
        for token in ("NaN","Infinity","-Infinity"):
            self.assert_code("invalid_json_number",load_distribution_json,self.text.replace('"weight": 40','"weight": '+token))
        data=json.loads(self.text);data["unrecognized"]="ignored?"
        self.assert_code("invalid_schema",load_distribution_json,json.dumps(data))

    def test_result_preserves_direction_unit_and_tie_interval(self):
        result=self.calculate().to_dict()
        self.assertEqual(result["top_percent"],"30.000000")
        self.assertEqual(result["exact_top_fraction"],{"numerator":3,"denominator":10})
        self.assertEqual(result["tie_share_percent"],"20.000000")
        self.assertEqual(result["tie_interval_percent"]["lower"],"10.000000")
        self.assertEqual(result["tie_interval_percent"]["upper"],"30.000000")
        self.assertEqual(result["input_validation"],"structural_only")
        self.assertEqual(result["distribution_status"],"synthetic")
        self.assertEqual(self.calculate().to_dict(2)["top_percent"],"30.00")
        self.assert_code("invalid_precision",self.calculate().to_dict,13)

    def test_order_independent_and_monotone_against_expanded_people_oracle(self):
        randomizer=random.Random(20260927)
        rows=[ScoreFrequency(total,randomizer.randint(1,9)) for total in randomizer.sample(range(100,451),40)]
        people=[row.total_score for row in rows for _ in range(int(row.weight))]
        metadata=replace(self.metadata,expected_total_weight=len(people))
        dist=TotalScoreDistribution(metadata,reversed(rows))
        previous=Fraction(1)
        for total in range(0,501):
            result=dist.calculate(profile(total),require_approved=False)
            expected_ge=Fraction(sum(score>=total for score in people),len(people))
            expected_gt=Fraction(sum(score>total for score in people),len(people))
            self.assertEqual(result.inclusive_fraction,expected_ge)
            self.assertEqual(result.exclusive_fraction,expected_gt)
            self.assertLessEqual(result.top_fraction,previous)
            previous=result.top_fraction

    def run_cli(self,*extra):
        out,err=StringIO(),StringIO()
        with redirect_stdout(out),redirect_stderr(err):
            code=main(["--distribution",str(FIXTURE),"--academic-year","2026","--scores","137","133","65","65",*extra])
        return code,out.getvalue(),err.getvalue()

    def test_cli_default_rejects_unapproved(self):
        code,out,err=self.run_cli()
        self.assertEqual(code,2);self.assertEqual(out,"")
        self.assertEqual(json.loads(err)["error"],"model_not_ready")

    def test_cli_research_mode_calculates_json(self):
        code,out,err=self.run_cli("--allow-unapproved")
        self.assertEqual(code,0);self.assertEqual(err,"")
        self.assertEqual(json.loads(out)["top_percent"],"30.000000")

    def test_cli_exclusive_mode(self):
        code,out,err=self.run_cli("--allow-unapproved","--tie-policy","exclude_equal")
        self.assertEqual(code,0);self.assertEqual(err,"")
        self.assertEqual(json.loads(out)["top_percent"],"10.000000")


if __name__ == "__main__":
    unittest.main(verbosity=2)