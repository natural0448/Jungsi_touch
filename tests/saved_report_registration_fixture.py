"""Current source inputs for tests of the saved-report runner registrations."""
from pathlib import Path

from audit_documentation_sync import source_digest
from check_edge_contract import safe_path
from check_project_consistency import SAVED_REPORT_OVERLAY_FIELD, SAVED_REPORT_OVERLAY_PATHS

ROOT = Path(__file__).resolve().parents[1]


def current_source_hashes(spec, receipt, *extra_paths):
    # Read the source independently of the expected hashes in the receipt.
    # Normalize checkout line endings for these Python registration tests; the
    # retained runner separately verifies its manifest against the raw Git bytes.
    paths = {row["path"] for row in receipt["source_bindings"]} | set(extra_paths)
    if SAVED_REPORT_OVERLAY_FIELD in spec:
        paths.update(SAVED_REPORT_OVERLAY_PATHS)
    return {path: source_digest((ROOT / safe_path(path)).read_bytes()) for path in paths}
