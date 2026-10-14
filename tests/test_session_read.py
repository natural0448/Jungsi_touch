import unittest
from datetime import timedelta
from jungsi_touch.application.sessions import SessionService
from jungsi_touch.application.platform_ports import PlatformError
from backend_synthetic_fixture import FrozenClock,SyntheticSessions,SyntheticRepository
from jungsi_touch.application.platform_ports import VerifiedSession
from jungsi_touch.application.authorization import Actor,AccessController
from jungsi_touch.application.ports import ReportAccessRecord
from types import SimpleNamespace

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

class AdministratorExceptionTests(unittest.TestCase):
    def setUp(self):
        self.clock=FrozenClock();self.repo=Entitlements();self.role='admin';self.status='active';self.aal='aal2'
        self.sessions=SimpleNamespace(verify=lambda token,now: VerifiedSession('SYNTHETIC-admin',now+timedelta(seconds=60),self.aal,self.status,self.role) if token=='SYNTHETIC-admin' else None)
        self.service=SessionService(self.sessions,self.repo,self.clock)
    def actor(self):return self.service.actor('Bearer SYNTHETIC-admin')
    def test_admin_without_pass_has_only_three_public_fields_and_private_verified_origin(self):
        actor=self.actor();dto=self.service.read(actor)
        self.assertEqual(dto,dict(format='jungsi.session/v1',member_tier='paid',entitlement_expires_at=None))
        self.assertEqual(actor.admin_access_origin,'verified_own_profile_active_admin_aal2')
        self.assertTrue(actor.paid_active)
    def test_admin_real_pass_keeps_the_actual_expiry(self):
        until=self.clock.now()+timedelta(seconds=37,microseconds=123)
        self.repo.entitlements['SYNTHETIC-admin']=dict(active=True,starts_at=self.clock.now()-timedelta(seconds=1),expires_at=until)
        from jungsi_touch.application.time_contract import utc_text,utc_instant
        self.assertEqual(self.service.read(self.actor())['entitlement_expires_at'],utc_text(utc_instant(until)))
    def test_aal1_inactive_student_editor_approver_and_unknown_role_do_not_get_exception(self):
        for role,status,aal in [('admin','active','aal1'),('admin','inactive','aal2'),('student','active','aal2'),('editor','active','aal2'),('approver','active','aal2'),(None,'active','aal2')]:
            with self.subTest(role=role,status=status,aal=aal):
                self.role,self.status,self.aal=role,status,aal
                self.assertEqual(self.service.read(self.actor())['member_tier'],'standard')
    def test_unknown_profile_preserves_a_verified_ordinary_paid_pass(self):
        self.role=None;self.status=None
        self.repo.entitlements['SYNTHETIC-admin']=dict(active=True,starts_at=self.clock.now()-timedelta(seconds=1),expires_at=self.clock.now()+timedelta(seconds=30))
        dto=self.service.read(self.actor());self.assertEqual(dto['member_tier'],'paid');self.assertIsNotNone(dto['entitlement_expires_at'])
    def test_each_request_rechecks_role_and_status(self):
        self.assertEqual(self.service.read(self.actor())['member_tier'],'paid')
        self.role='student';self.assertEqual(self.service.read(self.actor())['member_tier'],'standard')
        self.role='admin';self.status='inactive';self.assertEqual(self.service.read(self.actor())['member_tier'],'standard')
    def test_expired_or_unverified_token_is_not_an_admin_exception(self):
        with self.assertRaises(PlatformError)as failure:self.service.actor('Bearer forged')
        self.assertEqual(failure.exception.http_status,401)
        actor=self.actor();self.clock.advance(60)
        with self.assertRaises(PlatformError)as failure:self.service.read(actor)
        self.assertEqual(failure.exception.http_status,401)
    def test_paid_missing_expiry_and_copied_origin_are_still_503(self):
        original=self.actor()
        copied=Actor(original.subject_id,True,original.assurance_level,original.account_status,None,original.account_role,original.admin_access_origin,original.session_expires_at)
        for actor in [Actor('SYNTHETIC-user',True),copied]:
            with self.subTest(actor=actor):
                with self.assertRaises(PlatformError)as failure:self.service.read(actor)
                self.assertEqual(failure.exception.code,'entitlement_unavailable')
    def test_admin_exception_does_not_grant_other_report_ownership(self):
        controller=AccessController(SimpleNamespace(lookup_access=lambda rid:ReportAccessRecord('SYNTHETIC-other',True)))
        decision=controller.operation_access('report.export',self.actor(),report_id='SYNTHETIC-report')
        self.assertFalse(decision.allowed);self.assertEqual(decision.http_status,404)
    def test_public_projection_preserves_nullable_expiry_and_removes_private_admin_origin(self):
        from jungsi_touch.application.public_response import PublicResponseProjection
        actor=self.actor();dto=self.service.read(actor)
        projected=PublicResponseProjection().project('session.read',actor,{**dto,'role':'admin','admin_access_origin':actor.admin_access_origin})
        self.assertEqual(projected,dto);self.assertEqual(len(projected),3)
