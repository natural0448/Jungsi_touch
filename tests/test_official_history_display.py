"""Synthetic scope, DTO and negative security regression; no DB/env/real data."""
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
import unittest
from fastapi.testclient import TestClient

from jungsi_touch.application.platform import PlatformService
from jungsi_touch.application.platform_ports import PlatformError, VerifiedSession
from jungsi_touch.infrastructure.official_history_display import (
    DB_FIELDS, OPERATIONS, OfficialHistoryDisplayScope, PostgresOfficialHistoryDisplayProvider,
    create_official_history_display_app,
)
from jungsi_touch.infrastructure.secured_http import SecuritySettings
from jungsi_touch.infrastructure.settings import ServerSettings
from backend_synthetic_fixture import SyntheticRepository

SUBJECT='00000000-0000-0000-0000-000000000001'
OTHER='00000000-0000-0000-0000-000000000002'
RELAY='SYNTHETIC-relay-not-an-operating-secret-0000'

class Clock:
    def now(self):return datetime(2026,10,8,0,0,tzinfo=timezone.utc)

class Sessions:
    def verify(self,token,now):
        if token=='SYNTHETIC-user':return VerifiedSession(SUBJECT,datetime(2026,10,8,1,0,tzinfo=timezone.utc))
        if token=='SYNTHETIC-other':return VerifiedSession(OTHER,datetime(2026,10,8,1,0,tzinfo=timezone.utc))
        return None

class Repository(SyntheticRepository):
    def active_paid_until(self,owner,now):
        return datetime(2026,10,8,1,0,tzinfo=timezone.utc) if self.active_paid(owner,now) else None

def synthetic_body():
    offer=dict(offering_id='2026:SYNTHETIC-A',academic_year=2026,university_id='SYNTHETIC-U',university_name='SYNTHETIC University',
               campus='SYNTHETIC Campus',department='SYNTHETIC Department',track='SYNTHETIC Reviewed Track',group='가',region='SYNTHETIC Region',wildcard_group=None,practical_required=False)
    values=['77.25',0,None]
    history=[];bindings=[]
    for i,value in enumerate(values):
        row={k:v for k,v in offer.items() if k!='practical_required'}
        row.update(metric_name='SYNTHETIC metric '+str(i),metric_definition='SYNTHETIC 75% definition',value=value,unit='SYNTHETIC unit',
                   original_scale='SYNTHETIC original scale',publication_status='published',source_url='https://example.org/synthetic',source_as_of=None,verification_status='verified_official')
        history.append(row)
        db={k:None for k in DB_FIELDS}
        db.update(release_id='SYNTHETIC-source',result_id='SYNTHETIC-cell-'+str(i),academic_year=2026,school_id='SYNTHETIC-school',university_code='SYNTHETIC-code',
                  university='SYNTHETIC raw University',recruit_group='가군',department='SYNTHETIC Department',track=None,offering_pk='SYNTHETIC-A',anchor_2027_pks=[],metric_kind='SYNTHETIC metric',
                  metric_value_literal=json.dumps(value),metric_value_numeric=None if value is None else str(value),metric_value_json_type='null' if value is None else 'string' if type(value)is str else 'number',
                  cohort='SYNTHETIC registered',statistic_label='SYNTHETIC 75%',active_service=True,source_path='SYNTHETIC/private/source',source_sha256='a'*64,source_location={},source_review_status='SYNTHETIC verified',
                  original_record_locator={},field_presence_types={'SYNTHETIC':True},row_fingerprint='b'*64)
        bindings.append(dict(native_history_index=i,offering_id=offer['offering_id'],source_offering_pk='SYNTHETIC-A',expected_db_row=db))
    return dict(format='jungsi.official-history-display/v1',purpose='official_history_display',environment='local_verification',source_view='jungsi_data_ingest.admission_results_curated_v21_1',
                engine_approved=False,production_allowed=False,nationwide_collection_complete=False,
                approval=dict(status='approved',approval_id='SYNTHETIC-display-approval',issued_at='2026-10-08T00:00:00Z',expires_at='2026-10-08T01:00:00Z',revoked=False,review_subjects=[SUBJECT],operations=list(OPERATIONS)),
                source_evidence=dict(metric_lineage_sha256='c'*64,offering_boundary_receipt_sha256='d'*64),
                catalog=dict(format='jungsi.catalog-release/v1',version='SYNTHETIC-catalog-v1',status='approved',as_of='2026-10-08T00:00:00Z',offerings=[offer],history=history,nationwide_collection_complete=False,admission_probability_provided=False),bindings=bindings)

def scope(body):
    raw=json.dumps(body,ensure_ascii=False).encode()
    return OfficialHistoryDisplayScope.from_bytes(raw,hashlib.sha256(raw).hexdigest(),environment='local_verification')

class OfficialHistoryDisplayTests(unittest.TestCase):
    def setUp(self):
        self.body=synthetic_body();self.clock=Clock();self.calls=[]
        self.rows=[deepcopy(b['expected_db_row']) for b in self.body['bindings']]
        def read(selected):self.calls.append(selected);return deepcopy(self.rows)
        self.provider=PostgresOfficialHistoryDisplayProvider(scope=scope(self.body),clock=self.clock,reader=read)
        self.repo=Repository()
        self.app=create_official_history_display_app(provider=self.provider,security=SecuritySettings(RELAY),settings=ServerSettings(),repository=self.repo,sessions=Sessions(),clock=self.clock)
        self.client=TestClient(self.app,headers={'X-Jungsi-Relay-Token':RELAY,'Authorization':'Bearer SYNTHETIC-user'})

    def test_actual_row_values_preserve_string_zero_null_and_metadata(self):
        release=self.provider.get_catalog()
        self.assertEqual([r['value'] for r in release.history],['77.25',0,None])
        self.assertIs(type(release.history[1]['value']),int)
        self.assertEqual([r['metric_definition'] for r in release.history],['SYNTHETIC 75% definition']*3)
        self.assertEqual(release.offerings[0]['track'],'SYNTHETIC Reviewed Track')
        self.assertIsNone(self.rows[0]['track'])
        self.assertEqual(len(self.calls),1)
        self.assertEqual(len(self.calls[0]),3)

    def test_all_non_catalog_model_ports_remain_missing(self):
        for method,args in [('get_exam_pack',('SYNTHETIC',)),('get_total_model',('SYNTHETIC','SYNTHETIC')),('get_analysis',('SYNTHETIC',)),('get_conversion',('SYNTHETIC',)),('get_percentile',('SYNTHETIC',))]:
            with self.subTest(method=method):self.assertIsNone(getattr(self.provider,method)(*args))
        self.assertEqual(self.calls,[])

    def test_history_bulk_one_read_has_closed_public_fields_no_private_source(self):
        response=self.client.get('/api/v1/admission-history?limit=1')
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(len(self.calls),1)
        self.assertEqual(len(self.calls[0]),3)
        self.assertEqual(response.json()['matching_offering_count'],1)
        self.assertIsNotNone(response.json()['next_cursor'])
        self.assertNotIn('SYNTHETIC/private',response.text)
        for key in ('result_id','expected_db_row','row_fingerprint','bindings','review_subjects','source_path','engine_approved'):
            self.assertNotIn('"'+key+'"',response.text)
        self.assertEqual(response.headers['cache-control'],'no-store')

    def test_standard_me_paid_queries_and_unpublished_recruitment_contract(self):
        self.assertEqual(self.client.get('/api/v1/me').json(),dict(format='jungsi.session/v1',member_tier='standard',entitlement_expires_at=None))
        self.assertEqual(self.client.get('/api/v1/offerings/search').status_code,403)
        self.assertEqual(self.calls,[])
        response=self.client.get('/api/v1/offerings/2026:SYNTHETIC-A/recruitment')
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(response.json()['reason_code'],'recruitment_not_published')
        self.assertIsNone(response.json()['recruitment'])
        self.assertEqual(response.json()['offering']['academic_year'],2026)

    def test_unsupported_write_engine_routes_never_execute_or_read_data(self):
        for method,path in [('POST','/api/v1/score-profiles'),('GET','/api/v1/reports/SYNTHETIC-report'),('POST','/api/v1/reports/SYNTHETIC-report/candidates')]:
            with self.subTest(path=path):self.assertEqual(self.client.request(method,path).status_code,503)
        self.assertEqual(self.calls,[])
        self.assertEqual(self.repo.profiles,{})

    def test_relay_and_review_allowlist_are_not_user_or_entitlement_replacements(self):
        bare=TestClient(self.app)
        self.assertEqual(bare.get('/api/v1/admission-history',headers={'Authorization':'Bearer SYNTHETIC-user'}).status_code,403)
        self.assertEqual(self.client.get('/api/v1/admission-history',headers={'Authorization':'Bearer SYNTHETIC-other'}).status_code,403)
        self.assertEqual(self.client.get('/api/v1/admission-history',headers={'Authorization':'Bearer invalid'}).status_code,401)
        self.assertEqual(self.calls,[])

    def test_ready_empty_differs_from_missing_or_modified_db_rows(self):
        result=self.client.get('/api/v1/admission-history?department_q=unmatched')
        self.assertEqual(result.status_code,200,result.text)
        self.assertEqual(result.json()['items'],[])
        self.assertEqual(result.json()['status'],'ready')
        self.rows.pop()
        result=self.client.get('/api/v1/admission-history')
        self.assertEqual(result.status_code,503,result.text)
        self.assertNotIn('items',result.json())

    def test_changed_typed_db_fields_source_or_identity_fail_closed(self):
        for key,value in [('metric_value_literal','77.25'),('metric_value_json_type','number'),('metric_value_numeric','78'),('track','SYNTHETIC changed'),('academic_year',2025),('active_service',1),('source_sha256','c'*64),('row_fingerprint','d'*64),('curation_release_id','SYNTHETIC overlay')]:
            with self.subTest(field=key):
                rows=deepcopy(self.rows);rows[0][key]=value
                p=PostgresOfficialHistoryDisplayProvider(scope=scope(self.body),clock=self.clock,reader=lambda _:rows)
                with self.assertRaises(PlatformError):p.get_catalog()

    def test_history_offering_identity_scope_and_approval_cannot_weaken(self):
        changes=[('engine',lambda b:b.update(engine_approved=True)),('production',lambda b:b.update(production_allowed=True)),
                 ('revoked',lambda b:b['approval'].update(revoked=True)),('expired',lambda b:b['approval'].update(expires_at='2026-10-08T00:00:00Z')),
                 ('environment',lambda b:b.update(environment='production')),('year',lambda b:b['catalog']['history'][0].update(academic_year=2025)),
                 ('track',lambda b:b['catalog']['history'][0].update(track='SYNTHETIC other')),
                 ('75%',lambda b:b['catalog']['history'][0].update(private_trace='SYNTHETIC private'))]
        for label,change in changes:
            with self.subTest(label=label):
                candidate=deepcopy(self.body);change(candidate)
                with self.assertRaises(PlatformError):scope(candidate).validate(self.clock.now())

    def test_hash_size_and_duplicate_json_are_rejected(self):
        for raw,pin in [(b'{}','a'*64),(b'{"format":1,"format":2}',None),(b'NaN',None)]:
            with self.subTest(size=len(raw)):
                with self.assertRaises(PlatformError):OfficialHistoryDisplayScope.from_bytes(raw,pin or hashlib.sha256(raw).hexdigest(),environment='local_verification')

    def test_no_ordinary_factory_transition(self):
        from jungsi_touch.infrastructure.http_api import configured_app
        import inspect
        self.assertEqual(inspect.getsource(configured_app).strip(),'def configured_app():\n    return create_app()')

    def test_raw_and_public_id_are_distinct_and_both_bound(self):
        self.assertNotEqual(self.body['bindings'][0]['offering_id'],self.rows[0]['offering_pk'])
        for change in [lambda b:b['bindings'][0].update(source_offering_pk='SYNTHETIC-wrong'),
                       lambda b:b['bindings'][0].pop('source_offering_pk'),
                       lambda b:b['bindings'][0].update(offering_id='2025:SYNTHETIC-A'),
                       lambda b:b['bindings'][0]['expected_db_row'].update(academic_year=2025),
                       lambda b:b['source_evidence'].pop('metric_lineage_sha256')]:
            candidate=deepcopy(self.body);change(candidate)
            with self.assertRaises(PlatformError):scope(candidate).validate(self.clock.now())

    def test_microsecond_approval_catalog_and_session_precision(self):
        from jungsi_touch.application.time_contract import utc_text
        candidate=deepcopy(self.body);candidate['approval']['expires_at']='2026-10-08T00:00:00.000500Z'
        candidate['catalog']['as_of']='2026-10-08T00:00:00.123456Z'
        parsed=scope(candidate).validate(self.clock.now())
        self.assertEqual(utc_text(parsed['catalog']['as_of']),'2026-10-08T00:00:00.123456Z')
        with self.assertRaises(PlatformError):scope(candidate).validate(datetime(2026,10,8,0,0,0,500,tzinfo=timezone.utc))
        class MicroRepository(Repository):
            def active_paid(self,owner,now):return owner==SUBJECT
            def active_paid_until(self,owner,now):return datetime(2026,10,8,0,0,0,500,tzinfo=timezone.utc)
        app=create_official_history_display_app(provider=self.provider,security=SecuritySettings(RELAY),settings=ServerSettings(),repository=MicroRepository(),sessions=Sessions(),clock=self.clock)
        result=TestClient(app,headers={'X-Jungsi-Relay-Token':RELAY,'Authorization':'Bearer SYNTHETIC-user'}).get('/api/v1/me')
        self.assertEqual(result.status_code,200,result.text)
        self.assertEqual(result.json()['entitlement_expires_at'],'2026-10-08T00:00:00.000500Z')

    def test_unqualified_real_connector_is_closed_before_connection(self):
        calls=[]
        p=PostgresOfficialHistoryDisplayProvider(scope=scope(self.body),clock=self.clock,database_url='SYNTHETIC-DSN',sslrootcert='SYNTHETIC-CA',connector=lambda *a,**k:calls.append((a,k)))
        with self.assertRaises(PlatformError):p.get_catalog()
        self.assertEqual(calls,[])

    def test_sql_bulk_parameters_tls_rls_and_readonly_not_n_plus_one(self):
        from jungsi_touch.infrastructure.official_history_display import GUARD_FIELDS
        statements=[]
        body=deepcopy(self.body)
        definition="SELECT 'SYNTHETIC'::text"
        body['read_strategy']=dict(name='uncurated_pk_equivalent',equivalence_receipt_sha256='e'*64,rls_receipt_sha256='f'*64,join_receipt_sha256='a'*64,
             snapshot_revision='v21_1',active_view_chain=[dict(schema='jungsi_data_ingest',relation='admission_results_curated_v21_1',view_definition_sha256=hashlib.sha256(definition.encode()).hexdigest(),reloptions=['security_invoker=true'])],active_curation_release_ids=['SYNTHETIC-curation'])
        class Cursor:
            def __init__(self,value):self.value=value
            def fetchone(self):return self.value
            def fetchall(self):return self.value
        rows=self.rows
        class Connection:
            def __enter__(self):return self
            def __exit__(self,*_):pass
            def execute(self,sql,params=None):
                statements.append((sql,params))
                if 'c.relname,c.relkind' in sql:
                    return Cursor([('admission_results_curated_v21_1','v',False,False,['security_invoker=true'],False,True,False,False,False,definition)]+[(name,'r',True,True,None,False,True,False,False,False,None)for name in('admission_results','curation_overlays','school_scope_overlays')])
                if 'pg_catalog.pg_class' in sql:return Cursor(('jungsi_backend_app',False,False,False,True,False,'on','on',False,False,False))
                if sql.startswith('WITH selected'):return Cursor([tuple(r[k] for k in DB_FIELDS)+(None,)*len(GUARD_FIELDS) for r in rows])
                return Cursor(None)
        def connect(url,**kwargs):
            self.assertEqual(url,'SYNTHETIC-DSN')
            self.assertEqual(kwargs['sslmode'],'verify-full');self.assertEqual(kwargs['sslrootcert'],'SYNTHETIC-CA')
            return Connection()
        provider=PostgresOfficialHistoryDisplayProvider(scope=scope(body),clock=self.clock,database_url='SYNTHETIC-DSN',sslrootcert='SYNTHETIC-CA',connector=connect)
        self.assertEqual(len(provider.get_catalog().history),3)
        data=[s for s in statements if s[0].startswith('WITH selected')]
        self.assertEqual(len(data),1)
        self.assertEqual(data[0][1][1],[r['result_id'] for r in rows])
        self.assertIn('LEFT JOIN jungsi_data_ingest.curation_overlays',data[0][0])
        self.assertIn('LEFT JOIN jungsi_data_ingest.school_scope_overlays',data[0][0])
        self.assertEqual(data[0][1][2],['SYNTHETIC-curation'])
        metadata=[entry for entry in statements if entry[0].startswith('WITH qualified')]
        self.assertEqual(len(metadata),1)
        self.assertEqual(metadata[0][1],(['jungsi_data_ingest.'+name for name in ('admission_results_curated_v21_1','admission_results','curation_overlays','school_scope_overlays')],))
        self.assertIn('to_regclass(scoped.qualified_name)',metadata[0][0])
        self.assertIn('c.oid=q.target_oid',metadata[0][0])
        for guard in ("n.nspname='jungsi_data_ingest'", "current_user='jungsi_backend_app'", 'NOT r.rolsuper', 'NOT r.rolbypassrls', "current_setting('row_security')='on'", "current_setting('transaction_read_only')='on'", "NOT pg_has_role(current_user,'jungsi_backend_owner','MEMBER')", "NOT pg_has_role(current_user,'jungsi_backend_owner','USAGE')", "NOT pg_has_role(current_user,'postgres','MEMBER')"):
            self.assertIn(guard,metadata[0][0])
        self.assertTrue(any('c.relrowsecurity,c.relforcerowsecurity' in entry[0]for entry in statements))
        self.assertTrue(any('READ ONLY' in s[0] for s in statements))
        self.assertFalse(any(s[0].startswith(('INSERT','UPDATE','DELETE','GRANT','ALTER')) for s in statements))

    def test_effective_rls_or_parent_view_drift_rejects_before_payload_sql(self):
        for mode in('bypass','force_disabled','view_changed','public_grant','missing_relation'):
            with self.subTest(mode=mode):
                body=deepcopy(self.body);definition="SELECT 'SYNTHETIC'::text";calls=[]
                body['read_strategy']=dict(name='uncurated_pk_equivalent',equivalence_receipt_sha256='e'*64,rls_receipt_sha256='f'*64,join_receipt_sha256='a'*64,
                    snapshot_revision='v21_1',active_view_chain=[dict(schema='jungsi_data_ingest',relation='admission_results_curated_v21_1',view_definition_sha256=hashlib.sha256(definition.encode()).hexdigest(),reloptions=['security_invoker=true'])],active_curation_release_ids=['SYNTHETIC-curation'])
                class Cursor:
                    def __init__(self,v):self.v=v
                    def fetchone(self):return self.v
                    def fetchall(self):return self.v
                class Connection:
                    def __enter__(self):return self
                    def __exit__(self,*_):pass
                    def execute(self,sql,params=None):
                        calls.append(sql)
                        if 'c.relname,c.relkind'in sql:
                            view=('admission_results_curated_v21_1','v',False,False,['security_invoker=true'],False,True,False,mode=='public_grant',False,definition+' changed'if mode=='view_changed'else definition)
                            physical=[(name,'r',True,mode!='force_disabled',None,False,True,False,False,False,None)for name in('admission_results','curation_overlays','school_scope_overlays')]
                            return Cursor([view]+(physical[:-1]if mode=='missing_relation'else physical))
                        if 'pg_catalog.pg_class'in sql:return Cursor(('jungsi_backend_app',False,mode=='bypass',False,True,False,'on','on',False,False,False))
                        return Cursor(None)
                p=PostgresOfficialHistoryDisplayProvider(scope=scope(body),clock=self.clock,database_url='SYNTHETIC-DSN',sslrootcert='SYNTHETIC-CA',connector=lambda *a,**k:Connection())
                with self.assertRaises(PlatformError):p.get_catalog()
                self.assertFalse(any(s.startswith('WITH selected')for s in calls))

    def test_guarded_overlay_change_is_not_an_equivalent_pk_snapshot(self):
        from jungsi_touch.infrastructure.official_history_display import GUARD_FIELDS
        body=deepcopy(self.body);body['read_strategy']=dict(name='uncurated_pk_equivalent',equivalence_receipt_sha256='e'*64,rls_receipt_sha256='f'*64,join_receipt_sha256='a'*64,
            snapshot_revision='v21_1',active_view_chain=[dict(schema='jungsi_data_ingest',relation='admission_results_curated_v21_1',view_definition_sha256='b'*64,reloptions=['security_invoker=true'])],active_curation_release_ids=['SYNTHETIC-curation'])
        rows=[dict(r,**dict.fromkeys(GUARD_FIELDS))for r in self.rows]
        for key,value in [('guard_active_curation_release_id','SYNTHETIC new overlay'),('guard_school_source_school_id','SYNTHETIC other school'),('guard_school_after_row_fingerprint','c'*64)]:
            with self.subTest(key=key):
                candidate=deepcopy(rows);candidate[0][key]=value
                p=PostgresOfficialHistoryDisplayProvider(scope=scope(body),clock=self.clock,reader=lambda _:candidate)
                with self.assertRaises(PlatformError):p.get_catalog()
