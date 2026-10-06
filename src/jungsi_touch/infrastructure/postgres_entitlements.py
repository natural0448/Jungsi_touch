"""Read-only owner-master entitlement adapter; explicit injection, no migration.

The source contract was received separately from production schema/history.
Every read checks the live schema and SELECT-only trusted backend role.
No fallback, grant/revoke write, profile-admin override or paid-role synthesis.
"""
import json
import re
from uuid import UUID

from ..application.platform_ports import PlatformError
from ..application.time_contract import utc_instant
from .postgres_repository import PostgresRepository


SOURCE_DDL_SHA256 = '42056870c4fa77dc10d76f00cec37ed0b279eb2e96a03a15e0a32414b0df5f58'
EXPECTED_COLUMNS = {
    'id': ('int8', False), 'user_id': ('uuid', False),
    'starts_at': ('timestamptz', False), 'ends_at': ('timestamptz', False),
    'note': ('text', True), 'granted_by': ('uuid', True),
    'revoked_at': ('timestamptz', True), 'revoked_by': ('uuid', True),
    'created_at': ('timestamptz', False),
}


def _expression(value):
    return re.sub(r'[\s()]', '', value).lower() if type(value) is str else None


class PostgresJeongsiPassesRepository:
    """Dedicated database reader implementing the application entitlement port.

    Connection URLs and identities are never returned by probe/error messages.
    The observed backend SELECT policy permits this role to read all rows.
    The parameterized WHERE user_id, not RLS claims, enforces caller scope.
    A table owner, superuser, BYPASSRLS role or writer is rejected.
    """

    def __init__(self, database_url, *, connector=None):
        self._database = PostgresRepository(database_url, connector=connector)

    @staticmethod
    def _schema(connection):
        exists = connection.execute(
            "SELECT to_regclass('public.jeongsi_passes') IS NOT NULL"
        ).fetchone()
        if not isinstance(exists, (tuple, list)) or len(exists) != 1 or exists[0] is not True:
            raise PlatformError('entitlement_schema_unverified', 503)
        columns = connection.execute(
            'SELECT column_name,udt_name,is_nullable FROM information_schema.columns '
            'WHERE table_schema=%s AND table_name=%s', ('public', 'jeongsi_passes')
        ).fetchall()
        if (not isinstance(columns, (tuple, list)) or len(columns) != len(EXPECTED_COLUMNS)
                or any(not isinstance(row, (tuple, list)) or len(row) != 3 for row in columns)):
            raise PlatformError('entitlement_schema_unverified', 503)
        if (any(type(name) is not str or type(kind) is not str or type(nullable) is not str
                       or nullable not in ('YES', 'NO') for name, kind, nullable in columns)):
            raise PlatformError('entitlement_schema_unverified', 503)
        actual = {name: (kind, nullable == 'YES') for name, kind, nullable in columns}
        if actual != EXPECTED_COLUMNS:
            raise PlatformError('entitlement_schema_unverified', 503)
        constraints = connection.execute(
            "SELECT conname,contype,convalidated,pg_get_constraintdef(oid) "
            "FROM pg_catalog.pg_constraint WHERE conrelid='public.jeongsi_passes'::regclass"
        ).fetchall()
        if (not isinstance(constraints, (tuple, list))
                or any(not isinstance(row, (tuple, list)) or len(row) != 4 for row in constraints)):
            raise PlatformError('entitlement_schema_unverified', 503)
        period = any(name == 'jeongsi_passes_period' and kind == 'c' and valid is True
                     and _expression(definition) == 'checkends_at>starts_at'
                     for name, kind, valid, definition in constraints)
        owner_fk = any(kind == 'f' and valid is True and
                       _expression(definition) == 'foreignkeyuser_idreferencesauth.usersidondeletecascade'
                       for _, kind, valid, definition in constraints)
        primary_key = any(kind == 'p' and valid is True and _expression(definition) == 'primarykeyid'
                          for _, kind, valid, definition in constraints)
        if not period or not owner_fk or not primary_key:
            raise PlatformError('entitlement_schema_unverified', 503)
        role = connection.execute(
            "SELECT c.relrowsecurity,r.rolsuper,r.rolbypassrls,c.relowner=r.oid,"
            "has_table_privilege(current_user,c.oid,'SELECT'),"
            "has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),"
            "has_any_column_privilege(current_user,c.oid,'INSERT,UPDATE,REFERENCES') "
            "FROM pg_catalog.pg_class c JOIN pg_catalog.pg_roles r ON r.rolname=current_user "
            "WHERE c.oid='public.jeongsi_passes'::regclass AND r.rolname=%s",
            ('jungsi_backend_app',)
        ).fetchone()
        if (not isinstance(role, (tuple, list)) or len(role) != 7
                or any(type(value) is not bool for value in role)
                or tuple(role) != (True, False, False, False, True, False, False)):
            raise PlatformError('entitlement_runtime_role_unverified', 503)
        policies = connection.execute(
            "SELECT polname,polcmd,polpermissive,ARRAY(SELECT CASE WHEN role_id=0 THEN 'public' "
            "ELSE pg_get_userbyid(role_id) END FROM unnest(polroles) AS policy_role(role_id)),"
            "pg_get_expr(polqual,polrelid),pg_get_expr(polwithcheck,polrelid) "
            "FROM pg_catalog.pg_policy WHERE polrelid='public.jeongsi_passes'::regclass "
            "AND polcmd IN ('r','*')"
        ).fetchall()
        allowed = {'auth.uid=user_idoris_admin', 'auth.uid=user_idorpublic.is_admin'}
        if (not isinstance(policies, (tuple, list)) or len(policies) != 2
                or any(not isinstance(row, (tuple, list)) or len(row) != 6 for row in policies)):
            raise PlatformError('entitlement_rls_unverified', 503)
        if any(type(name) is not str or command != 'r' or permissive is not True
               or not isinstance(roles, (tuple, list)) or any(type(role) is not str for role in roles)
               or with_check is not None
               for name, command, permissive, roles, expression, with_check in policies):
            raise PlatformError('entitlement_rls_unverified', 503)
        by_name = {row[0]: row for row in policies}
        if set(by_name) != {'jeongsi_passes: select own or admin', 'jeongsi_passes: jungsi backend read'}:
            raise PlatformError('entitlement_rls_unverified', 503)
        own, backend = by_name['jeongsi_passes: select own or admin'], by_name['jeongsi_passes: jungsi backend read']
        if (tuple(own[3]) != ('public',) or _expression(own[4]) not in allowed
                or len(backend[3]) != 2 or set(backend[3]) != {'jungsi_backend_app','jungsi_backend_owner'}
                or _expression(backend[4]) != 'true'):
            raise PlatformError('entitlement_rls_unverified', 503)

    def probe(self):
        with self._database.transaction(read_only=True) as connection:
            self._schema(connection)
        return {'status': 'verified', 'authority': 'public.jeongsi_passes',
                'schema_contract': 'owner_source_ddl_and_observed_runtime_policy',
                'runtime_role': 'select_only_trusted_backend', 'subject_scope': 'parameterized_user_id'}

    def active_paid_until(self, subject_id, now):
        try:
            subject = UUID(subject_id)
            instant = utc_instant(now)
        except (TypeError, ValueError, AttributeError):
            raise PlatformError('entitlement_identity_or_time_invalid', 503) from None
        with self._database.transaction(read_only=True) as connection:
            self._schema(connection)
            # Claims come only from the application's server-verified subject.
            connection.execute("SELECT set_config('request.jwt.claim.sub',%s,true),"
                               "set_config('request.jwt.claims',%s,true)",
                               (str(subject), json.dumps({'sub': str(subject), 'role': 'authenticated'})))
            row = connection.execute(
                'SELECT max(ends_at) FROM public.jeongsi_passes '
                'WHERE user_id=%s AND revoked_at IS NULL AND starts_at<=%s AND ends_at>%s',
                (subject, instant, instant)
            ).fetchone()
            if row is None or len(row) != 1:
                raise PlatformError('entitlement_result_invalid', 503)
            if row[0] is None:
                return None
            try:
                expires = utc_instant(row[0])
            except (TypeError, ValueError):
                raise PlatformError('entitlement_result_invalid', 503) from None
            if expires <= instant:
                raise PlatformError('entitlement_result_invalid', 503)
            return expires

    def active_paid(self, subject_id, now):
        return self.active_paid_until(subject_id, now) is not None
