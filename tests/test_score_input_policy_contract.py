"""REQ-27 current Python fail-closed and exact 22+3 contract; invented fixtures only."""
from copy import deepcopy
from datetime import timedelta
import json
from pathlib import Path
import sys
import unittest
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'src'));sys.path.insert(0,str(ROOT/'scripts'))
from backend_synthetic_fixture import FrozenClock,SyntheticRepository,SyntheticSessions,SyntheticData,score_input
from jungsi_touch.infrastructure.http_api import create_app
from jungsi_touch.infrastructure.settings import ServerSettings
from check_project_consistency import validate_score_input_policy
from starlette.testclient import TestClient

class ScoreInputPolicyContractTests(unittest.TestCase):
    def setUp(self):
        self.clock=FrozenClock();self.repository=SyntheticRepository();self.data=SyntheticData(self.clock)
        self.repository.entitlements['SYNTHETIC-owner']=dict(active=True,starts_at=self.clock.now()-timedelta(days=1),expires_at=self.clock.now()+timedelta(days=1))
        # No legacy argument: the default current Python path is intentionally unsupported for new policy writes.
        self.app=create_app(settings=ServerSettings(),repository=self.repository,data=self.data,sessions=SyntheticSessions(self.clock),clock=self.clock)
        self.client=TestClient(self.app)
    def request(self,method,path,body=None,owner='SYNTHETIC-owner'):
        return self.client.request(method,path,json=body,headers={'Authorization':'Bearer '+owner,'Idempotency-Key':'SYNTHETIC-policy-key'})
    def test_current_default_registers_all25_and_holds_paid_profile_before_write(self):
        self.assertEqual(self.app.state.operating_mode,'rights')
        self.assertEqual(len([r for r in self.app.routes if r.path.startswith('/api/v1/')]),25)
        operations=json.loads((ROOT/'src/jungsi_touch/application/route_catalog.json').read_text(encoding='utf-8'))['operations']
        self.assertEqual(len(operations),25)
        for operation in operations:
            with self.subTest(operation=operation['id']):
                path=operation['path'].replace('{report_id}','SYNTHETIC-missing').replace('{offering_id}','SYNTHETIC-missing').replace('{draft_id}','SYNTHETIC-missing')
                response=self.client.request(operation['method'],path,content=b'{bad json')
                self.assertEqual((response.status_code,response.json()['error']['code']),(401,'authentication_required'))
        self.assertEqual(self.repository.access_calls,[])
        self.assertEqual(self.data.calls,[])
        r=self.request('POST','/api/v1/score-profiles',dict(scores=score_input(),confirmed=True))
        self.assertEqual((r.status_code,r.json()['error']['code']),(503,'score_input_policy_unavailable'))
        self.assertEqual(self.repository.profiles,{})
        self.assertEqual(self.repository.audit,[])
    def test_free_personal_input_is_403_and_never_falls_back_to_old_overall(self):
        for path,body in [('/api/v1/score-profiles',dict(scores=score_input(),confirmed=True)),('/api/v1/overall-reports',score_input())]:
            r=self.request('POST',path,body,'SYNTHETIC-standard')
            self.assertEqual((r.status_code,r.json()['error']['code']),(403,'paid_required'))
        self.assertEqual(self.repository.profiles,{})
    def test_paid_flat_overall_is_hold_without_profile_or_input_debit(self):
        r=self.request('POST','/api/v1/overall-reports',score_input())
        self.assertEqual((r.status_code,r.json()['error']['code']),(503,'score_input_policy_unavailable'))
        self.assertEqual(self.repository.profiles,{})
    def test_new_python_reads_are_explicitly_unimplemented_not_fake_results(self):
        for path in ['/api/v1/report-sample','/api/v1/me/score-input-status?exam_id=SYNTHETIC-mock']:
            r=self.request('GET',path,owner='SYNTHETIC-standard')
            self.assertEqual((r.status_code,r.json()['error']['code']),(503,'score_input_policy_unavailable'))
    def test_correction_nonadmin_is_rejected_before_body(self):
        r=self.client.post('/api/v1/management/score-input-corrections',content='not json',headers={'Authorization':'Bearer SYNTHETIC-owner'})
        self.assertEqual((r.status_code,r.json()['error']['code']),(403,'management_mfa_required'))
    def test_legacy_synthetic_is_explicit_and_preserves_read_only_expired_own_report(self):
        legacy=create_app(settings=ServerSettings(),repository=self.repository,data=self.data,sessions=SyntheticSessions(self.clock),clock=self.clock,operating_mode='legacy_synthetic')
        self.assertEqual(len([r for r in legacy.routes if r.path.startswith('/api/v1/')]),22)
        with TestClient(legacy) as client:
            headers={'Authorization':'Bearer SYNTHETIC-owner','Idempotency-Key':'SYNTHETIC-initial'}
            p=client.post('/api/v1/score-profiles',json=dict(scores=score_input(),confirmed=False),headers=headers)
            self.assertEqual(p.status_code,201,p.text)
            headers['Idempotency-Key']='SYNTHETIC-overall'
            r=client.post('/api/v1/overall-reports',json=dict(profile_id=p.json()['profile_id']),headers=headers)
            self.assertEqual(r.status_code,201,r.text);rid=r.json()['report_id']
        self.repository.entitlements['SYNTHETIC-owner']['active']=False
        for suffix in ['', '/print']:
            r=self.request('GET','/api/v1/reports/'+rid+suffix)
            self.assertEqual(r.status_code,200,r.text)
        self.assertEqual(len(self.repository.profiles),1)
        self.assertEqual(len(self.repository.reports),1)
    def test_exact_legacy22_and_extension3_cannot_be_dropped_or_promoted(self):
        source=json.loads((ROOT/'docs/current/service_spec.json').read_text(encoding='utf-8'))
        self.assertEqual(validate_score_input_policy(source),[])
        for mutation in ['drop_legacy','drop_extension','session','activate','daily_cost','physical','personal_free','export_paid']:
            with self.subTest(mutation=mutation):
                s=deepcopy(source);c=s['score_input_policy_contract']
                if mutation=='drop_legacy':s['operations']=[o for o in s['operations'] if o['id']!='history.search']
                elif mutation=='drop_extension':s['operations']=[o for o in s['operations'] if o['id']!='report.sample.read']
                elif mutation=='session':c['public_session_fields'].append('pass_id')
                elif mutation=='activate':c['activation_status']='PASS'
                elif mutation=='daily_cost':c['daily_limits']['calculation_cost']='daily'
                elif mutation=='physical':c['daily_limits']['preserved'].remove('per_request_runtime')
                elif mutation=='personal_free':next(o for o in s['operations'] if o['id']=='score-profile.create')['member_tiers']=['standard','paid']
                else:next(o for o in s['operations'] if o['id']=='report.export')['member_tiers']=['paid']
                self.assertTrue(validate_score_input_policy(s))
    def test_prepared_sql_null_checks_owner_scope_and_server_rpc_are_source_only(self):
        sql=(ROOT/'database/migrations/006_score_input_policy.prepared.sql').read_text(encoding='utf-8')
        self.assertIn('last_outcome IS NOT NULL',sql);self.assertIn('last_rejection_code IS NOT NULL',sql);self.assertIn('rejection_code IS NOT NULL AND rejection_code IN',sql)
        self.assertIn('stage,previous_attempt_id)',sql);self.assertIn('CREATE INDEX score_profile_owner_exam',sql);self.assertIn('CREATE INDEX score_report_owner_profile_recent',sql)
        rpc=(ROOT/'database/migrations/006a_paid_first_use_server_rpc.prepared.sql').read_text(encoding='utf-8')
        self.assertIn('SECURITY DEFINER SET search_path=pg_catalog',rpc)
        self.assertIn("(SELECT auth.role())='service_role'",rpc)
        self.assertIn('p.id=target_pass_id AND p.user_id=target_subject',rpc)
        self.assertIn('TO service_role;',rpc);self.assertNotIn('TO authenticated;',rpc)
        self.assertNotIn('INSERT INTO public.',rpc);self.assertNotIn('UPDATE public.',rpc)
