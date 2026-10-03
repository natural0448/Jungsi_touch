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
        paid = self.entitlements.active_paid(session.subject_id, now)
        if type(paid) is not bool:
            raise PlatformError('entitlement_unavailable', 503)
        return Actor(session.subject_id, paid)
