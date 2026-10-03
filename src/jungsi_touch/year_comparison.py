"""시험 입력 -> 연도 보정 -> 대학 환산 연결. 서버 내부 실행 모듈.

사용자의 설계 승인과 통계 모형 검증은 독립이다. 인증·결제 확인은 서버
호출 계층에서 수행해야 하며 이 모듈의 research 옵션을 클라이언트에 노출하지 않는다.
"""
from copy import deepcopy
from dataclasses import dataclass
from .exam_pack import ExamPack, ExamTotalModel, subject_key
from .percentile import StandardScores, PercentileError
from .year_equating import (AREAS,YEARS,RankDistribution,BridgePolicy,EquatingError,
                            distributions_from_exam_pack,estimate_year)
from .university_conversion import (ConversionRelease,ConversionError,prepare_equated_profile)

class ComparisonError(ValueError):
    def __init__(self,code,message):self.code=code;super().__init__(message)

def check(ok,code,message):
    if not ok:raise ComparisonError(code,message)

@dataclass(frozen=True)
class TargetDataset:
    academic_year: int
    exam_id: str
    policy: BridgePolicy
    exam_data: dict | None = None
    total_model: ExamTotalModel | None = None


def total_rank_distribution(model,pack):
    """검수된 기존 총점 모델을 중복 수치 변환 없이 연도 보정에 재사용."""
    check(isinstance(model,ExamTotalModel),'INVALID_TOTAL_MODEL','시험에 연결된 총점 모델이 필요합니다.')
    info=pack.validation_summary();meta=model.distribution.metadata
    check(model.exam_id==pack.exam_id,'TOTAL_EXAM_MISMATCH','총점 곡선의 시험이 다릅니다.')
    check(model.pack_version==pack.pack_version,'TOTAL_PACK_MISMATCH','총점 곡선의 공식 자료 버전이 다릅니다.')
    target=info['target_population']
    check(meta.academic_year==pack.academic_year,'TOTAL_YEAR_MISMATCH','총점 곡선의 학년도가 다릅니다.')
    check(target['count_lower_bound']<=meta.expected_total_weight<=target['count_upper_bound'],
          'TOTAL_POPULATION_MISMATCH','전체 국수탐2 분모가 공식 응시 현황과 양립하지 않습니다.')
    check(target['count'] is None or target['count']==meta.expected_total_weight,
          'TOTAL_POPULATION_MISMATCH','확인된 전체 응시자 수와 총점 곡선이 다릅니다.')
    return RankDistribution(exam_id=model.exam_id,academic_year=meta.academic_year,subject_id='total',
        version=meta.distribution_id,population_id=meta.population_id,
        counts={r.total_score:r.weight for r in model.distribution.frequency_rows() if r.weight>0},
        expected_total=meta.expected_total_weight,kind='synthetic' if meta.status=='synthetic' else meta.kind,
        status='validated' if meta.status=='approved' else 'research_only',
        source_refs=[meta.source_name+':'+meta.source_date])


def compare_student(*, profile_version, payload, source_data, source_model, targets,
                    rule_release, offering_by_year, internal_research=False):
    """4개년 각 행을 항상 반환. 하나의 연도가 미완성이어도 다른 연도 상태를 확인.

    모형/규칙 상태는 신뢰된 서버 자료에서만 공급한다. 사용자 입력 점수와
    정책 승인 필드를 같은 HTTP 요청으로 받아 이 함수에 전달하면 안 된다.
    """
    check(isinstance(profile_version,str) and bool(profile_version),'PROFILE_VERSION_REQUIRED','성적 버전이 필요합니다.')
    check(type(internal_research) is bool,'INVALID_RESEARCH_OPTION','내부 검산 옵션을 확인하세요.')
    check(isinstance(rule_release,ConversionRelease),'INVALID_RELEASE','대학 규칙 릴리스가 필요합니다.')
    check(isinstance(targets,dict) and set(targets)<=set(YEARS),'INVALID_TARGETS','2024~2027 목표 시험을 확인하세요.')
    for year,t in targets.items():
        check(isinstance(t,TargetDataset) and t.academic_year==year,'TARGET_YEAR_MISMATCH','목표 시험의 학년도 연결이 다릅니다.')
    check(isinstance(offering_by_year,dict) and set(offering_by_year)<=set(YEARS),
          'INVALID_OFFERINGS','학년도별 실제 모집행 연결이 필요합니다.')
    pack=ExamPack(source_data);source=pack.analyze(payload)
    subjects=dict(zip(AREAS,['국어','수학',payload['inquiry'][0]['subject'],payload['inquiry'][1]['subject']]))
    scores=dict(zip(AREAS,[payload['korean']['standard_score'],payload['math']['standard_score'],
                          payload['inquiry'][0]['standard_score'],payload['inquiry'][1]['standard_score']]))
    marginal=distributions_from_exam_pack(source_data,subjects)
    source_total=None
    if source_model is not None:
        source_total=total_rank_distribution(source_model,pack)
        std=StandardScores(source_data['exam']['academic_year'],*(scores[a] for a in AREAS))
        if internal_research or source_model.distribution.metadata.status=='approved':
            overall=source_model.distribution.calculate(std,require_approved=not internal_research).to_dict()
            overall['status']='research_estimate' if source_model.distribution.metadata.status!='approved' else 'estimated'
            source['overall']=overall
    result={'profile_version':profile_version,'source_exam_id':pack.exam_id,'source_pack_version':pack.pack_version,
            'university_release_id':rule_release.release_id,'comparison_basis':'year_equated_estimate',
            'execution_mode':'internal_research' if internal_research else 'service_validation',
            'source_analysis':source,'years':[]}
    choices={key:value for key,value in {'korean_choice':payload['korean'].get('choice'),
              'math_choice':payload['math'].get('choice'),'inquiry1_subject':payload['inquiry'][0]['subject'],
              'inquiry2_subject':payload['inquiry'][1]['subject']}.items() if value is not None}
    for year in YEARS:
        t=targets.get(year)
        row={'academic_year':year,'label':f'{year}학년도 기준 추정 환산점수','offering_pk':offering_by_year.get(year),
             'target_exam_id':t.exam_id if t else None,'converted_score':None,'public_eligible':False,
             'calculation_status':'blocked','reason_codes':[]}
        try:
            reasons=[]
            if year not in offering_by_year:reasons.append('OFFERING_MAPPING_REQUIRED')
            elif (year,str(offering_by_year[year])) not in rule_release.bindings:reasons.append('RULE_NOT_FOUND')
            if source_total is None:reasons.append('SOURCE_TOTAL_CURVE_REQUIRED')
            if t is None or t.exam_data is None:reasons.append('TARGET_EXAM_DATA_REQUIRED')
            if t is None or t.total_model is None:reasons.append('TARGET_TOTAL_CURVE_REQUIRED')
            if reasons:
                row['reason_codes']=reasons;result['years'].append(row);continue
            target_pack=ExamPack(t.exam_data)
            check(target_pack.exam_id==t.exam_id,'TARGET_EXAM_MISMATCH','요청된 목표 시험과 자료가 다릅니다.')
            check(t.exam_data['exam']['academic_year']==year,'TARGET_YEAR_MISMATCH','목표 시험의 학년도가 다릅니다.')
            for area,label in [('korean','국어'),('math','수학')]:
                choice=payload[area].get('choice')
                check(choice is not None and subject_key(choice) in t.exam_data['participants']['choice_counts'][label],
                      'TARGET_CHOICE_UNSUPPORTED','목표 시험의 선택과목 대응을 확인하세요.')
            target_marginal=distributions_from_exam_pack(t.exam_data,subjects)
            target_total=total_rank_distribution(t.total_model,target_pack)
            bridge=estimate_year(scores,marginal,target_marginal,policy=t.policy,
                                 source_total=source_total,target_total=target_total)
            row['internal_equating']=bridge
            if bridge['estimated_standard_scores'] is None:
                row['reason_codes']=bridge['reason_codes'];result['years'].append(row);continue
            profile=prepare_equated_profile(profile_version,bridge,english_grade=payload.get('english_grade'),
                     korean_history_grade=payload.get('korean_history_grade'),choices=choices,research=internal_research)
            converted=rule_release.compare_years({year:offering_by_year[year]},{year:profile},research=internal_research)
            scored=next(x for x in converted['years'] if x['academic_year']==year)
            row.update(scored)
            row['public_eligible']=bool(not internal_research and bridge['public_eligible'] and scored['calculation_status']=='calculated')
        except (ComparisonError,EquatingError,ConversionError,PercentileError) as exc:
            row.update(calculation_status='blocked',converted_score=None,public_eligible=False,
                       reason_codes=[exc.code],message=str(exc))
        result['years'].append(row)
    return result


def student_response(report):
    """학생용 응답에 내부 도수·과목별 탐색 후보·연구 환산점수를 담지 않는다.

    이 함수는 응답 정리이며 인증/유료 권한 검사를 대신하지 않는다.
    """
    fields=('academic_year','label','offering_pk','target_exam_id','calculation_status','reason_codes')
    rows=[]
    for row in report['years']:
        public={k:deepcopy(row.get(k)) for k in fields}
        if row.get('public_eligible') is True and report['execution_mode']!='internal_research':
            for key in ('converted_score','official_max_score','score_scope','score_basis','eligibility_status','non_csat_components'):
                public[key]=deepcopy(row.get(key))
        else:
            public['converted_score']=None;public['calculation_status']='pending'
            public['reason_codes']=list(dict.fromkeys([*(public['reason_codes'] or []),'SERVICE_RESULT_NOT_READY']))
        rows.append(public)
    return {'profile_version':report['profile_version'],'source_exam_id':report['source_exam_id'],
            'comparison_basis':report['comparison_basis'],'years':rows}
