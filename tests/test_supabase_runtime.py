"""Synthetic candidate HTTP acceptance; no DB, Auth or cloud access."""
from copy import deepcopy
from dataclasses import asdict
import json
from hashlib import sha256
from io import BytesIO, StringIO
from pathlib import Path
from contextlib import redirect_stdout, redirect_stderr
from types import SimpleNamespace
import unittest
from unittest.mock import patch
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
        return runtime.create_supabase_secured_app(**args, operating_mode="legacy_synthetic")
    def ready(self, app, token=TOKEN):
        with TestClient(app) as c: return c.get('/health/ready', headers={'X-Jungsi-Relay-Token':token})
    def test_baseline_legacy_drive_requirement_is_reproduced_and_preserved(self):
        app=create_secured_app(security=SecuritySettings(TOKEN), settings=self.settings,
                               repository=self.repository, data=self.provider(), operating_mode="legacy_synthetic")
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
        self.assertEqual(len(ops),28)
        policy_ops=[o for o in ops if o['id'] not in {'history.snapshot.head','history.snapshot.read','report.list-own'}]
        self.assertEqual(len(policy_ops),25)
        legacy_ops=[o for o in policy_ops if o['id'] not in {'score-input.status.read','score-input.correction.grant','report.sample.read'}]
        self.assertEqual(len(legacy_ops),22)
        with TestClient(app) as c:
            self.assertEqual(c.get('/api/v1/me',headers={'X-Jungsi-Relay-Token':TOKEN}).status_code,401)
            for op in legacy_ops:
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
        with patch.dict('os.environ',environment,clear=True),patch('jungsi_touch.infrastructure.supabase_storage.build_opener',return_value=SimpleNamespace(open=transport)),patch.object(PostgresRepository,'probe',return_value=dict(status='verified')),patch('jungsi_touch.infrastructure.postgres_entitlements.PostgresJeongsiPassesRepository.probe',return_value=dict(status='verified')):
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

class CurrentReviewOfflineStatusTests(unittest.TestCase):
    """Captured synthetic page safety; no fresh DB, auth, network or file writes."""
    def item(self, state='present'):
        row = dict(observation_token='SYNTHETIC-OPAQUE-TOKEN-NOT-PRINTED', academic_year=2026,
            university='SYNTHETIC-PRIVATE-SCHOOL-NOT-PRINTED', department=None, track=None,
            recruit_group=None, metric_kind='SYNTHETIC-PRIVATE-METRIC-NOT-PRINTED',
            metric_value_literal='0', metric_value_json_type='number', metric_value_numeric_text='0',
            cohort=None, statistic_label=None, source_member_count=1, link_scopes=[],
            official_metadata=dict(metric_definition=None, unit=None, original_scale=None,
                source_url=None, source_as_of=None, publication_status=None),
            review_status='review_only', value_availability=state,
            hold_reasons=['review_only_not_published', 'public_offering_mapping_not_qualified',
                'official_metadata_not_qualified', 'SYNTHETIC-PRIVATE-REASON-NOT-PRINTED'])
        if state == 'actual_null':
            row.update(metric_value_literal='null', metric_value_json_type='null', metric_value_numeric_text=None)
        elif state in ('missing', 'held'):
            row.update(metric_value_literal=None, metric_value_json_type=None if state == 'missing' else 'object',
                       metric_value_numeric_text=None)
        return row

    def page(self, items=None, cursor=None):
        return dict(format='jungsi.current-admission-review-page/v2', query_mode='live_bounded',
            count_status='unknown', status='review', items=[self.item()] if items is None else items,
            matching_observation_count=None, matching_source_school_count=None,
            review_version='SYNTHETIC.review.v2', as_of='2026-10-10T15:00:00Z', next_cursor=cursor,
            publication_status='not_published')

    def encode(self, page):
        return json.dumps(page, ensure_ascii=False).encode('utf-8')

    def summary(self, page):
        before = deepcopy(page)
        result = runtime._review_page_status(self.encode(page))
        self.assertEqual(page, before)
        return result

    def assert_invalid(self, page):
        with self.assertRaises(PlatformError) as error:
            runtime._review_page_status(self.encode(page))
        self.assertEqual((error.exception.code, error.exception.http_status), ('local_review_capture_invalid', 503))

    def test_zero_null_missing_held_and_placeholder_are_distinct_page_states(self):
        placeholder = self.item()
        placeholder.update(metric_value_literal='"SYNTHETIC-PLACEHOLDER"', metric_value_json_type='string',
                           metric_value_numeric_text=None)
        result = self.summary(self.page([self.item(state) for state in ('present', 'actual_null', 'missing', 'held')] + [placeholder]))
        self.assertEqual(result['value_availability_counts'], dict(present=2, actual_null=1, missing=1, held=1))
        self.assertEqual(result['rows_in_page'], 5)
        self.assertEqual(result['source_review_status'], 'NOT_EXPOSED')
        self.assertEqual(result['original_metadata_review_status'], 'NOT_EXPOSED')
        self.assertEqual(result['fresh_DB_probe'], 'NOT_RUN')
        self.assertIn('공급자', result['review_badge_meaning'])
        self.assertIn('공식 검수 통과를 뜻하지 않음', result['value_availability_meaning'])

    def test_empty_scan_with_cursor_does_not_become_zero_nationwide_or_complete(self):
        result = self.summary(self.page([], 'SYNTHETIC-OPAQUE-CURSOR-NOT-PRINTED'))
        self.assertEqual(result['rows_in_page'], 0)
        self.assertTrue(result['next_page_available'])
        self.assertEqual(result['count_status'], 'unknown')
        self.assertIsNone(result['matching_observation_count'])
        self.assertIsNone(result['matching_source_school_count'])
        self.assertNotIn('complete', result)
        self.assertEqual(result['evidence_mode'], 'captured_response_not_fresh_probe')

    def test_links_preserve_kind_reference_year_permission_and_multiplicity(self):
        row = self.item()
        row['link_scopes'] = [dict(link_kind=kind, population_reference_year=year,
            individual_offering_metric_inference_allowed=allowed) for kind, year, allowed in (
            ('same_year_offering', 2026, False), ('same_year_offering', 2026, False),
            ('verified_aggregate_offerings', 2026, False), ('official_reorganized_forward_reference', 2027, False),
            ('same_year_offering', 2027, False), ('same_year_offering', 2026, True))]
        scopes = self.summary(self.page([row]))['population_links']
        self.assertEqual(len(scopes), 5)
        keyed = {(r['link_kind'], r['population_reference_year'], r['individual_offering_metric_inference_allowed']): r['links_in_page'] for r in scopes}
        self.assertEqual(keyed[('same_year_offering', 2026, False)], 2)
        self.assertEqual(keyed[('same_year_offering', 2026, True)], 1)
        self.assertEqual(keyed[('official_reorganized_forward_reference', 2027, False)], 1)

    def test_only_known_public_link_kinds_can_be_reflected(self):
        row = self.item()
        row['link_scopes'] = [dict(link_kind=kind, population_reference_year=2026,
            individual_offering_metric_inference_allowed=False) for kind in (
                'SYNTHETIC-SECRET-TOKEN', 'C:/SYNTHETIC-private/path', 'https://synthetic.invalid/signed-token')]
        result = self.summary(self.page([row], 'SYNTHETIC-OPAQUE-CURSOR-NOT-PRINTED'))
        self.assertEqual(result['population_links'], [dict(link_kind='unknown', population_reference_year=2026,
            individual_offering_metric_inference_allowed=False, links_in_page=3)])
        output = json.dumps(result, ensure_ascii=False)
        for marker in ('SYNTHETIC-SECRET', 'SYNTHETIC-private', 'signed-token', 'SYNTHETIC-OPAQUE',
                       'SYNTHETIC-PRIVATE', 'metric_value', 'observation_token', 'next_cursor'):
            self.assertNotIn(marker, output)

    def test_envelope_is_closed_bounded_review_only_and_unknown_count(self):
        changes = [dict(format='jungsi.current-admission-review-page/v1'), dict(status='ready'),
            dict(query_mode='frozen'), dict(publication_status='published'), dict(count_status='exact'),
            dict(matching_observation_count=0), dict(matching_source_school_count=0), dict(items={}),
            dict(items=[self.item()] * 101), dict(extra='SYNTHETIC-SECRET'), dict(next_cursor=''),
            dict(next_cursor=False), dict(next_cursor='SYNTHETIC' * 513)]
        for change in changes:
            with self.subTest(fields=list(change)):
                page = self.page(); page.update(change); self.assert_invalid(page)
        page = self.page(); del page['as_of']; self.assert_invalid(page)

    def test_version_and_utc_timestamp_have_restricted_output_format(self):
        for field, value in [('review_version', 'C:/SYNTHETIC-private'), ('review_version', 'SYNTHETIC\nTOKEN'),
            ('review_version', 'SYNTHETIC token'), ('review_version', False),
            ('as_of', '2026-10-10'), ('as_of', '2026-10-10T15:00:00'),
            ('as_of', '2026-10-10T15:00:00+09:00'), ('as_of', '2026-99-99T15:00:00Z'),
            ('as_of', '2026-10-10X15:00:00Z'), ('as_of', 'SYNTHETIC-SECRET')]:
            with self.subTest(field=field, value=value):
                page = self.page(); page[field] = value; self.assert_invalid(page)
        self.assertEqual(self.summary(self.page())['as_of'], '2026-10-10T15:00:00+00:00')

    def test_row_shape_metadata_provider_holds_and_types_fail_closed(self):
        changes = [dict(extra='SYNTHETIC-SECRET'), dict(academic_year=True), dict(academic_year='2026'),
            dict(source_member_count=True), dict(source_member_count=0), dict(source_member_count=1.0),
            dict(university=13), dict(observation_token=None), dict(review_status='approved'),
            dict(value_availability='source_verified'), dict(link_scopes={}), dict(hold_reasons=[]),
            dict(hold_reasons=['review_only_not_published', 'public_offering_mapping_not_qualified']),
            dict(hold_reasons=['review_only_not_published', 'public_offering_mapping_not_qualified', 'official_metadata_not_qualified', 0])]
        for change in changes:
            with self.subTest(fields=list(change)):
                row = self.item(); row.update(change); self.assert_invalid(self.page([row]))
        for metadata in ({}, dict(self.item()['official_metadata'], source_url='https://synthetic.invalid/private')):
            row = self.item(); row['official_metadata'] = metadata; self.assert_invalid(self.page([row]))

    def test_hidden_values_and_actual_null_cannot_be_reinterpreted(self):
        for state in ('held', 'missing'):
            for field in ('metric_value_literal', 'metric_value_numeric_text'):
                row = self.item(state); row[field] = 'SYNTHETIC-PRIVATE-VALUE'; self.assert_invalid(self.page([row]))
        for field, value in [('metric_value_literal', None), ('metric_value_literal', '0'),
                             ('metric_value_json_type', None), ('metric_value_numeric_text', '0')]:
            row = self.item('actual_null'); row[field] = value; self.assert_invalid(self.page([row]))
        row = self.item(); row['metric_value_numeric_text'] = None; self.assert_invalid(self.page([row]))

    def test_population_link_closed_shape_and_boolean_year_types(self):
        link = dict(link_kind='same_year_offering', population_reference_year=2026,
                    individual_offering_metric_inference_allowed=False)
        for change in (dict(extra='SYNTHETIC'), dict(link_kind=''), dict(link_kind='SYNTHETIC\nSECRET'),
                       dict(population_reference_year=True), dict(population_reference_year='2026'),
                       dict(individual_offering_metric_inference_allowed=0)):
            row = self.item(); row['link_scopes'] = [dict(link, **change)]; self.assert_invalid(self.page([row]))

    def test_duplicate_json_nonfinite_bad_encoding_and_oversize_are_sanitized(self):
        valid = self.encode(self.page())
        duplicate = valid.replace(b'"status": "review"', b'"status": "review", "status": "review"')
        nonfinite = valid.replace(b'"source_member_count": 1', b'"source_member_count": NaN')
        for payload in (duplicate, nonfinite, b'\xffSYNTHETIC-SECRET', b'{', b'',
                        b' ' * (1024 * 1024 + 1), 'SYNTHETIC-SECRET', []):
            with self.subTest(kind=type(payload).__name__, size=len(payload)), self.assertRaises(PlatformError) as error:
                runtime._review_page_status(payload)
            self.assertEqual(str(error.exception), 'local_review_capture_invalid')

    def test_file_reader_checks_private_scope_and_bounds_racing_growth(self):
        with self.assertRaises(PlatformError) as error:
            runtime.review_status_from_file('src/SYNTHETIC-secret-capture.json')
        self.assertEqual(error.exception.code, 'local_review_capture_invalid')
        private = SimpleNamespace(stat=lambda: SimpleNamespace(st_size=1),
            open=lambda mode: BytesIO(b' ' * (1024 * 1024 + 2)))
        with patch.object(runtime, '_private_path', return_value=private), self.assertRaises(PlatformError):
            runtime.review_status_from_file('outputs/SYNTHETIC-capture.json')
        private = SimpleNamespace(stat=lambda: SimpleNamespace(st_size=1024 * 1024 + 1),
                                  open=lambda mode: self.fail('oversize file must not be opened'))
        with patch.object(runtime, '_private_path', return_value=private), self.assertRaises(PlatformError):
            runtime.review_status_from_file('outputs/SYNTHETIC-capture.json')

    def test_offline_cli_never_checks_configuration_and_does_not_print_input_path(self):
        capture = self.encode(self.page(cursor='SYNTHETIC-OPAQUE-CURSOR-NOT-PRINTED'))
        private = SimpleNamespace(stat=lambda: SimpleNamespace(st_size=len(capture)), open=lambda mode: BytesIO(capture))
        output = StringIO()
        with patch.object(runtime, '_private_path', return_value=private), \
                patch.object(runtime, 'configuration_status', side_effect=AssertionError('configuration read forbidden')), \
                patch.object(runtime, 'configured_supabase_app', side_effect=AssertionError('factory forbidden')), \
                redirect_stdout(output):
            code = runtime.main(['--review-status-file', 'outputs/SYNTHETIC-private-capture.json'])
        self.assertEqual(code, 0)
        status = json.loads(output.getvalue())
        self.assertTrue(status['next_page_available'])
        self.assertNotIn('SYNTHETIC-private-capture', output.getvalue())
        self.assertNotIn('SYNTHETIC-OPAQUE', output.getvalue())

    def test_cli_error_is_fixed_sanitized_and_check_config_remains_names_only(self):
        output = StringIO()
        with patch.object(runtime, 'review_status_from_file', side_effect=PlatformError('SYNTHETIC-secret-path-token')), redirect_stdout(output):
            code = runtime.main(['--review-status-file', 'outputs/SYNTHETIC-secret.json'])
        self.assertEqual(code, 2)
        self.assertEqual(json.loads(output.getvalue()), dict(status='error', error={'code': 'local_review_capture_invalid'}))
        expected = dict(status='configuration_pending', missing_settings=['SYNTHETIC_SETTING_NAME'], production_ready=False)
        output = StringIO()
        with patch.object(runtime, 'configuration_status', return_value=expected), \
                patch.object(runtime, 'review_status_from_file', side_effect=AssertionError('capture read forbidden')), redirect_stdout(output):
            self.assertEqual(runtime.main(['--check-config']), 0)
        self.assertEqual(json.loads(output.getvalue()), expected)

    def test_cli_modes_are_mutually_exclusive(self):
        with redirect_stderr(StringIO()), self.assertRaises(SystemExit) as error:
            runtime.main(['--check-config', '--review-status-file', 'outputs/SYNTHETIC-capture.json'])
        self.assertEqual(error.exception.code, 2)


class FourPageReadinessMetadataTests(unittest.TestCase):
    """All four pages remain visible; metadata never claims a live connection."""
    def settings(self):
        return dict(SUPABASE_URL='https://synthetic.supabase.co',
            SUPABASE_PUBLISHABLE_KEY='sb_publishable_SYNTHETIC-PUBLISHABLE-NOT-PRINTED',
            DATABASE_URL='postgresql://SYNTHETIC-DB-SECRET-NOT-PRINTED@synthetic.invalid/db',
            SUPABASE_SECRET_KEY='sb_secret_SYNTHETIC-SERVER-SECRET-NOT-PRINTED',
            JUNGSI_SUPABASE_STORAGE_BUCKET='synthetic-private-bucket',
            JUNGSI_SUPABASE_STORAGE_PREFIX='synthetic-private-prefix/',
            JUNGSI_SUPABASE_RUNTIME_REGISTRY='outputs/SYNTHETIC-private-registry.json',
            JUNGSI_SUPABASE_RUNTIME_SELECTION='outputs/SYNTHETIC-private-selection.json',
            JUNGSI_RELAY_TOKEN='SYNTHETIC-RELAY-SECRET-NOT-PRINTED')

    def entry(self, kind, key=None, **changes):
        row = dict(kind=kind, key=key or ('service' if kind == 'catalog' else 'SYNTHETIC-PRIVATE-ID-' + kind),
            bucket='synthetic-private-bucket', object_key='synthetic-private-prefix/' + kind + '.json',
            bytes=1, sha256='a' * 64, version='SYNTHETIC-PRIVATE-VERSION-NOT-PRINTED', status='approved',
            engine_approved=True, production_allowed=True, archive_only=False,
            reviewer_uuid='SYNTHETIC-PRIVATE-REVIEWER-UUID-NOT-PRINTED')
        row.update(changes)
        return row

    def check(self, entries, *, selected=None, env_change=None, registry=None, manifest=None):
        env = self.settings()
        for name, value in (env_change or {}).items():
            if value is None:
                env.pop(name, None)
            else:
                env[name] = value
        registry = dict(format='jungsi.data-registry/v1', entries=entries) if registry is None else registry
        if manifest is None:
            chosen = entries if selected is None else selected
            manifest = dict(format='jungsi.runtime-selection/v1', required=[dict(kind=row['kind'], key=row['key']) for row in chosen])
        reads = []
        def reader(value):
            reads.append(value)
            if not value:
                return 'missing', None
            if value == env.get('JUNGSI_SUPABASE_RUNTIME_REGISTRY'):
                return 'read', deepcopy(registry)
            if value == env.get('JUNGSI_SUPABASE_RUNTIME_SELECTION'):
                return 'read', deepcopy(manifest)
            self.fail('unexpected metadata read')
        with patch.dict(runtime.os.environ, env, clear=True), patch.object(runtime, '_page_metadata_file', side_effect=reader), \
                patch.object(runtime, 'configured_supabase_app', side_effect=AssertionError('factory forbidden')), \
                patch.object(runtime.SupabaseRuntimeReadiness, 'probe', side_effect=AssertionError('native probe forbidden')), \
                patch.object(runtime.SupabaseStorageClient, 'artifact', side_effect=AssertionError('artifact read forbidden')), \
                patch.object(runtime.SupabaseStorageClient, '_call', side_effect=AssertionError('network forbidden')):
            result = runtime.four_page_readiness()
        self.assertEqual(reads, [env.get('JUNGSI_SUPABASE_RUNTIME_REGISTRY'), env.get('JUNGSI_SUPABASE_RUNTIME_SELECTION')])
        self.assertEqual([page['page_number'] for page in result['pages']], [1, 2, 3, 4])
        return result

    def capability(self, result, number, capability):
        page = next(row for row in result['pages'] if row['page_number'] == number)
        return next(row for row in page['capabilities'] if row['capability'] == capability)

    def kind(self, result, kind):
        return next(row for row in result['kinds'] if row['kind'] == kind)

    def test_absent_metadata_returns_every_page_and_not_run_without_throwing(self):
        with patch.dict(runtime.os.environ, {}, clear=True), \
                patch.object(runtime, 'configured_supabase_app', side_effect=AssertionError('factory forbidden')):
            result = runtime.four_page_readiness()
        self.assertEqual([page['page_number'] for page in result['pages']], [1, 2, 3, 4])
        self.assertEqual((result['registry'], result['selection']), ('missing', 'missing'))
        for page in result['pages']:
            self.assertEqual(page['connection'], 'configuration_missing')
            self.assertEqual((page['runtime_connection'], page['browser'], page['ready']), ('NOT_RUN', 'NOT_RUN', False))
            self.assertTrue(all(cap['metadata_status'] == 'metadata_unavailable' for cap in page['capabilities']))

    def test_exam_metadata_can_be_eligible_while_total_model_is_missing(self):
        result = self.check([self.entry('exam_pack')])
        self.assertEqual(self.capability(result, 2, 'subject_scores')['metadata_status'], 'eligible_metadata_only')
        overall = self.capability(result, 2, 'overall_percentile')
        self.assertEqual((overall['metadata_status'], overall['missing_kinds']), ('missing', ['total_model']))
        self.assertEqual(overall['actual_calculation'], 'NOT_RUN')
        self.assertFalse(result['pages'][1]['ready'])

    def test_conversion_metadata_does_not_get_hidden_by_missing_assessment_or_curve(self):
        result = self.check([self.entry(kind) for kind in ('catalog', 'exam_pack', 'conversion')])
        self.assertEqual(self.capability(result, 3, 'converted_score')['metadata_status'], 'eligible_metadata_only')
        self.assertEqual(self.capability(result, 3, 'converted_percentile')['missing_kinds'], ['percentile'])
        self.assertEqual(self.capability(result, 3, 'assessment')['missing_kinds'], ['analysis'])
        self.assertEqual(self.capability(result, 1, 'official_history_and_recruitment')['metadata_status'], 'eligible_metadata_only')
        self.assertEqual(result['current_catalog_binding'], 'NOT_RUN')

    def test_one_eligible_conversion_does_not_make_same_kind_or_all_departments_ready(self):
        good = self.entry('conversion')
        draft = self.entry('conversion', 'SYNTHETIC-OTHER-PRIVATE-ID', status='draft')
        result = self.check([self.entry('catalog'), self.entry('exam_pack'), good, draft])
        conversion = self.kind(result, 'conversion')
        self.assertEqual(conversion['metadata_status'], 'partially_eligible')
        self.assertEqual(conversion['selected_entry_status_counts']['eligible_metadata_only'], 1)
        self.assertEqual(conversion['selected_entry_status_counts']['not_approved'], 1)
        self.assertEqual(self.capability(result, 3, 'converted_score')['metadata_status'], 'blocked')
        self.assertEqual(conversion['coverage'], 'selected_scope_only_not_nationwide')

    def test_unselected_draft_does_not_expand_minimum_selected_requirements(self):
        selected = [self.entry(kind) for kind in ('catalog', 'exam_pack', 'conversion')]
        result = self.check(selected + [self.entry('analysis', status='draft')], selected=selected)
        self.assertEqual(self.capability(result, 3, 'converted_score')['metadata_status'], 'eligible_metadata_only')
        self.assertEqual(self.kind(result, 'analysis')['metadata_status'], 'not_selected')
        self.assertIn('analysis', self.capability(result, 3, 'assessment')['missing_kinds'])

    def test_fourth_page_exposes_standalone_baseline_gap_without_losing_direct_conversion(self):
        entries = [self.entry(kind) for kind in ('catalog', 'exam_pack', 'conversion', 'percentile', 'analysis')]
        result = self.check(entries)
        baseline = self.capability(result, 4, 'advantage_baseline')
        self.assertEqual((baseline['metadata_status'], baseline['missing_kinds']), ('missing', ['total_model']))
        self.assertEqual(self.capability(result, 3, 'converted_score')['metadata_status'], 'eligible_metadata_only')
        for capability in ('conversion_advantage', 'recommended_candidates'):
            state = self.capability(result, 4, capability)
            self.assertEqual(state['standalone_total_model_status'], 'not_selected')
            self.assertEqual(state['embedded_analysis_baseline'], 'NOT_CHECKED')
            self.assertEqual(state['actual_calculation'], 'NOT_RUN')
            self.assertIn('validated_embedded_analysis_target_total', state['overall_baseline_possible_source'])
        result = self.check(entries + [self.entry('total_model', production_allowed=False)])
        self.assertEqual(self.capability(result, 4, 'advantage_baseline')['metadata_status'], 'blocked')
        self.assertEqual(self.capability(result, 3, 'converted_score')['metadata_status'], 'eligible_metadata_only')

    def test_all_selected_metadata_still_does_not_verify_decoder_bindings_or_live_service(self):
        kinds = ('catalog', 'exam_pack', 'total_model', 'conversion', 'percentile', 'analysis',
                 'forecast_context', 'forecast_inputs', 'forecast_policy', 'estimate_receipt')
        result = self.check([self.entry(kind) for kind in kinds])
        self.assertTrue(all(row['metadata_status'] == 'eligible_metadata_only' for row in result['kinds']))
        for page in result['pages']:
            self.assertEqual(page['connection'], 'configured_not_verified')
            self.assertFalse(page['ready'])
            for cap in page['capabilities']:
                self.assertEqual((cap['native_decode'], cap['cross_bindings'], cap['actual_calculation']), ('NOT_RUN', 'NOT_RUN', 'NOT_RUN'))
        for key in ('database', 'authentication', 'storage_objects', 'engine', 'current_catalog_binding'):
            self.assertEqual(result[key], 'NOT_RUN')
        self.assertFalse(result['production_ready'])

    def test_invalid_selection_and_registry_keep_four_blocked_pages_without_raw_error(self):
        entry = self.entry('exam_pack')
        manifests = ({}, dict(format='jungsi.runtime-selection/v1', required=[]),
            dict(format='jungsi.runtime-selection/v1', required=[dict(kind='exam_pack', key=True)]),
            dict(format='jungsi.runtime-selection/v1', required=[dict(kind='exam_pack', key=entry['key'])] * 2))
        for manifest in manifests:
            with self.subTest(manifest_keys=list(manifest)):
                result = self.check([entry], manifest=manifest)
                self.assertEqual(result['selection'], 'invalid')
                self.assertTrue(all(cap['metadata_status'] == 'metadata_unavailable' for page in result['pages'] for cap in page['capabilities']))
        for registry in ({}, dict(format='jungsi.data-registry/v1', entries={}),
                         dict(format='jungsi.data-registry/v1', entries=[entry, entry])):
            result = self.check([entry], registry=registry)
            self.assertEqual(result['registry'], 'invalid')

    def test_approval_flags_size_and_missing_selected_reference_are_not_eligible(self):
        for change in (dict(status='draft'), dict(engine_approved=False), dict(production_allowed=False),
                       dict(archive_only=True), dict(archive_only=None), dict(bytes=True),
                       dict(bytes=32 * 1024 * 1024 + 1), dict(object_key='../SYNTHETIC-private')):
            with self.subTest(fields=list(change)):
                result = self.check([self.entry('exam_pack', **change)])
                self.assertEqual(self.kind(result, 'exam_pack')['metadata_status'], 'blocked')
        selected = [self.entry('exam_pack')]
        result = self.check([], selected=selected)
        self.assertEqual(self.kind(result, 'exam_pack')['selected_entry_status_counts']['missing'], 1)

    def test_missing_or_invalid_storage_scope_is_not_an_object_or_bucket_verification(self):
        result = self.check([self.entry('exam_pack')], env_change=dict(SUPABASE_SECRET_KEY=None))
        self.assertEqual(result['storage_scope'], 'not_configured')
        self.assertEqual(self.kind(result, 'exam_pack')['selected_entry_status_counts']['unverified_storage_scope'], 1)
        result = self.check([self.entry('exam_pack')], env_change=dict(SUPABASE_SECRET_KEY='SYNTHETIC-invalid-secret'))
        self.assertEqual(result['storage_scope'], 'invalid_configuration')
        self.assertEqual(self.kind(result, 'exam_pack')['selected_entry_status_counts']['invalid_reference'], 1)
        result = self.check([self.entry('exam_pack', bucket='synthetic-other-private-bucket')])
        self.assertEqual(self.kind(result, 'exam_pack')['selected_entry_status_counts']['invalid_reference'], 1)

    def test_settings_private_identifiers_hashes_bucket_paths_secrets_never_appear(self):
        result = self.check([self.entry(kind) for kind in ('catalog', 'exam_pack', 'conversion')])
        output = json.dumps(result, ensure_ascii=False)
        for hidden in ('SYNTHETIC-PRIVATE', 'SYNTHETIC-private', 'SYNTHETIC-SERVER', 'SYNTHETIC-DB',
                       'SYNTHETIC-RELAY', 'SYNTHETIC-PUBLISHABLE', 'a' * 64,
                       'synthetic-private-bucket', 'synthetic-private-prefix', 'synthetic.supabase.co'):
            self.assertNotIn(hidden, output)
        self.assertEqual(result['check_target'], 'configured_supabase_native_metadata_not_local_verification')
        self.assertEqual(result['local_purpose_native_approval'], 'NOT_CHECKED')

    def test_metadata_file_private_size_bounds_duplicate_and_nonfinite_guards(self):
        self.assertEqual(runtime._page_metadata_file(None), ('missing', None))
        self.assertEqual(runtime._page_metadata_file('src/SYNTHETIC-secret.json'), ('invalid', None))
        for content in (b'{"format":"a","format":"b"}', b'{"value":NaN}', b'\xff', b'[]', b''):
            private = SimpleNamespace(stat=lambda: SimpleNamespace(st_size=max(1, len(content))), open=lambda mode: BytesIO(content))
            with patch.object(runtime, '_private_path', return_value=private):
                self.assertEqual(runtime._page_metadata_file('outputs/SYNTHETIC-private.json'), ('invalid', None))
        private = SimpleNamespace(stat=lambda: SimpleNamespace(st_size=1024 * 1024 + 1),
            open=lambda mode: self.fail('oversize metadata must not be opened'))
        with patch.object(runtime, '_private_path', return_value=private):
            self.assertEqual(runtime._page_metadata_file('outputs/SYNTHETIC-private.json'), ('invalid', None))
        private = SimpleNamespace(stat=lambda: SimpleNamespace(st_size=1), open=lambda mode: BytesIO(b' ' * (1024 * 1024 + 2)))
        with patch.object(runtime, '_private_path', return_value=private):
            self.assertEqual(runtime._page_metadata_file('outputs/SYNTHETIC-private.json'), ('invalid', None))

    def test_page_cli_uses_only_four_page_metadata_mode_and_returns_all_missing_pages(self):
        output = StringIO()
        with patch.dict(runtime.os.environ, {}, clear=True), \
                patch.object(runtime, 'configuration_status', side_effect=AssertionError('old mode forbidden')), \
                patch.object(runtime, 'review_status_from_file', side_effect=AssertionError('capture mode forbidden')), \
                redirect_stdout(output):
            self.assertEqual(runtime.main(['--page-readiness']), 0)
        result = json.loads(output.getvalue())
        self.assertEqual(result['format'], 'jungsi.four-page-local-readiness/v1')
        self.assertEqual([page['page_number'] for page in result['pages']], [1, 2, 3, 4])
        for modes in (['--page-readiness', '--check-config'],
                      ['--page-readiness', '--review-status-file', 'outputs/SYNTHETIC-capture.json']):
            with redirect_stderr(StringIO()), self.assertRaises(SystemExit) as error:
                runtime.main(modes)
            self.assertEqual(error.exception.code, 2)


if __name__ == '__main__': unittest.main()
