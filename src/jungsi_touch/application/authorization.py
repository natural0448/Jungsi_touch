"""Policy for a verified server actor, not HTTP/session authentication.
Never construct Actor from client paid/identity fields. The HTTP adapter must
resolve a verified session and active entitlement first. No result DTO is built.
"""
from dataclasses import dataclass
from datetime import datetime
import json
from pathlib import Path
from .ports import ReportAccessRecord, ReportAccessRepository

@dataclass(frozen=True)
class Actor:
    subject_id: str | None
    paid_active: bool = False
    assurance_level: str | None = None
    account_status: str | None = None
    entitlement_expires_at: datetime | None = None
    account_role: str | None = None
    admin_access_origin: str | None = None
    session_expires_at: datetime | None = None
    def __post_init__(self):
        if self.subject_id is not None and (not isinstance(self.subject_id, str) or not self.subject_id.strip()):
            raise ValueError("Verified subject must be a non-empty string.")
        if type(self.paid_active) is not bool:
            raise ValueError("Verified entitlement must be a boolean.")
        if self.subject_id is None and self.paid_active:
            raise ValueError("An unauthenticated actor cannot be paid.")
        if self.assurance_level is not None and self.assurance_level not in ('aal1','aal2'):
            raise ValueError("Verified assurance must be aal1, aal2 or absent.")
        if self.subject_id is None and self.assurance_level is not None:
            raise ValueError("An unauthenticated actor cannot have verified assurance.")
        if self.account_status is not None and (type(self.account_status) is not str or not self.account_status.strip()):
            raise ValueError("Verified account status must be a nonempty string or unknown.")
        if self.subject_id is None and self.account_status is not None:
            raise ValueError("An unauthenticated actor cannot have a verified account status.")
        if self.entitlement_expires_at is not None and (not self.paid_active or
                not isinstance(self.entitlement_expires_at,datetime) or self.entitlement_expires_at.utcoffset() is None):
            raise ValueError("A request entitlement expiry must belong to a paid verified actor.")
        if self.account_role is not None and (type(self.account_role) is not str
                or not self.account_role.strip() or len(self.account_role)>64):
            raise ValueError("Verified account role must be a nonempty string or unknown.")
        if self.session_expires_at is not None and (self.subject_id is None
                or not isinstance(self.session_expires_at,datetime) or self.session_expires_at.utcoffset() is None):
            raise ValueError("A verified session expiry must be an aware server instant.")
        if self.admin_access_origin is not None and (self.admin_access_origin!='verified_own_profile_active_admin_aal2'
                or not self.paid_active or self.account_role!='admin' or self.account_status!='active'
                or self.assurance_level!='aal2' or self.session_expires_at is None):
            raise ValueError("Administrator access requires the verified active own-profile aal2 origin.")

@dataclass(frozen=True)
class AccessDecision:
    allowed: bool
    status: str
    http_status: int

class AccessController:
    def __init__(self, reports: ReportAccessRepository, *, operating_mode="rights"):
        catalog=json.loads(Path(__file__).with_name("route_catalog.json").read_text(encoding="utf-8"))
        self._operations={row["id"]:row for row in catalog["operations"]}
        if operating_mode not in ("rights","legacy_synthetic"):raise ValueError("Unknown operating mode")
        if operating_mode=="legacy_synthetic":
            for operation in ("score-profile.create","overall.analyze"):
                self._operations[operation]["member_tiers"]=["standard","paid"]
            self._operations["report.export"]["member_tiers"]=["paid"]
            self._operations["report.export"]["confirmed_score_profile"]=True
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
