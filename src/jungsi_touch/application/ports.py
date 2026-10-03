"""Repository interfaces owned by the application without concrete DB access."""
from dataclasses import dataclass
from typing import Protocol
from ..exam_pack import ExamPack, ExamTotalModel

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


@dataclass(frozen=True)
class TotalModelBinding:
    """Server-selected distribution version and its exam-bound model.

    The adopted distribution ID comes from trusted release configuration,
    never from the student request. None at the provider means not published.
    """
    model: ExamTotalModel
    distribution_id: str


class ExamAnalysisProvider(Protocol):
    """Supply server-owned, validated data; never resolve a client file path."""

    def get_exam_pack(self, exam_id: str) -> ExamPack | None:
        """Return the validated pack for a registered exam, or None."""
        ...

    def get_total_model(self, exam_id: str, pack_version: str) -> TotalModelBinding | None:
        """Return the adopted model binding, or None when not published."""
        ...
