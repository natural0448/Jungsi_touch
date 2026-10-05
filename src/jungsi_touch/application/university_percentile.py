"""Student score tails, independent from admissions cutoffs and decisions."""
from copy import deepcopy
from dataclasses import dataclass, replace
from fractions import Fraction

from ..admission_result_percentile import UniversityScoreDistribution, ResultPercentileError, MATCH_FIELDS, require
from ..percentile import POPULATION_ID
from ..estimated_profiles import digest
from ..year_equating import display
from .overall_analysis import _identifier
from .platform_ports import PlatformError, UniversityPercentileRelease
from .university_scoring import CONTEXT_FIELDS, ScoringResult


@dataclass(frozen=True)
class PercentileResult:
    """Exact immutable tails; only the DTO's decimal strings leave the server."""
    academic_year: int
    exam_id: str
    profile_version: str
    pack_version: str
    score_basis: str | None
    rule_version: str | None
    reason_code: str | None = 'percentile_release_missing'
    inclusive: Fraction | None = None
    exclusive: Fraction | None = None
    population_id: str | None = None
    data_kind: str | None = None
    curve_version: str | None = None
    release_version: str | None = None
    source_model_version: str | None = None
    context: tuple[tuple[str, object], ...] = ()
    population_scope: str | None = None

    @property
    def ready(self):return self.inclusive is not None and self.reason_code is None

    def dto(self):
        inclusive=display(self.inclusive*100) if self.ready else None
        exclusive=display(self.exclusive*100) if self.ready else None
        tie=display((self.inclusive-self.exclusive)*100) if self.ready else None
        return dict(status='ready' if self.ready else 'pending',reason_code=self.reason_code,
            score_basis=self.score_basis,score_scope='csat_component',academic_year=self.academic_year,exam_id=self.exam_id,
            top_percent=inclusive,inclusive_top_percent=inclusive,exclusive_top_percent=exclusive,tie_share_percent=tie,
            tie_policy='include_equal',population_id=self.population_id,population_scope=self.population_scope,data_kind=self.data_kind,rule_version=self.rule_version,
            curve_version=self.curve_version,release_version=self.release_version,source_model_version=self.source_model_version,
            profile_version=self.profile_version,pack_version=self.pack_version)

    def internal_rank(self):
        return {'at_reported_score':dict(above_or_equal_percent=display(self.inclusive*100),
            above_or_equal_ratio=dict(numerator=self.inclusive.numerator,denominator=self.inclusive.denominator))}


def result_for_curve(base,curve,score,release_version,*,population_scope='whole_complete'):
    """Use a complete validated distribution, preserving observed/model meaning."""
    require(isinstance(score,Fraction),'percentile_score_invalid','정확 환산값이 필요합니다.')
    metadata=curve.metadata
    require(metadata['status']=='approved' and metadata['rule_review_status']=='calculation_verified',
            'percentile_curve_not_approved','승인 곡선이 필요합니다.')
    require(metadata['population_verified'] is True and metadata['complete'] is True,
            'percentile_population_unverified','전체 비교 모집단 검증이 필요합니다.')
    require((population_scope=='whole_complete' and metadata['population_id']==POPULATION_ID) or
            (population_scope=='required_rule_inputs_present' and metadata['population_id']!=POPULATION_ID),
            'percentile_population_mismatch','승인된 비교 모집단이 필요합니다.')
    require(all(_identifier(metadata[k]) for k in ('curve_version','source_model_version')),
            'percentile_release_invalid','공개 버전 식별자를 확인하세요.')
    require(_identifier(release_version),'percentile_release_invalid','공개 발행 버전 식별자를 확인하세요.')
    context=tuple((k,metadata[k]) for k in (*MATCH_FIELDS,'score_metric','curve_version'))
    return replace(base,reason_code=None,inclusive=curve.tail(score,inclusive=True),exclusive=curve.tail(score,inclusive=False),
        population_id=metadata['population_id'],data_kind=metadata['kind'],curve_version=metadata['curve_version'],
        release_version=release_version,source_model_version=metadata['source_model_version'],context=context,population_scope=population_scope)


def comparison_scope(bundle,conversion,curve):
    """서버 승인 명부가 공급한 별도 영수증과 실제 필수 입력·곡선·제외 명부를 대조한다."""
    m=curve.metadata;c=bundle.comparison_population;r=bundle.validation_receipt
    if m['population_id']==POPULATION_ID:
        require(c is None,'percentile_population_mismatch','전체 모집단에 부분집단 계약을 붙일 수 없습니다.')
        return 'whole_complete'
    require(isinstance(c,dict) and isinstance(r,dict),'percentile_population_receipt_missing','비교집단 검증 영수증이 필요합니다.')
    require(c.get('format','jungsi.university-comparison-population/v1')=='jungsi.university-comparison-population/v1' and
        c.get('status')=='approved' and c.get('scope')=='required_rule_inputs_present' and
        c.get('base_population_id')==POPULATION_ID and _identifier(c.get('population_id')),
        'percentile_population_not_approved','비교집단 승인을 확인하세요.')
    expected={k:m[k] for k in ('population_id','academic_year','exam_id','rule_version','curve_version')}
    expected['source_pack_version']=conversion.pack_version
    require(all(c.get(k)==v for k,v in expected.items()) and
        c.get('required_input_fields')==list(conversion.required_input_fields) and
        _identifier(c.get('validation_receipt_version')),
        'percentile_population_context_mismatch','비교집단의 시험·규칙·필수 입력이 다릅니다.')
    require(r.get('format')=='jungsi.estimate-release-receipt/v1' and r.get('status')=='approved' and
        r.get('version')==c['validation_receipt_version'] and all(r.get(k)==v for k,v in expected.items()) and
        r.get('required_input_fields')==c['required_input_fields'] and
        r.get('source_model_version')==m['source_model_version'] and r.get('curve_sha256')==digest(curve.data) and
        r.get('validation_status')=='self_validated_estimate',
        'percentile_population_receipt_mismatch','곡선 검증 근거가 다른 버전에 속합니다.')
    checks=r.get('checks',{})
    require(all(checks.get(k) is True for k in ('model_validation','filter_complete','rule_replay','serialization')) and
        isinstance(r.get('validation_checks'),dict) and bool(r['validation_checks']) and all(v is True for v in r['validation_checks'].values()),
        'percentile_population_unverified','비교집단 또는 모형 검증이 완료되지 않았습니다.')
    from ..admission_result_percentile import numeric
    ledger=r['population_ledger'];full=numeric(ledger['total_complete_weight']);kept=numeric(ledger['retained_weight']);lost=numeric(ledger['excluded_weight'])
    require(full>kept>0 and lost>0 and full==kept+lost and kept==curve.total,
        'percentile_population_weight_mismatch','전체·잔존·제외 가중치가 다릅니다.')
    exclusions=ledger['exclusions'];require(bool(exclusions),'percentile_population_exclusion_missing','제외 사유가 필요합니다.')
    require(sum((numeric(row['weight']) for row in exclusions),Fraction(0))==lost and all(
        numeric(row['weight'])>0 and bool(row['missing_input_fields']) and
        set(row['missing_input_fields'])<=set(conversion.required_input_fields) for row in exclusions),
        'percentile_population_exclusion_mismatch','필수 입력 누락 사유와 가중치가 다릅니다.')
    return 'required_rule_inputs_present'


def legacy_percentile_result(offering,profile,current,curve,release_version):
    """Only after the existing approved bridge/curve/context lookup succeeds.

    pack_version retains the source profile pack bound by the legacy release;
    exam_id is its validated target exam. This never approves a new artifact.
    """
    base=PercentileResult(offering['academic_year'],current['exam_id'],profile['profile_id'],
                         profile['scores']['pack_version'],current['score_basis'],current['rule_version'])
    return result_for_curve(base,curve,Fraction(**current['exact_score']),release_version)


class UniversityPercentileService:
    def __init__(self,data):self.data=data

    def calculate(self,offering,conversion):
        base=PercentileResult(offering['academic_year'],conversion.exam_id,conversion.profile_version,
                             conversion.pack_version,conversion.score_basis,conversion.rule_version)
        try:
            require(isinstance(conversion,ScoringResult) and conversion.ready,'conversion_not_ready','환산 계산이 필요합니다.')
            context=dict(conversion.context)
            require(all(k not in context or context[k]==offering.get(k) for k in CONTEXT_FIELDS) and
                    ('offering_pk' not in context or context['offering_pk']==offering['offering_id']),
                    'percentile_conversion_context_mismatch','환산과 모집행이 다릅니다.')
            read=getattr(self.data,'get_percentile',None)
            bundle=read(offering['offering_id']) if read else None
            require(bundle is not None,'percentile_release_missing','누백 자료가 필요합니다.')
            require(isinstance(bundle,UniversityPercentileRelease),'percentile_release_invalid','누백 릴리스 형식을 확인하세요.')
            required=set(CONTEXT_FIELDS)|{'offering_pk','rule_id','rule_version','score_scope','score_scale_id',
                                          'bonus_treatment','exam_id','source_pack_version','exam_type'}
            require(required<=set(context) and all(context[k] is not None for k in required),
                    'percentile_conversion_context_missing','환산 척도·가산점·모집행 근거가 필요합니다.')
            require(all(context[k]==offering.get(k) for k in CONTEXT_FIELDS) and context['offering_pk']==offering['offering_id'],
                    'percentile_conversion_context_mismatch','환산과 모집행이 다릅니다.')
            require(conversion.score_basis in ('actual_exam','mock_exam') and
                    (conversion.academic_year,conversion.exam_id,conversion.pack_version,conversion.rule_version)==
                    (context['academic_year'],context['exam_id'],context['source_pack_version'],context['rule_version']),
                    'percentile_conversion_context_mismatch','환산 시험·규칙 컨텍스트가 다릅니다.')
            if conversion.score_basis=='mock_exam':
                require(_identifier(context.get('mock_compatibility_version')),'mock_compatibility_not_approved','모평 호환 승인 근거가 필요합니다.')
            bundle=deepcopy(bundle)
            require(bundle.status=='approved','percentile_release_not_approved','누백 자료 승인 대기입니다.')
            require(_identifier(bundle.version) and _identifier(bundle.release_id),
                    'percentile_release_invalid','누백 발행 식별자를 확인하세요.')
            require((bundle.academic_year,bundle.exam_id,bundle.source_pack_version,bundle.exam_type,bundle.rule_version)==
                    (conversion.academic_year,conversion.exam_id,conversion.pack_version,context['exam_type'],conversion.rule_version),
                    'percentile_release_context_mismatch','누백 시험·학년도·규칙·팩이 다릅니다.')
            require(isinstance(bundle.curve,UniversityScoreDistribution),'percentile_curve_invalid','누백 곡선 형식을 확인하세요.')
            # Revalidate mutable adapter contents before use; do not trust stale bins.
            curve=UniversityScoreDistribution(bundle.curve.data);metadata=curve.metadata
            require(all(metadata[k]==context[k] for k in MATCH_FIELDS if k!='population_id'),
                    'percentile_curve_context_mismatch','곡선과 환산식의 척도·가산점 범위가 다릅니다.')
            require(all(k not in metadata or metadata[k]==v for k,v in
                        [('source_pack_version',conversion.pack_version),('offering_pk',offering['offering_id'])]),
                    'percentile_curve_context_mismatch','곡선이 다른 팩·모집행에 속합니다.')
            seen=set();binding=None
            for row in bundle.bindings:
                key=(row['academic_year'],str(row['offering_pk']))
                require(key not in seen,'percentile_binding_ambiguous','중복 누백 연결입니다.');seen.add(key)
                require(row['academic_year']==bundle.academic_year and row.get('rule_version')==bundle.rule_version and
                        row.get('curve_version')==metadata['curve_version'],
                        'percentile_binding_mismatch','발행 곡선과 연결 버전이 다릅니다.')
                if key==(offering['academic_year'],offering['offering_id']):binding=row
            require(binding is not None,'percentile_binding_missing','해당 모집행 누백 연결이 없습니다.')
            require(all(binding.get(k)==offering.get(k) for k in CONTEXT_FIELDS) and
                    binding.get('rule_version')==conversion.rule_version and binding.get('curve_version')==metadata['curve_version'],
                    'percentile_binding_mismatch','누백의 학교·캠퍼스·전형·군·버전이 다릅니다.')
            scope=comparison_scope(bundle,conversion,curve)
            return result_for_curve(base,curve,conversion.score,bundle.version,population_scope=scope)
        except (ResultPercentileError,PlatformError) as error:return replace(base,reason_code=error.code)
        except (KeyError,TypeError,AttributeError,ValueError,OSError):return replace(base,reason_code='percentile_release_invalid')
