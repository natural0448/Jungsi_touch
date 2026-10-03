"""전체 성적 기준의 1차 대학 탐색. 공식 환산·합격확률·기준표 생성은 별도다.

승인과 기준표 로드는 신뢰된 서버의 책임이다. 클라이언트가 승인 상태나
비교 척도를 지정하게 하지 않는다. 파일·DB를 변경하지 않는 순수 계산 모듈.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation, localcontext, ROUND_HALF_UP
from fractions import Fraction
from typing import Iterable

from .percentile import POPULATION_ID, UpperCumulativeResult

OVERALL_TOP_PERCENT = "overall_korean_math_inquiry2_top_percent"
MEAN_GRADE = "csat_korean_math_inquiry2_mean_grade"
GRADE_SCALE = "unweighted_four_subject_grades/v1"


class ScreeningError(ValueError):
    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


def _text(value, name):
    if not isinstance(value, str) or not value.strip():
        raise ScreeningError("invalid_metadata", f"{name}: 비어 있지 않은 문자열이 필요합니다.")


def _number(value):
    if isinstance(value, (bool, float)):
        raise ScreeningError("invalid_number", "정수·소수 문자열·Decimal·Fraction을 사용하세요.")
    try:
        if isinstance(value, Fraction):
            return value
        if type(value) is int:
            return Fraction(value)
        if isinstance(value, (str, Decimal)):
            decimal = Decimal(value)
            if decimal.is_finite():
                return Fraction(decimal)
    except (ValueError, InvalidOperation, TypeError, OverflowError):
        pass
    raise ScreeningError("invalid_number", "유한한 정확한 수가 필요합니다.")


def _display(value: Fraction):
    with localcontext() as context:
        context.prec = max(40, len(str(abs(value.numerator))) + len(str(value.denominator)) + 12)
        result = Decimal(value.numerator) / Decimal(value.denominator)
        return format(result.quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP), "f")


@dataclass(frozen=True)
class ComparisonBasis:
    academic_year: int
    metric_id: str
    population_id: str
    scale_version_id: str
    tie_policy: str | None

    def __post_init__(self):
        if type(self.academic_year) is not int or self.academic_year < 1:
            raise ScreeningError("invalid_year", "적용 학년도는 양의 정수여야 합니다.")
        if self.metric_id not in (OVERALL_TOP_PERCENT, MEAN_GRADE):
            raise ScreeningError("unsupported_metric", "전체 상위 누적과 명시된 수능 평균등급만 지원합니다.")
        if self.population_id != POPULATION_ID:
            raise ScreeningError("population_mismatch", "국어·수학·탐구2 성적이 있는 전체 응시자 기준이 필요합니다.")
        _text(self.scale_version_id, "scale_version_id")
        if self.metric_id == OVERALL_TOP_PERCENT:
            if self.tie_policy not in ("include_equal", "exclude_equal"):
                raise ScreeningError("invalid_tie_policy", "전체 누적의 동점 정책을 지정해야 합니다.")
        elif self.tie_policy is not None or self.scale_version_id != GRADE_SCALE:
            raise ScreeningError("grade_basis_mismatch", "등급은 국수탐2의 동일 가중 평균이며 누적 동점 정책을 쓰지 않습니다.")

    @property
    def domain(self):
        return (Fraction(0), Fraction(100)) if self.metric_id == OVERALL_TOP_PERCENT else (Fraction(1), Fraction(9))

    def to_dict(self):
        return {"academic_year": self.academic_year, "metric_id": self.metric_id,
                "population_id": self.population_id, "scale_version_id": self.scale_version_id,
                "tie_policy": self.tie_policy}


@dataclass(frozen=True)
class ScreeningScore:
    basis: ComparisonBasis
    value: Fraction | Decimal | int | str
    source_status: str
    source_ref: str

    def __post_init__(self):
        if not isinstance(self.basis, ComparisonBasis):
            raise ScreeningError("invalid_basis", "ComparisonBasis가 필요합니다.")
        value = _number(self.value)
        low, high = self.basis.domain
        if not low <= value <= high:
            raise ScreeningError("score_outside_domain", "점수가 비교 지표 범위를 벗어났습니다.")
        permitted = ("approved", "reference", "synthetic") if self.basis.metric_id == OVERALL_TOP_PERCENT else ("reported_input", "synthetic")
        if self.source_status not in permitted:
            raise ScreeningError("invalid_source_status", "지표와 자료 상태가 일치하지 않습니다.")
        _text(self.source_ref, "source_ref")
        object.__setattr__(self, "value", value)

    @classmethod
    def from_overall(cls, result: UpperCumulativeResult):
        if not isinstance(result, UpperCumulativeResult):
            raise ScreeningError("invalid_overall_result", "기존 전체 누적 엔진의 결과가 필요합니다.")
        meta = result.metadata
        return cls(ComparisonBasis(meta.academic_year, OVERALL_TOP_PERCENT,
                                   meta.population_id, meta.distribution_id, result.tie_policy),
                   result.top_percent, meta.status, f"distribution:{meta.distribution_id}")

    @classmethod
    def from_grades(cls, academic_year: int, korean: int, math: int,
                    inquiry1: int, inquiry2: int, *, source_ref="reported_csat_grades"):
        grades = (korean, math, inquiry1, inquiry2)
        if any(type(g) is not int or not 1 <= g <= 9 for g in grades):
            raise ScreeningError("invalid_grades", "국어·수학·탐구 두 과목의 1~9 정수 등급이 필요합니다.")
        return cls(ComparisonBasis(academic_year, MEAN_GRADE, POPULATION_ID, GRADE_SCALE, None),
                   Fraction(sum(grades), 4), "reported_input", source_ref)


@dataclass(frozen=True)
class SchoolBand:
    band_id: str
    school_key: str
    school_name: str
    campus_label: str
    scope_label: str
    basis: ComparisonBasis
    lower: Fraction | Decimal | int | str
    upper: Fraction | Decimal | int | str
    status: str
    basis_kind: str
    source_ref: str
    source_as_of: str

    def __post_init__(self):
        for field in ("band_id", "school_key", "school_name", "campus_label", "scope_label", "source_ref", "source_as_of"):
            _text(getattr(self, field), field)
        if not isinstance(self.basis, ComparisonBasis):
            raise ScreeningError("invalid_basis", "기준표에는 ComparisonBasis가 필요합니다.")
        lower, upper = _number(self.lower), _number(self.upper)
        minimum, maximum = self.basis.domain
        if not minimum <= lower <= upper <= maximum:
            raise ScreeningError("invalid_band", "기준 범위가 뒤집혔거나 지표 범위를 벗어났습니다.")
        if self.status not in ("approved", "reference", "synthetic"):
            raise ScreeningError("invalid_band_status", "승인·참고·가상 상태를 구분해야 합니다.")
        if self.basis_kind not in ("same_metric_reference", "calibrated_estimate", "counselor_reference", "synthetic"):
            raise ScreeningError("invalid_basis_kind", "학교 기준 범위의 제작 근거를 지정해야 합니다.")
        if (self.status == "synthetic") != (self.basis_kind == "synthetic"):
            raise ScreeningError("synthetic_status_mismatch", "가상 기준은 승인 기준으로 표시할 수 없습니다.")
        try:
            date.fromisoformat(self.source_as_of)
        except ValueError as exc:
            raise ScreeningError("invalid_source_date", "자료 기준일은 ISO 날짜여야 합니다.") from exc
        object.__setattr__(self, "lower", lower)
        object.__setattr__(self, "upper", upper)


def recommend_schools(score: ScreeningScore, bands: Iterable[SchoolBand], *,
                      challenge_margin=0, stronger_margin=0, require_approved=True) -> dict:
    """낮은 상위누적/평균등급이 더 높은 성적이다. 여유폭의 단위는 현재 지표.

    학교별 적용 범위들을 유지하면서 학교 목록을 중복 제거한다. 정렬은 탐색
    표시 순서이며 대학 서열이나 합격확률이 아니다. 지원 자격은 후속 확인.
    """
    if not isinstance(score, ScreeningScore):
        raise ScreeningError("invalid_score", "ScreeningScore가 필요합니다.")
    if type(require_approved) is not bool:
        raise ScreeningError("invalid_approval_option", "require_approved는 boolean이어야 합니다.")
    if require_approved and score.source_status not in ("approved", "reported_input"):
        raise ScreeningError("distribution_not_approved", "미승인 전체 누적으로 운영 추천을 만들 수 없습니다.")
    challenge, stronger = _number(challenge_margin), _number(stronger_margin)
    if min(challenge, stronger) < 0 or max(challenge, stronger) > score.basis.domain[1]:
        raise ScreeningError("invalid_margin", "탐색 확장폭은 현재 지표 범위 내의 0 이상 값이어야 합니다.")
    grouped, identities, ids, omitted = {}, {}, set(), []
    compatible_count = 0
    for band in bands:
        if not isinstance(band, SchoolBand):
            raise ScreeningError("invalid_band_record", "SchoolBand가 필요합니다.")
        if band.band_id in ids:
            raise ScreeningError("duplicate_band", "같은 기준 범위를 중복 입력할 수 없습니다.")
        ids.add(band.band_id)
        reason = None
        if band.basis != score.basis:
            reason = "comparison_basis_mismatch"
        elif require_approved and band.status != "approved":
            reason = "band_not_approved"
        if reason:
            omitted.append({"band_id": band.band_id, "reason": reason})
            continue
        identity = (band.school_name, band.campus_label)
        if band.school_key in identities and identities[band.school_key] != identity:
            raise ScreeningError("school_identity_conflict", "같은 학교 키에 서로 다른 학교/캠퍼스 표시가 연결됐습니다.")
        identities[band.school_key] = identity
        compatible_count += 1
        if score.value > band.upper:
            relation, gap, allowed, order, label = "student_weaker", score.value - band.upper, challenge, 2, "도전 후보 탐색"
        elif score.value < band.lower:
            relation, gap, allowed, order, label = "student_stronger", band.lower - score.value, stronger, 1, "여유 후보 탐색"
        else:
            relation, gap, allowed, order, label = "within_band", Fraction(0), Fraction(0), 0, "우선 탐색"
        if gap > allowed:
            omitted.append({"band_id": band.band_id, "reason": "outside_search_window"})
            continue
        center_distance = abs(score.value - (band.lower + band.upper) / 2)
        row = {"band_id": band.band_id, "scope_label": band.scope_label,
               "reference_range": {"lower": _display(band.lower), "upper": _display(band.upper)},
               "relation": relation, "label": label, "gap": _display(gap),
               "basis_kind": band.basis_kind, "reference_status": band.status,
               "source_ref": band.source_ref, "source_as_of": band.source_as_of}
        grouped.setdefault(band.school_key, []).append(((order, gap, center_distance, band.band_id), row))
    ordered = []
    for key, matches in grouped.items():
        matches.sort(key=lambda item: item[0])
        school_name, campus = identities[key]
        ordered.append((matches[0][0][:3] + (key,), {
            "school_key": key, "school_name": school_name, "campus_label": campus,
            "label": matches[0][1]["label"], "matched_scopes": [row for _, row in matches],
            "eligibility_status": "needs_confirmation", "admission_probability": None}))
    ordered.sort(key=lambda item: item[0])
    return {"mode": "first_pass_school_screening", "basis": score.basis.to_dict(),
            "student_value": _display(score.value), "source_status": score.source_status,
            "source_ref": score.source_ref, "production_gates_enforced": require_approved,
            "unit": "percent" if score.basis.metric_id == OVERALL_TOP_PERCENT else "grade",
            "challenge_margin": _display(challenge), "stronger_margin": _display(stronger),
            "status": "ready" if ordered else ("no_candidates_in_window" if compatible_count else "reference_not_ready"),
            "uses_university_conversion": False, "compatible_band_count": compatible_count,
            "schools": [row for _, row in ordered], "omitted_bands": omitted,
            "notes": ["학교 수준을 탐색하는 1차 참고 결과이며 실제 합격 판정이 아닙니다.",
                      "평균등급과 상위 누적을 서로 변환하지 않습니다.",
                      "대학별 환산 유불리·모집단위 입결·지원 자격은 다음 분석에서 확인합니다."]}
