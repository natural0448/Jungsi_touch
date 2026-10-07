"""Explicit preparation only. No legacy factory or operating provider transition."""
from __future__ import annotations
from dataclasses import dataclass, field
import hmac
import os

from fastapi.responses import JSONResponse
from ..application.public_response import PublicResponseProjection, ProjectedPlatformService
from ..application.platform_ports import PlatformError


@dataclass(frozen=True)
class SecuritySettings:
    relay_token: str | None = field(default=None, repr=False)

    @classmethod
    def from_environment(cls):
        return cls(os.environ.get('JUNGSI_RELAY_TOKEN'))


def _token(value):
    if type(value) is not str or not 32 <= len(value) <= 512:
        return None
    try:
        raw = value.encode('ascii')
    except UnicodeError:
        return None
    return raw if all(33 <= char <= 126 and char != 44 for char in raw) else None


class SecuredBoundary:
    def __init__(self, security):
        self._expected = _token(security.relay_token) if type(security) is SecuritySettings else None
        try:
            self.projection = PublicResponseProjection()
        except Exception:
            self.projection = None

    def verify(self, request):
        if self._expected is None or self.projection is None:
            raise PlatformError('security_policy_unavailable', 503)
        values = [value for name, value in request.scope.get('headers', []) if name.lower() == b'x-jungsi-relay-token']
        if len(values) != 1:
            raise PlatformError('relay_authentication_failed', 403)
        raw = values[0]
        if (type(raw) is not bytes or len(raw) != len(self._expected) or
            not all(33 <= char <= 126 and char != 44 for char in raw) or
            not hmac.compare_digest(raw, self._expected)):
            raise PlatformError('relay_authentication_failed', 403)

    def platform(self, *args, **kwargs):
        return ProjectedPlatformService(*args, projection=self.projection, **kwargs)

    def error(self, request, code='backend_dependency_unavailable', http=503):
        body = dict(status='error', error={'code': code}, request_id=request.state.request_id)
        try:
            if type(http) is not int or http not in (400, 401, 403, 404, 405, 409, 413, 422, 503) or self.projection is None:
                raise ValueError()
            body = self.projection.auxiliary('error', body)
        except Exception:
            http = 503
            body = dict(status='error', error={'code': 'security_policy_unavailable' if self.projection is None else 'backend_dependency_unavailable'}, request_id=request.state.request_id)
        return JSONResponse(status_code=http, content=body)

    def ready(self, configured):
        body = dict(status='ready' if configured else 'configuration_pending', server_timezone='UTC',
                    production_ready=False, security_boundary='scoped_preparation')
        return JSONResponse(status_code=200 if configured else 503, content=self.projection.auxiliary('readiness', body))


def create_secured_app(*, security, settings=None, repository=None, data=None, sessions=None, clock=None,
                       forecast_repository=None, forecast_inputs=None, entitlements=None):
    from .http_api import _compose_app
    return _compose_app(settings=settings, repository=repository, data=data, sessions=sessions, clock=clock,
                        forecast_repository=forecast_repository, forecast_inputs=forecast_inputs,
                        entitlements=entitlements, boundary=SecuredBoundary(security))
