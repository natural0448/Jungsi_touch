"""Verified Supabase session + server-owned entitlement -> Actor."""
from .authorization import Actor
from .platform_ports import PlatformError, VerifiedSession
from .time_contract import utc_instant


class SessionService:
    def __init__(self, sessions, entitlements, clock):
        self.sessions, self.entitlements, self.clock = sessions, entitlements, clock

    def actor(self, authorization):
        if not isinstance(authorization, str) or not authorization.startswith('Bearer '):
            raise PlatformError('authentication_required', 401)
        token = authorization[7:]
        if not token or len(token) > 16384 or any(c.isspace() for c in token):
            raise PlatformError('authentication_required', 401)
        now = utc_instant(self.clock.now())
        session = self.sessions.verify(token, now)
        if not isinstance(session, VerifiedSession) or utc_instant(session.expires_at) <= now:
            raise PlatformError('authentication_required', 401)
        if not isinstance(session.subject_id, str) or not session.subject_id.strip():
            raise PlatformError('authentication_required', 401)
        if session.assurance_level is not None and (type(session.assurance_level) is not str
                or session.assurance_level not in ('aal1','aal2')):
            raise PlatformError('authentication_required', 401)
        if session.account_status is not None and (type(session.account_status) is not str or not session.account_status.strip()):
            raise PlatformError('authentication_required',401)
        until=None
        current=getattr(self.entitlements,'active_paid_until',None)
        if callable(current):
            expiry=current(session.subject_id,now)
            if expiry is not None:
                try:until=utc_instant(expiry)
                except (TypeError,ValueError):raise PlatformError('entitlement_unavailable',503) from None
                if until<=now:raise PlatformError('entitlement_unavailable',503)
            paid=until is not None
        else:
            # Existing explicit synthetic ports without an expiry method retain
            # their boolean contract. The production public reader has no fallback.
            paid=self.entitlements.active_paid(session.subject_id,now)
        if type(paid) is not bool:
            raise PlatformError('entitlement_unavailable', 503)
        return Actor(session.subject_id,paid,session.assurance_level,session.account_status,until)

    def read(self, actor):
        if actor.subject_id is None: raise PlatformError('authentication_required',401)
        if not actor.paid_active:
            return dict(format='jungsi.session/v1',member_tier='standard',entitlement_expires_at=None)
        until=actor.entitlement_expires_at
        if until is None:
            method=getattr(self.entitlements,'active_paid_until',None)
            if method is None: raise PlatformError('entitlement_unavailable',503)
            until=method(actor.subject_id,utc_instant(self.clock.now()))
        if until is None or utc_instant(until)<=utc_instant(self.clock.now()):
            raise PlatformError('entitlement_unavailable',503)
        from .time_contract import utc_text
        return dict(format='jungsi.session/v1',member_tier='paid',entitlement_expires_at=utc_text(utc_instant(until)))
