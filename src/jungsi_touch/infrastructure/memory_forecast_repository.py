"""Atomic synthetic storage. Explicitly not a production fallback."""
from copy import deepcopy
from threading import RLock
from ..application.platform_ports import PlatformError
from ..application.forecast_ports import publication_ids

class MemoryForecastRepository:
    production_allowed=False
    def __init__(self, authorities=None):
        self.authorities=deepcopy(authorities or {});self.drafts={};self.revisions={};self.releases={};self.requests={};self.lock=RLock()
    def capabilities(self, subject_id):return deepcopy(self.authorities.get(subject_id,dict(edit=False,approve=False,university_ids=[])))
    def get(self,draft_id):return deepcopy(self.drafts.get(draft_id))
    def list(self):return deepcopy(list(self.drafts.values()))
    def published(self,offering_id):
        rows=[r for r in self.releases.values() if r['context']['offering_id']==offering_id]
        return deepcopy(sorted(rows,key=lambda r:(r['published_at'],r['release_id']))[-1]) if rows else None
    def published_many(self,offering_ids):
        selected=publication_ids(offering_ids)
        result=dict.fromkeys(selected);latest={}
        # One in-memory pass; preserve the existing publication timestamp/ID tie
        # order and keep equal-valued releases of different offerings separate.
        for release in self.releases.values():
            offering=release['context']['offering_id']
            if offering not in result:continue
            key=(release['published_at'],release['release_id'])
            if offering not in latest or key>=latest[offering][0]:latest[offering]=(key,release)
        for offering,(_,release) in latest.items():result[offering]=deepcopy(release)
        return result
    def put(self,record):
        self.drafts[record['draft_id']]=deepcopy(record);self.revisions[(record['draft_id'],record['revision'])]=deepcopy(record)
    def publish(self,release):self.releases[release['release_id']]=deepcopy(release)
    def transact(self,subject,operation,key,request_hash,callback):
        with self.lock:
            token=(subject,operation,key);old=self.requests.get(token)
            if old:
                if old[0]!=request_hash:raise PlatformError('idempotency_conflict',409)
                return deepcopy(old[1])
            # Roll back all mutations on failure, matching DB transactional behavior.
            saved=deepcopy((self.drafts,self.revisions,self.releases))
            try:result=callback(self)
            except Exception:
                self.drafts,self.revisions,self.releases=saved;raise
            self.requests[token]=(request_hash,deepcopy(result));return result
