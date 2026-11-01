"""Loopback-only verification CLI, never an operational auth/DB fallback.

python -B -m jungsi_touch.infrastructure.local_verification --help
Issue credentials and encrypt downloaded artifacts on the receiving Windows PC.
Only explicit arguments are used; environment DB/Supabase settings are ignored.
"""
import argparse
from copy import deepcopy
from datetime import timedelta
import ipaddress
import json
import os
import re
import secrets
import sys
from urllib.parse import urlsplit
from starlette.responses import JSONResponse
from ..application.platform_ports import PlatformError, VerifiedSession
from ..application.service_end_admission import assert_service_admission
from ..application.time_contract import UtcClock, utc_instant, utc_text
from .drive_provider import DriveDataProvider, MissingDataProvider
from .http_api import create_app
from .local_dpapi import read_sealed, write_sealed_new
from .local_drive import LocalEncryptedDriveClient, LocalFilesystemClient, prepare_cache, prepare_local_cache
from .local_repository import LocalMemoryRepository
from .memory_forecast_repository import MemoryForecastRepository
from .settings import ServerSettings

MODE = 'local_verification'
ROLES = ('standard', 'paid', 'editor', 'approver')
SUBJECTS = {role: 'LOCAL-VERIFICATION-' + role for role in ROLES}


def issue_sessions(clock=None):
    now = (clock or UtcClock()).now()
    return dict(format='jungsi.local-sessions/v1', issued_at=utc_text(now), expires_at=utc_text(now + timedelta(hours=8)),
                tokens={role: secrets.token_urlsafe(32) for role in ROLES})


class LocalSessions:
    production_allowed = False

    def __init__(self, sealed, clock):
        try:
            if sealed.get('format') != 'jungsi.local-sessions/v1' or set(sealed['tokens']) != set(ROLES):
                raise ValueError()
            self.tokens = deepcopy(sealed['tokens'])
            if len(set(self.tokens.values())) != len(ROLES) or any(not isinstance(t, str) or not re.fullmatch(r'[A-Za-z0-9_-]{43}', t) for t in self.tokens.values()):
                raise ValueError()
            self.start = utc_instant(sealed['issued_at'])
            self.end = utc_instant(sealed['expires_at'])
            if not self.start <= clock.now() < self.end or self.end - self.start > timedelta(hours=8):
                raise ValueError()
        except (ValueError, TypeError, KeyError) as error:
            raise PlatformError('local_sessions_invalid_or_expired', 503) from error

    def verify(self, token, now):
        if not isinstance(token, str) or not re.fullmatch(r'[A-Za-z0-9_-]{43}', token) or not self.start <= now < self.end:
            return None
        for role, allowed in self.tokens.items():
            if secrets.compare_digest(token, allowed):
                # Explicit local role simulation only. This creates no Supabase
                # JWT and is not evidence of operational MFA enrollment.
                assurance='aal2' if role in ('editor','approver') else None
                return VerifiedSession(SUBJECTS[role],self.end,assurance,'active')
        return None


def loopback_host(value):
    if value == 'localhost':
        return True
    try:
        return ipaddress.ip_address(value).is_loopback
    except (ValueError, TypeError):
        return False


def local_origin(value):
    try:
        url = urlsplit(value)
        return url.scheme == 'http' and loopback_host(url.hostname) and not url.username and not url.password and not url.query and not url.fragment and url.path in ('', '/') and (url.port or 80) > 0
    except ValueError:
        return False


class LocalBoundary:
    """Peer/Host/Origin guard outside the entire app, including health/CORS."""
    def __init__(self, app, *, origins, port, diagnostic):
        self.app, self.origins, self.port = app, set(origins), port
        self.diagnostic = diagnostic
        self.state = app.state

    async def __call__(self, scope, receive, send):
        if scope['type'] == 'lifespan':
            return await self.app(scope, receive, send)
        if scope['type'] != 'http':
            return await send({'type': 'websocket.close', 'code': 1008})
        pairs = [(k.decode('latin1').lower(), v.decode('latin1')) for k, v in scope.get('headers', [])]
        headers = dict(pairs)
        peer = scope.get('client')
        try:
            host = urlsplit('http://' + headers.get('host', ''))
            host_ok = loopback_host(host.hostname) and not host.username and not host.password and not host.path and not host.query and not host.fragment and (host.port or 80) == self.port
        except ValueError:
            host_ok = False
        duplicated = any(sum(k == name for k, _ in pairs) != 1 for name in ('host',) if name in headers)
        duplicated = duplicated or any(sum(k == name for k, _ in pairs) > 1 for name in ('origin', 'authorization'))
        proxy = any(k == 'forwarded' or k.startswith('x-forwarded-') for k in headers)
        origin_ok = 'origin' not in headers or headers['origin'] in self.origins
        if not peer or not loopback_host(peer[0]) or not host_ok or not origin_ok or duplicated or proxy:
            response = JSONResponse(status_code=403, content={'status': 'error', 'error': {'code': 'local_loopback_only'}},
                                    headers={'Cache-Control': 'no-store', 'X-Jungsi-Mode': MODE})
            return await response(scope, receive, send)
        async def marked_send(message):
            if message['type'] == 'http.response.start':
                message = {**message, 'headers': [*message.get('headers', []), (b'x-jungsi-mode', MODE.encode())]}
            await send(message)
        if scope.get('path') == '/health/ready' and scope.get('method') == 'GET':
            try:
                assert_service_admission(self.app.state.service_end_clock.now())
            except PlatformError as error:
                code = 'service_ended' if error.code == 'service_ended' and error.http_status == 403 else 'security_policy_unavailable'
                response = JSONResponse(status_code=403 if code == 'service_ended' else 503,
                    content={'status':'error','error':{'code':code}},
                    headers={'Cache-Control':'no-store','X-Jungsi-Mode':MODE})
                return await response(scope, receive, send)
            response = JSONResponse(dict(status='local_ready', mode=MODE, local_ready=True, production_ready=False,
                storage='memory_ephemeral_lost_on_restart', database='NOT_RUN', auth='test_allowlist',
                real_data=self.diagnostic(), server_timezone='UTC'), headers={'Cache-Control': 'no-store'})
            return await response(scope, receive, marked_send)
        return await self.app(scope, receive, marked_send)


def build_local_app(*, sessions, cache=None, registry_sha256=None, hold_no_data=False,
                    origins=('http://127.0.0.1:3000', 'http://localhost:3000'),
                    port=8000, university_ids=(), clock=None, exam_id=None, selection_sha256=None, cache_source='drive'):
    if type(port) is not int or not 1 <= port <= 65535 or not origins or any(not local_origin(o) for o in origins):
        raise PlatformError('local_binding_invalid', 503)
    if any(not isinstance(value, str) or not value.strip() for value in university_ids):
        raise PlatformError('local_university_scope_invalid', 503)
    clock = clock or UtcClock()
    auth = LocalSessions(sessions, clock)
    repository = LocalMemoryRepository({SUBJECTS['paid']: dict(active=True, starts_at=auth.start, expires_at=auth.end)})
    forecast = MemoryForecastRepository({
        SUBJECTS['editor']: dict(edit=True, approve=False, university_ids=list(university_ids)),
        SUBJECTS['approver']: dict(edit=False, approve=True, university_ids=list(university_ids)),
    })
    if cache is not None:
        if hold_no_data:
            raise PlatformError('local_data_mode_conflict', 503)
        client = LocalFilesystemClient.from_file(cache, selection_sha256) if cache_source == 'local_filesystem' else LocalEncryptedDriveClient.from_file(cache, registry_sha256, trusted_selection_sha256=selection_sha256, trusted_source=cache_source)
        data = DriveDataProvider(client, client.registry)
        def diagnostic():
            result = client.diagnostic()
            if not exam_id:
                result.update(status='hold', exam_binding='NOT_PROVIDED')
            else:
                entry = data.entries.get(('exam_pack', exam_id))
                identity = entry.get('local_artifact_id') if entry and cache_source == 'local_filesystem' else ('exam_pack', exam_id)
                row = client.records.get(identity)
                usable = entry is not None and entry.get('status') == 'approved' and row is not None
                usable = usable and all('engine_approved' not in value or value['engine_approved'] is True for value in (entry, row[1]))
                result['exam_binding'] = 'pinned' if usable else 'HOLD'
                if not usable:
                    result['status'] = 'hold'
            return result
    elif hold_no_data:
        data = MissingDataProvider()
        diagnostic = lambda: dict(status='hold', reason_code='approved_registry_not_provided', approved_count=0,
                                   registered_count=0, unapproved_count=0, engine_hold_count=0, verified_cache_count=0,
                                   missing_kinds=['approved_registry'], numeric_acceptance='NOT_RUN', drive_api='NOT_RUN')
    else:
        raise PlatformError('local_approved_cache_required', 503)
    # An explicit blank settings object prevents inherited operational env/DB,
    # network sessions and Drive writers from entering the local factory.
    app = create_app(settings=ServerSettings(allowed_origins=tuple(origins)), repository=repository,
                     sessions=auth, data=data, clock=clock, forecast_repository=forecast,operating_mode="legacy_synthetic")
    app.state.local_repository = repository
    return LocalBoundary(app, origins=origins, port=port, diagnostic=diagnostic)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    issue = commands.add_parser('issue', help='write NEW DPAPI local test sessions; never print bearer tokens')
    issue.add_argument('--sessions', required=True)
    token = commands.add_parser('token', help='owner decrypts a role token in their local interactive terminal only')
    token.add_argument('--sessions', required=True)
    token.add_argument('--role', choices=ROLES, required=True)
    prepare = commands.add_parser('prepare', help='encrypt publisher-pinned files on THIS receiving PC')
    for flag in ('registry', 'registry-sha256', 'input-folder', 'destination'):
        prepare.add_argument('--' + flag, required=True)
    prepare.add_argument('--source', choices=('filesystem', 'drive'), required=True)
    prepare.add_argument('--selection')
    prepare.add_argument('--selection-sha256')
    local_prepare = commands.add_parser('prepare-local', help='encrypt local publisher selection; NO Drive API proof')
    for flag in ('selection', 'selection-sha256', 'destination'):
        local_prepare.add_argument('--' + flag, required=True)
    serve = commands.add_parser('serve', help='127.0.0.1 only; ephemeral storage and local test auth')
    serve.add_argument('--sessions', required=True)
    modes = serve.add_mutually_exclusive_group(required=True)
    modes.add_argument('--cache')
    modes.add_argument('--hold-no-data', action='store_true')
    serve.add_argument('--registry-sha256')
    serve.add_argument('--selection-sha256')
    serve.add_argument('--cache-source', choices=('drive', 'filesystem', 'local_filesystem'), default='drive')
    serve.add_argument('--exam-id')
    serve.add_argument('--university-id', action='append', default=[])
    serve.add_argument('--origin', action='append')
    serve.add_argument('--port', type=int, default=8000)
    args = parser.parse_args(argv)
    try:
        if args.command == 'issue':
            write_sealed_new(args.sessions, issue_sessions())
            print(json.dumps(dict(status='issued_encrypted', mode=MODE, roles=list(ROLES), token_values='NOT_PRINTED')))
        elif args.command == 'token':
            if not sys.stdout.isatty():
                raise PlatformError('local_interactive_token_read_required', 503)
            sessions = LocalSessions(read_sealed(args.sessions), UtcClock())
            print(sessions.tokens[args.role])
        elif args.command == 'prepare':
            prepare_cache(registry_path=args.registry, registry_sha256=args.registry_sha256, input_folder=args.input_folder,
                          destination=args.destination, source=args.source, selection_path=args.selection,
                          selection_sha256=args.selection_sha256, token=os.environ.get('GOOGLE_DRIVE_ACCESS_TOKEN'))
            print(json.dumps(dict(status='encrypted_new_cache', mode=MODE, production_ready=False)))
        elif args.command == 'prepare-local':
            prepare_local_cache(selection_path=args.selection, selection_sha256=args.selection_sha256, destination=args.destination)
            print(json.dumps(dict(status='encrypted_new_cache', mode=MODE, transport='local_filesystem', production_ready=False, drive_api='NOT_RUN')))
        else:
            app = build_local_app(sessions=read_sealed(args.sessions), cache=args.cache, registry_sha256=args.registry_sha256,
                hold_no_data=args.hold_no_data, port=args.port, origins=tuple(args.origin or ('http://127.0.0.1:3000', 'http://localhost:3000')),
                university_ids=args.university_id, exam_id=args.exam_id, selection_sha256=args.selection_sha256, cache_source=args.cache_source)
            import uvicorn
            uvicorn.run(app, host='127.0.0.1', port=args.port, access_log=False, proxy_headers=False,
                        forwarded_allow_ips='', log_level='warning', workers=1)
        return 0
    except (PlatformError, OSError, ValueError, KeyError, TypeError):
        # Private filenames, raw JSON, DSNs, headers and tokens are never logged.
        print(json.dumps(dict(status='local_verification_failed', details='private_configuration_check_required')), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
