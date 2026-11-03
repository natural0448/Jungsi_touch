"""Registration checks for the disabled current-page projection."""
import copy
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import run_edge_tests as runner

class CurrentPageRegistrationTests(unittest.TestCase):
    def setUp(self):
        self.spec = json.loads((ROOT / "docs/current/service_spec.json").read_text(encoding="utf-8"))
        self.contract = self.spec["current_public_supply_contract"]["current_page_projection_verification"]
        self.before = {item["path"]: item["sha256"] for item in self.contract["source_bindings"]}

    def test_current_candidate_is_pinned_and_disabled(self):
        self.assertEqual(runner.current_page_projection_registration(self.spec, self.before), self.contract)

    def test_missing_registration_fails_when_candidate_exists(self):
        spec = copy.deepcopy(self.spec)
        del spec["current_public_supply_contract"]["current_page_projection_verification"]
        with self.assertRaisesRegex(runner.EdgeFailure, "current_page_projection_verification_missing"):
            runner.current_page_projection_registration(spec, self.before)

    def test_changed_hash_count_or_activation_is_rejected(self):
        for mutation in ("hash", "count", "activation", "guide_hash", "guide_count", "scope_issuer", "standalone"):
            spec, before = copy.deepcopy(self.spec), dict(self.before)
            if mutation == "hash": before[self.contract["test_path"]] = "0" * 64
            elif mutation == "count": spec["current_public_supply_contract"]["current_page_projection_verification"]["test_count"] = 1
            elif mutation == "guide_hash": before[self.contract["guide_test_paths"][0]] = "0" * 64
            elif mutation == "guide_count": spec["current_public_supply_contract"]["current_page_projection_verification"]["guide_test_count"] = 1
            elif mutation == "scope_issuer": before["supabase/functions/_shared/jungsi/application/current_guide_scope_issuer.campus.review-only.ts"] = "0" * 64
            elif mutation == "standalone": before["supabase/functions/_shared/jungsi/application/r27_standalone.ts"] = "0" * 64
            else: spec["current_public_supply_contract"]["current_page_projection_verification"]["production_ready"] = True
            with self.assertRaisesRegex(runner.EdgeFailure, "current_page_projection_source_or_test_binding_invalid"):
                runner.current_page_projection_registration(spec, before)


class CurrentPageRouteRegistrationTests(unittest.TestCase):
    def setUp(self):
        self.spec = json.loads((ROOT / "docs/current/service_spec.json").read_text(encoding="utf-8"))
        self.contract = self.spec["current_public_supply_contract"]["current_page_route_verification"]
        self.before = {item["path"]: item["sha256"] for item in self.contract["source_bindings"]}

    def test_disabled_route_is_exactly_bound(self):
        self.assertEqual(runner.current_page_route_registration(self.spec, self.before), self.contract)

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
