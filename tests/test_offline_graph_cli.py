"""Explicit CLI controls reach Deno doc/info; existing default stays offline."""
import contextlib,io,json,sys,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
import check_edge_contract as edge
class OfflineGraphCliTests(unittest.TestCase):
 def test_flag_policy_requires_both(self):
  self.assertEqual(edge.graph_offline_flags(),['--no-remote','--no-npm'])
  for remote,npm in ((False,True),(True,False),(False,False),(1,True)):
   with self.subTest(remote=remote,npm=npm),self.assertRaises(edge.EdgeFailure):edge.graph_offline_flags(remote,npm)
 def test_cli_explicit_and_legacy_pass_offline_flags(self):
  for extra in ([],['--no-remote','--no-npm']):
   argv=['checker','--snapshot-root',str(ROOT),'--source-manifest','synthetic.json','--output-root','synthetic-out',*extra]
   with self.subTest(extra=extra),patch.object(sys,'argv',argv),patch.object(Path,'read_bytes',return_value=b'{}'),patch.object(edge,'check_workspace',return_value={'successful':True}) as run,contextlib.redirect_stdout(io.StringIO()):
    self.assertEqual(edge.main(),0);self.assertIs(run.call_args.kwargs['no_remote'],True);self.assertIs(run.call_args.kwargs['no_npm'],True)
 def test_cli_single_flag_stops_before_execution(self):
  argv=['checker','--snapshot-root',str(ROOT),'--source-manifest','synthetic.json','--output-root','synthetic-out','--no-remote']
  with patch.object(sys,'argv',argv),patch.object(edge,'check_workspace') as run,self.assertRaisesRegex(edge.EdgeFailure,'incomplete'):
   edge.main()
  run.assert_not_called()
 def test_doc_and_info_receive_both_controls(self):
  path='tests/edge/synthetic.ts';url=(ROOT/path).as_uri();doc=json.dumps({'version':2,'nodes':{url:{'symbols':[],'imports':[]}}}).encode();info=b'{}';calls=[]
  def command(argv,**kwargs):calls.append(argv);return doc if argv[1]=='doc' else info
  original=Path.read_text
  def text(path,*args,**kwargs):return '' if path==ROOT/pathlib_path else original(path,*args,**kwargs)
  pathlib_path=path
  with patch.object(edge,'classify_sources',return_value={'foundation_ts':[path],'coexisting_bound':[]}),patch.object(edge,'graph_coexisting_catalog',return_value={}),patch.object(edge,'hashes',return_value={}),patch.object(edge,'dynamic_imports',return_value=[]),patch.object(edge,'runtime',return_value={}),patch.object(Path,'read_text',text),patch.object(edge,'declaration_model',return_value={}),patch.object(edge,'normalize_graph',return_value=({path:[]},{path})),patch.object(edge,'verify_graph_literals'),patch.object(edge,'command',side_effect=command):
   edge.parse_contract(ROOT,{'files':{path:{'layer':'verification','symbols':[]}},'config':'supabase/functions/deno.json'},'synthetic-deno',ROOT,no_remote=True,no_npm=True)
  self.assertEqual([x[1] for x in calls],['doc','info'])
  for argv in calls:self.assertIn('--no-remote',argv);self.assertIn('--no-npm',argv)
 def test_false_policy_fails_before_runtime(self):
  with patch.object(edge,'runtime') as runtime,self.assertRaisesRegex(edge.EdgeFailure,'flags_required'):
   edge.parse_contract(ROOT,{},'synthetic-deno',ROOT,no_remote=False,no_npm=True)
  runtime.assert_not_called()
class DeclarationSnapshotPathTests(unittest.TestCase):
 def test_reference_origin_is_relative_and_independent_of_snapshot_root(self):
  path='supabase/functions/_shared/jungsi/infrastructure/example.ts'
  origin='supabase/functions/_shared/jungsi/domain/other.ts'
  def model(root):
   module={'symbols':[{'name':'Item','declarations':[{'def':{'target':{'filename':(root/origin).as_uri(),'line':3}}}]}],'imports':[]}
   with patch.object(Path,'read_bytes',return_value=b'export const sample = 1;'):
    return edge.declaration_model(module,root,path,{path,origin})
  first=model(ROOT);second=model(ROOT.parent/'different-snapshot')
  self.assertEqual(first,second)
  self.assertEqual(first['symbols'][0]['declarations'][0]['def']['target']['filename'],origin)
 def test_reference_origin_rejects_external_and_unregistered_paths(self):
  path='supabase/functions/_shared/jungsi/infrastructure/example.ts'
  for value,registered in [('https://outside.example/rule.ts',{path}),((ROOT/'secret.txt').as_uri(),{path})]:
   module={'symbols':[{'name':'Item','declarations':[{'def':{'target':{'filename':value}}}]}],'imports':[]}
   with self.subTest(value=value),patch.object(Path,'read_bytes',return_value=b'export const sample = 1;'),self.assertRaises(edge.EdgeFailure):
    edge.declaration_model(module,ROOT,path,registered)

if __name__=='__main__':unittest.main()
