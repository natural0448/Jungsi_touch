"""Application-owned ports. Authentication, storage and Drive are adapters."""
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol
from ..year_equating import BridgePolicy
from ..university_conversion import ConversionRelease
from ..admission_result_percentile import UniversityScoreDistribution
from .ports import ExamAnalysisProvider


class PlatformError(ValueError):
    def __init__(self, code, status=422):
        self.code, self.http_status = code, status
        super().__init__(code)


@dataclass(frozen=True)
class VerifiedSession:
    subject_id: str
    expires_at: datetime
    assurance_level: str | None = None
    account_status: str | None = None
    account_role: str | None = None


class SessionProvider(Protocol):
    def verify(self, token: str, now: datetime) -> VerifiedSession | None: ...


class EntitlementRepository(Protocol):
    def active_paid(self, subject_id: str, now: datetime) -> bool: ...
    def active_paid_until(self, subject_id: str, now: datetime) -> datetime | None: ...


class PlatformRepository(Protocol):
    def get_profile(self, owner_id, profile_id) -> dict | None: ...
    def create_profile(self, owner_id, scores, confirmed, now, key, digest, operation='score-profile.create') -> dict: ...
    def get_report(self, owner_id, report_id) -> dict | None: ...
    def write_report(self, owner_id, report_id, profile_id, body, expected, now, operation, key, digest, *, no_op=False) -> dict: ...
    def replay(self, owner_id, operation, key, digest) -> dict | None: ...
    def active_reports(self) -> list[dict]: ...
    def lookup_access(self, report_id): ...


@dataclass(frozen=True)
class CatalogRelease:
    version: str
    status: str
    as_of: datetime
    offerings: tuple[dict, ...]
    history: tuple[dict, ...] = ()


@dataclass(frozen=True)
class OfferingAnalysis:
    """Trusted release bindings; absent fields mean pending, never guessed values.

    Each bridges entry contains source/target RankDistribution bundles and totals.
    A decision policy must bind the exact offering, rule, curve and comparison
    population. Its ranges are explicit approved data, not application defaults.
    """
    version: str
    status: str
    source_pack_version: str
    release: ConversionRelease
    offerings_by_year: dict
    bridges: dict
    policy: BridgePolicy
    curves: dict[int, UniversityScoreDistribution]
    decisions: dict


@dataclass(frozen=True)
class UniversityConversionRelease:
    """Independent approved rule supply; no bridge, curve or decision objects.

    Each binding repeats the catalog's university/campus/department/track/group
    identity beside its year/PK/rule version. Exam and pack metadata bind every
    contained rule/table, which may also declare stricter matching metadata.
    """
    version: str
    status: str
    academic_year: int
    exam_id: str
    source_pack_version: str
    exam_type: str
    release: ConversionRelease
    bindings: tuple[dict, ...]
    mock_compatibility: dict | None = None


class PlatformDataProvider(ExamAnalysisProvider, Protocol):
    def get_catalog(self) -> CatalogRelease | None: ...
    def get_analysis(self, offering_id: str) -> OfferingAnalysis | None: ...
    def get_conversion(self, offering_id: str) -> UniversityConversionRelease | None: ...
    def get_percentile(self, offering_id: str) -> 'UniversityPercentileRelease | None': ...


@dataclass(frozen=True)
class UniversityPercentileRelease:
    """Independent approved score distribution and exact offering/exam binding."""
    version: str
    status: str
    release_id: str
    academic_year: int
    exam_id: str
    source_pack_version: str
    exam_type: str
    rule_version: str
    curve: UniversityScoreDistribution
    bindings: tuple[dict, ...]
    comparison_population: dict | None = None
    validation_receipt: dict | None = None


class ArtifactResultWriter(Protocol):
    def append_result(self, owner_id, operation, request_key, content, now) -> dict: ...
