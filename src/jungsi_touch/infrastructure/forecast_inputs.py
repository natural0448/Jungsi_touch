"""Pinned private Drive forecast inputs; no raw HTTP-supplied scores or policies."""
from ..application.platform_ports import PlatformError

class DriveForecastInputProvider:
    def __init__(self,data):self.data=data
    def load(self,kind,key):
        loader=getattr(self.data,'load',None)
        if loader is None:raise PlatformError('forecast_input_not_configured',503)
        raw,_=loader(kind,key)
        if raw is None:raise PlatformError('forecast_input_missing',503)
        return raw
    def inputs(self,offering_id,input_id,version):
        raw=self.load('forecast_inputs',input_id+':'+version)
        if raw.get('input_id')!=input_id or raw.get('context',{}).get('offering_id')!=offering_id:raise PlatformError('forecast_input_binding_mismatch',503)
        return raw
    def policy(self,policy_id,version):
        raw=self.load('forecast_policy',policy_id+':'+version)
        if raw.get('policy_id')!=policy_id:raise PlatformError('forecast_policy_binding_mismatch',503)
        return raw
    def current_context(self,offering_id):
        context=self.load('forecast_context',offering_id)['context']
        catalog=self.data.get_catalog()
        if catalog is None or catalog.status!='approved':raise PlatformError('forecast_catalog_unavailable',503)
        rows=[r for r in catalog.offerings if r.get('offering_id')==offering_id]
        if len(rows)!=1:raise PlatformError('forecast_offering_mismatch',409)
        offering=rows[0]
        for field in ('academic_year','university_id','campus','department','track','group'):
            if context.get(field)!=offering.get(field):raise PlatformError('forecast_base_version_conflict',409)
        conversion=self.data.get_conversion(offering_id);percentile=self.data.get_percentile(offering_id)
        if conversion is None or conversion.status!='approved' or percentile is None or percentile.status!='approved':
            raise PlatformError('forecast_execution_sources_pending',503)
        if context.get('catalog_version')!=catalog.version or context.get('exam_id')!=conversion.exam_id or context.get('source_pack_version')!=conversion.source_pack_version or context.get('rule_version')!=percentile.rule_version or context.get('curve_version')!=percentile.curve.metadata['curve_version']:
            raise PlatformError('forecast_base_version_conflict',409)
        binding=conversion.release.bindings.get((offering['academic_year'],offering_id))
        if binding!=context['rule_version']:raise PlatformError('forecast_base_version_conflict',409)
        for field in ('population_id','rule_id','score_scope','score_scale_id','bonus_treatment'):
            if context.get(field)!=percentile.curve.metadata.get(field):raise PlatformError('forecast_base_version_conflict',409)
        return context
