"""Synthetic checks for the exact public graph extension; never remove old gates."""
import copy,json,sys,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
import check_project_consistency as checker
import check_edge_contract as edge
JSON='src/jungsi_touch/application/public_response_schemas.json';CAT='supabase/functions/_shared/current_public_catalog.ts';TEST='tests/edge/test_waitlist_conflict_service.formatted.v2.ts'
class GraphExtensionTests(unittest.TestCase):
 def setUp(self):self.spec=json.loads((ROOT/'docs/current/service_spec.json').read_bytes());self.read=lambda p:(ROOT/p).read_bytes();self.names={JSON,CAT,TEST,'tests/test_foundation_graph_extension.py','tests/test_offline_graph_cli.py'}
 def test_exact_extension_requires_selected_bytes_and_layer(self):
  self.assertEqual(checker.foundation_graph_extension_errors(self.names,self.read,self.spec),[])
  for mutation in ('missing','sha','extra','layer'):
   s=copy.deepcopy(self.spec);e=s['edge_harness']['bound_graph_extensions']['files']
   if mutation=='missing':del e[JSON]
   if mutation=='sha':e[JSON]['sha256']='0'*64
   if mutation=='extra':e['src/unregistered.json']=copy.deepcopy(e[JSON])
   if mutation=='layer':e[CAT]['layer']='data_infrastructure'
   with self.subTest(mutation=mutation):self.assertTrue(checker.foundation_graph_extension_errors(self.names,self.read,s))
 def test_json_is_accepted_only_with_exact_registered_kind_and_path(self):
  url=lambda p:(ROOT/p).resolve().as_uri();raw={'version':1,'roots':[url(TEST)],'modules':[{'specifier':url(TEST),'kind':'esm','mediaType':'TypeScript','dependencies':[{'specifier':'../../src/jungsi_touch/application/public_response_schemas.json','code':{'specifier':url(JSON)},'assertionType':'json'}]},{'specifier':url(JSON),'kind':'asserted','mediaType':'Json','size':(ROOT/JSON).stat().st_size}]};registered={TEST};layers={TEST:'verification'};manifest={JSON:edge.PUBLIC_SCHEMA_SHA256}
  result,_=edge.normalize_graph(raw,ROOT,registered,layers,manifest=manifest,coexisting={});self.assertEqual(len(result[TEST]),1)
  with self.assertRaises(edge.EdgeFailure):edge.normalize_graph(raw,ROOT,set(),layers,manifest=manifest,coexisting={})
  bad=copy.deepcopy(raw);bad['modules'][1]['kind']='esm'
  with self.assertRaises(edge.EdgeFailure):edge.normalize_graph(bad,ROOT,registered,layers,manifest=manifest,coexisting={})
 def test_unknown_json_does_not_become_an_implicit_allowlist(self):
  s=copy.deepcopy(self.spec);s['edge_harness']['bound_graph_extensions']['files']['src/other.json']={'layer':'application','sha256':'0'*64};self.assertTrue(checker.foundation_graph_extension_errors(self.names,self.read,s))
 def test_missing_extension_fails_for_either_staged_waitlist_test_but_not_legacy(self):
  s=copy.deepcopy(self.spec);del s['edge_harness']['bound_graph_extensions']
  staged={'tests/edge/test_waitlist_conflict_guard.synthetic.ts',TEST}
  for name in staged:
   with self.subTest(name=name):self.assertTrue(checker.foundation_graph_extension_errors((self.names-staged)|{name},self.read,s))
  self.assertEqual(checker.foundation_graph_extension_errors(self.names-staged,self.read,s),[])
if __name__=='__main__':unittest.main()
