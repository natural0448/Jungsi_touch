"""Exact wildcard/report synthetic suite registration remains additive and fail closed."""
import copy,json,sys,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/"scripts"))
import check_project_consistency as checker
import run_committed_tests as runner

def loaded():return json.loads((ROOT/"docs/current/service_spec.json").read_bytes())
class WildcardRegistrationTests(unittest.TestCase):
 def test_exact_suite_and_baseline(self):
  s=loaded();e,errors=checker.service_wildcard_registration(s)
  self.assertEqual(errors,[]);self.assertEqual(e["test_count"],97);self.assertEqual(s["edge_harness"]["unit_count"],656)
 def test_missing_suite_never_hides_sources(self):
  s=loaded();del s["backend_platform_contract"]["service_wildcard_test_extension"]
  self.assertIn("Read-view separate exact suite registration drift",checker.validate_read_view_extension(s))
 def test_unregistered_selected_bytes_are_rejected(self):
  s=loaded();e=s["backend_platform_contract"]["service_wildcard_test_extension"]
  del s["backend_platform_contract"]["service_wildcard_test_extension"]
  self.assertTrue(checker.service_wildcard_registration(s,{e["test_paths"][0]:"0"*64})[1])
  self.assertTrue(checker.service_wildcard_registration(s,{e["fixture_graph_guard"]["path"]:e["fixture_graph_guard"]["sha256"]})[1])
 def test_legacy_absence_and_unregistered_implementation(self):
  self.assertEqual(checker.service_wildcard_registration({},{}),(None,[]))
  path=checker.SERVICE_WILDCARD_IMPLEMENTATION_SENTINELS[0]
  self.assertTrue(checker.service_wildcard_registration({"edge_harness":{"files":{path:{}}}})[1])
  self.assertTrue(checker.service_wildcard_registration({"implementation":[{"path":path}]})[1])
  self.assertTrue(checker.service_wildcard_registration({}, {path:"0"*64})[1])
  self.assertTrue(checker.service_wildcard_registration({}, {"tests/test_service_wildcard_registration.py":"0"*64})[1])
 def test_mutated_source_names_or_status_fail(self):
  for kind in ("source","name","status","count","guard_missing","guard_path","guard_pin"):
   s=loaded();e=s["backend_platform_contract"]["service_wildcard_test_extension"]
   if kind=="source":e["source_bindings"][0]["sha256"]="0"*64
   if kind=="name":e["case_names_by_path"][e["test_paths"][0]][0]+=" modified"
   if kind=="status":e["native_acceptance"]="PASS"
   if kind=="count":e["test_count"]=96
   if kind=="guard_missing":del e["fixture_graph_guard"]
   if kind=="guard_path":e["fixture_graph_guard"]["path"]="tests/other.py"
   if kind=="guard_pin":e["fixture_graph_guard"]["sha256"]="0"*64
   with self.subTest(kind=kind):self.assertTrue(checker.service_wildcard_registration(s)[1])
 def test_selected_bytes_and_disjoint_scope_required(self):
  s=loaded();e=s["backend_platform_contract"]["service_wildcard_test_extension"]
  h={r["path"]:r["sha256"] for r in e["source_bindings"]};h[e["regression_test"]["path"]]=e["regression_test"]["sha256"]
  guard=e["fixture_graph_guard"];h[guard["path"]]=guard["sha256"]
  self.assertEqual(checker.service_wildcard_registration(s,h)[1],[])
  del h[guard["path"]];self.assertTrue(checker.service_wildcard_registration(s,h)[1])
  h[guard["path"]]="0"*64;self.assertTrue(checker.service_wildcard_registration(s,h)[1])
  guard["sha256"]="0"*64;self.assertTrue(checker.service_wildcard_registration(s,h)[1])
  guard["sha256"]=checker.PROFESSIONAL_FIXTURE_GRAPH_GUARD[1];h[guard["path"]]=guard["sha256"]
  h[e["test_paths"][0]]="0"*64;self.assertTrue(checker.service_wildcard_registration(s,h)[1])
  s=loaded();e=s["backend_platform_contract"]["service_wildcard_test_extension"]
  s["read_view_extension_contract"]["verification"]["test_paths"].append(e["test_paths"][0])
  self.assertTrue(checker.service_wildcard_registration(s)[1])
 def test_summary_requires_all_separate_suites_and_no_skip(self):
  def ok(n):return {"tests_run":n,"failures":0,"errors":0,"skipped":0}
  x={"unit":ok(656),"service_candidate_aux_unit":ok(14),"service_staged_aux_unit":ok(76)}
  with self.assertRaises(ValueError):runner.summarize_edge_units(x,656,False,True,True,True)
  x["service_wildcard_unit"]=ok(97)
  self.assertEqual(runner.summarize_edge_units(x,656,False,True,True,True)["total_tests"],843)
  x["service_wildcard_unit"]["skipped"]=1
  with self.assertRaises(ValueError):runner.summarize_edge_units(x,656,False,True,True,True)
if __name__=="__main__":unittest.main()
