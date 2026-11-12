"""Independent synthetic checks for two non-operational source rebounds."""
import copy,json,unittest
from pathlib import Path
import check_project_consistency as c
ROOT=Path(__file__).resolve().parents[1]
class AuxSourceReboundTests(unittest.TestCase):
 def fixture(self):
  s=json.loads((ROOT/'docs/current/service_spec.json').read_bytes());families={}
  for name,(historical,path,sha) in c.AUX_SOURCE_REBOUND_PINS.items():families[name]={'historical_sha256':historical,'changed_source_bindings':{path:sha}}
  s['current_aux_source_rebounds_20261113']=dict(format='jungsi.current-aux-source-rebounds/v1',status='SOURCE_REGISTERED_NOT_EXECUTED',activation_status='NOT_RUN',native_acceptance='NOT_VERIFIED_BY_SOURCE_SUITE',operating_writes=0,families=families)
  path=c.AUX_SOURCE_REBOUND_PINS['dev010_runtime_assembly'][1];digest=c.AUX_SOURCE_REBOUND_PINS['dev010_runtime_assembly'][2]
  for row in s['workflow']['documentation_sync']['code_index']['edge_sources']['files']:
   if row['path']==path:row['source_sha256']=digest
  if path in s['edge_harness']['files']:s['edge_harness']['files'][path]['declarations']['source_sha256']=digest
  return s
 def test_two_exact_bindings_keep_history_and_clear_target_errors(self):
  spec=self.fixture();a=spec['supabase_deployment_contract']['live_execution']['runtime_assembly'];n=spec['backend_platform_contract']['native_seed_candidate_extension'];old=copy.deepcopy((a,n));p='DEV-010 runtime assembly source binding drift: composition'
  self.assertNotIn(p,c.validate_live_execution(spec));names={x['path'] for k in ('source_bindings','tests') for x in n[k]}
  self.assertEqual(c.native_seed_candidate_errors(names,lambda p:(ROOT/p).read_bytes(),spec),[]);self.assertEqual((a,n),old)
 def test_each_history_and_sibling_mutation_rejected(self):
  for family in c.AUX_SOURCE_REBOUND_PINS:
   for mode in ('history','historical_sha','current_sha','extra_source','missing_family','status','bool_writes','none_envelope'):
    with self.subTest(family=family,mode=mode):
     s=self.fixture();hist=s['supabase_deployment_contract']['live_execution']['runtime_assembly'] if family=='dev010_runtime_assembly' else s['backend_platform_contract']['native_seed_candidate_extension'];env=s['current_aux_source_rebounds_20261113'];pin,path,value=c.AUX_SOURCE_REBOUND_PINS[family]
     if mode=='history':hist['format']='FORGED'
     elif mode=='historical_sha':env['families'][family]['historical_sha256']='0'*64
     elif mode=='current_sha':env['families'][family]['changed_source_bindings'][path]='0'*64
     elif mode=='extra_source':env['families'][family]['changed_source_bindings']['unapproved.ts']='0'*64
     elif mode=='missing_family':env['families'].pop(family)
     elif mode=='status':env['activation_status']='PASS'
     elif mode=='bool_writes':env['operating_writes']=False
     else:s['current_aux_source_rebounds_20261113']=None
     with self.assertRaises(ValueError):c.select_aux_current_rebound(s,family,hist)
 def test_current_byte_and_other_source_forgery_are_rejected(self):
  spec=self.fixture();n=spec['backend_platform_contract']['native_seed_candidate_extension'];names={x['path'] for k in ('source_bindings','tests') for x in n[k]}
  for target in ('scripts/run_edge_tests.py','scripts/check_edge_contract.py'):
   with self.subTest(path=target):self.assertTrue(c.native_seed_candidate_errors(names,lambda p:b'forged' if p==target else (ROOT/p).read_bytes(),spec))
  p='supabase/functions/_shared/jungsi/infrastructure/runtime_composition.ts'
  for x in spec['workflow']['documentation_sync']['code_index']['edge_sources']['files']:
   if x['path']==p:x['source_sha256']='0'*64
  spec['edge_harness']['files'][p]['declarations']['source_sha256']='0'*64
  self.assertIn('DEV-010 runtime assembly source binding drift: composition',c.validate_live_execution(spec))
 def test_no_sibling_preserves_original_behavior(self):
  s=self.fixture();s.pop('current_aux_source_rebounds_20261113');a=s['supabase_deployment_contract']['live_execution']['runtime_assembly'];n=s['backend_platform_contract']['native_seed_candidate_extension']
  self.assertIs(c.select_aux_current_rebound(s,'dev010_runtime_assembly',a),a);self.assertIs(c.select_aux_current_rebound(s,'native_seed',n),n)
