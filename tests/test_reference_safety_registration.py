"""Synthetic registration checks: no DB, service, Storage or network."""
import copy,json,sys,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"scripts"))
from reference_safety_suite import required,registration,MANIFEST_PATH,MANIFEST_SHA,TESTS
from run_committed_tests import summarize_edge_units
class ReferenceSafetyRegistration(unittest.TestCase):
 def setUp(self):
  self.raw=(ROOT/MANIFEST_PATH).read_bytes()
  self.m=json.loads(self.raw)
  self.before={**self.m["source_bindings"],MANIFEST_PATH:MANIFEST_SHA}
  self.spec={"backend_platform_contract":{"reference_safety_synthetic_test_extension":{
   "format":"jungsi.reference-safety-synthetic-suite/v1","status":"SOURCE_REGISTERED_NOT_EXECUTED",
   "activation_status":"NOT_RUN","native_acceptance":"NOT_VERIFIED_BY_SOURCE_SUITE","operating_writes":0,
   "test_count":18,"test_paths":list(TESTS),"manifest":{"path":MANIFEST_PATH,"sha256":MANIFEST_SHA}}}}
  self.read=lambda _:self.raw
 def test_registered_exact_snapshot(self):
  result=registration(self.spec,self.before,self.read)
  self.assertEqual(result["test_count"],18)
  self.assertEqual([len(result["case_names_by_path"][p]) for p in TESTS],[9,6,3])
 def test_absent_only_if_no_orphan(self):
  self.assertFalse(required({}))
  self.assertIsNone(registration({}, {}, self.read))
  with self.assertRaises(ValueError):registration({},self.before,self.read)
 def test_source_manifest_and_count_tampering_rejected(self):
  bad=dict(self.before);bad[TESTS[0]]="0"*64
  with self.assertRaises(ValueError):registration(self.spec,bad,self.read)
  with self.assertRaises(ValueError):registration(self.spec,self.before,lambda _:self.raw+b" ")
  for key,value in [("test_count",17),("activation_status","PASS"),("operating_writes",False)]:
   changed=copy.deepcopy(self.spec);changed["backend_platform_contract"]["reference_safety_synthetic_test_extension"][key]=value
   with self.assertRaises(ValueError):registration(changed,self.before,self.read)
 def test_result_is_separate_and_never_accepts_missing_skip_or_wrong_count(self):
  unit=lambda n:dict(tests_run=n,failures=0,errors=0,skipped=0)
  good={"unit":unit(656),"reference_safety_unit":unit(18)}
  result=summarize_edge_units(good,656,False,reference_safety_required=True)
  self.assertEqual(result["by_suite"]["unit"],656)
  self.assertEqual(result["by_suite"]["reference_safety_unit"],18)
  with self.assertRaises(ValueError):summarize_edge_units({"unit":unit(656)},656,False,reference_safety_required=True)
  with self.assertRaises(ValueError):summarize_edge_units(good,656,False,reference_safety_required=False)
  for key,value in [("tests_run",17),("skipped",1),("errors",1)]:
   bad=copy.deepcopy(good);bad["reference_safety_unit"][key]=value
   with self.assertRaises(ValueError):summarize_edge_units(bad,656,False,reference_safety_required=True)
if __name__=="__main__":unittest.main()