"""국어·수학·탐구2 총점의 상위 누적 계산.

이 모듈은 이미 구성된 총점별 도수 분포를 계산한다. 과목별 주변분포를
결합하거나 모델을 승인하지 않는다. 원본 자료/파일을 수정하지 않는다.
"""
from __future__ import annotations

from bisect import bisect_left, bisect_right
from dataclasses import dataclass
from datetime import date
from decimal import Context, Decimal, InvalidOperation, ROUND_HALF_UP, localcontext
from fractions import Fraction
import json
from typing import Iterable

METRIC_ID = "korean_math_inquiry2_standard_sum"
POPULATION_ID = "all_examinees_with_korean_math_two_inquiry_scores"
DISTRIBUTION_FORMAT = "total_score_frequency/v1"
TIE_POLICIES = frozenset({"include_equal", "exclude_equal"})


class PercentileError(ValueError):
    """호출자가 분기할 수 있는 오류 코드와 한국어 설명."""

    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


def _integer(value: object, name: str, minimum: int = 0) -> int:
    if type(value) is not int or value < minimum:
        raise PercentileError("invalid_integer", f"{name}: {minimum} 이상의 정수가 필요합니다.")
    return value


def _text(value: object, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise PercentileError("invalid_metadata", f"{name}: 빈 값이 아닌 문자열이 필요합니다.")
    return value


def _weight(value: object, name: str = "weight") -> Fraction:
    # JSON 소수는 Decimal로 읽는다. float의 이진 반올림을 인원 검산에 쓰지 않는다.
    if isinstance(value, bool) or isinstance(value, float):
        raise PercentileError("invalid_weight", f"{name}: 정수 또는 정확한 소수 문자열/Decimal을 사용하세요.")
    try:
        if isinstance(value, Fraction):
            result = value
        elif type(value) is int:
            result = Fraction(value)
        elif isinstance(value, (str, Decimal)):
            number = Decimal(value)
            if not number.is_finite():
                raise ValueError("non-finite")
            result = Fraction(number)
        else:
            raise ValueError("unsupported type")
    except (InvalidOperation, ValueError, TypeError, OverflowError) as exc:
        raise PercentileError("invalid_weight", f"{name}: 유한한 0 이상 가중치가 필요합니다.") from exc
    if result < 0:
        raise PercentileError("negative_weight", f"{name}: 음수 인원/가중치는 허용하지 않습니다.")
    return result


def _decimal(value: Fraction, places: int) -> str:
    _integer(places, "decimal_places")
    if places > 12:
        raise PercentileError("invalid_precision", "표시 소수 자릿수는 0~12입니다.")
    precision = max(32, len(str(abs(value.numerator))) + len(str(value.denominator)) + places + 4)
    with localcontext(Context(prec=precision)):
        number = Decimal(value.numerator) / Decimal(value.denominator)
        rounded = number.quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP)
    return format(rounded, f".{places}f")


def _ratio(value: Fraction) -> dict[str, int]:
    return {"numerator": value.numerator, "denominator": value.denominator}


@dataclass(frozen=True)
class StandardScores:
    academic_year: int
    korean: int
    math: int
    inquiry1: int
    inquiry2: int

    def __post_init__(self):
        _integer(self.academic_year, "academic_year", 1)
        for name in ("korean", "math", "inquiry1", "inquiry2"):
            _integer(getattr(self, name), name)

    @property
    def total(self) -> int:
        """구조 검사만 수행. 공식 선택과목·유효 점수 집합 검증은 입력 계층의 책임."""
        return self.korean + self.math + self.inquiry1 + self.inquiry2


@dataclass(frozen=True)
class ScoreFrequency:
    total_score: int
    weight: Fraction | Decimal | int | str

    def __post_init__(self):
        _integer(self.total_score, "total_score")
        object.__setattr__(self, "weight", _weight(self.weight))


@dataclass(frozen=True)
class DistributionMetadata:
    distribution_id: str
    academic_year: int
    source_name: str
    source_date: str
    metric_id: str
    population_id: str
    kind: str  # observed_counts 또는 estimated_weights
    status: str  # synthetic / reference / approved: 신뢰된 서버의 발행 설정
    population_verified: bool
    complete: bool
    score_min: int
    score_max: int
    expected_total_weight: Fraction | Decimal | int | str

    def __post_init__(self):
        for name in ("distribution_id", "source_name", "source_date"):
            _text(getattr(self, name), name)
        try:
            date.fromisoformat(self.source_date)
        except ValueError as exc:
            raise PercentileError("invalid_source_date", "자료 기준일은 유효한 ISO 날짜여야 합니다.") from exc
        _integer(self.academic_year, "academic_year", 1)
        if self.metric_id != METRIC_ID:
            raise PercentileError("metric_mismatch", "국어·수학·탐구2 표준점수 합 분포만 지원합니다.")
        if self.population_id != POPULATION_ID:
            raise PercentileError("population_mismatch", "네 성적이 모두 있는 전체 응시자 모집단이 필요합니다.")
        if self.kind not in ("observed_counts", "estimated_weights"):
            raise PercentileError("invalid_kind", "실제 인원과 추정 가중치를 구분해야 합니다.")
        if self.status not in ("synthetic", "reference", "approved"):
            raise PercentileError("invalid_status", "분포 상태는 synthetic/reference/approved입니다.")
        if type(self.complete) is not bool or type(self.population_verified) is not bool:
            raise PercentileError("invalid_metadata", "완전성·모집단 검증 상태는 boolean이어야 합니다.")
        if not self.complete:
            raise PercentileError("incomplete_distribution", "불완전한 총점 분포로 전체 누적을 계산할 수 없습니다.")
        if self.status == "approved" and not self.population_verified:
            raise PercentileError("unverified_population", "승인 분포는 모집단 검증이 필요합니다.")
        _integer(self.score_min, "score_min")
        _integer(self.score_max, "score_max")
        if self.score_min > self.score_max:
            raise PercentileError("invalid_score_domain", "총점 범위의 최솟값이 최댓값보다 큽니다.")
        expected = _weight(self.expected_total_weight, "expected_total_weight")
        if expected <= 0:
            raise PercentileError("empty_population", "비교 대상 총인원/가중치는 0보다 커야 합니다.")
        if self.kind == "observed_counts" and expected.denominator != 1:
            raise PercentileError("fractional_count", "실제 인원은 정수여야 합니다.")
        object.__setattr__(self, "expected_total_weight", expected)


@dataclass(frozen=True)
class UpperCumulativeResult:
    total_score: int
    metadata: DistributionMetadata
    tie_policy: str
    total_weight: Fraction
    above_weight: Fraction
    equal_weight: Fraction

    @property
    def inclusive_fraction(self) -> Fraction:
        return (self.above_weight + self.equal_weight) / self.total_weight

    @property
    def exclusive_fraction(self) -> Fraction:
        return self.above_weight / self.total_weight

    @property
    def top_fraction(self) -> Fraction:
        return self.inclusive_fraction if self.tie_policy == "include_equal" else self.exclusive_fraction

    @property
    def top_percent(self) -> Fraction:
        return self.top_fraction * 100

    def to_dict(self, decimal_places: int = 6) -> dict:
        """표시 숫자는 소수 문자열. 정확한 비율도 별도로 보존한다."""
        m = self.metadata
        return {
            "academic_year": m.academic_year,
            "metric_id": m.metric_id,
            "population_id": m.population_id,
            "total_score": self.total_score,
            "tie_policy": self.tie_policy,
            "top_percent": _decimal(self.top_percent, decimal_places),
            "inclusive_top_percent": _decimal(self.inclusive_fraction * 100, decimal_places),
            "exclusive_top_percent": _decimal(self.exclusive_fraction * 100, decimal_places),
            "tie_share_percent": _decimal(self.equal_weight / self.total_weight * 100, decimal_places),
            "tie_interval_percent": {
                "lower": _decimal(self.exclusive_fraction * 100, decimal_places),
                "upper": _decimal(self.inclusive_fraction * 100, decimal_places),
                "meaning": "동점 구간이며 모델 오차/합격확률 구간이 아님",
            },
            "exact_top_fraction": _ratio(self.top_fraction),
            "exact_inclusive_fraction": _ratio(self.inclusive_fraction),
            "exact_exclusive_fraction": _ratio(self.exclusive_fraction),
            "weights": {
                "total": str(self.total_weight),
                "above": str(self.above_weight),
                "equal": str(self.equal_weight),
                "at_or_above": str(self.above_weight + self.equal_weight),
            },
            "distribution_id": m.distribution_id,
            "source_name": m.source_name,
            "source_date": m.source_date,
            "distribution_kind": m.kind,
            "distribution_status": m.status,
            "population_verified": m.population_verified,
            "input_validation": "structural_only",
        }


@dataclass(frozen=True, init=False)
class TotalScoreDistribution:
    """불변 도수분포. 전처리 O(k log k), 1인 계산 O(log k), k=총점 키 수."""
    metadata: DistributionMetadata
    _scores: tuple[int, ...]
    _suffix: tuple[Fraction, ...]

    def __init__(self, metadata: DistributionMetadata, rows: Iterable[ScoreFrequency]):
        if not isinstance(metadata, DistributionMetadata):
            raise PercentileError("invalid_metadata", "DistributionMetadata가 필요합니다.")
        frequencies: dict[int, Fraction] = {}
        for row in rows:
            if not isinstance(row, ScoreFrequency):
                raise PercentileError("invalid_row", "ScoreFrequency 행이 필요합니다.")
            if row.total_score in frequencies:
                raise PercentileError("duplicate_score", f"총점 {row.total_score}의 도수 행이 중복됩니다.")
            if not metadata.score_min <= row.total_score <= metadata.score_max:
                raise PercentileError("score_outside_domain", "도수 행의 총점이 선언된 범위 밖입니다.")
            if metadata.kind == "observed_counts" and row.weight.denominator != 1:
                raise PercentileError("fractional_count", "실제 응시 인원에 소수 가중치를 사용할 수 없습니다.")
            frequencies[row.total_score] = row.weight
        if not frequencies:
            raise PercentileError("empty_distribution", "총점별 도수 행이 없습니다.")
        scores = tuple(sorted(frequencies))
        suffix = [Fraction(0)] * (len(scores) + 1)
        for index in range(len(scores) - 1, -1, -1):
            suffix[index] = suffix[index + 1] + frequencies[scores[index]]
        if suffix[0] <= 0:
            raise PercentileError("empty_population", "총인원/가중치가 0입니다.")
        if suffix[0] != metadata.expected_total_weight:
            raise PercentileError("population_total_mismatch", "도수 합계와 확인용 총인원/가중치가 다릅니다.")
        object.__setattr__(self, "metadata", metadata)
        object.__setattr__(self, "_scores", scores)
        object.__setattr__(self, "_suffix", tuple(suffix))

    def frequency_rows(self) -> tuple[ScoreFrequency, ...]:
        """내부 연도 보정에서 재사용할 불변 도수 행. 원본 분포는 수정하지 않는다."""
        return tuple(ScoreFrequency(score, self._suffix[i] - self._suffix[i + 1])
                     for i, score in enumerate(self._scores))

    def calculate(
        self,
        scores: StandardScores,
        *,
        tie_policy: str = "include_equal",
        require_approved: bool = True,
    ) -> UpperCumulativeResult:
        if not isinstance(scores, StandardScores):
            raise PercentileError("invalid_scores", "국어·수학·탐구2 성적이 모두 필요합니다.")
        if scores.academic_year != self.metadata.academic_year:
            raise PercentileError("academic_year_mismatch", "학생 성적과 분포의 학년도가 다릅니다.")
        if not isinstance(tie_policy, str) or tie_policy not in TIE_POLICIES:
            raise PercentileError("invalid_tie_policy", "동점 정책은 include_equal/exclude_equal입니다.")
        if type(require_approved) is not bool:
            raise PercentileError("invalid_approval_option", "require_approved는 boolean이어야 합니다.")
        if require_approved and self.metadata.status != "approved":
            raise PercentileError("model_not_ready", "승인된 분포가 아닙니다. 검산에서만 비승인 계산을 명시적으로 허용하세요.")
        total = scores.total
        if not self.metadata.score_min <= total <= self.metadata.score_max:
            raise PercentileError("score_outside_domain", "학생 총점이 분포의 확인된 범위 밖입니다.")
        left = bisect_left(self._scores, total)
        right = bisect_right(self._scores, total)
        at_or_above = self._suffix[left]
        above = self._suffix[right]
        return UpperCumulativeResult(
            total_score=total,
            metadata=self.metadata,
            tie_policy=tie_policy,
            total_weight=self._suffix[0],
            above_weight=above,
            equal_weight=at_or_above - above,
        )


def _exact_keys(value: object, expected: set[str], location: str) -> dict:
    if not isinstance(value, dict) or set(value) != expected:
        raise PercentileError("invalid_schema", f"{location}: 필드가 누락되었거나 지원하지 않는 필드가 있습니다.")
    return value


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise PercentileError("duplicate_json_key", f"JSON 필드 {key}가 중복됩니다.")
        result[key] = value
    return result


def _invalid_constant(value):
    raise PercentileError("invalid_json_number", f"{value}는 유한한 JSON 숫자가 아닙니다.")


def load_distribution_json(text: str) -> TotalScoreDistribution:
    """총점별 도수 JSON만 읽는다. 누적표/과목별 주변분포는 이 스키마로 읽지 않는다."""
    try:
        data = json.loads(text, parse_float=Decimal, parse_constant=_invalid_constant, object_pairs_hook=_unique_object)
    except (json.JSONDecodeError, TypeError) as exc:
        raise PercentileError("invalid_json", "유효한 분포 JSON이 아닙니다.") from exc
    _exact_keys(data, {"format", "metadata", "rows"}, "distribution")
    if data["format"] != DISTRIBUTION_FORMAT:
        raise PercentileError("invalid_format", "지원하는 형식은 total_score_frequency/v1입니다.")
    metadata = _exact_keys(data["metadata"], set(DistributionMetadata.__dataclass_fields__), "metadata")
    if not isinstance(data["rows"], list):
        raise PercentileError("invalid_schema", "rows는 총점별 도수 행의 배열이어야 합니다.")
    rows = []
    for raw in data["rows"]:
        row = _exact_keys(raw, {"total_score", "weight"}, "row")
        rows.append(ScoreFrequency(**row))
    return TotalScoreDistribution(DistributionMetadata(**metadata), rows)