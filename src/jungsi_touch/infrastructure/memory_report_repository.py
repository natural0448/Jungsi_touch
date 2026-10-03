"""Synthetic-test-only adapter; no production data, persistence or DB secrets."""
from collections.abc import Mapping
from jungsi_touch.application.ports import ReportAccessRecord

class SyntheticReportAccessRepository:
    production_allowed=False
    def __init__(self, records: Mapping[str,ReportAccessRecord]):
        if any(not isinstance(record,ReportAccessRecord) for record in records.values()):
            raise ValueError("Synthetic records must satisfy the application port.")
        self._records=dict(records)
    def lookup_access(self, report_id: str) -> ReportAccessRecord | None:
        return self._records.get(report_id)
