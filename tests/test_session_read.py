import unittest
from datetime import timedelta
from jungsi_touch.application.sessions import SessionService
from jungsi_touch.application.platform_ports import PlatformError
from backend_synthetic_fixture import FrozenClock,SyntheticSessions,SyntheticRepository

class Entitlements(SyntheticRepository):
    def active_paid_until(self,owner,now):
        row=self.entitlements.get(owner)
        return row['expires_at'] if self.active_paid(owner,now) else None

class SessionReadTests(unittest.TestCase):
    def setUp(self):
        self.clock=FrozenClock();self.repo=Entitlements();self.service=SessionService(SyntheticSessions(self.clock),self.repo,self.clock)
    def test_authenticated_standard_and_paid_only_server_entitlement(self):
        actor=self.service.actor('Bearer SYNTHETIC-owner');self.assertEqual(self.service.read(actor)['member_tier'],'standard')
        self.repo.entitlements[actor.subject_id]=dict(active=True,starts_at=self.clock.now()-timedelta(seconds=1),expires_at=self.clock.now()+timedelta(seconds=60))
        dto=self.service.read(self.service.actor('Bearer SYNTHETIC-owner'))
        self.assertEqual(dto['member_tier'],'paid');self.assertTrue(dto['entitlement_expires_at'].endswith('Z'));self.assertEqual(set(dto),{'format','member_tier','entitlement_expires_at'})
    def test_expired_and_future_pass_do_not_grant_paid(self):
        actor=self.service.actor('Bearer SYNTHETIC-owner')
        for start,end in ((-10,0),(10,100)):
            self.repo.entitlements[actor.subject_id]=dict(active=True,starts_at=self.clock.now()+timedelta(seconds=start),expires_at=self.clock.now()+timedelta(seconds=end))
            dto=self.service.read(self.service.actor('Bearer SYNTHETIC-owner'));self.assertEqual(dto['member_tier'],'standard');self.assertIsNone(dto['entitlement_expires_at'])
    def test_no_token_or_unverified_token_never_returns_session(self):
        for header in (None,'Bearer invalid','Basic SYNTHETIC-owner'):
            with self.assertRaises(PlatformError):self.service.actor(header)
