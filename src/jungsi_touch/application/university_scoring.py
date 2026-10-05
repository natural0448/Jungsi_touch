"""Independent school CSAT scoring, using only application-owned data ports.

Trusted releases supply declarative rules. This boundary has no research switch,
Excel execution, curve dependency, inferred percentile or name-based fallback.
"""
from copy import deepcopy
from dataclasses import dataclass, replace
from fractions import Fraction

from ..exam_pack import ExamPack, subject_key
from ..percentile import PercentileError
from ..university_conversion import ConversionError, ConversionRelease, check
from .overall_analysis import _scores, _identifier, OverallAnalysisError
from .platform_ports import PlatformError, UniversityConversionRelease

CONTEXT_FIELDS=('academic_year','university_id','campus','department','track','group')
AREAS=('korean','math','inquiry1','inquiry2')
SUPPORTED_INPUTS={a+'_'+f for a in AREAS for f in ('standard_score','percentile','grade')} | {
    'korean_choice','math_choice','inquiry1_subject','inquiry2_subject','english_grade','korean_history_grade'}


@dataclass(frozen=True)
class ScoringResult:
    """Immutable internal outcome; exact values never enter the student DTO."""
    academic_year: int
    profile_version: str
    pack_version: str
    exam_id: str
    score_basis: str | None = None
    reason_code: str | None = 'conversion_release_missing'
    score: Fraction | None = None
    converted_score: str | None = None
    official_max_score: str | int | None = None
    rule_version: str | None = None
    release_version: str | None = None
    table_versions: tuple[str, ...] = ()
    values: tuple[tuple[str, object], ...] = ()
    reported_sources: tuple[tuple[str, str], ...] = ()
    context: tuple[tuple[str, object], ...] = ()
    required_input_fields: tuple[str, ...] = ()

    @property
    def ready(self):return self.score is not None and self.reason_code is None

    def dto(self):
        return dict(status='ready' if self.ready else 'pending',reason_code=self.reason_code,
            score_basis=self.score_basis,score_scope='csat_component',converted_score=self.converted_score,
            official_max_score=self.official_max_score,academic_year=self.academic_year,exam_id=self.exam_id,
            rule_version=self.rule_version,release_version=self.release_version,table_versions=list(self.table_versions),
            profile_version=self.profile_version,pack_version=self.pack_version)

    def internal_profile(self):
        return dict(academic_year=self.academic_year,exam_id=self.exam_id,profile_version=self.profile_version,
                    score_basis=self.score_basis,values=dict(self.values),reported_score_sources=dict(self.reported_sources))

    def internal_calculation(self):
        return dict(academic_year=self.academic_year,exam_id=self.exam_id,profile_version=self.profile_version,
            score_basis=self.score_basis,rule_version=self.rule_version,calculation_status='calculated',
            converted_score=self.converted_score,score_scope='csat_component',
            exact_score=dict(numerator=self.score.numerator,denominator=self.score.denominator))


class UniversityScoringService:
    def __init__(self,data):self.data=data

    def calculate(self,offering,profile):
        scores=profile['scores']
        result=ScoringResult(offering['academic_year'],profile['profile_id'],scores['pack_version'],scores['exam_id'])
        try:
            payload=_scores(scores)
            pack=self.data.get_exam_pack(scores['exam_id'])
            check(isinstance(pack,ExamPack),'conversion_exam_unavailable','시험 자료가 필요합니다.')
            check(pack.exam_id==scores['exam_id'] and pack.pack_version==scores['pack_version'],
                  'conversion_pack_mismatch','시험 자료 버전이 다릅니다.')
            # Validate score/subject/choice and any entered official report mapping.
            analyzed=pack.analyze(payload)
            exam=analyzed['exam']
            basis='actual_exam' if exam['exam_type']=='csat' else 'mock_exam'
            result=replace(result,score_basis=basis)
            check(exam['academic_year']==offering['academic_year'],'year_bridge_required','다른 학년도는 승인 보정이 필요합니다.')
            read=getattr(self.data,'get_conversion',None)
            bundle=read(offering['offering_id']) if read else None
            check(isinstance(bundle,UniversityConversionRelease),'conversion_release_missing','환산 릴리스가 필요합니다.')
            # Isolate all mutable trusted adapter mappings from execution.
            bundle=deepcopy(bundle)
            check(bundle.status=='approved','conversion_release_not_approved','환산 자료 승인 대기입니다.')
            check(_identifier(bundle.version) and isinstance(bundle.release,ConversionRelease),
                  'conversion_release_invalid','환산 릴리스 형식을 확인하세요.')
            check(bundle.academic_year==offering['academic_year'],'conversion_year_mismatch','환산 학년도가 다릅니다.')
            check(_identifier(bundle.exam_id) and _identifier(bundle.source_pack_version) and bundle.exam_type=='csat',
                  'conversion_exam_mismatch','등록된 수능 규칙이 필요합니다.')
            if basis=='actual_exam':
                check((bundle.exam_id,bundle.source_pack_version)==(pack.exam_id,pack.pack_version),
                      'conversion_exam_mismatch','환산 규칙의 시험과 자료 버전이 다릅니다.')
            else:
                compat=bundle.mock_compatibility
                expected=dict(source_exam_id=pack.exam_id,source_pack_version=pack.pack_version,
                    source_exam_type=exam['exam_type'],rule_exam_id=bundle.exam_id,rule_pack_version=bundle.source_pack_version)
                check(isinstance(compat,dict) and compat.get('status')=='approved' and _identifier(compat.get('version'))
                      and all(compat.get(k)==v for k,v in expected.items()),
                      'mock_compatibility_not_approved','모평 호환 계약 승인 대기입니다.')
            seen=set();binding=None
            for row in bundle.bindings:
                key=(row['academic_year'],str(row['offering_pk']))
                check(key not in seen,'RULE_BINDING_AMBIGUOUS','중복 환산 연결입니다.');seen.add(key)
                check(bundle.release.bindings.get(key)==row['rule_version'],'conversion_binding_mismatch','규칙 연결이 다릅니다.')
                if key==(offering['academic_year'],offering['offering_id']):binding=row
            check(binding is not None,'conversion_binding_missing','해당 모집행 연결이 없습니다.')
            check(all(k in offering and binding.get(k)==offering[k] for k in CONTEXT_FIELDS),
                  'conversion_context_mismatch','대학·캠퍼스·모집행 조건이 다릅니다.')
            rule=bundle.release.rules[binding['rule_version']]
            check(_identifier(rule.data['rule_version']) and _identifier(bundle.release.release_id)
                  and all(_identifier(t['version']) for t in rule.data['tables'].values()),
                  'conversion_release_invalid','공개 버전 식별자를 확인하세요.')
            for metadata in [rule.data,*rule.data['tables'].values()]:
                check(all(k not in metadata or metadata[k]==v for k,v in
                          [('exam_id',bundle.exam_id),('source_pack_version',bundle.source_pack_version),('rule_version',rule.data['rule_version'])]),
                      'conversion_rule_context_mismatch','규칙 또는 표의 시험·버전이 다릅니다.')
            check(all(t['status']=='verified' for t in rule.data['tables'].values()),
                  'CONVERSION_TABLE_PENDING','조회표 검증이 필요합니다.')
            check(set(rule.data['inputs'])<=SUPPORTED_INPUTS,'unsupported_conversion_input','추가 성적 입력 경로가 필요합니다.')
            values={};reported_sources={}
            entered=[scores['korean'],scores['math'],*scores['inquiry']]
            for area,row,subject in zip(AREAS,entered,analyzed['subjects']):
                mapped=pack.reported_score(subject['subject'],row['standard_score'])
                values[area+'_standard_score']=row['standard_score']
                for field in ('percentile','grade'):
                    values[area+'_'+field]=mapped.get(field,row.get(field))
                    if values[area+'_'+field] is not None:
                        reported_sources[area+'_'+field]='verified_exam_mapping' if field in mapped else 'student_report'
            values.update(korean_choice=subject_key(scores['korean']['choice']) if scores['korean'].get('choice') is not None else None,
                math_choice=subject_key(scores['math']['choice']) if scores['math'].get('choice') is not None else None,
                inquiry1_subject=subject_key(analyzed['subjects'][2]['subject']),inquiry2_subject=subject_key(analyzed['subjects'][3]['subject']),
                english_grade=scores.get('english_grade'),korean_history_grade=scores.get('korean_history_grade'))
            result=replace(result,rule_version=rule.data['rule_version'],release_version=bundle.version,
                           table_versions=tuple(t['version'] for t in rule.data['tables'].values()),values=tuple(values.items()),
                           reported_sources=tuple(reported_sources.items()))
            result=replace(result,required_input_fields=tuple(sorted(rule.data['inputs'])))
            calculated=rule.calculate(result.internal_profile())
            maximum=calculated['official_max_score']
            check(maximum is None or type(maximum) in (str,int),'conversion_release_invalid','공식 척도 자료형을 확인하세요.')
            check(rule.data.get('score_scale_id') is None or _identifier(rule.data['score_scale_id']),
                  'conversion_rule_context_mismatch','환산 척도 식별자를 확인하세요.')
            check(rule.data.get('bonus_treatment') in (None,'included','excluded'),
                  'conversion_rule_context_mismatch','가산점 포함 기준을 확인하세요.')
            context=dict({k:offering[k] for k in CONTEXT_FIELDS},offering_pk=offering['offering_id'],
                rule_id=rule.data['rule_id'],rule_version=rule.data['rule_version'],score_scope=rule.data['score_scope'],
                score_scale_id=rule.data.get('score_scale_id'),bonus_treatment=rule.data.get('bonus_treatment'),
                exam_id=pack.exam_id,source_pack_version=pack.pack_version,exam_type=exam['exam_type'],
                rule_exam_id=bundle.exam_id,rule_pack_version=bundle.source_pack_version,
                mock_compatibility_version=bundle.mock_compatibility['version'] if basis=='mock_exam' else None)
            check(all(v is None or type(v) in (str,int) for v in context.values()),
                  'conversion_rule_context_mismatch','불변 환산 컨텍스트 자료형을 확인하세요.')
            return replace(result,reason_code=None,score=Fraction(**calculated['exact_score']),
                           converted_score=calculated['converted_score'],official_max_score=maximum,context=tuple(context.items()))
        except (ConversionError,PercentileError,PlatformError,OverallAnalysisError) as error:
            return replace(result,reason_code=error.code)
        except (KeyError,ValueError,TypeError,AttributeError,OSError):
            return replace(result,reason_code='conversion_release_invalid')
