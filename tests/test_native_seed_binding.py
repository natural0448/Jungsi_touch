"""Opt-in native seed remains exact-source-bound and never implies network isolation."""
import copy,json,sys,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
import check_project_consistency as c
class SeedBindingTests(unittest.TestCase):
 def setUp(self):
  self.spec=json.loads((ROOT/'docs/current/service_spec.json').read_bytes());self.ext=self.spec['backend_platform_contract']['native_seed_candidate_extension'];self.names={x['path'] for k in ('source_bindings','tests') for x in self.ext[k]};self.read=lambda p:(ROOT/p).read_bytes()
 def test_exact_registration(self):self.assertEqual(c.native_seed_candidate_errors(self.names,self.read,self.spec),[])
 def test_omitted_or_changed_source_fails(self):
  self.names.remove('tests/test_native_seed_opt_in.py');self.assertTrue(c.native_seed_candidate_errors(self.names,self.read,self.spec));self.names.add('tests/test_native_seed_opt_in.py');s=copy.deepcopy(self.spec);s['backend_platform_contract']['native_seed_candidate_extension']['source_bindings'][0]['sha256']='0'*64;self.assertTrue(c.native_seed_candidate_errors(self.names,self.read,s))
 def test_network_claim_and_unregistered_tests_fail(self):
  s=copy.deepcopy(self.spec);s['backend_platform_contract']['native_seed_candidate_extension']['network_isolation']='PASS';self.assertTrue(c.native_seed_candidate_errors(self.names,self.read,s));del s['backend_platform_contract']['native_seed_candidate_extension'];self.assertTrue(c.native_seed_candidate_errors(self.names,self.read,s))
if __name__=='__main__':unittest.main()
