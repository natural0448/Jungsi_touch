"""연도 간 순위 대응 성적 추정. 대학 반영비율과 독립인 내부 모듈.

동일 분위 학생끼리 과목을 결합하지 않는다. 입력한 한 학생의 각 과목
위치를 따로 보존하고, 검수된 총점 곡선이 있으면 총점 위치를 제약으로 쓴다.
주변분포만으로 난이도와 응시집단 변화가 분리된다고 주장하지 않는다.
"""
from __future__ import annotations
from dataclasses import dataclass
from fractions import Fraction
from decimal import Decimal, InvalidOperation
from collections.abc import Mapping

YEARS = (2024, 2025, 2026, 2027)
AREAS = ('korean', 'math', 'inquiry1', 'inquiry2')

class EquatingError(ValueError):
    def __init__(self, code, message):
        self.code = code
        super().__init__(message)

def require(ok, code, message):
    if not ok:
        raise EquatingError(code, message)

def number(value):
    require(not isinstance(value, (bool, float)), 'INVALID_NUMBER', '정수 또는 정확한 소수 문자열을 사용하세요.')
    try:
        if isinstance(value, Fraction): return value
        if type(value) is int: return Fraction(value)
        if not isinstance(value, (str, Decimal)): raise ValueError()
        v = Decimal(value)
        if not v.is_finite(): raise ValueError()
        return Fraction(v)
    except (ValueError, TypeError, InvalidOperation, OverflowError) as exc:
        raise EquatingError('INVALID_NUMBER', '유한한 숫자가 필요합니다.') from exc

def fraction_dict(value):
    return {'numerator': value.numerator, 'denominator': value.denominator}

def display(value, places=6):
    # 표시 전용. 비교와 탐색에는 원래 Fraction을 쓴다.
    scale = 10 ** places
    q, r = divmod(abs(value.numerator) * scale, value.denominator)
    q += int(2 * r >= value.denominator)
    sign = '-' if value < 0 and q else ''
    if not places: return sign + str(q)
    return f'{sign}{q // scale}.{q % scale:0{places}d}'

@dataclass(frozen=True)
class TailRank:
    exclusive: Fraction
    inclusive: Fraction
    @property
    def midpoint(self): return (self.exclusive + self.inclusive) / 2
    def overlaps(self, other):
        # 접점 하나는 동점자의 실제 겹침으로 세지 않는다.
        return max(self.exclusive, other.exclusive) < min(self.inclusive, other.inclusive)
    def to_dict(self):
        return {'top_percent_exclusive': display(self.exclusive * 100),
                'top_percent_inclusive': display(self.inclusive * 100),
                'top_percent_midpoint': display(self.midpoint * 100),
                'meaning': '동점자 위치 구간이며 예측 신뢰구간이 아님'}

class RankDistribution:
    """완전한 한 시험·한 과목(또는 국수탐2 총점)의 도수표.

    subject_id='total'의 population_id는 전체 유효 국수탐2 응시자여야 한다.
    과목별 분모는 다를 수 있으며 총점 분모로 대신 사용하지 않는다.
    """
    def __init__(self, *, exam_id, academic_year, subject_id, version,
                 population_id, counts, expected_total, kind, status,
                 source_refs, reported_scores=None):
        for value in (exam_id, subject_id, version, population_id):
            require(isinstance(value, str) and bool(value.strip()), 'INVALID_METADATA', '시험·과목·버전·모집단 식별자가 필요합니다.')
        require(type(academic_year) is int and academic_year in YEARS, 'INVALID_YEAR', '대상 학년도는 2024~2027입니다.')
        require(kind in ('observed_counts', 'estimated_weights', 'synthetic'), 'INVALID_KIND', '자료 종류를 확인하세요.')
        require(status in ('source_verified', 'validated', 'research_only'), 'INVALID_STATUS', '자료 검수 상태를 확인하세요.')
        require(isinstance(source_refs, (list, tuple)) and source_refs and all(isinstance(x,str) and x for x in source_refs), 'SOURCE_REQUIRED', '분포의 출처가 필요합니다.')
        require(isinstance(counts, Mapping) and counts, 'EMPTY_DISTRIBUTION', '전체 도수표가 필요합니다.')
        values = {}
        for score, count in counts.items():
            require(type(score) is int and score >= 0, 'INVALID_SCORE', '표준점수는 0 이상의 정수여야 합니다.')
            n = number(count)
            require(n > 0, 'INVALID_COUNT', '실제 존재하는 점수별 양수 도수만 입력하세요.')
            require(kind != 'observed_counts' or n.denominator == 1, 'FRACTIONAL_COUNT', '관측 인원은 정수여야 합니다.')
            values[score] = n
        total = sum(values.values(), Fraction())
        require(total == number(expected_total), 'COUNT_MISMATCH', '전체 인원과 도수 합이 다릅니다.')
        self.exam_id, self.academic_year, self.subject_id = exam_id, academic_year, subject_id
        self.version, self.population_id, self.kind, self.status = version, population_id, kind, status
        self.source_refs, self.total = tuple(source_refs), total
        self.counts, self.ranks = dict(sorted(values.items())), {}
        above = Fraction()
        for score in sorted(values, reverse=True):
            self.ranks[score] = TailRank(above / total, (above + values[score]) / total)
            above += values[score]
        # 성적표 백분위/등급은 근거가 있는 대응표에서만 얻는다.
        self.reported_scores = {}
        for score, row in (reported_scores or {}).items():
            require(score in values and isinstance(row,dict), 'INVALID_REPORTED_SCORE', '성적표 대응표의 점수를 확인하세요.')
            clean = {}
            for key, hi, lo in [('percentile',100,0),('grade',9,1)]:
                if key in row:
                    val = row[key]
                    require(type(val) is int and lo <= val <= hi, 'INVALID_REPORTED_SCORE', '백분위·등급 범위를 확인하세요.')
                    clean[key] = val
            require(bool(row.get('source_ref')), 'SOURCE_REQUIRED', '성적표 대응값의 출처가 필요합니다.')
            clean['source_ref'] = row['source_ref']
            self.reported_scores[score] = clean

    def rank(self, score):
        require(type(score) is int and score in self.ranks, 'SCORE_NOT_IN_DISTRIBUTION', '해당 시험 도수표에 없는 점수입니다.')
        return self.ranks[score]

    def inverse(self, rank):
        require(isinstance(rank, TailRank) and 0 <= rank.exclusive < rank.inclusive <= 1,
                'INVALID_RANK', '상위 누적 위치 구간을 확인하세요.')
        candidates = [s for s in self.counts if self.ranks[s].overlaps(rank)]
        require(candidates, 'RANK_UNSUPPORTED', '대응할 점수 구간이 없습니다.')
        # 존재하지 않는 136.7점을 성적표 표준점수로 만들지 않는다.
        center = min(candidates, key=lambda s: (abs(self.ranks[s].midpoint - rank.midpoint), s))
        return {'score': center, 'candidate_scores': candidates,
                'score_min': min(candidates), 'score_max': max(candidates),
                'target_rank': self.rank(center).to_dict()}

    def provenance(self):
        return {'exam_id':self.exam_id,'academic_year':self.academic_year,'subject_id':self.subject_id,
                'version':self.version,'population_id':self.population_id,'kind':self.kind,
                'status':self.status,'source_refs':list(self.source_refs)}

@dataclass(frozen=True)
class BridgePolicy:
    version: str
    status: str = 'research_only'
    # 운영 공개는 검증 기록과 명시적 허용 오차가 있는 버전만 가능하다.
    validation_ref: str | None = None
    max_subject_rank_shift: str = '0.01'
    absolute_grade_policy: str = 'hold_observed_grade'
    def __post_init__(self):
        require(bool(self.version), 'INVALID_POLICY', '보정 버전이 필요합니다.')
        require(self.status in ('research_only','validated'), 'INVALID_POLICY', '보정 검수 상태를 확인하세요.')
        require(self.status != 'validated' or bool(self.validation_ref), 'VALIDATION_REQUIRED', '검증 근거 없는 보정은 공개할 수 없습니다.')
        require(0 <= number(self.max_subject_rank_shift) <= 1, 'INVALID_POLICY', '과목별 허용 순위 차이를 확인하세요.')
        require(self.absolute_grade_policy == 'hold_observed_grade', 'UNSUPPORTED_POLICY', '절대평가 등급 보정 모형은 별도 검증이 필요합니다.')


def _bundle(distributions):
    require(isinstance(distributions, Mapping) and set(distributions) == set(AREAS), 'FOUR_SUBJECTS_REQUIRED', '국어·수학·탐구2 각각의 분포가 필요합니다.')
    require(all(isinstance(d, RankDistribution) for d in distributions.values()), 'INVALID_DISTRIBUTION', '검증된 분포 객체가 필요합니다.')
    require(len({(d.exam_id, d.academic_year) for d in distributions.values()}) == 1, 'MIXED_EXAMS', '서로 다른 시험 과목을 한 성적표로 합칠 수 없습니다.')
    require(distributions['korean'].subject_id == '국어' and distributions['math'].subject_id == '수학', 'SUBJECT_MISMATCH', '국어·수학 대응을 확인하세요.')
    require(distributions['inquiry1'].subject_id != distributions['inquiry2'].subject_id, 'DUPLICATE_INQUIRY', '탐구 과목 중복을 확인하세요.')


def _fit_to_total(source_ranks, targets, allowed_totals, max_shift):
    """유효 정수 점수 조합 중 총점 구간과 과목별 상대 위치를 함께 만족.

    목적함수는 과목별 순위 오차 합이며 대학 반영비율이 아니다.
    주변분포로 합성한 후보일 뿐 실제 응시자 조합 확률로 해석하지 않는다.
    동적계획법으로 4과목 조합의 완전 탐색 비용을 줄인다.
    """
    states = {0: (Fraction(), ())}
    max_total = max(allowed_totals)
    for area in AREAS:
        rank = source_ranks[area]
        candidates = [(s, abs(targets[area].rank(s).midpoint - rank.midpoint))
                      for s in targets[area].counts]
        # 동점 위치 구간이 겹치면 허용하고, 아니면 사전 규정한 오차 이내만 허용.
        candidates = [(s, c) for s, c in candidates if targets[area].rank(s).overlaps(rank) or c <= max_shift]
        next_states = {}
        for subtotal, (cost, scores) in states.items():
            for score, penalty in candidates:
                total = subtotal + score
                if total > max_total: continue
                candidate = (cost + penalty, scores + (score,))
                if total not in next_states or candidate < next_states[total]: next_states[total] = candidate
        states = next_states
    valid = [(states[t], t) for t in allowed_totals if t in states]
    if not valid: return None
    (cost, scores), total = min(valid)
    return {'scores':dict(zip(AREAS,scores)), 'total':total, 'rank_fit_error':cost}


def estimate_year(scores, source, target, *, policy, source_total=None, target_total=None):
    """연도별 추정 후보. 총점 곡선/집단 연결 검증 전에는 public_eligible=False."""
    _bundle(source); _bundle(target)
    require(isinstance(policy, BridgePolicy), 'INVALID_POLICY', '버전이 있는 보정 정책이 필요합니다.')
    require(isinstance(scores,Mapping) and set(scores)==set(AREAS), 'FOUR_SUBJECTS_REQUIRED', '국수탐2 표준점수가 필요합니다.')
    require(all(source[a].subject_id == target[a].subject_id for a in AREAS), 'SUBJECT_MISMATCH', '탐구 선택과목은 다른 과목으로 바꾸지 않습니다.')
    source_ranks = {a:source[a].rank(scores[a]) for a in AREAS}
    projected = {a:target[a].inverse(source_ranks[a]) for a in AREAS}
    target_year = target['korean'].academic_year
    out = {'academic_year':target_year,'source_exam_id':source['korean'].exam_id,
           'target_exam_id':target['korean'].exam_id,'bridge_version':policy.version,
           'score_basis':'year_equated_estimate','status':'calibration_required','public_eligible':False,
           'subject_projection':{a:{**projected[a], 'source_rank':source_ranks[a].to_dict(),
                                    'source_version':source[a].version,'target_version':target[a].version} for a in AREAS},
           'estimated_standard_scores':None,'total_standard_score':None,
           'reason_codes':[], 'absolute_grade_policy':policy.absolute_grade_policy,
           'meaning':'연도별 상대 위치 대응 추정. 해당 연도 실제 응시 성적 또는 합격 판정이 아님.'}
    if source_total is None or target_total is None:
        out['reason_codes'].append('TOTAL_CURVE_REQUIRED'); return out
    for bundle, total in [(source,source_total),(target,target_total)]:
        require(isinstance(total,RankDistribution) and total.subject_id=='total', 'INVALID_TOTAL', '국수탐2 총점 분포가 필요합니다.')
        require((total.exam_id,total.academic_year)==(bundle['korean'].exam_id,bundle['korean'].academic_year), 'TOTAL_EXAM_MISMATCH', '과목 분포와 총점 분포의 시험이 다릅니다.')
        require(total.population_id=='all_examinees_with_korean_math_two_inquiry_scores', 'TOTAL_POPULATION_MISMATCH', '문·이과 통합 전체 유효 응시자 총점 곡선이 필요합니다.')
    total_rank = source_total.rank(sum(scores.values()))
    total_match = target_total.inverse(total_rank)
    out.update(source_total_rank=total_rank.to_dict(),target_total_window=total_match,
               source_total_version=source_total.version,target_total_version=target_total.version)
    fit = _fit_to_total(source_ranks,target,set(total_match['candidate_scores']),number(policy.max_subject_rank_shift))
    if fit is None:
        out['status']='profile_alignment_required';out['reason_codes'].append('NO_PROFILE_WITHIN_RANK_LIMIT');return out
    out.update(estimated_standard_scores=fit['scores'],total_standard_score=fit['total'],
               rank_fit_error=fraction_dict(fit['rank_fit_error']),target_total_rank=target_total.rank(fit['total']).to_dict(),
               estimated_reported_scores={a:target[a].reported_scores.get(fit['scores'][a]) for a in AREAS},
               status='research_estimate')
    # 공식 과목 도수의 원문·인원 검수와 시험간 보정 모형 검증은 역할이 다르다.
    marginal_ready=all(d.kind!='synthetic' and (d.status=='validated' or
                       (d.kind=='observed_counts' and d.status=='source_verified'))
                       for d in [*source.values(),*target.values()])
    totals_ready=all(d.kind!='synthetic' and d.status=='validated' for d in [source_total,target_total])
    if policy.status=='validated' and marginal_ready and totals_ready:
        out.update(status='estimated',public_eligible=True)
    else: out['reason_codes'].append('BRIDGE_OR_DISTRIBUTION_NOT_VALIDATED')
    out['reason_codes'].append('ABSOLUTE_GRADES_HELD_CONSTANT')
    return out


def four_year_plan(source_exam_id, available_targets):
    """자료가 없는 학년도도 누락하지 않는 4개년 상태 응답."""
    return {'source_exam_id':source_exam_id, 'score_basis':'year_equated_estimate',
            'years':[{'academic_year':y,'target_exam_id':available_targets.get(y),
                      'status':'ready_for_calibration' if available_targets.get(y) else 'target_distribution_missing',
                      'converted_score':None} for y in YEARS]}


def distributions_from_exam_pack(data, subjects):
    """공식 시험 묶음의 도수·등급을 재사용. 성적표 백분위는 임의 파생하지 않음.

    반환 자료는 source_verified. 시험간 집단 연결/총점 곡선 검증을 대신하지 않는다.
    """
    from .exam_pack import ExamPack, subject_key
    pack=ExamPack(data)
    require(set(subjects)==set(AREAS),'FOUR_SUBJECTS_REQUIRED','과목 연결을 확인하세요.')
    result={}
    for area,label in subjects.items():
        sid=subject_key(label)
        require(sid in data['subjects'],'SUBJECT_MISMATCH','공식 기준표에 과목이 없습니다.')
        s=data['subjects'][sid]
        require(s['assessment']=='standard_score','SUBJECT_MISMATCH','표준점수 과목만 연결하세요.')
        reported={}
        for row in s['frequencies']:
            score=row['standard_score'];g=pack.subject_result(sid,score)['grade']
            reported[score]={'grade':g,'source_ref':row['source_ref']}
        result[area]=RankDistribution(exam_id=pack.exam_id,academic_year=data['exam']['academic_year'],
            subject_id=sid,version=pack.pack_version,population_id=f'official_subject_population:{sid}',
            counts={row['standard_score']:row['count'] for row in s['frequencies']},
            expected_total=s['denominator'],kind='observed_counts',status='source_verified',
            source_refs=sorted({row['source_ref'] for row in s['frequencies']}),reported_scores=reported)
    _bundle(result)
    return result
