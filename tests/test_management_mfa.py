"""Management AAL gates are separate from active staff scope and paid access."""
from dataclasses import replace
from datetime import timedelta
import unittest

from fastapi.testclient import TestClient
from backend_synthetic_fixture import FrozenClock, SyntheticData, SyntheticRepository, SyntheticSessions
from forecast_synthetic_fixture import Inputs
from jungsi_touch.infrastructure.http_api import create_app
from jungsi_touch.infrastructure.memory_forecast_repository import MemoryForecastRepository


class AssuranceSessions(SyntheticSessions):
    def __init__(self,clock,level):super().__init__(clock);self.level=level;self.status='active'
    def verify(self,token,now):
        session=super().verify(token,now)
        return replace(session,assurance_level=self.level,account_status=self.status) if session else None


class ManagementMfaTests(unittest.TestCase):
    def setUp(self):
        self.clock=FrozenClock();self.repository=SyntheticRepository()
        self.sessions=AssuranceSessions(self.clock,'aal1')
        self.store=MemoryForecastRepository({'SYNTHETIC-editor':dict(edit=True,approve=True,university_ids=['SYNTHETIC-U'])})
        self.client=TestClient(create_app(repository=self.repository,data=SyntheticData(self.clock),sessions=self.sessions,
            clock=self.clock,forecast_repository=self.store,forecast_inputs=Inputs(False)))
        self.headers={'Authorization':'Bearer SYNTHETIC-editor','Idempotency-Key':'SYNTHETIC-mfa-only'}

    def tearDown(self):self.client.close()

    def test_all_management_endpoints_require_verified_aal2_before_payload_or_draft_read(self):
        routes=[('GET','/api/v1/forecast-capabilities'),('GET','/api/v1/forecast-drafts'),
                ('POST','/api/v1/offerings/SYNTHETIC-O/forecast-drafts'),
                ('GET','/api/v1/forecast-drafts/SYNTHETIC-absent')]
        routes.extend(('POST','/api/v1/forecast-drafts/SYNTHETIC-absent/'+action)
            for action in ('adjustments','validations','approvals','publications'))
        for method,path in routes:
            with self.subTest(method=method,path=path):
                response=self.client.request(method,path,headers=self.headers,content='{' if method=='POST' else None)
                self.assertEqual(response.status_code,403)
                self.assertEqual(response.json()['error']['code'],'management_mfa_required')
        self.assertFalse(self.store.drafts)

    def test_general_and_paid_student_reads_do_not_require_management_mfa(self):
        for level in ('aal1',None):
            self.sessions.level=level
            response=self.client.get('/api/v1/me',headers=self.headers)
            self.assertEqual(response.status_code,200)
            self.assertEqual(set(response.json()),{'format','member_tier','entitlement_expires_at'})
            self.assertEqual(response.json()['member_tier'],'standard')
            self.assertEqual(self.client.get('/api/v1/admission-history',headers=self.headers).status_code,200)
            self.assertEqual(self.client.get('/api/v1/offerings/search',headers=self.headers).status_code,403)
        self.repository.entitlements['SYNTHETIC-editor']=dict(active=True,
            starts_at=self.clock.now()-timedelta(seconds=1),expires_at=self.clock.now()+timedelta(hours=1))
        self.assertEqual(self.client.get('/api/v1/offerings/search',headers=self.headers).status_code,200)
        response=self.client.get('/api/v1/offerings/SYNTHETIC-O/forecast',headers=self.headers)
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json()['status'],'pending')

    def test_aal2_preserves_staff_scope_but_does_not_grant_a_paid_exception(self):
        self.sessions.level='aal2'
        response=self.client.get('/api/v1/forecast-capabilities',headers=self.headers)
        self.assertEqual(response.status_code,200)
        self.assertEqual(set(response.json()['capabilities']),{'editor','approver'})
        self.assertEqual(self.client.get('/api/v1/offerings/search',headers=self.headers).status_code,403)
        self.store.authorities['SYNTHETIC-editor']=dict(edit=False,approve=False,university_ids=[])
        rejected=self.client.post('/api/v1/offerings/SYNTHETIC-O/forecast-drafts',headers=self.headers,content='{')
        self.assertEqual(rejected.status_code,403)
        self.assertEqual(rejected.json()['error']['code'],'forecast_forbidden')

    def test_client_assurance_field_cannot_upgrade_a_verified_aal1_session(self):
        response=self.client.post('/api/v1/offerings/SYNTHETIC-O/forecast-drafts',headers=self.headers,json={'aal':'aal2'})
        self.assertEqual(response.status_code,403)
        self.assertEqual(response.json()['error']['code'],'management_mfa_required')

    def test_nonstaff_capability_query_keeps_the_empty_response_without_mfa(self):
        response=self.client.get('/api/v1/forecast-capabilities',headers={'Authorization':'Bearer SYNTHETIC-student'})
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json(),dict(format='jungsi.forecast-capabilities/v1',capabilities=[],university_ids=[]))

    def test_inactive_or_unknown_account_cannot_manage_with_existing_aal2_and_scope(self):
        self.sessions.level='aal2'
        for status,http,code in (('suspended',403,'management_account_inactive'),
                                (None,503,'management_account_state_unverified')):
            self.sessions.status=status
            for method,path in (('GET','/api/v1/forecast-capabilities'),('POST','/api/v1/offerings/SYNTHETIC-O/forecast-drafts')):
                response=self.client.request(method,path,headers=self.headers,content='{' if method=='POST' else None)
                self.assertEqual(response.status_code,http)
                self.assertEqual(response.json()['error']['code'],code)
            self.assertEqual(self.client.get('/api/v1/me',headers=self.headers).status_code,200)
            self.assertEqual(self.client.get('/api/v1/admission-history',headers=self.headers).status_code,200)
