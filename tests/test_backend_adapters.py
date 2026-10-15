"""Synthetic transport/storage contracts. These are NOT live Supabase/Drive checks."""
import base64
from copy import deepcopy
from datetime import date,timedelta
import hashlib
import json
from pathlib import Path
import sys
import unittest
from urllib.error import HTTPError
from urllib.parse import parse_qs,urlsplit

ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'src'))
from backend_synthetic_fixture import FrozenClock,SyntheticRepository
from jungsi_touch.application.time_contract import UTC,SEOUL,utc_instant,utc_text,calendar_date,seoul_date_range
from jungsi_touch.application.platform_ports import PlatformError
from jungsi_touch.application.sessions import SessionService
from jungsi_touch.infrastructure.supabase_session import SupabaseSessionProvider
from jungsi_touch.infrastructure.postgres_repository import PostgresRepository,EXPECTED_COLUMN_TYPES
from jungsi_touch.infrastructure.drive_provider import DriveClient,DriveDataProvider
from jungsi_touch.infrastructure.settings import ServerSettings


class Response:
    def __init__(self,value):self.content=value if isinstance(value,bytes) else json.dumps(value).encode()
    def read(self,limit=-1):return self.content[:limit] if limit>=0 else self.content
    def __enter__(self):return self
    def __exit__(self,*args):return False


class TimeContractTests(unittest.TestCase):
    def test_seoul_midnight_year_boundary(self):
        self.assertEqual(utc_text(utc_instant('2027-01-01T00:00:00+09:00')),'2026-12-31T15:00:00Z')
    def test_leap_day_and_month_boundary(self):
        self.assertEqual(utc_text(utc_instant('2024-03-01T00:00:00+09:00')),'2024-02-29T15:00:00Z')
        with self.assertRaises(ValueError):utc_instant('2025-02-29T00:00:00+09:00')
    def test_fractional_round_trip_to_seoul(self):
        value=utc_instant('2027-01-01T00:00:00.123456+09:00')
        self.assertEqual(utc_text(value),'2026-12-31T15:00:00.123456Z')
        self.assertEqual(value.astimezone(SEOUL).isoformat(),'2027-01-01T00:00:00.123456+09:00')
    def test_z_offset_equal_instants(self):
        self.assertEqual(utc_instant('2027-01-01T00:00:00+09:00'),utc_instant('2026-12-31T15:00:00Z'))
    def test_naive_requires_explicit_source_contract(self):
        with self.assertRaises(ValueError):utc_instant('2027-01-01T00:00:00')
        self.assertEqual(utc_text(utc_instant('2027-01-01T00:00:00',source_timezone='Asia/Seoul')),'2026-12-31T15:00:00Z')
    def test_date_only_is_preserved_not_an_instant(self):
        self.assertEqual(calendar_date('2027-01-01'),date(2027,1,1))
        with self.assertRaises(ValueError):utc_instant('2027-01-01',source_timezone='Asia/Seoul')
        with self.assertRaises(ValueError):calendar_date(utc_instant('2027-01-01T00:00:00Z'))
    def test_local_day_range_half_open_utc(self):
        start,end=seoul_date_range('2027-01-01','2027-01-01')
        self.assertEqual((utc_text(start),utc_text(end)),('2026-12-31T15:00:00Z','2027-01-01T15:00:00Z'))
        self.assertEqual(end-start,timedelta(days=1))
        with self.assertRaises(ValueError):seoul_date_range('2027-01-02','2027-01-01')
    def test_precision_and_offset_do_not_silently_normalize(self):
        for value in ('2027-01-01T00:00:00.1234567+09:00','2027-01-01T00:00:00+09:61','2027-01-01T00:00:00+25:00','2027-01-01T00:00:00+0961'):
            with self.subTest(value=value),self.assertRaises(ValueError):utc_instant(value)
    def test_expiry_before_equal_after_utc(self):
        clock=FrozenClock();repo=SyntheticRepository();owner='SYNTHETIC-owner'
        now=clock.now();repo.entitlements[owner]=dict(active=True,starts_at=now-timedelta(days=1),expires_at=now)
        self.assertTrue(repo.active_paid(owner,now-timedelta(microseconds=1)))
        self.assertFalse(repo.active_paid(owner,now));self.assertFalse(repo.active_paid(owner,now+timedelta(microseconds=1)))
    def test_drive_utc_metadata_is_not_relabelled_as_seoul(self):
        self.assertEqual(utc_text(utc_instant('2026-12-31T15:00:00Z',source_timezone='Asia/Seoul')),'2026-12-31T15:00:00Z')


def jwt(subject,expires,**claims):
    payload=dict(sub=subject,exp=int(expires.timestamp()),**claims)
    encoded=base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip('=')
    return 'SYNTHETIC.'+encoded+'.SYNTHETIC'


class SupabaseSessionTests(unittest.TestCase):
    def setUp(self):self.clock=FrozenClock();self.owner='00000000-0000-0000-0000-000000000001';self.calls=[]
    def opener(self,request,timeout):
        self.calls.append((request,timeout));return Response(dict(id=self.owner,user_metadata={'paid_active':True}))
    def test_server_getuser_before_identity_expiry_and_paid_context(self):
        provider=SupabaseSessionProvider('https://example.supabase.co','SYNTHETIC-KEY',opener=self.opener)
        token=jwt(self.owner,self.clock.now()+timedelta(hours=1),paid_active=True)
        actor=SessionService(provider,SyntheticRepository(),self.clock).actor('Bearer '+token)
        self.assertEqual(actor.subject_id,self.owner);self.assertFalse(actor.paid_active)
        self.assertEqual(self.calls[0][0].full_url,'https://example.supabase.co/auth/v1/user')
        self.assertEqual(self.calls[0][1],5)
    def test_server_rejection_cannot_fall_back_to_decoded_claims(self):
        def rejected(request,timeout):raise HTTPError(request.full_url,401,'Unauthorized',{},None)
        provider=SupabaseSessionProvider('https://example.supabase.co','SYNTHETIC-KEY',opener=rejected)
        self.assertIsNone(provider.verify(jwt(self.owner,self.clock.now()+timedelta(hours=1)),self.clock.now()))
    def test_expired_mismatched_and_malformed_claims_are_denied(self):
        provider=SupabaseSessionProvider('https://example.supabase.co','SYNTHETIC-KEY',opener=self.opener)
        for token in (jwt(self.owner,self.clock.now()),jwt('00000000-0000-0000-0000-000000000002',self.clock.now()+timedelta(hours=1)),'malformed'):
            self.assertIsNone(provider.verify(token,self.clock.now()))
    def test_no_auth_configuration_is_explicit(self):
        with self.assertRaises(PlatformError) as caught:SupabaseSessionProvider(None,None).verify('fabricated',self.clock.now())
        self.assertEqual(caught.exception.code,'auth_not_configured')
    def test_assurance_is_bound_to_the_verified_exact_token(self):
        provider=SupabaseSessionProvider('https://example.supabase.co','SYNTHETIC-KEY',opener=self.opener)
        expires=self.clock.now()+timedelta(hours=1)
        for assurance in ('aal1','aal2'):
            session=provider.verify(jwt(self.owner,expires,aal=assurance),self.clock.now())
            self.assertEqual(session.assurance_level,assurance)
        self.assertIsNone(provider.verify(jwt(self.owner,expires),self.clock.now()).assurance_level)
        for assurance in (True,2,'aal3',{'aal':'aal2'}):
            self.assertIsNone(provider.verify(jwt(self.owner,expires,aal=assurance),self.clock.now()))
        def rejected(request,timeout):raise HTTPError(request.full_url,401,'Unauthorized',{},None)
        denied=SupabaseSessionProvider('https://example.supabase.co','SYNTHETIC-KEY',opener=rejected)
        self.assertIsNone(denied.verify(jwt(self.owner,expires,aal='aal2'),self.clock.now()))
    def test_profile_status_uses_verified_bearer_and_own_row_rls_once(self):
        token=jwt(self.owner,self.clock.now()+timedelta(hours=1),aal='aal2')
        requests=[]
        def opened(request,timeout):
            requests.append(request)
            if '/auth/v1/user' in request.full_url:return Response(dict(id=self.owner,user_metadata={'status':'active','role':'admin'}))
            self.assertEqual(parse_qs(urlsplit(request.full_url).query),{'select':['role,status'],'id':['eq.'+self.owner],'limit':['1']})
            self.assertEqual(request.get_header('Authorization'),'Bearer '+token)
            self.assertEqual(request.get_header('Apikey'),'SYNTHETIC-KEY')
            return Response([{'status':'active','role':'admin'}])
        session=SupabaseSessionProvider('https://example.supabase.co','SYNTHETIC-KEY',opener=opened).verify(token,self.clock.now())
        self.assertEqual(session.account_status,'active');self.assertEqual(session.assurance_level,'aal2')
        self.assertEqual(session.account_role,'admin')
        self.assertEqual(len(requests),2)
    def test_profile_missing_malformed_or_denied_is_unknown_without_discarding_session(self):
        token=jwt(self.owner,self.clock.now()+timedelta(hours=1),aal='aal2')
        values=[[],[{'status':'active'},{'status':'active'}],[{'status':None}],[{'status':True}],
                [{'status':'active','id':self.owner}],b'[{"status":"suspended","status":"active"}]',b' '*2049]
        for value in values:
            def opened(request,timeout):
                return Response(dict(id=self.owner)) if '/auth/v1/user' in request.full_url else Response(value)
            with self.subTest(value=value):
                session=SupabaseSessionProvider('https://example.supabase.co','SYNTHETIC-KEY',opener=opened).verify(token,self.clock.now())
                self.assertIsNotNone(session);self.assertIsNone(session.account_status)
        def denied(request,timeout):
            if '/auth/v1/user' in request.full_url:return Response(dict(id=self.owner,user_metadata={'status':'active'}))
            raise HTTPError(request.full_url,403,'SYNTHETIC-private',{},None)
        session=SupabaseSessionProvider('https://example.supabase.co','SYNTHETIC-KEY',opener=denied).verify(token,self.clock.now())
        self.assertIsNone(session.account_status)
    def test_nonactive_profile_status_is_preserved_despite_active_client_metadata(self):
        token=jwt(self.owner,self.clock.now()+timedelta(hours=1),aal='aal2',account_status='active')
        def opened(request,timeout):
            return Response(dict(id=self.owner,user_metadata={'status':'active'})) if '/auth/v1/user' in request.full_url else Response([{'status':'suspended'}])
        session=SupabaseSessionProvider('https://example.supabase.co','SYNTHETIC-KEY',opener=opened).verify(token,self.clock.now())
        self.assertEqual(session.account_status,'suspended')
    def test_auth_network_error_never_contains_secret_in_public_message(self):
        def failed(*args,**kwargs):raise OSError('SYNTHETIC-PRIVATE-PASSWORD')
        provider=SupabaseSessionProvider('https://example.supabase.co','SYNTHETIC-KEY',opener=failed)
        with self.assertRaises(PlatformError) as caught:provider.verify('fabricated',self.clock.now())
        self.assertEqual(str(caught.exception),'auth_unavailable')


class FakePgConnection:
    def __init__(self,*,missing_schema=False,default_zone='UTC',wrong_type=False,forecast_missing=False,forecast_unversioned=False,forecast_partial=False,forecast_rls=False,forecast_constraint=False,forecast_grant=False):
        self.calls=[];self.missing_schema=missing_schema;self.default_zone=default_zone;self.utc=False;self.row=None;self.rows=[];self.wrong_type=wrong_type
        self.forecast_missing=forecast_missing;self.forecast_unversioned=forecast_unversioned;self.forecast_partial=forecast_partial;self.forecast_rls=forecast_rls;self.forecast_constraint=forecast_constraint;self.forecast_grant=forecast_grant
    def __enter__(self):return self
    def __exit__(self,*args):return False
    def execute(self,query,params=None):
        self.calls.append((query,params))
        if query.startswith('SET LOCAL'):self.utc=True;self.row=None
        elif query=='SHOW TIMEZONE':self.row=('UTC' if self.utc else self.default_zone,)
        elif query.startswith('SELECT %s::timestamptz'):self.row=params
        elif 'to_regclass' in query:self.row=(None,)*query.count('to_regclass') if self.missing_schema or (self.forecast_missing and 'forecast_' in query) else ('synthetic_table',)*query.count('to_regclass')
        elif 'schema_versions' in query:self.row=(not (self.forecast_unversioned and '002_forecast_policy' in query),)
        elif 'entitlements' in query:self.row=(False,)
        elif 'information_schema.columns' in query and 'is_nullable' in query:
            from jungsi_touch.infrastructure.forecast_schema import COLUMN_TYPES
            self.rows=[(t,col,'timestamp' if self.forecast_partial and (t,col)==('forecast_releases','published_at') else kind,'NO') for (t,col),kind in COLUMN_TYPES.items()]
        elif 'pg_get_constraintdef' in query:
            from jungsi_touch.infrastructure.forecast_schema import CONSTRAINTS
            self.rows=[(t,kind,definition) for (t,kind),definition in CONSTRAINTS.items() if not (self.forecast_constraint and (t,kind)==('forecast_revisions','f'))]
        elif 'relrowsecurity' in query:
            from jungsi_touch.infrastructure.forecast_schema import TABLES
            self.rows=[(t,not(self.forecast_rls and t=='forecast_drafts')) for t in TABLES]
        elif 'has_table_privilege' in query:
            from jungsi_touch.infrastructure.forecast_schema import TABLES
            self.rows=[(t,role,self.forecast_grant and t=='forecast_drafts' and role=='authenticated') for t in TABLES for role in ('anon','authenticated')]
        elif 'information_schema.columns' in query:self.rows=[(t,col,'timestamp' if self.wrong_type and (t,col)==('profiles','created_at') else kind) for (t,col),kind in EXPECTED_COLUMN_TYPES.items()]
        else:self.row=None
        return self
    def fetchone(self):return self.row
    def fetchall(self):return self.rows


class PostgreSQLContractTests(unittest.TestCase):
    def connector(self,**values):
        connection=FakePgConnection(**values);calls=[]
        def connect(url,**kwargs):calls.append((url,kwargs));return connection
        return PostgresRepository('SYNTHETIC-DSN',connector=connect),connection,calls
    def test_read_only_probe_utc_timestamptz_date_schema_and_pool_options(self):
        repo,connection,calls=self.connector();result=repo.probe()
        self.assertEqual(result['status'],'verified');self.assertEqual(result['storage_schema'],'verified')
        options=calls[0][1]
        self.assertIsNone(options['prepare_threshold']);self.assertNotIn('options',options)
        self.assertEqual(options['sslmode'],'require')
        self.assertFalse(any(q.startswith(('INSERT','UPDATE','DELETE','DROP')) for q,p in connection.calls))
        self.assertEqual(connection.calls[0][0],'SET TRANSACTION READ ONLY')
        stamp=next(p for q,p in connection.calls if q.startswith('SELECT %s::timestamptz'))[0]
        self.assertEqual(stamp.tzinfo,UTC)
    def test_missing_schema_is_not_ready_even_when_time_roundtrip_passes(self):
        repo,connection,calls=self.connector(missing_schema=True)
        result=repo.probe();self.assertTrue(result['instant_round_trip']);self.assertEqual(result['status'],'failed')
        self.assertEqual(result['storage_schema'],'missing_or_unversioned')
    def test_default_database_timezone_mismatch_is_distinct_from_session_utc(self):
        repo,connection,calls=self.connector(default_zone='Asia/Seoul');result=repo.probe()
        self.assertEqual(result['default_timezone'],'Asia/Seoul');self.assertEqual(result['session_timezone'],'UTC')
        self.assertEqual(result['status'],'failed')
    def test_existing_timestamp_without_timezone_type_blocks_readiness(self):
        repo,connection,calls=self.connector(wrong_type=True);result=repo.probe()
        self.assertEqual(result['storage_schema'],'verified');self.assertEqual(result['status'],'failed')
        self.assertEqual(result['type_mismatches'],{'profiles.created_at':'timestamp'})
    def test_missing_partial_or_unsafe_forecast_schema_blocks_readiness(self):
        for flag in ('forecast_missing','forecast_unversioned','forecast_partial','forecast_rls','forecast_constraint','forecast_grant'):
            with self.subTest(flag=flag):
                repo,connection,calls=self.connector(**{flag:True});result=repo.probe()
                self.assertEqual(result['status'],'failed');self.assertEqual(result['forecast_schema']['status'],'failed')
                self.assertEqual(result['storage_schema'],'verified')
                self.assertFalse(any(q.startswith(('INSERT','UPDATE','DELETE','DROP','ALTER','CREATE')) for q,p in connection.calls))
    def test_forecast_migration_is_additive_and_matches_the_required_security_shape(self):
        from jungsi_touch.infrastructure.forecast_schema import TABLES
        sql=(ROOT/'database/migrations/002_forecast_policy.sql').read_text(encoding='utf-8')
        self.assertNotRegex(sql,r'(?im)^\s*(DROP|DELETE|TRUNCATE)\b')
        for table in TABLES:
            self.assertIn('CREATE TABLE IF NOT EXISTS jungsi_backend.'+table,sql)
            self.assertIn('ALTER TABLE jungsi_backend.'+table+' ENABLE ROW LEVEL SECURITY',sql)
        self.assertIn('CHECK(revision>0)',sql);self.assertIn('REFERENCES jungsi_backend.forecast_drafts(draft_id)',sql)
        self.assertIn('FROM PUBLIC,anon,authenticated',sql);self.assertIn("'002_forecast_policy'",sql)
    def test_entitlement_query_uses_server_owner_and_utc_expiry(self):
        repo,connection,calls=self.connector();clock=FrozenClock()
        self.assertFalse(repo.active_paid('SYNTHETIC-owner',clock.now()))
        query,params=connection.calls[-1]
        self.assertIn('expires_at>%s',query);self.assertEqual(params[0],'SYNTHETIC-owner')
        self.assertTrue(all(v.tzinfo==UTC for v in params[1:]))
    def test_owned_resource_reads_use_parameterized_owner_predicates(self):
        repo,connection,calls=self.connector();repo.get_profile('SYNTHETIC-owner','SYNTHETIC-profile');repo.get_report('SYNTHETIC-owner','SYNTHETIC-report')
        queries=[(q,p) for q,p in connection.calls if 'WHERE' in q]
        self.assertTrue(all('owner_id=%s' in q and 'SYNTHETIC-owner' in p for q,p in queries))
    def test_additive_schema_date_and_timestamptz_have_no_destructive_statements(self):
        sql=(ROOT/'database/migrations/001_pre_data_platform.sql').read_text(encoding='utf-8')
        self.assertIn('source_as_of date',sql);self.assertIn('created_at timestamptz',sql)
        self.assertIn('report_revisions',sql);self.assertIn('ENABLE ROW LEVEL SECURITY',sql)
        self.assertNotRegex(sql,r'(?im)^\s*(DROP|DELETE|TRUNCATE)\b')
    def test_setting_repr_and_status_omit_values(self):
        s=ServerSettings(database_url='SYNTHETIC-PRIVATE-DSN',drive_token='SYNTHETIC-PRIVATE-TOKEN')
        self.assertNotIn('SYNTHETIC-PRIVATE',repr(s));self.assertNotIn('DATABASE_URL',s.missing())


class DriveAdapterTests(unittest.TestCase):
    def setUp(self):
        self.clock=FrozenClock();self.content=json.dumps({'format':'jungsi.catalog-release/v1','version':'SYNTHETIC-v1','status':'approved',
            'as_of':'2027-01-01T00:00:00','offerings':[],'history':[]}).encode()
        self.entry=dict(kind='catalog',key='service',version='SYNTHETIC-v1',file_id='SYNTHETIC-FILE',drive_version='7',status='approved',
            sha256=hashlib.sha256(self.content).hexdigest(),source_timezone='Asia/Seoul')
        self.meta=dict(id='SYNTHETIC-FILE',parents=['SYNTHETIC-INPUT'],trashed=False,version='7',createdTime='2026-12-31T15:00:00Z',modifiedTime='2026-12-31T16:00:00.123456Z')
        self.calls=[];self.created=None
    def opener(self,request,timeout):
        self.calls.append(request)
        if '/upload/' in request.full_url:
            self.created=dict(id='SYNTHETIC-RESULT',appProperties={})
            # Extract the metadata properties from the retained multipart request.
            header=request.data.split(b'\r\n\r\n',1)[1].split(b'\r\n--',1)[0]
            self.created['appProperties']=json.loads(header)['appProperties']
            return Response({'id':self.created['id']})
        if 'alt=media' in request.full_url:return Response(self.content)
        if 'files?' in request.full_url:return Response({'files':[self.created] if self.created else []})
        return Response(self.meta)
    def client(self):return DriveClient('SYNTHETIC-OAUTH','SYNTHETIC-INPUT','SYNTHETIC-OUTPUT',opener=self.opener)
    def provider(self):return DriveDataProvider(self.client(),dict(format='jungsi.data-registry/v1',entries=[self.entry]))
    def test_approved_pinned_hash_version_folder_and_source_local_time(self):
        catalog=self.provider().get_catalog()
        self.assertEqual(utc_text(catalog.as_of),'2026-12-31T15:00:00Z')
        raw,metadata=self.client().artifact(self.entry)
        self.assertEqual(metadata['created_at'],'2026-12-31T15:00:00Z')
        self.assertEqual(metadata['modified_at'],'2026-12-31T16:00:00.123456Z')
    def test_wrong_hash_version_folder_and_trashed_fail_without_adoption(self):
        for change,code in [({'sha256':'0'*64},'drive_hash_mismatch'),({'drive_version':'8'},'drive_version_mismatch')]:
            with self.subTest(code=code),self.assertRaises(PlatformError) as caught:self.client().artifact(dict(self.entry,**change))
            self.assertEqual(caught.exception.code,code)
        self.meta['parents']=['SYNTHETIC-OTHER']
        with self.assertRaises(PlatformError) as caught:self.client().artifact(self.entry)
        self.assertEqual(caught.exception.code,'drive_folder_mismatch')
        self.meta['parents']=['SYNTHETIC-INPUT'];self.meta['trashed']=True
        with self.assertRaises(PlatformError):self.client().artifact(self.entry)
    def test_unapproved_and_duplicate_registry_entries_rejected(self):
        self.entry['status']='verified'
        with self.assertRaises(PlatformError) as caught:self.provider().get_catalog()
        self.assertEqual(caught.exception.code,'artifact_not_approved');self.assertEqual(self.calls,[])
        with self.assertRaises(PlatformError):DriveDataProvider(self.client(),dict(format='jungsi.data-registry/v1',entries=[self.entry,self.entry]))
    def test_result_append_retry_and_conflict_never_delete_or_patch(self):
        client=self.client();payload=dict(report_id='SYNTHETIC-report',version=1)
        first=client.append_result('SYNTHETIC-owner','report.export','SYNTHETIC-key',payload,self.clock.now())
        again=client.append_result('SYNTHETIC-owner','report.export','SYNTHETIC-key',payload,self.clock.now())
        self.assertEqual(first['status'],'created');self.assertEqual(again['status'],'already_written')
        with self.assertRaises(PlatformError) as caught:client.append_result('SYNTHETIC-owner','report.export','SYNTHETIC-key',dict(version=2),self.clock.now())
        self.assertEqual(caught.exception.code,'drive_result_conflict')
        self.assertEqual(sum('/upload/' in call.full_url for call in self.calls),1)
        self.assertTrue(all(call.get_method() in ('GET','POST') for call in self.calls))
    def test_write_output_scope_is_server_fixed_and_distinct(self):
        client=DriveClient('SYNTHETIC-OAUTH','SYNTHETIC-INPUT','SYNTHETIC-INPUT',opener=self.opener)
        with self.assertRaises(PlatformError) as caught:client.append_result('SYNTHETIC-owner','export','key',{},self.clock.now())
        self.assertEqual(caught.exception.code,'drive_output_scope_conflict')
    def test_metadata_precision_is_rejected_not_truncated(self):
        self.meta['modifiedTime']='2026-12-31T16:00:00.1234567Z'
        with self.assertRaises(ValueError):self.client().artifact(self.entry)


if __name__=='__main__':unittest.main()
