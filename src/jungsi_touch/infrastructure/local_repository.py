"""Ephemeral local verification storage; independent of tests and live DBs."""
from copy import deepcopy
from threading import RLock
from uuid import uuid4
from ..application.ports import ReportAccessRecord
from ..application.platform_ports import PlatformError
from ..application.time_contract import utc_text


class LocalMemoryRepository:
    production_allowed = False

    def __init__(self, entitlements=None):
        self.entitlements = deepcopy(entitlements or {})
        self.profiles = {}
        self.reports = {}
        self.revisions = {}
        self.requests = {}
        self._lock = RLock()

    def active_paid_until(self, owner, now):
        with self._lock:
            row = self.entitlements.get(owner)
            return row['expires_at'] if row and row['active'] is True and row['starts_at'] <= now < row['expires_at'] else None

    def active_paid(self, owner, now):
        return self.active_paid_until(owner, now) is not None

    def get_profile(self, owner, profile_id):
        with self._lock:
            row = self.profiles.get(profile_id)
            return deepcopy(row) if row and row['owner_id'] == owner else None

    def get_report(self, owner, report_id):
        with self._lock:
            row = self.reports.get(report_id)
            return deepcopy(row) if row and row['owner_id'] == owner else None

    def lookup_access(self, report_id):
        with self._lock:
            row = self.reports.get(report_id)
            if row is None:
                return None
            return ReportAccessRecord(row['owner_id'], self.profiles[row['profile_id']]['confirmed'])

    def replay(self, owner, operation, key, digest):
        with self._lock:
            previous = self.requests.get((owner, operation, key))
            if previous is None:
                return None
            if previous[0] != digest:
                raise PlatformError('idempotency_conflict', 409)
            return deepcopy(previous[1])

    def _remember(self, owner, operation, key, digest, row):
        self.requests[(owner, operation, key)] = (digest, deepcopy(row))

    def create_profile(self, owner, scores, confirmed, now, key, digest, operation='score-profile.create'):
        with self._lock:
            replay = self.replay(owner, operation, key, digest)
            if replay is not None:
                return replay
            row = dict(profile_id='profile-' + uuid4().hex, owner_id=owner, scores=deepcopy(scores),
                       confirmed=confirmed, created_at=utc_text(now))
            self.profiles[row['profile_id']] = row
            self._remember(owner, operation, key, digest, row)
            return deepcopy(row)

    def write_report(self, owner, report_id, profile_id, body, expected, now, operation, key, digest, *, no_op=False):
        with self._lock:
            replay = self.replay(owner, operation, key, digest)
            if replay is not None:
                return replay
            if self.get_profile(owner, profile_id) is None:
                raise PlatformError('profile_not_found', 404)
            if report_id:
                previous = self.get_report(owner, report_id)
                if previous is None:
                    raise PlatformError('report_not_found', 404)
                if previous['revision'] != expected:
                    raise PlatformError('revision_conflict', 409)
                if no_op:
                    self._remember(owner, operation, key, digest, previous)
                    return previous
                version = previous['revision'] + 1
            else:
                report_id = 'report-' + uuid4().hex
                version = 1
            row = dict(report_id=report_id, owner_id=owner, profile_id=profile_id, revision=version,
                       body=deepcopy(body), updated_at=utc_text(now))
            self.reports[report_id] = row
            self.revisions[(report_id, version)] = deepcopy(row)
            self._remember(owner, operation, key, digest, row)
            return deepcopy(row)

    def active_reports(self):
        with self._lock:
            return deepcopy(list(self.reports.values()))
