"""Synthetic candidate HTTP acceptance; no DB, Auth or cloud access."""
from copy import deepcopy
from dataclasses import asdict
import json
from hashlib import sha256
from io import BytesIO
from pathlib import Path
import unittest
from fastapi.testclient import TestClient
from backend_synthetic_fixture import SyntheticRepository, synthetic_pack, synthetic_model, SyntheticSessions, FrozenClock, score_input, SyntheticData
from jungsi_touch.application.platform_ports import PlatformError
from jungsi_touch.infrastructure.settings import ServerSettings
from jungsi_touch.infrastructure.supabase_storage import SupabaseStorageClient, SupabaseStorageDataProvider
from jungsi_touch.infrastructure.secured_http import SecuritySettings, create_secured_app
import jungsi_touch.infrastructure.http_api as legacy

BASE_HTTP = Path(legacy.__file__)
import jungsi_touch.infrastructure.supabase_runtime as runtime
Selection = runtime.RuntimeArtifactSelection
TOKEN = 'SYNTHETIC-relay-token-for-testing-only-000000'

class SupabaseRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.network, self.db = [], []
        self.payload=deepcopy(synthetic_pack()._data)
        self.content=json.dumps(self.payload,ensure_ascii=False).encode()
        self.objects={}
        self.bucket=dict(id='synthetic-private',public=False,file_size_limit=50*1024*1024)
        owner=self
        class Response(BytesIO):
            status=200
            def __init__(self,content,url):super().__init__(content);self.url=url
            def geturl(self):return self.url
        def transport(request, **options):
            owner.network.append(request)
            content=json.dumps(owner.bucket).encode() if '/bucket/' in request.full_url else owner.objects.get(request.full_url.rsplit('/synthetic/',1)[-1],owner.content)
            return Response(content,request.full_url)
        self.client = SupabaseStorageClient('https://synthetic.supabase.co', 'sb_secret_SYNTHETIC_ONLY',
                                           'synthetic-private', object_prefix='synthetic/', opener=transport)
        self.entry = dict(kind='exam_pack', key=self.payload['exam']['exam_id'], bucket='synthetic-private',
                          object_key='synthetic/exam.json', bytes=len(self.content), sha256=sha256(self.content).hexdigest(),
                          version=self.payload['pack_version'],status='approved',engine_approved=True,
                          production_allowed=True,archive_only=False)
        self.settings = ServerSettings(supabase_url='https://synthetic.supabase.co',
                                       supabase_key='SYNTHETIC-publishable', database_url='SYNTHETIC-private-reference')
        self.repository = SyntheticRepository()
        def probe(): self.db.append('read-only-probe'); return dict(status='verified', private_detail='SYNTHETIC-private')
        self.repository.probe = probe
        self.selection = Selection((('exam_pack','SYNTHETIC-mock'),))
    def provider(self, entries=None):
        return SupabaseStorageDataProvider(self.client, dict(format='jungsi.data-registry/v1',
                                    entries=deepcopy([self.entry] if entries is None else entries)))
    def app(self, **changes):
        args=dict(security=SecuritySettings(TOKEN), settings=self.settings, data=self.provider(),
                  selection=self.selection, repository=self.repository)
        args.update(changes)
        return runtime.create_supabase_secured_app(**args)
    def ready(self, app, token=TOKEN):
        with TestClient(app) as c: return c.get('/health/ready', headers={'X-Jungsi-Relay-Token':token})
    def test_baseline_legacy_drive_requirement_is_reproduced_and_preserved(self):
        app=create_secured_app(security=SecuritySettings(TOKEN), settings=self.settings,
                               repository=self.repository, data=self.provider())
        self.assertEqual(self.ready(app).status_code,503)
        self.assertEqual(set(self.settings.missing()), {'GOOGLE_DRIVE_ACCESS_TOKEN','GOOGLE_DRIVE_INPUT_FOLDER',
                                                      'GOOGLE_DRIVE_OUTPUT_FOLDER','JUNGSI_DRIVE_REGISTRY'})
    def test_explicit_storage_selection_does_not_require_drive(self):
        response=self.ready(self.app())
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(response.json(),dict(status='ready',server_timezone='UTC',production_ready=False,
                                               security_boundary='scoped_preparation'))
        self.assertEqual(len(self.network),2)
        self.assertTrue(all(r.get_method()=='GET' and r.data is None for r in self.network))
    def test_auth_and_database_settings_still_required(self):
        fields=dict(supabase_url=self.settings.supabase_url,supabase_key=self.settings.supabase_key,
                    database_url=self.settings.database_url)
        for name in fields:
            with self.subTest(name=name):
                value=dict(fields);value[name]=None
                self.assertEqual(self.ready(self.app(settings=ServerSettings(**value))).status_code,503)
    def test_missing_or_nonapproved_required_artifact_is_not_ready(self):
        values=[[],[dict(self.entry,status='staged')],[dict(self.entry,status='draft')],
                [dict(self.entry,engine_approved=False)],[dict(self.entry,production_allowed=False)],
                [dict(self.entry,archive_only=True)],[dict(self.entry,archive_only=None)],
                [dict(self.entry,engine_approved='true')],[dict(self.entry,production_allowed=1)]]
        for entries in values:
            with self.subTest(entries=entries):self.assertEqual(self.ready(self.app(data=self.provider(entries))).status_code,503)
        self.assertFalse(self.network)
    def test_required_dependency_missing_and_optional_hold_are_distinct(self):
        missing=Selection((('exam_pack','SYNTHETIC-mock'),('catalog','service')))
        self.assertEqual(self.ready(self.app(selection=missing)).status_code,503)
        held=dict(self.entry,kind='total_model',key='SYNTHETIC-exam:SYNTHETIC.v1',status='staged',engine_approved=False)
        self.assertEqual(self.ready(self.app(data=self.provider([self.entry,held]))).status_code,200)
        self.assertEqual(len(self.network),2)
    def test_source_candidate_kind_cannot_be_selected_as_runtime(self):
        with self.assertRaises(PlatformError):Selection((('source_candidate_exam_pack','SYNTHETIC-source'),))
    def test_invalid_or_duplicate_selection_is_rejected(self):
        for value in ((),[],(('exam_pack',''),),(('exam_pack','SYNTHETIC\n'),),
                      ((['exam_pack'],'SYNTHETIC'),),(('exam_pack','SYNTHETIC'),('exam_pack','SYNTHETIC'))):
            with self.subTest(value=value):
                with self.assertRaises(PlatformError):Selection(value)
    def test_failed_database_probe_keeps_safe_503(self):
        self.repository.probe=lambda:dict(status='failed',private_detail='SYNTHETIC-private')
        response=self.ready(self.app());self.assertEqual(response.status_code,503)
        self.assertNotIn('private_detail',response.text)
    def test_entitlement_probe_is_preserved(self):
        class Port:
            def probe(self):return dict(status='failed',private_detail='SYNTHETIC-private')
        self.assertEqual(self.ready(self.app(entitlements=Port())).status_code,503)
    def test_relay_denial_precedes_probe(self):
        app=self.app();self.assertEqual(self.ready(app,'SYNTHETIC-invalid').status_code,403)
        self.assertFalse(self.db);self.assertFalse(self.network)
        with TestClient(app) as c:self.assertEqual(c.get('/health/ready').status_code,403)
    def test_public_live_has_no_data_probe(self):
        with TestClient(self.app()) as c:self.assertEqual(c.get('/health/live').status_code,200)
        self.assertFalse(self.db);self.assertFalse(self.network)
    def test_existing_API_bindings_and_user_authentication_are_retained(self):
        app=self.app();ops=json.loads((BASE_HTTP.parents[1]/'application/route_catalog.json').read_text(encoding='utf-8'))['operations']
        self.assertEqual(len(ops),22)
        with TestClient(app) as c:
            self.assertEqual(c.get('/api/v1/me',headers={'X-Jungsi-Relay-Token':TOKEN}).status_code,401)
            for op in ops:
                path=op['path'].replace('{report_id}','SYNTHETIC-report').replace('{offering_id}','SYNTHETIC-offering').replace('{draft_id}','SYNTHETIC-draft')
                self.assertEqual(c.request(op['method'],path).status_code,403)
        self.assertFalse(self.network)
    def test_revoked_selection_cannot_keep_stale_readiness(self):
        data=self.provider();app=self.app(data=data)
        self.assertEqual(self.ready(app).status_code,200)
        data.entries[('exam_pack','SYNTHETIC-mock')]['engine_approved']=False
        self.assertEqual(self.ready(app).status_code,503)
    def test_hash_size_version_format_and_native_cells_fail_closed(self):
        original_content=self.content;original_entry=deepcopy(self.entry)
        cases=[('hash',dict(sha256='0'*64),None),('bytes',dict(bytes=len(original_content)+1),None),
               ('version',dict(version='SYNTHETIC-other.v1'),None),
               ('format',{},dict(self.payload,format='source-only/v1')),
               ('incomplete',{},dict(format='jungsi.exam-pack/v1',pack_version=self.entry['version']))]
        for label,patch,body in cases:
            with self.subTest(label=label):
                self.network.clear();self.content=original_content;entry=deepcopy(original_entry)
                if body is not None:
                    self.content=json.dumps(body,ensure_ascii=False).encode()
                    entry.update(bytes=len(self.content),sha256=sha256(self.content).hexdigest())
                entry.update(patch)
                response=self.ready(self.app(data=self.provider([entry])))
                self.assertEqual(response.status_code,503,response.text)
                self.assertEqual(set(response.json()),{'status','server_timezone','production_ready','security_boundary'})
                self.assertNotIn('sha256',response.text);self.assertNotIn('synthetic/exam.json',response.text)
    def test_bucket_and_transport_failure_are_safe(self):
        self.bucket['public']=True
        self.assertEqual(self.ready(self.app()).status_code,503)
        self.assertEqual(len(self.network),1)
    def add_artifact(self,kind,key,body,**extra):
        name=kind+'.json';content=json.dumps(body,ensure_ascii=False,default=str).encode()
        self.objects[name]=content
        entry=dict(self.entry,kind=kind,key=key,object_key='synthetic/'+name,bytes=len(content),
                   sha256=sha256(content).hexdigest(),version=body.get('version',body.get('pack_version')))
        entry.update(extra);return entry
    def model_body(self):
        model=synthetic_model(synthetic_pack());distribution=model.distribution
        return dict(format='jungsi.exam-total-model/v1',exam_id=model.exam_id,pack_version=model.pack_version,basis=model.basis,
                    distribution=dict(format='total_score_frequency/v1',metadata=asdict(distribution.metadata),
                        rows=[dict(total_score=r.total_score,weight=str(r.weight)) for r in distribution.frequency_rows()]))
    def test_missing_indirect_dependency_cannot_read_unselected_registry(self):
        entry=self.add_artifact('total_model','SYNTHETIC-mock:SYNTHETIC-pack.v1',self.model_body(),distribution_id='SYNTHETIC-model.v1')
        selection=Selection((('total_model',entry['key']),))
        self.assertEqual(self.ready(self.app(data=self.provider([self.entry,entry]),selection=selection)).status_code,503)
        self.assertEqual(len(self.network),2)
    def test_valid_native_model_binds_selected_exam_and_pack(self):
        entry=self.add_artifact('total_model','SYNTHETIC-mock:SYNTHETIC-pack.v1',self.model_body(),distribution_id='SYNTHETIC-model.v1')
        selection=Selection(self.selection.required+(('total_model',entry['key']),))
        self.assertEqual(self.ready(self.app(data=self.provider([self.entry,entry]),selection=selection)).status_code,200)
        self.assertEqual(len(self.network),4)
    def test_model_distribution_identity_or_approval_mismatch_rejected(self):
        for field,value in [('distribution_id','SYNTHETIC-other'),('status','draft'),('population_verified',False),('academic_year',2026)]:
            with self.subTest(field=field):
                self.network.clear();body=self.model_body();body['distribution']['metadata'][field]=value
                entry=self.add_artifact('total_model','SYNTHETIC-mock:SYNTHETIC-pack.v1',body,distribution_id='SYNTHETIC-model.v1')
                selection=Selection(self.selection.required+(('total_model',entry['key']),))
                self.assertEqual(self.ready(self.app(data=self.provider([self.entry,entry]),selection=selection)).status_code,503)
    def test_catalog_native_decoder_and_body_status_are_required(self):
        for status,expected in [('approved',200),('draft',503)]:
            self.network.clear()
            body=dict(format='jungsi.catalog-release/v1',version='SYNTHETIC-catalog.v1',status=status,
                      as_of='2026-10-03T00:00:00Z',offerings=[])
            entry=self.add_artifact('catalog','service',body)
            selection=Selection((('catalog','service'),))
            self.assertEqual(self.ready(self.app(data=self.provider([entry]),selection=selection)).status_code,expected)
            self.assertEqual(len(self.network),2)
    def test_private_receipt_has_no_write_or_approval_side_effect(self):
        data=self.provider();before=deepcopy(data.entries)
        receipt=runtime.SupabaseRuntimeReadiness(data,self.selection).probe()
        self.assertEqual(receipt['status'],'verified');self.assertIs(receipt['production_ready'],False)
        self.assertEqual(receipt['artifacts'][0]['sha256'],self.entry['sha256'])
        self.assertEqual(data.entries,before)
    def test_selection_manifest_exact_shape(self):
        selected=Selection.from_manifest(dict(format='jungsi.runtime-selection/v1',required=[dict(kind='exam_pack',key='SYNTHETIC-mock')]))
        self.assertEqual(selected,self.selection)
        for value in [dict(format='source-only/v1',required=[]),dict(format='jungsi.runtime-selection/v1',required=[]),
                      dict(format='jungsi.runtime-selection/v1',required=[dict(kind='exam_pack',key='SYNTHETIC-mock',latest=True)]),
                      dict(format='jungsi.runtime-selection/v1',required=[dict(kind='exam_pack',key='SYNTHETIC-mock')],approve=True)]:
            with self.subTest(value=value),self.assertRaises(PlatformError):Selection.from_manifest(value)
    def test_configuration_check_has_no_network_or_filesystem_reads(self):
        from unittest.mock import patch
        with patch.dict('os.environ',{},clear=True):
            result=runtime.configuration_status()
            self.assertEqual(result['status'],'configuration_pending')
            self.assertNotIn('GOOGLE_DRIVE_ACCESS_TOKEN',result['missing_settings'])
            self.assertIn('JUNGSI_SUPABASE_RUNTIME_SELECTION',result['missing_settings'])
            self.assertIs(result['production_ready'],False)
        self.assertFalse(self.network);self.assertFalse(self.db)
    def test_private_path_resolves_scope_before_use(self):
        with self.assertRaises(PlatformError):runtime._private_path('src/SYNTHETIC-registry.json')
        with self.assertRaises(PlatformError):runtime._private_path('data/../src/SYNTHETIC-registry.json')
        self.assertEqual(runtime._private_path('data/SYNTHETIC-registry.json').name,'SYNTHETIC-registry.json')
    def test_explicit_environment_factory_loads_private_native_manifests(self):
        from uuid import uuid4
        from unittest.mock import patch
        from types import SimpleNamespace
        from jungsi_touch.infrastructure.postgres_repository import PostgresRepository
        folder=Path('outputs/dev009_synthetic_configuration')/uuid4().hex
        folder.mkdir(parents=True,exist_ok=False)
        registry=folder/'registry.json';selection=folder/'selection.json'
        with registry.open('x',encoding='utf-8') as f:json.dump(dict(format='jungsi.data-registry/v1',entries=[self.entry]),f)
        with selection.open('x',encoding='utf-8') as f:json.dump(dict(format='jungsi.runtime-selection/v1',required=[dict(kind='exam_pack',key='SYNTHETIC-mock')]),f)
        environment=dict(SUPABASE_URL='https://synthetic.supabase.co',SUPABASE_PUBLISHABLE_KEY='SYNTHETIC-key',
                         DATABASE_URL='SYNTHETIC-db-reference',SUPABASE_SECRET_KEY='sb_secret_SYNTHETIC_ONLY',
                         JUNGSI_SUPABASE_STORAGE_BUCKET='synthetic-private',JUNGSI_SUPABASE_STORAGE_PREFIX='synthetic/',
                         JUNGSI_SUPABASE_RUNTIME_REGISTRY=str(registry),JUNGSI_SUPABASE_RUNTIME_SELECTION=str(selection),
                         JUNGSI_RELAY_TOKEN=TOKEN)
        transport=self.client._open
        with patch.dict('os.environ',environment,clear=True),patch('jungsi_touch.infrastructure.supabase_storage.build_opener',return_value=SimpleNamespace(open=transport)),patch.object(PostgresRepository,'probe',return_value=dict(status='verified')):
            self.assertEqual(runtime.configuration_status()['status'],'configured_not_verified')
            app=runtime.configured_supabase_app();self.assertFalse(self.network)
            self.assertEqual(self.ready(app).status_code,200)
            self.assertEqual(app.state.runtime_readiness.selection,self.selection)
        self.assertEqual(len(self.network),2)
    def test_factory_missing_settings_does_not_read_or_probe(self):
        from unittest.mock import patch
        with patch.dict('os.environ',{},clear=True),patch.object(Path,'read_bytes',side_effect=AssertionError('forbidden')):
            with self.assertRaises(PlatformError):runtime.configured_supabase_app()
        self.assertFalse(self.network);self.assertFalse(self.db)
    def test_free_overall_keeps_successful_score_when_total_model_missing(self):
        clock=FrozenClock()
        with TestClient(self.app(sessions=SyntheticSessions(clock),clock=clock)) as c:
            response=c.post('/api/v1/overall-reports',json=score_input(),headers={'X-Jungsi-Relay-Token':TOKEN,
                             'Authorization':'Bearer SYNTHETIC-standard','Idempotency-Key':'SYNTHETIC-request'})
        self.assertEqual(response.status_code,201,response.text)
        body=response.json();overall=body['overall']['overall']
        self.assertEqual(body['overall']['total_standard_score'],30)
        self.assertEqual(len(body['overall']['subjects']),4)
        self.assertEqual(overall['status'],'pending')
        self.assertEqual(overall['reason_code'],'total_model_missing')
        self.assertNotIn('sha256',response.text);self.assertNotIn('synthetic/exam.json',response.text)
    def test_source_payload_cannot_gain_readiness_from_approved_metadata(self):
        body=dict(format='source-only/v1',version='SYNTHETIC-source.v1',status='approved')
        for kind in sorted(runtime.RUNTIME_KINDS):
            with self.subTest(kind=kind):
                self.network.clear()
                key='service' if kind=='catalog' else 'SYNTHETIC-source'
                entry=self.add_artifact(kind,key,body)
                selection=Selection(((kind,key),))
                self.assertEqual(self.ready(self.app(data=self.provider([entry]),selection=selection)).status_code,503)
                self.assertEqual(len(self.network),2)
    def test_omitted_required_approval_flag_never_downloads(self):
        for field in ('engine_approved','production_allowed','archive_only'):
            with self.subTest(field=field):
                entry=deepcopy(self.entry);entry.pop(field)
                self.assertEqual(self.ready(self.app(data=self.provider([entry]))).status_code,503)
        self.assertFalse(self.network)
    def test_private_transport_exception_does_not_escape_health(self):
        def failed(*a,**k):raise OSError('SYNTHETIC-PRIVATE-TOKEN-AND-PATH')
        self.client._open=failed
        response=self.ready(self.app());self.assertEqual(response.status_code,503)
        self.assertNotIn('SYNTHETIC-PRIVATE',response.text)
        self.assertEqual(set(response.json()),{'status','server_timezone','production_ready','security_boundary'})
    def test_independent_conversion_and_percentile_native_decoders(self):
        from test_university_percentile_service import SyntheticPercentileData
        fixture=SyntheticPercentileData(FrozenClock());conversion=fixture.conversion;percentile=fixture.percentile
        key=fixture.offering['offering_id']
        conversion_body=dict(format='jungsi.university-conversion-release/v1',version=conversion.version,status=conversion.status,
            academic_year=conversion.academic_year,exam_id=conversion.exam_id,source_pack_version=conversion.source_pack_version,
            exam_type=conversion.exam_type,release_id=conversion.release.release_id,
            rules=[deepcopy(rule.data) for rule in conversion.release.rules.values()],bindings=deepcopy(list(conversion.bindings)))
        percentile_body=dict(format='jungsi.university-percentile-release/v1',version=percentile.version,status=percentile.status,
            release_id=percentile.release_id,academic_year=percentile.academic_year,exam_id=percentile.exam_id,
            source_pack_version=percentile.source_pack_version,exam_type=percentile.exam_type,rule_version=percentile.rule_version,
            curve=deepcopy(percentile.curve.data),bindings=deepcopy(list(percentile.bindings)))
        entries=[self.add_artifact('conversion',key,conversion_body),self.add_artifact('percentile',key,percentile_body)]
        selection=Selection((('conversion',key),('percentile',key)))
        response=self.ready(self.app(data=self.provider(entries),selection=selection))
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(len(self.network),4)
        # A syntactically native envelope must also bind its selected offering.
        self.network.clear();conversion_body['bindings'][0]['offering_pk']='SYNTHETIC-other'
        entries[0]=self.add_artifact('conversion',key,conversion_body)
        self.assertEqual(self.ready(self.app(data=self.provider(entries),selection=selection)).status_code,503)
    def test_malformed_or_raising_database_probe_keeps_four_safe_health_fields(self):
        for result in (None,'SYNTHETIC-PRIVATE',dict(detail='SYNTHETIC-PRIVATE')):
            with self.subTest(result=result):
                self.repository.probe=lambda:result
                response=self.ready(self.app());self.assertEqual(response.status_code,503)
                self.assertEqual(set(response.json()),{'status','server_timezone','production_ready','security_boundary'})
                self.assertNotIn('SYNTHETIC-PRIVATE',response.text)
        def failed():raise OSError('SYNTHETIC-PRIVATE-DB-REFERENCE')
        self.repository.probe=failed
        response=self.ready(self.app());self.assertEqual(response.status_code,503)
        self.assertEqual(set(response.json()),{'status','server_timezone','production_ready','security_boundary'})
        self.assertNotIn('SYNTHETIC-PRIVATE',response.text)
    def native_bundle(self):
        from test_university_percentile_service import SyntheticPercentileData
        fixture=SyntheticPercentileData(FrozenClock());conversion=fixture.conversion;percentile=fixture.percentile
        key=fixture.offering['offering_id']
        pack_body=deepcopy(fixture.pack._data)
        conversion_body=dict(format='jungsi.university-conversion-release/v1',version=conversion.version,status=conversion.status,
            academic_year=conversion.academic_year,exam_id=conversion.exam_id,source_pack_version=conversion.source_pack_version,
            exam_type=conversion.exam_type,release_id=conversion.release.release_id,
            rules=[deepcopy(rule.data) for rule in conversion.release.rules.values()],bindings=deepcopy(list(conversion.bindings)))
        percentile_body=dict(format='jungsi.university-percentile-release/v1',version=percentile.version,status=percentile.status,
            release_id=percentile.release_id,academic_year=percentile.academic_year,exam_id=percentile.exam_id,
            source_pack_version=percentile.source_pack_version,exam_type=percentile.exam_type,rule_version=percentile.rule_version,
            curve=deepcopy(percentile.curve.data),bindings=deepcopy(list(percentile.bindings)))
        catalog_body=dict(format='jungsi.catalog-release/v1',version=fixture.catalog.version,status='approved',
                          as_of='2026-10-03T00:00:00Z',offerings=[deepcopy(fixture.offering)])
        return fixture,pack_body,conversion_body,percentile_body,catalog_body
    def bundle_app(self,pack,conversion,percentile,catalog=None):
        key='SYNTHETIC-A-2027'
        entries=[self.add_artifact('exam_pack',pack['exam']['exam_id'],pack),
                 self.add_artifact('conversion',key,conversion),self.add_artifact('percentile',key,percentile)]
        if catalog is not None:entries.append(self.add_artifact('catalog','service',catalog))
        selection=Selection(tuple((e['kind'],e['key']) for e in entries))
        return self.app(data=self.provider(entries),selection=selection)
    def test_selected_pack_rule_curve_and_catalog_binding_positive(self):
        _,pack,conversion,percentile,catalog=self.native_bundle()
        response=self.ready(self.bundle_app(pack,conversion,percentile,catalog))
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(len(self.network),8)
    def test_selected_pack_rule_and_curve_cross_version_mismatches_are_503(self):
        changes=[('conversion-exam',lambda c,p:c.update(exam_id='SYNTHETIC-other')),
                 ('conversion-pack',lambda c,p:c.update(source_pack_version='SYNTHETIC-other')),
                 ('conversion-year',lambda c,p:c.update(academic_year=2026)),
                 ('conversion-exam-type',lambda c,p:c.update(exam_type='september_mock')),
                 ('percentile-exam',lambda c,p:p.update(exam_id='SYNTHETIC-other')),
                 ('percentile-pack',lambda c,p:p.update(source_pack_version='SYNTHETIC-other')),
                 ('percentile-year',lambda c,p:p.update(academic_year=2026)),
                 ('percentile-rule',lambda c,p:p.update(rule_version='SYNTHETIC-other')),
                 ('percentile-binding-curve',lambda c,p:p['bindings'][0].update(curve_version='SYNTHETIC-other')),
                 ('percentile-metadata-rule',lambda c,p:p['curve']['metadata'].update(rule_version='SYNTHETIC-other')),
                 ('offering-identity',lambda c,p:p['bindings'][0].update(campus='SYNTHETIC-other'))]
        for label,change in changes:
            with self.subTest(label=label):
                self.network.clear();_,pack,conversion,percentile,_=self.native_bundle();change(conversion,percentile)
                response=self.ready(self.bundle_app(pack,conversion,percentile))
                self.assertEqual(response.status_code,503,response.text)
                self.assertEqual(set(response.json()),{'status','server_timezone','production_ready','security_boundary'})
    def test_selected_catalog_offering_mismatch_is_503(self):
        _,pack,conversion,percentile,catalog=self.native_bundle();catalog['offerings'][0]['campus']='SYNTHETIC-other'
        self.assertEqual(self.ready(self.bundle_app(pack,conversion,percentile,catalog)).status_code,503)
    def test_explicit_approved_mock_compatibility_preserves_cross_binding(self):
        _,pack,conversion,percentile,_=self.native_bundle()
        pack['exam'].update(exam_id='SYNTHETIC-current-mock',exam_type='september_mock')
        conversion['mock_compatibility']=dict(status='approved',version='SYNTHETIC-compat.v1',
             source_exam_id=pack['exam']['exam_id'],source_pack_version=pack['pack_version'],
             source_exam_type=pack['exam']['exam_type'],rule_exam_id=conversion['exam_id'],
             rule_pack_version=conversion['source_pack_version'])
        self.assertEqual(self.ready(self.bundle_app(pack,conversion,percentile)).status_code,200)
        for change in (dict(status='draft'),dict(source_pack_version='SYNTHETIC-other'),dict(rule_exam_id='SYNTHETIC-other')):
            with self.subTest(change=change):
                changed=deepcopy(conversion);changed['mock_compatibility'].update(change)
                self.assertEqual(self.ready(self.bundle_app(pack,changed,percentile)).status_code,503)
    def test_selected_conversion_percentile_cross_binding_without_forced_pack_selection(self):
        _,_,conversion,percentile,_=self.native_bundle();key='SYNTHETIC-A-2027'
        for field,value in [('exam_id','SYNTHETIC-other'),('source_pack_version','SYNTHETIC-other'),
                            ('academic_year',2026),('rule_version','SYNTHETIC-other')]:
            with self.subTest(field=field):
                changed=deepcopy(percentile);changed[field]=value
                entries=[self.add_artifact('conversion',key,conversion),self.add_artifact('percentile',key,changed)]
                selection=Selection((('conversion',key),('percentile',key)))
                self.assertEqual(self.ready(self.app(data=self.provider(entries),selection=selection)).status_code,503)
    def test_selected_embedded_rule_or_curve_is_not_approved_by_outer_flags(self):
        changes=[('rule-review',lambda c,p:c['rules'][0].update(review_status='source_verified')),
                 ('rule-source-kind',lambda c,p:c['rules'][0].update(data_kind='source_candidate')),
                 ('curve-status',lambda c,p:p['curve']['metadata'].update(status='draft')),
                 ('curve-review',lambda c,p:p['curve']['metadata'].update(rule_review_status='source_verified')),
                 ('curve-complete',lambda c,p:p['curve']['metadata'].update(complete=False)),
                 ('curve-population',lambda c,p:p['curve']['metadata'].update(population_verified=False))]
        for label,change in changes:
            with self.subTest(label=label):
                _,pack,conversion,percentile,_=self.native_bundle();change(conversion,percentile)
                self.assertEqual(self.ready(self.bundle_app(pack,conversion,percentile)).status_code,503)
    def analysis_body(self):
        release=SyntheticData(FrozenClock()).bundles['SYNTHETIC-A-2027']
        def rank(value):
            return dict(exam_id=value.exam_id,academic_year=value.academic_year,subject_id=value.subject_id,
                        version=value.version,population_id=value.population_id,counts=deepcopy(value.counts),
                        expected_total=value.total,kind=value.kind,status=value.status,
                        source_refs=list(value.source_refs),reported_scores=deepcopy(value.reported_scores))
        bridges={str(year):{k:({area:rank(value) for area,value in values.items()} if k in ('source','target')
                                else rank(values)) for k,values in bridge.items()}
                 for year,bridge in release.bridges.items()}
        return dict(format='jungsi.offering-analysis-release/v1',version=release.version,status=release.status,
                    source_pack_version=release.source_pack_version,release_id=release.release.release_id,
                    rules=[deepcopy(r.data) for r in release.release.rules.values()],
                    bindings=[dict(academic_year=y,offering_pk=oid,rule_version=version)
                              for (y,oid),version in release.release.bindings.items()],
                    offerings_by_year=deepcopy(release.offerings_by_year),bridges=bridges,policy=asdict(release.policy),
                    curves={str(y):deepcopy(c.data) for y,c in release.curves.items()},decisions={})
    def test_native_analysis_outer_flags_do_not_approve_embedded_curve_or_rule(self):
        key='SYNTHETIC-A-2027';body=self.analysis_body()
        def call(value):
            entry=self.add_artifact('analysis',key,value)
            return self.ready(self.app(data=self.provider([entry]),selection=Selection((('analysis',key),))))
        self.assertEqual(call(body).status_code,200)
        for change in (lambda b:b['curves']['2027']['metadata'].update(status='research'),
                       lambda b:b['curves']['2027']['metadata'].update(status='reviewed'),
                       lambda b:b['rules'][-1].update(review_status='source_verified')):
            changed=deepcopy(body);change(changed)
            self.assertEqual(call(changed).status_code,503)
    def test_snapshot_outputs_ancestor_does_not_make_project_source_private(self):
        from unittest.mock import patch
        project=Path.cwd()/'outputs'/'SYNTHETIC-snapshot'/'workspace'
        module=project/'src'/'jungsi_touch'/'infrastructure'/'supabase_runtime.py'
        with patch.object(runtime,'__file__',str(module)):
            with self.assertRaises(PlatformError):runtime._private_path(project/'src'/'SYNTHETIC-registry.json')
            self.assertEqual(runtime._private_path(project/'data'/'SYNTHETIC-registry.json'),
                             (project/'data'/'SYNTHETIC-registry.json').resolve())
    def test_complete_four_year_analysis_json_roundtrip_preserves_ranks(self):
        body=self.analysis_body();key='SYNTHETIC-A-2027'
        entry=self.add_artifact('analysis',key,body)
        data=self.provider([entry]);before=deepcopy(self.objects)
        release=data.get_analysis(key)
        self.assertEqual(set(release.bridges),{2024,2025,2026,2027})
        self.assertEqual(set(release.bridges[2027]['source']['korean'].counts),set(range(1,10)))
        self.assertTrue(all(type(k) is int for k in release.bridges[2027]['source']['korean'].reported_scores))
        self.assertEqual(self.objects,before)
        self.assertEqual(self.ready(self.app(data=data,selection=Selection((('analysis',key),)))).status_code,200)
    def test_bridge_json_noncanonical_score_keys_fail_closed(self):
        key='SYNTHETIC-A-2027'
        for field in ('counts','reported_scores'):
            for score in ('01',' 1','1 ','+1','1.0','1e0','-1','00'):
                with self.subTest(field=field,score=score):
                    body=self.analysis_body();values=body['bridges']['2027']['source']['korean'][field]
                    values[score]=values.pop(1)
                    entry=self.add_artifact('analysis',key,body)
                    self.assertEqual(self.ready(self.app(data=self.provider([entry]),selection=Selection((('analysis',key),)))).status_code,503)
    def test_integer_key_normalization_rejects_collisions_and_preserves_values(self):
        from jungsi_touch.infrastructure.drive_provider import _integer_keys
        value={'0':dict(grade=9),'1':dict(grade=8)};before=deepcopy(value)
        self.assertEqual(_integer_keys(value),{0:dict(grade=9),1:dict(grade=8)});self.assertEqual(value,before)
        for invalid in ({1:'SYNTHETIC','1':'SYNTHETIC-other'},{True:'SYNTHETIC'},{-1:'SYNTHETIC'},[]):
            with self.subTest(invalid=invalid),self.assertRaises(PlatformError):_integer_keys(invalid)
    def test_duplicate_json_score_identity_is_rejected_before_rank_decode(self):
        body=self.analysis_body();key='SYNTHETIC-A-2027'
        entry=self.add_artifact('analysis',key,body)
        original=self.objects['analysis.json']
        changed=original.replace(b'"counts": {"1": "1",',b'"counts": {"1": "1", "1": "2",',1)
        self.assertNotEqual(changed,original)
        self.objects['analysis.json']=changed
        entry.update(bytes=len(changed),sha256=sha256(changed).hexdigest())
        self.assertEqual(self.ready(self.app(data=self.provider([entry]),selection=Selection((('analysis',key),)))).status_code,503)
    def test_unknown_provider_is_rejected_without_fallback(self):
        with self.assertRaises(PlatformError):self.app(data=object())

if __name__ == '__main__': unittest.main()
