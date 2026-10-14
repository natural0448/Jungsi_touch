"""Synthetic HTTP coverage of default PostgreSQL pass composition; no DB access."""
from datetime import timedelta
from unittest.mock import patch
import unittest

from fastapi.testclient import TestClient
from backend_synthetic_fixture import FrozenClock, SyntheticData, SyntheticRepository, SyntheticSessions
from test_http_entitlement_injection import IndependentEntitlements
from jungsi_touch.infrastructure import http_api, supabase_runtime
from jungsi_touch.infrastructure.postgres_entitlements import PostgresJeongsiPassesRepository
from jungsi_touch.infrastructure.postgres_repository import PostgresRepository
from jungsi_touch.infrastructure.secured_http import SecuritySettings
from jungsi_touch.infrastructure.settings import ServerSettings
from jungsi_touch.infrastructure.supabase_storage import SupabaseStorageClient, SupabaseStorageDataProvider


class PostgreSQLFixture(SyntheticRepository, PostgresRepository):
    """Production repository type with deliberate in-memory method overrides."""


class DefaultPassAuthorityTests(unittest.TestCase):
    def setUp(self):
        self.clock=FrozenClock()
        self.repository=PostgreSQLFixture()
        self.repository.entitlements['SYNTHETIC-owner']=dict(active=True,
            starts_at=self.clock.now()-timedelta(seconds=1),expires_at=self.clock.now()+timedelta(days=30))
        self.port=IndependentEntitlements(self.clock)
        self.settings=ServerSettings(supabase_url='https://synthetic.supabase.co',
            supabase_key='SYNTHETIC-publishable',database_url='SYNTHETIC-application-only')

    def app(self, factory):
        options=dict(settings=self.settings,repository=self.repository,data=SyntheticData(self.clock),
                     sessions=SyntheticSessions(self.clock),clock=self.clock)
        if factory=='supabase':
            def no_storage(*args,**kwargs):raise AssertionError('Unexpected storage call')
            client=SupabaseStorageClient('https://synthetic.supabase.co','sb_secret_SYNTHETIC_ONLY',
                'synthetic-private',object_prefix='synthetic/',opener=no_storage)
            options['data']=SupabaseStorageDataProvider(client,dict(format='jungsi.data-registry/v1',entries=[]))
            return supabase_runtime.create_supabase_secured_app(**options,
                security=SecuritySettings('SYNTHETIC-relay-token-for-testing-only-000000'),
                selection=supabase_runtime.RuntimeArtifactSelection((('exam_pack','SYNTHETIC-mock'),)))
        return http_api.create_app(**options)

    def test_both_factories_select_public_authority_and_never_use_legacy_paid_row(self):
        self.repository.entitlements['SYNTHETIC-owner']=dict(active=True,
            starts_at=self.clock.now()-timedelta(seconds=1),expires_at=self.clock.now()+timedelta(days=30))
        for factory in ('regular','supabase'):
            with self.subTest(factory=factory),patch.object(http_api,'PostgresJeongsiPassesRepository',return_value=self.port) as build:
                app=self.app(factory)
                build.assert_called_once_with('SYNTHETIC-application-only')
                self.assertIs(app.state.platform.session_service.entitlements,self.port)
                headers={'Authorization':'Bearer SYNTHETIC-owner',
                         'X-Jungsi-Relay-Token':'SYNTHETIC-relay-token-for-testing-only-000000'}
                with TestClient(app) as client:
                    self.port.paid=False
                    response=client.get('/api/v1/me',headers=headers)
                    self.assertEqual(response.status_code,200)
                    self.assertEqual(response.json(),dict(format='jungsi.session/v1',member_tier='standard',entitlement_expires_at=None))
                    self.assertEqual(client.get('/api/v1/offerings/search',headers=headers).status_code,403)
                    self.port.paid=True
                    paid=client.get('/api/v1/me',headers=headers)
                    self.assertEqual(paid.json()['member_tier'],'paid')
                    self.assertEqual(set(paid.json()),{'format','member_tier','entitlement_expires_at'})
                    self.assertEqual(client.get('/api/v1/offerings/search',headers=headers).status_code,200)
                    self.port.paid=False
                    self.assertEqual(client.get('/api/v1/offerings/search',headers=headers).status_code,403)

    def test_public_dependency_failure_never_falls_back_to_active_legacy_pass(self):
        self.port.failure=True
        for factory in ('regular','supabase'):
            with self.subTest(factory=factory),patch.object(http_api,'PostgresJeongsiPassesRepository',return_value=self.port):
                with TestClient(self.app(factory)) as client:
                    response=client.get('/api/v1/me',headers={'Authorization':'Bearer SYNTHETIC-owner',
                        'X-Jungsi-Relay-Token':'SYNTHETIC-relay-token-for-testing-only-000000'})
                    self.assertEqual(response.status_code,503)
                    self.assertEqual(response.json()['error']['code'],'entitlement_schema_unverified')
                    self.assertIn('no-store',response.headers['cache-control'])

    def test_uninjected_real_factory_constructs_public_reader_without_connecting(self):
        app=http_api.create_app(settings=self.settings)
        self.assertIsInstance(app.state.platform.session_service.entitlements,PostgresJeongsiPassesRepository)

    def test_explicit_local_or_test_entitlement_injection_is_retained(self):
        with patch.object(http_api,'PostgresJeongsiPassesRepository') as automatic:
            app=http_api.create_app(settings=self.settings,repository=self.repository,
                data=SyntheticData(self.clock),sessions=SyntheticSessions(self.clock),clock=self.clock,entitlements=self.port)
            self.assertIs(app.state.platform.session_service.entitlements,self.port)
            automatic.assert_not_called()

    def test_me_derives_membership_and_expiry_from_one_request_lookup(self):
        self.port.paid=True
        with patch.object(http_api,'PostgresJeongsiPassesRepository',return_value=self.port):
            with TestClient(self.app('regular')) as client:
                response=client.get('/api/v1/me',headers={'Authorization':'Bearer SYNTHETIC-owner'})
                self.assertEqual(response.status_code,200)
                self.assertEqual(response.json()['member_tier'],'paid')
                self.assertEqual(self.port.calls,[('until','SYNTHETIC-owner')])
