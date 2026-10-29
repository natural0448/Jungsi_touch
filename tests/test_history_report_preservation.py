"""Historical service notes and saved-report read scope do not silently disappear."""
import copy,json,sys,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
import check_project_consistency as c
class HistoryPreservationTests(unittest.TestCase):
 def setUp(self):self.spec=json.loads((ROOT/'docs/current/service_spec.json').read_bytes());self.test='tests/test_history_report_preservation.py';self.names={self.test};self.read=lambda p:(ROOT/p).read_bytes()
 def test_exact_history_and_report_scope(self):self.assertEqual(c.service_history_report_preservation_errors(self.names,self.read,self.spec),[])
 def test_missing_or_modified_note_fails(self):
  for kind in ('missing','modified'):
   s=copy.deepcopy(self.spec);h=s['workflow']['development_harness']['local_service_integration_history_20261030']['service_01a3_1_9_136_unmerged_change_notes']
   if kind=='missing':h['entries'].pop()
   else:h['entries'][0]['summary']='synthetic changed'
   with self.subTest(kind=kind):self.assertTrue(c.service_history_report_preservation_errors(self.names,self.read,s))
 def test_old_ci_receipt_cannot_be_promoted_or_changed(self):
  s=copy.deepcopy(self.spec);h=s['workflow']['development_harness']['local_service_integration_history_20261030'];h['service_01a3_1_9_136_historical_records']['scoped_CI_substitution_20261029']['synthetic_extra']=True;self.assertTrue(c.service_history_report_preservation_errors(self.names,self.read,s))
 def test_saved_read_scope_cannot_be_narrowed_or_missing(self):
  for value in ('synthetic limited',None):
   s=copy.deepcopy(self.spec);r=next(x for x in s['operations'] if x['id']=='report.read');r['response_scope']=value
   with self.subTest(value=value):self.assertTrue(c.service_history_report_preservation_errors(self.names,self.read,s))
 def test_guard_test_cannot_be_omitted(self):self.names.clear();self.assertTrue(c.service_history_report_preservation_errors(self.names,self.read,self.spec))
if __name__=='__main__':unittest.main()
