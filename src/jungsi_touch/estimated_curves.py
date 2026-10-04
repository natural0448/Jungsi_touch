"""추정 가중 프로필을 기존 정확 총점/대학 환산 분포로 집계한다."""
from collections import defaultdict
from copy import deepcopy
from decimal import Decimal, localcontext
from fractions import Fraction
import itertools
import numpy as np

from .estimated_profiles import require, pack_data, validate_candidate_profiles, complete_mask, digest
from .percentile import DistributionMetadata, ScoreFrequency, TotalScoreDistribution, POPULATION_ID, METRIC_ID
from .exam_pack import ExamTotalModel, subject_key
from .university_conversion import ConversionRule
from .admission_result_percentile import UniversityScoreDistribution, METRIC


def decimal_string(value):
    """유한 소수로 표현할 수 없는 분수를 표시 반올림으로 바꾸지 않는다."""
    require(isinstance(value,Fraction),'exact_serialization_required')
    denominator=value.denominator;a=b=0
    while denominator%2==0:denominator//=2;a+=1
    while denominator%5==0:denominator//=5;b+=1
    require(denominator==1,'nonterminating_exact_value')
    places=max(a,b);integer=abs(value.numerator)*2**(places-a)*5**(places-b)
    text=str(integer).zfill(places+1)
    if places:text=text[:-places]+'.'+text[-places:];text=text.rstrip('0').rstrip('.')
    return ('-' if value<0 else '')+text


def serialize_cohort_weights(weights,mask,expected_total):
    """내부 최적화 float를 양수 유한 소수로 바꾸고 최대 셀에서 직렬화 잔차를 보정한다."""
    require(type(expected_total) in (int,str,Fraction) and not isinstance(expected_total,bool),'invalid_population_scale')
    count=expected_total if isinstance(expected_total,Fraction) else Fraction(str(expected_total))
    require(count>0,'invalid_population_scale');decimal_string(count)
    array=np.asarray(weights,dtype=float)
    require(array.shape==mask.shape and np.all(np.isfinite(array)) and np.all(array>=0),'invalid_fitted_weights')
    selected=np.flatnonzero(mask&(array>0));require(len(selected)>0,'empty_complete_population')
    with localcontext() as context:
        context.prec=60
        source=[Decimal(str(float(array[i]))) for i in selected];den=sum(source)
        target=Decimal(decimal_string(count))
        exact=[Fraction(v*target/den) for v in source]
    largest=max(range(len(exact)),key=lambda i:exact[i])
    residual=count-sum(exact,Fraction(0));exact[largest]+=residual
    require(all(v>0 for v in exact),'serialization_weight_underflow')
    result=[Fraction(0)]*len(array)
    for index,value in zip(selected,exact):result[int(index)]=value
    require(sum(result,Fraction(0))==count,'serialization_population_mismatch')
    return tuple(result)


def official_total_domain(pack,info):
    d=pack_data(pack);ranges={}
    for name,s in d['subjects'].items():
        if s['assessment']=='standard_score':
            values=[row['standard_score'] for row in s['frequencies']];ranges[name]=(min(values),max(values))
    allowed=[];names=info['inquiry_names'];cats=info['inquiry_categories'];counts=info['inquiry_group_counts']
    common=info['vocational_common_index']
    for i,j in itertools.combinations(range(len(names)),2):
        category=7 if cats[i]==cats[j]=='vocational' else 5 if cats[i]!=cats[j] else 2 if cats[i]=='social' else 4
        legal=(cats[i] in ('social','science') and cats[j] in ('social','science')) or (category==7 and common in (i,j))
        if legal and counts[category]>0:allowed.append((ranges[names[i]][0]+ranges[names[j]][0],ranges[names[i]][1]+ranges[names[j]][1]))
    require(bool(allowed),'complete_population_support_missing')
    return ranges['국어'][0]+ranges['수학'][0]+min(v[0] for v in allowed),ranges['국어'][1]+ranges['수학'][1]+max(v[1] for v in allowed)


def build_total_model(pack,p,weights,info,validation,metadata):
    validate_candidate_profiles(pack,p,info)
    verify_build_context(p,weights,info,validation)
    count=Fraction(validation['complete_count'])
    target=pack._data['participants']['target_population']
    require(target['count_lower_bound']<=count<=target['count_upper_bound'] and
            (target['count'] is None or count==target['count']),'model_population_mismatch')
    exact=serialize_cohort_weights(weights,complete_mask(p),count);bins=defaultdict(Fraction)
    for i,weight in enumerate(exact):
        if weight:bins[int(p['korean'][i])+int(p['math'][i])+int(p['q1'][i])+int(p['q2'][i])]+=weight
    minimum,maximum=official_total_domain(pack,info)
    m=DistributionMetadata(distribution_id=metadata['distribution_id'],academic_year=pack.academic_year,
        source_name=metadata['source_name'],source_date=metadata['source_date'],metric_id=METRIC_ID,population_id=POPULATION_ID,
        kind='estimated_weights',status='reference',population_verified=validation['status']=='self_validated_estimate',
        complete=True,score_min=minimum,score_max=maximum,expected_total_weight=count)
    model=ExamTotalModel(pack.exam_id,pack.pack_version,TotalScoreDistribution(m,[ScoreFrequency(k,v) for k,v in sorted(bins.items())]))
    raw=dict(format='jungsi.exam-total-model/v1',exam_id=pack.exam_id,pack_version=pack.pack_version,basis='exam_population',
        distribution=dict(format='total_score_frequency/v1',metadata={
            k:decimal_string(v) if isinstance(v,Fraction) else v for k,v in vars(m).items()},
            rows=[dict(total_score=k,weight=decimal_string(v)) for k,v in sorted(bins.items())]))
    # Round-trip through the existing strict reader, not just json saving.
    import json
    roundtrip=ExamTotalModel.from_json(json.dumps(raw,ensure_ascii=False))
    require(roundtrip.distribution.frequency_rows()==model.distribution.frequency_rows(),'total_serialization_mismatch')
    return raw,exact


def verify_build_context(p,weights,info,validation):
    require(validation['status'] in ('self_validated_estimate','research_only') and
        validation['input_hash']==info['input_hash'] and validation['proposal_hash']==info['proposal_hash'] and
        validation['candidate_hash']==digest({k:x.tolist() for k,x in p.items()}) and
        validation['weights_hash']==digest(np.asarray(weights,dtype=float).tolist()),'estimate_provenance_mismatch')


def candidate_rule_values(pack,p,info,index):
    values={}
    for key,area,name in [('korean','korean','국어'),('math','math','수학'),
                          ('q1','inquiry1',info['inquiry_names'][int(p['q1_subject'][index])]),
                          ('q2','inquiry2',info['inquiry_names'][int(p['q2_subject'][index])])]:
        score=int(p[key][index]);reported=pack.reported_score(name,score)
        values.update({area+'_standard_score':score,area+'_percentile':reported.get('percentile'),area+'_grade':reported['grade']})
    for key in ('korean','math'):values[key+'_choice']=subject_key(info['choice_labels'][key][int(p[key+'_choice'][index])])
    values.update(inquiry1_subject=info['inquiry_names'][int(p['q1_subject'][index])],
        inquiry2_subject=info['inquiry_names'][int(p['q2_subject'][index])],
        english_grade=int(p['english'][index]) if p['english'][index]>=0 else None,
        korean_history_grade=int(p['history'][index]) if p['history'][index]>=0 else None)
    return values


def build_university_distribution(pack,p,weights,info,rule,validation,metadata,*,mock_compatibility=None):
    """필수 입력이 없는 후보의 사유·가중치를 명부에 남긴다. 계산 오류는 조용히 버리지 않는다."""
    validate_candidate_profiles(pack,p,info)
    verify_build_context(p,weights,info,validation)
    require(isinstance(rule,ConversionRule) and rule.data['review_status']=='calculation_verified' and
        rule.data['data_kind']=='official_rule' and all(t['status']=='verified' for t in rule.data['tables'].values()),
        'university_rule_unverified')
    require(rule.data['academic_year']==pack.academic_year and rule.data['score_scope']=='csat_component','rule_estimate_context_mismatch')
    if pack._data['exam']['exam_type']=='csat':
        require(rule.data.get('exam_id')==pack.exam_id and rule.data.get('source_pack_version')==pack.pack_version,
                'rule_estimate_context_mismatch')
    else:
        expected=dict(source_exam_id=pack.exam_id,source_pack_version=pack.pack_version,
            source_exam_type=pack._data['exam']['exam_type'],rule_exam_id=rule.data.get('exam_id'),rule_pack_version=rule.data.get('source_pack_version'))
        require(isinstance(mock_compatibility,dict) and mock_compatibility.get('status')=='approved' and
                all(mock_compatibility.get(k)==v for k,v in expected.items()),'mock_compatibility_not_approved')
    require(rule.data.get('score_scale_id') and rule.data.get('bonus_treatment') in ('included','excluded'),'university_scale_missing')
    count=Fraction(validation['complete_count']);exact=serialize_cohort_weights(weights,complete_mask(p),count)
    bins=defaultdict(Fraction);excluded=defaultdict(Fraction);kept=Fraction(0);required=sorted(rule.data['inputs']);profiles=[]
    for i,weight in enumerate(exact):
        if not weight:continue
        values=candidate_rule_values(pack,p,info,i)
        missing=tuple(k for k in required if values.get(k) is None)
        if missing:excluded[missing]+=weight;continue
        profile=dict(academic_year=pack.academic_year,exam_id=pack.exam_id,profile_version=info['proposal_version'],
            score_basis='synthetic',values=values,data_kind='estimated_profile')
        # research=True only permits synthetic candidate provenance. The rule/tables
        # and source binding were checked above and are never promoted here.
        result=rule.calculate(profile,research=True)
        score=Fraction(**result['exact_score']);decimal_string(score)
        bins[score]+=weight;kept+=weight
        profiles.append(dict(index=i,weight=decimal_string(weight),exact_score=decimal_string(score)))
    require(bool(bins),'university_population_empty')
    subset=kept!=count
    population=metadata['comparison_population_id'] if subset else POPULATION_ID
    require(not subset or population!=POPULATION_ID,'comparison_population_id_required')
    scope='required_rule_inputs_present' if subset else 'whole_complete'
    ledger=dict(format='jungsi.university-comparison-population/v1',status='research',scope=scope,
        population_id=population,base_population_id=POPULATION_ID,academic_year=pack.academic_year,exam_id=pack.exam_id,
        source_pack_version=pack.pack_version,rule_version=rule.data['rule_version'],curve_version=metadata['curve_version'],
        required_input_fields=required,validation_receipt_version=metadata['validation_receipt_version'],
        total_complete_weight=decimal_string(count),retained_weight=decimal_string(kept),excluded_weight=decimal_string(count-kept),
        exclusions=[dict(missing_input_fields=list(k),weight=decimal_string(v)) for k,v in sorted(excluded.items())])
    m=dict(academic_year=pack.academic_year,exam_id=pack.exam_id,source_pack_version=pack.pack_version,
        curve_id=metadata['curve_id'],curve_version=metadata['curve_version'],rule_id=rule.data['rule_id'],rule_version=rule.data['rule_version'],
        rule_review_status=rule.data['review_status'],score_scope='csat_component',score_metric=METRIC,
        score_scale_id=rule.data['score_scale_id'],bonus_treatment=rule.data['bonus_treatment'],population_id=population,
        population_definition=metadata['population_definition'],source_model_id=metadata['source_model_id'],
        source_model_version=metadata['source_model_version'],kind='estimated_weights',status='research',
        complete=True,population_verified=validation['status']=='self_validated_estimate',
        score_min=decimal_string(min(bins)),score_max=decimal_string(max(bins)),expected_total_weight=decimal_string(kept))
    raw=dict(format='jungsi.university-score-distribution/v1',metadata=m,source_refs=deepcopy(metadata['source_refs']),
        frequencies=[dict(converted_score=decimal_string(k),weight=decimal_string(v)) for k,v in sorted(bins.items())])
    curve=UniversityScoreDistribution(raw)
    require(curve.total==kept and kept+sum(excluded.values(),Fraction(0))==count,'university_population_weight_mismatch')
    return raw,ledger,profiles
