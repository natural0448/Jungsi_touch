"""사전 정책에 따른 독립 잔차·참고 검증. 구조/수렴만으로 발행하지 않는다."""
from copy import deepcopy
from fractions import Fraction
import math
import numpy as np
from .estimated_profiles import require, finite, pack_data, validate_candidate_profiles, complete_mask, digest
from .estimated_fitting import validate_policy_context, reference_context


def reference_feasibility_certificate(pack,reference,count,info):
    """공식 주변도수의 완성 집단 평균 필요조건과 원참고 CDF 평균 구간을 독립 비교한다."""
    from .estimated_curves import official_total_domain
    points=reference_context(pack,reference);count=Fraction(str(count));require(count>0,'invalid_population_scale')
    data=pack_data(pack);minimum,maximum=official_total_domain(pack,info)
    def selected_mean(names,slots,reverse):
        rows=sorted([(r['standard_score'],r['count']) for name in names for r in data['subjects'][name]['frequencies']],reverse=reverse)
        remaining=count*slots;value=Fraction(0)
        for score,n in rows:
            kept=min(remaining,n);value+=score*kept;remaining-=kept
            if not remaining:break
        require(remaining==0,'complete_population_support_missing')
        return value/count
    names=info['inquiry_names']
    lower=sum(selected_mean(n,s,False) for n,s in [(['국어'],1),(['수학'],1),(names,2)])
    upper=sum(selected_mean(n,s,True) for n,s in [(['국어'],1),(['수학'],1),(names,2)])
    all_rows=sorted([(r['score'],Fraction(str(r['top_fraction']))) for r in points.values()])
    violations=[dict(score=score,reference_fraction=str(tail),required_fraction='1' if score<=minimum else '0')
        for score,tail in all_rows if (score<=minimum and tail!=1) or (score>maximum and tail!=0)]
    rows=[(score,tail) for score,tail in all_rows if minimum<score<=maximum]
    knots=[(minimum,Fraction(1))]+rows+[(maximum+1,Fraction(0))]
    monotone=all(a[1]>=b[1] for a,b in zip(knots,knots[1:]))
    # E[T] = minimum + sum_{t=minimum+1}^{maximum} P(T>=t).
    ref_lower=Fraction(minimum);ref_upper=Fraction(minimum)
    for (a,fa),(b,fb) in zip(knots,knots[1:]):
        inside=max(0,min(b,maximum)-max(a,minimum))
        ref_lower+=inside*fb;ref_upper+=inside*fa
    def exact(v):return dict(numerator=v.numerator,denominator=v.denominator)
    incompatible=bool(violations) or not monotone or ref_lower>upper or ref_upper<lower
    return dict(format='jungsi.reference-feasibility-certificate/v1',method='official_marginal_population_mean_bounds/v1',
        status='incompatible' if incompatible else 'not_refuted_by_mean_bounds',source_id=reference['source_id'],
        reference_hash=digest(reference),input_hash=info['input_hash'],complete_count=str(count),
        official_mean_lower=exact(lower),official_mean_upper=exact(upper),reference_mean_lower=exact(ref_lower),reference_mean_upper=exact(ref_upper),
        support_violations=violations,reference_tail_monotone=monotone,
        inquiry_pair_constraints_relaxed_for_conservative_bound=True,necessary_condition_only=True)


def official_residuals(pack,p,info,weights,complete_count):
    """제약 행렬을 재사용하지 않고 공식 입력에서 가중 인원을 독립 집계한다."""
    d=pack_data(pack);total=d['participants']['total'];result=[]
    def check(name,actual,count):
        result.append(dict(name=name,expected_probability=float(count/total),estimated_probability=float(actual),
                           abs_probability_error=abs(float(actual-count/total)),
                           relative_error=abs(float(actual-count/total))/(count/total) if count>0 else None))
    for key,name in [('korean','국어'),('math','수학'),('english','영어'),('history','한국사')]:
        subject=d['subjects'][name]
        rows=subject['frequencies'] if subject['assessment']=='standard_score' else subject['grades']
        field='standard_score' if subject['assessment']=='standard_score' else 'grade'
        for row in rows:check(name+':'+str(row[field]),weights[p[key]==row[field]].sum(),row['count'])
        check(name+':missing',weights[p[key]<0].sum(),total-subject['denominator'])
    for key,name in [('korean','국어'),('math','수학')]:
        for index,label in enumerate(info['choice_labels'][key]):
            check(key+':choice:'+label,weights[p[key+'_choice']==index].sum(),d['participants']['choice_counts'][name][label])
    groups=d['participants']['inquiry_groups'];slots={category:sum(s['denominator'] for s in d['subjects'].values()
        if s['category']==category) for category in ('social','science','vocational')}
    social_one=2*groups['social_only']+groups['mixed_social_science']-slots['social']
    science_one=2*groups['science_only']+groups['mixed_social_science']-slots['science']
    vocational_one=2*groups['vocational']-slots['vocational']
    group_counts=[total-d['participants']['inquiry_total'],social_one,groups['social_only']-social_one,
        science_one,groups['science_only']-science_one,groups['mixed_social_science'],vocational_one,groups['vocational']-vocational_one]
    for group,count in enumerate(group_counts):check('inquiry_group:'+str(group),weights[p['inquiry_group']==group].sum(),count)
    for subject,name in enumerate(info['inquiry_names']):
        for row in d['subjects'][name]['frequencies']:
            actual=sum(weights[(p[key+'_subject']==subject)&(p[key]==row['standard_score'])].sum() for key in ('q1','q2'))
            check(name+':'+str(row['standard_score']),actual,row['count'])
    check('complete_population',weights[complete_mask(p)].sum(),finite(complete_count))
    return result


def reference_residuals(pack,p,weights,reference,point_ids):
    points=reference_context(pack,reference)
    require(len(point_ids)==len(set(point_ids)) and set(point_ids)<=set(points),'validation_reference_point_missing')
    mask=complete_mask(p);den=weights[mask].sum()
    require(den>0,'empty_complete_population')
    totals=p['korean'].astype(float)+p['math']+p['q1']+p['q2'];rows=[]
    for pid in point_ids:
        row=points[pid];fraction=float(weights[mask&(totals>=row['score'])].sum()/den);target=finite(row['top_fraction'])
        moments={}
        for key,value in row.get('conditional_means',{}).items():
            require(key in ('korean','math','english','history'),'invalid_reference_moment')
            same=mask&(totals==row['score'])&(p[key]>=0);weight=weights[same].sum()
            estimate=float(weights[same]@p[key][same]/weight) if weight>0 else None
            moments[key]=dict(estimated=estimate,reference=finite(value),
                abs_error=abs(estimate-finite(value)) if estimate is not None else None)
        rows.append(dict(source_id=reference['source_id'],point_id=pid,score=row['score'],
            estimated_top_fraction=fraction,reference_top_fraction=target,abs_error_pp=abs(fraction-target)*100,
            abs_log10_ratio=abs(math.log10(max(fraction,np.finfo(float).tiny)/target)) if target>0 else None,
            effective_tail_support=float(weights[mask&(totals>=row['score'])].sum()**2/
                np.sum(weights[mask&(totals>=row['score'])]**2)) if fraction>0 else 0,
            conditional_means=moments))
    return rows


def validate_estimate(pack,p,weights,info,fit,reference,policy,*,independent_references=(),sensitivity=()):
    """공식 잔차·미사용 참고점·다른 출처·민감도를 각각 검증한다.

    sensitivity는 같은 엔진으로 재실행한 시나리오의 내부 기록이다.
    학생 단위 holdout, 95% 신뢰구간, 실제 전국 공동분포의 일치를 주장하지 않는다.
    """
    validate_candidate_profiles(pack,p,info);validate_policy_context(pack,policy)
    weights=np.asarray(weights,dtype=float).copy();v=policy['validation']
    require(type(v['minimum_reference_points']) is int and v['minimum_reference_points']>0 and
            type(v['minimum_sensitivity_cases']) is int and v['minimum_sensitivity_cases']>0,
            'validation_evidence_required')
    require(weights.shape==p['prior'].shape and np.all(np.isfinite(weights)) and np.all(weights>=0),'invalid_fitted_weights')
    require(fit['policy_hash']==digest(policy) and fit['input_hash']==info['input_hash'] and
        fit['proposal_hash']==info['proposal_hash'] and fit['candidate_hash']==digest({k:x.tolist() for k,x in p.items()}) and
        fit['weights_hash']==digest(weights.tolist()),
        'estimate_provenance_mismatch')
    limits=v['limits']
    for value in limits.values():require(finite(value)>=0,'invalid_validation_limits')
    supported={'normalization','official_max_abs_probability','reference_max_error_pp','reference_mean_error_pp',
        'official_rare_abs_probability','official_relative_error','upper_tail_max_error_pp','upper_tail_median_log10_ratio',
        'effective_support_fraction_min','tail_effective_support_min','replicate_max_delta_pp','replicate_university_delta_pp'}
    rows=official_residuals(pack,p,info,weights,fit['complete_count'])
    maximum=max(r['abs_probability_error'] for r in rows)
    checks=dict(optimizer_converged=fit['converged'] is True,
        finite_normalized_weights=abs(float(weights.sum())-1)<=finite(limits['normalization']),
        official_constraints=maximum<=finite(limits['official_max_abs_probability']),
        no_numerical_underflow=fit['numerical_underflow_rows']==0)
    checks['all_policy_limits_supported']=set(limits)<=supported
    threshold=finite(v.get('rare_probability_threshold','0.0001'))
    if 'official_rare_abs_probability' in limits:
        checks['official_rare_constraints']=all(r['abs_probability_error']<=finite(limits['official_rare_abs_probability'])
            for r in rows if r['expected_probability']<threshold)
    if 'official_relative_error' in limits:
        checks['official_relative_constraints']=all(r['relative_error']<=finite(limits['official_relative_error'])
            for r in rows if r['expected_probability']>=threshold and r['relative_error'] is not None)
    ess=float(weights.sum()**2/np.sum(weights**2)) if np.sum(weights**2)>0 else 0
    if 'effective_support_fraction_min' in limits:
        checks['effective_support']=ess/len(weights)>=finite(limits['effective_support_fraction_min'])
    withheld=list(v['withheld_point_ids'])
    require(not set(withheld)&set(fit['training_point_ids']),'reference_train_validation_overlap')
    training=[];held=[]
    if reference is not None:
        require(reference['source_id']==fit['training_source_id'] or not fit['training_point_ids'],'validation_reference_source_mismatch')
        training=reference_residuals(pack,p,weights,reference,fit['training_point_ids'])
        held=reference_residuals(pack,p,weights,reference,withheld)
    else:require(not withheld,'validation_reference_missing')
    comparisons=[]
    for item in independent_references:
        require(reference is None or item['reference']['source_id']!=reference['source_id'],'independent_reference_not_independent')
        comparisons.extend(reference_residuals(pack,p,weights,item['reference'],item['point_ids']))
    evaluated=held+comparisons
    checks['reference_points_available']=len(evaluated)>=v['minimum_reference_points'] and len(evaluated)>0
    max_error=max((r['abs_error_pp'] for r in evaluated),default=None)
    mean_error=sum(r['abs_error_pp'] for r in evaluated)/len(evaluated) if evaluated else None
    checks['reference_max_error']=max_error is not None and max_error<=finite(limits['reference_max_error_pp'])
    checks['reference_mean_error']=mean_error is not None and mean_error<=finite(limits['reference_mean_error_pp'])
    tail_range=v.get('upper_tail_fraction_range',['0.0001','0.01'])
    tail=[r for r in evaluated if finite(tail_range[0])<=r['reference_top_fraction']<=finite(tail_range[1])]
    if 'upper_tail_max_error_pp' in limits:
        checks['upper_tail_error']=bool(tail) and max(r['abs_error_pp'] for r in tail)<=finite(limits['upper_tail_max_error_pp'])
    if 'upper_tail_median_log10_ratio' in limits:
        checks['upper_tail_ratio']=bool(tail) and float(np.median([r['abs_log10_ratio'] for r in tail]))<=finite(limits['upper_tail_median_log10_ratio'])
    if 'tail_effective_support_min' in limits:
        checks['tail_effective_support']=bool(tail) and min(r['effective_tail_support'] for r in tail)>=finite(limits['tail_effective_support_min'])
    conditional={key:[] for key in v['conditional_mean_limits']}
    for row in evaluated:
        for key,item in row['conditional_means'].items():
            require(key in v['conditional_mean_limits'],'conditional_mean_limit_missing')
            conditional[key].append(item['abs_error'])
    conditional_mae={key:sum(values)/len(values) if values and all(value is not None for value in values) else None
                     for key,values in conditional.items()}
    checks['conditional_means']=all(value is not None and value<=finite(v['conditional_mean_limits'][key])
                                  for key,value in conditional_mae.items())
    cases=deepcopy(list(sensitivity));dimensions=set()
    for case in cases:
        require(case['status'] in ('validated_sensitivity','research_sensitivity') and case['proposal_hash']!=info['proposal_hash'] and
                case['input_hash']==info['input_hash'] and case['policy_version']==policy['version'] and
                case['policy_hash']==digest(policy),
                'sensitivity_provenance_mismatch')
        dimensions.update(case['dimensions'])
    checks['sensitivity_cases']=len(cases)>=v['minimum_sensitivity_cases'] and set(v['required_sensitivity_dimensions'])<=dimensions
    checks['sensitivity_official_constraints']=all(case.get('official_constraints_verified') is True for case in cases)
    baseline={r['point_id']:r['estimated_top_fraction'] for r in held}
    ranges={k:[value] for k,value in baseline.items()};replicate=[]
    for case in cases:
        for row in case['point_estimates']:
            value=finite(row['top_fraction']);require(0<=value<=1,'invalid_sensitivity_fraction')
            ranges.setdefault(row['point_id'],[]).append(value)
            if 'seed' in case['dimensions'] or 'size' in case['dimensions']:
                if row['point_id'] in baseline:replicate.append(abs(value-baseline[row['point_id']])*100)
    if 'replicate_max_delta_pp' in limits:
        checks['replicate_error']=bool(replicate) and max(replicate)<=finite(limits['replicate_max_delta_pp']) and all(
            set(baseline)<=set(row['point_id'] for row in c['point_estimates']) for c in cases if 'seed' in c['dimensions'] or 'size' in c['dimensions'])
    if 'replicate_university_delta_pp' in limits:
        school=[finite(value) for c in cases if 'seed' in c['dimensions'] or 'size' in c['dimensions']
                for value in c.get('university_delta_pp',[])]
        checks['replicate_university_error']=bool(school) and max(school)<=finite(limits['replicate_university_delta_pp'])
    ranges={k:dict(min=min(values),max=max(values),meaning='scenario_range_not_95_percent_confidence_interval') for k,values in ranges.items()}
    metrics=dict(official_max_abs_probability=maximum,reference_points=len(evaluated),
        withheld_max_error_pp=max_error,withheld_mean_error_pp=mean_error,
        complete_weight_fraction=float(weights[complete_mask(p)].sum()),effective_support=ess,
        effective_support_fraction=ess/len(weights),conditional_mean_mae=conditional_mae,
        upper_tail_max_error_pp=max((r['abs_error_pp'] for r in tail),default=None),
        upper_tail_median_log10_ratio=float(np.median([r['abs_log10_ratio'] for r in tail])) if tail else None,
        replicate_max_delta_pp=max(replicate,default=None),unsupported_policy_limits=sorted(set(limits)-supported))
    role=v.get('reference_validation_role','required')
    require(role in ('required','diagnostic_excluded_incompatible'),'invalid_reference_validation_role')
    certificate=None
    diagnostic_names={'reference_points_available','reference_max_error','reference_mean_error','upper_tail_error',
        'upper_tail_ratio','tail_effective_support','conditional_means'}
    if role=='diagnostic_excluded_incompatible':
        require(reference is not None,'validation_reference_missing')
        certificate=reference_feasibility_certificate(pack,reference,fit['complete_count'],info)
        evidence=v.get('reference_exclusion_evidence',{})
        require(certificate['status']=='incompatible' and evidence.get('certificate_hash')==digest(certificate) and
            evidence.get('source_id')==reference['source_id'] and bool(evidence.get('reason')),
            'reference_exclusion_unverified')
        checks['reference_exclusion_applied']=not fit['training_point_ids']
    adoption_checks={k:value for k,value in checks.items() if role=='required' or k not in diagnostic_names}
    require(bool(adoption_checks),'validation_evidence_required')
    passed=all(adoption_checks.values())
    return dict(format='jungsi.estimate-validation/v1',status='self_validated_estimate' if passed else 'research_only',
        data_kind='estimated_weights',checks=checks,adoption_checks=adoption_checks,
        diagnostic_checks={k:value for k,value in checks.items() if k not in adoption_checks},
        reference_validation_role=role,reference_feasibility_certificate=certificate,
        metrics=metrics,official_residuals=rows,
        training_reference_residuals=training,withheld_reference_residuals=held,independent_reference_residuals=comparisons,
        sensitivity=cases,scenario_ranges=ranges,policy_version=policy['version'],policy_hash=digest(policy),
        input_hash=info['input_hash'],proposal_hash=info['proposal_hash'],candidate_hash=fit['candidate_hash'],
        weights_hash=digest(weights.tolist()),complete_count=fit['complete_count'],
        meaning='동일 참고곡선의 미사용점 검증 및 다른 출처 비교. 실제 학생 정답/95% 신뢰구간을 뜻하지 않음.')


def validate_serialized_weights(pack,p,info,exact_weights,count,policy):
    """Aggregate saved exact weights using integers, independent of float fit."""
    validate_candidate_profiles(pack,p,info);validate_policy_context(pack,policy)
    require(len(exact_weights)==len(p['prior']) and all(isinstance(w,Fraction) and w>=0 for w in exact_weights),
        'invalid_serialized_weights')
    denominator=math.lcm(*(w.denominator for w in exact_weights))
    integers=[w.numerator*(denominator//w.denominator) for w in exact_weights]
    data=pack_data(pack);total=data['participants']['total'];bins={};complete=0
    def add(key,value):bins[key]=bins.get(key,0)+value
    for i,value in enumerate(integers):
        if not value:continue
        for key,name in [('korean','국어'),('math','수학'),('english','영어'),('history','한국사')]:
            score=int(p[key][i]);add(name+':'+(str(score) if score>=0 else 'missing'),value)
        for key in ('korean','math'):
            choice=int(p[key+'_choice'][i])
            if choice>=0:add(key+':choice:'+info['choice_labels'][key][choice],value)
        add('inquiry_group:'+str(int(p['inquiry_group'][i])),value)
        for key in ('q1','q2'):
            subject=int(p[key+'_subject'][i])
            if subject>=0:add(info['inquiry_names'][subject]+':'+str(int(p[key][i])),value)
        if all(p[k][i]>=0 for k in ('korean','math','q1','q2')):complete+=value
    bins['complete_population']=complete
    # Expected official counts are read afresh, with no fitted feature matrix.
    expected={}
    for key,name in [('korean','국어'),('math','수학'),('english','영어'),('history','한국사')]:
        s=data['subjects'][name];rows=s['frequencies'] if s['assessment']=='standard_score' else s['grades']
        field='standard_score' if s['assessment']=='standard_score' else 'grade'
        for r in rows:expected[name+':'+str(r[field])]=Fraction(r['count'])
        expected[name+':missing']=Fraction(total-s['denominator'])
    for key,name in [('korean','국어'),('math','수학')]:
        for label,n in data['participants']['choice_counts'][name].items():expected[key+':choice:'+label]=Fraction(n)
    groups=data['participants']['inquiry_groups']
    slots={c:sum(s['denominator'] for s in data['subjects'].values() if s['category']==c) for c in ('social','science','vocational')}
    one_s=2*groups['social_only']+groups['mixed_social_science']-slots['social']
    one_q=2*groups['science_only']+groups['mixed_social_science']-slots['science']
    one_v=2*groups['vocational']-slots['vocational']
    group_counts=[total-data['participants']['inquiry_total'],one_s,groups['social_only']-one_s,
        one_q,groups['science_only']-one_q,groups['mixed_social_science'],one_v,groups['vocational']-one_v]
    for group,n in enumerate(group_counts):expected['inquiry_group:'+str(group)]=Fraction(n)
    for name in info['inquiry_names']:
        for r in data['subjects'][name]['frequencies']:expected[name+':'+str(r['standard_score'])]=Fraction(r['count'])
    expected['complete_population']=Fraction(str(count));rows=[];limits=policy['validation']['limits']
    threshold=Fraction(str(policy['validation'].get('rare_probability_threshold','0.0001')))
    passed=sum(integers)==denominator*total and complete==denominator*Fraction(str(count))
    def ratio(v):return dict(numerator=v.numerator,denominator=v.denominator)
    for name,n in expected.items():
        actual=Fraction(bins.get(name,0),denominator);error=abs(actual-n)/total;prob=n/total
        okay=error<=Fraction(str(limits['official_max_abs_probability']))
        if 'official_rare_abs_probability' in limits and prob<threshold:
            okay=okay and error<=Fraction(str(limits['official_rare_abs_probability']))
        if 'official_relative_error' in limits and prob>=threshold and prob>0:
            okay=okay and error/prob<=Fraction(str(limits['official_relative_error']))
        rows.append(dict(name=name,actual_weight=ratio(actual),expected_weight=ratio(n),
            exact_abs_probability_error=ratio(error),abs_probability_error=float(error),passed=okay))
        passed=passed and okay
    return dict(format='jungsi.serialized-estimate-validation/v1',passed=bool(passed),rows=rows,
        all_population_weight=ratio(Fraction(sum(integers),denominator)),
        complete_population_weight=ratio(Fraction(complete,denominator)),policy_hash=digest(policy),
        exact_weights_hash=digest([ratio(w) for w in exact_weights]),
        meaning='최종 저장 소수 가중치에서 정수/분수로 재집계. float 최적화 검수와 별도.')
