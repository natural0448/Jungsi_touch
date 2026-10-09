"""Opt-in, read-only official history display; never a calculation release.

The immutable private descriptor binds current DB rows to reviewed public
metadata. Its approval is display-purpose/environment only. Default factories,
entitlements, runtime Storage approval and source flags remain unchanged.
"""
from __future__ import annotations
from contextlib import contextmanager
from copy import deepcopy
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
import hashlib
import json
import re
from uuid import UUID

from ..application.platform import OFFERING_FIELDS, HISTORY_FIELDS, source_url
from ..application.platform_ports import CatalogRelease, PlatformError, VerifiedSession
from ..application.time_contract import utc_instant, calendar_date
from .drive_provider import MissingDataProvider
from .secured_http import SecuredBoundary


VIEW = 'jungsi_data_ingest.admission_results_curated_v21_1'
OPERATIONS = ('history.search', 'offerings.search', 'offering.read', 'recruitment.read', 'session.read')
DB_FIELDS = (
    'release_id', 'result_id', 'academic_year', 'school_id', 'university_code',
    'university', 'recruit_group', 'recruit_group_raw', 'department', 'track',
    'offering_pk', 'anchor_2027_pks', 'metric_kind', 'metric_value_literal',
    'metric_value_numeric', 'metric_value_json_type', 'cohort', 'statistic_label',
    'active_service', 'source_path', 'source_sha256', 'source_location',
    'source_review_status', 'original_record_locator', 'field_presence_types',
    'row_fingerprint', 'curation_release_id', 'curation_fields', 'curation_evidence',
)
GUARD_FIELDS = ('guard_active_curation_release_id', 'guard_school_source_school_id', 'guard_school_after_row_fingerprint')
SELECT_ROWS = (
    'SELECT ' + ','.join('v.' + name + ('::text AS metric_value_numeric' if name == 'metric_value_numeric' else '')
                         for name in DB_FIELDS) +
    ' FROM ' + VIEW + ' v JOIN unnest(%s::text[],%s::text[]) AS selected(release_id,result_id) '
    'ON v.release_id=selected.release_id AND v.result_id=selected.result_id LIMIT %s'
)


def _invalid():
    return PlatformError('official_history_scope_unverified', 503)


def _object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise _invalid()
        result[key] = value
    return result


def _same(a, b):
    """JSON value AND type equality, including missing vs null and bool vs int."""
    if type(a) is not type(b):
        return False
    if isinstance(a, dict):
        return set(a) == set(b) and all(_same(a[k], b[k]) for k in a)
    if isinstance(a, list):
        return len(a) == len(b) and all(_same(x, y) for x, y in zip(a, b))
    return a == b


def _decimal(value):
    if value is None:
        return None
    if type(value) is not str or not re.fullmatch(r'[+-]?[0-9]+(?:\.[0-9]+)?', value):
        raise _invalid()
    n = Decimal(value)
    raw = format(n, 'f')
    if '.' in raw:
        raw = raw.rstrip('0').rstrip('.')
    return '0' if n == 0 else raw


@dataclass(frozen=True, repr=False)
class OfficialHistoryDisplayScope:
    """Bytes/SHA-bound display descriptor; not a runtime model approval."""
    content: dict = field(repr=False)
    sha256: str
    environment: str

    @classmethod
    def from_bytes(cls, raw, sha256, *, environment):
        if (type(raw) is not bytes or not 1 <= len(raw) <= 2_000_000 or
                type(sha256) is not str or not re.fullmatch('[0-9a-f]{64}', sha256) or
                hashlib.sha256(raw).hexdigest() != sha256):
            raise _invalid()
        try:
            body = json.loads(raw, object_pairs_hook=_object, parse_float=Decimal,
                              parse_constant=lambda _: (_ for _ in ()).throw(_invalid()))
        except (UnicodeError, ValueError, TypeError):
            raise _invalid() from None
        return cls(body, sha256, environment)

    def validate(self, now):
        try:
            body = self.content
            approval = body['approval']
            if (body['format'] != 'jungsi.official-history-display/v1' or
                    body['purpose'] != 'official_history_display' or body['source_view'] != VIEW or
                    self.environment not in ('local_verification', 'isolated_cloud_review') or
                    body['environment'] != self.environment or approval['status'] != 'approved' or
                    approval['revoked'] is not False or body['engine_approved'] is not False or
                    body['production_allowed'] is not False or body['nationwide_collection_complete'] is not False or
                    not isinstance(approval['approval_id'], str) or not approval['approval_id'].strip() or
                    type(approval['operations']) is not list or len(approval['operations']) != len(OPERATIONS) or
                    set(approval['operations']) != set(OPERATIONS)):
                raise _invalid()
            issued, expires, instant = map(utc_instant, (approval['issued_at'], approval['expires_at'], now))
            if not issued <= instant < expires or (expires - issued).total_seconds() > 86400:
                raise _invalid()
            subjects = approval['review_subjects']
            if (type(subjects) is not list or not 1 <= len(subjects) <= 20 or
                    any(type(s) is not str or str(UUID(s)) != s for s in subjects) or
                    len(set(subjects)) != len(subjects)):
                raise _invalid()
            evidence = body['source_evidence']
            if (not isinstance(evidence, dict) or
                    any(type(evidence.get(k)) is not str or not re.fullmatch('[0-9a-f]{64}', evidence[k])
                        for k in ('metric_lineage_sha256', 'offering_boundary_receipt_sha256'))):
                raise _invalid()
            catalog = body['catalog']
            if (catalog['format'] != 'jungsi.catalog-release/v1' or catalog['status'] != 'approved' or
                    not isinstance(catalog['version'], str) or not re.fullmatch('[A-Za-z0-9][A-Za-z0-9._:-]{0,127}', catalog['version']) or
                    catalog['nationwide_collection_complete'] is not False or
                    catalog['admission_probability_provided'] is not False):
                raise _invalid()
            utc_instant(catalog['as_of'])
            offerings, history, bindings = catalog['offerings'], catalog['history'], body['bindings']
            if (type(offerings) is not list or not 1 <= len(offerings) <= 100 or type(history) is not list or
                    not 1 <= len(history) <= 200 or type(bindings) is not list or len(bindings) != len(history)):
                raise _invalid()
            by_id = {}
            for row in offerings:
                if (not isinstance(row, dict) or set(row) != set(OFFERING_FIELDS) | {'practical_required'} or
                        row['practical_required'] is not False or type(row['academic_year']) is not int or
                        row['academic_year'] not in (2024, 2025, 2026, 2027) or
                        any(row[k] is not None and type(row[k]) is not str for k in OFFERING_FIELDS if k != 'academic_year') or
                        not isinstance(row['offering_id'], str) or not row['offering_id'] or row['offering_id'] in by_id):
                    raise _invalid()
                by_id[row['offering_id']] = row
            identities, indexes = set(), set()
            for binding in bindings:
                index, expected = binding['native_history_index'], binding['expected_db_row']
                if (type(index) is not int or not 0 <= index < len(history) or index in indexes or
                        not isinstance(expected, dict) or set(expected) != set(DB_FIELDS)):
                    raise _invalid()
                indexes.add(index)
                key = (expected['release_id'], expected['result_id'])
                if (any(type(v) is not str or not v for v in key) or key in identities or
                        type(expected['academic_year']) is not int or expected['active_service'] is not True or
                        not re.fullmatch('[0-9a-f]{64}', expected['row_fingerprint']) or
                        not re.fullmatch('[0-9a-f]{64}', expected['source_sha256'])):
                    raise _invalid()
                identities.add(key)
                row = history[index]
                offering = by_id[binding['offering_id']]
                if (set(row) != set(HISTORY_FIELDS) | {'verification_status'} or
                        row['verification_status'] != 'verified_official' or
                        row['offering_id'] != binding['offering_id'] or
                        type(binding['source_offering_pk']) is not str or not binding['source_offering_pk'] or
                        not _same(expected['offering_pk'], binding['source_offering_pk']) or
                        binding['offering_id'] != str(expected['academic_year']) + ':' + binding['source_offering_pk'] or
                        expected['academic_year'] != row['academic_year'] or
                        any(not _same(row[k], offering[k]) for k in OFFERING_FIELDS) or
                        row['value'] is not None and type(row['value']) not in (str, int) or
                        any(row[k] is not None and type(row[k]) is not str for k in HISTORY_FIELDS if k not in ('academic_year', 'value'))):
                    raise _invalid()
                source_url(row['source_url'])
                if expected['metric_value_numeric'] != _decimal(expected['metric_value_numeric']):
                    raise _invalid()
                if row['source_as_of'] is not None:
                    calendar_date(row['source_as_of'])
            if set(by_id) != {r['offering_id'] for r in history}:
                raise _invalid()
            strategy = body.get('read_strategy', {'name': 'curated_view'})
            if not isinstance(strategy, dict) or strategy.get('name') not in ('curated_view', 'uncurated_pk_equivalent'):
                raise _invalid()
            if self.environment == 'isolated_cloud_review' and strategy['name'] != 'uncurated_pk_equivalent':
                raise _invalid()
            if strategy['name'] == 'uncurated_pk_equivalent':
                if (any(type(strategy.get(k)) is not str or not re.fullmatch('[0-9a-f]{64}', strategy[k])
                        for k in ('equivalence_receipt_sha256', 'rls_receipt_sha256', 'join_receipt_sha256')) or
                        strategy.get('snapshot_revision') != 'v21_1' or
                        type(strategy.get('active_view_chain')) is not list or not 1 <= len(strategy['active_view_chain']) <= 32 or
                        type(strategy.get('active_curation_release_ids')) is not list or not 1 <= len(strategy['active_curation_release_ids']) <= 32 or
                        any(type(v) is not str or not v for v in strategy['active_curation_release_ids']) or
                        len(set(strategy['active_curation_release_ids'])) != len(strategy['active_curation_release_ids'])):
                    raise _invalid()
                names = set()
                for view in strategy['active_view_chain']:
                    name = view['relation']
                    if (view['schema'] != 'jungsi_data_ingest' or type(name) is not str or
                            not re.fullmatch(r'admission_results_(?:effective|curated_v[0-9]+(?:_[0-9]+)?)', name) or name in names or
                            not re.fullmatch('[0-9a-f]{64}', view['view_definition_sha256']) or
                            type(view['reloptions']) is not list or 'security_invoker=true' not in view['reloptions']):
                        raise _invalid()
                    names.add(name)
                if ('admission_results_curated_v21_1' not in names or
                        len({b['expected_db_row']['release_id'] for b in bindings}) != 1 or
                        any(b['expected_db_row'][k] is not None for b in bindings
                            for k in ('curation_release_id', 'curation_fields', 'curation_evidence'))):
                    raise _invalid()
            return deepcopy(body)
        except PlatformError:
            raise
        except (KeyError, TypeError, ValueError, AttributeError):
            raise _invalid() from None


class PostgresOfficialHistoryDisplayProvider(MissingDataProvider):
    """Only get_catalog is supplied. Every value comes from a fresh scoped SELECT."""
    def __init__(self, *, scope, clock, database_url=None, sslrootcert=None, connector=None, reader=None):
        self.scope, self.clock = scope, clock
        self._url, self._ca, self._connector, self._reader = database_url, sslrootcert, connector, reader

    @contextmanager
    def _transaction(self):
        if not self._url or not self._ca:
            raise PlatformError('official_history_db_unavailable', 503)
        connector = self._connector
        if connector is None:
            import psycopg
            connector = psycopg.connect
        try:
            with connector(self._url, sslmode='verify-full', sslrootcert=self._ca,
                           connect_timeout=5, prepare_threshold=None) as connection:
                connection.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
                connection.execute("SET LOCAL TIME ZONE 'UTC'")
                connection.execute("SET LOCAL statement_timeout='5000ms'")
                role = connection.execute(
                    "SELECT current_user,r.rolsuper,r.rolbypassrls,c.relowner=r.oid,"
                    "has_table_privilege(current_user,c.oid,'SELECT'),"
                    "has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),"
                    "current_setting('row_security'),current_setting('transaction_read_only'),"
                    "pg_has_role(current_user,'jungsi_backend_owner','MEMBER'),"
                    "pg_has_role(current_user,'jungsi_backend_owner','USAGE'),pg_has_role(current_user,'postgres','MEMBER') "
                    "FROM pg_catalog.pg_class c JOIN pg_catalog.pg_roles r ON r.rolname=current_user "
                    "WHERE c.oid=to_regclass(%s)", (VIEW,)
                ).fetchone()
                if not _same(list(role) if role is not None else None,
                             ['jungsi_backend_app', False, False, False, True, False, 'on', 'on', False, False, False]):
                    raise PlatformError('official_history_runtime_role_unverified', 503)
                yield connection
        except PlatformError:
            raise
        except Exception:
            raise PlatformError('official_history_db_unavailable', 503) from None

    def _rows(self, body):
        selected = [b['expected_db_row'] for b in body['bindings']]
        if self._reader is not None:
            return self._reader(deepcopy(selected))
        # A real connector requires the independently qualified bulk JOIN/RLS
        # strategy. Unqualified local curated reads are not a safe fallback.
        if body.get('read_strategy', {}).get('name') != 'uncurated_pk_equivalent':
            raise _invalid()
        with self._transaction() as connection:
            strategy = body.get('read_strategy', {})
            pk = strategy.get('name') == 'uncurated_pk_equivalent'
            fields = DB_FIELDS + GUARD_FIELDS if pk else DB_FIELDS
            if pk:
                chain = strategy['active_view_chain']
                names = [v['relation'] for v in chain] + ['admission_results', 'curation_overlays', 'school_scope_overlays']
                metadata = connection.execute(
                    "WITH qualified AS (SELECT to_regclass(scoped.qualified_name) AS target_oid FROM unnest(%s::text[]) AS scoped(qualified_name)) SELECT c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity,c.reloptions,c.relowner=r.oid,has_table_privilege(current_user,c.oid,'SELECT'),has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),has_table_privilege('anon',c.oid,'SELECT'),has_table_privilege('authenticated',c.oid,'SELECT'),CASE WHEN c.relkind='v' THEN pg_get_viewdef(c.oid,true) ELSE NULL END FROM qualified q JOIN pg_catalog.pg_class c ON c.oid=q.target_oid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_roles r ON r.rolname=current_user WHERE n.nspname='jungsi_data_ingest' AND current_user='jungsi_backend_app' AND NOT r.rolsuper AND NOT r.rolbypassrls AND current_setting('row_security')='on' AND current_setting('transaction_read_only')='on' AND NOT pg_has_role(current_user,'jungsi_backend_owner','MEMBER') AND NOT pg_has_role(current_user,'jungsi_backend_owner','USAGE') AND NOT pg_has_role(current_user,'postgres','MEMBER')" ,
                    (['jungsi_data_ingest.' + name for name in names],)
                ).fetchall()
                if len(metadata) != len(names):
                    raise PlatformError('official_history_runtime_role_unverified', 503)
                by_name = {v['relation']: v for v in chain}
                for entry in metadata:
                    name, kind, rls, force, options, owner, readable, writable, anon, authenticated, definition = entry
                    if not _same([owner, readable, writable, anon, authenticated], [False, True, False, False, False]):
                        raise PlatformError('official_history_runtime_role_unverified', 503)
                    if name in by_name:
                        view = by_name[name]
                        if (kind != 'v' or not _same(options, view['reloptions']) or type(definition) is not str or
                                hashlib.sha256(definition.encode()).hexdigest() != view['view_definition_sha256']):
                            raise _invalid()
                    elif kind != 'r' or rls is not True or force is not True:
                        raise PlatformError('official_history_runtime_role_unverified', 503)
                projection = ','.join(
                    ('NULL::text AS ' + k if k == 'curation_release_id' else 'NULL::jsonb AS ' + k) if k.startswith('curation_') else
                    'a.' + k + ('::integer AS academic_year' if k == 'academic_year' else '::text AS metric_value_numeric' if k == 'metric_value_numeric' else '')
                    for k in DB_FIELDS)
                query = ('WITH selected AS (SELECT release_id,result_id FROM unnest(%s::text[],%s::text[]) AS scoped(release_id,result_id)) SELECT ' + projection +
                         ',c.release_id AS guard_active_curation_release_id,p.source_school_id AS guard_school_source_school_id,p.after_row_fingerprint AS guard_school_after_row_fingerprint '
                         'FROM selected s JOIN jungsi_data_ingest.admission_results a ON a.release_id=s.release_id AND a.result_id=s.result_id '
                         'LEFT JOIN jungsi_data_ingest.curation_overlays c ON c.base_release_id=a.release_id AND c.result_id=a.result_id AND c.release_id=ANY(%s::text[]) '
                         'LEFT JOIN jungsi_data_ingest.school_scope_overlays p ON p.release_id=a.release_id AND p.result_id=a.result_id ORDER BY a.result_id LIMIT %s')
                args = ([r['release_id'] for r in selected], [r['result_id'] for r in selected], strategy['active_curation_release_ids'], len(selected) + 1)
            else:
                query, args = SELECT_ROWS, ([r['release_id'] for r in selected], [r['result_id'] for r in selected], len(selected) + 1)
            raw = connection.execute(query, args).fetchall()
        if any(not isinstance(r, (tuple, list)) or len(r) != len(fields) for r in raw):
            raise _invalid()
        return [dict(zip(fields, row)) for row in raw]

    def get_catalog(self):
        if not isinstance(self.scope, OfficialHistoryDisplayScope):
            raise _invalid()
        body = self.scope.validate(self.clock.now())
        try:
            rows = self._rows(body)
            if type(rows) is not list or len(rows) != len(body['bindings']):
                raise _invalid()
            by_id = {}
            pk = body.get('read_strategy', {}).get('name') == 'uncurated_pk_equivalent'
            for row in rows:
                if not isinstance(row, dict) or set(row) != set(DB_FIELDS + GUARD_FIELDS if pk else DB_FIELDS):
                    raise _invalid()
                if pk and (row['guard_active_curation_release_id'] is not None or not (
                    row['guard_school_source_school_id'] is None and row['guard_school_after_row_fingerprint'] is None or
                    _same(row['guard_school_source_school_id'], row['school_id']) and _same(row['guard_school_after_row_fingerprint'], row['row_fingerprint']))):
                    raise _invalid()
                row = {k: deepcopy(row[k]) for k in DB_FIELDS}
                row['metric_value_numeric'] = _decimal(row['metric_value_numeric'])
                key = (row['release_id'], row['result_id'])
                if key in by_id:
                    raise _invalid()
                by_id[key] = row
            history = deepcopy(body['catalog']['history'])
            for binding in body['bindings']:
                expected = binding['expected_db_row']
                row = by_id[(expected['release_id'], expected['result_id'])]
                if not _same(row, expected):
                    raise _invalid()
                value = json.loads(row['metric_value_literal'], parse_float=Decimal, object_pairs_hook=_object)
                kind = 'null' if value is None else 'string' if type(value) is str else 'number' if type(value) is int else None
                original = history[binding['native_history_index']]['value']
                if kind != row['metric_value_json_type'] or not _same(value, original):
                    raise _invalid()
                numeric = row['metric_value_numeric']
                if numeric is not None:
                    if type(numeric) is not str or Decimal(numeric) != Decimal(value):
                        raise _invalid()
                history[binding['native_history_index']]['value'] = value
            catalog = body['catalog']
            return CatalogRelease(catalog['version'], 'approved', utc_instant(catalog['as_of']),
                                  tuple(deepcopy(catalog['offerings'])), tuple(history))
        except PlatformError:
            raise
        except (KeyError, TypeError, ValueError, InvalidOperation):
            raise _invalid() from None


class _DisplaySessions:
    def __init__(self, sessions, scope):
        self._sessions, self._scope = sessions, scope

    def verify(self, token, now):
        session = self._sessions.verify(token, now)
        if session is None:
            return None
        if not isinstance(session, VerifiedSession):
            raise PlatformError('authentication_required', 401)
        body = self._scope.validate(now)
        if session.subject_id not in body['approval']['review_subjects']:
            raise PlatformError('review_subject_not_allowed', 403)
        return session


class _DisplayBoundary(SecuredBoundary):
    def verify(self, request):
        super().verify(request)
        path = request.url.path
        allowed = path in ('/api/v1/admission-history', '/api/v1/offerings/search', '/api/v1/me') or bool(
            re.fullmatch('/api/v1/offerings/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}(?:/recruitment)?', path))
        if request.method != 'GET' or not allowed:
            raise PlatformError('display_operation_not_supported', 503)


def create_official_history_display_app(*, provider, security, settings, repository, sessions, clock):
    """Explicit DI only: existing default factory and legacy entitlements unchanged."""
    if not isinstance(provider, PostgresOfficialHistoryDisplayProvider):
        raise _invalid()
    from .http_api import _compose_app
    return _compose_app(settings=settings, repository=repository, data=provider,
                        sessions=_DisplaySessions(sessions, provider.scope), clock=clock,
                        boundary=_DisplayBoundary(security))
