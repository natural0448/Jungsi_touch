"""Exact policy-driven forecasts; no production defaults or probability inference."""
from copy import deepcopy
from fractions import Fraction
from hashlib import sha256
import json
import re
from .application.platform_ports import PlatformError
from .university_conversion import round_exact


def digest(value):
    return sha256(json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()


def require(ok, code, status=422):
    if not ok: raise PlatformError(code,status)


def number(value):
    require(type(value) in (str,int),'forecast_number_invalid')
    try: return Fraction(value)
    except (ValueError,ZeroDivisionError): raise PlatformError('forecast_number_invalid')


def decimal(value):
    value=Fraction(value); denominator=value.denominator
    for factor in (2,5):
        while denominator%factor==0: denominator//=factor
    require(denominator==1,'forecast_nonterminating_exact_value')
    sign='-' if value<0 else ''; value=abs(value)
    whole,remainder=divmod(value.numerator,value.denominator); digits=[]
    while remainder:
        remainder*=10; digit,remainder=divmod(remainder,value.denominator); digits.append(str(digit))
    return sign+str(whole)+('.'+''.join(digits) if digits else '')


def project(rows,policy,target_year):
    require(isinstance(policy,dict) and policy.get('status')=='approved' and policy.get('version'),'forecast_policy_unapproved')
    require(type(policy.get('minimum_years')) is int and 1<=policy['minimum_years']<=3,'forecast_policy_invalid')
    require(len(rows)>=policy['minimum_years'],'comparable_history_missing')
    require(policy.get('target_year')==target_year,'forecast_target_year_mismatch')
    require(policy.get('direction') in ('higher_is_better','lower_is_better'),'forecast_direction_missing')
    require(type(policy.get('require_consecutive_years')) is bool,'forecast_continuity_policy_missing')
    if policy['require_consecutive_years']:
        require(all(b['academic_year']==a['academic_year']+1 for a,b in zip(rows,rows[1:])),'forecast_history_discontinuous')
    method=policy.get('method'); values=[number(r['comparison_value']) for r in rows]
    if method=='latest_comparable': result=values[-1]
    elif method=='weighted_mean':
        weights=policy.get('weights');require(isinstance(weights,dict),'forecast_weights_missing')
        require(set(weights)=={str(r['academic_year']) for r in rows},'forecast_weights_year_mismatch')
        weights=[number(weights.get(str(r['academic_year']))) for r in rows]
        require(all(w>0 for w in weights),'forecast_weights_invalid')
        result=sum(v*w for v,w in zip(values,weights))/sum(weights)
    elif method=='linear_trend':
        require(policy.get('trend_adopted') is True and policy.get('trend_evidence_ref'),'forecast_trend_unapproved')
        require(len(rows)>=2,'comparable_history_missing')
        xs=[Fraction(r['academic_year']) for r in rows]; mx=sum(xs)/len(xs);my=sum(values)/len(values)
        slope=sum((x-mx)*(y-my) for x,y in zip(xs,values))/sum((x-mx)**2 for x in xs)
        limit=number(policy.get('max_abs_trend_per_year'));require(limit>=0 and abs(slope)<=limit,'forecast_trend_limit_exceeded')
        result=my+slope*(target_year-mx)
    else: raise PlatformError('forecast_method_unsupported')
    bounds=policy.get('value_bounds');require(isinstance(bounds,dict),'forecast_bounds_missing')
    require(number(bounds['lower'])<=result<=number(bounds['upper']),'forecast_outside_policy_bounds')
    return result


def comparable(rows,context,metric):
    require(isinstance(rows,list),'forecast_history_invalid')
    years=set()
    for row in rows:
        year=row.get('academic_year')
        require(type(year) is int and year in (2024,2025,2026) and year not in years,'forecast_history_year_invalid');years.add(year)
        require(row.get('status')=='approved' and row.get('source_ref') and isinstance(row.get('source_hash'),str) and re.fullmatch(r'[0-9a-f]{64}',row['source_hash']),'forecast_history_unapproved')
        require(row.get('offering_lineage_id')==context['offering_lineage_id'],'forecast_offering_mismatch')
        require(row.get('metric_id')==metric['metric_id'] and row.get('metric_definition')==metric['definition'],'forecast_metric_mismatch')
        require(row.get('unit')==context['unit'] and row.get('comparison_scale_id')==context['score_scale_id'] and row.get('population_id')==context['population_id'],'forecast_comparison_mismatch')
        require(row.get('bridge_status')=='approved' and row.get('bridge_version') and isinstance(row.get('bridge_receipt_hash'),str) and re.fullmatch(r'[0-9a-f]{64}',row['bridge_receipt_hash']),'history_bridge_unapproved')
        number(row['comparison_value'])
    return sorted(rows,key=lambda r:r['academic_year'])


def generate(inputs,policy):
    require(isinstance(inputs,dict) and inputs.get('status')=='approved' and inputs.get('version'),'forecast_input_unapproved')
    require(isinstance(policy,dict) and policy.get('status')=='approved' and policy.get('version'),'forecast_policy_unapproved')
    require(type(policy.get('require_independent_approver')) is bool,'forecast_approval_policy_missing')
    context=inputs['context']
    required=('offering_id','offering_lineage_id','academic_year','exam_id','rule_version','curve_version','analysis_version','score_scale_id','population_id','unit')
    require(all(k in context and context[k] is not None for k in required) and context['academic_year']==2027,'forecast_context_invalid')
    require(policy.get('context')==context,'forecast_policy_context_mismatch')
    result=dict(context=deepcopy(context),forecast_70=dict(status='pending',reason_code='comparable_history_missing',value=None),acceptance_range=dict(status='pending',reason_code='acceptance_evidence_missing',lower=None,upper=None),category_ranges=[],issue_summaries=[],basis_summary=[],exact_values=dict(forecast_70=None,acceptance_range=None,category_ranges=[]),comparison_basis=None)
    for target,history_key in (('forecast_70','history_70'),('acceptance_range','acceptance_history')):
        spec=policy.get(target)
        if spec is None:continue
        try:
            require(isinstance(spec.get('metric'),dict),'forecast_metric_missing')
            rows=comparable(inputs.get(history_key,[]),context,spec['metric'])
            center=project(rows,spec,context['academic_year'])
            if target=='forecast_70':
                result[target]=dict(status='ready',reason_code=None,value=policy_decimal(center,spec),unit=context['unit'],definition=spec['metric']['definition'],version=policy['version'])
                result['exact_values'][target]=str(center)
            else:
                require(spec.get('range_evidence_ref') and spec.get('category_evidence_ref'),'acceptance_evidence_missing')
                low=center-number(spec['lower_width']);high=center+number(spec['upper_width'])
                require(low<high and number(spec['lower_width'])>=0 and number(spec['upper_width'])>=0,'forecast_range_invalid')
                result[target]=dict(status='ready',reason_code=None,lower=policy_decimal(low,spec),upper=policy_decimal(high,spec),unit=context['unit'],definition=spec['metric']['definition'],policy_version=policy['version'])
                ranges=[]
                for row in spec.get('category_offsets',[]):
                    require(row.get('category') in ('challenge','core','room','outside'),'forecast_category_invalid')
                    ranges.append(dict(category=row['category'],lower=str(center+number(row['lower'])),upper=str(center+number(row['upper']))))
                validate_ranges(ranges);validate_direction(ranges,spec['direction'])
                result['exact_values'][target]=dict(lower=str(low),upper=str(high))
                result['exact_values']['category_ranges']=ranges
                result['category_ranges']=[dict(category=r['category'],lower=policy_decimal(number(r['lower']),spec),upper=policy_decimal(number(r['upper']),spec)) for r in ranges]
                require(all(k in context for k in ('comparison_metric','direction','tie_policy')),'forecast_comparison_basis_missing')
                require(spec.get('comparison_metric')==context['comparison_metric'] and spec['direction']==context['direction'] and spec.get('tie_policy')==context['tie_policy'],'forecast_comparison_basis_mismatch')
                result['comparison_basis']=dict(metric=context['comparison_metric'],unit=context['unit'],score_scale_id=context['score_scale_id'],population_id=context['population_id'],direction=context['direction'],tie_policy=context['tie_policy'])
            result['basis_summary'].append(dict(target=target,method=spec['method'],policy_version=policy['version'],source_refs=[r['source_ref'] for r in rows]))
        except (KeyError,TypeError):raise PlatformError('forecast_policy_invalid')
        except PlatformError as error:
            result[target].update(status='pending',reason_code=error.code)
            if target=='forecast_70':result[target]['value']=None
            else:
                result[target].update(lower=None,upper=None);result['category_ranges']=[];result['exact_values'][target]=None;result['exact_values']['category_ranges']=[];result['comparison_basis']=None
    for issue in inputs.get('issues',[]):
        require(issue.get('issue_id') and issue.get('explanation') and issue.get('evidence_ref'),'forecast_issue_invalid')
        require(issue.get('effect') is None,'forecast_numeric_issue_policy_unsupported')
        result['issue_summaries'].append({k:deepcopy(issue.get(k)) for k in ('issue_id','explanation','evidence_ref','effect')})
    return result


def validate_ranges(rows):
    require(isinstance(rows,list) and bool(rows),'forecast_category_ranges_missing')
    require(len({r.get('category') for r in rows})==len(rows),'forecast_category_duplicate')
    sorted_rows=sorted(rows,key=lambda r:number(r['lower']))
    for index,row in enumerate(sorted_rows):
        require(row.get('category') in ('challenge','core','room','outside') and number(row['lower'])<number(row['upper']),'forecast_range_invalid')
        if index:require(number(sorted_rows[index-1]['upper'])<=number(row['lower']),'forecast_ranges_overlap')
    return True


def validate_result(result):
    checks=[]
    forecast=result['forecast_70']; acceptance=result['acceptance_range']
    exact=result.get('exact_values');require(isinstance(exact,dict),'forecast_exact_values_missing',409)
    if forecast['status']=='ready':number(exact['forecast_70']);checks.append('forecast_70_exact')
    if acceptance['status']=='ready':
        bounds=exact['acceptance_range'];require(isinstance(bounds,dict),'forecast_exact_values_missing',409)
        require(number(bounds['lower'])<number(bounds['upper']),'forecast_range_invalid')
        validate_ranges(exact['category_ranges']);checks.append('acceptance_ranges_valid')
    require(bool(checks),'forecast_outputs_pending',409)
    return dict(status='passed',checks=checks,result_hash=digest(result))


def validate_policy_result(result,policy):
    receipt=validate_result(result)
    for target in ('forecast_70','acceptance_range'):
        value=result[target]
        if value['status']!='ready':continue
        spec=policy.get(target);require(isinstance(spec,dict),'forecast_policy_invalid')
        lower=number(spec['value_bounds']['lower']);upper=number(spec['value_bounds']['upper'])
        exact=result['exact_values'][target]
        for field in ('value',) if target=='forecast_70' else ('lower','upper'):
            precise=number(exact if target=='forecast_70' else exact[field])
            require(lower<=precise<=upper,'forecast_outside_policy_bounds')
            require(value[field]==policy_decimal(precise,spec),'forecast_display_value_mismatch')
        require(value.get('unit')==result['context']['unit'],'forecast_adjustment_unit_mismatch')
    if result['acceptance_range']['status']=='ready':
        rows=result['exact_values']['category_ranges'];spec=policy['acceptance_range']
        validate_direction(rows,spec['direction'])
        require(result['comparison_basis']==dict(metric=spec.get('comparison_metric'),unit=result['context']['unit'],score_scale_id=result['context']['score_scale_id'],population_id=result['context']['population_id'],direction=spec['direction'],tie_policy=spec.get('tie_policy')),'forecast_comparison_basis_mismatch')
        expected=[dict(category=r['category'],lower=policy_decimal(number(r['lower']),spec),upper=policy_decimal(number(r['upper']),spec)) for r in rows]
        require(result['category_ranges']==expected,'forecast_display_value_mismatch')
        cores=[r for r in rows if r['category']=='core'];bounds=result['exact_values']['acceptance_range']
        require(len(cores)==1 and number(cores[0]['lower'])==number(bounds['lower']) and number(cores[0]['upper'])==number(bounds['upper']),'forecast_core_range_mismatch')
    return receipt


def policy_decimal(value,policy):
    places=policy.get('display_places');mode=policy.get('rounding_mode')
    require(type(places) is int and 0<=places<=8 and mode in ('half_up','half_even','floor','ceil','truncate'),'forecast_precision_policy_missing')
    return decimal(round_exact(value,places,mode))


def validate_direction(rows,direction):
    require(direction in ('higher_is_better','lower_is_better'),'forecast_direction_missing')
    order={'challenge':0,'core':1,'room':2}
    ranked=[order[r['category']] for r in sorted(rows,key=lambda r:number(r['lower'])) if r['category'] in order]
    require(ranked==sorted(ranked,reverse=direction=='lower_is_better'),'forecast_category_direction_mismatch')
