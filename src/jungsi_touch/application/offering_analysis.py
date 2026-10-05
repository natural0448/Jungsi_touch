"""Approved year bridge -> official rule -> separate assessment and advantage."""
from copy import deepcopy
from fractions import Fraction
from ..year_equating import estimate_year, EquatingError, display, number
from ..university_conversion import prepare_equated_profile, ConversionError
from ..admission_result_percentile import ResultPercentileError, MATCH_FIELDS
from .platform_ports import OfferingAnalysis
from .university_percentile import legacy_percentile_result
from .overall_analysis import _identifier
from .time_contract import calendar_date
from urllib.parse import urlsplit, parse_qs


def blocked(offering_id, reason):
    return dict(offering_id=offering_id, status='pending', reason_code=reason,
                converted_score=None, converted_percentile=None, category='pending',
                advantage=None, years=[], versions={}, eligibility_status='needs_confirmation')


def eligibility(scores, policy):
    if not isinstance(policy, dict) or policy.get('status') != 'approved' or not policy.get('version'):
        return 'needs_confirmation'
    for requirement in policy.get('requirements', []):
        field = requirement.get('field')
        if field in ('korean_choice', 'math_choice'):
            value = scores[field.split('_')[0]].get('choice')
        elif field in ('english_grade', 'korean_history_grade'):
            value = scores.get(field)
        else:
            return 'needs_confirmation'  # non-score qualifications need a verified per-student port
        if value is None: return 'needs_confirmation'
        if requirement.get('operator') == 'in' and isinstance(requirement.get('values'), list):
            if value not in requirement['values']: return 'ineligible'
        elif requirement.get('operator') == 'at_most' and type(requirement.get('value')) is int and type(value) is int:
            if value > requirement['value']: return 'ineligible'
        else:
            return 'needs_confirmation'
    return 'eligible'


def evidence_dto(decision):
    """Keep published historical metrics, forecast and adopted range distinct."""
    evidence=decision.get('evidence')
    if not isinstance(evidence,dict) or evidence.get('status')!='approved' or not evidence.get('version'):
        raise ValueError('decision_evidence_unapproved')
    if evidence.get('context')!=decision['context']:raise ValueError('decision_evidence_context_mismatch')
    def url(value):
        if value is None:return None
        if not isinstance(value,str):raise ValueError('invalid_public_source')
        parsed=urlsplit(value)
        if parsed.scheme not in ('http','https') or not parsed.hostname or parsed.username or parsed.password or set(parse_qs(parsed.query)) & {'token','access_token','refresh_token','api_key','authorization'}:
            raise ValueError('invalid_public_source')
        return value
    fields=('academic_year','metric_name','metric_definition','value','unit','original_scale','publication_status','source_url','source_as_of')
    history=[]
    for row in evidence.get('historical_metrics',[]):
        if row.get('verification_status')!='verified_official':raise ValueError('historical_metric_unapproved')
        item={key:deepcopy(row.get(key)) for key in fields}
        if type(item['academic_year']) is not int or item['academic_year'] not in (2024,2025,2026,2027):raise ValueError('historical_year_invalid')
        if any(value is not None and type(value) not in (str,int) for value in item.values()):raise ValueError('historical_metric_invalid')
        item['source_url']=url(item['source_url'])
        if item['source_as_of'] is not None:item['source_as_of']=calendar_date(item['source_as_of']).isoformat()
        history.append(item)
    forecast=evidence.get('forecast_70')
    if forecast is None:forecast=dict(status='pending',reason_code='forecast_70_not_published',value=None,unit=None,definition=None,version=None)
    else:
        if forecast.get('status')!='approved' or not forecast.get('version') or not forecast.get('definition') or not forecast.get('unit'):raise ValueError('forecast_unapproved')
        number(forecast['value'])
        forecast={key:deepcopy(forecast.get(key)) for key in ('value','unit','definition','version')}
        if any(type(value) not in (str,int) for value in forecast.values()):raise ValueError('forecast_invalid')
        forecast.update(status='ready',reason_code=None)
    adopted=evidence.get('expected_acceptance_range')
    if not isinstance(adopted,dict) or adopted.get('status')!='approved' or adopted.get('policy_version')!=decision['version']:
        raise ValueError('acceptance_range_unapproved')
    if not adopted.get('definition') or not adopted.get('unit') or number(adopted['lower'])>=number(adopted['upper']):raise ValueError('acceptance_range_invalid')
    adopted={key:deepcopy(adopted.get(key)) for key in ('lower','upper','unit','definition','policy_version')}
    if any(type(value) not in (str,int) for value in adopted.values()):raise ValueError('acceptance_range_invalid')
    return dict(version=evidence['version'],historical_metrics=history,forecast_70=forecast,expected_acceptance_range=adopted)


def evaluate_offering(offering, profile, overall, bundle, *, conversion=None, percentile=None):
    try:result=_evaluate_offering(offering,profile,overall,bundle,conversion,percentile)
    except (KeyError,TypeError,AttributeError,ValueError):result=blocked(offering['offering_id'],'analysis_release_invalid')
    if conversion is not None:
        result['conversion']=conversion.dto()
        result['recommendation_reasons']=(deepcopy(list(conversion.explanations)) if conversion.ready else [])+result.get('recommendation_reasons',[])
        if conversion.ready:
            result['converted_score']=conversion.converted_score
            result['versions'].update(rule=conversion.rule_version,conversion=conversion.release_version)
            years={row['academic_year']:row for row in result['years']}
            years[conversion.academic_year]=dict(academic_year=conversion.academic_year,offering_id=offering['offering_id'],
                score_basis=conversion.score_basis,converted_score=conversion.converted_score,status='ready',reason_code=None)
            result['years']=[years.get(y,dict(academic_year=y,offering_id=None,score_basis='year_equated_estimate',
                converted_score=None,status='pending',reason_code='year_bridge_required')) for y in (2024,2025,2026,2027)]
    if percentile is not None and (percentile.ready or 'percentile' not in result):
        result['percentile']=percentile.dto()
        result['converted_percentile']=result['percentile']['top_percent']
    return result


def _evaluate_offering(offering, profile, overall, bundle, conversion, percentile):
    oid = offering['offering_id']
    if not isinstance(bundle, OfferingAnalysis): return blocked(oid, 'analysis_release_missing')
    if not _identifier(bundle.version): return blocked(oid, 'analysis_release_invalid')
    if bundle.status != 'approved': return blocked(oid, 'analysis_release_not_approved')
    scores = profile['scores']
    if bundle.source_pack_version != scores['pack_version']: return blocked(oid, 'analysis_pack_mismatch')
    year = offering['academic_year']
    if bundle.offerings_by_year.get(year) != oid: return blocked(oid, 'offering_binding_mismatch')
    direct=conversion is not None and conversion.ready
    if overall['overall']['status'] == 'pending' and not direct: return blocked(oid, overall['overall']['reason_code'])
    marks = dict(korean=scores['korean']['standard_score'], math=scores['math']['standard_score'],
                 inquiry1=scores['inquiry'][0]['standard_score'], inquiry2=scores['inquiry'][1]['standard_score'])
    profiles, failures = {}, {}
    for target_year in (2024, 2025, 2026, 2027):
        if direct and target_year==year:
            profiles[target_year]=conversion.internal_profile();continue
        if overall['overall']['status']=='pending':
            failures[target_year]=overall['overall']['reason_code'];continue
        bridge = bundle.bridges.get(target_year)
        if bridge is None:
            failures[target_year] = 'target_distribution_missing'; continue
        try:
            source, target = bridge['source'], bridge['target']
            if (source['korean'].exam_id != scores['exam_id'] or
                source['korean'].academic_year != overall['exam']['academic_year'] or
                any(d.version != scores['pack_version'] for d in source.values()) or
                bridge['source_total'].version != overall['overall']['model_version'] or
                target['korean'].academic_year != target_year):
                failures[target_year] = 'bridge_context_mismatch'; continue
            result = estimate_year(marks, source, target, policy=bundle.policy,
                                   source_total=bridge['source_total'], target_total=bridge['target_total'])
            if not result['public_eligible']:
                failures[target_year] = next((r for r in result['reason_codes'] if r != 'ABSOLUTE_GRADES_HELD_CONSTANT'), 'bridge_not_approved'); continue
            profiles[target_year] = prepare_equated_profile(profile['profile_id'], result,
                english_grade=scores.get('english_grade'), korean_history_grade=scores.get('korean_history_grade'),
                choices={'korean_choice':scores['korean'].get('choice'), 'math_choice':scores['math'].get('choice'),
                         'inquiry1_subject':scores['inquiry'][0]['subject'], 'inquiry2_subject':scores['inquiry'][1]['subject']})
        except (EquatingError, ConversionError) as error:
            failures[target_year] = error.code
    converted = bundle.release.compare_years(bundle.offerings_by_year, profiles)
    if direct:
        current_row=next(r for r in converted['years'] if r['academic_year']==year)
        current_row.update(conversion.internal_calculation())
    public_years = []
    for row in converted['years']:
        y = row['academic_year']
        public_years.append(dict(academic_year=y, offering_id=row['offering_pk'],
            score_basis=row.get('score_basis','year_equated_estimate'), converted_score=row.get('converted_score'),
            status='ready' if row.get('calculation_status')=='calculated' else 'pending',
            reason_code=None if row.get('calculation_status')=='calculated' else failures.get(y, row['reason_codes'][0])))
    current = next(r for r in converted['years'] if r['academic_year']==year)
    if current.get('calculation_status') != 'calculated':
        result = blocked(oid, failures.get(year, current['reason_codes'][0])); result['years']=public_years; return result
    result = blocked(oid, 'comparison_distribution_missing')
    result.update(converted_score=current['converted_score'], years=public_years,
                  versions=dict(analysis=bundle.version, profile=profile['profile_id'], pack=scores['pack_version'],
                                source_model=overall['overall']['model_version'],bridge=bundle.policy.version, rule=current['rule_version']))
    # Absence preserves an already approved legacy lookup. A supplied artifact
    # with invalid approval/context must never be bypassed with another curve.
    independent=direct and percentile is not None and (percentile.ready or percentile.reason_code!='percentile_release_missing')
    if independent:
        if not percentile.ready:result['reason_code']=percentile.reason_code;return result
        metadata=dict(percentile.context);curve=None
    else:
        curve = bundle.curves.get(year)
        if curve is None: return result
        metadata = curve.metadata
    try:
        binding = dict(academic_year=year, exam_id=profiles[year]['exam_id'], rule_version=current['rule_version'])
        rule = bundle.release.rules[current['rule_version']].data
        binding.update(rule_id=rule['rule_id'], score_scope=rule['score_scope'])
        decision = bundle.decisions.get(year)
        if not isinstance(decision, dict): result['reason_code']='decision_policy_missing'; return result
        context = decision.get('context', {})
        if decision.get('status') != 'approved': result['reason_code']='decision_policy_not_approved'; return result
        if context.get('offering_id') != oid or any(context.get(k) != metadata[k] for k in MATCH_FIELDS):
            result['reason_code']='decision_context_mismatch'; return result
        if context.get('curve_version') != metadata['curve_version'] or context.get('analysis_version') != bundle.version:
            result['reason_code']='decision_version_mismatch'; return result
        try:result['decision_evidence']=evidence_dto(decision)
        except (KeyError,TypeError,ValueError):result['reason_code']='decision_evidence_unapproved';return result
        result['versions']['evidence']=result['decision_evidence']['version']
        if any(metadata[k] != value for k, value in binding.items()):
            result['reason_code']='conversion_curve_context_mismatch'; return result
        record={k:metadata[k] for k in MATCH_FIELDS}
        score=Fraction(**current['exact_score'])
        record.update(score_metric=metadata['score_metric'], score_value=score, publication_precision={'mode':'exact'})
        rank=percentile.internal_rank() if independent else curve.lookup(record)
        result['converted_percentile']=rank['at_reported_score']['above_or_equal_percent']
        if not independent:
            result['percentile']=legacy_percentile_result(offering,profile,current,curve,bundle.version).dto()
        result['versions'].update(curve=metadata['curve_version'], decision=decision['version'],
                                 population=metadata['population_id'],target_exam=metadata['exam_id'],tie_policy='include_equal')
        eligibility_status=eligibility(scores, decision.get('eligibility_policy'))
        result['eligibility_status']=eligibility_status
        if eligibility_status == 'ineligible': result.update(status='ineligible', category='ineligible', reason_code='eligibility_not_met'); return result
        if eligibility_status != 'eligible': result['reason_code']='eligibility_confirmation_required'; return result
        result['versions']['eligibility']=decision['eligibility_policy']['version']
        ranges=decision.get('ranges', [])
        allowed={'challenge','core','room','outside'}
        matches=[r for r in ranges if r.get('category') in allowed and number(r['lower']) <= score < number(r['upper'])]
        if len(matches) != 1: result['reason_code']='decision_range_unconfirmed'; return result
        # Counselor adjustment is separately approved, versioned, and applied once.
        category=matches[0]['category']; base_category=category; adjustment=decision.get('adjustment')
        if adjustment:
            if adjustment.get('status')!='approved' or adjustment.get('base_version')!=decision['version'] or not adjustment.get('version') or not isinstance(adjustment.get('ranges'),list):
                result['reason_code']='counselor_adjustment_unapproved'; return result
            adjusted=[r for r in adjustment['ranges'] if r.get('category') in allowed and number(r['lower'])<=score<number(r['upper'])]
            if len(adjusted)!=1:result['reason_code']='counselor_adjustment_range_unconfirmed';return result
            result['versions']['adjustment']=adjustment['version'];category=adjusted[0]['category']
        result['decision_components']=dict(base_category=base_category,adjusted_category=category if adjustment else None,
            adopted_category=category,base_policy_version=decision['version'],adjustment_version=adjustment['version'] if adjustment else None)
        result.update(status='ready', category=category, reason_code=None)
        baseline=decision.get('baseline')
        target_total=bundle.bridges.get(year,{}).get('target_total')
        if (baseline and target_total is not None and all(baseline.get(k)==metadata[k] for k in ('academic_year','exam_id','population_id'))
            and (target_total.academic_year, target_total.exam_id, target_total.population_id)==
                (metadata['academic_year'], metadata['exam_id'], metadata['population_id'])
            and target_total.status=='validated' and target_total.kind!='synthetic'
            and baseline.get('version')==target_total.version
            and baseline.get('tie_policy')=='include_equal' and baseline.get('status')=='approved'):
            student_total=sum(profiles[year]['values'][area+'_standard_score'] for area in marks)
            base_percent=target_total.rank(student_total).inclusive*100
            exact=rank['at_reported_score']['above_or_equal_ratio']
            delta=base_percent-Fraction(exact['numerator'],exact['denominator'])*100
            result['advantage']=dict(delta_pp=display(delta), status='favorable' if delta>0 else 'unfavorable' if delta<0 else 'neutral',
                                     baseline_version=baseline['version'])
            code='converted_score_position_gain' if delta>0 else 'converted_score_position_loss' if delta<0 else 'converted_score_position_equal'
            text='같은 시험·모집단·동점 기준의 총점 위치와 비교하면 대학 환산 위치가 '+('더 앞섭니다.' if delta>0 else '더 뒤입니다.' if delta<0 else '같습니다.')
            result['recommendation_reasons']=[dict(code=code,text=text,evidence_refs=[baseline['version'],metadata['curve_version']])]
        return result
    except (ResultPercentileError, EquatingError, ConversionError) as error:
        result['reason_code']=error.code; return result
