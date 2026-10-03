"""고속성장 분위표의 내부 검산용 조회. 서비스 전체 누적 모델로 승인하지 않는다.

원본의 두 집단과 인원을 유지한 채 동점 경계와 중간값을 조회한다.
이 모듈은 계열별 분위표를 학생 과목끼리 매칭하지 않는다.
"""
from __future__ import annotations
from decimal import Decimal
from fractions import Fraction
from .percentile import PercentileError, _decimal, _integer, _weight

class ReferenceQuantileCurve:
    def __init__(self,rows):
        self.rows=tuple((_weight(str(r['percent'])),_weight(str(r['total_score']))) for r in rows)
        if not self.rows:raise PercentileError('empty_curve','참고 분위표가 없습니다.')
        if any(not 0<=p<=100 for p,_ in self.rows):raise PercentileError('invalid_percent','누적 비율 범위 오류입니다.')
        if any(p>=pn or score<sn for (p,score),(pn,sn) in zip(self.rows,self.rows[1:])):
            raise PercentileError('nonmonotone_curve','원본 분위표에 순서 역전이 있습니다.')

    def boundary(self,score):
        # Reproduce the inspected Excel MATCH(...,-1), with a stated sentinel.
        if score>=self.rows[0][1]:return Fraction(1,10**10),True
        eligible=[p for p,s in self.rows if s>=score]
        if score<self.rows[-1][1]:
            raise PercentileError('reference_outside_coverage','원본 참고곡선의 확인된 하위 구간 밖입니다. 외삽하지 않습니다.')
        return eligible[-1],False

    def lookup(self,total):
        _integer(total,'total_score')
        exclude,c1=self.boundary(Fraction(total)+Fraction(1,1000))
        include,c2=self.boundary(Fraction(total)-Fraction(1,1000))
        return {'exclusive':exclude,'inclusive':include,'midpoint':(exclude+include)/2,
                'upper_tail_sentinel':c1 or c2}

def inspect_gs_total(reference,total,official_total):
    """기준 집단이 불일치해도 원본 검산값은 반환하되 추천 엔진에는 연결하지 않는다."""
    _integer(official_total,'official_total',1)
    evidence={(c['sheet'],c['cell']):c.get('value') for c in reference['evidence']}
    weights={'science':evidence[('SUBJECT1','D13')],'humanities':evidence[('SUBJECT1','D14')]}
    for k,n in weights.items():_integer(n,k,1)
    if evidence[('SUBJECT1','A13')]!='수학(이과)' or evidence[('SUBJECT1','A14')]!='수학(문과)':
        raise PercentileError('reference_schema_changed','원본의 집단 인원 위치가 변경되었습니다.')
    groups={c['group']:ReferenceQuantileCurve(c['rows']).lookup(total) for c in reference['curves']}
    if set(groups)!=set(weights):raise PercentileError('reference_groups_mismatch','참고 집단이 일치하지 않습니다.')
    n=sum(weights.values())
    result={k:_decimal(sum(groups[g][k]*weights[g] for g in groups)/n,6) for k in ['exclusive','inclusive','midpoint']}
    return {'status':'external_reference_only','total_standard_score':total,
            'reference_top_percent':result,'reference_population':n,'group_weights':weights,
            'population_column_label':evidence[('SUBJECT1','D4')],
            'official_exam_total':official_total,'exceeds_official_exam_total':n>official_total,
            'upper_tail_sentinel':any(v['upper_tail_sentinel'] for v in groups.values()),
            'service_model_eligible':False,
            'reason':'비교 집단 포함 조건과 시험 응시 집단의 일치가 검증되지 않았습니다.',
            'method':'원본 MATCH 경계 조회 및 집단 인원 가중. Excel 재계산/자체 예측 정확도 검증이 아님.'}
