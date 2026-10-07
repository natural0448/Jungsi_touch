"""DEV-008: all legacy workflows through explicit security plus negative HTTP cases."""
from copy import deepcopy
from datetime import timedelta
import json
from pathlib import Path
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
import test_backend_workflows as workflow
import test_forecast_http as forecast_http
import test_session_read as session_read
from backend_synthetic_fixture import SyntheticSessions
from jungsi_touch.application.platform_ports import PlatformError
from jungsi_touch.application.public_response import PublicResponseProjection
from jungsi_touch.application.authorization import Actor
from jungsi_touch.infrastructure.secured_http import SecuritySettings, create_secured_app
from jungsi_touch.infrastructure.settings import ServerSettings

TOKEN = 'SYNTHETIC-relay-token-for-testing-only-000000'
MARKER = 'SYNTHETIC-PRIVATE-DO-NOT-PUBLISH'
HEADER = {'X-Jungsi-Relay-Token': TOKEN}


class SecuredWorkflowTests(workflow.BackendWorkflowTests):
    def setUp(self):
        super().setUp()
        repo=session_read.Entitlements()
        repo.entitlements=deepcopy(self.repo.entitlements)
        self.repo=repo
        self.session_calls = []
        sessions = SyntheticSessions(self.clock)
        original = sessions.verify
        def verify(*args):
            self.session_calls.append('verify')
            return original(*args)
        sessions.verify = verify
        self.app = create_secured_app(security=SecuritySettings(TOKEN), settings=ServerSettings(),
                                      repository=self.repo, data=self.data, sessions=sessions, clock=self.clock)
        self.client = TestClient(self.app, headers=HEADER)

    def test_every_operation_rejects_direct_and_duplicate_relay_before_user_or_data(self):
        bare = TestClient(self.app)
        ops = json.loads(Path(__file__).parents[1].joinpath('src/jungsi_touch/application/route_catalog.json').read_text(encoding='utf-8'))['operations']
        for op in ops:
            path = op['path'].replace('{report_id}', 'SYNTHETIC-missing').replace('{offering_id}', 'SYNTHETIC-A-2027').replace('{draft_id}', 'SYNTHETIC-missing')
            for headers in ({'Authorization': 'Bearer '+self.owner},
                            [('X-Jungsi-Relay-Token', TOKEN), ('x-jungsi-relay-token', TOKEN)]):
                with self.subTest(operation=op['id'], headers_count=len(headers)):
                    result = bare.request(op['method'], path, headers=headers, content=b'{')
                    self.assertEqual(result.status_code, 403, result.text)
                    self.assertEqual(result.json()['error']['code'], 'relay_authentication_failed')
        self.assertEqual(self.session_calls, [])
        self.assertEqual(self.repo.access_calls, [])
        self.assertEqual(self.data.calls, [])

    def test_raw_relay_ascii_length_and_whitespace_checks(self):
        bare = TestClient(self.app)
        variants = [b'', b'x'*31, b'x'*513, b' '+TOKEN.encode(), TOKEN.encode()+b' ',
                    b'\t'+TOKEN.encode(), TOKEN.encode()+b',', b'\xff'*len(TOKEN), b'x'*len(TOKEN)]
        for token in variants:
            with self.subTest(length=len(token)):
                result = bare.get('/api/v1/me', headers=[(b'X-Jungsi-Relay-Token', token)])
                self.assertEqual(result.status_code, 403)
        self.assertEqual(self.session_calls, [])
        result = bare.get('/api/v1/me', headers={'x-jUnGsI-rElAy-ToKeN': TOKEN, 'Authorization': 'Bearer '+self.owner})
        self.assertEqual(result.status_code, 200, result.text)

    def test_valid_relay_requires_verified_user_and_never_accepts_client_tier(self):
        self.assertEqual(self.client.get('/api/v1/me').status_code, 401)
        self.assertEqual(self.client.get('/api/v1/me', headers={'Authorization':'Bearer invalid'}).status_code, 401)
        response = self.client.get('/api/v1/me?member_tier=paid', headers={'Authorization':'Bearer '+self.standard})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.request('GET', '/api/v1/me', owner=self.standard).json()['member_tier'], 'standard')

    def test_config_boundaries_and_environment_are_explicit_and_repr_safe(self):
        for token in (None, '', 'x'*31, 'x'*513, 'x'*31+' ', 'x'*31+',', 'x'*31+'한'):
            app = create_secured_app(security=SecuritySettings(token), settings=ServerSettings(),
                                     repository=self.repo, data=self.data, sessions=SyntheticSessions(self.clock), clock=self.clock)
            client = TestClient(app, headers=HEADER)
            self.assertEqual(client.get('/api/v1/me').status_code, 503)
            self.assertEqual(client.get('/health/live').status_code, 200)
        for count in (32,512):
            token = 'x'*count
            app = create_secured_app(security=SecuritySettings(token), settings=ServerSettings(),
                                     repository=self.repo, data=self.data, sessions=SyntheticSessions(self.clock), clock=self.clock)
            self.assertEqual(TestClient(app).get('/api/v1/me', headers={'X-Jungsi-Relay-Token':token,'Authorization':'Bearer '+self.owner}).status_code, 200)
        with self.assertRaises(TypeError):
            create_secured_app()
        self.assertNotIn(TOKEN, repr(SecuritySettings(TOKEN)))
        with patch.dict('os.environ', {'JUNGSI_RELAY_TOKEN':TOKEN}):
            self.assertEqual(SecuritySettings.from_environment().relay_token, TOKEN)
            self.assertEqual(TestClient(workflow.create_app(settings=ServerSettings(),repository=self.repo,data=self.data,sessions=SyntheticSessions(self.clock),clock=self.clock)).get('/api/v1/me',headers={'Authorization':'Bearer '+self.owner}).status_code,200)

    def test_constant_time_bytes_comparison_after_format_validation(self):
        import jungsi_touch.infrastructure.secured_http as secured
        original = secured.hmac.compare_digest
        with patch.object(secured.hmac, 'compare_digest', wraps=original) as compare:
            self.assertEqual(self.request('GET','/api/v1/me').status_code, 200)
            args = compare.call_args.args
            self.assertIs(type(args[0]), bytes);self.assertIs(type(args[1]), bytes)
            count = compare.call_count
            self.assertEqual(TestClient(self.app).get('/api/v1/me',headers={'X-Jungsi-Relay-Token':'x'}).status_code,403)
            self.assertEqual(compare.call_count,count)

    def test_health_ready_protected_and_four_fields_only_without_user(self):
        bare = TestClient(self.app)
        self.assertEqual(bare.get('/health/live').status_code,200)
        self.assertEqual(bare.get('/health/ready').status_code,403)
        response = self.client.get('/health/ready')
        self.assertEqual(response.status_code,503)
        self.assertEqual(set(response.json()),{'status','server_timezone','production_ready','security_boundary'})
        self.assertFalse(response.json()['production_ready'])
        self.assertEqual(self.session_calls,[])
        self.assertEqual(response.headers['cache-control'],'no-store')

    def test_recursive_saved_print_replay_and_current_standard_projection(self):
        record = self.select(self.candidates(self.report()))
        raw = self.repo.reports[record['report_id']]
        raw['body']['overall']['subjects'][0]['internal_trace']={'private':MARKER}
        raw['body']['overall']['overall']['private_model']=MARKER
        raw['body']['analyses']['SYNTHETIC-A-2027']['versions']['private_curve']=MARKER
        raw['body']['candidates']['basic_university_groups'][0]['offerings'][0]['assessment']['internal_trace']=MARKER
        raw['body']['shortlist']['SYNTHETIC-A-2027']['private_source']=MARKER
        # Mutate the synthetic stored head; get_report itself returns a copy.
        self.assertIn(MARKER,json.dumps(self.repo.get_report(self.owner,record['report_id'])))
        before = deepcopy(raw)
        for path in (f"/api/v1/reports/{record['report_id']}",f"/api/v1/reports/{record['report_id']}/print"):
            result=self.request('GET',path)
            self.assertEqual(result.status_code,200,result.text)
            self.assertNotIn(MARKER,result.text)
        self.assertEqual(raw,before)
        original=self.repo.replay
        self.repo.replay=lambda *args:deepcopy(raw)
        try:
            result=self.request('POST','/api/v1/overall-reports',{'profile_id':record['profile_id']})
            self.assertEqual(result.status_code,201,result.text);self.assertNotIn(MARKER,result.text)
            self.repo.entitlements[self.owner]['active']=False
            result=self.request('POST','/api/v1/overall-reports',{'profile_id':record['profile_id']})
            self.assertEqual(result.status_code,201,result.text)
            self.assertNotIn('analyses',result.json());self.assertNotIn(MARKER,result.text)
        finally:self.repo.replay=original
        self.assertEqual(raw,before)

    def test_malformed_allowed_nested_value_and_reason_code_fail_closed(self):
        record=self.report()
        raw=self.repo.reports[record['report_id']]
        saved=deepcopy(raw['body']['overall'])
        for mutate in (lambda x:x['subjects'][0].update(standard_score=True),
                       lambda x:x['subjects'][0].update(standard_score={'private':MARKER}),
                       lambda x:x['overall'].update(reason_code=MARKER),
                       lambda x:x['overall'].update(top_percent=MARKER),
                       lambda x:x.pop('subjects')):
            raw['body']['overall']=deepcopy(saved);mutate(raw['body']['overall'])
            result=self.request('GET',f"/api/v1/reports/{record['report_id']}")
            self.assertEqual(result.status_code,503,result.text)
            self.assertEqual(result.json()['error']['code'],'security_policy_unavailable')
            self.assertNotIn(MARKER,result.text)

    def test_error_code_is_registered_and_raw_exception_never_forwarded(self):
        for code in (MARKER,{'token':MARKER},[MARKER],'비공개_'+MARKER,'DATABASE_URL','GOOGLE_DRIVE_ACCESS_TOKEN','user_id','weights_hash'):
            def execute(*args, **kwargs):raise PlatformError(code,422)
            with patch.object(self.app.state.platform,'execute',execute):
                result=self.request('GET','/api/v1/me')
            self.assertEqual(result.status_code,503,result.text)
            self.assertEqual(result.json()['error']['code'],'backend_dependency_unavailable')
            self.assertEqual(set(result.json()),{'status','error','request_id'})
            self.assertNotIn(MARKER,result.text)
        def execute(*args,**kwargs):raise RuntimeError(MARKER)
        with patch.object(self.app.state.platform,'execute',execute):
            result=self.request('GET','/api/v1/me')
        self.assertEqual(result.status_code,503);self.assertNotIn(MARKER,result.text)

    def test_catalog_rejects_missing_ref_role_untyped_map_and_cycle(self):
        projection=PublicResponseProjection()
        for mutation in (
            lambda r:r['operations'].pop(),
            lambda r:r['operations'][0]['roots'].pop('paid'),
            lambda r:r['operations'][0]['roots'].update(standard={'ref':'missing','nullable':False}),
            lambda r:r['schemas'].update(bad={'type':'Any','nullable':False}),
            lambda r:r['schemas'].update(bad={'type':'map','nullable':False,'keys':{'ref':'identifier','nullable':False}}),
            lambda r:r['schemas'].update(bad={'ref':'bad','nullable':False}),
        ):
            r=deepcopy(projection.registry);mutation(r)
            with self.assertRaises(PlatformError):PublicResponseProjection(r)

    def test_catalog_load_failure_denies_before_session_and_keeps_live(self):
        with patch('jungsi_touch.infrastructure.secured_http.PublicResponseProjection',side_effect=RuntimeError(MARKER)):
            app=create_secured_app(security=SecuritySettings(TOKEN),settings=ServerSettings(),repository=self.repo,
                                   data=self.data,sessions=SyntheticSessions(self.clock),clock=self.clock)
        client=TestClient(app,headers=HEADER)
        for path in ('/api/v1/me','/health/ready'):
            result=client.get(path)
            self.assertEqual(result.status_code,503)
            self.assertEqual(result.json()['error']['code'],'security_policy_unavailable')
            self.assertNotIn(MARKER,result.text)
        self.assertEqual(client.get('/health/live').status_code,200)
        self.assertEqual(self.repo.access_calls,[]);self.assertEqual(self.data.calls,[])

    def test_registered_decimal_union_accepts_signed_exponents_and_rejects_text(self):
        projection=PublicResponseProjection()
        schema=projection.schemas['decimal_or_integer']
        for value in ('30.00','-0.25','+1.5','1e-6','-2.5E+3','3/2',0,-10):
            self.assertEqual(projection._project(schema,value),value)
        for value in (MARKER,'DATABASE_URL','1/0','0/0','-1/+000',True,float('nan'),{'value':1}):
            with self.assertRaises(PlatformError):projection._project(schema,value)

    def test_zero_denominator_in_stored_converted_score_fails_closed(self):
        record=self.candidates(self.report())
        raw=self.repo.reports[record['report_id']]
        for value in ('1/0','0/0'):
            raw['body']['analyses']['SYNTHETIC-A-2027']['converted_score']=value
            result=self.request('GET',f"/api/v1/reports/{record['report_id']}")
            self.assertEqual(result.status_code,503,result.text)
            self.assertEqual(result.json()['error']['code'],'security_policy_unavailable')
            self.assertEqual(raw['body']['analyses']['SYNTHETIC-A-2027']['converted_score'],value)

    def test_unknown_routes_and_method_errors_use_safe_envelope(self):
        for method,path,code in [('GET','/api/v1/unknown','route_not_found'),('DELETE','/api/v1/me','method_not_allowed')]:
            result=self.client.request(method,path)
            self.assertIn(result.status_code,(404,405))
            self.assertEqual(result.json()['error']['code'],code)
            self.assertEqual(set(result.json()),{'status','error','request_id'})


class SecuredForecastTests(forecast_http.ForecastHttpTests):
    def setUp(self):
        super().setUp()
        self.app=create_secured_app(security=SecuritySettings(TOKEN),settings=ServerSettings(),repository=self.repository,
                                   data=forecast_http.SyntheticData(self.clock),sessions=SyntheticSessions(self.clock),
                                   clock=self.clock,forecast_repository=self.store,forecast_inputs=self.inputs)
        self.client=TestClient(self.app,headers=HEADER)

    def test_staff_receipts_nested_extras_removed_and_public_context_preserved(self):
        record=self.create()
        original=self.app.state.forecasts.draft_dto
        def draft(value):
            dto=original(value)
            dto['result']['forecast_70']['private_trace']=MARKER
            dto['context']['private_path']=MARKER
            for row in dto['audit_events']:row['private_secret']=MARKER
            return dto
        with patch.object(self.app.state.forecasts,'draft_dto',draft):
            result=self.request('GET',f"/api/v1/forecast-drafts/{record['draft_id']}")
        self.assertEqual(result.status_code,200,result.text);self.assertNotIn(MARKER,result.text)
        self.assertEqual(result.json()['audit_events'][0]['actor'],'SYNTHETIC-editor')
        for action in ('validations','approvals','publications'):
            body=dict(expected_revision=record['revision'],base_result_hash=record['base_result_hash'],policy_version=record['policy_version'])
            if action=='approvals':body.update(validation_receipt_hash=record['validation']['receipt_hash'],reason='합성 승인')
            if action=='publications':body['approval_receipt_hash']=record['approval']['approval_hash']
            result=self.request('POST',f"/api/v1/forecast-drafts/{record['draft_id']}/{action}",body)
            self.assertEqual(result.status_code,200,result.text);record=result.json()
        self.assertTrue(record['validation']['receipt_hash']);self.assertTrue(record['approval']['approval_hash'])
        self.repository.entitlements['SYNTHETIC-editor']=dict(active=True,starts_at=self.clock.now()-timedelta(seconds=1),expires_at=self.clock.now()+timedelta(seconds=60))
        original=self.app.state.forecasts.public
        def public(value):
            dto=original(value);dto['forecast_70']['private_source']=MARKER
            dto['recommendation_reasons'][0]['private_model']=MARKER
            dto['context']['private_actor']=MARKER
            return dto
        with patch.object(self.app.state.forecasts,'public',public):
            result=self.request('GET','/api/v1/offerings/SYNTHETIC-O/forecast')
        self.assertEqual(result.status_code,200,result.text);self.assertNotIn(MARKER,result.text)
        self.assertEqual(result.json()['context']['offering_id'],'SYNTHETIC-O')
        self.assertEqual(result.json()['policy_version'],record['policy_version'])

    def test_adjustment_union_variants_and_failed_validation_receipt(self):
        record=self.create()
        variants=[('forecast_70',dict(value='56.004',unit='점')),
                  ('acceptance_range',dict(lower='53',upper='58',unit='점')),
                  ('category_ranges',dict(ranges=record['result']['category_ranges']))]
        for target,replacement in variants:
            body=dict(expected_revision=record['revision'],base_result_hash=record['base_result_hash'],policy_version=record['policy_version'],
                      target=target,replacement=replacement,reason='합성 검토',evidence_refs=['SYNTHETIC-manual'])
            response=self.request('POST',f"/api/v1/forecast-drafts/{record['draft_id']}/adjustments",body)
            self.assertEqual(response.status_code,200,response.text);record=response.json()
            self.assertEqual(record['adjustments'][-1]['replacement'],replacement)
            self.assertEqual(record['adjustments'][-1]['actor'],'SYNTHETIC-editor')
        body=dict(expected_revision=record['revision'],base_result_hash=record['base_result_hash'],policy_version=record['policy_version'])
        response=self.request('POST',f"/api/v1/forecast-drafts/{record['draft_id']}/validations",body)
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(response.json()['validation']['status'],'failed')
        self.assertEqual(response.json()['validation']['reason_code'],'forecast_core_range_mismatch')

    def test_self_approval_is_rejected_with_relay_and_valid_user(self):
        self.inputs=forecast_http.Inputs(True)
        self.app.state.forecasts.inputs=self.inputs
        record=self.create()
        body=dict(expected_revision=record['revision'],base_result_hash=record['base_result_hash'],policy_version=record['policy_version'])
        result=self.request('POST',f"/api/v1/forecast-drafts/{record['draft_id']}/validations",body)
        self.assertEqual(result.status_code,200,result.text);record=result.json()
        body.update(expected_revision=record['revision'],validation_receipt_hash=record['validation']['receipt_hash'],reason='합성')
        result=self.request('POST',f"/api/v1/forecast-drafts/{record['draft_id']}/approvals",body)
        self.assertEqual(result.status_code,403,result.text)
        self.assertEqual(result.json()['error']['code'],'forecast_independent_approver_required')


if __name__=='__main__':
    unittest.main()
