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
        self.assertEqual((legacy['contract_operation_count'],legacy['legacy_scope_operation_count'],legacy['registered_operation_count']),(28,22,22))
        self.assertEqual((extension['contract_operation_count'],extension['registered_operation_count']),(3,3))
        prior=set(legacy['registered_operation_ids'])|set(extension['registered_operation_ids'])
        self.assertEqual(len(prior),25)
        read=result['read_view_extension_source_registration']
        self.assertEqual(set(read['registered_operation_ids']),{'history.snapshot.head','history.snapshot.read','report.list-own'})
        self.assertFalse(prior&set(read['registered_operation_ids']))
        self.assertEqual(prior|set(read['registered_operation_ids']),{o['id']for o in self.source['operations']})
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


"""Read-only extension isolation and negative trust cases; invented bindings only."""
from copy import deepcopy
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from check_project_consistency import (  # noqa: E402
    LEGACY_API_IDS, SCORE_POLICY_ROUTES, READ_VIEW_EXTENSION_ROUTES,
    READ_VIEW_RUNTIME_PATHS, registered_read_view_ids,
    validate_read_view_extension, validate_score_input_policy, legacy_policy_fixture_inputs,
)
from run_edge_tests import read_view_registration, operation_registration  # noqa: E402
from check_edge_contract import EdgeFailure  # noqa: E402


def candidate():
    """A source registration fixture, never a runtime implementation or approval."""
    spec = json.loads((ROOT / 'docs/current/service_spec.json').read_text(encoding='utf-8'))
    spec.pop('read_view_extension_contract', None)
    spec['operations'] = [r for r in spec['operations'] if r['id'] not in READ_VIEW_EXTENSION_ROUTES]
    files = spec['edge_harness']['files']
    for p in list(files):
        if p.startswith('tests/edge/test_') and p not in spec['edge_harness']['tests']:
            files.pop(p)
    service = 'supabase/functions/_shared/jungsi/application/synthetic_read_view.ts'
    test = 'tests/edge/test_synthetic_read_view_extension.ts'
    files[service] = dict(layer='application', declarations=dict(source_sha256='a' * 64))
    files[test] = dict(layer='verification', declarations=dict(source_sha256='b' * 64))
    for oid, (method, path, requirement) in READ_VIEW_EXTENSION_ROUTES.items():
        spec['operations'].append(dict(id=oid, method=method, path=path,
            member_tiers=['standard', 'paid'], report_owner=False, confirmed_score_profile=False,
            requirements=[requirement, 'REQ-24', 'REQ-25', 'REQ-26']))
    bindings = {oid: dict(path=service, source_sha256='a' * 64, symbol='SyntheticReadView.execute')
                for oid in READ_VIEW_EXTENSION_ROUTES}
    runtime = {p: files[p]['declarations']['source_sha256'] for p in READ_VIEW_RUNTIME_PATHS}
    runtime[test] = 'b' * 64
    sources = {**runtime, service: 'a' * 64}
    spec['read_view_extension_contract'] = dict(
        format='jungsi.read-view-extension-contract/v1', status='SOURCE_REGISTERED_NOT_ACTIVATED',
        operation_ids=list(READ_VIEW_EXTENSION_ROUTES), operation_count=3, source_operation_count=28,
        legacy_operation_ids=sorted(LEGACY_API_IDS), score_policy_operation_ids=sorted(SCORE_POLICY_ROUTES),
        activation_status='NOT_RUN', native_acceptance='NOT_VERIFIED_BY_SOURCE_SUITE',
        REQ27_activation_unchanged=True, new_API_writer=False,
        implementation_bindings=bindings, runtime_test_bindings=runtime,
        verification=dict(coverage='READ_VIEW_EXTENSION_SYNTHETIC', baseline_foundation_count=656,
            test_paths=[test], test_count=2,
            source_bindings=[dict(path=p, sha256=h) for p, h in sorted(sources.items())]))
    # REQ-27 binds the current complete declarations, while its frozen baseline remains intact.
    spec['score_input_policy_contract']['current_source_bindings'] = {
        p: r['declarations']['source_sha256'] for p, r in files.items()}
    return spec


class ReadViewExtensionContractTests(unittest.TestCase):
    def registry(self):
        registry=json.loads((ROOT/'src/jungsi_touch/application/public_response_schemas.json').read_text(encoding='utf-8'))
        registry['operations']=[row for row in registry['operations']if row['id']not in READ_VIEW_EXTENSION_ROUTES]
        registry['schemas']['synthetic_read3_only']={'type':'string','nullable':False}
        for oid in READ_VIEW_EXTENSION_ROUTES:
            registry['operations'].append(dict(id=oid,roots={'standard':{'ref':'synthetic_read3_only','nullable':False},'paid':{'ref':'synthetic_read3_only','nullable':False}}))
        return registry

    def test_legacy_fixture_keeps25_and_new_registry_stays28_unchanged(self):
        spec=candidate();registry=self.registry();original=deepcopy(registry)
        operations,filtered=legacy_policy_fixture_inputs(spec,registry)
        self.assertEqual(len(operations),25)
        self.assertEqual({o['id']for o in operations},LEGACY_API_IDS|set(SCORE_POLICY_ROUTES))
        self.assertEqual(len(filtered['operations']),25)
        self.assertNotIn('synthetic_read3_only',filtered['schemas'])
        self.assertIn('public_error_code',filtered['schemas'])
        self.assertEqual(registry,original)
        self.assertEqual(len(spec['operations']),28)

    def test_legacy_fixture_closure_preserves_shared_and_rejects_dangling_new_refs(self):
        spec=candidate();registry=self.registry()
        registry['schemas']['synthetic_shared']={'type':'string','nullable':False}
        registry['schemas']['identifier']={'ref':'synthetic_shared','nullable':False}
        _,filtered=legacy_policy_fixture_inputs(spec,registry)
        self.assertIn('synthetic_shared',filtered['schemas'])
        registry['schemas']['synthetic_read3_only']={'ref':'synthetic_missing','nullable':False}
        with self.assertRaisesRegex(ValueError,'dangling reference'):
            legacy_policy_fixture_inputs(spec,registry)

    def test_schema_fixture_cannot_hide_duplicate_extra_or_missing_operations(self):
        for mode in ('duplicate','extra','missing'):
            registry=self.registry()
            if mode=='duplicate':registry['operations'][-1]=deepcopy(registry['operations'][-2])
            elif mode=='extra':registry['operations'].append(dict(id='unregistered.read',roots={}))
            else:registry['operations'].pop(0)
            with self.assertRaisesRegex(ValueError,'coverage drift'):
                legacy_policy_fixture_inputs(candidate(),registry)

    def test_old_scope_absence_is_not_an_implicit_extension(self):
        spec = candidate()
        spec.pop('read_view_extension_contract')
        self.assertTrue(validate_score_input_policy(spec))
        self.assertEqual(registered_read_view_ids(spec), set())

    def test_exact_three_are_separate_and_never_operating_acceptance(self):
        spec = candidate()
        self.assertEqual(validate_read_view_extension(spec), [])
        self.assertEqual(validate_score_input_policy(spec), [])
        result = operation_registration(spec)
        self.assertEqual(result['source_registration']['contract_operation_count'], 28)
        self.assertEqual(result['source_registration']['legacy_scope_operation_count'], 22)
        self.assertEqual(result['policy_extension_source_registration']['contract_operation_count'], 3)
        extra = result['read_view_extension_source_registration']
        self.assertEqual(extra['registered_operation_count'], 3)
        self.assertEqual(extra['activation_status'], 'NOT_RUN')
        self.assertEqual(extra['native_acceptance'], 'NOT_VERIFIED_BY_SOURCE_SUITE')

    def test_no_legacy_or_policy_operation_can_be_removed(self):
        for oid in ('history.search', 'report.sample.read'):
            spec = candidate()
            spec['operations'] = [r for r in spec['operations'] if r['id'] != oid]
            self.assertTrue(validate_score_input_policy(spec), oid)

    def test_additional_operation_or_alias_is_not_accepted(self):
        spec = candidate()
        row = deepcopy(spec['operations'][-1])
        row.update(id='report.list-anyone', path='/api/v1/reports/all')
        spec['operations'].append(row)
        self.assertTrue(validate_read_view_extension(spec))
        spec = candidate()
        spec['operations'][-1]['aliases'] = ['/api/v1/reports/all']
        self.assertTrue(validate_read_view_extension(spec))

    def test_duplicate_id_cannot_hide_a_missing_operation(self):
        spec = candidate()
        spec['operations'][-1] = deepcopy(spec['operations'][-2])
        self.assertTrue(validate_read_view_extension(spec))

    def test_writer_paid_only_or_ownership_shortcut_is_rejected(self):
        for mutation in ('method', 'tiers', 'owner', 'confirmed', 'requirements'):
            spec = candidate()
            row = spec['operations'][-1]
            if mutation == 'method': row['method'] = 'POST'
            elif mutation == 'tiers': row['member_tiers'] = ['paid']
            elif mutation == 'owner': row['report_owner'] = True
            elif mutation == 'confirmed': row['confirmed_score_profile'] = True
            else: row['requirements'].remove('REQ-24')
            self.assertTrue(validate_read_view_extension(spec), mutation)

    def test_source_hash_and_application_layer_must_match(self):
        for mutation in ('hash', 'path', 'layer', 'symbol'):
            spec = candidate()
            b = spec['read_view_extension_contract']['implementation_bindings']['report.list-own']
            if mutation == 'hash': b['source_sha256'] = '0' * 64
            elif mutation == 'path': b['path'] = 'tests/edge/test_synthetic_read_view_extension.ts'
            elif mutation == 'layer': spec['edge_harness']['files'][b['path']]['layer'] = 'data_infrastructure'
            else: b['symbol'] = ''
            self.assertTrue(validate_read_view_extension(spec), mutation)

    def test_runtime_and_tests_cannot_be_unbound_or_double_counted(self):
        for mutation in ('missing', 'runtime', 'overlap', 'stray'):
            spec = candidate()
            c = spec['read_view_extension_contract']
            if mutation == 'missing': c['verification']['test_paths'] = []
            elif mutation == 'runtime': c['runtime_test_bindings'].pop(next(iter(READ_VIEW_RUNTIME_PATHS)))
            elif mutation == 'overlap': spec['edge_harness']['tests'].extend(c['verification']['test_paths'])
            else: spec['edge_harness']['files']['tests/edge/test_unexecuted.ts'] = dict(layer='verification', declarations=dict(source_sha256='c' * 64))
            self.assertTrue(validate_read_view_extension(spec), mutation)

    def test_bool_count_and_false_operating_promotion_are_rejected(self):
        for mutation in ('count', 'baseline_type', 'native', 'activate', 'writer', 'req27'):
            spec = candidate()
            c = spec['read_view_extension_contract']
            if mutation == 'count': c['verification']['test_count'] = True
            elif mutation == 'baseline_type': c['verification']['baseline_foundation_count'] = 656.0
            elif mutation == 'native': c['native_acceptance'] = 'PASS'
            elif mutation == 'activate': c['activation_status'] = 'PASS'
            elif mutation == 'writer': c['new_API_writer'] = True
            else: c['REQ27_activation_unchanged'] = False
            self.assertTrue(validate_read_view_extension(spec), mutation)

    def test_actual_retained_snapshot_must_match_declared_sources(self):
        spec = candidate()
        c = spec['read_view_extension_contract']
        before = {b['path']: b['sha256'] for b in c['verification']['source_bindings']}
        self.assertEqual(read_view_registration(spec, before), c['verification'])
        before[next(iter(before))] = '0' * 64
        with self.assertRaisesRegex(EdgeFailure, 'snapshot_binding_invalid'):
            read_view_registration(spec, before)

    def test_unregistered_separate_suite_cannot_be_silently_skipped(self):
        spec = candidate()
        spec.pop('read_view_extension_contract')
        self.assertTrue(validate_read_view_extension(spec))
        with self.assertRaisesRegex(EdgeFailure, 'registration_invalid'):
            read_view_registration(spec, {})
