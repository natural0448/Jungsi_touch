"""Reference DB suite must remain additive, source-bound and fail closed."""
import copy,json,sys,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/"scripts"))
import check_project_consistency as checker

def loaded():return json.loads((ROOT/"docs/current/service_spec.json").read_bytes())
class ReferenceDbRegistrationTests(unittest.TestCase):
 def test_exact_additive_suite(self):
  s=loaded();suite,errors=checker.reference_db_registration(s)
  self.assertEqual(errors,[]);self.assertEqual(suite["test_count"],199);self.assertEqual(s["edge_harness"]["unit_count"],656)
 def test_missing_registration_is_rejected(self):
  s=loaded();del s["backend_platform_contract"]["reference_db_test_extension"]
  self.assertTrue(checker.reference_db_registration(s)[1]);self.assertTrue(checker.validate_read_view_extension(s))
 def test_changed_identity_count_status_or_source_is_rejected(self):
  for mutation in ("case","count","status","source","guard"):
   with self.subTest(mutation=mutation):
    s=loaded();e=s["backend_platform_contract"]["reference_db_test_extension"]
    if mutation=="case":e["case_names_by_path"][e["test_paths"][0]][0]+=" modified"
    elif mutation=="count":e["test_count"]=192
    elif mutation=="status":e["activation_status"]="PASS"
    elif mutation=="source":e["source_bindings"][0]["sha256"]="0"*64
    else:e["regression_test"]["path"]="tests/other.py"
    self.assertTrue(checker.reference_db_registration(s)[1])
 def test_snapshot_hashes_are_bound(self):
  s=loaded();e=s["backend_platform_contract"]["reference_db_test_extension"]
  h={x["path"]:x["sha256"] for x in e["source_bindings"]};h[e["regression_test"]["path"]]=e["regression_test"]["sha256"]
  self.assertEqual(checker.reference_db_registration(s,h)[1],[])
  h[e["test_paths"][0]]="0"*64;self.assertTrue(checker.reference_db_registration(s,h)[1])
 def test_existing_entrypoint_receipt_is_pinned_to_exact_previous_and_candidate_sources(self):
  s=loaded();h=s["workflow"]["development_harness"]["reference_db_entrypoint_history_20261110"]
  idx={h["path"]:h["candidate_source_sha256"]}
  self.assertTrue(checker.policy_baseline_source_matches(s,h["path"],h["previous_source_sha256"],idx))
  self.assertFalse(checker.policy_baseline_source_matches(s,h["path"],"0"*64,idx))
  h["candidate_source_sha256"]="0"*64
  self.assertFalse(checker.policy_baseline_source_matches(s,h["path"],h["previous_source_sha256"],idx))
