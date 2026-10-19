"""Synthetic negative cases for shared Edge gates. No Deno install or file cleanup."""
import copy,json,sys,unittest,uuid
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
import check_edge_contract as edge
import run_edge_tests as runner
class EdgeGateTests(unittest.TestCase):
    def root(self):return Path(__file__).resolve().parents[1]
    def graph(self,target="app.ts",src_layer="application",dst_layer="application",kind="code"):
        root=self.root()
        module=dict(kind="esm",mediaType="TypeScript",specifier=(root/"source.ts").as_uri(),
            dependencies=[dict(specifier="@alias",**{kind:dict(specifier=(root/target).as_uri())})])
        raw=dict(version=1,roots=[module["specifier"]],modules=[module],redirects={},npmPackages={})
        return root,raw,{"source.ts",target},{"source.ts":src_layer,target:dst_layer}
    def reject(self,text):
        with self.assertRaises(edge.EdgeFailure):edge.dynamic_imports(text)
    def test_static_dynamic_literal(self):self.assertEqual(edge.dynamic_imports('import("./a.ts")'),["./a.ts"])
    def test_computed_dynamic(self):self.reject('import(path)')
    def test_concatenated_dynamic(self):self.reject('import("./"+name)')
    def test_dynamic_template_literal(self):self.reject('import('+chr(96)+'./a.ts'+chr(96)+')')
    def test_dynamic_in_template_expression(self):self.reject(chr(96)+"x"+"$"+"{import(path)}"+chr(96))
    def test_escaped_identifier(self):self.reject('\\u0069mport(path)')
    def test_comment_does_not_create_dependency(self):self.assertEqual(edge.dynamic_imports('/*import(path)*/ //import(path)\nexport const x=1;'),[])
    def test_string_does_not_create_dependency(self):self.assertEqual(edge.dynamic_imports('const x="import(path)";'),[])
    def test_regex_does_not_create_dependency(self):self.assertEqual(edge.dynamic_imports('const r=/import(path)/;'),[])
    def test_nested_template_expression(self):self.reject(chr(96)+"$"+"{f({x:import(name)})}"+chr(96))
    def test_path_traversal(self):
        with self.assertRaises(edge.EdgeFailure):edge.safe_path("scripts/../data/a.ts")
    def test_absolute_path(self):
        with self.assertRaises(edge.EdgeFailure):edge.safe_path("/outside/a.ts")
    def test_windows_path(self):
        with self.assertRaises(edge.EdgeFailure):edge.safe_path("C:/outside/a.ts")
    def test_graph_local_alias(self):
        root,raw,names,layers=self.graph();g,seen=edge.normalize_graph(raw,root,names,layers)
        self.assertEqual(g["source.ts"][0]["targets"],[dict(kind="code",path="app.ts")])
    def test_graph_type_only_is_checked(self):
        root,raw,names,layers=self.graph("infra.ts",dst_layer="data_infrastructure",kind="type")
        with self.assertRaisesRegex(edge.EdgeFailure,"layer_dependency"):edge.normalize_graph(raw,root,names,layers)
    def test_graph_runtime_layer_is_checked(self):
        root,raw,names,layers=self.graph("infra.ts",dst_layer="data_infrastructure")
        with self.assertRaisesRegex(edge.EdgeFailure,"layer_dependency"):edge.normalize_graph(raw,root,names,layers)
    def test_graph_remote_denied(self):
        root,raw,names,layers=self.graph();raw["modules"][0]["dependencies"][0]["code"]["specifier"]="https://invalid.example/a.ts"
        with self.assertRaises(edge.EdgeFailure):edge.normalize_graph(raw,root,names,layers)
    def test_graph_npm_denied(self):
        root,raw,names,layers=self.graph();raw["npmPackages"]={"package":"synthetic"}
        with self.assertRaises(edge.EdgeFailure):edge.normalize_graph(raw,root,names,layers)
    def test_graph_outside_snapshot(self):
        root,raw,names,layers=self.graph();raw["modules"][0]["dependencies"][0]["code"]["specifier"]=(root.parent/"outside.ts").as_uri()
        with self.assertRaises(edge.EdgeFailure):edge.normalize_graph(raw,root,names,layers)
    def test_graph_missing_resolution(self):
        root,raw,names,layers=self.graph();raw["modules"][0]["dependencies"][0].pop("code")
        with self.assertRaises(edge.EdgeFailure):edge.normalize_graph(raw,root,names,layers)
    def test_graph_bad_schema(self):
        root,raw,names,layers=self.graph();raw["version"]=2
        with self.assertRaises(edge.EdgeFailure):edge.normalize_graph(raw,root,names,layers)
    def test_graph_unregistered_module(self):
        root,raw,names,layers=self.graph();names.remove("app.ts")
        with self.assertRaises(edge.EdgeFailure):edge.normalize_graph(raw,root,names,layers)
    def xml(self,body,count=1):
        with patch.object(Path,"is_file",return_value=True),patch.object(Path,"read_bytes",return_value=body.encode()):
            return runner.parse_junit(Path("synthetic.xml"),count)
    def test_test_report_complete(self):self.assertEqual(self.xml('<testsuite tests="1"><testcase name="x"/></testsuite>')["tests_run"],1)
    def test_test_report_missing_case(self):
        with self.assertRaises(edge.EdgeFailure):self.xml('<testsuite/>')
    def test_test_report_failure(self):
        with self.assertRaises(edge.EdgeFailure):self.xml('<testsuite><testcase><failure/></testcase></testsuite>')
    def test_test_report_skip(self):
        with self.assertRaises(edge.EdgeFailure):self.xml('<testsuite><testcase><skipped/></testcase></testsuite>')
    def oracle(self):return dict(successful=True,case_count=993,mismatch_count=0,deno_exit_code=0,cases_sha256="synthetic",oracle_references_match_basis=True)
    def test_oracle_count_drift(self):
        r=self.oracle();r["case_count"]=992
        with self.assertRaises(edge.EdgeFailure):runner.require_oracle(r,993,"synthetic")
    def test_oracle_case_hash_drift(self):
        with self.assertRaises(edge.EdgeFailure):runner.require_oracle(self.oracle(),993,"different")
    def test_oracle_nonzero_mismatch(self):
        r=self.oracle();r["mismatch_count"]=1
        with self.assertRaises(edge.EdgeFailure):runner.require_oracle(r,993,"synthetic")
    def test_missing_deno_fails_without_running(self):
        with patch.object(edge,"command") as run:
            with self.assertRaisesRegex(edge.EdgeFailure,"deno_unavailable"):edge.runtime(None,{},self.root(),self.root())
            run.assert_not_called()
    def test_incompatible_deno_fails(self):
        with patch.object(edge,"command",return_value=b"deno 2.9.6\nv8 15.0\ntypescript 6.0\n"):
            with self.assertRaisesRegex(edge.EdgeFailure,"version_incompatible"):edge.runtime(sys.executable,{"runtime":{"deno":"2.9.7"}},self.root(),self.root())
    def test_snapshot_hash_mismatch(self):
        with self.assertRaisesRegex(edge.EdgeFailure,"manifest_mismatch"):
            edge.verify_manifest(self.root(),dict(format="jungsi.retained-snapshot/v1",files={"scripts/check_edge_contract.py":"0"*64}))
    def test_symlink_is_rejected(self):
        with patch.object(Path,"is_symlink",return_value=True):
            with self.assertRaises(edge.EdgeFailure):edge.hashes(self.root(),["scripts/check_edge_contract.py"])
class SourceRegistrationCases(unittest.TestCase):
    def spec(self,count):
        path='supabase/functions/_shared/jungsi/application/synthetic_dispatch.ts'
        sha='a'*64
        ids=['synthetic-operation-'+str(i)for i in range(22)]
        states={v:dict(code='PORTED'if i<count else 'NOT_PORTED',
            binding=dict(path=path,source_sha256=sha)if i<count else None,
            native='PASS',deployment='PASS')for i,v in enumerate(ids)}
        return dict(operations=[dict(id=v)for v in ids],
            supabase_deployment_contract=dict(live_execution=dict(status='VERIFIED',operations=states)),
            edge_harness=dict(files={path:dict(declarations=dict(source_sha256=sha))}))
    def test_one_missing_operation_stays_partial(self):
        result=runner.operation_registration(self.spec(21))
        self.assertEqual(result['all_22'],'PARTIAL_CODE_REGISTERED')
        self.assertEqual(result['source_registration']['registered_operation_count'],21)
    def test_all_source_bindings_never_certify_native_or_production(self):
        result=runner.operation_registration(self.spec(22))
        self.assertEqual(result['all_22'],'CODE_REGISTERED')
        self.assertEqual(result['native_acceptance'],'NOT_VERIFIED_BY_SOURCE_SUITE')
        self.assertNotIn('production_ready',result)
    def test_future_unregistered_source_is_rejected(self):
        spec=self.spec(1)
        spec['supabase_deployment_contract']['live_execution']['operations']['synthetic-operation-0']['binding']['path']='supabase/functions/future/index.ts'
        with self.assertRaisesRegex(edge.EdgeFailure,'binding_invalid'):
            runner.operation_registration(spec)
    def test_test_fixture_cannot_be_an_implementation_binding(self):
        spec=self.spec(1)
        path='tests/edge/synthetic.ts'
        spec['edge_harness']['files'][path]=dict(declarations=dict(source_sha256='a'*64))
        spec['supabase_deployment_contract']['live_execution']['operations']['synthetic-operation-0']['binding']['path']=path
        with self.assertRaisesRegex(edge.EdgeFailure,'binding_invalid'):
            runner.operation_registration(spec)
    def test_missing_operation_cannot_be_hidden_by_registered_count(self):
        spec=self.spec(22)
        spec['supabase_deployment_contract']['live_execution']['operations'].pop('synthetic-operation-21')
        with self.assertRaisesRegex(edge.EdgeFailure,'coverage_invalid'):
            runner.operation_registration(spec)

class PolicyExtensionRegistrationCases(unittest.TestCase):
    def setUp(self):
        self.source=json.loads((Path(__file__).resolve().parents[1]/'docs/current/service_spec.json').read_text(encoding='utf-8'))
    def rejects(self,spec):
        with self.assertRaisesRegex(edge.EdgeFailure,'operation_registration_'):
            runner.operation_registration(spec)
    def test_current25_has_distinct_legacy22_and_extension3_source_only(self):
        result=runner.operation_registration(self.source)
        self.assertEqual(result['all_22'],'CODE_REGISTERED')
        legacy=result['source_registration'];extension=result['policy_extension_source_registration']
        self.assertEqual((legacy['contract_operation_count'],legacy['legacy_scope_operation_count'],legacy['registered_operation_count']),(25,22,22))
        self.assertEqual((extension['contract_operation_count'],extension['registered_operation_count']),(3,3))
        self.assertEqual(set(legacy['registered_operation_ids'])|set(extension['registered_operation_ids']),{o['id']for o in self.source['operations']})
        self.assertFalse(set(legacy['registered_operation_ids'])&set(extension['registered_operation_ids']))
        self.assertEqual(extension['activation_status'],'NOT_RUN')
        self.assertEqual(extension['native_acceptance'],'NOT_VERIFIED_BY_SOURCE_SUITE')
        self.assertNotIn('all_25',result);self.assertNotIn('production_ready',result)
    def test_current25_cannot_use_legacy22_without_req27(self):
        wrong=copy.deepcopy(self.source);wrong.pop('score_input_policy_contract');self.rejects(wrong)
    def test_legacy_missing_duplicate_or_unregistered_state_is_rejected(self):
        for mode in ('state_missing','state_extra','operation_missing','legacy_missing','legacy_duplicate'):
            with self.subTest(mode=mode):
                wrong=copy.deepcopy(self.source);c=wrong['score_input_policy_contract'];states=wrong['supabase_deployment_contract']['live_execution']['operations']
                oid=c['legacy_operation_ids'][0]
                if mode=='state_missing':states.pop(oid)
                elif mode=='state_extra':states['unregistered.operation']=copy.deepcopy(states[oid])
                elif mode=='operation_missing':wrong['operations']=[o for o in wrong['operations']if o['id']!=oid]
                elif mode=='legacy_missing':c['legacy_operation_ids'].remove(oid)
                else:c['legacy_operation_ids'].append(oid)
                self.rejects(wrong)
    def test_extension_missing_duplicate_or_unregistered_operation_is_rejected(self):
        for mode in ('operation_missing','operation_duplicate','extension_missing','extension_duplicate','extension_extra'):
            with self.subTest(mode=mode):
                wrong=copy.deepcopy(self.source);c=wrong['score_input_policy_contract'];oid=c['extension_operation_ids'][0]
                if mode=='operation_missing':wrong['operations']=[o for o in wrong['operations']if o['id']!=oid]
                elif mode=='operation_duplicate':wrong['operations'].append(copy.deepcopy(next(o for o in wrong['operations']if o['id']==oid)))
                elif mode=='extension_missing':c['extension_operation_ids'].remove(oid)
                elif mode=='extension_duplicate':c['extension_operation_ids'].append(oid)
                else:c['extension_operation_ids'].append('unregistered.operation')
                self.rejects(wrong)
    def test_extension_implementation_and_runtime_test_bindings_are_exact(self):
        for mode in ('missing','extra','hash','test_path','symbol','evidence_missing','evidence_hash','evidence_extra'):
            with self.subTest(mode=mode):
                wrong=copy.deepcopy(self.source);c=wrong['score_input_policy_contract'];bindings=c['extension_implementation_bindings'];oid=c['extension_operation_ids'][0]
                if mode=='missing':bindings.pop(oid)
                elif mode=='extra':bindings['unregistered.operation']=copy.deepcopy(bindings[oid])
                elif mode=='hash':bindings[oid]['source_sha256']='0'*64
                elif mode=='test_path':bindings[oid]['path']='tests/edge/test_score_input_policy.ts'
                elif mode=='symbol':bindings[oid]['symbol']='Unregistered.execute'
                elif mode=='evidence_missing':c['extension_runtime_test_bindings'].pop(next(iter(c['extension_runtime_test_bindings'])))
                elif mode=='evidence_hash':c['extension_runtime_test_bindings'][next(iter(c['extension_runtime_test_bindings']))]='0'*64
                else:c['extension_runtime_test_bindings']['tests/edge/unregistered.ts']='0'*64
                self.rejects(wrong)
    def test_pinned_legacy_hash_or_current_candidate_cannot_be_forged(self):
        for mode in ('prior','current','live_binding'):
            with self.subTest(mode=mode):
                wrong=copy.deepcopy(self.source);c=wrong['score_input_policy_contract']
                if mode=='prior':c['prior_source_bindings'][next(iter(c['prior_source_bindings']))]='0'*64
                elif mode=='current':c['current_source_bindings'][next(iter(c['current_source_bindings']))]='0'*64
                else:wrong['supabase_deployment_contract']['live_execution']['operations']['overall.analyze']['binding']['source_sha256']='0'*64
                self.rejects(wrong)

if __name__=="__main__":unittest.main()

class OwnerReviewRegistrationCases(unittest.TestCase):
    def current(self):
        spec=json.loads((Path(__file__).resolve().parents[1]/'docs/current/service_spec.json').read_bytes())
        bindings=spec['owner_current_review_contract']['verification']['source_bindings']
        return spec,{b['path']:b['sha256']for b in bindings}
    def test_owner_suite_is_separate_and_bound_to_current_source(self):
        s,b=self.current();self.assertEqual(runner.owner_review_registration(s,b)['test_count'],36)
        self.assertEqual(s['edge_harness']['unit_count'],656)
    def test_owner_source_cannot_silently_drop_its_contract(self):
        s,b=self.current();s.pop('owner_current_review_contract')
        with self.assertRaisesRegex(edge.EdgeFailure,'owner_review_contract_missing'):runner.owner_review_registration(s,b)
    def test_owner_suite_rejects_hash_or_count_drift(self):
        for mode in ('hash','count'):
            s,b=self.current();v=s['owner_current_review_contract']['verification']
            if mode=='hash':v['source_bindings'][0]['sha256']='f'*64
            else:v['test_count']=35
            with self.assertRaisesRegex(edge.EdgeFailure,'owner_review_'):runner.owner_review_registration(s,b)
    def test_original_fixtures_without_owner_source_keep_their_scope(self):
        self.assertIsNone(runner.owner_review_registration({},{}))
