"""입결 발표 점수에 대응하는 대학 환산점수 분포의 상위비율.

서버에서 검수·발행한 연도별 분포만 서비스에 사용한다. 대학 환산점수로
국수탐 총점이나 실제 등록 학생의 전국 순위를 역산하지 않는다.
"""
from copy import deepcopy
from fractions import Fraction
from .year_equating import number, display, EquatingError

FORMAT = 'jungsi.university-score-distribution/v1'
METRIC = 'university_converted_csat_score'
MATCH_FIELDS = ('academic_year', 'exam_id', 'rule_id', 'rule_version',
                'score_scope', 'score_scale_id', 'bonus_treatment', 'population_id')
METRICS = {'final_registrant_50pct_cut', 'final_registrant_70pct_cut',
           'final_registrant_mean', 'final_registrant_minimum', 'source_defined'}

class ResultPercentileError(ValueError):
    def __init__(self, code, message):
        self.code = code
        super().__init__(message)

def require(ok, code, message):
    if not ok:
        raise ResultPercentileError(code, message)

def numeric(value):
    try:
        return number(value)
    except EquatingError as exc:
        raise ResultPercentileError(exc.code, str(exc)) from exc

def ratio(value):
    return {'numerator': value.numerator, 'denominator': value.denominator}

def publication_interval(score, precision):
    """Return latent cutoff bounds and endpoint inclusion, using exact fractions."""
    require(isinstance(precision, dict), 'PRECISION_REQUIRED', '발표 점수의 자릿수·반올림 근거가 필요합니다.')
    mode = precision.get('mode')
    require(mode in {'exact', 'half_up', 'floor', 'ceil', 'truncate'},
            'ROUNDING_UNCONFIRMED', '발표 점수의 반올림 방식이 미확인입니다.')
    if mode == 'exact':
        return score, score, True, True
    places = precision.get('places')
    require(type(places) is int and 0 <= places <= 8, 'INVALID_PRECISION', '자릿수를 확인하세요.')
    step = Fraction(1, 10 ** places)
    require((score / step).denominator == 1, 'PRECISION_MISMATCH', '점수와 발표 자릿수가 다릅니다.')
    if mode == 'half_up':
        half = step / 2
        return score-half, score+half, score > 0, score < 0
    if mode == 'floor' or (mode == 'truncate' and score > 0):
        return score, score+step, True, False
    if mode == 'ceil' or (mode == 'truncate' and score < 0):
        return score-step, score, False, True
    return -step, step, False, False  # zero truncated towards zero

class UniversityScoreDistribution:
    """Dedicated score metric; total-score distribution restrictions remain intact."""
    def __init__(self, data):
        self.data = deepcopy(data)
        try:
            d = self.data
            require(d['format'] == FORMAT, 'INVALID_CURVE_FORMAT', '대학 환산점수 분포 형식을 확인하세요.')
            m = d['metadata']
            self.metadata = m
            require(type(m['academic_year']) is int and m['academic_year'] in (2024, 2025, 2026, 2027),
                    'INVALID_YEAR', '적용 학년도를 확인하세요.')
            require(m['score_metric'] == METRIC and m['score_scope'] == 'csat_component',
                    'SCORE_SCOPE_MISMATCH', '대학 수능 환산점수 분포만 사용합니다.')
            require(m['bonus_treatment'] in ('included', 'excluded'), 'BONUS_UNCONFIRMED', '가산점 포함 여부가 필요합니다.')
            for key in ('curve_id', 'curve_version', 'exam_id', 'rule_id', 'rule_version',
                        'score_scale_id', 'population_id', 'population_definition',
                        'source_model_id', 'source_model_version'):
                require(isinstance(m[key], str) and bool(m[key]), 'CURVE_METADATA_REQUIRED', f'{key} 정보가 필요합니다.')
            require(m['status'] in ('research', 'reviewed', 'approved'), 'INVALID_STATUS', '분포 검수 상태를 확인하세요.')
            require(m['rule_review_status'] in ('draft', 'source_verified', 'calculation_verified'), 'INVALID_RULE_STATUS', '반영식 검수 상태가 필요합니다.')
            require(m['status'] != 'approved' or m['rule_review_status'] == 'calculation_verified', 'RULE_NOT_APPROVED', '계산 검수를 마친 반영식만 서비스 분포에 사용할 수 있습니다.')
            require(type(m['complete']) is bool and type(m['population_verified']) is bool,
                    'INVALID_METADATA', '완전성·모집단 검증 상태는 boolean입니다.')
            require(m['complete'], 'INCOMPLETE_CURVE', '부분 분포를 전체 누적으로 계산할 수 없습니다.')
            require(m['status'] != 'approved' or m['population_verified'],
                    'POPULATION_UNVERIFIED', '서비스 승인에는 모집단 검증이 필요합니다.')
            require(m['kind'] in ('observed_counts', 'estimated_weights'), 'INVALID_KIND', '실측 인원과 모델 가중치를 구분하세요.')
            require(isinstance(d['source_refs'], list) and bool(d['source_refs']), 'SOURCE_REQUIRED', '분포 근거가 필요합니다.')
            self.minimum, self.maximum = numeric(m['score_min']), numeric(m['score_max'])
            require(self.minimum <= self.maximum, 'INVALID_DOMAIN', '환산점수 범위를 확인하세요.')
            require(isinstance(d['frequencies'], list) and bool(d['frequencies']), 'EMPTY_CURVE', '환산점수 도수가 필요합니다.')
            bins = {}
            for row in d['frequencies']:
                score, weight = numeric(row['converted_score']), numeric(row['weight'])
                require(score not in bins, 'DUPLICATE_SCORE', '동일 점수의 도수는 먼저 합산하세요.')
                require(weight > 0, 'INVALID_WEIGHT', '도수는 양수여야 합니다.')
                require(self.minimum <= score <= self.maximum, 'INVALID_DOMAIN', '분포 범위를 벗어난 점수입니다.')
                require(m['kind'] != 'observed_counts' or weight.denominator == 1,
                        'FRACTIONAL_COUNT', '실측 응시자 수는 정수입니다.')
                bins[score] = weight
            self.bins = tuple(sorted(bins.items()))
            require(self.bins[0][0] == self.minimum and self.bins[-1][0] == self.maximum,
                    'DOMAIN_MISMATCH', '도수의 최소·최대 점수와 선언 범위가 다릅니다.')
            self.total = sum(bins.values(), Fraction(0))
            require(self.total == numeric(m['expected_total_weight']), 'WEIGHT_MISMATCH', '발행 분모와 도수 합이 다릅니다.')
        except (KeyError, TypeError, AttributeError) as exc:
            raise ResultPercentileError('INVALID_CURVE_SCHEMA', '분포 필수 항목과 자료형을 확인하세요.') from exc

    def tail(self, threshold, *, inclusive):
        return sum((w for score, w in self.bins if score > threshold or
                    (inclusive and score == threshold)), Fraction(0)) / self.total

    def lookup(self, record, *, research=False):
        require(research or self.metadata['status'] == 'approved', 'CURVE_NOT_APPROVED',
                '검증·승인되지 않은 분포는 서비스 결과로 제공하지 않습니다.')
        require(record.get('score_metric') == METRIC, 'SCORE_METRIC_MISMATCH', '대학 환산점수 지표가 필요합니다.')
        for key in MATCH_FIELDS:
            require(record.get(key) == self.metadata[key], 'CONTEXT_MISMATCH', f'{key}가 입결과 분포에서 다릅니다.')
        score = numeric(record['score_value'])
        lo, hi, include_lo, include_hi = publication_interval(score, record['publication_precision'])
        require((hi > self.minimum or (hi == self.minimum and include_hi)) and
                (lo < self.maximum or (lo == self.maximum and include_lo)),
                'CUTOFF_OUTSIDE_DOMAIN', '발표 점수 구간이 환산점수 분포 범위 밖입니다.')
        if lo < self.minimum: lo, include_lo = self.minimum, True
        if hi > self.maximum: hi, include_hi = self.maximum, True
        exclusive = self.tail(score, inclusive=False)
        inclusive = self.tail(score, inclusive=True)
        # Combine uncertainty from ties and publication rounding; this is not a confidence interval.
        lower = self.tail(hi, inclusive=not include_hi)
        upper = self.tail(lo, inclusive=include_lo)
        return {
            'at_reported_score': {'strictly_above_percent': display(exclusive * 100),
                                  'above_or_equal_percent': display(inclusive * 100),
                                  'strictly_above_ratio': ratio(exclusive), 'above_or_equal_ratio': ratio(inclusive)},
            'upper_percentile_range': {'lower_percent': display(lower * 100), 'upper_percent': display(upper * 100),
                                      'lower_ratio': ratio(lower), 'upper_ratio': ratio(upper),
                                      'meaning': '동점자 및 발표 반올림에 따른 범위; 통계적 신뢰구간 아님'},
            'latent_score_interval': {'lower': ratio(lo), 'upper': ratio(hi),
                                      'include_lower': include_lo, 'include_upper': include_hi},
            'curve_id': self.metadata['curve_id'], 'curve_version': self.metadata['curve_version'],
            'source_model_id': self.metadata['source_model_id'], 'source_model_version': self.metadata['source_model_version'],
            'population_id': self.metadata['population_id'], 'population_definition': self.metadata['population_definition'],
            'data_kind': self.metadata['kind'], 'output_status': 'service_ready' if self.metadata['status']=='approved' and not research else 'research_only',
        }

def estimate_result_percentile(record, curve=None, *, research=False):
    """Input is an engine-enriched, source-verified admissions result record.

    Data team's unbound input must be matched to this exact year's offering/formula
    before calling. Approval metadata is server-owned, never accepted from clients.
    """
    require(isinstance(record, dict), 'INVALID_RESULT', '입결 레코드가 필요합니다.')
    require(record.get('metric_kind') in METRICS, 'RESULT_METRIC_UNCONFIRMED', '입결 지표 정의가 필요합니다.')
    require(record.get('score_metric') == METRIC, 'SCORE_METRIC_MISMATCH', '평균 과목 백분위를 대학 환산점수로 읽을 수 없습니다.')
    require(not record['metric_kind'].startswith('final_registrant_') or record.get('registrant_scope') == 'final_registrants', 'REGISTRANT_SCOPE_UNCONFIRMED', '최종 등록자 기준 지표의 대상 집단을 확인하세요.')
    require(record.get('score_scope') == 'csat_component', 'SCORE_SCOPE_MISMATCH', '학생부·면접 등을 합친 점수는 현재 분포와 비교할 수 없습니다.')
    require(record.get('verification_status') == 'verified_official' or research, 'RESULT_NOT_VERIFIED', '입결 원문 확인이 필요합니다.')
    require(type(record.get('academic_year')) is int and record['academic_year'] in (2024,2025,2026,2027), 'INVALID_YEAR', '입결 적용 학년도가 필요합니다.')
    require(all(isinstance(record.get(k), str) and bool(record[k]) for k in ('result_id','offering_pk')), 'RESULT_ID_REQUIRED', '입결 ID와 해당 연도 모집행 PK가 필요합니다.')
    require(isinstance(record.get('source_refs'), list) and bool(record['source_refs']), 'SOURCE_REQUIRED', '입결 원문 근거가 필요합니다.')
    if record.get('score_value') is not None: numeric(record['score_value'])
    base = {'result_id': record.get('result_id'), 'academic_year': record.get('academic_year'),
            'offering_pk': record.get('offering_pk'), 'metric_kind': record['metric_kind'],
            'national_total_upper_percentile': None,
            'national_total_pending_reason': 'CONVERTED_SCORE_DOES_NOT_IDENTIFY_ONE_NATIONAL_TOTAL',
            'interpretation': '등록자 평균점수의 분포상 위치' if record['metric_kind']=='final_registrant_mean'
                              else '발표된 입결 기준점수의 대학 환산점수 분포상 위치',
            'not_estimated': ['실제 등록자 전체의 전국 총점 백분위', '합격 확률', '올해 합격 최저점']}
    if record.get('score_value') is None:
        return dict(base, status='pending', reason_code='RESULT_SCORE_MISSING', university_score_percentile=None)
    if curve is None:
        return dict(base, status='pending', reason_code='ANNUAL_UNIVERSITY_CURVE_PENDING', university_score_percentile=None)
    require(isinstance(curve, UniversityScoreDistribution), 'INVALID_CURVE', '검수된 대학 환산점수 분포 객체가 필요합니다.')
    result = curve.lookup(record, research=research)
    return dict(base, status=result['output_status'], reason_code=None, university_score_percentile=result)


def build_research_distribution(rule, weighted_profiles, model_metadata, source_refs, *, research=False):
    """Forward-convert complete weighted student profiles into a university curve.

    Keeps the joint score profile intact. Never combines subjects by equal rank,
    drops invalid/ineligible profiles silently, or grants publication approval.
    Eligibility is an explicit upstream responsibility because the converter only
    implements the CSAT score component.
    """
    from .university_conversion import ConversionRule
    require(isinstance(rule, ConversionRule), 'INVALID_RULE', '검수된 환산 규칙 객체가 필요합니다.')
    require(isinstance(model_metadata, dict), 'INVALID_MODEL', '공동 성적 분포 메타데이터가 필요합니다.')
    require(isinstance(weighted_profiles, list) and bool(weighted_profiles), 'EMPTY_PROFILES', '공동 성적·가중치가 필요합니다.')
    require(model_metadata.get('academic_year') == rule.data['academic_year'], 'MODEL_YEAR_MISMATCH', '공동 성적과 반영식 연도가 다릅니다.')
    bins, seen = {}, set()
    for item in weighted_profiles:
        pid = item.get('profile_id')
        require(isinstance(pid, str) and bool(pid) and pid not in seen, 'DUPLICATE_PROFILE_ID', '프로필 ID가 없거나 중복입니다.')
        seen.add(pid)
        require(item.get('eligibility_verified') is True, 'ELIGIBILITY_UNVERIFIED', '분포에 포함할 학생의 대학별 지원자격 확인이 필요합니다.')
        profile, weight = item['profile'], numeric(item['weight'])
        require(weight > 0, 'INVALID_WEIGHT', '프로필 가중치는 양수입니다.')
        require(profile.get('exam_id') == model_metadata.get('exam_id'), 'PROFILE_EXAM_MISMATCH', '다른 시험 프로필을 같은 분포로 합칠 수 없습니다.')
        result = rule.calculate(profile, research=research)
        exact = result['exact_score']
        score = Fraction(exact['numerator'], exact['denominator'])
        bins[score] = bins.get(score, Fraction(0)) + weight
    require(sum(bins.values(), Fraction(0)) == numeric(model_metadata['expected_total_weight']),
            'WEIGHT_MISMATCH', '입력 공동 성적의 가중치 합이 선언 분모와 다릅니다.')
    metadata = deepcopy(model_metadata)
    metadata.update(status='research', rule_id=rule.data['rule_id'], rule_version=rule.data['rule_version'],
                    rule_review_status=rule.data['review_status'], score_scope=rule.data['score_scope'],
                    score_metric=METRIC, score_min=str(min(bins)), score_max=str(max(bins)))
    return UniversityScoreDistribution({'format':FORMAT,'metadata':metadata,
        'source_refs':deepcopy(source_refs),
        'frequencies':[{'converted_score':str(score),'weight':str(weight)} for score,weight in sorted(bins.items())]})
