"""총점별 평균 제약 → 성적 조합별 인원 → 누적표: 가상 200명 검산.

원본 엑셀·개인 자료를 읽지 않는다. 실제 전국 분포 추정기나 엔트로피
최적화 구현이 아니다. 작은 선형계에서 생성 원리를 정확한 유리수로 확인한다.
파일 삭제 없음. --output을 주면 새 JSON만 생성한다.
"""
from __future__ import annotations
import argparse
from dataclasses import replace
from fractions import Fraction
import json
from pathlib import Path
import sys

sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'src'))
from jungsi_touch.percentile import DistributionMetadata, StandardScores, METRIC_ID, POPULATION_ID
from jungsi_touch.joint_distribution import JointScoreCount, JointScoreDistribution

class ConstraintError(ValueError):
    pass


def unique_solution(equations, unknowns):
    """소규모 예제의 정확한 가우스 소거. 해가 없거나 여러 개면 선택하지 않는다."""
    matrix=[[Fraction(v) for v in coefficients]+[Fraction(target)] for coefficients,target in equations]
    if any(len(row)!=unknowns+1 for row in matrix):
        raise ConstraintError('dimension_mismatch')
    pivots=[]
    current=0
    for column in range(unknowns):
        pivot=next((r for r in range(current,len(matrix)) if matrix[r][column]),None)
        if pivot is None:continue
        matrix[current],matrix[pivot]=matrix[pivot],matrix[current]
        divisor=matrix[current][column]
        matrix[current]=[v/divisor for v in matrix[current]]
        for row in range(len(matrix)):
            if row==current:continue
            multiplier=matrix[row][column]
            matrix[row]=[a-multiplier*b for a,b in zip(matrix[row],matrix[current])]
        pivots.append(column)
        current+=1
    if any(not any(row[:-1]) and row[-1] for row in matrix):
        raise ConstraintError('inconsistent_constraints')
    if len(pivots)<unknowns:
        raise ConstraintError('underdetermined')
    result=[Fraction(0)]*unknowns
    for row,column in enumerate(pivots):result[column]=matrix[row][-1]
    if any(n<0 for n in result):
        raise ConstraintError('negative_population')
    return result


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path)
    args=parser.parse_args(argv)
    # 모든 자료는 가상이다. 각 행의 네 점수는 같은 사람의 조합으로 유지한다.
    profiles=[StandardScores(2026,k,m,50,50) for m in (80,100) for k in (60,80,100)]
    margins=[([int(p.korean==k) for p in profiles],count) for k,count in ((60,50),(80,100),(100,50))]
    margins.extend(([int(p.math==m) for p in profiles],100) for m in (80,100))
    means={260:Fraction('72.5'),280:Fraction('87.5')}
    moments=[([p.korean-mean if p.total==total else Fraction(0) for p in profiles],0) for total,mean in means.items()]
    marginal_only_underdetermined=False
    try:unique_solution(margins,len(profiles))
    except ConstraintError as exc:
        assert str(exc)=='underdetermined'
        marginal_only_underdetermined=True
    assert marginal_only_underdetermined
    counts=unique_solution(margins+moments,len(profiles))
    assert counts==list(map(Fraction,[20,50,30,30,50,20]))
    assert sum(counts)==200
    for coefficients,target in margins+moments:
        assert sum(a*n for a,n in zip(coefficients,counts))==target
    # 조건부 평균을 분모가 포함된 원래 식으로도 별도 검산한다.
    for total,mean in means.items():
        relevant=[i for i,p in enumerate(profiles) if p.total==total]
        assert sum(counts[i]*profiles[i].korean for i in relevant)/sum(counts[i] for i in relevant)==mean
    for extra,expected in [(([1,0,0,1,0,0],51),'inconsistent_constraints')]:
        try:unique_solution(margins+moments+[extra],len(profiles))
        except ConstraintError as exc:assert str(exc)==expected
        else:raise AssertionError('모순된 조건을 수락했습니다.')
    # 260점 집단의 국어 평균을 81점으로 요구하면 이 후보 집합에 음수가 아닌 해가 없다.
    bad_moments=[([p.korean-81 if p.total==260 else 0 for p in profiles],0),moments[1]]
    try:unique_solution(margins+bad_moments,len(profiles))
    except ConstraintError as exc:assert str(exc)=='negative_population'
    else:raise AssertionError('불가능한 평균을 수락했습니다.')
    metadata=DistributionMetadata(
        distribution_id='synthetic-calibration-200',academic_year=2026,
        source_name='가상 200명: 과목별 인원+총점별 평균 제약',source_date='2026-09-27',
        metric_id=METRIC_ID,population_id=POPULATION_ID,kind='estimated_weights',
        status='synthetic',population_verified=False,complete=True,score_min=0,score_max=500,
        expected_total_weight=200,
    )
    joint=JointScoreDistribution(metadata,[JointScoreCount(p,n) for p,n in zip(profiles,counts)])
    # 비교용 독립 결합은 같은 주변 인원을 만족하지만 조건부 평균이 다르다.
    independent_counts=list(map(Fraction,[25,50,25,25,50,25]))
    baseline=JointScoreDistribution(replace(metadata,distribution_id='synthetic-independence-comparison'),[JointScoreCount(p,n) for p,n in zip(profiles,independent_counts)])
    actual_margins={area:joint.conditional_counts(target=area,given={}) for area in ('korean','math','inquiry1','inquiry2')}
    assert all(actual_margins[area]==baseline.conditional_counts(target=area,given={}) for area in actual_margins)
    conditional=joint.conditional_counts(target='korean',given={'math':80})
    assert conditional=={60:20,80:50,100:30}
    total_frequency={r.total_score:r.weight for r in joint.total_frequencies}
    assert total_frequency=={240:20,260:80,280:80,300:20}
    curve=[]
    for total in sorted(total_frequency,reverse=True):
        result=joint.to_total_distribution().calculate(StandardScores(2026,total,0,0,0),require_approved=False)
        curve.append({'total':total,'estimated_count':str(total_frequency[total]),'at_or_above_count':str(result.above_weight+result.equal_weight),'top_percent':str(result.top_percent)})
    top=joint.to_total_distribution().calculate(StandardScores(2026,100,100,50,50),require_approved=False).top_percent
    comparison_top=baseline.to_total_distribution().calculate(StandardScores(2026,100,100,50,50),require_approved=False).top_percent
    assert top==10 and comparison_top==Fraction('12.5')
    result={'status':'synthetic_only','is_national_estimate':False,
        'method_scope':'Exact linear feasibility example on six declared profiles. No production entropy optimizer or national model fitted.',
        'input_population':200,'marginal_constraints':{'korean':{60:50,80:100,100:50},'math':{80:100,100:100},'inquiry1':{50:200},'inquiry2':{50:200}},
        'input_korean_means_by_total':{t:str(m) for t,m in means.items()},
        'marginal_only_underdetermined':marginal_only_underdetermined,
        'fitted_cells':[{'korean':p.korean,'math':p.math,'inquiry1':p.inquiry1,'inquiry2':p.inquiry2,'total':p.total,'count':str(n)} for p,n in zip(profiles,counts)],
        'conditional_korean_counts_at_math80':{k:str(v) for k,v in conditional.items()},
        'total_curve':curve,
        'same_margins_comparison':{'fitted_300_top_percent':str(top),'independence_300_top_percent':str(comparison_top)},
        'checks':['exact constraints','original conditional means','same marginals with different total tails','multiple Korean scores at fixed math','inconsistent constraints rejected','impossible mean rejected','existing total engine integration']}
    if args.output:
        args.output.parent.mkdir(parents=True,exist_ok=True)
        with args.output.open('x',encoding='utf-8') as f:json.dump(result,f,ensure_ascii=False,indent=2)
    print(json.dumps(result,ensure_ascii=False,indent=2))
    return 0

if __name__=='__main__':raise SystemExit(main())