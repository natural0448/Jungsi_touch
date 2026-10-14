"""HTTP regression for independent server entitlement authority; synthetic only."""
from datetime import timedelta
import unittest

from fastapi.testclient import TestClient
from backend_synthetic_fixture import FrozenClock,SyntheticSessions,SyntheticRepository,SyntheticData
from jungsi_touch.application.platform_ports import PlatformError
from jungsi_touch.infrastructure.http_api import create_app
from jungsi_touch.infrastructure.settings import ServerSettings


class IndependentEntitlements:
    def __init__(self,clock):self.clock=clock;self.paid=False;self.failure=False;self.calls=[]
    def active_paid(self,owner,now):
        self.calls.append(('active',owner))
        if self.failure:raise PlatformError('entitlement_schema_unverified',503)
        return self.paid
    def active_paid_until(self,owner,now):
        self.calls.append(('until',owner))
        if self.failure:raise PlatformError('entitlement_schema_unverified',503)
        return now+timedelta(seconds=60) if self.paid else None
    def probe(self):return {'status':'failed' if self.failure else 'verified','private_detail':'never expose'}


class EntitlementInjectionHTTPTests(unittest.TestCase):
    def setUp(self):
        self.clock=FrozenClock();self.repository=SyntheticRepository();self.entitlements=IndependentEntitlements(self.clock)
        self.client=TestClient(create_app(settings=ServerSettings(),repository=self.repository,data=SyntheticData(self.clock),
                                         sessions=SyntheticSessions(self.clock),clock=self.clock,entitlements=self.entitlements))
    def tearDown(self):self.client.close()

    def test_separate_authority_ignores_legacy_repository_paid_row(self):
        self.repository.entitlements['SYNTHETIC-owner']={'active':True,'starts_at':self.clock.now()-timedelta(seconds=1),
                                                        'expires_at':self.clock.now()+timedelta(seconds=60)}
        response=self.client.get('/api/v1/me',headers={'Authorization':'Bearer SYNTHETIC-owner'})
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json(),{'format':'jungsi.session/v1','member_tier':'standard','entitlement_expires_at':None})
        self.entitlements.paid=True
        response=self.client.get('/api/v1/me',headers={'Authorization':'Bearer SYNTHETIC-owner'})
        self.assertEqual(response.json()['member_tier'],'paid')
        self.assertEqual(set(response.json()),{'format','member_tier','entitlement_expires_at'})
        self.assertEqual(response.headers['cache-control'],'no-store')

    def test_missing_or_unverified_session_does_not_read_entitlement(self):
        for headers in ({},{'Authorization':'Bearer invalid'}):
            self.assertEqual(self.client.get('/api/v1/me',headers=headers).status_code,401)
        self.assertEqual(self.entitlements.calls,[])

    def test_dependency_failure_is_503_without_legacy_fallback(self):
        self.entitlements.failure=True
        response=self.client.get('/api/v1/me',headers={'Authorization':'Bearer SYNTHETIC-owner'})
        self.assertEqual(response.status_code,503)
        self.assertEqual(response.json()['error'],{'code':'entitlement_schema_unverified'})

    def test_readiness_reports_port_probe_without_private_details(self):
        self.entitlements.failure=True
        response=self.client.get('/health/ready')
        self.assertEqual(response.status_code,503)
        self.assertEqual(response.json()['entitlements'],{'status':'failed'})
        self.assertNotIn('private_detail',response.text)

    def test_probe_failure_or_absence_cannot_claim_ready(self):
        self.repository.probe=lambda:{'status':'verified'}
        settings=ServerSettings('SYNTHETIC-url','SYNTHETIC-key','SYNTHETIC-db','SYNTHETIC-drive',
                                'SYNTHETIC-input','SYNTHETIC-output','SYNTHETIC-registry')
        class Broken:
            def probe(self):raise RuntimeError('SYNTHETIC-private-detail')
        for port,status in ((Broken(),'unavailable'),(object(),'not_run_probe_missing')):
            with TestClient(create_app(settings=settings,repository=self.repository,data=SyntheticData(self.clock),
                                       sessions=SyntheticSessions(self.clock),clock=self.clock,entitlements=port)) as client:
                response=client.get('/health/ready')
                self.assertEqual(response.status_code,503)
                self.assertEqual(response.json()['entitlements'],{'status':status})
                self.assertNotIn('private-detail',response.text)
