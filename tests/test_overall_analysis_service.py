"""Entirely invented exam/model data; no private files or cleanup required."""
from copy import deepcopy
from dataclasses import replace
from decimal import Decimal, ROUND_HALF_UP
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from jungsi_touch.application.authorization import AccessController, Actor
from jungsi_touch.application.overall_analysis import OverallAnalysisError, OverallAnalysisService
from jungsi_touch.application.ports import TotalModelBinding
from jungsi_touch.exam_pack import ExamPack, ExamTotalModel
from jungsi_touch.infrastructure.memory_report_repository import SyntheticReportAccessRepository
from jungsi_touch.percentile import DistributionMetadata, METRIC_ID, POPULATION_ID, ScoreFrequency, TotalScoreDistribution


def synthetic_pack():
    # Nine fictional people, one per grade; these are not official exam numbers.
    subjects = {}
    definitions = [("국어", "language"), ("수학", "math"),
                   ("가상탐구가", "social"), ("가상탐구나", "social"),
                   ("영어", "english"), ("한국사", "history")]
    for label, category in definitions:
        grades = [{"grade": grade, "count": 1,
                   "lower_score": 10-grade if grade < 9 else None,
                   "upper_exclusive": 11-grade if grade > 1 else None,
                   "published_percent": str((Decimal(100)/9).quantize(Decimal(".01"), rounding=ROUND_HALF_UP)),
                   "source_ref": "SYNTHETIC:grade"} for grade in range(1, 10)]
        subject = {"label": label, "category": category, "denominator": 9, "grades": grades,
                   "assessment": "absolute_grade" if label in ("영어", "한국사") else "standard_score"}
        if subject["assessment"] == "standard_score":
            subject["published_total"] = 9
            subject["frequencies"] = [{"standard_score": score, "count": 1, "cumulative_count": 10-score,
                                       "male_count": 1, "female_count": 0,
                                       "source_ref": "SYNTHETIC:frequency"} for score in range(9, 0, -1)]
        subjects[label] = subject
    data = {"format": "jungsi.exam-pack/v1", "pack_version": "SYNTHETIC-pack.v1",
            "exam": {"exam_id": "SYNTHETIC-mock", "academic_year": 2027,
                     "exam_type": "september_mock", "label": "가상 제어흐름 검산 시험"},
            "subjects": subjects, "sources": [{"source_id": "SYNTHETIC", "sha256": "0"*64}],
            "participants": {"total": 9, "by_subject": {label: 9 for label in subjects},
                "choice_counts": {"국어": {"가상국어선택": 9}, "수학": {"가상수학선택": 9}},
                "inquiry_groups": {"social_only": 9, "science_only": 0, "mixed_social_science": 0, "vocational": 0},
                "inquiry_total": 9, "two_inquiry_derived": {"social_science": 9, "vocational": 0, "total": 9},
                "target_population": {"population_id": POPULATION_ID, "count": 9,
                                      "count_lower_bound": 9, "count_upper_bound": 9}},
            "total_curve_status": "SYNTHETIC-ONLY"}
    return ExamPack(data)


def synthetic_model(pack, **changes):
    fields = {"distribution_id": "SYNTHETIC-model.v1", "academic_year": 2027,
              "source_name": "SYNTHETIC-CONTROL-FLOW-ONLY", "source_date": "2026-10-03",
              "metric_id": METRIC_ID, "population_id": POPULATION_ID, "kind": "observed_counts",
              "status": "approved", "population_verified": True, "complete": True,
              "score_min": 4, "score_max": 36, "expected_total_weight": 9}
    fields.update(changes)
    meta = DistributionMetadata(**fields)
    rows = [ScoreFrequency(20, meta.expected_total_weight-6), ScoreFrequency(30, 4), ScoreFrequency(36, 2)]
    return ExamTotalModel(pack.exam_id, pack.pack_version, TotalScoreDistribution(meta, rows))


class SyntheticExamAnalysisProvider:
    production_allowed = False

    def __init__(self, pack, binding=None):
        self.pack = pack
        self.binding = binding
        self.calls = []

    def get_exam_pack(self, exam_id):
        self.calls.append(("pack", exam_id))
        return self.pack

    def get_total_model(self, exam_id, pack_version):
        self.calls.append(("model", exam_id, pack_version))
        return self.binding


class OverallAnalysisServiceTests(unittest.TestCase):
    def setUp(self):
        self.pack = synthetic_pack()
        self.provider = SyntheticExamAnalysisProvider(self.pack)
        self.access = AccessController(SyntheticReportAccessRepository({}), operating_mode="legacy_synthetic")
        self.service = OverallAnalysisService(self.access, self.provider)
        self.actor = Actor("SYNTHETIC-owner")
        self.request = {"exam_id": self.pack.exam_id, "pack_version": self.pack.pack_version,
            "korean": {"standard_score": 9, "choice": "가상국어선택"},
            "math": {"standard_score": 8, "choice": "가상수학선택"},
            "inquiry": [{"subject": "가상탐구가", "standard_score": 7}, {"subject": "가상탐구나", "standard_score": 6}],
            "english_grade": 3, "korean_history_grade": 2}

    def call(self, actor=None):
        return self.service.analyze(self.actor if actor is None else actor, self.request)

    def approve_model(self, **changes):
        model = synthetic_model(self.pack, **changes)
        self.provider.binding = TotalModelBinding(model, model.distribution.metadata.distribution_id)

    def error(self, code, status, actor=None):
        with self.assertRaises(OverallAnalysisError) as caught:
            self.call(actor)
        self.assertEqual((caught.exception.code, caught.exception.http_status), (code, status))

    def pending(self, reason):
        result = self.call()
        self.assertEqual(result["total_standard_score"], 30)
        self.assertEqual(len(result["subjects"]), 4)
        self.assertEqual(result["overall"]["status"], "pending")
        self.assertEqual(result["overall"]["reason_code"], reason)
        self.assertIsNone(result["overall"]["top_percent"])
        self.assertIsNone(result["overall"]["model_version"])
        return result

    def test_authentication_denied_before_any_provider_or_input_processing(self):
        self.request = None
        self.error("authentication_required", 401, Actor(None))
        self.assertEqual(self.provider.calls, [])

    def test_client_dict_cannot_be_server_actor(self):
        self.error("invalid_server_context", 401, {"subject_id": "SYNTHETIC-owner", "paid_active": True})
        self.assertEqual(self.provider.calls, [])

    def test_standard_and_paid_have_identical_own_overall_results(self):
        self.approve_model()
        self.assertEqual(self.call(), self.call(Actor("SYNTHETIC-owner", True)))

    def test_missing_model_keeps_subjects_total_and_choices(self):
        result = self.pending("total_model_missing")
        self.assertEqual(result["subjects"][0]["choice"], "가상국어선택")
        self.assertEqual(result["absolute_grades"], {"영어": 3, "한국사": 2})

    def test_unapproved_reference_keeps_subjects(self):
        self.approve_model(status="reference", population_verified=False)
        self.pending("total_model_not_approved")

    def test_synthetic_status_is_never_promoted_to_approved(self):
        self.approve_model(status="synthetic", population_verified=False)
        self.pending("total_model_not_approved")

    def test_approved_model_uses_engine_ties_and_percent_units(self):
        self.approve_model()
        result = self.call()["overall"]
        self.assertEqual(result["status"], "observed")
        self.assertEqual(result["top_percent"], "66.666667")
        self.assertEqual(result["exclusive_top_percent"], "22.222222")
        self.assertEqual(result["tie_interval_percent"], {"lower": "22.222222", "upper": "66.666667"})
        self.assertEqual(result["model_version"], "SYNTHETIC-model.v1")
        self.assertIsNone(result["reason_code"])

    def test_estimated_model_is_labeled_estimated(self):
        self.approve_model(kind="estimated_weights")
        self.assertEqual(self.call()["overall"]["status"], "estimated")

    def test_wrong_model_exam_is_pending_without_losing_valid_input(self):
        self.approve_model()
        self.provider.binding = replace(self.provider.binding, model=replace(self.provider.binding.model, exam_id="SYNTHETIC-csat"))
        self.pending("model_exam_mismatch")

    def test_wrong_model_pack_version_is_pending(self):
        self.approve_model()
        self.provider.binding = replace(self.provider.binding, model=replace(self.provider.binding.model, pack_version="SYNTHETIC-pack.v0"))
        self.pending("model_pack_mismatch")

    def test_wrong_model_academic_year_is_pending(self):
        self.approve_model(academic_year=2026)
        self.pending("academic_year_mismatch")

    def test_wrong_model_population_count_is_pending(self):
        self.approve_model(expected_total_weight=8)
        self.pending("model_population_mismatch")

    def test_stale_adopted_model_id_is_pending(self):
        self.approve_model()
        self.provider.binding = replace(self.provider.binding, distribution_id="SYNTHETIC-model.v0")
        self.pending("model_version_mismatch")

    def test_invalid_binding_is_pending(self):
        self.provider.binding = {"model": "client-shaped object", "status": "approved"}
        self.pending("total_model_invalid")

    def test_model_provider_io_failure_keeps_safe_analysis(self):
        def fail(*args):
            raise OSError("private/backend/path-do-not-return")
        self.provider.get_total_model = fail
        result = self.pending("total_model_unavailable")
        self.assertNotIn("private/backend", json.dumps(result))

    def test_model_domain_gap_keeps_valid_score_and_null_rank(self):
        self.approve_model(score_max=36)
        self.request["korean"]["standard_score"] = 1
        self.request["math"]["standard_score"] = 1
        self.request["inquiry"][0]["standard_score"] = 1
        self.request["inquiry"][1]["standard_score"] = 1
        model = synthetic_model(self.pack)
        meta = replace(model.distribution.metadata, score_min=20)
        self.provider.binding = TotalModelBinding(ExamTotalModel(self.pack.exam_id, self.pack.pack_version,
            TotalScoreDistribution(meta, model.distribution.frequency_rows())), meta.distribution_id)
        result = self.call()
        self.assertEqual(result["total_standard_score"], 4)
        self.assertEqual(result["overall"]["reason_code"], "score_outside_domain")
        self.assertIsNone(result["overall"]["top_percent"])

    def test_request_control_fields_are_rejected_before_provider(self):
        for field, value in [("paid_active", True), ("subject_id", "another"), ("research", True),
                             ("status", "approved"), ("source_pack", "data/private.json"), ("tie_policy", "exclude_equal")]:
            with self.subTest(field=field):
                changed = dict(self.request, **{field: value})
                with self.assertRaises(OverallAnalysisError) as caught:
                    self.service.analyze(self.actor, changed)
                self.assertEqual(caught.exception.code, "invalid_request")
        self.assertEqual(self.provider.calls, [])

    def test_second_language_is_grade_only_and_absent_means_not_taken(self):
        self.assertIsNone(self.call()["second_language"])
        self.request["second_language"] = None
        self.assertIsNone(self.call()["second_language"])
        self.request["second_language"] = {"subject": "일본어Ⅰ", "grade": 2}
        result = self.call()
        self.assertEqual(result["second_language"], {"subject": "일본어Ⅰ", "grade": 2})
        self.assertEqual(result["total_standard_score"], 30)
        self.assertNotIn("일본어Ⅰ", [row["subject"] for row in result["subjects"]])
        for bad in ({"subject": "일본어Ⅰ", "grade": 0}, {"subject": "일본어Ⅰ", "grade": 10},
                    {"subject": "일본어Ⅰ", "grade": True}, {"subject": "일본어", "grade": 2},
                    {"subject": "일본어Ⅰ"}, {"subject": "일본어Ⅰ", "grade": 2, "standard_score": 60}, 2):
            with self.subTest(bad=bad):
                self.request["second_language"] = bad
                self.error("invalid_second_language", 422)

    def test_missing_version_and_path_shaped_exam_id_are_rejected(self):
        del self.request["pack_version"]
        self.error("invalid_request", 422)
        self.request["pack_version"] = "SYNTHETIC-pack.v1"
        self.request["exam_id"] = "../private/exam"
        self.error("invalid_request", 422)
        self.assertEqual(self.provider.calls, [])

    def test_wrong_requested_pack_version_stops_before_model(self):
        self.request["pack_version"] = "SYNTHETIC-pack.v0"
        self.error("pack_version_mismatch", 409)
        self.assertEqual(self.provider.calls, [("pack", self.pack.exam_id)])

    def test_wrong_pack_returned_by_provider_is_not_used(self):
        self.request["exam_id"] = "SYNTHETIC-other"
        self.error("exam_binding_invalid", 503)
        self.assertEqual(len(self.provider.calls), 1)

    def test_missing_exam_is_safe_unavailable_error(self):
        self.provider.pack = None
        self.error("exam_not_available", 503)

    def test_invalid_and_boolean_scores_use_existing_engine_validation(self):
        for value in (True, -1, 10, 8.0, "8"):
            with self.subTest(value=value):
                self.request["math"]["standard_score"] = value
                with self.assertRaises(OverallAnalysisError) as caught:
                    self.call()
                self.assertEqual(caught.exception.http_status, 422)
        self.assertTrue(all(row[0] == "pack" for row in self.provider.calls))

    def test_duplicate_inquiry_and_invalid_choice_fail_before_model(self):
        self.request["inquiry"][1]["subject"] = "가상탐구가"
        self.error("duplicate_inquiry", 422)
        self.request["inquiry"][1]["subject"] = "가상탐구나"
        self.request["math"]["choice"] = "없는선택과목"
        self.error("invalid_choice", 422)
        self.assertTrue(all(row[0] == "pack" for row in self.provider.calls))

    def test_input_and_server_model_are_not_mutated(self):
        self.approve_model()
        before = deepcopy(self.request)
        rows = self.provider.binding.model.distribution.frequency_rows()
        self.call()
        self.assertEqual(self.request, before)
        self.assertEqual(self.provider.binding.model.distribution.frequency_rows(), rows)

    def test_dto_excludes_internal_counts_sources_weights_and_university_analysis(self):
        self.approve_model()
        result = self.call()
        self.assertEqual(set(result), {"format", "exam", "pack_version", "score_basis", "total_standard_score",
                                      "subjects", "absolute_grades", "second_language", "overall"})
        raw = json.dumps(result)
        for internal in ("source_ref", "source_name", "sha256", "weights", "frequencies", "denominator",
                         "above_count", "exact_top_fraction", "university_analysis", "owner_id", "subject_id"):
            self.assertNotIn(internal, raw)

    def test_current_contract_matches_ready_and_pending_dto(self):
        contract = json.loads((ROOT / "docs/current/service_spec.json").read_text(encoding="utf-8"))["overall_analysis_contract"]
        for model in (False, True):
            if model:
                self.approve_model()
            result = self.call()
            self.assertEqual(set(result), set(contract["response_fields"]))
            self.assertEqual(set(result["overall"]), set(contract["overall_fields"]))
            self.assertEqual(set(result["subjects"][0]), set(contract["subject_fields"]))


if __name__ == "__main__":
    unittest.main()
