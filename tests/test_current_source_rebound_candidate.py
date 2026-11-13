import copy
import json
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import check_project_consistency as c
import run_edge_tests as edge

BASE = json.loads((Path(__file__).resolve().parents[1] / "docs/current/service_spec.json").read_text(encoding="utf-8"))
BASE.pop(c.CURRENT_SOURCE_REBOUND_FIELD, None)
def with_marker():
    s = copy.deepcopy(BASE)
    s[c.CURRENT_SOURCE_REBOUND_FIELD] = {
        "format": "jungsi.current-source-rebounds/v1",
        "status": "SOURCE_REGISTERED_NOT_EXECUTED",
        "activation_status": "NOT_RUN",
        "native_acceptance": "NOT_VERIFIED_BY_SOURCE_SUITE",
        "operating_writes": 0,
        "families": {
            k: {"historical_sha256": c._REBOUND_HISTORICAL[k],
                "changed_source_bindings": {p: c._REBOUND_PINS[p] for p in c._REBOUND_PATHS[k]}}
            for k in c._REBOUND_PATHS
        },
    }
    s[c.CURRENT_SOURCE_REBOUND_FIELD]["families"].update({
        "whole_population": {
            "historical_sha256": "c3c9eb550c22a2c8fdfa0ad44236e07e5cb4a7db19033b78937845a47403a9ee",
            "changed_source_bindings": {"supabase/functions/_shared/jungsi/infrastructure/native_data_provider.ts": "abbc67d7a86fe0e8269252c384e7dc0ae6659e22c4be74fecb22cdbd43126f2e"}},
        "period_renewal": {
            "historical_sha256": "2dbd67ed543cd12053d873675485ad36b2812091ffa84861a0911dd914781e2e",
            "changed_source_bindings": {"supabase/functions/_shared/jungsi/infrastructure/runtime_budget.ts": "8565612cd404fdfd98ff9c8e3b32f2d0bedc2029fcd2ec51184ccac55f2e1756"}},
        "p1_selection": {
            "historical_sha256": "baae156bbc3786fd45e09730e4c662ee44d99b38c0ce4b8ebc2e44883c325db7",
            "changed_source_bindings": {"supabase/functions/_shared/jungsi/application/api_dispatch.ts": "9bcc0fa7a404dbcf4d1825b7989906a10324f7daa613e30c288896db25fe8901"}},
    })
    return s
def historic(s, name):
    return {
        "member": lambda: s["member_shortlist_contract"]["source_registration"],
        "auth": lambda: s["supabase_deployment_contract"]["live_execution"]["auth_503_cancel_followup_20261112"]["synthetic_suite"],
        "current_page": lambda: s["current_public_supply_contract"]["current_page_route_verification"],
        "read_view": lambda: s["read_view_extension_contract"],
        "req27": lambda: s["score_input_policy_contract"]["extension_runtime_test_bindings"],
    }[name]()
class ReboundTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.s = with_marker()
    def test_valid_does_not_mutate_history_or_operational_state(self):
        s = self.s
        before = {k: json.dumps(historic(s,k),sort_keys=True,ensure_ascii=True) for k in c._REBOUND_PATHS}
        for name in c._REBOUND_PATHS:
            candidate = c.select_current_source_rebound(s,name,historic(s,name))
            self.assertIsNot(candidate,historic(s,name))
            self.assertEqual(before[name],json.dumps(historic(s,name),sort_keys=True,ensure_ascii=True))
        self.assertEqual(s[c.CURRENT_SOURCE_REBOUND_FIELD]["activation_status"],"NOT_RUN")
        self.assertEqual(s[c.CURRENT_SOURCE_REBOUND_FIELD]["operating_writes"],0)
    def test_member_auth_and_current_page_exact_registrations(self):
        s = self.s
        member, errors = c.member_shortlist_registration(s)
        self.assertEqual(errors,[]);self.assertIsNotNone(member)
        auth, errors = c.auth_503_registration(s)
        self.assertEqual(errors,[]);self.assertIsNotNone(auth)
        runtime, errors = c.auth_503_runtime_registration(s)
        self.assertEqual(errors,[]);self.assertIsNotNone(runtime)
        tests,errors = c.current_page_route_test_registration(s)
        self.assertEqual(errors,[]);self.assertEqual(len(tests),2)
        page = c.select_current_source_rebound(s,"current_page",historic(s,"current_page"))
        hashes = {b["path"]: b["sha256"] for b in page["source_bindings"]}
        self.assertEqual(edge.current_page_route_registration(s,hashes)["test_count"],40)
    def test_absent_marker_preserves_old_failing_bindings(self):
        # The newer overlay depends on this marker; a historical fixture omits both.
        historical=copy.deepcopy(BASE)
        historical.pop(c.MEMBER_SCHOOL_OVERLAY_FIELD, None)
        self.assertIs(c.select_current_source_rebound(historical,"auth",historic(historical,"auth")),historic(historical,"auth"))
        self.assertTrue(c.auth_503_registration(historical)[1])
    def test_old_receipt_tamper_and_sha_tamper_rejected(self):
        s=with_marker();hist=historic(s,"auth");hist["test_count"]+=1
        with self.assertRaises(ValueError):c.select_current_source_rebound(s,"auth",hist)
        s=with_marker();s[c.CURRENT_SOURCE_REBOUND_FIELD]["families"]["auth"]["historical_sha256"]="0"*64
        with self.assertRaises(ValueError):c.select_current_source_rebound(s,"auth",historic(s,"auth"))
    def test_wrong_or_extra_changed_source_rejected(self):
        s=with_marker();m=s[c.CURRENT_SOURCE_REBOUND_FIELD]["families"]["auth"]["changed_source_bindings"]
        p=next(iter(m));m[p]="0"*64
        with self.assertRaises(ValueError):c.select_current_source_rebound(s,"auth",historic(s,"auth"))
        s=with_marker();s[c.CURRENT_SOURCE_REBOUND_FIELD]["families"]["auth"]["changed_source_bindings"]["tests/edge/extra.ts"]="0"*64
        with self.assertRaises(ValueError):c.select_current_source_rebound(s,"auth",historic(s,"auth"))
    def test_other_family_forgery_rejected_by_shared_manifest(self):
        s=with_marker()
        s[c.CURRENT_SOURCE_REBOUND_FIELD]["families"]["whole_population"]["historical_sha256"]="0"*64
        with self.assertRaises(ValueError):c.select_current_source_rebound(s,"auth",historic(s,"auth"))
        s=with_marker()
        s[c.CURRENT_SOURCE_REBOUND_FIELD]["families"]["period_renewal"]["changed_source_bindings"]={}
        with self.assertRaises(ValueError):c.select_current_source_rebound(s,"member",historic(s,"member"))

    def test_each_family_rejects_mutated_historical_receipt(self):
        for name in c._REBOUND_PATHS:
            with self.subTest(family=name):
                s=with_marker(); old=historic(s,name); old["synthetic_tamper"]=True
                with self.assertRaises(ValueError): c.select_current_source_rebound(s,name,old)
    def test_each_family_rejects_missing_or_replaced_changed_pin(self):
        for name in c._REBOUND_PATHS:
            for mode in ("missing","replaced"):
                with self.subTest(family=name,mode=mode):
                    s=with_marker(); changes=s[c.CURRENT_SOURCE_REBOUND_FIELD]["families"][name]["changed_source_bindings"]
                    path=next(iter(changes))
                    if mode=="missing": del changes[path]
                    else: changes[path]="0"*64
                    with self.assertRaises(ValueError): c.select_current_source_rebound(s,name,historic(s,name))

    def test_source_index_tamper_or_duplicate_rejected(self):
        s=with_marker();p=next(iter(c._REBOUND_PATHS["auth"]))
        s["edge_harness"]["files"][p]["declarations"]["source_sha256"]="0"*64
        with self.assertRaises(ValueError):c.select_current_source_rebound(s,"auth",historic(s,"auth"))
        s=with_marker();rows=s["workflow"]["documentation_sync"]["code_index"]["edge_sources"]["files"]
        rows.append(next(copy.deepcopy(x) for x in rows if x.get("path")==p))
        with self.assertRaises(ValueError):c.select_current_source_rebound(s,"auth",historic(s,"auth"))
    def test_operating_promotion_or_malformed_envelope_rejected(self):
        for key,value in (("activation_status","ACTIVE"),("operating_writes",1),("status","PASS"),("native_acceptance","PASS")):
            s=with_marker();s[c.CURRENT_SOURCE_REBOUND_FIELD][key]=value
            with self.assertRaises(ValueError):c.select_current_source_rebound(s,"auth",historic(s,"auth"))
        s=with_marker();s[c.CURRENT_SOURCE_REBOUND_FIELD]["families"]["unexpected"]={}
        with self.assertRaises(ValueError):c.select_current_source_rebound(s,"auth",historic(s,"auth"))
    def test_missing_family_keeps_original_and_still_fails(self):
        s=with_marker();del s[c.CURRENT_SOURCE_REBOUND_FIELD]["families"]["member"]
        self.assertTrue(c.member_shortlist_registration(s)[1])
    def test_missing_or_tampered_actual_snapshot_still_rejected(self):
        s=self.s;member=c.select_current_source_rebound(s,"member",historic(s,"member"))
        hashes={b["path"]:b["sha256"] for b in member["verification"]["source_bindings"]}
        self.assertEqual(c.member_shortlist_registration(s,hashes)[1],[])
        hashes[next(iter(c._REBOUND_PATHS["member"]))]="0"*64
        self.assertTrue(c.member_shortlist_registration(s,hashes)[1])
    def test_cascade_resolves_only_with_school_validator_stub(self):
        # Simulation only: this does NOT validate or execute the real school suite.
        from unittest.mock import patch
        s=with_marker()
        with patch.object(c,"school_reference_test_registration",
                          return_value=(set(edge.SCHOOL_REFERENCE_TESTS), [])):
            self.assertEqual(c.validate_read_view_extension(s),[])
            self.assertEqual(c.validate_score_input_policy(s),[])
            view=c.select_current_source_rebound(s,"read_view",historic(s,"read_view"))
            hashes={b["path"]:b["sha256"] for b in view["verification"]["source_bindings"]}
            self.assertEqual(edge.read_view_registration(s,hashes)["test_count"],306)
            s[c.CURRENT_SOURCE_REBOUND_FIELD]["families"]["req27"]["changed_source_bindings"]={}
            self.assertIn("REQ-27 current source rebound invalid",c.validate_score_input_policy(s))

    def test_req27_selects_only_current_runtime_copy(self):
        s=self.s;old=historic(s,"req27");now=c.select_current_source_rebound(s,"req27",old)
        for path in c._REBOUND_PATHS["req27"]:
            expected=c.member_school_effective_sha(s,path,c._REBOUND_PINS[path])
            self.assertNotEqual(old[path],now[path]);self.assertEqual(now[path],expected)

if __name__=="__main__":
    unittest.main(verbosity=2)
