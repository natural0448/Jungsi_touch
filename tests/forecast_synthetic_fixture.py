"""Synthetic fixture only; policy values never serve as production defaults."""
from copy import deepcopy
CONTEXT=dict(offering_id='SYNTHETIC-O',offering_lineage_id='SYNTHETIC-lineage',university_id='SYNTHETIC-U',academic_year=2027,exam_id='SYNTHETIC-exam',source_pack_version='SYNTHETIC-pack',catalog_version='SYNTHETIC-catalog',rule_id='SYNTHETIC-rule-id',rule_version='SYNTHETIC-rule',curve_version='SYNTHETIC-curve',analysis_version='SYNTHETIC-analysis',input_version='SYNTHETIC-input',policy_version='SYNTHETIC-policy',score_scope='csat_component',bonus_treatment='included',score_scale_id='SYNTHETIC-scale',population_id='SYNTHETIC-pop',comparison_metric='converted_score',direction='higher_is_better',tie_policy=None,unit='점')

def fixture(independent=True):
    metric=dict(metric_id='final_registrant_70pct_cut',definition='합성 70% 지표')
    acceptance=dict(metric_id='counseling_reference',definition='합성 별도 지원 검토 근거')
    def rows(m):return [dict(academic_year=y,status='approved',source_ref='SYNTHETIC-source-'+str(y),source_hash='a'*64,offering_lineage_id=CONTEXT['offering_lineage_id'],metric_id=m['metric_id'],metric_definition=m['definition'],unit='점',comparison_scale_id=CONTEXT['score_scale_id'],population_id=CONTEXT['population_id'],bridge_status='approved',bridge_version='SYNTHETIC-bridge',bridge_receipt_hash='b'*64,comparison_value=str(v)) for y,v in ((2024,50),(2025,52),(2026,54))]
    spec=dict(status='approved',version='SYNTHETIC-policy',minimum_years=3,target_year=2027,comparison_metric='converted_score',tie_policy=None,direction='higher_is_better',require_consecutive_years=True,max_abs_trend_per_year='10',display_places=2,rounding_mode='half_up',method='linear_trend',trend_adopted=True,trend_evidence_ref='SYNTHETIC-trend',value_bounds=dict(lower='0',upper='100'))
    policy=dict(status='approved',version='SYNTHETIC-policy',context=deepcopy(CONTEXT),require_independent_approver=independent,adjustable_targets=['forecast_70','acceptance_range','category_ranges'],forecast_70=dict(spec,metric=metric),acceptance_range=dict(spec,metric=acceptance,range_evidence_ref='SYNTHETIC-range',category_evidence_ref='SYNTHETIC-category',lower_width='2',upper_width='2',category_offsets=[dict(category='challenge',lower='-10',upper='-2'),dict(category='core',lower='-2',upper='2'),dict(category='room',lower='2',upper='20')]))
    inputs=dict(status='approved',version='SYNTHETIC-input',context=deepcopy(CONTEXT),history_70=rows(metric),acceptance_history=rows(acceptance),approved_evidence_refs=['SYNTHETIC-manual'],issues=[dict(issue_id='SYNTHETIC-issue',effect=None,explanation='효과 크기 미확인',evidence_ref='SYNTHETIC-source')])
    return inputs,policy

class Inputs:
    def __init__(self,independent=True):self.data,self.rules=fixture(independent)
    def inputs(self,oid,input_id,version):
        from jungsi_touch.forecasting import require
        require(oid==CONTEXT['offering_id'] and version==self.data['version'],'forecast_input_missing',503)
        return deepcopy(self.data)
    def policy(self,policy_id,version):
        from jungsi_touch.forecasting import require
        require(version==self.rules['version'],'forecast_policy_missing',503)
        return deepcopy(self.rules)
    def current_context(self,oid):return deepcopy(self.data['context'])
