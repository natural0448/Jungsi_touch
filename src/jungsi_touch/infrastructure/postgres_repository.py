"""Supabase PostgreSQL adapter. Append-only revisions/audit, atomic CAS and replay."""
from contextlib import contextmanager
from copy import deepcopy
import hashlib
import json
from uuid import uuid4
from datetime import date, datetime
from ..application.platform_ports import PlatformError
from ..application.ports import ReportAccessRecord
from ..application.time_contract import UTC, utc_instant, utc_text

EXPECTED_COLUMN_TYPES = {('profiles','created_at'):'timestamptz',('reports','updated_at'):'timestamptz',
    ('report_revisions','created_at'):'timestamptz',('requests','created_at'):'timestamptz',
    ('entitlements','starts_at'):'timestamptz',('entitlements','expires_at'):'timestamptz',('entitlements','issued_at'):'timestamptz',
    ('audit_events','occurred_at'):'timestamptz',('artifact_releases','published_at'):'timestamptz',
    ('artifact_releases','source_as_of'):'date',('schema_versions','applied_at'):'timestamptz'}


class PostgresRepository:
    def __init__(self, database_url, *, connector=None):
        self._url=database_url
        if connector is None:
            import psycopg
            connector=psycopg.connect
        self._connector=connector

    @contextmanager
    def transaction(self, *, include_baseline=False, read_only=False):
        if not self._url: raise PlatformError('storage_not_configured',503)
        try:
            with self._connector(self._url,sslmode='require',connect_timeout=5,prepare_threshold=None) as connection:
                if read_only:connection.execute('SET TRANSACTION READ ONLY')
                baseline=connection.execute('SHOW TIMEZONE').fetchone()[0] if include_baseline else None
                # Works for transaction pooling too; never depends on a prior session.
                connection.execute("SET LOCAL TIME ZONE 'UTC'")
                yield (connection,baseline) if include_baseline else connection
        except PlatformError: raise
        except Exception as exc: raise PlatformError('storage_unavailable',503) from exc

    @staticmethod
    def lock(connection,owner,operation,key):
        number=int.from_bytes(hashlib.sha256((owner+'\0'+operation+'\0'+key).encode()).digest()[:8],'big',signed=True)
        connection.execute('SELECT pg_advisory_xact_lock(%s)',(number,))

    @staticmethod
    def replay_in(connection,owner,operation,key,digest):
        row=connection.execute('SELECT digest,result FROM jungsi_backend.requests WHERE owner_id=%s AND operation=%s AND request_key=%s',
                               (owner,operation,key)).fetchone()
        if row:
            if row[0]!=digest: raise PlatformError('idempotency_conflict',409)
            return deepcopy(row[1])
        return None

    def replay(self,owner,operation,key,digest):
        with self.transaction() as c:return self.replay_in(c,owner,operation,key,digest)

    @staticmethod
    def remember(c,owner,operation,key,digest,result,now):
        c.execute('INSERT INTO jungsi_backend.requests(owner_id,operation,request_key,digest,result,created_at) VALUES(%s,%s,%s,%s,%s::jsonb,%s)',
                  (owner,operation,key,digest,json.dumps(result),utc_instant(now)))
        c.execute('INSERT INTO jungsi_backend.audit_events(event_id,owner_id,operation,resource_id,revision,occurred_at) VALUES(%s,%s,%s,%s,%s,%s)',
                  (uuid4().hex,owner,operation,result.get('report_id',result.get('profile_id')),result.get('revision',1),utc_instant(now)))

    def create_profile(self,owner,scores,confirmed,now,key,digest,operation='score-profile.create'):
        with self.transaction() as c:
            self.lock(c,owner,operation,key)
            replay=self.replay_in(c,owner,operation,key,digest)
            if replay is not None:return replay
            result=dict(profile_id='profile-'+uuid4().hex,owner_id=owner,scores=deepcopy(scores),confirmed=confirmed,created_at=utc_text(now))
            c.execute('INSERT INTO jungsi_backend.profiles(profile_id,owner_id,scores,confirmed,created_at) VALUES(%s,%s,%s::jsonb,%s,%s)',
                      (result['profile_id'],owner,json.dumps(scores),confirmed,utc_instant(now)))
            self.remember(c,owner,operation,key,digest,result,now)
            return result

    def get_profile(self,owner,pid):
        with self.transaction() as c:
            row=c.execute('SELECT profile_id,owner_id,scores,confirmed,created_at FROM jungsi_backend.profiles WHERE profile_id=%s AND owner_id=%s',(pid,owner)).fetchone()
            return None if row is None else dict(profile_id=row[0],owner_id=row[1],scores=row[2],confirmed=row[3],created_at=utc_text(row[4]))

    @staticmethod
    def report_row(row):
        return None if row is None else dict(report_id=row[0],owner_id=row[1],profile_id=row[2],revision=row[3],body=row[4],updated_at=utc_text(row[5]))

    def get_report(self,owner,rid):
        with self.transaction() as c:
            row=c.execute('SELECT r.report_id,r.owner_id,v.profile_id,r.revision,v.body,v.created_at FROM jungsi_backend.reports r JOIN jungsi_backend.report_revisions v ON (r.report_id,r.revision)=(v.report_id,v.revision) WHERE r.report_id=%s AND r.owner_id=%s',(rid,owner)).fetchone()
            return self.report_row(row)

    def lookup_access(self,rid):
        with self.transaction() as c:
            row=c.execute('SELECT r.owner_id,p.confirmed FROM jungsi_backend.reports r JOIN jungsi_backend.profiles p ON r.profile_id=p.profile_id AND r.owner_id=p.owner_id WHERE r.report_id=%s',(rid,)).fetchone()
            return None if row is None else ReportAccessRecord(row[0],row[1])

    def write_report(self,owner,rid,pid,body,expected,now,operation,key,digest,*,no_op=False):
        with self.transaction() as c:
            self.lock(c,owner,operation,key)
            replay=self.replay_in(c,owner,operation,key,digest)
            if replay is not None:return replay
            if c.execute('SELECT profile_id FROM jungsi_backend.profiles WHERE profile_id=%s AND owner_id=%s',(pid,owner)).fetchone() is None:
                raise PlatformError('profile_not_found',404)
            if rid is None:
                rid='report-'+uuid4().hex;version=1
                c.execute('INSERT INTO jungsi_backend.reports(report_id,owner_id,profile_id,revision,updated_at) VALUES(%s,%s,%s,%s,%s)',(rid,owner,pid,version,utc_instant(now)))
            else:
                row=c.execute('SELECT revision FROM jungsi_backend.reports WHERE report_id=%s AND owner_id=%s FOR UPDATE',(rid,owner)).fetchone()
                if row is None:raise PlatformError('report_not_found',404)
                if row[0]!=expected:raise PlatformError('revision_conflict',409)
                if no_op:
                    current=c.execute('SELECT r.report_id,r.owner_id,v.profile_id,r.revision,v.body,v.created_at FROM jungsi_backend.reports r JOIN jungsi_backend.report_revisions v ON (r.report_id,r.revision)=(v.report_id,v.revision) WHERE r.report_id=%s AND r.owner_id=%s',(rid,owner)).fetchone()
                    result=self.report_row(current)
                    self.remember(c,owner,operation,key,digest,result,now)
                    return result
                version=row[0]+1
                c.execute('UPDATE jungsi_backend.reports SET revision=%s,profile_id=%s,updated_at=%s WHERE report_id=%s AND owner_id=%s',(version,pid,utc_instant(now),rid,owner))
            result=dict(report_id=rid,owner_id=owner,profile_id=pid,revision=version,body=deepcopy(body),updated_at=utc_text(now))
            c.execute('INSERT INTO jungsi_backend.report_revisions(report_id,owner_id,profile_id,revision,body,created_at) VALUES(%s,%s,%s,%s,%s::jsonb,%s)',(rid,owner,pid,version,json.dumps(body),utc_instant(now)))
            self.remember(c,owner,operation,key,digest,result,now)
            return result

    def active_paid(self,owner,now):
        with self.transaction() as c:
            row=c.execute('SELECT EXISTS(SELECT 1 FROM jungsi_backend.entitlements WHERE owner_id=%s AND active=true AND starts_at<=%s AND expires_at>%s)',(owner,utc_instant(now),utc_instant(now))).fetchone()
            return bool(row[0])

    def active_reports(self):
        with self.transaction() as c:
            rows=c.execute('SELECT r.report_id,r.owner_id,v.profile_id,r.revision,v.body,v.created_at FROM jungsi_backend.reports r JOIN jungsi_backend.report_revisions v ON (r.report_id,r.revision)=(v.report_id,v.revision)').fetchall()
            return [self.report_row(row) for row in rows]

    def probe(self):
        """Read-only timezone and synthetic instant/date round-trip; no table writes."""
        instant=datetime(2026,12,31,15,0,0,123456,tzinfo=UTC);day=date(2027,1,1)
        with self.transaction(include_baseline=True,read_only=True) as (c,baseline):
            zone=c.execute('SHOW TIMEZONE').fetchone()[0]
            returned=c.execute('SELECT %s::timestamptz,%s::date',(instant,day)).fetchone()
            tables=('profiles','reports','report_revisions','requests','entitlements','audit_events','artifact_releases','schema_versions')
            found=c.execute('SELECT '+','.join("to_regclass('jungsi_backend."+name+"')" for name in tables)).fetchone()
            schema=bool(found and len(found)==len(tables) and all(found))
            migration=bool(c.execute("SELECT EXISTS(SELECT 1 FROM jungsi_backend.schema_versions WHERE version='001_pre_data_platform')").fetchone()[0]) if schema else False
            actual={(row[0],row[1]):row[2] for row in c.execute('SELECT table_name,column_name,udt_name FROM information_schema.columns WHERE table_schema=%s',('jungsi_backend',)).fetchall()} if schema else {}
            mismatches={'.'.join(key):actual.get(key,'missing') for key,expected in EXPECTED_COLUMN_TYPES.items() if actual.get(key)!=expected}
            verified=zone.upper()=='UTC' and baseline.upper()=='UTC' and utc_instant(returned[0])==instant and returned[1]==day and schema and migration and not mismatches
            return dict(status='verified' if verified else 'failed',default_timezone=baseline,
                        session_timezone=zone,instant_round_trip=utc_instant(returned[0])==instant,date_round_trip=returned[1]==day,
                        storage_schema='verified' if schema and migration else 'missing_or_unversioned',
                        timestamp_date_types='verified' if not mismatches else 'mismatched',type_mismatches=mismatches)
