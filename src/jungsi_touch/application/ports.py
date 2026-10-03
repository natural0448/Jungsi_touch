"""Repository interfaces owned by the application without concrete DB access."""
from dataclasses import dataclass
from typing import Protocol

@dataclass(frozen=True)
class ReportAccessRecord:
    owner_id: str
    confirmed_score_profile: bool
    def __post_init__(self):
        if not isinstance(self.owner_id, str) or not self.owner_id.strip():
            raise ValueError("A server-owned report owner is required.")
        if type(self.confirmed_score_profile) is not bool:
            raise ValueError("The score confirmation state must be a boolean.")

class ReportAccessRepository(Protocol):
    def lookup_access(self, report_id: str) -> ReportAccessRecord | None:
        """Read trusted ownership and confirmation state; None if absent."""
        ...
