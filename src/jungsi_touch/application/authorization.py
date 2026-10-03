"""Policy for a verified server actor, not HTTP/session authentication.
Never construct Actor from client paid/identity fields. The HTTP adapter must
resolve a verified session and active entitlement first. No result DTO is built.
"""
from dataclasses import dataclass
import json
from pathlib import Path
from .ports import ReportAccessRecord, ReportAccessRepository

@dataclass(frozen=True)
class Actor:
    subject_id: str | None
    paid_active: bool = False
    def __post_init__(self):
        if self.subject_id is not None and (not isinstance(self.subject_id, str) or not self.subject_id.strip()):
            raise ValueError("Verified subject must be a non-empty string.")
        if type(self.paid_active) is not bool:
            raise ValueError("Verified entitlement must be a boolean.")
        if self.subject_id is None and self.paid_active:
            raise ValueError("An unauthenticated actor cannot be paid.")

@dataclass(frozen=True)
class AccessDecision:
    allowed: bool
    status: str
    http_status: int

class AccessController:
    def __init__(self, reports: ReportAccessRepository):
        catalog=json.loads(Path(__file__).with_name("route_catalog.json").read_text(encoding="utf-8"))
        self._operations={row["id"]:row for row in catalog["operations"]}
        self._pages={row["id"]:row for row in catalog["pages"]}
        self._reports=reports

    @staticmethod
    def _membership(actor: Actor, allowed_tiers: list[str]) -> AccessDecision:
        if not isinstance(actor, Actor):
            return AccessDecision(False,"invalid_server_context",401)
        if actor.subject_id is None:
            return AccessDecision(False,"authentication_required",401)
        tier="paid" if actor.paid_active else "standard"
        if tier not in allowed_tiers:
            return AccessDecision(False,"paid_required",403)
        return AccessDecision(True,"allowed",200)

    def page_access(self, page_id: str, actor: Actor) -> AccessDecision:
        page=self._pages.get(page_id)
        if page is None:
            return AccessDecision(False,"route_not_found",404)
        return self._membership(actor,page["member_tiers"])

    def operation_access(self, operation_id: str, actor: Actor, *, report_id: str | None=None) -> AccessDecision:
        operation=self._operations.get(operation_id)
        if operation is None:
            return AccessDecision(False,"route_not_found",404)
        decision=self._membership(actor,operation["member_tiers"])
        if not decision.allowed or not operation["report_owner"]:
            return decision
        if not isinstance(report_id,str) or not report_id.strip():
            return AccessDecision(False,"report_required",400)
        record=self._reports.lookup_access(report_id)
        if record is None:
            return AccessDecision(False,"report_not_found",404)
        if not isinstance(record,ReportAccessRecord):
            return AccessDecision(False,"invalid_repository_result",503)
        if record.owner_id!=actor.subject_id:
            return AccessDecision(False,"report_not_found",404)
        if operation["confirmed_score_profile"] and not record.confirmed_score_profile:
            return AccessDecision(False,"score_confirmation_required",409)
        return decision
