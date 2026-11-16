
import copy
import hashlib
import json
import os
import sys
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
PLANNING=Path(os.environ.get("JUNGSI_OVERLAY_TEST_ROOT", str(ROOT)))
sys.path.insert(0,str(ROOT/"scripts"))
import check_project_consistency as check
import run_edge_tests as runner

def digest(path):
    raw=path.read_bytes().removeprefix(bytes.fromhex("efbbbf")).replace(b"\r\n",b"\n")
    return hashlib.sha256(raw).hexdigest()

def make():
    spec=json.loads((PLANNING/"docs/current/service_spec.json").read_text(encoding="utf-8"))
    # Rebuild the prior index pins before replacing the member-school overlay
    # that the later saved-report overlay is bound to.
    if spec.pop(check.SAVED_REPORT_OVERLAY_FIELD, None) is not None:
        member = spec["member_shortlist_contract"]["source_registration"]["verification"]
        member_pins = {row["path"]: row["sha256"] for row in member["source_bindings"]}
        stage = spec["backend_platform_contract"]["stage_projection_source_extension"]
        stage_pins = {row["path"]: row["sha256"] for row in stage["source_bindings"]}
        rebound = spec[check.CURRENT_SOURCE_REBOUND_FIELD]["families"]["member"]
        previous_pins = {
            check._MB: rebound["changed_source_bindings"][check._MB],
            check._MJSON: member_pins[check._MJSON],
            check._PUBLIC_CATALOG: member_pins[check._PUBLIC_CATALOG],
            check._COMBINED_CATALOG: member_pins[check._COMBINED_CATALOG],
            check._SCORE_INPUT: stage_pins[check._SCORE_INPUT],
            # 2026-11-14 school reflected overlay paths (historical member pins).
            check._ARTIFACTS: {r["path"]: r["sha256"] for r in spec["university_scoring_contract"]
                ["scoped_reference_contract"]["verification_current_source_rebound_20261113_v2"]
                ["source_bindings"]}[check._ARTIFACTS],
            check._PROFILE_REPORTS: member_pins[check._PROFILE_REPORTS],
            check._SCHEMA_FIXTURE: member_pins[check._SCHEMA_FIXTURE],
        }
        # 2026-11-16 reference upper bound overlay paths (historical school pins).
        school_pins = {r["path"]: r["sha256"] for r in spec["university_scoring_contract"]
            ["scoped_reference_contract"]["verification_current_source_rebound_20261113_v2"]["source_bindings"]}
        previous_pins.update({p: school_pins[p] for p in (check._REF_PCT, check._SAVED_TAIL)})
        edge_sources = spec["workflow"]["documentation_sync"]["code_index"]["edge_sources"]
        for row in edge_sources["files"]:
            if row["path"] in previous_pins:
                row["source_sha256"] = previous_pins[row["path"]]
        edge_files = spec["edge_harness"]["files"]
        for path in previous_pins.keys() & edge_files.keys():
            edge_files[path]["declarations"]["source_sha256"] = previous_pins[path]
    pins={}
    for path in check.MEMBER_SCHOOL_OVERLAY_PATHS:
        file=(ROOT if path.startswith("scripts/") else PLANNING)/path
        pins[path]=digest(file)
        if path.startswith("scripts/"):
            matches=[v for v in spec["workflow"]["documentation_sync"]["code_index"]["files"] if v["path"]==path]
            assert len(matches)==1
            matches[0]["source_sha256"]=pins[path]
        else:
            spec["edge_harness"]["files"][path]["declarations"]["source_sha256"]=pins[path]
            if path.startswith("supabase/functions/"):
                matches=[v for v in spec["workflow"]["documentation_sync"]["code_index"]["edge_sources"]["files"] if v["path"]==path]
                assert len(matches)==1
                matches[0]["source_sha256"]=pins[path]
    spec[check.MEMBER_SCHOOL_OVERLAY_FIELD]={
        "format":"jungsi.member-school-current-source-overlay/v1",
        "status":"SOURCE_REGISTERED_NOT_EXECUTED",
        "activation_status":"NOT_RUN",
        "native_acceptance":"NOT_VERIFIED_BY_SOURCE_SUITE",
        "operating_writes":0,
        "baseline_sha256":dict(check.MEMBER_SCHOOL_BASELINES),
        "source_bindings":pins,
    }
    return spec,pins

class OverlayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.spec,cls.pins=make()
    def test_previous_receipts_stay_immutable_and_each_family_receives_new_pins(self):
        s=self.spec
        historical={
          "member":s["member_shortlist_contract"]["source_registration"],
          "auth":s["supabase_deployment_contract"]["live_execution"]["auth_503_cancel_followup_20261112"]["synthetic_suite"],
          "current_page":s["current_public_supply_contract"]["current_page_route_verification"],
          "read_view":s["read_view_extension_contract"],
          "req27":s["score_input_policy_contract"]["extension_runtime_test_bindings"],
        }
        old=copy.deepcopy(historical)
        for name,record in historical.items():
            self.assertIsNot(check.select_current_source_rebound(s,name,record),record)
        self.assertEqual(historical,old)
        member=check.select_current_source_rebound(s,"member",historical["member"])
        mb={x["path"]:x["sha256"] for x in member["verification"]["source_bindings"]}
        for p in (check._MC,check._MX,check._MS,check._MF):self.assertEqual(mb[p],self.pins[p])
        dev=s["supabase_deployment_contract"]["live_execution"]["runtime_assembly"]
        out=check.select_aux_current_rebound(s,"dev010_runtime_assembly",dev)
        self.assertEqual(out["bindings"]["composition"]["source_sha256"],self.pins[check._MC])
        seed=s["backend_platform_contract"]["native_seed_candidate_extension"]
        out=check.select_aux_current_rebound(s,"native_seed",seed)
        self.assertEqual({x["path"]:x["sha256"] for x in out["source_bindings"]}[check._MRUN],self.pins[check._MRUN])

    def test_school_cancellation_and_stage_register_current_without_claiming_runtime(self):
        s=self.spec
        school=s["university_scoring_contract"]["scoped_reference_contract"]["verification_current_source_rebound_20261113_v2"]
        before={x["path"]:x["sha256"] for x in school["source_bindings"]}
        before.update({x["path"]:x["sha256"] for x in
          s["backend_platform_contract"]["university_cancellation_test_extension"]["source_bindings"]})
        before.update(self.pins)
        current=runner.school_reference_registration(s,before)
        hashes={x["path"]:x["sha256"] for x in current["source_bindings"]}
        for p in (check._MU,check._MC,check._MX):self.assertEqual(hashes[p],self.pins[p])
        self.assertEqual(current["status"],"SOURCE_REGISTERED_NOT_EXECUTED")
        _,errors=check.school_reference_test_registration(s)
        self.assertEqual(errors,[])
        cancel,errors=check.university_cancellation_test_registration(s,before)
        self.assertEqual(errors,[])
        self.assertEqual(cancel["source_bindings"][0]["sha256"],self.pins[check._MU])
        stage,errors=check.stage_projection_guard_registration(s)
        self.assertEqual(errors,[])
        self.assertEqual({x["path"]:x["sha256"] for x in stage["source_bindings"]}[check._MX],self.pins[check._MX])
        self.assertFalse(stage["authenticated_API_verified"])
        self.assertEqual(stage["native_API_empty_guard"],"NOT_RUN")

    def test_selected_snapshot_hash_and_indices_must_match(self):
        self.assertEqual(check.member_school_overlay(self.spec,self.pins),self.pins)
        bad=dict(self.pins);bad[check._MS]="0"*64
        with self.assertRaises(ValueError):check.member_school_overlay(self.spec,bad)
        bad=copy.deepcopy(self.spec)
        bad["edge_harness"]["files"][check._MS]["declarations"]["source_sha256"]="0"*64
        with self.assertRaises(ValueError):check.member_school_overlay(bad)

    def test_historical_tampering_and_incomplete_paths_fail(self):
        bad=copy.deepcopy(self.spec)
        bad["backend_platform_contract"]["stage_projection_source_extension"]["writes"]=1
        with self.assertRaises(ValueError):check.member_school_overlay(bad)
        bad=copy.deepcopy(self.spec)
        del bad[check.MEMBER_SCHOOL_OVERLAY_FIELD]["source_bindings"][check._MF]
        with self.assertRaises(ValueError):check.member_school_overlay(bad)
        bad=copy.deepcopy(self.spec)
        bad[check.MEMBER_SCHOOL_OVERLAY_FIELD]["status"]="PASSED"
        with self.assertRaises(ValueError):check.member_school_overlay(bad)

    def test_absent_overlay_keeps_existing_behavior_and_unknown_family_rejected(self):
        old=dict(self.spec);old.pop(check.MEMBER_SCHOOL_OVERLAY_FIELD)
        value={"example":"historical"}
        self.assertIs(check.apply_member_school_overlay(old,"member",value),value)
        with self.assertRaises(ValueError):check.apply_member_school_overlay(self.spec,"unexpected",{})

    def test_member_and_auth_registrations_use_updated_bindings(self):
        s=self.spec
        historical=s["member_shortlist_contract"]["source_registration"]
        current=check.select_current_source_rebound(s,"member",historical)
        before={x["path"]:x["sha256"] for x in current["verification"]["source_bindings"]}
        before.update(self.pins)
        registered,errors=check.member_shortlist_registration(s,before)
        self.assertEqual(errors,[])
        self.assertEqual(registered["activation_status"],"NOT_RUN")
        history=s["supabase_deployment_contract"]["live_execution"]["auth_503_cancel_followup_20261112"]["synthetic_suite"]
        current=check.select_current_source_rebound(s,"auth",history)
        auth_before={x["path"]:x["sha256"] for x in current["source_bindings"]}
        auth_before.update(self.pins)
        registered,errors=check.auth_503_registration(s,auth_before)
        self.assertEqual(errors,[])
        self.assertEqual(registered["activation_status"],"NOT_RUN")

    def test_live_operation_history_uses_pinned_old_source_without_claiming_deployment(self):
        s=self.spec
        old=[r["sha256"] for r in s["university_scoring_contract"]["scoped_reference_contract"]
             ["verification_current_source_rebound_20261113_v2"]["source_bindings"]
             if r["path"]==check._MU]
        self.assertEqual(len(old),1)
        self.assertTrue(check.policy_baseline_source_matches(s,check._MU,old[0],self.pins))
        bad=copy.deepcopy(s)
        bad["supabase_deployment_contract"]["live_execution"]["operations"]["candidates.build"]["deployment"]="PASS"
        self.assertFalse(check.policy_baseline_source_matches(bad,check._MU,old[0],self.pins))
        self.assertFalse(check.policy_baseline_source_matches(s,check._MU,"f"*64,self.pins))

if __name__=="__main__":unittest.main(verbosity=2)
