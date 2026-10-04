"""추정 공동 성적의 후보 지지점 생성. 모든 모형 계수는 비공개 입력이다."""
from copy import deepcopy
import hashlib
import itertools
import json
import math
import numpy as np

from .exam_pack import ExamPack
from .percentile import PercentileError

GROUPS=('none','social_one','social_two','science_one','science_two','mixed_two','vocational_one','vocational_two')


class EstimationError(PercentileError):
    pass


def require(ok,code):
    if not ok:raise EstimationError(code,'자체 추정 입력·모집단·검증 조건을 확인하세요.')


def finite(value):
    require(not isinstance(value,(bool,np.bool_)),'invalid_estimation_number')
    try:result=float(value)
    except (TypeError,ValueError,OverflowError):raise EstimationError('invalid_estimation_number','유한 수치가 필요합니다.')
    require(math.isfinite(result),'invalid_estimation_number')
    return result


def digest(value):
    return hashlib.sha256(json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'),
                                    default=str,allow_nan=False).encode('utf-8')).hexdigest()


def pack_data(pack):
    require(isinstance(pack,ExamPack),'invalid_estimation_pack')
    return deepcopy(pack._data)


def subject_values(subject):
    if subject['assessment']=='standard_score':
        rows=sorted(subject['frequencies'],key=lambda r:r['standard_score'])
        return np.array([r['standard_score'] for r in rows]),np.array([r['count'] for r in rows],dtype=float)
    rows=sorted(subject['grades'],key=lambda r:-r['grade'])
    return np.array([r['grade'] for r in rows]),np.array([r['count'] for r in rows],dtype=float)


def inverse_discrete(u,values,weights):
    weights=np.asarray(weights,dtype=float)
    require(np.all(np.isfinite(weights)) and np.all(weights>=0) and weights.sum()>0,'invalid_proposal_distribution')
    cdf=np.cumsum(weights/weights.sum());cdf[-1]=1
    return np.asarray(values)[np.minimum(np.searchsorted(cdf,u,side='right'),len(values)-1)]


def normal_cdf(z):
    a=np.asarray(z)
    return np.fromiter((.5*math.erfc(-float(v)/math.sqrt(2)) for v in a.ravel()),dtype=float,count=a.size).reshape(a.shape)


def input_structure(pack,common_subject=None):
    d=pack_data(pack);subjects=d['subjects'];p=d['participants'];g=p['inquiry_groups']
    names=sorted(k for k,s in subjects.items() if s['category'] in ('social','science','vocational'))
    cats=[subjects[k]['category'] for k in names]
    slots={c:sum(subjects[k]['denominator'] for k in names if subjects[k]['category']==c) for c in ('social','science','vocational')}
    singles={c:2*g[key]+(g['mixed_social_science'] if c!='vocational' else 0)-slots[c]
             for c,key in [('social','social_only'),('science','science_only'),('vocational','vocational')]}
    counts=[p['total']-p['inquiry_total'],singles['social'],g['social_only']-singles['social'],
            singles['science'],g['science_only']-singles['science'],g['mixed_social_science'],
            singles['vocational'],g['vocational']-singles['vocational']]
    require(min(counts)>=0 and sum(counts)==p['total'],'inquiry_population_inconsistent')
    common=names.index(common_subject) if common_subject in names else None
    require(not counts[7] or (common is not None and cats[common]=='vocational'),'vocational_common_subject_required')
    require(not counts[7] or subjects[names[common]]['denominator']==counts[7],'vocational_common_population_mismatch')
    return dict(exam_id=pack.exam_id,pack_version=pack.pack_version,academic_year=pack.academic_year,
        input_hash=digest(d),inquiry_names=names,inquiry_categories=cats,inquiry_group_counts=counts,
        group_labels=list(GROUPS),vocational_common_index=common,
        choice_labels={area:sorted(p['choice_counts'][subject]) for area,subject in [('korean','국어'),('math','수학')]})


def generate_candidate_profiles(pack,scenario):
    """조건부 인자 proposal과 양수 주변 셀의 후보를 생성한다.

    국수 선택·과목 선택과 능력의 관계는 입력한 모형 가정이며 관측 사실이 아니다.
    미응시는 -1, 실제 0점은 0으로 보존한다. 반환 배열은 서버 내부 전용이다.
    """
    d=pack_data(pack);s=deepcopy(scenario);p=d['participants'];subjects=d['subjects'];proposal=s['proposal']
    require((s['exam_id'],s['pack_version'],s['academic_year'])==(pack.exam_id,pack.pack_version,pack.academic_year),
            'estimation_context_mismatch')
    require(type(s['n']) is int and s['n']>0 and type(s['seed']) is int and s['seed']>=0,'invalid_proposal_size_or_seed')
    require(isinstance(s['version'],str) and bool(s['version']) and bool(s.get('assumptions')),'proposal_assumptions_required')
    info=input_structure(pack,proposal.get('vocational_common_subject'));names=info['inquiry_names'];cats=info['inquiry_categories']
    require(subjects['한국사']['denominator']==p['total'],'history_population_inconsistent')
    rng=np.random.default_rng(s['seed']);n=s['n']
    mixture=proposal['latent_mixture'];mw=np.array([finite(x['weight']) for x in mixture]);means=np.array([finite(x['mean']) for x in mixture])
    require(len(mixture)>0 and np.all(mw>0),'invalid_proposal_mixture');mw/=mw.sum()
    latent=rng.normal(size=n)+means[rng.choice(len(mw),n,p=mw)]
    # Importance weights undo deliberate tail oversampling to a unit normal prior.
    log_terms=np.log(mw)[None,:]+latent[:,None]*means[None,:]-means[None,:]**2/2
    maximum=log_terms.max(axis=1)
    log_ratio=-(maximum+np.log(np.exp(log_terms-maximum[:,None]).sum(axis=1)))
    prior=np.exp(log_ratio-log_ratio.max());prior/=prior.sum()
    loadings={k:finite(v) for k,v in proposal['shared_loadings'].items()}
    qload=finite(proposal['inquiry_loading']);qdomain=rng.normal(size=n)
    def factor(key):
        a=loadings[key];b=qload if key in ('q1','q2') else 0
        require(a*a+b*b<1,'invalid_proposal_loading')
        return a*latent+b*qdomain+math.sqrt(1-a*a-b*b)*rng.normal(size=n)
    out={}
    for key,name in [('korean','국어'),('math','수학'),('english','영어'),('history','한국사')]:
        values,counts=subject_values(subjects[name]);out[key]=inverse_discrete(normal_cdf(factor(key)),values,counts).astype(np.int32)
    m=finite(proposal['missing_loading']);require(abs(m)<1,'invalid_proposal_loading')
    availability=m*latent+math.sqrt(1-m*m)*rng.normal(size=n)
    def availability_uniform(key):
        a=finite(proposal['availability_loadings'][key]);require(abs(a)<1,'invalid_proposal_loading')
        return normal_cdf(a*availability+math.sqrt(1-a*a)*rng.normal(size=n))
    for key,name in [('korean','국어'),('math','수학'),('english','영어')]:
        out[key][availability_uniform(key)<1-subjects[name]['denominator']/p['total']]=-1
    out['inquiry_group']=inverse_discrete(availability_uniform('inquiry_group'),np.arange(len(GROUPS)),info['inquiry_group_counts']).astype(np.int32)
    strength=finite(proposal['choice_strength']);affinity=proposal['choice_affinity']
    def choose(ids,weights,indices,labels):
        require(len(ids)>0,'inquiry_choice_support_missing')
        prob=np.asarray(weights,dtype=float);require(np.all(prob>=0) and prob.sum()>0,'inquiry_choice_support_missing');prob/=prob.sum()
        slopes=np.array([finite(affinity[label]) for label in labels])
        u=np.clip(rng.random((len(indices),len(ids))),np.finfo(float).eps,1-np.finfo(float).eps)
        scores=np.log(np.maximum(prob,np.finfo(float).tiny))[None,:]-np.log(-np.log(u))+strength*latent[indices,None]*slopes[None,:]
        scores[:,prob==0]=-np.inf
        return np.asarray(ids)[np.argsort(scores,axis=1)]
    q1=np.full(n,-1,dtype=np.int32);q2=q1.copy();common=info['vocational_common_index']
    for category,groups in [('social',(1,2)),('science',(3,4)),('vocational',(6,7))]:
        for group in groups:
            ix=np.flatnonzero(out['inquiry_group']==group)
            if not len(ix):continue
            ids=[i for i,c in enumerate(cats) if c==category and (category!='vocational' or i!=common)]
            rank=choose(ids,[subjects[names[i]]['denominator'] for i in ids],ix,[names[i] for i in ids]);q1[ix]=rank[:,-1]
            if group in (2,4):
                require(len(ids)>=2,'inquiry_pair_support_missing');q2[ix]=rank[:,-2]
            if group==7:q2[ix]=q1[ix];q1[ix]=common
    ix=np.flatnonzero(out['inquiry_group']==5)
    for category,key in [('social',q1),('science',q2)]:
        if not len(ix):continue
        ids=[i for i,c in enumerate(cats) if c==category]
        key[ix]=choose(ids,[subjects[names[i]]['denominator'] for i in ids],ix,[names[i] for i in ids])[:,-1]
    out['q1_subject']=q1;out['q2_subject']=q2
    for key,choices in [('q1',q1),('q2',q2)]:
        u=normal_cdf(factor(key));out[key]=np.full(n,-1,dtype=np.int32)
        for i,name in enumerate(names):
            ix=np.flatnonzero(choices==i);values,counts=subject_values(subjects[name])
            out[key][ix]=inverse_discrete(u[ix],values,counts)
    for key,name in [('korean','국어'),('math','수학')]:
        labels=info['choice_labels'][key];ix=np.arange(n)
        out[key+'_choice']=choose(range(len(labels)),[p['choice_counts'][name][x] for x in labels],ix,labels)[:,-1].astype(np.int32)
        out[key+'_choice'][out[key]<0]=-1
    # Explicit proposal support augmentation; never presented as observed people.
    extra=[];reps=s['support_repetitions'];mass=finite(s['support_prior_mass'])
    require(type(reps) is int and reps>0 and 0<mass<1,'invalid_support_policy')
    pairs=[(i,j) for i,j in itertools.combinations(range(len(names)),2)
           if (cats[i] in ('social','science') and cats[j] in ('social','science')) or
              (cats[i]==cats[j]=='vocational' and common in (i,j))]
    require(bool(pairs),'inquiry_pair_support_missing')
    def row(group=2):
        # Construct rather than assume a rare group appeared in the Monte Carlo draw.
        r={k:int(v[int(rng.integers(n))]) for k,v in out.items()}
        for key,name in [('korean','국어'),('math','수학'),('english','영어'),('history','한국사')]:
            vv,cc=subject_values(subjects[name]);r[key]=int(inverse_discrete(rng.random(),vv,cc))
        for key,name in [('korean','국어'),('math','수학')]:
            counts=np.array([p['choice_counts'][name][v] for v in info['choice_labels'][key]],dtype=float)
            r[key+'_choice']=int(rng.choice(len(counts),p=counts/counts.sum()))
        if group==0:a=b=None
        elif group in (1,3,6):a=int(rng.choice([i for i,c in enumerate(cats) if c=={1:'social',3:'science',6:'vocational'}[group] and (group!=6 or i!=common)]));b=None
        else:
            available=[(i,j) for i,j in pairs if
                (group==2 and cats[i]==cats[j]=='social') or (group==4 and cats[i]==cats[j]=='science') or
                (group==5 and cats[i]!=cats[j]) or (group==7 and cats[i]==cats[j]=='vocational')]
            require(bool(available),'inquiry_pair_support_missing');a,b=available[int(rng.integers(len(available)))]
            if group==7 and b==common:a,b=b,a
        r['inquiry_group']=group
        for key,i in [('q1',a),('q2',b)]:
            r[key+'_subject']=-1 if i is None else i
            if i is None:r[key]=-1
            else:
                vv,cc=subject_values(subjects[names[i]]);r[key]=int(inverse_discrete(rng.random(),vv,cc))
        return r
    positive=[i for i,c in enumerate(info['inquiry_group_counts']) if c>0]
    complete_group=next((g for g in positive if g in (2,4,5,7)),None)
    require(complete_group is not None,'complete_population_support_missing')
    for group in positive:
        for _ in range(reps):extra.append(row(group))
    for key,name in [('korean','국어'),('math','수학'),('english','영어'),('history','한국사')]:
        vv,cc=subject_values(subjects[name])
        for value,count in zip(vv,cc):
            if count>0:
                for _ in range(reps):r=row(complete_group);r[key]=int(value);extra.append(r)
        if key!='history' and subjects[name]['denominator']<p['total']:
            r=row(complete_group);r[key]=-1
            if key in ('korean','math'):r[key+'_choice']=-1
            extra.append(r)
    for key in ('korean','math'):
        for index,label in enumerate(info['choice_labels'][key]):
            if p['choice_counts']['국어' if key=='korean' else '수학'][label]>0:
                r=row(complete_group);r[key+'_choice']=index;extra.append(r)
    for i,name in enumerate(names):
        category=cats[i];group={'social':2,'science':4,'vocational':7}[category]
        if info['inquiry_group_counts'][group]==0:
            group={'social':1,'science':3,'vocational':6}[category]
        if info['inquiry_group_counts'][group]==0 and category in ('social','science'):
            group=5
        vv,cc=subject_values(subjects[name])
        for value,count in zip(vv,cc):
            if count<=0:continue
            for _ in range(reps):
                r=row(group)
                key='q2' if (group==7 and i!=common) or (group==5 and category=='science') else 'q1'
                if group in (2,4) and r['q2_subject']==i:r['q2_subject']=r['q1_subject'];r['q2']=r['q1']
                r[key+'_subject']=i;r[key]=int(value);extra.append(r)
    for key in out:out[key]=np.concatenate([out[key],np.array([r[key] for r in extra],dtype=np.int32)])
    out['prior']=np.r_[prior*(1-mass),np.full(len(extra),mass/len(extra))]
    out['prior']/=out['prior'].sum()
    require(s.get('reference_mode','included') in ('included','excluded'),'invalid_reference_mode')
    info.update(proposal_version=s['version'],proposal_hash=digest(s),seed=s['seed'],assumptions=deepcopy(s['assumptions']),
        base_proposal_rows=n,support_augmentation_rows=len(extra),proposal_kind='dependent_factor_importance_mixture',
        data_kind='estimated_weights',coefficients_are_observations=False,reference_mode=s.get('reference_mode','included'))
    validate_candidate_profiles(pack,out,info)
    return out,info


def complete_mask(p):
    return (p['korean']>=0)&(p['math']>=0)&(p['q1']>=0)&(p['q2']>=0)


def validate_candidate_profiles(pack,p,info):
    d=pack_data(pack)
    require((info['exam_id'],info['pack_version'],info['academic_year'],info['input_hash'])==
            (pack.exam_id,pack.pack_version,pack.academic_year,digest(d)),'candidate_context_mismatch')
    fields=('korean','math','q1','q2','q1_subject','q2_subject','english','history','korean_choice','math_choice','inquiry_group')
    n=len(p['prior']);require(n>0,'empty_candidate_pool')
    require(isinstance(p['prior'],np.ndarray) and p['prior'].shape==(n,), 'invalid_candidate_weights')
    require(np.all(np.isfinite(p['prior'])) and np.all(p['prior']>0),'invalid_candidate_weights')
    for key in fields:
        require(isinstance(p[key],np.ndarray) and p[key].shape==(n,) and p[key].dtype.kind in 'iu','invalid_candidate_columns')
        require(np.all(p[key]>=-1),'invalid_candidate_missing_value')
    for key,name in [('korean','국어'),('math','수학'),('english','영어'),('history','한국사')]:
        vv,_=subject_values(d['subjects'][name]);require(np.all(np.isin(p[key],np.r_[-1,vv])),'unobserved_candidate_score')
    require(np.all(p['history']>=0),'history_population_inconsistent')
    names=info['inquiry_names'];cats=info['inquiry_categories']
    common=info['vocational_common_index']
    require(common is None or (type(common) is int and 0<=common<len(names)),'invalid_candidate_vocational_pair')
    derived=input_structure(pack,names[common] if common is not None else None)
    require(info['inquiry_group_counts']==derived['inquiry_group_counts'] and
        info['vocational_common_index']==derived['vocational_common_index'],'candidate_inquiry_population_mismatch')
    require(names==sorted(k for k,s in d['subjects'].items() if s['category'] in ('social','science','vocational')) and
            cats==[d['subjects'][k]['category'] for k in names],'candidate_subject_context_mismatch')
    for key in ('q1','q2'):
        choices=p[key+'_subject']
        require(np.all((choices>=-1)&(choices<len(names))) and np.array_equal(choices<0,p[key]<0),'invalid_candidate_inquiry')
        for i,name in enumerate(names):
            vv,_=subject_values(d['subjects'][name]);require(np.all(np.isin(p[key][choices==i],vv)),'unobserved_candidate_score')
    require(np.all((p['q1_subject']!=p['q2_subject'])|(p['q2_subject']<0)) and
            np.all((p['q2_subject']<0)|(p['q1_subject']>=0)),'duplicate_or_invalid_candidate_inquiry')
    for key in ('korean','math'):
        labels=info['choice_labels'][key]
        require(labels==sorted(d['participants']['choice_counts']['국어' if key=='korean' else '수학']),'candidate_choice_context_mismatch')
        require(np.array_equal(p[key]<0,p[key+'_choice']<0) and np.all(p[key+'_choice']<len(labels)),'invalid_candidate_choice')
        counts=np.array([d['participants']['choice_counts']['국어' if key=='korean' else '수학'][v] for v in labels])
        present=p[key]>=0
        require(np.all(counts[p[key+'_choice'][present]]>0),'unobserved_candidate_choice')
    for j in range(n):
        a=int(p['q1_subject'][j]);b=int(p['q2_subject'][j]);actual=0
        if a>=0:
            c=cats[a];actual={'social':1,'science':3,'vocational':6}[c]
            if b<0 and c=='vocational':require(a!=info['vocational_common_index'],'invalid_candidate_vocational_pair')
            if b>=0:
                require(('vocational' not in (c,cats[b])) or c==cats[b]=='vocational','invalid_candidate_inquiry_domain')
                actual=7 if c=='vocational' else 5 if c!=cats[b] else 2 if c=='social' else 4
                if actual==7:require(info['vocational_common_index'] in (a,b),'invalid_candidate_vocational_pair')
        require(actual==p['inquiry_group'][j] and info['inquiry_group_counts'][actual]>0,'invalid_candidate_inquiry_group')
    return True
