"""Adopt a forecast release without coupling successful conversion to forecast readiness."""
from copy import deepcopy
from ..forecasting import digest,require,number,validate_ranges
from .platform_ports import PlatformError
from .offering_analysis import blocked,eligibility
from ..admission_result_percentile import MATCH_FIELDS

def evaluate_release(offering,profile,conversion,percentile,release):
    result=blocked(offering['offering_id'],'forecast_release_missing')
    result['conversion']=conversion.dto();result['percentile']=percentile.dto()
    result['recommendation_reasons']=deepcopy(list(conversion.explanations)) if conversion.ready else []
    result['converted_score']=conversion.converted_score
    result['converted_percentile']=percentile.dto()['top_percent']
    result['years']=[dict(academic_year=y,offering_id=offering['offering_id'] if y==offering['academic_year'] else None,score_basis=conversion.score_basis if y==offering['academic_year'] else 'year_equated_estimate',converted_score=conversion.converted_score if y==offering['academic_year'] else None,status='ready' if y==offering['academic_year'] and conversion.ready else 'pending',reason_code=None if y==offering['academic_year'] and conversion.ready else 'year_bridge_required') for y in (2024,2025,2026,2027)]
    if conversion.ready:result['versions'].update(rule=conversion.rule_version,conversion=conversion.release_version,profile=profile['profile_id'],pack=conversion.pack_version)
    try:
        require(conversion.ready,conversion.reason_code or 'conversion_release_missing',409)
        require(percentile.ready,percentile.reason_code or 'percentile_release_missing',409)
        require(isinstance(release,dict),'forecast_release_missing',409)
        pinned=deepcopy(release);claimed=pinned.pop('release_hash',None)
        require(claimed==digest(pinned) and release.get('approval_hash') and release.get('validation_hash'),'forecast_release_invalid',409)
        context=release['context'];actual=dict(percentile.context);actual.update(dict(conversion.context))
        require(context.get('offering_id')==offering['offering_id'] and all(k in context and context[k]==actual.get(k) for k in MATCH_FIELDS),'forecast_context_mismatch',409)
        require(context.get('curve_version')==percentile.curve_version,'forecast_context_mismatch',409)
        calculated=release['result'];require(calculated.get('context')==context,'forecast_context_mismatch',409)
        acceptance=calculated['acceptance_range'];forecast=calculated['forecast_70']
        result['decision_evidence']=dict(version=release['release_id'],forecast_release_version=release['release_id'],historical_metrics=deepcopy(calculated.get('historical_metrics',[])),forecast_70=deepcopy(forecast),expected_acceptance_range=deepcopy(acceptance),basis_summary=' / '.join(r['target']+': 승인 비교자료 및 정책 적용' for r in calculated['basis_summary']) or None,issue_summaries=[dict(issue_id=i['issue_id'],title=i.get('title',i['issue_id']),summary=i['explanation'],numeric_effect_applied=False) for i in calculated['issue_summaries']],recommendation_reasons=[dict(code='approved_'+r['target'],text='승인된 비교자료와 정책에 따라 기준을 산출했습니다.',evidence_refs=r['source_refs']) for r in calculated['basis_summary']],adjustment_summary=dict(applied=bool(release['adjustments']),reason=' / '.join(a['reason'] for a in release['adjustments']) or None,version=release['release_id'] if release['adjustments'] else None))
        require(acceptance['status']=='ready',acceptance.get('reason_code') or 'acceptance_evidence_missing',409)
        eligibility_status=eligibility(profile['scores'],release.get('eligibility_policy'))
        result['eligibility_status']=eligibility_status
        if eligibility_status=='ineligible':result.update(status='ineligible',category='ineligible',reason_code='eligibility_not_met');return result
        require(eligibility_status=='eligible','eligibility_confirmation_required',409)
        rows=calculated['category_ranges'];validate_ranges(rows)
        matches=[r for r in rows if number(r['lower'])<=conversion.score<number(r['upper'])]
        require(len(matches)==1,'decision_range_unconfirmed',409)
        base_rows=release['base_result']['category_ranges']
        base=[r for r in base_rows if number(r['lower'])<=conversion.score<number(r['upper'])]
        require(len(base)==1,'decision_range_unconfirmed',409)
        adjusted=bool(release['adjustments']);category=matches[0]['category']
        result.update(status='ready',category=category,reason_code=None,decision_components=dict(base_category=base[0]['category'],adjusted_category=category if adjusted else None,adopted_category=category,base_policy_version=release['policy_version'],adjustment_version=release['release_id'] if adjusted else None))
        labels={'challenge':'도전','core':'핵심 검토','room':'여유 후보','outside':'추천 범위 밖'}
        result['recommendation_reasons'].append(dict(code='adopted_support_range',text='이 모집행의 승인된 지원 검토 구간에서 '+labels[category]+'에 해당합니다.',evidence_refs=[release['release_id'],release['policy_version']]))
        result['versions'].update(forecast=release['release_id'],decision=release['policy_version'],curve=percentile.curve_version,population=percentile.population_id,eligibility=release['eligibility_policy']['version'],target_exam=percentile.exam_id,tie_policy='include_equal')
    except PlatformError as error:result['reason_code']=error.code
    except (KeyError,TypeError,ValueError):result['reason_code']='forecast_release_invalid'
    return result
