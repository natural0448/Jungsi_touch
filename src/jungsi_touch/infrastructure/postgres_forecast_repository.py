"""Forecast PostgreSQL transactions, immutable revisions and exact request replay."""
from copy import deepcopy
import json
from ..application.platform_ports import PlatformError
from ..application.time_contract import utc_instant

class ForecastTransaction:
    def __init__(self,connection):self.c=connection
    def get(self,draft_id):
        row=self.c.execute('SELECT body FROM jungsi_backend.forecast_drafts WHERE draft_id=%s FOR UPDATE',(draft_id,)).fetchone()
        return deepcopy(row[0]) if row else None
    def capabilities(self,subject):
        rows=self.c.execute('SELECT university_id,can_edit,can_approve FROM jungsi_backend.forecast_authorities WHERE subject_id=%s',(subject,)).fetchall()
        return dict(edit=any(r[1] for r in rows),approve=any(r[2] for r in rows),university_ids=[r[0] for r in rows],edit_university_ids=[r[0] for r in rows if r[1]],approve_university_ids=[r[0] for r in rows if r[2]])
    def put(self,record):
        old=self.c.execute('SELECT revision FROM jungsi_backend.forecast_drafts WHERE draft_id=%s FOR UPDATE',(record['draft_id'],)).fetchone()
        if old:
            if old[0]+1!=record['revision']:raise PlatformError('revision_conflict',409)
            self.c.execute('UPDATE jungsi_backend.forecast_drafts SET revision=%s,body=%s::jsonb,updated_at=%s WHERE draft_id=%s AND revision=%s',(record['revision'],json.dumps(record),utc_instant(record['updated_at']),record['draft_id'],old[0]))
        else:self.c.execute('INSERT INTO jungsi_backend.forecast_drafts(draft_id,revision,body,updated_at) VALUES(%s,%s,%s::jsonb,%s)',(record['draft_id'],record['revision'],json.dumps(record),utc_instant(record['updated_at'])))
        self.c.execute('INSERT INTO jungsi_backend.forecast_revisions(draft_id,revision,body,created_at) VALUES(%s,%s,%s::jsonb,%s)',(record['draft_id'],record['revision'],json.dumps(record),utc_instant(record['updated_at'])))
    def publish(self,release):
        self.c.execute('INSERT INTO jungsi_backend.forecast_releases(release_id,offering_id,body,published_at) VALUES(%s,%s,%s::jsonb,%s)',(release['release_id'],release['context']['offering_id'],json.dumps(release),utc_instant(release['published_at'])))

class PostgresForecastRepository:
    def __init__(self,repository):self.repository=repository
    def capabilities(self,subject):
        with self.repository.transaction() as c:return ForecastTransaction(c).capabilities(subject)
    def get(self,draft_id):
        with self.repository.transaction(read_only=True) as c:
            row=c.execute('SELECT body FROM jungsi_backend.forecast_drafts WHERE draft_id=%s',(draft_id,)).fetchone()
            return deepcopy(row[0]) if row else None
    def list(self):
        with self.repository.transaction(read_only=True) as c:return [deepcopy(r[0]) for r in c.execute('SELECT body FROM jungsi_backend.forecast_drafts').fetchall()]
    def published(self,offering_id):
        with self.repository.transaction(read_only=True) as c:
            row=c.execute('SELECT body FROM jungsi_backend.forecast_releases WHERE offering_id=%s ORDER BY published_at DESC,release_id DESC LIMIT 1',(offering_id,)).fetchone()
            return deepcopy(row[0]) if row else None
    def transact(self,subject,operation,key,request_hash,callback):
        with self.repository.transaction() as c:
            self.repository.lock(c,subject,operation,key)
            row=c.execute('SELECT request_hash,result FROM jungsi_backend.forecast_requests WHERE subject_id=%s AND operation=%s AND request_key=%s',(subject,operation,key)).fetchone()
            if row:
                if row[0]!=request_hash:raise PlatformError('idempotency_conflict',409)
                return deepcopy(row[1])
            result=callback(ForecastTransaction(c))
            c.execute('INSERT INTO jungsi_backend.forecast_requests(subject_id,operation,request_key,request_hash,result) VALUES(%s,%s,%s,%s,%s::jsonb)',(subject,operation,key,request_hash,json.dumps(result)))
            return result
