"""시험별 공식 기준표와 공통 계산. 기존 총점 엔진 앞에서 시험을 검증한다.

이 모듈은 주변분포를 동일 분위로 결합하지 않는다. 총점 곡선이 없으면
총점과 과목별 결과만 제공하며, 임의 누적값이나 대학 지원가능성을 만들지 않는다.
"""
from __future__ import annotations
from collections import Counter
from copy import deepcopy
from dataclasses import dataclass
from decimal import Decimal
from fractions import Fraction
import json
import re
import unicodedata

from .percentile import (
    PercentileError, StandardScores, TotalScoreDistribution, _decimal, _integer,
    _text, _unique_object, _invalid_constant, load_distribution_json, POPULATION_ID,
)

FORMAT = 'jungsi.exam-pack/v1'

def subject_key(label):
    _text(label, 'subject')
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', label))

def _require(condition, code, message):
    if not condition: raise PercentileError(code, message)

def _grade(subject, score):
    for row in subject['grades']:
        if row['grade']==9 or score>=row['lower_score']:
            return row['grade']
    raise PercentileError('grade_not_found','등급표를 확인하세요.')

def _json(text):
    try:
        return json.loads(text, parse_float=Decimal, parse_constant=_invalid_constant,
                          object_pairs_hook=_unique_object)
    except (json.JSONDecodeError, TypeError) as exc:
        raise PercentileError('invalid_json','유효한 JSON이 아닙니다.') from exc

@dataclass(frozen=True)
class ExamTotalModel:
    """서버에서 발행한 총점 도수분포를 한 시험·자료 버전에 묶는다.

    이 객체의 메타데이터는 서버가 관리한다. 사용자가 API로 임의 승인 상태를
    전송하도록 허용하지 않는다. 구버전 총점 엔진의 학년도 검사는 그대로 유지한다.
    """
    exam_id: str
    pack_version: str
    distribution: TotalScoreDistribution
    basis: str = 'exam_population'

    def __post_init__(self):
        _text(self.exam_id,'exam_id'); _text(self.pack_version,'pack_version')
        _require(isinstance(self.distribution,TotalScoreDistribution),'invalid_model','총점 분포가 필요합니다.')
        _require(self.basis=='exam_population','model_basis_mismatch','해당 시험 응시 집단 기준 곡선이 필요합니다.')

    @classmethod
    def from_json(cls,text):
        data=_json(text)
        _require(isinstance(data,dict) and set(data)=={'format','exam_id','pack_version','basis','distribution'},
                 'invalid_schema','시험별 총점 모델 봉투 형식을 확인하세요.')
        _require(data['format']=='jungsi.exam-total-model/v1','invalid_format','지원하지 않는 총점 모델 형식입니다.')
        # Preserve decimal strings rather than turning them into binary floats.
        distribution=load_distribution_json(json.dumps(data['distribution'],default=str))
        return cls(data['exam_id'],data['pack_version'],distribution,data['basis'])

class ExamPack:
    """불완전하거나 서로 다른 시험의 공식 표는 로딩 단계에서 거부한다."""
    def __init__(self,data):
        _require(isinstance(data,dict) and data.get('format')==FORMAT,'invalid_format','시험 자료 묶음 형식을 확인하세요.')
        self._data=deepcopy(data)
        d=self._data
        try:
            exam=d['exam']; subjects=d['subjects']; participants=d['participants']
            _text(exam['exam_id'],'exam_id');_text(exam['label'],'label')
            _integer(exam['academic_year'],'academic_year',1);_text(d['pack_version'],'pack_version')
            _require(exam['exam_type'] in ('september_mock','june_mock','csat'),'invalid_exam_type','시험 유형을 확인하세요.')
            _require(isinstance(subjects,dict) and {'국어','수학','영어','한국사'}<=set(subjects),
                     'missing_subject','국어·수학·영어·한국사 기준표가 필요합니다.')
            _integer(participants['total'],'participants.total',1)
            _require(set(subjects)==set(participants['by_subject']),'subject_coverage_mismatch','응시자 표와 과목 표의 범위가 다릅니다.')
            source_ids={s['source_id'] for s in d['sources']}
            _require(len(source_ids)==len(d['sources']) and bool(source_ids),'invalid_sources','출처 식별자를 확인하세요.')
            for src in d['sources']:
                _require(bool(re.fullmatch(r'[a-f0-9]{64}',src['sha256'])),'invalid_source_hash','출처 SHA-256을 확인하세요.')
            for sid,s in subjects.items():
                _require(subject_key(s['label'])==sid,'subject_key_mismatch','과목 이름과 키가 다릅니다.')
                total=_integer(s['denominator'],sid+'.denominator',1)
                _require(total==participants['by_subject'][sid] and total<=participants['total'],
                         'denominator_mismatch','과목 응시 인원과 분모가 다릅니다.')
                rows=s['grades']
                _require([r['grade'] for r in rows]==list(range(1,10)),'invalid_grades','1~9등급 표가 필요합니다.')
                bounds=[]
                for r in rows:
                    _integer(r['count'],'grade.count')
                    self._source_ref(r['source_ref'],source_ids)
                    if r['grade']<9:bounds.append(_integer(r['lower_score'],'grade.lower_score'))
                    else:_require(r['lower_score'] is None and r['upper_exclusive']==bounds[-1],
                                  'invalid_grade_boundary','9등급 경계를 확인하세요.')
                _require(all(a>=b for a,b in zip(bounds,bounds[1:])),'invalid_grade_boundary','등급 경계가 역전되었습니다.')
                _require(sum(r['count'] for r in rows)==total,'grade_total_mismatch','등급별 인원 합이 과목 응시 인원과 다릅니다.')
                for r in rows:
                    expected=_decimal(Fraction(r['count']*100,total),2)
                    _require(Decimal(r['published_percent'])==Decimal(expected),
                             'grade_percent_mismatch','공식 등급 비율과 인원 계산이 일치하지 않습니다.')
                if s['assessment']=='standard_score':
                    f=s['frequencies']; cumulative=0;previous=None;counts=Counter()
                    _require(bool(f),'empty_distribution','과목 도수가 비어 있습니다.')
                    for row in f:
                        score=_integer(row['standard_score'],'standard_score')
                        count=_integer(row['count'],'count',1)
                        _require(previous is None or score<previous,'duplicate_or_unsorted_score','도수 점수는 중복 없이 내림차순이어야 합니다.')
                        previous=score
                        cumulative+=count
                        _require(cumulative==row['cumulative_count'],'cumulative_mismatch','공식 누적 인원과 도수 합이 다릅니다.')
                        male=_integer(row['male_count'],'male_count');female=_integer(row['female_count'],'female_count')
                        _require(male+female<=count,'gender_count_mismatch','성별 인원이 공식 계보다 많습니다.')
                        self._source_ref(row['source_ref'],source_ids)
                        counts[_grade(s,score)]+=count
                    _require(cumulative==total==s['published_total'],'frequency_total_mismatch','도수·발표 합계·응시 인원이 다릅니다.')
                    _require(all(counts[r['grade']]==r['count'] for r in rows),
                             'grade_frequency_mismatch','등급 경계로 합산한 도수와 발표 등급 인원이 다릅니다.')
                else:
                    _require(s['assessment']=='absolute_grade' and 'frequencies' not in s,
                             'invalid_assessment','절대평가를 표준점수 분포로 처리할 수 없습니다.')
            for sid in ('국어','수학'):
                choice_counts=participants['choice_counts'][sid]
                for count in choice_counts.values():_integer(count,'choice_count')
                _require(sum(choice_counts.values())==subjects[sid]['denominator'],
                         'choice_total_mismatch','선택과목 인원 합이 영역 인원과 다릅니다.')
            groups=participants['inquiry_groups']
            _require(set(groups)=={'social_only','science_only','mixed_social_science','vocational'},
                     'inquiry_groups_mismatch','탐구 영역 응시 집단을 확인하세요.')
            for count in groups.values():_integer(count,'inquiry_group_count')
            _require(sum(groups.values())==participants['inquiry_total'],
                     'inquiry_total_mismatch','탐구 집단 인원 합이 영역 인원과 다릅니다.')
            social_science_unique=sum(groups[k] for k in ('social_only','science_only','mixed_social_science'))
            two_social_science=sum(s['denominator'] for s in subjects.values() if s['category'] in ('social','science'))-social_science_unique
            two_vocational=sum(s['denominator'] for s in subjects.values() if s['category']=='vocational')-groups['vocational']
            derived=participants['two_inquiry_derived']
            _require(0<=two_social_science<=social_science_unique and 0<=two_vocational<=groups['vocational']
                     and (derived['social_science'],derived['vocational'],derived['total'])==
                         (two_social_science,two_vocational,two_social_science+two_vocational),
                     'two_inquiry_count_mismatch','탐구 2과목 인원 산출을 확인하세요.')
            target=participants['target_population']
            _require(target['population_id']==POPULATION_ID,'population_mismatch','전체 국수탐2 응시 집단이 필요합니다.')
            expected_lower=max(0,subjects['국어']['denominator']+subjects['수학']['denominator']+derived['total']-2*participants['total'])
            expected_upper=min(subjects['국어']['denominator'],subjects['수학']['denominator'],derived['total'])
            _require((target['count_lower_bound'],target['count_upper_bound'])==(expected_lower,expected_upper),
                     'population_bounds_mismatch','분모 검증 범위가 공식 응시 인원과 다릅니다.')
            lo=_integer(target['count_lower_bound'],'population.lower');hi=_integer(target['count_upper_bound'],'population.upper')
            _require(lo<=hi<=participants['total'],'invalid_population_bounds','비교 집단 인원 범위를 확인하세요.')
            if target['count'] is not None:
                _require(lo<=_integer(target['count'],'population.count',1)<=hi,
                         'invalid_population_count','확인된 비교 집단 인원이 범위 밖입니다.')
        except (KeyError,TypeError,AttributeError) as exc:
            raise PercentileError('invalid_schema','시험 자료 묶음의 필수 필드나 형식을 확인하세요.') from exc

    @staticmethod
    def _source_ref(value,ids):
        _require(isinstance(value,str) and value.split(':')[0] in ids,'invalid_source_ref','원문 출처 연결이 없습니다.')

    @classmethod
    def from_json(cls,text):return cls(_json(text))

    @property
    def exam_id(self):return self._data['exam']['exam_id']
    @property
    def pack_version(self):return self._data['pack_version']
    @property
    def academic_year(self):return self._data['exam']['academic_year']

    def validation_summary(self):
        subjects=self._data['subjects'];standard=[s for s in subjects.values() if s['assessment']=='standard_score']
        return {'exam_id':self.exam_id,'pack_version':self.pack_version,'standard_subjects':len(standard),
                'absolute_subjects':len(subjects)-len(standard),
                'frequency_rows':sum(len(s['frequencies']) for s in standard),
                'grade_rows':sum(len(s['grades']) for s in subjects.values()),
                'published_counts_cumulative_and_grade_counts_match':True,
                'total_examinees':self._data['participants']['total'],
                'target_population':deepcopy(self._data['participants']['target_population']),
                'total_curve_status':self._data['total_curve_status']}

    def subject_result(self,subject,standard_score):
        sid=subject_key(subject);s=self._data['subjects'].get(sid)
        _require(s is not None and s['assessment']=='standard_score','invalid_subject','표준점수 평가 과목을 선택하세요.')
        _integer(standard_score,'standard_score')
        row=next((r for r in s['frequencies'] if r['standard_score']==standard_score),None)
        _require(row is not None,'unobserved_standard_score','해당 시험 공식 분포에 없는 표준점수입니다.')
        count=row['count'];above=row['cumulative_count']-count;n=s['denominator']
        return {'subject':s['label'],'standard_score':standard_score,'grade':_grade(s,standard_score),
                'denominator':n,'above_count':above,'equal_count':count,
                'top_percent_exclusive':_decimal(Fraction(above*100,n),6),
                'top_percent_inclusive':_decimal(Fraction((above+count)*100,n),6),
                'source_ref':row['source_ref'],'basis':'official_subject_population',
                'meaning':'과목별 응시자 중 위치. 국수탐2 총점 누적 또는 성적표 정수 백분위가 아님.'}

    def analyze(self,payload,*,total_model=None):
        _require(isinstance(payload,dict),'invalid_scores','성적 입력 객체가 필요합니다.')
        _require(payload.get('exam_id')==self.exam_id,'exam_mismatch','학생 성적과 기준표의 시험이 다릅니다.')
        try:
            inquiry=payload['inquiry']
            _require(isinstance(inquiry,list) and len(inquiry)==2,'two_inquiry_required','탐구 두 과목 성적이 필요합니다.')
            keys=[subject_key(i['subject']) for i in inquiry]
            _require(len(set(keys))==2,'duplicate_inquiry','같은 탐구 과목을 중복 입력할 수 없습니다.')
            categories=[]
            for k in keys:
                s=self._data['subjects'].get(k)
                _require(s is not None and s['category'] in ('social','science','vocational'),'invalid_inquiry','탐구 과목을 확인하세요.')
                categories.append(s['category'])
            _require(('vocational' not in categories) or set(categories)=={'vocational'},
                     'inquiry_domain_mismatch','사회·과학과 직업탐구를 한 성적표에 섞을 수 없습니다.')
            for area,sid in [('korean','국어'),('math','수학')]:
                choice=payload[area].get('choice')
                if choice is not None:
                    _require(subject_key(choice) in self._data['participants']['choice_counts'][sid],
                             'invalid_choice','국어·수학 선택과목을 확인하세요.')
            results=[self.subject_result('국어',payload['korean']['standard_score']),
                     self.subject_result('수학',payload['math']['standard_score'])]
            results.extend(self.subject_result(i['subject'],i['standard_score']) for i in inquiry)
            absolute={}
            for field,name in [('english_grade','영어'),('korean_history_grade','한국사')]:
                value=payload.get(field)
                if value is not None:
                    _integer(value,field,1);_require(value<=9,'invalid_grade','등급은 1~9입니다.')
                    absolute[name]=value
        except (KeyError,TypeError,AttributeError) as exc:
            raise PercentileError('invalid_scores','국어·수학·탐구2 필수 성적을 확인하세요.') from exc
        std=StandardScores(self._data['exam']['academic_year'],*(r['standard_score'] for r in results))
        overall={'status':'calibration_required','top_percent':None,
                 'reason':'해당 시험의 전체 유효 응시자 기준 총점 곡선이 아직 발행되지 않았습니다.'}
        if total_model is not None:
            _require(isinstance(total_model,ExamTotalModel),'invalid_model','시험에 연결된 총점 모델이 필요합니다.')
            _require(total_model.exam_id==self.exam_id,'model_exam_mismatch','총점 곡선의 시험이 다릅니다.')
            _require(total_model.pack_version==self.pack_version,'model_pack_mismatch','총점 곡선과 공식 자료 버전이 다릅니다.')
            meta=total_model.distribution.metadata;target=self._data['participants']['target_population']
            _require(target['count_lower_bound']<=meta.expected_total_weight<=target['count_upper_bound'],
                     'model_population_mismatch','총점 모델 분모가 공식 응시 현황과 양립하지 않습니다.')
            if target['count'] is not None:
                _require(meta.expected_total_weight==target['count'],'model_population_mismatch','총점 모델과 확인된 비교 집단 인원이 다릅니다.')
            overall=total_model.distribution.calculate(std).to_dict()
            overall.update(status='estimated' if meta.kind=='estimated_weights' else 'observed',
                           exam_id=self.exam_id,pack_version=self.pack_version)
        return {'exam':deepcopy(self._data['exam']),'pack_version':self.pack_version,
                'score_basis':'mock_exam' if self._data['exam']['exam_type']!='csat' else 'actual_csat',
                'total_standard_score':std.total,'subjects':results,'absolute_grades':absolute,
                'overall':overall,
                'university_analysis':{'status':'not_connected',
                   'required_basis':['target_academic_year','offering_id','rule_version','conversion_table_version',
                                     'exam_id','forecast_version']}}
