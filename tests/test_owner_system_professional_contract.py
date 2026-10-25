"""Regression checks for delegated system paths and the separate tenant contract.

These are source-policy checks; no live user, DB, JWT or institution is simulated as accepted.
"""
from copy import deepcopy
import json
from pathlib import Path
import sys
import unittest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import check_branch_policy as policy
from check_project_consistency import validate_professional_service_contract


class OwnerSystemBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.spec=json.loads((ROOT/'docs/current/service_spec.json').read_bytes())
        self.branch=self.spec['workflow']['presentation_work_branch']
        self.registry=self.spec['workflow']['branch_governance']['service_delegation_policy']

    def test_owner_can_change_auth_and_runtime_but_cannot_write_SQL_or_real_repository(self):
        self.assertEqual(policy.validate_delegated_service_paths(self.branch,self.registry['shared_system_paths'],self.spec),[])
        for path in ('database/migrations/pro.sql','supabase/functions/_shared/jungsi/infrastructure/score_input_postgres.ts',
                     'supabase/functions/_shared/jungsi/infrastructure/native_data_provider.ts',
                     'supabase/functions/_shared/jungsi/application/university_scoring.ts'):
            with self.subTest(path=path):self.assertTrue(policy.validate_delegated_service_paths(self.branch,[path],self.spec))

    def test_shared_path_registry_cannot_disguise_a_data_or_engine_exception(self):
        for field,path in (('shared_system_paths','database/pro.sql'),
                           ('shared_system_paths','supabase/functions/_shared/jungsi/infrastructure/score_input_postgres.ts'),
                           ('shared_http_paths','supabase/functions/_shared/jungsi/infrastructure/native_data_provider.ts')):
            s=deepcopy(self.spec);s['workflow']['branch_governance']['service_delegation_policy'][field].append(path)
            with self.subTest(field=field,path=path):self.assertTrue(policy.validate_service_delegation(s))

    def test_feature_must_merge_trusted_owner_delegation_instead_of_self_granting(self):
        s=deepcopy(self.spec);s['workflow']['branch_governance']['service_delegation_policy']['shared_system_paths']=[]
        self.assertTrue(policy.delegation_policy_edit_errors(self.branch,self.spec,s))
        self.assertEqual(policy.delegation_policy_edit_errors('develop',self.spec,s),[])

    def test_professional_HTTP_runtime_are_shared_and_DB_authority_crypto_remain_reserved(self):
        prefix='supabase/functions/_shared/jungsi/infrastructure/'
        for field,path in (('shared_http_paths','professional_http.ts'),('shared_system_paths','professional_runtime.ts')):
            self.assertIn(prefix+path,self.registry[field])
            self.assertEqual(policy.validate_delegated_service_paths(self.branch,[prefix+path],self.spec),[])
        for path in ('professional_authority.ts','professional_crypto.ts','professional_postgres.ts',
                     'professional_usage_postgres.ts','professional_usage_admission.ts'):
            self.assertTrue(policy.validate_delegated_service_paths(self.branch,[prefix+path],self.spec))
        self.assertTrue(policy.validate_delegated_service_paths(self.branch,['database/migrations/007_professional_platform.prepared.sql'],self.spec))

    def test_student_contract_stays_separate_from_registered_personal_API(self):
        self.assertEqual(validate_professional_service_contract(self.spec),[])
        current={(o['method'],o['path'])for o in self.spec['operations']}
        self.assertTrue(all((o['method'],o['path'])not in current for o in self.spec['professional_service_contract']['candidate_operations']))
        s=deepcopy(self.spec);s['professional_service_contract']['runtime_activation']='PASS'
        self.assertTrue(validate_professional_service_contract(s))

    def test_teacher_personal_ownership_and_org_admin_correction_are_rejected(self):
        for section,key,value in (('ownership','record_owner','teacher'),
                                  ('ownership','personal_report_mixing_allowed',True),
                                  ('score_input','org_admin_self_correction_allowed',True),
                                  ('identity','client_org_role_or_student_claim_trusted',True)):
            s=deepcopy(self.spec);s['professional_service_contract'][section][key]=value
            with self.subTest(section=section,key=key):self.assertTrue(validate_professional_service_contract(s))

    def test_twenty_student_workload_cannot_become_unlimited_or_admin_exempt(self):
        for key in ('administrator_exemption_substitute','unlimited_or_null_fallback','capacity_twenty_means_twenty_parallel_jobs'):
            s=deepcopy(self.spec);s['professional_service_contract']['budget'][key]=True
            with self.subTest(key=key):self.assertTrue(validate_professional_service_contract(s))



class ProfessionalSourceRegistrationTests(unittest.TestCase):
    def fixture(self):
        import hashlib
        from check_project_consistency import (PROFESSIONAL_ENTRY, PROFESSIONAL_APP,
            PROFESSIONAL_INFRA, PROFESSIONAL_TEST, PROFESSIONAL_MIGRATION, PROFESSIONAL_SOURCE_STATUS,
            PROFESSIONAL_GENERATED, professional_source_path)
        s=json.loads((ROOT/'docs/current/service_spec.json').read_bytes())
        c=s['professional_service_contract'];c.pop('source_registration',None);c.pop('schema_application_evidence',None)
        s['implementation']=[r for r in s['implementation']if not professional_source_path(r['path'])]
        edge_index=s['workflow']['documentation_sync']['code_index']['edge_sources']['files']
        edge_index[:]=[r for r in edge_index if not professional_source_path(r['path'])]
        for path in list(s['edge_harness']['files']):
            if professional_source_path(path):s['edge_harness']['files'].pop(path)
        c['candidate_API_registration']='separate_source_registered_not_added_to_existing_operations'
        for operation in c['candidate_operations']:operation['runtime_registration']=PROFESSIONAL_SOURCE_STATUS
        app=PROFESSIONAL_APP+'service.ts';infra=PROFESSIONAL_INFRA+'postgres.ts'
        test=PROFESSIONAL_TEST+'api_test.ts';support=PROFESSIONAL_TEST+'support.ts'
        bodies={PROFESSIONAL_ENTRY:b'entry fixture',app:b'app fixture',infra:b'infra fixture',test:b'test fixture',support:b'support fixture',PROFESSIONAL_GENERATED:b'generated fixture',PROFESSIONAL_MIGRATION:b'SELECT 1; -- prepared fixture only'}
        hashes={p:hashlib.sha256(blob).hexdigest()for p,blob in bodies.items()}
        for path in (PROFESSIONAL_ENTRY,app,infra,test,support,PROFESSIONAL_GENERATED):
            layer='application'if path.startswith(PROFESSIONAL_APP)else('verification'if path.startswith(PROFESSIONAL_TEST)else'data_infrastructure')
            s['implementation'].append(dict(path=path,layer=layer,requirements=['REQ-31'],symbols=['execute']if path==app else[],status='synthetic_registry_fixture'))
            s['workflow']['documentation_sync']['code_index']['edge_sources']['files'].append(dict(path=path,source_sha256=hashes[path]))
            if path.startswith((PROFESSIONAL_APP,PROFESSIONAL_INFRA)):s['edge_harness']['files'][path]=dict(layer=layer,declarations=dict(source_sha256=hashes[path]))
        c['source_registration']=dict(format='jungsi.professional-source-registration/v1',status=PROFESSIONAL_SOURCE_STATUS,
            entrypoint=PROFESSIONAL_ENTRY,
            operation_bindings={o['id']:dict(path=app,source_sha256=hashes[app],symbol='execute')for o in c['candidate_operations']},
            source_bindings=[dict(path=p,sha256=hashes[p])for p in (PROFESSIONAL_ENTRY,app,infra,test,support,PROFESSIONAL_GENERATED)],
            migrations=[dict(path=PROFESSIONAL_MIGRATION,sha256=hashes[PROFESSIONAL_MIGRATION])],
            verification=dict(test_paths=[test],test_count=1,operation_test_names={o['id']:['synthetic registered routes']for o in c['candidate_operations']}),
            native_acceptance='NOT_VERIFIED_BY_SOURCE_SUITE',activation_status='NOT_RUN',operating_writes=0)
        c['DB_schema_application']='PREPARED_NOT_APPLIED'
        return s,hashes

    def test_bound_source_fixture_is_not_operating_acceptance(self):
        from check_project_consistency import validate_professional_source_registration
        s,hashes=self.fixture()
        self.assertEqual(validate_professional_service_contract(s),[])
        self.assertEqual(validate_professional_source_registration(s,hashes),[])
        self.assertFalse(s['professional_service_contract']['production_ready'])
        self.assertEqual(s['professional_service_contract']['runtime_activation'],'NOT_RUN')

    def test_unregistered_professional_family_cannot_be_silently_skipped(self):
        from check_project_consistency import validate_professional_source_registration, PROFESSIONAL_ENTRY
        s=json.loads((ROOT/'docs/current/service_spec.json').read_bytes())
        self.assertTrue(validate_professional_source_registration(s,{PROFESSIONAL_ENTRY:'a'*64}))

    def test_route_drop_relabel_and_method_change_are_rejected(self):
        for mode in ('drop','relabel','method'):
            s,_=self.fixture();operations=s['professional_service_contract']['candidate_operations']
            if mode=='drop':operations.pop()
            elif mode=='relabel':operations[0]['id']='pro.other'
            else:operations[0]['method']='POST'
            with self.subTest(mode=mode):self.assertTrue(validate_professional_service_contract(s))

    def test_missing_extra_source_or_changed_SQL_cannot_reuse_a_receipt(self):
        from check_project_consistency import validate_professional_source_registration, PROFESSIONAL_APP, PROFESSIONAL_MIGRATION, PROFESSIONAL_TEST
        for mode in ('missing','extra','support','sql','hash'):
            s,hashes=self.fixture()
            if mode=='missing':hashes.pop(next(iter(hashes)))
            elif mode=='extra':hashes[PROFESSIONAL_APP+'unregistered.ts']='a'*64
            elif mode=='support':hashes[PROFESSIONAL_TEST+'unregistered_support.ts']='a'*64
            elif mode=='sql':hashes[PROFESSIONAL_MIGRATION]='a'*64
            else:hashes[PROFESSIONAL_APP+'service.ts']='a'*64
            with self.subTest(mode=mode):self.assertTrue(validate_professional_source_registration(s,hashes))

    def test_operation_binding_cannot_point_to_SQL_infrastructure_or_an_unregistered_symbol(self):
        from check_project_consistency import validate_professional_source_registration, PROFESSIONAL_INFRA
        for mode in ('missing','path','symbol','hash','layer'):
            s,hashes=self.fixture();r=s['professional_service_contract']['source_registration'];key=next(iter(r['operation_bindings']));b=r['operation_bindings'][key]
            if mode=='missing':r['operation_bindings'].pop(key)
            elif mode=='path':b['path']=PROFESSIONAL_INFRA+'postgres.ts'
            elif mode=='symbol':b['symbol']='absent'
            elif mode=='hash':b['source_sha256']='0'*64
            else:next(i for i in s['implementation']if i['path']==b['path'])['layer']='data_infrastructure'
            with self.subTest(mode=mode):self.assertTrue(validate_professional_source_registration(s,hashes))

    def test_missing_overlapping_or_boolean_test_counts_are_rejected(self):
        from check_project_consistency import validate_professional_source_registration
        for mode in ('none','boolean','zero','overlap','name','coverage'):
            s,hashes=self.fixture();v=s['professional_service_contract']['source_registration']['verification']
            if mode=='none':v['test_paths']=[]
            elif mode=='boolean':v['test_count']=True
            elif mode=='zero':v['test_count']=0
            elif mode=='overlap':s['edge_harness']['tests']+=v['test_paths']
            elif mode=='name':v['operation_test_names'][next(iter(v['operation_test_names']))]=[]
            else:v['operation_test_names'].pop(next(iter(v['operation_test_names'])))
            with self.subTest(mode=mode):self.assertTrue(validate_professional_source_registration(s,hashes))

    def test_DB_application_requires_exact_migration_and_separate_actual_evidence(self):
        from check_project_consistency import validate_professional_source_registration
        for mode in ('absent','hash','boolean','records'):
            s,hashes=self.fixture();c=s['professional_service_contract'];r=c['source_registration']
            c['DB_schema_application']='APPLIED_ADDITIVE_SCHEMA_READBACK'
            c['schema_application_evidence']=dict(result='PASS_ACTUAL_ADDITIVE_SCHEMA_READBACK',migration_sha256=r['migrations'][0]['sha256'],receipt_sha256='a'*64,institution_records_created=0)
            if mode=='absent':c.pop('schema_application_evidence')
            elif mode=='hash':c['schema_application_evidence']['migration_sha256']='b'*64
            elif mode=='boolean':c['schema_application_evidence']['institution_records_created']=False
            else:c['schema_application_evidence']['institution_records_created']=1
            with self.subTest(mode=mode):self.assertTrue(validate_professional_source_registration(s,hashes))

    def test_source_registration_does_not_expand_runtime_or_claim_operating_writes(self):
        from check_project_consistency import validate_professional_source_registration
        for key,value in (('activation_status','PASS'),('operating_writes',1),('operating_writes',False),('native_acceptance','PASS')):
            s,hashes=self.fixture();s['professional_service_contract']['source_registration'][key]=value
            with self.subTest(key=key,value=value):self.assertTrue(validate_professional_source_registration(s,hashes))

    def test_registered_test_names_must_be_present_in_executed_junit(self):
        import xml.etree.ElementTree as ET
        from run_edge_tests import require_professional_operation_tests
        from check_edge_contract import EdgeFailure
        _,_=self.fixture()
        root=ET.fromstring('<testsuite><testcase name="ran"/></testsuite>')
        require_professional_operation_tests(root,{'pro.a':['ran']})
        with self.assertRaises(EdgeFailure):require_professional_operation_tests(root,{'pro.a':['did not run']})


class ProfessionalNativeEntrypointTests(unittest.TestCase):
    def fixture(self):
        from run_edge_tests import PROFESSIONAL_NATIVE_ENTRYPOINT as entry, PROFESSIONAL_NATIVE_SOURCES as sources, PROFESSIONAL_NATIVE_LOCK as lock
        from hashlib import sha256
        raw=(ROOT/lock).read_bytes()
        before={path:'a'*64 for path in (entry,*sources)};before[lock]=sha256(raw).hexdigest()
        uri=lambda path:(ROOT/path).as_uri()
        graph={'roots':[uri(entry)],'modules':[
            {'specifier':uri(entry),'kind':'esm','dependencies':[{'code':{'specifier':uri(sources[0])}}]},
            {'specifier':uri(sources[0]),'kind':'esm','dependencies':[{'code':{'specifier':uri(sources[1])}}]},
            {'specifier':uri(sources[1]),'kind':'esm','dependencies':[]},
            {'specifier':'npm:/postgres@3.4.5','kind':'npm','npmPackage':'postgres@3.4.5'},
            {'specifier':'node:buffer','kind':'node'}],
            'npmPackages':{'postgres@3.4.5':{'name':'postgres','version':'3.4.5','dependencies':[],'registryUrl':'https://registry.npmjs.org/'}}}
        return entry,raw,before,graph

    def test_native_shell_requires_existing_exact_lock_and_static_pool_closure(self):
        from run_edge_tests import professional_native_dependency_inputs,professional_native_graph
        entry,raw,before,graph=self.fixture()
        from run_edge_tests import PROFESSIONAL_NATIVE_LOCK
        from hashlib import sha256
        canonical=raw.replace(b'\r\n',b'\n')
        for source in (canonical,canonical.replace(b'\n',b'\r\n')):
            bindings={**before,PROFESSIONAL_NATIVE_LOCK:sha256(source).hexdigest()}
            with self.subTest(line_endings='CRLF'if b'\r'in source else'LF'):
                self.assertEqual(len(professional_native_dependency_inputs(entry,source,bindings)),4)
        self.assertTrue(professional_native_graph(graph,ROOT,before)['static_pool_and_bootstrap'])

    def test_native_lock_or_snapshot_binding_cannot_be_replaced(self):
        from run_edge_tests import professional_native_dependency_inputs,PROFESSIONAL_NATIVE_LOCK
        from check_edge_contract import EdgeFailure
        entry,raw,before,_=self.fixture()
        for lock_bytes,binding in ((raw+b' ',before),(raw,{**before,PROFESSIONAL_NATIVE_LOCK:'b'*64}),(raw,{})):
            with self.subTest(binding=binding):
                with self.assertRaises(EdgeFailure):professional_native_dependency_inputs(entry,lock_bytes,binding)
        with self.assertRaises(EdgeFailure):professional_native_dependency_inputs('another/index.ts',raw,before)

    def test_missing_or_dynamic_native_pool_cannot_hide_behind_core_check(self):
        from run_edge_tests import professional_native_graph
        from check_edge_contract import EdgeFailure
        _,_,before,graph=self.fixture()
        for mode in ('missing','dynamic'):
            candidate=deepcopy(graph)
            if mode=='missing':candidate['modules'].pop(1)
            else:candidate['modules'][0]['dependencies'][0]['isDynamic']=True
            with self.subTest(mode=mode):
                with self.assertRaises(EdgeFailure):professional_native_graph(candidate,ROOT,before)

    def test_native_graph_rejects_additional_or_substituted_npm_packages(self):
        from run_edge_tests import professional_native_graph
        from check_edge_contract import EdgeFailure
        _,_,before,graph=self.fixture()
        for mode in ('extra','version','registry','dependency'):
            candidate=deepcopy(graph);package=candidate['npmPackages']['postgres@3.4.5']
            if mode=='extra':candidate['npmPackages']['extra@1.0.0']={}
            elif mode=='version':package['version']='3.4.6'
            elif mode=='registry':package['registryUrl']='https://unapproved.invalid/'
            else:package['dependencies']=['extra@1.0.0']
            with self.subTest(mode=mode):
                with self.assertRaises(EdgeFailure):professional_native_graph(candidate,ROOT,before)

    def test_native_graph_rejects_unbound_local_or_remote_modules(self):
        from run_edge_tests import professional_native_graph
        from check_edge_contract import EdgeFailure
        _,_,before,graph=self.fixture()
        for url in ((ROOT/'unbound.ts').as_uri(),'https://unapproved.invalid/module.ts'):
            candidate=deepcopy(graph);candidate['modules'].append({'specifier':url,'kind':'esm'})
            with self.subTest(url=url):
                with self.assertRaises(EdgeFailure):professional_native_graph(candidate,ROOT,before)

    def test_native_graph_errors_and_wrong_roots_fail_closed(self):
        from run_edge_tests import professional_native_graph
        from check_edge_contract import EdgeFailure
        _,_,before,graph=self.fixture()
        for mode in ('error','root','malformed'):
            candidate=deepcopy(graph)
            if mode=='error':candidate['modules'][0]['error']='unresolved'
            elif mode=='root':candidate['roots']=[(ROOT/'another.ts').as_uri()]
            else:candidate['modules']=None
            with self.subTest(mode=mode):
                with self.assertRaises(EdgeFailure):professional_native_graph(candidate,ROOT,before)


class ProfessionalGuideTestRegistrationTests(unittest.TestCase):
    """합성 메타데이터·snapshot만 사용하며 실제 DB·Deno·운영 인수를 만들지 않는다."""
    def fixture(self):
        import hashlib
        import check_project_consistency as checker
        s,_=ProfessionalSourceRegistrationTests().fixture()
        test=checker.PROFESSIONAL_GUIDE_TEST;entry=checker.PROFESSIONAL_GUIDE_SUITE
        # 향후 develop에 이미 추가된 exact Guide 행도 합성 fixture 안에서만 분리한다.
        s['implementation']=[row for row in s['implementation']if row['path']!=test]
        blobs={test:b'export {}; // SYNTHETIC UNIT FIXTURE ONLY\n',
               entry:('import "../../../'+test+'";\n// SYNTHETIC UNIT FIXTURE ONLY\n').encode()}
        hashes={p:hashlib.sha256(raw).hexdigest()for p,raw in blobs.items()}
        for path in (test,entry):
            s['implementation'].append(dict(path=path,layer='verification',requirements=['REQ-31'],symbols=[],status='synthetic_unit_fixture'))
        s['edge_harness']['files'][test]=dict(layer='verification',declarations=dict(source_sha256=hashes[test]))
        s['workflow']['documentation_sync']['code_index']['edge_sources']['files'].append(
            dict(path=entry,layer='verification',requirements=['REQ-31'],source_sha256=hashes[entry]))
        r=s['professional_service_contract']['source_registration']
        r['source_bindings'].append(dict(path=entry,sha256=hashes[entry]));r['verification']['test_paths'].append(entry)
        r['verification']['test_count']+=57
        s['professional_service_contract']['counseling_tips']['yearly_rule_read']['verification']=dict(
            format='jungsi.professional-guide-verification/v1',coverage='PROFESSIONAL_GUIDE_REFERENCE_SYNTHETIC',
            test_paths=[test],suite_entry=entry,test_count=57,additive_guide_tests=57,baseline_foundation_count=656,
            retained_foundation_tests=656,source_bindings=[dict(path=p,sha256=h)for p,h in hashes.items()],
            native_acceptance='NOT_VERIFIED_BY_SOURCE_SUITE',activation_status='NOT_RUN',operating_writes=0)
        return s,blobs

    def verification(self,spec):
        return spec['professional_service_contract']['counseling_tips']['yearly_rule_read']['verification']

    def rejected(self,spec):
        import check_project_consistency as checker
        paths,errors=checker.professional_guide_test_registration(spec)
        self.assertEqual(paths,set());self.assertTrue(errors)
        self.assertTrue(checker.validate_read_view_extension(spec))

    def rebind_entry(self,spec,blobs,text):
        import hashlib
        import check_project_consistency as checker
        path=checker.PROFESSIONAL_GUIDE_SUITE;blobs[path]=text.encode('utf-8');digest=hashlib.sha256(blobs[path]).hexdigest()
        for row in self.verification(spec)['source_bindings']+spec['professional_service_contract']['source_registration']['source_bindings']:
            if row['path']==path:row['sha256']=digest
        for row in spec['workflow']['documentation_sync']['code_index']['edge_sources']['files']:
            if row['path']==path:row['source_sha256']=digest

    def test_absent_contract_keeps_legacy_classification(self):
        import check_project_consistency as checker
        baseline=json.loads((ROOT/'docs/current/service_spec.json').read_bytes())
        baseline['professional_service_contract']['counseling_tips']['yearly_rule_read'].pop('verification',None)
        baseline['edge_harness']['files'].pop(checker.PROFESSIONAL_GUIDE_TEST,None)
        self.assertEqual(checker.professional_guide_test_registration(baseline),(set(),[]))
        self.assertEqual(checker.validate_read_view_extension(baseline),[])
        spec,_=self.fixture();self.verification(spec).clear()
        del spec['professional_service_contract']['counseling_tips']['yearly_rule_read']['verification']
        self.assertEqual(checker.professional_guide_test_registration(spec),(set(),[]))
        self.assertIn('Read-view separate exact suite registration drift',checker.validate_read_view_extension(spec))

    def test_valid_exact_guide_is_separate_from_public28_pro21_and_foundation656(self):
        import check_project_consistency as checker
        spec,_=self.fixture()
        self.assertEqual(checker.professional_guide_test_registration(spec),({checker.PROFESSIONAL_GUIDE_TEST},[]))
        self.assertEqual(checker.validate_read_view_extension(spec),[])
        self.assertEqual(checker.validate_professional_source_registration(spec),[])
        self.assertEqual(len(spec['operations']),28+len(checker.registered_member_shortlist_ids(spec)))
        self.assertEqual(len(spec['professional_service_contract']['candidate_operations']),21)
        self.assertEqual(spec['edge_harness']['unit_count'],656)

    def test_malformed_contract_returns_error_and_no_exemption(self):
        for value in (None,[],False,'invalid'):
            with self.subTest(value=value):
                spec,_=self.fixture();spec['professional_service_contract']['counseling_tips']['yearly_rule_read']['verification']=value
                self.rejected(spec)

    def test_exact_shape_paths_and_entry_are_required(self):
        for field,value in [('format','other'),('coverage','READ_VIEW_EXTENSION_SYNTHETIC'),('test_paths',[]),
                            ('test_paths',['tests/edge/test_unregistered.ts']),('test_paths',['tests/edge/test_guide_rule_reference.ts']*2),
                            ('suite_entry','supabase/functions/_shared/professional_other_test.ts')]:
            with self.subTest(field=field,value=value):
                spec,_=self.fixture();self.verification(spec)[field]=value;self.rejected(spec)
        spec,_=self.fixture();del self.verification(spec)['source_bindings'];self.rejected(spec)
        spec,_=self.fixture();self.verification(spec)['unknown_permission']=True;self.rejected(spec)

    def test_native_integer_counts_reject_bool_float_and_text(self):
        for field in ('test_count','additive_guide_tests','baseline_foundation_count','operating_writes'):
            for value in (False,True,57.0,'57'):
                with self.subTest(field=field,value=value):
                    spec,_=self.fixture();self.verification(spec)[field]=value;self.rejected(spec)
        for value in (0,-1):
            spec,_=self.fixture();self.verification(spec)['test_count']=value;self.verification(spec)['additive_guide_tests']=value;self.rejected(spec)

    def test_future_additive_count_does_not_require_fixed57_or131(self):
        import check_project_consistency as checker
        spec,_=self.fixture();self.verification(spec)['test_count']=58;self.verification(spec)['additive_guide_tests']=58
        spec['professional_service_contract']['source_registration']['verification']['test_count']=142
        self.assertEqual(checker.professional_guide_test_registration(spec),({checker.PROFESSIONAL_GUIDE_TEST},[]))
        self.verification(spec)['additive_guide_tests']=57;self.rejected(spec)

    def test_native_activation_and_operating_write_promotions_fail(self):
        for field,value in [('native_acceptance','PASS'),('activation_status','PASS'),('operating_writes',1)]:
            spec,_=self.fixture();self.verification(spec)[field]=value;self.rejected(spec)

    def test_malformed_duplicate_or_unbound_sources_fail(self):
        for mode in ('duplicate','missing','bad_hash','bool_hash','extra_key','edge_drift','entry_drift'):
            with self.subTest(mode=mode):
                spec,_=self.fixture();bindings=self.verification(spec)['source_bindings']
                if mode=='duplicate':bindings[1]=deepcopy(bindings[0])
                elif mode=='missing':bindings.pop()
                elif mode=='bad_hash':bindings[0]['sha256']='g'*64
                elif mode=='bool_hash':bindings[0]['sha256']=False
                elif mode=='extra_key':bindings[0]['payload']='SYNTHETIC_PRIVATE_EXTRA'
                elif mode=='edge_drift':spec['edge_harness']['files'][bindings[0]['path']]['declarations']['source_sha256']='a'*64
                else:
                    row=next(r for r in spec['workflow']['documentation_sync']['code_index']['edge_sources']['files']if r['path']==bindings[1]['path']);row['source_sha256']='a'*64
                self.rejected(spec)

    def test_professional_registry_and_suite_entry_are_required(self):
        for mode in ('absent','invalid','entry_not_tested','entry_binding_drift'):
            with self.subTest(mode=mode):
                spec,_=self.fixture();c=spec['professional_service_contract'];r=c['source_registration'];entry=self.verification(spec)['suite_entry']
                if mode=='absent':c.pop('source_registration')
                elif mode=='invalid':r['verification']['test_count']=0
                elif mode=='entry_not_tested':r['verification']['test_paths'].remove(entry)
                else:next(v for v in r['source_bindings']if v['path']==entry)['sha256']='a'*64
                self.rejected(spec)

    def test_verification_layer_and_REQ31_are_required_for_both_sources(self):
        for requirement in ('REQ-24','REQ-25','REQ-26','REQ-31'):
            with self.subTest(guide_requirement=requirement):
                spec,_=self.fixture()
                spec['professional_service_contract']['counseling_tips']['yearly_rule_read']['requirements'].remove(requirement)
                self.rejected(spec)
        for which in (0,1):
            for mode in ('layer','requirement','duplicate'):
                spec,_=self.fixture();path=self.verification(spec)['source_bindings'][which]['path'];row=next(v for v in spec['implementation']if v['path']==path)
                if mode=='layer':row['layer']='application'
                elif mode=='requirement':row['requirements']=[]
                else:spec['implementation'].append(deepcopy(row))
                self.rejected(spec)

    def test_foundation_or_read_view_double_counting_is_rejected(self):
        for source in ('foundation','read_view'):
            for field in ('test_paths','suite_entry'):
                spec,_=self.fixture();v=self.verification(spec);path=v[field][0]if field=='test_paths'else v[field]
                target=spec['edge_harness']['tests']if source=='foundation'else spec['read_view_extension_contract']['verification']['test_paths']
                target.append(path);self.rejected(spec)
        spec,_=self.fixture();spec['edge_harness']['unit_count']=657;self.rejected(spec)

    def test_valid_guide_does_not_hide_another_unregistered_test(self):
        import check_project_consistency as checker
        spec,_=self.fixture();spec['edge_harness']['files']['tests/edge/test_unregistered_guide_neighbor.ts']=dict(layer='verification',declarations=dict(source_sha256='a'*64))
        self.assertEqual(checker.professional_guide_test_registration(spec),({checker.PROFESSIONAL_GUIDE_TEST},[]))
        self.assertIn('Read-view separate exact suite registration drift',checker.validate_read_view_extension(spec))

    def test_selected_snapshot_reader_supplies_both_bound_files(self):
        import check_project_consistency as checker
        spec,blobs=self.fixture();seen=[]
        def read(path):seen.append(path);return blobs[path]
        self.assertEqual(checker.validate_professional_guide_snapshot(set(blobs),read,spec),[])
        self.assertEqual(set(seen),set(blobs));self.assertEqual(len(seen),2)

    def test_selected_snapshot_missing_hash_drift_and_reader_error_fail_closed(self):
        import check_project_consistency as checker
        for path_kind in ('test_paths','suite_entry'):
            spec,blobs=self.fixture();v=self.verification(spec);path=v[path_kind][0]if path_kind=='test_paths'else v[path_kind]
            self.assertTrue(checker.validate_professional_guide_snapshot(set(blobs)-{path},blobs.__getitem__,spec))
            blobs[path]+=b' // synthetic hash drift'
            self.assertTrue(checker.validate_professional_guide_snapshot(set(blobs),blobs.__getitem__,spec))
        spec,blobs=self.fixture()
        def fail(_):raise OSError('synthetic reader failure')
        self.assertTrue(checker.validate_professional_guide_snapshot(set(blobs),fail,spec))

    def test_rehashed_comment_string_dynamic_wrong_and_duplicate_imports_fail(self):
        import check_project_consistency as checker
        exact='import "../../../'+checker.PROFESSIONAL_GUIDE_TEST+'";'
        for text in ('// '+exact,'/* '+exact+' */','const text = '+json.dumps(exact)+';',
                     'await import("../../../'+checker.PROFESSIONAL_GUIDE_TEST+'");',
                     'import "../../../tests/edge/test_other.ts";',exact+'\n'+exact):
            with self.subTest(text=text):
                spec,blobs=self.fixture();self.rebind_entry(spec,blobs,text)
                self.assertEqual(checker.professional_guide_test_registration(spec),({checker.PROFESSIONAL_GUIDE_TEST},[]))
                self.assertTrue(checker.validate_professional_guide_snapshot(set(blobs),blobs.__getitem__,spec))

    def test_selected_snapshot_does_not_fallback_to_worktree_bytes(self):
        from unittest.mock import patch
        import check_project_consistency as checker
        import check_edge_contract
        spec,blobs=self.fixture()
        with patch('pathlib.Path.read_bytes',side_effect=AssertionError('worktree direct read forbidden')):
            self.assertEqual(checker.validate_professional_guide_snapshot(set(blobs),blobs.__getitem__,spec),[])

    def test_retained_metadata_is_preserved_without_becoming_operating_acceptance(self):
        import check_project_consistency as checker
        spec,_=self.fixture();v=self.verification(spec);v['private_receipts']={'synthetic_receipt_sha256':'a'*64};v['native_overlay_SQL_acceptance']='NOT_RUN_SYNTHETIC_BRANCH_ONLY';v['migration_Secrets_deployment_changes']=0
        self.assertEqual(checker.professional_guide_test_registration(spec),({checker.PROFESSIONAL_GUIDE_TEST},[]))
        self.assertEqual(v['native_acceptance'],'NOT_VERIFIED_BY_SOURCE_SUITE')
        self.assertEqual(v['activation_status'],'NOT_RUN');self.assertEqual(v['operating_writes'],0)

    def test_fixture_reuses_future_baseline_without_duplicate_guide_rows(self):
        from unittest.mock import patch
        import check_project_consistency as checker
        future,_=self.fixture()
        with patch('pathlib.Path.read_bytes',return_value=json.dumps(future).encode('utf-8')):
            spec,_=self.fixture()
        self.assertEqual(checker.professional_guide_test_registration(spec),({checker.PROFESSIONAL_GUIDE_TEST},[]))
        self.assertEqual(checker.validate_read_view_extension(spec),[])


if __name__=='__main__':unittest.main()
