"""Stateless page-2 analysis; HTTP, authentication and persistence are adapters.

Only a verified server Actor and server-owned data reach the existing engine.
No university analysis, research flags, paths, weights or source tables leave
this application boundary. Missing/bad total models keep valid subject results.
"""
from copy import deepcopy
import re

from ..exam_pack import ExamPack, ExamTotalModel
from ..percentile import PercentileError, POPULATION_ID
from .authorization import AccessController, Actor
from .ports import ExamAnalysisProvider, TotalModelBinding
from .platform_ports import PlatformError


class OverallAnalysisError(ValueError):
    """Safe application failure for an eventual HTTP adapter to translate."""

    def __init__(self, code: str, http_status: int, message: str):
        self.code = code
        self.http_status = http_status
        super().__init__(message)


def _identifier(value):
    return isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}", value) is not None


def _scores(request):
    required = {"exam_id", "pack_version", "korean", "math", "inquiry"}
    optional = {"english_grade", "korean_history_grade"}
    if not isinstance(request, dict) or not required <= set(request) or set(request) - required - optional:
        raise OverallAnalysisError("invalid_request", 422, "필수 성적과 허용된 입력 필드를 확인하세요.")
    if not _identifier(request["exam_id"]) or not _identifier(request["pack_version"]):
        raise OverallAnalysisError("invalid_request", 422, "시험 ID와 자료 버전을 확인하세요.")
    for area in ("korean", "math"):
        row = request[area]
        if not isinstance(row, dict) or "standard_score" not in row or set(row) - {"standard_score", "choice"}:
            raise OverallAnalysisError("invalid_request", 422, "영역별 표준점수와 선택과목만 입력하세요.")
    inquiry = request["inquiry"]
    if not isinstance(inquiry, list) or len(inquiry) != 2 or any(
        not isinstance(row, dict) or set(row) != {"subject", "standard_score"} for row in inquiry
    ):
        raise OverallAnalysisError("invalid_request", 422, "탐구 두 과목의 과목명과 표준점수가 필요합니다.")
    return {key: deepcopy(value) for key, value in request.items() if key != "pack_version"}


def _pending(reason_code):
    return {
        "status": "pending", "reason_code": reason_code,
        "top_percent": None, "inclusive_top_percent": None,
        "exclusive_top_percent": None, "tie_share_percent": None,
        "tie_interval_percent": None, "tie_policy": "include_equal",
        "population_id": POPULATION_ID, "model_version": None,
    }


def _student_response(analysis, payload, overall):
    """Build an allowlist DTO instead of forwarding internal engine mappings."""
    exam = analysis["exam"]
    subjects = []
    for area, row in zip(("korean", "math", "inquiry1", "inquiry2"), analysis["subjects"]):
        public = {key: deepcopy(row[key]) for key in (
            "subject", "standard_score", "grade", "top_percent_exclusive",
            "top_percent_inclusive", "basis",
        )}
        public["area"] = area
        public["choice"] = payload[area].get("choice") if area in ("korean", "math") else None
        subjects.append(public)
    return {
        "format": "jungsi.overall-analysis/v1",
        "exam": {key: deepcopy(exam[key]) for key in ("exam_id", "academic_year", "exam_type")},
        "pack_version": analysis["pack_version"], "score_basis": analysis["score_basis"],
        "total_standard_score": analysis["total_standard_score"], "subjects": subjects,
        "absolute_grades": {key: analysis["absolute_grades"][key] for key in ("영어", "한국사")
                            if key in analysis["absolute_grades"]},
        "overall": deepcopy(overall),
    }


class OverallAnalysisService:
    def __init__(self, access: AccessController, data: ExamAnalysisProvider):
        self._access = access
        self._data = data

    def analyze(self, actor: Actor, request: dict) -> dict:
        # Authorization precedes both request validation and any data lookup.
        decision = self._access.operation_access("overall.analyze", actor)
        if not decision.allowed:
            raise OverallAnalysisError(decision.status, decision.http_status, "이 작업을 이용할 권한을 확인하세요.")
        payload = _scores(request)
        try:
            pack = self._data.get_exam_pack(payload["exam_id"])
        except (OSError, PercentileError, PlatformError) as exc:
            raise OverallAnalysisError("exam_data_unavailable", 503, "시험 자료 확인이 필요합니다.") from exc
        if pack is None:
            raise OverallAnalysisError("exam_not_available", 503, "시험 자료 확인이 필요합니다.")
        if not isinstance(pack, ExamPack) or pack.exam_id != payload["exam_id"]:
            raise OverallAnalysisError("exam_binding_invalid", 503, "시험 자료 연결 확인이 필요합니다.")
        if pack.pack_version != request["pack_version"]:
            raise OverallAnalysisError("pack_version_mismatch", 409, "시험 자료 버전이 변경되었습니다.")
        try:
            analysis = pack.analyze(payload)
        except PercentileError as exc:
            raise OverallAnalysisError(exc.code, 422, "해당 시험의 과목과 유효 성적을 확인하세요.") from exc
        overall = self._overall(pack, payload)
        return _student_response(analysis, payload, overall)

    def _overall(self, pack, payload):
        # Model availability failures never discard a successfully validated profile.
        try:
            binding = self._data.get_total_model(pack.exam_id, pack.pack_version)
        except PlatformError as error:
            reasons={'artifact_not_approved':'total_model_not_approved','drive_hash_mismatch':'model_provider_hash_mismatch',
                     'drive_version_mismatch':'model_provider_version_mismatch','artifact_version_mismatch':'model_provider_version_mismatch'}
            return _pending(reasons.get(error.code,'total_model_unavailable'))
        except (OSError, PercentileError):
            return _pending("total_model_unavailable")
        if binding is None:
            return _pending("total_model_missing")
        if not isinstance(binding, TotalModelBinding) or not isinstance(binding.model, ExamTotalModel):
            return _pending("total_model_invalid")
        model = binding.model
        if not _identifier(binding.distribution_id) or model.distribution.metadata.distribution_id != binding.distribution_id:
            return _pending("model_version_mismatch")
        if model.distribution.metadata.status != "approved":
            return _pending("total_model_not_approved")
        try:
            result = pack.analyze(payload, total_model=model)["overall"]
        except PercentileError as exc:
            allowed = {"model_exam_mismatch", "model_pack_mismatch", "model_population_mismatch",
                       "academic_year_mismatch", "score_outside_domain", "model_not_ready"}
            return _pending(exc.code if exc.code in allowed else "total_model_invalid")
        public = {key: deepcopy(result[key]) for key in (
            "status", "top_percent", "inclusive_top_percent", "exclusive_top_percent",
            "tie_share_percent", "tie_policy", "population_id",
        )}
        public["tie_interval_percent"] = {key: result["tie_interval_percent"][key] for key in ("lower", "upper")}
        public.update(reason_code=None, model_version=binding.distribution_id)
        return public
