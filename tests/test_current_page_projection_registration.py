"""Registration checks for the disabled current-page projection."""
import copy
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import run_edge_tests as runner
import check_project_consistency as checker
from saved_report_registration_fixture import current_source_hashes

class CurrentPageRegistrationTests(unittest.TestCase):
    def setUp(self):
        self.spec = json.loads((ROOT / "docs/current/service_spec.json").read_text(encoding="utf-8"))
        self.contract = self.spec["current_public_supply_contract"]["current_page_projection_verification"]
        self.before = current_source_hashes(self.spec, self.contract)

    def test_current_candidate_is_pinned_and_disabled(self):
        history = copy.deepcopy(self.contract)
        expected = copy.deepcopy(history)
        overlay = self.spec.get(checker.SAVED_REPORT_OVERLAY_FIELD)
        if overlay is not None:
            pins = overlay["source_bindings"]
            for row in expected["source_bindings"]:
                if row["path"] in checker.SAVED_REPORT_RECEIPT_PATHS["current_page_projection"]:
                    row["sha256"] = pins[row["path"]]
        self.assertEqual(runner.current_page_projection_registration(self.spec, self.before), expected)
        self.assertEqual(self.contract, history)

    def test_missing_registration_fails_when_candidate_exists(self):
        spec = copy.deepcopy(self.spec)
        del spec["current_public_supply_contract"]["current_page_projection_verification"]
        with self.assertRaisesRegex(runner.EdgeFailure, "current_page_projection_verification_missing"):
            runner.current_page_projection_registration(spec, self.before)

    def test_changed_hash_count_or_activation_is_rejected(self):
        historical_error = "saved_report_receipt_source_binding_invalid"
        source_error = "current_page_projection_source_or_test_binding_invalid"
        has_overlay = checker.SAVED_REPORT_OVERLAY_FIELD in self.spec
        for mutation in ("hash", "count", "activation", "guide_hash", "guide_count", "scope_issuer", "standalone"):
            with self.subTest(mutation=mutation):
                spec, before = copy.deepcopy(self.spec), dict(self.before)
                contract = spec["current_public_supply_contract"]["current_page_projection_verification"]
                if mutation == "hash": before[contract["test_path"]] = "0" * 64
                elif mutation == "count": contract["test_count"] = 1
                elif mutation == "guide_hash": before[contract["guide_test_paths"][0]] = "0" * 64
                elif mutation == "guide_count": contract["guide_test_count"] = 1
                elif mutation == "scope_issuer": before["supabase/functions/_shared/jungsi/application/current_guide_scope_issuer.campus.review-only.ts"] = "0" * 64
                elif mutation == "standalone": before["supabase/functions/_shared/jungsi/application/r27_standalone.ts"] = "0" * 64
                else: contract["production_ready"] = True
                # The newer overlay authenticates the untouched receipt before
                # the individual registration can validate its fields.
                error = historical_error if has_overlay and mutation in ("count", "guide_count", "activation") else source_error
                with self.assertRaisesRegex(runner.EdgeFailure, error):
                    runner.current_page_projection_registration(spec, before)


class CurrentPageRouteRegistrationTests(unittest.TestCase):
    def setUp(self):
        self.spec = json.loads((ROOT / "docs/current/service_spec.json").read_text(encoding="utf-8"))
        self.contract = self.spec["current_public_supply_contract"]["current_page_route_verification"]
        self.current = checker.select_current_source_rebound(self.spec, "current_page", self.contract)
        self.before = {item["path"]: item["sha256"] for item in self.current["source_bindings"]}

    def test_disabled_route_is_exactly_bound(self):
        history = copy.deepcopy(self.contract)
        self.assertEqual(runner.current_page_route_registration(self.spec, self.before), self.current)
        self.assertEqual(self.contract, history)

    def test_stale_snapshot_and_forged_history_are_rejected(self):
        if checker.CURRENT_SOURCE_REBOUND_FIELD not in self.spec:
            self.skipTest("current source rebound is absent from this snapshot")
        old = {item["path"]: item["sha256"] for item in self.contract["source_bindings"]}
        with self.assertRaisesRegex(runner.EdgeFailure, "current_page_route_source_or_test_binding_invalid"):
            runner.current_page_route_registration(self.spec, old)
        forged = copy.deepcopy(self.spec)
        forged["current_public_supply_contract"]["current_page_route_verification"]["test_count"] += 1
        with self.assertRaisesRegex(runner.EdgeFailure, "current_page_route_current_source_rebound_invalid"):
            runner.current_page_route_registration(forged, self.before)

    def test_missing_or_modified_scope_fails_closed(self):
        for mutation in ("missing", "source", "schema", "guard", "test_count", "activation"):
            spec, before = copy.deepcopy(self.spec), dict(self.before)
            contract = spec["current_public_supply_contract"]["current_page_route_verification"]
            if mutation == "missing": del spec["current_public_supply_contract"]["current_page_route_verification"]
            elif mutation == "source": before[contract["test_paths"][0]] = "0" * 64
            elif mutation == "schema": before[contract["schema_path"]] = "0" * 64
            elif mutation == "guard": before["supabase/functions/_shared/jungsi/infrastructure/current_page_request_ports.review-only.ts"] = "0" * 64
            elif mutation == "test_count": contract["test_count"] = 1
            else: contract["production_ready"] = True
            with self.assertRaises(runner.EdgeFailure):
                runner.current_page_route_registration(spec, before)
