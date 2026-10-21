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


if __name__=='__main__':unittest.main()
