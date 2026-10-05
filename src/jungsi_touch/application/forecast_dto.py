"""Explicit wire projections; persistence records and exact values stay private."""
from copy import deepcopy
from ..forecasting import require

PUBLIC_CONTEXT_FIELDS=('offering_id','academic_year','exam_id','source_pack_version','catalog_version','rule_id','rule_version','curve_version','analysis_version','score_scale_id','score_scope','bonus_treatment','population_id','comparison_metric','unit','direction','tie_policy')


def public_context(context):
    require(all(k in context for k in PUBLIC_CONTEXT_FIELDS),'forecast_public_context_missing',409)
    require(all(context[k] is not None for k in PUBLIC_CONTEXT_FIELDS if k!='tie_policy'),'forecast_public_context_missing',409)
    require(all(type(context[k]) in (str,int) for k in PUBLIC_CONTEXT_FIELDS if k!='tie_policy') and type(context['academic_year']) is int,'forecast_public_context_invalid',409)
    require((context['comparison_metric']=='converted_score' and context['unit']=='점' and context['direction']=='higher_is_better' and context['tie_policy'] is None) or (context['comparison_metric']=='university_top_percent' and context['unit']=='%' and context['direction']=='lower_is_better' and context['tie_policy']=='include_equal'),'forecast_comparison_basis_mismatch',409)
    return fields(context,PUBLIC_CONTEXT_FIELDS)


def fields(value, names):
    return {key: deepcopy(value.get(key)) for key in names}


def result_dto(result):
    return dict(
        forecast_70=fields(result['forecast_70'], ('status', 'reason_code', 'value', 'unit', 'definition', 'version')),
        acceptance_range=fields(result['acceptance_range'], ('status', 'reason_code', 'lower', 'upper', 'unit', 'definition', 'policy_version')),
        category_ranges=[fields(row, ('category', 'lower', 'upper')) for row in result['category_ranges']],
    )


def adjustment_dto(row):
    item=fields(row, ('target', 'reason', 'evidence_refs', 'actor', 'at', 'base_result_hash'))
    replacement=row['replacement']
    item['replacement']=dict(ranges=[fields(r,('category','lower','upper')) for r in replacement['ranges']]) if row['target']=='category_ranges' else fields(replacement,('value','unit') if row['target']=='forecast_70' else ('lower','upper','unit'))
    return item


def draft_dto(record):
    validation = record.get('validation')
    approval = record.get('approval')
    return dict(format='jungsi.forecast-draft/v1', draft_id=record['draft_id'],
        offering_id=record['context']['offering_id'], revision=record['revision'], status=record['status'],
        base_result_hash=record['base_result_hash'], policy_version=record['policy_version'],
        context=fields(record['context'], ('offering_id', 'offering_lineage_id', 'academic_year', 'university_id', 'campus', 'department', 'track', 'group', 'exam_id', 'source_pack_version', 'catalog_version', 'analysis_version', 'rule_id', 'rule_version', 'curve_version', 'population_id', 'score_scope', 'score_scale_id', 'bonus_treatment', 'unit')),
        result=result_dto(record['result']), base_result=result_dto(record['base_result']),
        created_at=record['created_at'], updated_at=record['updated_at'],
        adjustments=[adjustment_dto(row) for row in record['adjustments']],
        validation=fields(validation, ('status', 'reason_code', 'checks', 'validated_revision', 'result_hash', 'receipt_hash', 'at')) if validation else None,
        approval=fields(approval, ('approved_revision', 'result_hash', 'validation_hash', 'approval_hash', 'reason', 'at')) if approval else None,
        audit_events=[fields(row, ('action', 'actor', 'at')) for row in record['events']])
