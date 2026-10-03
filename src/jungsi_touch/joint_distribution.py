"""네 과목의 연결을 보존한 조합별 인원 → 국수탐2 총점 분포.

과목 반영비율이나 동일 분위 매칭을 사용하지 않는다. 각 입력 셀은
같은 응시자의 (국어, 수학, 탐구1, 탐구2) 조합에 해당하는 인원이다.
주변분포로부터 연결 구조를 추정하는 기능은 포함하지 않는다.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from fractions import Fraction
from typing import Iterable, Mapping

from .percentile import (
    DistributionMetadata, PercentileError, ScoreFrequency, StandardScores,
    TotalScoreDistribution, _integer, _weight,
)

AREAS = ("korean", "math", "inquiry1", "inquiry2")


@dataclass(frozen=True)
class JointScoreCount:
    """한 성적 조합의 실제 인원 또는 명시적으로 추정한 인원.

    count는 이 조합의 인원이며 과목에 곱하는 반영비율이 아니다.
    동일 조합이 여러 원천에 있다면 중복 응시자를 제거한 뒤 합쳐야 한다.
    """
    scores: StandardScores
    count: Fraction | Decimal | int | str

    def __post_init__(self):
        if not isinstance(self.scores, StandardScores):
            raise PercentileError("invalid_scores", "같은 응시자에 연결된 네 과목 성적이 필요합니다.")
        count = _weight(self.count, "count")
        if count <= 0:
            raise PercentileError("invalid_count", "조합별 인원은 0보다 커야 합니다.")
        object.__setattr__(self, "count", count)


@dataclass(frozen=True, init=False)
class JointScoreDistribution:
    """서버 내부용 조합 분포. 입력 조합을 재매칭하거나 섞지 않는다.

    자료의 대표성·모집단 완전성·공식 유효 점수는 상위 자료 검증 단계의
    책임이다. 메타데이터의 상태/출처를 그대로 유지하며 자동 승인하지 않는다.
    """
    metadata: DistributionMetadata
    cells: tuple[JointScoreCount, ...]
    total_frequencies: tuple[ScoreFrequency, ...]
    _total_distribution: TotalScoreDistribution

    def __init__(self, metadata: DistributionMetadata, cells: Iterable[JointScoreCount]):
        if not isinstance(metadata, DistributionMetadata):
            raise PercentileError("invalid_metadata", "DistributionMetadata가 필요합니다.")
        joint = {}
        totals: dict[int, Fraction] = {}
        for cell in cells:
            if not isinstance(cell, JointScoreCount):
                raise PercentileError("invalid_joint_cell", "성적 조합과 인원이 연결된 JointScoreCount가 필요합니다.")
            if cell.scores.academic_year != metadata.academic_year:
                raise PercentileError("academic_year_mismatch", "조합 성적과 분포의 학년도가 다릅니다.")
            key = tuple(getattr(cell.scores, area) for area in AREAS)
            if key in joint:
                raise PercentileError("duplicate_joint_cell", "같은 성적 조합이 중복되었습니다. 원천 중복 여부를 확인하세요.")
            # 총점으로 합치기 전에 검사한다. 소수 인원이 합쳐져 정수가 될 수 있다.
            if metadata.kind == "observed_counts" and cell.count.denominator != 1:
                raise PercentileError("fractional_count", "실제 조합별 인원은 정수여야 합니다.")
            joint[key] = cell
            total = cell.scores.total
            totals[total] = totals.get(total, Fraction(0)) + cell.count
        frequencies = tuple(ScoreFrequency(total, totals[total]) for total in sorted(totals))
        # 분모·총점 범위·빈 분포 등을 기존 총점 엔진과 동일하게 검증한다.
        distribution = TotalScoreDistribution(metadata, frequencies)
        object.__setattr__(self, "metadata", metadata)
        object.__setattr__(self, "cells", tuple(joint[key] for key in sorted(joint)))
        object.__setattr__(self, "total_frequencies", frequencies)
        object.__setattr__(self, "_total_distribution", distribution)

    def to_total_distribution(self) -> TotalScoreDistribution:
        """n(t) = Σ count(k,m,q1,q2), 단 k+m+q1+q2=t."""
        return self._total_distribution

    def conditional_counts(self, *, target: str, given: Mapping[str, int]) -> dict[int, Fraction]:
        """예: 수학 80점 집단의 국어 점수별 인원. 서버 검산용이며 공개 응답이 아니다.

        given={}이면 해당 과목 주변분포다. 조건에 맞는 입력 셀이 없으면
        빈 dict를 반환하며 다른 점수대에서 가져오거나 보간하지 않는다.
        """
        if not isinstance(target, str) or target not in AREAS:
            raise PercentileError("invalid_area", "대상 과목을 확인하세요.")
        if not isinstance(given, Mapping):
            raise PercentileError("invalid_condition", "조건은 과목과 점수의 매핑이어야 합니다.")
        for area, score in given.items():
            if not isinstance(area, str) or area not in AREAS:
                raise PercentileError("invalid_area", "조건 과목을 확인하세요.")
            _integer(score, area)
        result: dict[int, Fraction] = {}
        for cell in self.cells:
            if all(getattr(cell.scores, area) == score for area, score in given.items()):
                score = getattr(cell.scores, target)
                result[score] = result.get(score, Fraction(0)) + cell.count
        return dict(sorted(result.items()))