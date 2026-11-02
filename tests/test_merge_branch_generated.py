import importlib.util, json, os, sys, unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

P=Path(__file__).resolve().parents[1]/'scripts'/'merge_branch_generated.py'
z=importlib.util.spec_from_file_location('merge_candidate',P);m=importlib.util.module_from_spec(z);sys.modules[z.name]=m;z.loader.exec_module(m)
base={'version':'1','nested':{'x':1,'y':1},'list':[1],'change_notes':[{'date':'old','summary':'kept'}]}
def clones():return tuple(json.loads(json.dumps(base)) for _ in range(3))

class IsolatedGitEnvironment(unittest.TestCase):
 def setUp(self):
  super().setUp()
  # Git hooks propagate repository-local GIT_* variables into test processes.
  # Isolate every test and restore the exact inherited environment afterwards.
  clean={k:v for k,v in os.environ.items() if not k.upper().startswith('GIT_')}
  scope=patch.dict(os.environ,clean,clear=True);scope.start();self.addCleanup(scope.stop)

class ThreeWay(IsolatedGitEnvironment):
 def test_disjoint_keys_and_notes(self):
  b,o,t=clones();o['nested']['x']=2;t['nested']['y']=3;o['change_notes'].append({'summary':'a'});t['change_notes'].append({'summary':'b'});r=m.merge_spec(b,o,t)
  self.assertEqual(r['nested'],{'x':2,'y':3});self.assertEqual([x['summary'] for x in r['change_notes']],['kept','a','b'])
 def test_conflicting_scalar_stops(self):
  b,o,t=clones();o['version']='2';t['version']='3'
  with self.assertRaisesRegex(m.Stop,'unresolved_spec_conflict:version'):m.merge_spec(b,o,t)
 def test_conflicting_arrays_stop(self):
  b,o,t=clones();o['list'].append(2);t['list'].append(3)
  with self.assertRaisesRegex(m.Stop,'unresolved_spec_conflict:list'):m.merge_spec(b,o,t)
 def test_code_index_not_silently_overwritten(self):
  b,o,t=clones();b['workflow']={'code_index':{'files':[1]}};o['workflow']={'code_index':{'files':[1,2]}};t['workflow']={'code_index':{'files':[1,3]}}
  with self.assertRaisesRegex(m.Stop,'unresolved_spec_conflict:workflow/code_index/files'):m.merge_spec(b,o,t)
 def test_type_difference_is_conflict(self):
  b,o,t=clones();o['nested']['x']=True;t['nested']['x']=2
  with self.assertRaises(m.Stop):m.merge_spec(b,o,t)
 def test_removal_and_edit_conflict(self):
  b,o,t=clones();del o['nested']['x'];t['nested']['x']=5
  with self.assertRaises(m.Stop):m.merge_spec(b,o,t)
 def test_one_side_edit_and_add(self):
  b,o,t=clones();o['nested']['x']=5;t['new']={'ok':True};r=m.merge_spec(b,o,t);self.assertEqual(r['nested']['x'],5);self.assertTrue(r['new']['ok'])
 def test_notes_rewrite_stops(self):
  b,o,t=clones();o['change_notes'][0]['summary']='rewritten'
  with self.assertRaisesRegex(m.Stop,'append_only'):m.merge_spec(b,o,t)
 def test_notes_deleted_stops(self):
  b,o,t=clones();o['change_notes'].clear()
  with self.assertRaisesRegex(m.Stop,'append_only'):m.merge_spec(b,o,t)
 def test_equal_new_notes_are_ambiguous(self):
  b,o,t=clones();o['change_notes'].append({'summary':'same'});t['change_notes'].append({'summary':'same'})
  with self.assertRaisesRegex(m.Stop,'ambiguous_duplicate'):m.merge_spec(b,o,t)
 def test_reordered_notes_stops(self):
  b,o,t=clones();b['change_notes'].append({'summary':'second'});o['change_notes']=list(reversed(b['change_notes']));t['change_notes']=b['change_notes'][:]
  with self.assertRaisesRegex(m.Stop,'append_only'):m.merge_spec(b,o,t)
 def test_base_and_inputs_unchanged(self):
  b,o,t=clones();before=json.dumps([b,o,t]);r=m.merge_spec(b,o,t);r['nested']['x']=99;self.assertEqual(json.dumps([b,o,t]),before)
 def test_duplicate_keys_or_nan_are_rejected(self):
  for x in (b'{"a":1,"a":2}',b'{"a":NaN}',b'[]',b'\xff'):
   with self.assertRaises(m.Stop):m.parse_json(x)
 def test_float_roundtrip_exactness(self):
  for value in (b'1.00000000000000000001',b'0.123456789012345678901',b'1e400',b'1e-400'):
   with self.assertRaisesRegex(m.Stop,'lossy_json_float'):m.parse_json(b'{"value":'+value+b'}')
  for value in (b'0.1',b'1.50',b'1e-20',b'-0.0'):
   parsed=m.parse_json(b'{"value":'+value+b'}');self.assertIsInstance(parsed['value'],float)
 def test_unsafe_paths_are_rejected(self):
  for p in ('../a','/abs','a/../b','a//b','C:/x','a\\b','a/./b'):
   with self.assertRaises(m.Stop):m.safe_path(p)
 def test_unknown_unmerged_file_is_rejected(self):
  index={m.SPEC:{1:1,2:2,3:3},'docs/generated.md':{1:1,2:2,3:3},'apps/web/user.ts':{2:2,3:3}}
  with self.assertRaisesRegex(m.Stop,'unresolved_non_generated_conflict'):m.ensure_generated_conflicts(index,{'docs/generated.md'})
 def test_index_rejects_duplicate_and_symlink(self):
  sha='a'*40;record=f'100644 {sha} 0\tfile\0'.encode()
  with self.assertRaises(m.Stop):m.parse_index(record+record)
  with self.assertRaises(m.Stop):m.parse_index(f'120000 {sha} 0\tfile\0'.encode())
 def test_strict_approved_generator_pin(self):
  with self.assertRaisesRegex(m.Stop,'unapproved_generator'):m.load_generator(Path('.'),{m.GEN:{0:('100644','a'*40)},m.AUDIT:{0:('100644','b'*40)}},None,'c'*40,'b'*40,{k:'e'*40 for k in m.DEPS})

class DestinationPaths(IsolatedGitEnvironment):
 def setUp(self):
  super().setUp()
  import uuid
  self.repo=P.parent.parent/'outputs/merge_destination_tests'/uuid.uuid4().hex
  self.repo.mkdir(parents=True,exist_ok=False)
 def test_missing_outputs_has_actionable_message_and_can_be_created(self):
  with self.assertRaisesRegex(m.Stop,'outputs_missing: create the outputs folder'):
   m.check_destination(self.repo,'outputs/preview')
  self.assertFalse((self.repo/'outputs').exists())
  (self.repo/'outputs').mkdir()
  self.assertEqual(m.check_destination(self.repo,'outputs/preview'),self.repo/'outputs/preview')
 def test_existing_non_directory_is_preserved(self):
  target=self.repo/'outputs';target.write_bytes(b'preserve')
  with self.assertRaisesRegex(m.Stop,'outputs_not_regular'):
   m.check_destination(self.repo,'outputs/preview')
  self.assertEqual(target.read_bytes(),b'preserve')


class PreviewIntegration(IsolatedGitEnvironment):
 def run_case(self,unknown=False,mutated=False,dirty=False,untracked=False):
  h='a'*40;parent='b'*40;g='c'*40;au='d'*40;ids=['1'*40,'2'*40,'3'*40,'4'*40,'5'*40,'6'*40,'7'*40]
  b,o,t=clones();b['workflow']={'documentation_sync':{'code_index':{}}};o['workflow']=json.loads(json.dumps(b['workflow']));t['workflow']=json.loads(json.dumps(b['workflow']))
  o['change_notes'].append({'summary':'ours'});t['change_notes'].append({'summary':'theirs'})
  payload={ids[0]:json.dumps(b).encode(),ids[1]:json.dumps(o).encode(),ids[2]:json.dumps(t).encode(),ids[3]:b'base generated',ids[4]:b'our generated',ids[5]:b'their generated',ids[6]:b'clean'}
  rows=[(m.SPEC,1,ids[0]),(m.SPEC,2,ids[1]),(m.SPEC,3,ids[2]),(m.GEN,0,g),(m.AUDIT,0,au),('docs/generated.md',1,ids[3]),('docs/generated.md',2,ids[4]),('docs/generated.md',3,ids[5]),('docs/clean.md',0,ids[6])]
  if unknown:rows.append(('apps/web/unsafe.ts',2,ids[4]))
  raw=b''.join(f'100644 {oid} {stage}\t{path}\0'.encode() for path,stage,oid in rows)
  class Blob:
   def __init__(self,_):pass
   def read(self,oid):return payload[oid]
   def close(self):pass
  audit=SimpleNamespace(refresh_catalog=lambda names,read,spec:({'format':'synthetic'},{}),validate_catalog=lambda names,read,spec:[])
  check=SimpleNamespace(validate_spec=lambda spec:[],generated_files=lambda spec,read:{'docs/generated.md':b'generated','tests/edge/generated.ts':b'test','docs/clean.md':b'new clean'})
  class Dest:
   def mkdir(self,**kwargs):self.created=True
  dest=Dest();outputs={};contexts=[(h,parent,raw),(h,parent,raw+b'x') if mutated else (h,parent,raw)]
  def write(d,path,data):outputs[path]=data
  def worktree(repo,path):
   if path=='docs/clean.md':return b'dirty' if dirty else b'clean'
   if path=='tests/edge/generated.ts' and untracked:return b'private pending work'
   return None
  with patch.object(m,'check_destination',return_value=dest),patch.object(m,'context',side_effect=contexts),patch.object(m,'Blobs',Blob),patch.object(m,'verify_stage_binding',return_value={'base':'synthetic'}),patch.object(m,'load_generator',return_value=(audit,check)),patch.object(m,'read_worktree',side_effect=worktree),patch.object(m,'write_new',side_effect=write):
   if unknown or mutated or dirty or untracked:
    with self.assertRaises(m.Stop):m.preview(P.parent,'unused',h,parent,g,au,{k:'e'*40 for k in m.DEPS})
    self.assertEqual(outputs,{});self.assertFalse(hasattr(dest,'created'));return
   result=m.preview(P.parent,'unused',h,parent,g,au,{k:'e'*40 for k in m.DEPS})
  spec=json.loads(outputs['candidate/'+m.SPEC]);self.assertEqual([x['summary'] for x in spec['change_notes']],['kept','ours','theirs']);self.assertEqual(result['generated_count'],3);self.assertEqual(outputs['worktree/docs/clean.md'],b'clean')
  audit_spec=importlib.util.spec_from_file_location('audit_for_merge_test',P.parent/'audit_documentation_sync.py');actual_audit=importlib.util.module_from_spec(audit_spec);audit_spec.loader.exec_module(actual_audit)
  self.assertEqual(outputs['candidate/'+m.SPEC],actual_audit.spec_bytes(spec))
  self.assertEqual(outputs['stages/2/docs/generated.md'],b'our generated');self.assertEqual(outputs['stages/3/docs/generated.md'],b'their generated')
  self.assertEqual(result['state'],'REVIEW_ONLY');self.assertIn('normal_git_hooks',result['not_run']);self.assertNotIn('apps/web/unsafe.ts',result['conflicted_paths'])
 def test_preview_composes_and_preserves_stages(self):self.run_case()
 def test_unknown_conflict_stops_without_output(self):self.run_case(unknown=True)
 def test_changed_index_stops_without_output(self):self.run_case(mutated=True)
 def test_dirty_generated_file_stops_without_output(self):self.run_case(dirty=True)
 def test_untracked_generated_collision_stops_without_output(self):self.run_case(untracked=True)


class VerifiedCommitPins(IsolatedGitEnvironment):
 def setUp(self):
  super().setUp()
  self.commit='a'*40;self.paths=sorted({m.GEN,m.AUDIT,*m.DEPS});self.pins={p:str(i+1)*40 for i,p in enumerate(self.paths)}
  self.index={p:{0:('100644',sha)} for p,sha in self.pins.items()}
 def tree(self,changes=None):
  rows=[('100644','blob',sha,p) for p,sha in self.pins.items()]
  if changes:rows=changes(rows)
  return b''.join(f'{mode} {kind} {sha}\t{path}\0'.encode() for mode,kind,sha,path in rows)
 def call(self,commit=None,index=None,tree=None,kind=b'commit\n',resolved=None):
  commit=self.commit if commit is None else commit;index=self.index if index is None else index;tree=self.tree() if tree is None else tree
  def git(repo,*args):
   if args[:2]==('cat-file','-t'):return kind
   if args[0]=='rev-parse':return (resolved or self.commit).encode()+b'\n'
   if args[0]=='ls-tree':return tree
   raise AssertionError(args)
  with patch.object(m,'git',side_effect=git):return m.pins_from_commit(Path('.'),commit,index)
 def test_exact_commit_and_six_matching_blobs(self):self.assertEqual(self.call(),self.pins)
 def test_short_ref_rejected_without_git(self):
  with patch.object(m,'git',side_effect=AssertionError('git must not run')):
   with self.assertRaisesRegex(m.Stop,'full_verified_commit_required'):m.pins_from_commit(Path('.'),'develop',self.index)
 def test_not_commit_and_indirect_object_rejected(self):
  with self.assertRaisesRegex(m.Stop,'verified_commit_not_commit'):self.call(kind=b'tag\n')
  with self.assertRaisesRegex(m.Stop,'verified_commit_not_exact'):self.call(resolved='f'*40)
 def test_missing_tree_item_rejected(self):
  with self.assertRaisesRegex(m.Stop,'verified_commit_missing_tools'):self.call(tree=self.tree(lambda r:r[:-1]))
 def test_duplicate_and_unexpected_tree_items_rejected(self):
  with self.assertRaisesRegex(m.Stop,'invalid_verified_tree'):self.call(tree=self.tree(lambda r:r+[r[0]]))
  with self.assertRaisesRegex(m.Stop,'invalid_verified_tree'):self.call(tree=self.tree(lambda r:r+[('100644','blob','b'*40,'other')]))
 def test_symlink_tree_and_wrong_object_type_rejected(self):
  for mode,kind in [('120000','blob'),('100644','tree')]:
   def modify(rows): rows[0]=(mode,kind,rows[0][2],rows[0][3]);return rows
   with self.assertRaisesRegex(m.Stop,'invalid_verified_tree'):self.call(tree=self.tree(modify))
 def test_wrong_oid_length_rejected(self):
  def modify(rows):rows[0]=(rows[0][0],rows[0][1],'f'*64,rows[0][3]);return rows
  with self.assertRaisesRegex(m.Stop,'invalid_verified_tree'):self.call(tree=self.tree(modify))
 def test_changed_blob_index_mode_or_unmerged_rejected(self):
  for entry in ({0:('100644','f'*40)},{0:('100755',self.pins[self.paths[0]])},{2:('100644',self.pins[self.paths[0]])},{}):
   index=dict(self.index);index[self.paths[0]]=entry
   with self.assertRaisesRegex(m.Stop,'verified_commit_index_mismatch'):self.call(index=index)
 def test_cli_commit_and_blob_modes_are_mutually_exclusive(self):
  args=['--repo','.','--out','outputs/new','--head','a'*40,'--merge-head','b'*40]
  with self.assertRaisesRegex(m.Stop,'mixed_pin_modes'):m.main(args+['--verified-commit',self.commit,'--generator-blob','c'*40])
  with self.assertRaisesRegex(m.Stop,'complete_pin_mode_required'):m.main(args)
  with self.assertRaisesRegex(m.Stop,'dependency_pins_required'):m.main(args+['--generator-blob','c'*40,'--auditor-blob','d'*40,'--dependency-blob','extra='+'e'*40])
 def test_cli_selects_explicit_commit_without_auto_trust(self):
  args=['--repo','.','--out','outputs/new','--head','a'*40,'--merge-head','b'*40,'--verified-commit',self.commit]
  result={'state':'REVIEW_ONLY','generated_count':1,'canonical_spec_sha256':'f'*64}
  with patch.object(m,'preview',return_value=result) as call:
   m.main(args);self.assertEqual(call.call_args.args[-1],self.commit);self.assertIsNone(call.call_args.args[-2])
 def test_stage_zero_spec_still_stops_before_blob_or_commit_lookup(self):
  h='a'*40;parent='b'*40;sha='c'*40;raw=f'100644 {sha} 0\t{m.SPEC}\0'.encode()
  with patch.object(m,'check_destination',return_value=object()),patch.object(m,'context',return_value=(h,parent,raw)),patch.object(m,'pins_from_commit',side_effect=AssertionError('unexpected commit lookup')),patch.object(m,'Blobs',side_effect=AssertionError('unexpected blob access')):
   with self.assertRaisesRegex(m.Stop,'spec_three_stages_required'):m.preview(P.parent,'unused',h,parent,None,None,None,self.commit)


class StageBinding(IsolatedGitEnvironment):
 def setUp(self):
  super().setUp()
  self.head='a'*40;self.parent='b'*40;self.base='c'*40;self.ids={self.base:'d'*40,self.head:'e'*40,self.parent:'f'*40}
  self.index={m.SPEC:{i:('100644',self.ids[rev]) for i,rev in ((1,self.base),(2,self.head),(3,self.parent))}}
  self.values={'filter':'unspecified','working-tree-encoding':'unspecified','ident':'unspecified','merge':'unspecified'}
 def run_guard(self,variant=None,index=None):
  variant=variant or {};index=self.index if index is None else index
  def git(repo,*args):
   if args==('rev-parse','--is-shallow-repository'):return (b'true' if variant.get('shallow') else b'false')+b'\n'
   if args==('rev-parse','--git-path','info/grafts'):return b'absent-test-grafts-unique\n'
   if args[0]=='cat-file':return (b'tag' if variant.get('noncommit') else b'commit')+b'\n'
   if args[0]=='merge-base':return (self.base+'\n'+('9'*40+'\n' if variant.get('multi') else '')).encode()
   if args[0]=='ls-tree':
    rev=args[3];mode='120000' if variant.get('symlink') else '100644'
    if variant.get('missing'):return b''
    return f'{mode} blob {self.ids[rev]}\t{m.SPEC}\0'.encode()
   if args[0]=='diff-tree':return variant.get('pre_diff',variant.get('diff',b'M\0changed.txt\0')) if '--no-renames' in args else variant.get('rename_diff',variant.get('diff',b'M\0changed.txt\0'))
   if args[0]=='check-attr':
    v=dict(self.values)
    if variant.get('filter'):v['filter']='secret-driver'
    if variant.get('attr_mismatch') and '--cached' in args:v['filter']='unset'
    return b''.join(f'{m.SPEC}\0{k}\0{x}\0'.encode() for k,x in v.items())
   raise AssertionError(args)
  with patch.object(m,'git',side_effect=git),patch.object(m,'renormalize_setting',return_value='unset'):
   return m.verify_stage_binding(P.parent,self.head,self.parent,index)
 def test_unique_base_and_exact_three_stages(self):self.assertEqual(self.run_guard()['base'],self.base)
 def test_each_forged_stage_is_rejected(self):
  for stage in (1,2,3):
   index={m.SPEC:dict(self.index[m.SPEC])};index[m.SPEC][stage]=('100644','9'*40)
   with self.assertRaisesRegex(m.Stop,'spec_stage_parent_mismatch:'+str(stage)):self.run_guard(index=index)
 def test_mode_mismatch_or_tree_symlink_rejected(self):
  index={m.SPEC:dict(self.index[m.SPEC])};index[m.SPEC][2]=('100755',self.ids[self.head])
  with self.assertRaisesRegex(m.Stop,'spec_stage_parent_mismatch'):self.run_guard(index=index)
  with self.assertRaisesRegex(m.Stop,'tree_spec_invalid'):self.run_guard({'symlink':True})
 def test_multiple_bases_missing_path_and_shallow_stop(self):
  for variant,reason in [({'multi':True},'merge_base_not_unique'),({'missing':True},'tree_spec_missing'),({'shallow':True},'shallow_repository'),({'noncommit':True},'merge_parent_not_commit')]:
   with self.assertRaisesRegex(m.Stop,reason):self.run_guard(variant)
 def test_unrelated_add_delete_and_type_change_are_allowed(self):
  for code in (b'A',b'D',b'T'):
   self.assertEqual(self.run_guard({'diff':code+b'\0apps/web/src/other.tsx\0'})['base'],self.base)
 def test_spec_add_delete_or_type_change_stop(self):
  for code in (b'A',b'D',b'T'):
   with self.assertRaisesRegex(m.Stop,'spec_path_changed_or_renamed'):self.run_guard({'diff':code+b'\0'+m.SPEC.encode()+b'\0'})
 def test_detected_spec_rename_either_direction_stops(self):
  for a,b in ((m.SPEC,'docs/other.json'),('docs/other.json',m.SPEC)):
   raw=b'R100\0'+a.encode()+b'\0'+b.encode()+b'\0'
   with self.assertRaisesRegex(m.Stop,'spec_path_changed_or_renamed'):self.run_guard({'rename_diff':raw})
 def test_unrelated_detected_rename_allowed(self):
  self.assertEqual(self.run_guard({'rename_diff':b'R100\0apps/web/a.tsx\0apps/web/b.tsx\0'})['base'],self.base)
 def test_rename_scope_too_large_fails_closed(self):
  diff=b''.join(b'M\0file'+str(i).encode()+b'\0' for i in range(257))
  with self.assertRaisesRegex(m.Stop,'rename_review_scope_too_large'):self.run_guard({'pre_diff':diff})
 def test_filter_or_attribute_disagreement_stops(self):
  with self.assertRaisesRegex(m.Stop,'unsupported_conversion'):self.run_guard({'filter':True})
  with self.assertRaisesRegex(m.Stop,'attributes_not_consistent'):self.run_guard({'attr_mismatch':True})
 def test_unmerged_attributes_stop(self):
  index=dict(self.index);index['docs/.gitattributes']={2:('100644','1'*40)}
  with self.assertRaisesRegex(m.Stop,'unmerged_attributes'):self.run_guard(index=index)
 def test_git_environment_override_rejected(self):
  for name in ('GIT_DIR','GIT_INDEX_FILE','GIT_WORK_TREE','GIT_CONFIG_KEY_0','GIT_CONFIG_VALUE_0'):
   with self.subTest(name=name),patch.dict(os.environ,{name:'untrusted-synthetic-value'}):
    with self.assertRaisesRegex(m.Stop,'git_environment_override'):self.run_guard()
 def test_hook_environment_is_isolated_per_test(self):
  self.assertFalse(any(k.upper().startswith('GIT_') for k in os.environ))
 def test_isolation_restores_inherited_environment(self):
  with patch.dict(os.environ,{'GIT_DIR':'inherited-synthetic-value'}):
   inner=IsolatedGitEnvironment('runTest');inner.setUp()
   try:self.assertNotIn('GIT_DIR',os.environ)
   finally:inner.doCleanups()
   self.assertEqual(os.environ.get('GIT_DIR'),'inherited-synthetic-value')
 def test_unknown_diff_format_rejected(self):
  with self.assertRaisesRegex(m.Stop,'tree_diff_invalid'):self.run_guard({'diff':b'M\0missing-terminator'})
 def test_multiple_or_missing_merge_configuration_not_inferred(self):
  self.assertIn('historical merge invocation not established',self.run_guard()['scope'])

if __name__=='__main__':unittest.main(verbosity=2)
