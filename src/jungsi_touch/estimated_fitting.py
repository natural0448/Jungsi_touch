"""공식 주변도수 제약과 참고 추정의 soft 보정을 분리한 엔트로피 추정."""
from copy import deepcopy
import math
import numpy as np
from .estimated_profiles import require, finite, pack_data, subject_values, validate_candidate_profiles, complete_mask, digest
from .percentile import POPULATION_ID, METRIC_ID


def validate_policy_context(pack,policy):
    require((policy['exam_id'],policy['pack_version'],policy['academic_year'],policy['population_id'])==
            (pack.exam_id,pack.pack_version,pack.academic_year,POPULATION_ID),'estimation_policy_context_mismatch')
    require(bool(policy['version']) and policy['method']=='entropy_soft_reference/v1','unsupported_estimation_method')


def official_constraints(pack,p,info,complete_count):
    """전체 후보의 정규화 가중치에 적용할 인원/total 제약. 탐구의 연인원도 구분한다."""
    d=pack_data(pack);subjects=d['subjects'];participants=d['participants'];total=participants['total']
    count=finite(complete_count);target=participants['target_population']
    require(target['count_lower_bound']<=count<=target['count_upper_bound'] and count>0,'model_population_mismatch')
    require(target['count'] is None or count==target['count'],'model_population_mismatch')
    constraints=[]
    def add(name,codes,counts):
        target=np.asarray(counts,dtype=float)/total
        require(np.all(np.isfinite(target)) and np.all(target>=0),'invalid_estimation_constraint')
        constraints.append(dict(name=name,codes=codes if isinstance(codes,list) else [codes],target=target))
    for key,name in [('korean','국어'),('math','수학'),('english','영어'),('history','한국사')]:
        values,counts=subject_values(subjects[name]);codes=1+np.searchsorted(values,p[key]) if key in ('korean','math') else None
        if codes is None:
            table={int(v):i+1 for i,v in enumerate(values)}
            codes=np.array([table.get(int(v),0) for v in p[key]],dtype=np.int32)
        codes[p[key]<0]=0
        add(name+'_score',codes,np.r_[total-subjects[name]['denominator'],counts])
    for key,name in [('korean','국어'),('math','수학')]:
        add(key+'_choice',p[key+'_choice']+1,[total-subjects[name]['denominator']]+
            [participants['choice_counts'][name][label] for label in info['choice_labels'][key]])
    add('inquiry_group',p['inquiry_group'],info['inquiry_group_counts'])
    add('complete_population',complete_mask(p).astype(np.int32),[total-count,count])
    # Every candidate contributes two slot codes. Code zero is a missing inquiry slot.
    code_maps={};counts=[2*total-sum(subjects[name]['denominator'] for name in info['inquiry_names'])]
    for i,name in enumerate(info['inquiry_names']):
        values,c=subject_values(subjects[name])
        for value,weight in zip(values,c):code_maps[(i,int(value))]=len(counts);counts.append(weight)
    codes=[np.array([code_maps.get((int(i),int(v)),0) for i,v in zip(p[key+'_subject'],p[key])],dtype=np.int32)
           for key in ('q1','q2')]
    add('inquiry_subject_score_occurrences',codes,counts)
    return constraints


def reference_context(pack,reference):
    require(isinstance(reference,dict) and
        (reference['exam_id'],reference['pack_version'],reference['academic_year'],reference['population_id'],
         reference['metric_id'],reference['tie_policy'])==
        (pack.exam_id,pack.pack_version,pack.academic_year,POPULATION_ID,METRIC_ID,'include_equal'),
        'reference_context_mismatch')
    require(reference['review_status'] in ('source_verified','internal_review','reference') and bool(reference['source_id']),
            'reference_review_missing')
    points={}
    for row in reference['points']:
        require(isinstance(row['point_id'],str) and row['point_id'] not in points and type(row['score']) is int,'invalid_reference_points')
        value=finite(row['top_fraction']);require(0<=value<=1,'invalid_reference_points')
        points[row['point_id']]=row
    return points


def soft_features(pack,p,reference,policy,complete_count):
    n=len(p['prior']);columns=[];names=[];strengths=[]
    config=policy['calibration']
    if not config['point_ids']:return np.empty((n,0)),np.empty(0),names
    require(reference is not None,'calibration_reference_missing')
    points=reference_context(pack,reference)
    require(config['source_id']==reference['source_id'],'calibration_reference_mismatch')
    require(len(config['point_ids'])==len(set(config['point_ids'])) and set(config['point_ids'])<=set(points),'calibration_point_missing')
    require(not set(config['point_ids'])&set(policy['validation']['withheld_point_ids']),'reference_train_validation_overlap')
    valid=complete_mask(p);totals=p['korean'].astype(float)+p['math']+p['q1']+p['q2']
    fraction=finite(complete_count)/pack._data['participants']['total']
    tail_strength=finite(config['tail_strength']);mean_strength=finite(config['mean_strength'])
    require(tail_strength>0 and mean_strength>=0,'invalid_soft_reference_strength')
    for pid in config['point_ids']:
        row=points[pid];tail=finite(row['top_fraction'])
        columns.append(valid.astype(float)*((totals>=row['score']).astype(float)-tail)/fraction)
        names.append('reference_tail:'+pid);strengths.append(tail_strength)
        for key,desired in row.get('conditional_means',{}).items():
            require(key in ('korean','math','english','history'),'invalid_reference_moment')
            if mean_strength==0:continue
            # Missing grades never become 0 or 9; this moment declares a present-grade scope.
            same=valid&(totals==row['score'])&(p[key]>=0)
            columns.append(same*(p[key]-finite(desired))/fraction)
            names.append('reference_mean:'+pid+':'+key);strengths.append(mean_strength)
    return np.column_stack(columns),np.array(strengths),names


def constraint_errors(weights,constraints):
    result=[]
    for c in constraints:
        actual=sum(np.bincount(codes,weights=weights,minlength=len(c['target'])) for codes in c['codes'])
        require(len(actual)==len(c['target']),'invalid_estimation_constraint')
        diff=actual-c['target']
        result.append(dict(name=c['name'],max_abs_probability=float(np.max(np.abs(diff))),
            total_abs_probability=float(np.sum(np.abs(diff)))))
    return result


def fit_estimated_joint(pack,p,info,reference,policy,complete_count,progress=None):
    """공식 주변 제약과 참고 제곱오차를 가진 KL(prior)의 볼록 쌍대 문제를 최적화한다.

    방법·정확도 채택은 독립 validate_estimate가 판단한다. 수렴만으로 승인하지 않는다.
    """
    validate_candidate_profiles(pack,p,info);policy=deepcopy(policy);validate_policy_context(pack,policy)
    constraints=official_constraints(pack,p,info,complete_count)
    excluded=info.get('reference_mode','included')=='excluded'
    soft,strengths,soft_names=(np.empty((len(p['prior']),0)),np.empty(0),[]) if excluded else soft_features(pack,p,reference,policy,complete_count)
    settings=policy['optimization'];iterations=settings['max_iterations']
    require(type(iterations) is int and iterations>0,'invalid_optimization_policy')
    hard_tol=finite(settings['hard_tolerance']);grad_tol=finite(settings['gradient_tolerance'])
    require(hard_tol>0 and grad_tol>0,'invalid_optimization_policy')
    support=np.ones(len(p['prior']),dtype=bool)
    for c in constraints:
        for codes in c['codes']:support&=c['target'][codes]>0
    require(np.any(support),'empty_feasible_support')
    selected=np.flatnonzero(support);prior=np.asarray(p['prior'][support],dtype=float).copy();prior/=prior.sum()
    features=[];offset=0
    for c in constraints:
        codes=[a[support] for a in c['codes']];target=c['target']
        actual=sum(np.bincount(a,weights=prior,minlength=len(target)) for a in codes)
        require(np.all((target==0)|(actual>0)),'missing_positive_constraint_support')
        keep=np.flatnonzero(target>0)
        # A partition's constant-sum feature is redundant; inquiry slots sum to two.
        keep=keep[keep!=np.argmax(target)]
        scale=np.sqrt(np.maximum(target[keep],np.finfo(float).eps))
        features.append((codes,target,keep,scale,slice(offset,offset+len(keep))));offset+=len(keep)
    matrix=soft[support];soft_slice=slice(offset,offset+matrix.shape[1]);size=offset+matrix.shape[1]
    target_vector=np.concatenate([target[keep]/scale for _,target,keep,scale,_ in features]) if offset else np.empty(0)
    log_prior=np.log(prior);theta=np.zeros(size);pairs=[];history=[];evaluations=0
    def evaluate(t):
        nonlocal evaluations
        energy=log_prior.copy()
        for codes,target,keep,scale,sl in features:
            coefficient=np.zeros(len(target));coefficient[keep]=t[sl]/scale
            for code in codes:energy+=coefficient[code]
        if matrix.shape[1]:energy+=matrix@t[soft_slice]
        maximum=energy.max();e=np.exp(energy-maximum);normalizer=e.sum();w=e/normalizer
        objective=float(maximum+np.log(normalizer)-target_vector@t[:offset])
        gradient=np.empty(size)
        for codes,target,keep,scale,sl in features:
            actual=sum(np.bincount(code,weights=w,minlength=len(target)) for code in codes)
            gradient[sl]=(actual[keep]-target[keep])/scale
        if matrix.shape[1]:
            objective+=float(np.sum(t[soft_slice]**2/strengths)/2)
            gradient[soft_slice]=matrix.T@w+t[soft_slice]/strengths
        require(math.isfinite(objective) and np.all(np.isfinite(gradient)),'nonfinite_optimization')
        evaluations+=1
        return objective,gradient,w
    objective,gradient,w=evaluate(theta);converged=False;reason='maximum_iterations'
    for iteration in range(iterations):
        full=np.zeros(len(support));full[selected]=w
        errors=constraint_errors(full,constraints);maximum_error=max(r['max_abs_probability'] for r in errors)
        gmax=float(np.max(np.abs(gradient))) if size else 0
        if maximum_error<=hard_tol and gmax<=grad_tol:converged=True;reason=None;break
        q=gradient.copy();alphas=[]
        for a,b,rho in reversed(pairs):
            alpha=rho*(a@q);alphas.append(alpha);q-=alpha*b
        gamma=(pairs[-1][0]@pairs[-1][1])/(pairs[-1][1]@pairs[-1][1]) if pairs else 1.
        direction=-gamma*q
        for (a,b,rho),alpha in zip(pairs,reversed(alphas)):
            beta=rho*(b@direction);direction-=a*(alpha+beta)
        slope=float(gradient@direction)
        if slope>=0:direction=-gradient;slope=-float(gradient@gradient);pairs=[]
        step=1.;accepted=False
        for _ in range(40):
            trial=theta+step*direction
            newobjective,newgradient,neww=evaluate(trial)
            if newobjective<=objective+1e-4*step*slope:accepted=True;break
            step/=2
        if not accepted:reason='line_search_failed';break
        a=trial-theta;b=newgradient-gradient;ab=float(a@b)
        if ab>np.finfo(float).eps:
            pairs.append((a,b,1/ab))
            if len(pairs)>10:pairs=pairs[-10:]
        theta=trial;objective=newobjective;gradient=newgradient;w=neww
        if iteration%10==0 or iteration==iterations-1:
            item=dict(iteration=iteration,official_max_abs_probability=maximum_error,gradient_max=gmax,objective=objective,evaluations=evaluations)
            history.append(item)
            if progress:progress(deepcopy(item))
    weights=np.zeros(len(support));weights[selected]=w
    errors=constraint_errors(weights,constraints)
    if max(r['max_abs_probability'] for r in errors)<=hard_tol and (not size or np.max(np.abs(gradient))<=grad_tol):
        converged=True;reason=None
    require(np.all(np.isfinite(weights)) and np.all(weights>=0),'nonfinite_optimization')
    fit=dict(method=policy['method'],policy_version=policy['version'],policy_hash=digest(policy),candidate_hash=digest({
        key:value.tolist() for key,value in p.items()}),input_hash=info['input_hash'],proposal_hash=info['proposal_hash'],
        complete_count=str(complete_count),converged=converged,reason_code=reason,official_errors=errors,
        soft_feature_names=soft_names,training_source_id=None if excluded else policy['calibration'].get('source_id'),
        training_point_ids=[] if excluded else list(policy['calibration']['point_ids']),structural_zero_rows=int((~support).sum()),
        reference_mode='excluded' if excluded else 'included',weights_hash=digest(weights.tolist()),
        numerical_underflow_rows=int(np.sum(w==0)),history=history,status='optimized_not_validated')
    return weights,fit
