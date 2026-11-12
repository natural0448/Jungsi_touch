import copy, sys, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"scripts"))
from check_project_consistency import auth_503_registration, AUTH_503_TEST_PATH, AUTH_503_SOURCE_PATHS, AUTH_503_CASE_NAMES

class Auth503Registration(unittest.TestCase):
 def setUp(self):
  self.hashes={p:chr(97+i)*64 for i,p in enumerate(AUTH_503_SOURCE_PATHS)}
  self.suite={"format":"jungsi.auth-503-synthetic-suite/v1","status":"SOURCE_REGISTERED_NOT_EXECUTED","baseline_foundation_count":656,"test_paths":[AUTH_503_TEST_PATH],"test_count":27,"case_names_by_path":{AUTH_503_TEST_PATH:list(AUTH_503_CASE_NAMES)},"source_bindings":[{"path":p,"sha256":self.hashes[p]} for p in AUTH_503_SOURCE_PATHS],"native_acceptance":"NOT_VERIFIED_BY_SOURCE_SUITE","activation_status":"NOT_RUN","operating_writes":0}
  self.spec={"edge_harness":{"files":{p:{"layer":"verification" if p==AUTH_503_TEST_PATH else "data_infrastructure","declarations":{"source_sha256":self.hashes[p]}} for p in AUTH_503_SOURCE_PATHS},"tests":[]},"workflow":{"documentation_sync":{"code_index":{"edge_sources":{"files":[]}}}},"supabase_deployment_contract":{"live_execution":{"auth_503_cancel_followup_20261112":{"synthetic_suite":copy.deepcopy(self.suite)}}}}
 def suite_at(self,s):return s["supabase_deployment_contract"]["live_execution"]["auth_503_cancel_followup_20261112"]["synthetic_suite"]
 def rejected(self,s):self.assertTrue(auth_503_registration(s,self.hashes)[1])
 def test_current_exact_synthetic_registration(self):
  self.assertEqual(auth_503_registration(self.spec,self.hashes),(self.suite,[]))
 def test_legacy_without_candidate_is_accepted(self):
  self.assertEqual(auth_503_registration({"edge_harness":{"files":{},"tests":[]},"supabase_deployment_contract":{"live_execution":{}}}),(None,[]))
 def test_candidate_requires_suite_and_test_file(self):
  s=copy.deepcopy(self.spec);s["supabase_deployment_contract"]["live_execution"]["auth_503_cancel_followup_20261112"].pop("synthetic_suite");self.rejected(s)
  s=copy.deepcopy(self.spec);s["edge_harness"]["files"].pop(AUTH_503_TEST_PATH);self.rejected(s)
 def test_followup_without_both_suite_and_test_is_rejected(self):
  s=copy.deepcopy(self.spec)
  s["supabase_deployment_contract"]["live_execution"]["auth_503_cancel_followup_20261112"].pop("synthetic_suite")
  s["edge_harness"]["files"].pop(AUTH_503_TEST_PATH)
  self.rejected(s)
 def test_existing_foundation_remains_disjoint(self):
  s=copy.deepcopy(self.spec);s["edge_harness"]["tests"].append(AUTH_503_TEST_PATH);self.rejected(s)
 def test_count_and_case_identity_cannot_drift(self):
  for kind in ("count","case","duplicate"):
   with self.subTest(kind=kind):
    s=copy.deepcopy(self.spec);q=self.suite_at(s)
    if kind=="count":q["test_count"]=26
    elif kind=="case":q["case_names_by_path"][AUTH_503_TEST_PATH][0]="tampered"
    else:q["case_names_by_path"][AUTH_503_TEST_PATH][1]=q["case_names_by_path"][AUTH_503_TEST_PATH][0]
    self.rejected(s)
 def test_binding_shape_scope_and_hash_cannot_drift(self):
  for kind in ("missing","wrong_path","wrong_hash","extra"):
   with self.subTest(kind=kind):
    s=copy.deepcopy(self.spec);rows=self.suite_at(s)["source_bindings"]
    if kind=="missing":rows.pop()
    elif kind=="wrong_path":rows[0]["path"]="other.ts"
    elif kind=="wrong_hash":rows[0]["sha256"]="0"*64
    else:rows[0]["extra"]="not permitted"
    self.rejected(s)
 def test_same_snapshot_hash_is_required(self):
  wrong=dict(self.hashes);wrong[AUTH_503_SOURCE_PATHS[0]]="0"*64
  self.assertTrue(auth_503_registration(self.spec,wrong)[1])
 def test_no_false_production_or_activation_claim(self):
  for key,value in (("status","PASS"),("native_acceptance","PASS"),("activation_status","PASS"),("operating_writes",1)):
   with self.subTest(key=key):
    s=copy.deepcopy(self.spec);self.suite_at(s)[key]=value;self.rejected(s)

if __name__=="__main__":unittest.main()
