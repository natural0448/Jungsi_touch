# 2026-09-27 정정: 가중합 예제는 과목 간 결합분포 추정 요구의 해결안이 아니다.
# 기존 연구 기록으로 보존하며, 전체 총점 누적 집계는 joint_distribution.py를 사용한다.
"""과목 성적을 유지하는 분포 분석과 명시적 평가식별 누적.

과목별 주변분포만으로 종합 누적을 추정하지 않는다. 연구용 반영비율은
공식 대학 환산식이나 서비스의 확정 대표지표로 간주하지 않는다.
"""
from __future__ import annotations

from bisect import bisect_left, bisect_right
from dataclasses import dataclass
from fractions import Fraction
from typing import Callable, Iterable

from .percentile import POPULATION_ID, PercentileError, _decimal, _integer, _text, _weight


class WeightedECDF:
    """동점이 있는 연결 표본의 가중 경험 분포. 값은 정확한 유리수."""

    def __init__(self, pairs: Iterable[tuple[object, object]], expected_weight: object):
        mass: dict[Fraction, Fraction] = {}
        for value, weight in pairs:
            value, weight = _weight(value, "score_value"), _weight(weight)
            if weight == 0:
                continue
            mass[value] = mass.get(value, Fraction(0)) + weight
        self.values = tuple(sorted(mass))
        self.total = sum(mass.values(), Fraction(0))
        if self.total <= 0:
            raise PercentileError("empty_population", "유효 비교 질량이 없습니다.")
        if self.total != _weight(expected_weight):
            raise PercentileError("population_total_mismatch", "확인용 질량과 합계가 다릅니다.")
        suffix = [Fraction(0)] * (len(self.values) + 1)
        for i in range(len(self.values) - 1, -1, -1):
            suffix[i] = suffix[i + 1] + mass[self.values[i]]
        self.suffix = tuple(suffix)

    def fractions(self, value: object) -> tuple[Fraction, Fraction]:
        """(strictly_above, at_or_above): 두 값 모두 0~1."""
        value = _weight(value, "score_value")
        a, b = bisect_left(self.values, value), bisect_right(self.values, value)
        return self.suffix[b] / self.total, self.suffix[a] / self.total


@dataclass(frozen=True)
class SubjectMark:
    area: str
    subject_id: str
    standard_score: int
    elective: str | None = None

    def __post_init__(self):
        if self.area not in ("korean", "math", "inquiry"):
            raise PercentileError("invalid_area", "국어·수학·탐구 영역을 구분해야 합니다.")
        _text(self.subject_id, "subject_id")
        _integer(self.standard_score, "standard_score")
        if self.elective is not None:
            _text(self.elective, "elective")


@dataclass(frozen=True)
class ExamProfile:
    academic_year: int
    korean: SubjectMark
    math: SubjectMark
    inquiry1: SubjectMark
    inquiry2: SubjectMark
    english_grade: int | None = None
    korean_history_grade: int | None = None

    def __post_init__(self):
        _integer(self.academic_year, "academic_year", 1)
        for field, area in (("korean", "korean"), ("math", "math"), ("inquiry1", "inquiry"), ("inquiry2", "inquiry")):
            mark = getattr(self, field)
            if not isinstance(mark, SubjectMark) or mark.area != area:
                raise PercentileError("invalid_profile", "국어·수학·서로 다른 탐구2 성적이 필요합니다.")
        if self.inquiry1.subject_id == self.inquiry2.subject_id:
            raise PercentileError("duplicate_inquiry", "서로 다른 탐구 2과목이어야 합니다.")
        for field in ("english_grade", "korean_history_grade"):
            grade = getattr(self, field)
            if grade is not None:
                _integer(grade, field, 1)
                if grade > 9:
                    raise PercentileError("invalid_grade", "등급은 1~9입니다.")

    @property
    def marks(self) -> tuple[SubjectMark, ...]:
        return self.korean, self.math, self.inquiry1, self.inquiry2

    @property
    def standard_total(self) -> int:
        return sum(mark.standard_score for mark in self.marks)


class SubjectDistribution:
    """해당 학년도·실제 점수 집단의 도수표. 선택과목 집단을 자동 추정하지 않음."""

    def __init__(
        self, academic_year: int, area: str, subject_id: str,
        counts: Iterable[tuple[int, int]], *,
        distribution_id: str, population_label: str, expected_count: int,
        complete: bool, status: str = "reference",
    ):
        self.academic_year = _integer(academic_year, "academic_year", 1)
        if area not in ("korean", "math", "inquiry"):
            raise PercentileError("invalid_area", "과목분포의 영역이 잘못됐습니다.")
        self.area = area
        self.subject_id = _text(subject_id, "subject_id")
        self.distribution_id = _text(distribution_id, "distribution_id")
        self.population_label = _text(population_label, "population_label")
        if complete is not True:
            raise PercentileError("incomplete_distribution", "과목 분포 전체가 필요합니다.")
        if status not in ("synthetic", "reference", "approved"):
            raise PercentileError("invalid_status", "잘못된 과목 분포 상태입니다.")
        self.status = status
        _integer(expected_count, "expected_count", 1)
        rows = list(counts)
        seen = set()
        for score, count in rows:
            _integer(score, "subject_score")
            _integer(count, "subject_count")
            if score in seen:
                raise PercentileError("duplicate_score", "과목 도수표의 점수 키가 중복됩니다.")
            seen.add(score)
        self._allowed_scores = frozenset(seen)
        self._cdf = WeightedECDF(rows, expected_count)

    def midrank_fraction(self, mark: SubjectMark) -> Fraction:
        strict, inclusive = self.upper_fractions(mark)
        # P(S < s) + 0.5 * P(S = s). 공식 성적표 백분위와 별도인 내부 좌표.
        return 1 - (strict + inclusive) / 2

    def upper_fractions(self, mark: SubjectMark) -> tuple[Fraction, Fraction]:
        if not isinstance(mark, SubjectMark) or mark.area != self.area or mark.subject_id != self.subject_id:
            raise PercentileError("subject_mismatch", "성적과 분포의 과목이 다릅니다.")
        if mark.standard_score not in self._allowed_scores:
            raise PercentileError("unsupported_subject_score", "과목 도수표에서 확인되지 않은 점수입니다.")
        return self._cdf.fractions(mark.standard_score)


@dataclass(frozen=True)
class JointRecord:
    row_id: str
    profile: ExamProfile
    weight: object

    def __post_init__(self):
        _text(self.row_id, "row_id")
        if not isinstance(self.profile, ExamProfile):
            raise PercentileError("invalid_profile", "한 응시자의 과목들이 연결된 성적이 필요합니다.")
        value = _weight(self.weight)
        if value <= 0:
            raise PercentileError("invalid_weight", "연결 표본의 질량은 양수여야 합니다.")
        object.__setattr__(self, "weight", value)


@dataclass(frozen=True)
class ProfileRule:
    rule_id: str
    academic_year: int
    description: str
    scorer: Callable[[ExamProfile, "ProfilePercentileModel"], object]
    approved: bool = False

    def __post_init__(self):
        _text(self.rule_id, "rule_id")
        _text(self.description, "description")
        _integer(self.academic_year, "academic_year", 1)
        if not callable(self.scorer) or type(self.approved) is not bool:
            raise PercentileError("invalid_rule", "평가 함수와 승인 상태가 필요합니다.")


def make_research_weighted_rule(
    rule_id: str, academic_year: int, *, korean: object, math: object,
    inquiry: object, basis: str,
) -> ProfileRule:
    """기본 가중치 없음. 모든 가중치를 명시하며 항상 연구용으로 생성한다.

    standard_score: 국어, 수학, 탐구2 합에 가중치 적용.
    subject_midrank: 국어, 수학, 탐구2 중간순위 평균에 가중치 적용.
    """
    weights = tuple(_weight(x, "rule_weight") for x in (korean, math, inquiry))
    if sum(weights) != 1:
        raise PercentileError("invalid_rule_weights", "국어·수학·탐구 가중치의 합은 1이어야 합니다.")
    if basis not in ("standard_score", "subject_midrank"):
        raise PercentileError("invalid_rule_basis", "지원하지 않는 연구용 점수 기준입니다.")

    def score(profile: ExamProfile, model: ProfilePercentileModel):
        if basis == "subject_midrank":
            rank = tuple(model._table(mark).midrank_fraction(mark) for mark in profile.marks)
            values = (rank[0], rank[1], (rank[2] + rank[3]) / 2)
        else:
            values = (profile.korean.standard_score, profile.math.standard_score,
                      profile.inquiry1.standard_score + profile.inquiry2.standard_score)
        return sum((w * v for w, v in zip(weights, values)), Fraction(0))

    return ProfileRule(rule_id, academic_year,
                       f"연구용 {basis}; 국어/수학/탐구 가중치 {weights}", score, approved=False)


class ProfilePercentileModel:
    def __init__(
        self, academic_year: int, subjects: Iterable[SubjectDistribution], *,
        model_id: str, records: Iterable[JointRecord] | None = None,
        expected_joint_weight: object | None = None, population_id: str = POPULATION_ID,
        population_verified: bool = False, status: str = "reference",
    ):
        self.academic_year = _integer(academic_year, "academic_year", 1)
        self.model_id = _text(model_id, "model_id")
        if population_id != POPULATION_ID:
            raise PercentileError("population_mismatch", "공통 분석은 국수탐2 성적 보유 전체 집단 기준입니다.")
        if status not in ("synthetic", "reference", "approved") or type(population_verified) is not bool:
            raise PercentileError("invalid_metadata", "모형 상태와 모집단 검증 여부를 확인하세요.")
        self.status, self.population_verified = status, population_verified
        self.population_id = population_id
        self._subjects = {}
        for subject in subjects:
            if not isinstance(subject, SubjectDistribution) or subject.academic_year != academic_year:
                raise PercentileError("academic_year_mismatch", "과목 분포의 학년도가 다릅니다.")
            key = subject.area, subject.subject_id
            if key in self._subjects:
                raise PercentileError("duplicate_subject", "같은 과목 분포가 중복됐습니다.")
            self._subjects[key] = subject
        self._records = None if records is None else tuple(records)
        self._expected_joint_weight = None
        if self._records is not None:
            if not self._records or expected_joint_weight is None:
                raise PercentileError("missing_joint_distribution", "연결된 성적 표본과 확인용 전체 질량이 필요합니다.")
            seen = set()
            for record in self._records:
                if not isinstance(record, JointRecord):
                    raise PercentileError("invalid_joint_record", "잘못된 연결 표본입니다.")
                if record.row_id in seen:
                    raise PercentileError("duplicate_joint_record", "같은 연결 표본 행이 중복됐습니다.")
                seen.add(record.row_id)
                self._validate_profile(record.profile)
            total = sum((r.weight for r in self._records), Fraction(0))
            if total != _weight(expected_joint_weight):
                raise PercentileError("population_total_mismatch", "연결 표본 전체 질량이 다릅니다.")
            self._expected_joint_weight = total
        elif expected_joint_weight is not None:
            raise PercentileError("missing_joint_distribution", "분모만으로 연결 성적을 대신할 수 없습니다.")
        if status == "approved" and (
            not population_verified or self._records is None
            or any(s.status != "approved" for s in self._subjects.values())
        ):
            raise PercentileError("model_not_ready", "연결 분포·모집단·과목 분포 검증이 모두 필요합니다.")
        self._curves: dict[int, tuple[ProfileRule, WeightedECDF]] = {}

    def _table(self, mark: SubjectMark) -> SubjectDistribution:
        table = self._subjects.get((mark.area, mark.subject_id))
        if table is None:
            raise PercentileError("missing_subject_distribution", "해당 과목의 분포가 없습니다.")
        return table

    def _validate_profile(self, profile: ExamProfile):
        if not isinstance(profile, ExamProfile) or profile.academic_year != self.academic_year:
            raise PercentileError("academic_year_mismatch", "학생 성적과 모형 학년도가 다릅니다.")
        for mark in profile.marks:
            self._table(mark).upper_fractions(mark)

    def describe(self, profile: ExamProfile) -> dict:
        self._validate_profile(profile)
        subjects = []
        for slot, mark in zip(("korean", "math", "inquiry1", "inquiry2"), profile.marks):
            table = self._table(mark)
            strict, inclusive = table.upper_fractions(mark)
            subjects.append({
                "slot": slot, "subject_id": mark.subject_id, "elective": mark.elective,
                "standard_score": mark.standard_score,
                "upper_inclusive_percent": _decimal(inclusive * 100, 6),
                "upper_exclusive_percent": _decimal(strict * 100, 6),
                "internal_midrank_percent": _decimal(table.midrank_fraction(mark) * 100, 6),
                "population_label": table.population_label,
                "distribution_id": table.distribution_id, "status": table.status,
            })
        return {
            "academic_year": self.academic_year, "model_id": self.model_id,
            "standard_total": profile.standard_total, "subjects": subjects,
            "national_top_percent": None,
            "national_status": "scoring_rule_required" if self._records is not None else "joint_distribution_required",
            "note": "과목별 상대 위치와 종합 순위는 구분하며, 중간순위는 내부 계산 좌표입니다.",
        }

    def rank(self, profile: ExamProfile, rule: ProfileRule, *, require_approved: bool = True) -> dict:
        self._validate_profile(profile)
        if not isinstance(rule, ProfileRule) or rule.academic_year != self.academic_year:
            raise PercentileError("academic_year_mismatch", "평가식과 모형의 학년도가 다릅니다.")
        if self._records is None:
            raise PercentileError("missing_joint_distribution", "과목별 분포만으로 종합 누적을 계산하지 않습니다.")
        if type(require_approved) is not bool:
            raise PercentileError("invalid_approval_option", "승인 검사 옵션은 boolean이어야 합니다.")
        if require_approved and (self.status != "approved" or not rule.approved):
            raise PercentileError("model_not_ready", "모형과 평가식이 모두 승인돼야 합니다.")
        # 평가식은 같은 참조 응시자 전원과 학생에게 동일하게 적용한다.
        # 순수·결정적 함수 및 버전 불변성이 서버 평가식의 계약이다.
        key = id(rule)
        if key not in self._curves:
            pairs = ((rule.scorer(row.profile, self), row.weight) for row in self._records)
            # 평가식 객체를 함께 보관하여 id 재사용을 막고, 해시 불가능한 callable도 지원한다.
            self._curves[key] = (rule, WeightedECDF(pairs, self._expected_joint_weight))
        score = _weight(rule.scorer(profile, self), "composite_score")
        strict, inclusive = self._curves[key][1].fractions(score)
        return {
            "academic_year": self.academic_year, "model_id": self.model_id,
            "rule_id": rule.rule_id, "rule_description": rule.description,
            "standard_total": profile.standard_total, "composite_score_exact": str(score),
            "top_percent": _decimal(inclusive * 100, 6),
            "exclusive_top_percent": _decimal(strict * 100, 6),
            "tie_share_percent": _decimal((inclusive - strict) * 100, 6),
            "exact_top_fraction": {"numerator": inclusive.numerator, "denominator": inclusive.denominator},
            "population_id": self.population_id, "population_verified": self.population_verified,
            "reference_weight": str(self._expected_joint_weight),
            "model_status": self.status, "rule_approved": rule.approved,
            "meaning": "명시한 평가식으로 같은 연결 참조집단을 평가한 상위 누적",
        }