"""Synthetic regression for the optional recovery suite. No network or writable temporary files."""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
import re
import unittest
from pathlib import Path
from unittest.mock import patch
import xml.etree.ElementTree as ET

import check_project_consistency as check
import run_edge_tests as runner


def synthetic_spec():
    """Keep the checked-in planning base and add only invented v5 test metadata."""
    spec = json.loads((check.ROOT / "docs/current/service_spec.json").read_text(encoding="utf-8"))
    # This fixture exercises v5 alone; the combined real extensions remain denied.
    spec["backend_platform_contract"].pop("stage_projection_source_extension", None)
    legacy = spec["backend_platform_contract"]["dto_schemas"]["score_input_status"]
    grant_fields = [
        "format", "grant_id", "incident_key", "ticket_ref", "fault_kind", "exam_id", "stage",
        "entry_version", "recovery_remaining", "correction_granted", "correction_used",
        "correction_request_remaining", "effective_save_remaining", "replayed",
    ]
    spec["backend_platform_contract"]["dto_schemas"]["score_input_status_v5"] = {
        "format": "jungsi.score-input-status/v1",
        "fields": [*legacy["fields"], "recovery_remaining"],
    }
    spec["backend_platform_contract"]["dto_schemas"]["score_input_incident_recovery"] = {
        "format": "jungsi.score-input-incident-recovery-grant/v1",
        "fields": grant_fields,
    }
    hashes = {
        name: hashlib.sha256(("SYNTHETIC:" + name).encode()).hexdigest()
        for name in check.RECOVERY_REQUIRED_BINDINGS
    }
    verification = {
        "format": "jungsi.incident-recovery-source-verification/v1",
        "coverage": "INCIDENT_RECOVERY_V5_SYNTHETIC",
        "test_paths": list(check.RECOVERY_TEST_PATHS),
        "same_file_path": check.RECOVERY_SAMEFILE_PATH,
        "same_file_case_names": list(check.RECOVERY_SAMEFILE_NAMES),
        "standalone_case_names": list(check.RECOVERY_STANDALONE_NAMES),
        "baseline_score_case_names": list(check.RECOVERY_BASELINE_NAMES),
        "baseline_commit": check.RECOVERY_BASELINE_COMMIT,
        "baseline_score_source_sha256": check.RECOVERY_BASELINE_SOURCE_SHA256,
        "baseline_score_declarations_sha256": check.RECOVERY_BASELINE_DECLARATIONS_SHA256,
        "test_count": 50,
        "standalone_test_count": 33,
        "same_file_test_count": 17,
        "baseline_score_test_count": 31,
        "baseline_foundation_count": 656,
        "operating_writes": 0,
        "native_acceptance": "NOT_VERIFIED_BY_SOURCE_SUITE",
        "activation_status": "NOT_RUN",
        "source_bindings": [{"path": name, "sha256": hashes[name]} for name in check.RECOVERY_REQUIRED_BINDINGS],
    }
    spec["backend_platform_contract"]["native_edge_v5_extension"] = {
        "format": "jungsi.native-edge-v5-extension/v1",
        "generation": "member-input-recovery-31",
        "base_operation_count": 30,
        "activation": "NOT_RUN",
        "response_schema_overrides": {"score-input.status.read": "score_input_status_v5"},
        "operations": [{
            "id": "score-input.incident-recovery.grant",
            "method": "POST",
            "path": "/api/v1/management/score-input-recovery-grants",
            "member_tiers": ["paid"],
            "report_owner": False,
            "confirmed_score_profile": False,
            "requirements": ["REQ-24", "REQ-25", "REQ-26", "REQ-27"],
            "contract_ref": "backend_platform_contract.dto_schemas.score_input_incident_recovery",
            "http_contract": {
                "idempotency_key_required": True,
                "response_schema": "score_input_incident_recovery",
                "response": "score_input_incident_recovery",
                "query": [],
                "body": [
                    "subject_id: UUID",
                    "exam_id: string",
                    "stage: provisional|final",
                    "fault_kind: confirmed_server_failure|confirmed_incorrect_rejection",
                    "expected_version: positive safe integer",
                    "incident_id: optional registered alias",
                    "ticket_ref: optional registered alias; incident_id or ticket_ref required",
                ],
            },
            "security_policy": {
                "contract_ref": "security_contract",
                "control_ids": ["SEC-01", "SEC-03", "SEC-04", "SEC-05", "SEC-06", "SEC-07", "SEC-08"],
            },
        }],
        "verification": verification,
    }
    return spec, hashes


def synthetic_xml(names):
    root = ET.Element("testsuites")
    suite = ET.SubElement(root, "testsuite", name="synthetic")
    for name in names:
        ET.SubElement(suite, "testcase", name=name, classname="synthetic.ts")
    return root


def synthetic_partition_source():
    # Exact bodies are invented; the test temporarily substitutes their expected hash.
    old = [f'Deno.test("SYNTHETIC-old-{n}", () => {{}})' for n in range(30)]
    added = [
        "Deno.test(" + json.dumps(name, ensure_ascii=True) + ", () => {})"
        for name in check.RECOVERY_SAMEFILE_NAMES
    ]
    digest = hashlib.sha256(json.dumps(old, ensure_ascii=True, separators=(",", ":")).encode()).hexdigest()
    return "\n".join(old + added).encode(), digest


class IncidentRecoveryHarnessTests(unittest.TestCase):
    def setUp(self):
        self.spec, self.hashes = synthetic_spec()

    def test_registration_requires_exact_scope_and_stable_baseline(self):
        registration, errors = check.recovery_input_registration(self.spec, self.hashes)
        self.assertFalse(errors)
        self.assertEqual(registration["test_count"], 50)
        self.assertEqual(len(registration["source_bindings"]), 34)
        self.assertNotIn("src/jungsi_touch/application/route_catalog.json", check.RECOVERY_REQUIRED_BINDINGS)
        self.assertNotIn("docs/current/service_spec.json", check.RECOVERY_REQUIRED_BINDINGS)
        self.assertEqual(check.RECOVERY_BASELINE_COMMIT, "848dc97b6657eb36932ba33908b6cdc147c032c4")
        self.assertEqual(check.RECOVERY_BASELINE_SOURCE_SHA256, "cce54568dfbf59a5bc6980060ce16ed822e5b660d214a86a3092f9705763bd7f")
        self.assertEqual(check.RECOVERY_BASELINE_DECLARATIONS_SHA256, "2d2ba4ac6355abd4481a0fce573a1b54a1eaee72b74d7bbdbbe21050e7a4b9ea")

    def test_route_security_and_dto_mutations_fail(self):
        mutations = [
            lambda s: s["backend_platform_contract"]["native_edge_v5_extension"].update(activation="PASSED"),
            lambda s: s["backend_platform_contract"]["native_edge_v5_extension"]["operations"][0].update(method="GET"),
            lambda s: s["backend_platform_contract"]["native_edge_v5_extension"]["operations"][0]["member_tiers"].append("standard"),
            lambda s: s["backend_platform_contract"]["native_edge_v5_extension"]["operations"][0]["security_policy"]["control_ids"].pop(),
            lambda s: s["backend_platform_contract"]["native_edge_v5_extension"]["response_schema_overrides"].update({"score-input.status.read": "wrong"}),
            lambda s: s["backend_platform_contract"]["dto_schemas"]["score_input_status_v5"]["fields"].pop(),
            lambda s: s["operations"].append({"id": "score-input.incident-recovery.grant"}),
        ]
        for mutate in mutations:
            changed = deepcopy(self.spec)
            mutate(changed)
            self.assertTrue(check.recovery_input_registration(changed, self.hashes)[1])

    def test_count_names_and_source_binding_mutations_fail(self):
        mutations = [
            lambda v: v.update(test_count=49),
            lambda v: v.update(baseline_score_source_sha256="0" * 64),
            lambda v: v["same_file_case_names"].append(v["same_file_case_names"][0]),
            lambda v: v["standalone_case_names"].pop(),
            lambda v: v["source_bindings"][0].update(sha256="0" * 64),
            lambda v: v["source_bindings"].pop(),
            lambda v: v.update(activation_status="PASSED"),
        ]
        for mutate in mutations:
            changed = deepcopy(self.spec)
            mutate(changed["backend_platform_contract"]["native_edge_v5_extension"]["verification"])
            self.assertTrue(check.recovery_input_registration(changed, self.hashes)[1])

    def test_foundation_scope_cannot_add_tests_or_change_count(self):
        for mutate in [
            lambda s: s["edge_harness"]["tests"].append(check.RECOVERY_TEST_PATHS[0]),
            lambda s: s["edge_harness"].update(unit_count=673),
        ]:
            changed = deepcopy(self.spec)
            mutate(changed)
            self.assertTrue(check.recovery_input_registration(changed, self.hashes)[1])

        # The old native receipt is immutable; the v5 source has no native acceptance yet.
        candidate = deepcopy(self.spec)
        c = candidate["score_input_policy_contract"]
        evidence = c["native_SQL_preparation_evidence"]
        old = evidence["guard"]
        path = check.NATIVE_GUARD_SOURCE_PATH
        self.assertEqual(old["source_path"], path)
        digest = hashlib.sha256(json.dumps(old, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        self.assertEqual(digest, check.NATIVE_GUARD_HISTORY_SHA256)
        current = hashlib.sha256(b"SYNTHETIC-v5-current-native-source").hexdigest()
        c["current_source_bindings"][path] = current
        candidate["edge_harness"]["files"][path]["declarations"]["source_sha256"] = current
        rows = candidate["backend_platform_contract"]["native_edge_v5_extension"]["verification"]["source_bindings"]
        next(row for row in rows if row["path"] == path)["sha256"] = current
        evidence["guard_current_source"] = {
            "format": "jungsi.score-input-native-guard-continuation/v1",
            "historical_guard_sha256": check.NATIVE_GUARD_HISTORY_SHA256,
            "historical_source_commit": check.RECOVERY_BASELINE_COMMIT,
            "source_path": path,
            "source_sha256": current,
            "native_API_empty_guard": "NOT_RUN",
            "authenticated_API_verified": False,
            "rollout_approved": False,
            "writes": 0,
        }
        self.assertFalse(check.validate_score_input_native_guard(candidate))
        for mutate in [
            lambda s: s["score_input_policy_contract"]["native_SQL_preparation_evidence"]["guard"].update(receipt_bytes=0),
            lambda s: s["score_input_policy_contract"]["native_SQL_preparation_evidence"].pop("guard_current_source"),
            lambda s: s["score_input_policy_contract"]["native_SQL_preparation_evidence"]["guard_current_source"].update(source_sha256="0" * 64),
            lambda s: s["score_input_policy_contract"]["native_SQL_preparation_evidence"]["guard_current_source"].update(native_API_empty_guard="PASS"),
            lambda s: s["score_input_policy_contract"]["native_SQL_preparation_evidence"]["guard_current_source"].update(authenticated_API_verified=True),
            lambda s: s["score_input_policy_contract"]["native_SQL_preparation_evidence"]["guard_current_source"].update(writes=False),
            lambda s: s["score_input_policy_contract"]["native_SQL_preparation_evidence"]["guard_current_source"].update(historical_source_commit="0" * 40),
            lambda s: s["backend_platform_contract"]["native_edge_v5_extension"]["operations"][0].update(method="GET"),
            lambda s: s["edge_harness"]["files"][path]["declarations"].update(source_sha256="0" * 64),
            lambda s: next(row for row in s["backend_platform_contract"]["native_edge_v5_extension"]["verification"]["source_bindings"] if row["path"] == path).update(sha256="0" * 64),
        ]:
            changed = deepcopy(candidate)
            mutate(changed)
            self.assertTrue(check.validate_score_input_native_guard(changed))

        legacy = deepcopy(self.spec)
        legacy["backend_platform_contract"].pop("native_edge_v5_extension")
        legacy_c = legacy["score_input_policy_contract"]
        legacy_c["current_source_bindings"][path] = legacy_c["native_SQL_preparation_evidence"]["guard"]["source_sha256"]
        legacy_c["native_SQL_preparation_evidence"].pop("guard_current_source", None)
        self.assertFalse(check.validate_score_input_native_guard(legacy))
        legacy_c["current_source_bindings"][path] = current
        self.assertTrue(check.validate_score_input_native_guard(legacy))

    def test_partition_accepts_only_the_original_declarations_plus_additions(self):
        raw, digest = synthetic_partition_source()
        with patch.object(check, "RECOVERY_BASELINE_DECLARATIONS_SHA256", digest):
            check.verify_recovery_test_partition(raw)

    def test_partition_rejects_changed_baseline_unknown_or_duplicate(self):
        raw, digest = synthetic_partition_source()
        text = raw.decode()
        samples = [
            text.replace("SYNTHETIC-old-0", "SYNTHETIC-changed", 1),
            text.replace(check.RECOVERY_SAMEFILE_NAMES[0], "SYNTHETIC-unknown", 1),
            text.replace(check.RECOVERY_SAMEFILE_NAMES[0], check.RECOVERY_SAMEFILE_NAMES[1], 1),
            text + '\nDeno.test("SYNTHETIC-unregistered",()=>{});',
        ]
        with patch.object(check, "RECOVERY_BASELINE_DECLARATIONS_SHA256", digest):
            for sample in samples:
                with self.assertRaises(ValueError):
                    check.verify_recovery_test_partition(sample.encode())

    def test_junit_exact_names_duplicates_failure_and_skip_fail_closed(self):
        expected = list(check.RECOVERY_SAMEFILE_NAMES)
        for names in [expected[:-1], expected + [expected[0]], expected[:-1] + ["SYNTHETIC-unknown"]]:
            with patch.object(Path, "read_bytes", return_value=ET.tostring(synthetic_xml(names))):
                with self.assertRaises(runner.EdgeFailure):
                    runner.require_exact_junit_names("synthetic.xml", expected)
        for tag in ("failure", "error", "skipped"):
            xml = synthetic_xml(expected)
            next(xml.iter("testcase")).append(ET.Element(tag))
            with patch.object(Path, "is_file", return_value=True), patch.object(Path, "read_bytes", return_value=ET.tostring(xml)):
                with self.assertRaises(runner.EdgeFailure):
                    runner.parse_junit("synthetic.xml", 17)

    def test_filtered_junit_accepts_only_the_exact_unselected_complement(self):
        selected = list(check.RECOVERY_BASELINE_NAMES)
        excluded = list(check.RECOVERY_SAMEFILE_NAMES)

        def partition():
            root = ET.Element("testsuites")
            suite = ET.SubElement(root, "testsuite", name="synthetic")
            for name in selected:
                ET.SubElement(suite, "testcase", name=name, classname=check.RECOVERY_SAMEFILE_PATH, time="0.001")
            for name in excluded:
                ET.SubElement(ET.SubElement(suite, "testcase", name=name, classname=check.RECOVERY_SAMEFILE_PATH), "skipped")
            return root

        with patch.object(Path, "is_file", return_value=True), patch.object(Path, "read_bytes", return_value=ET.tostring(partition())):
            self.assertEqual(runner.parse_recovery_partition_junit("synthetic.xml", selected, excluded, check.RECOVERY_SAMEFILE_PATH)["tests_run"], 31)
        mutations = [
            lambda x: next(x.iter("testcase")).append(ET.Element("skipped")),
            lambda x: next(x.iter("testcase")).attrib.pop("time"),
            lambda x: next(x.iter("testcase")).set("classname", "wrong.ts"),
            lambda x: next(x.iter("testcase")).set("name", excluded[0]),
            lambda x: next(c for c in x.iter("testcase") if c.get("name") == excluded[0]).remove(
                next(iter(next(c for c in x.iter("testcase") if c.get("name") == excluded[0])))),
        ]
        for mutate in mutations:
            changed = partition()
            mutate(changed)
            with patch.object(Path, "is_file", return_value=True), patch.object(Path, "read_bytes", return_value=ET.tostring(changed)):
                with self.assertRaises(runner.EdgeFailure):
                    runner.parse_recovery_partition_junit("synthetic.xml", selected, excluded, check.RECOVERY_SAMEFILE_PATH)

    def test_suite_identities_and_foundation_leak_are_rejected(self):
        old = synthetic_xml(check.RECOVERY_BASELINE_NAMES)
        with patch.object(Path, "read_bytes", return_value=ET.tostring(old)):
            runner.require_no_recovery_cases("synthetic.xml", check.RECOVERY_SAMEFILE_NAMES)
            with self.assertRaises(runner.EdgeFailure):
                runner.require_disjoint_junit_identities("a.xml", "b.xml")
        leak = synthetic_xml([*check.RECOVERY_BASELINE_NAMES, check.RECOVERY_SAMEFILE_NAMES[0]])
        with patch.object(Path, "read_bytes", return_value=ET.tostring(leak)):
            with self.assertRaises(runner.EdgeFailure):
                runner.require_no_recovery_cases("synthetic.xml", check.RECOVERY_SAMEFILE_NAMES)

    def test_positive_filters_partition_exact_known_cases(self):
        added = re.compile(runner.recovery_test_filter(check.RECOVERY_SAMEFILE_NAMES)[1:-1])
        baseline = re.compile(runner.recovery_test_filter(check.RECOVERY_BASELINE_NAMES)[1:-1])
        self.assertTrue(all(added.fullmatch(n) and not baseline.fullmatch(n) for n in check.RECOVERY_SAMEFILE_NAMES))
        self.assertTrue(all(baseline.fullmatch(n) and not added.fullmatch(n) for n in check.RECOVERY_BASELINE_NAMES))
        self.assertTrue(all(not added.fullmatch(n) and not baseline.fullmatch(n) for n in check.RECOVERY_STANDALONE_NAMES))
        self.assertNotIn("(?", added.pattern.replace("(?:", ""))
        self.assertNotIn("(?", baseline.pattern.replace("(?:", ""))

    def test_owner_v3_history_is_unchanged_and_v4_has_separate_evidence(self):
        spec = deepcopy(self.spec)
        owner = spec["owner_current_review_contract"]
        old = owner["verification"]
        before_old = {b["path"]: b["sha256"] for b in old["source_bindings"]}
        self.assertEqual(runner.owner_review_registration(spec, before_old)["test_count"], 36)
        before_v4 = {
            path: hashlib.sha256(("SYNTHETIC-v4:" + path).encode()).hexdigest()
            for path in before_old
        }
        owner["verification_v4"] = {
            "format": "jungsi.owner-current-review-v4-synthetic-verification/v1",
            "test_path": old["test_path"],
            "test_count": 43,
            "case_names": list(runner.OWNER_V4_CASE_NAMES),
            "historical_v3_verification_sha256": runner.OWNER_V3_HISTORY_SHA256,
            "activation_status": "NOT_RUN",
            "operating_writes": 0,
            "source_bindings": [{"path": path, "sha256": before_v4[path]} for path in before_old],
        }
        self.assertEqual(runner.owner_review_registration(spec, before_v4)["test_count"], 43)
        for mutate in [
            lambda s: s["owner_current_review_contract"]["verification"]["source_bindings"][0].update(sha256="0" * 64),
            lambda s: s["owner_current_review_contract"]["verification_v4"].update(test_count=36),
            lambda s: s["owner_current_review_contract"]["verification_v4"]["case_names"].pop(),
            lambda s: s["owner_current_review_contract"]["verification_v4"]["source_bindings"][0].update(sha256="0" * 64),
        ]:
            changed = deepcopy(spec)
            mutate(changed)
            with self.assertRaises(runner.EdgeFailure):
                runner.owner_review_registration(changed, before_v4)


if __name__ == "__main__":
    unittest.main()