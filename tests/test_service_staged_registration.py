"""Exact staged P1/waitlist suite registration is additive and fail closed."""
import copy,json,sys,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
import check_project_consistency as checker
import run_committed_tests as runner

def loaded():return json.loads((ROOT/'docs/current/service_spec.json').read_bytes())
class StagedRegistrationTests(unittest.TestCase):
 def test_exact_suite_and_baseline(self):
  s=loaded();e,errors=checker.service_staged_registration(s);self.assertEqual(errors,[]);self.assertEqual(e['test_count'],76);self.assertEqual(s['edge_harness']['unit_count'],656)
 def test_missing_suite_never_hides_staged_tests(self):
  s=loaded();del s['backend_platform_contract']['service_staged_test_extension'];self.assertIn('Read-view separate exact suite registration drift',checker.validate_read_view_extension(s))
 def test_mutated_source_names_or_status_fail(self):
  for kind in ('source','name','status','count'):
   s=loaded();e=s['backend_platform_contract']['service_staged_test_extension']
   if kind=='source':e['source_bindings'][0]['sha256']='0'*64
   if kind=='name':e['case_names_by_path'][e['test_paths'][0]][0]+=' modified'
   if kind=='status':e['native_acceptance']='PASS'
   if kind=='count':e['test_count']=75
   with self.subTest(kind=kind):self.assertTrue(checker.service_staged_registration(s)[1])
 def test_selected_bytes_and_disjoint_scope_required(self):
  s=loaded();e=s['backend_platform_contract']['service_staged_test_extension'];h={r['path']:r['sha256'] for r in e['source_bindings']};h[e['regression_test']['path']]=e['regression_test']['sha256'];self.assertEqual(checker.service_staged_registration(s,h)[1],[])
  h[e['test_paths'][0]]='0'*64;self.assertTrue(checker.service_staged_registration(s,h)[1]);s['read_view_extension_contract']['verification']['test_paths'].append(e['test_paths'][0]);self.assertTrue(checker.service_staged_registration(s)[1])
 def test_summary_requires_all_separate_suites_and_no_skip(self):
  x={'unit':{'tests_run':656,'failures':0,'errors':0,'skipped':0},'service_candidate_aux_unit':{'tests_run':14,'failures':0,'errors':0,'skipped':0}}
  with self.assertRaises(ValueError):runner.summarize_edge_units(x,656,False,True,True)
  x['service_staged_aux_unit']={'tests_run':76,'failures':0,'errors':0,'skipped':0};self.assertEqual(runner.summarize_edge_units(x,656,False,True,True)['total_tests'],746)
  x['service_staged_aux_unit']['skipped']=1
  with self.assertRaises(ValueError):runner.summarize_edge_units(x,656,False,True,True)
if __name__=='__main__':unittest.main()
