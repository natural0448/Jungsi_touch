"""Run the registered Edge suite in exactly the retained Python-suite snapshot.
No runtime install, source fallback, skipped green result, cleanup or remote services.
"""
from __future__ import annotations
import argparse,json,os,sys,xml.etree.ElementTree as ET
from pathlib import Path
from edge_source_scope import classify_sources
from check_edge_contract import EdgeFailure,check_workspace,command,digest,hashes,json_bytes,verify_manifest,write_new
def parse_junit(path,expected):
    if not Path(path).is_file():raise EdgeFailure("deno_test_result_missing")
    root=ET.fromstring(Path(path).read_bytes());cases=list(root.iter("testcase"))
    if len(cases)!=expected or any(list(c) for c in cases if any(x.tag in {"failure","error","skipped"} for x in c)):
        raise EdgeFailure("deno_test_count_failure_or_skip")
    return dict(tests_run=len(cases),failures=0,errors=0,skipped=0)
def require_oracle(receipt,count,cases_sha):
    if receipt.get("successful") is not True or receipt.get("case_count")!=count or receipt.get("mismatch_count")!=0 or receipt.get("deno_exit_code")!=0 or receipt.get("cases_sha256")!=cases_sha or receipt.get("oracle_references_match_basis") is not True:
        raise EdgeFailure("oracle_receipt_invalid")
def operation_registration(spec):
    """Report declared, hash-bound source registrations; never operating acceptance."""
    live=spec.get('supabase_deployment_contract',{}).get('live_execution')
    registered=[]
    total=None
    policy=spec.get('score_input_policy_contract');extension_registration=None;pinned_legacy=[]
    if live is not None:
        operations=spec.get('operations',[])
        ids=[row.get('id')for row in operations if isinstance(row,dict)]
        states=live.get('operations',{})if isinstance(live,dict)else None
        all_ids=ids
        if policy is not None:
            from check_project_consistency import validate_score_input_policy
            if validate_score_input_policy(spec):raise EdgeFailure('operation_registration_coverage_or_extension_binding_invalid')
            ids=policy['legacy_operation_ids']
        if (len(ids)!=22 or any(not isinstance(v,str)for v in ids) or len(set(ids))!=22 or
            not isinstance(states,dict)or set(states)!=set(ids)):
            raise EdgeFailure('operation_registration_coverage_invalid')
        total=len(all_ids)
        indexed={p:row.get('declarations',{}).get('source_sha256')
            for p,row in spec.get('edge_harness',{}).get('files',{}).items()}
        index=spec.get('workflow',{}).get('documentation_sync',{}).get('code_index',{}).get('edge_sources',{})
        indexed.update({row['path']:row.get('source_sha256')for row in index.get('files',[])})
        for operation in ids:
            state=states[operation]
            if not isinstance(state,dict)or state.get('code')not in {'NOT_PORTED','FOUNDATION_ONLY','PORTED'}:
                raise EdgeFailure('operation_registration_state_invalid')
            if state['code']!='PORTED':continue
            binding=state.get('binding')
            path=binding.get('path')if isinstance(binding,dict)else None
            sha=binding.get('source_sha256')if isinstance(binding,dict)else None
            matches=indexed.get(path)==sha
            if policy is not None and not matches:
                from check_project_consistency import policy_baseline_source_matches
                matches=policy_baseline_source_matches(spec,path,sha,indexed)
                if matches:pinned_legacy.append(operation)
            if (not isinstance(path,str)or not path.startswith('supabase/functions/') or
                not isinstance(sha,str)or len(sha)!=64 or any(c not in '0123456789abcdef'for c in sha) or not matches):
                raise EdgeFailure('operation_registration_binding_invalid')
            registered.append(operation)
        if policy is not None:
            extension_registration=dict(format='jungsi.edge-policy-extension-source-registration/v1',
                basis='checked_selected_snapshot_implementation_runtime_and_test_hashes',
                contract_operation_count=3,registered_operation_ids=policy['extension_operation_ids'],
                registered_operation_count=3,status='CODE_REGISTERED',
                implementation_bindings=policy['extension_implementation_bindings'],
                runtime_test_bindings=policy['extension_runtime_test_bindings'],
                native_acceptance='NOT_VERIFIED_BY_SOURCE_SUITE',activation_status='NOT_RUN')
    status='NOT_PORTED'if not registered else ('CODE_REGISTERED'if len(registered)==22 else 'PARTIAL_CODE_REGISTERED')
    result=dict(all_22=status,native_acceptance='NOT_VERIFIED_BY_SOURCE_SUITE',
        source_registration=dict(format='jungsi.edge-operation-registration/v1',
            basis='checked_selected_snapshot_and_exact_pinned_legacy_hashes'if pinned_legacy else 'checked_selected_snapshot_source_hashes',contract_operation_count=total,
            legacy_scope_operation_count=22,pinned_legacy_binding_operation_ids=pinned_legacy,
            registered_operation_ids=registered,registered_operation_count=len(registered)))
    if extension_registration is not None:result['policy_extension_source_registration']=extension_registration
    return result

def owner_review_registration(spec,before):
    """Separate pure Owner suite; foundation 656 and legacy22+extension3 stay exact."""
    c=spec.get('owner_current_review_contract')
    entry='supabase/functions/_shared/current_admission_owner_test.ts'
    if c is None:
        if entry in before:raise EdgeFailure('owner_review_contract_missing')
        return None
    v=c.get('verification',{})
    if (c.get('format')!='jungsi.owner-current-review-contract/v1' or
        v.get('test_path')!=entry or v.get('test_count')!=36 or
        not isinstance(v.get('source_bindings'),list) or not v['source_bindings']):
        raise EdgeFailure('owner_review_verification_invalid')
    required={entry,*['supabase/functions/_shared/'+name+'.ts' for name in
      ['current_admission_owner','current_admission_owner_sql','current_admission_review',
       'current_admission_review_sql','current_admission_display','official_history_display']]}
    bindings=v['source_bindings']
    if (len(bindings)!=len(required) or {b.get('path')for b in bindings}!=required or
        any(not isinstance(b.get('sha256'),str) or before.get(b['path'])!=b['sha256']for b in bindings)):
        raise EdgeFailure('owner_review_source_binding_invalid')
    return v

def current_public_registration(spec,before):
    """Exact separate provider proposal suite; no activation or legacy-count change."""
    prefix='supabase/functions/_shared/'
    names=['current_public_catalog','current_public_catalog_compat','current_public_catalog_runtime',
      'current_public_catalog_sql','current_public_catalog_sql_test','current_public_catalog_test',
      'current_public_key_index','current_public_key_index_test','current_public_key_storage',
      'current_public_key_storage_test']
    required={prefix+n+'.ts' for n in names}
    c=spec.get('current_public_supply_contract',{}).get('verification')
    if c is None:
        if required.intersection(before):raise EdgeFailure('current_public_verification_missing')
        return None
    tests=[prefix+n+'.ts'for n in names if n.endswith('_test')]
    bindings=c.get('source_bindings')
    if (c.get('format')!='jungsi.current-public-provider-verification/v1' or
        c.get('test_paths')!=tests or c.get('test_count')!=54 or
        not isinstance(bindings,list) or len(bindings)!=len(required) or
        {b.get('path')for b in bindings}!=required or
        any(not isinstance(b.get('sha256'),str)or before.get(b['path'])!=b['sha256']for b in bindings)):
        raise EdgeFailure('current_public_source_or_test_binding_invalid')
    return c

def whole_population_registration(spec,before):
    """Separate strict v2 regressions; keep the foundation and v1 checks exact."""
    prefix='supabase/functions/_shared/'
    test=prefix+'all_examinees_total_model_test.ts'
    contract=spec.get('overall_analysis_contract',{}).get('whole_population_transition')
    if contract is None:
        if test in before:raise EdgeFailure('whole_population_contract_missing')
        return None
    c=contract.get('verification',{})
    required={test,prefix+'current_public_catalog_compat.ts',*[prefix+'jungsi/'+p+'.ts'for p in
      ['domain/all_examinees_total_model','domain/exam_pack','application/overall_analysis','infrastructure/native_data_provider']]}
    bindings=c.get('source_bindings')
    if (contract.get('format')!='jungsi.whole-population-model-transition/v1' or
        c.get('test_path')!=test or c.get('test_count')!=14 or
        not isinstance(bindings,list) or len(bindings)!=len(required) or
        {b.get('path')for b in bindings}!=required or
        any(not isinstance(b.get('sha256'),str)or before.get(b['path'])!=b['sha256']for b in bindings)):
        raise EdgeFailure('whole_population_source_or_test_binding_invalid')
    return c

def run_workspace(root,manifest,deno,python,output):
    root=Path(root).resolve();output=Path(output);output.mkdir(parents=True,exist_ok=False)
    before=verify_manifest(root,manifest);spec=json.loads((root/"docs/current/service_spec.json").read_bytes())
    scope=classify_sources(before,lambda p:(root/p).read_bytes(),spec)
    active=scope["foundation_active"]
    if not active:
        result=dict(successful=True,status="NOT_APPLICABLE_NO_FOUNDATION_SOURCE",edge_execution=False,coexisting_edge_sources=len(scope["coexisting_bound"]),coverage="DEV010_FOUNDATION")
        write_new(output/"edge_run_receipt.json",json_bytes(result));return result
    if not python or not Path(python).is_file():raise EdgeFailure("python_runtime_unavailable")
    cfg=spec["edge_harness"]
    parsed=check_workspace(root,manifest,deno,output/"contract")
    paths=list(cfg["files"]);common=["--no-lock","--no-remote","--no-npm","--config",cfg["config"]]
    command([deno,"check",*common,*paths],root=root,output=output,name="check")
    command([deno,"lint","--config",cfg["config"],*paths],root=root,output=output,name="lint")
    command([deno,"fmt","--check","--config",cfg["config"],*paths],root=root,output=output,name="fmt")
    junit=output.resolve()/"deno.junit.xml"
    if junit.exists():raise EdgeFailure("deno_test_output_exists")
    command([deno,"test",*common,"--reporter=dot","--junit-path",str(junit),*cfg["tests"]],root=root,output=output,name="unit")
    unit=parse_junit(junit,cfg["unit_count"])
    owner_registration=owner_review_registration(spec,before);owner_unit=None
    if owner_registration is not None:
        owner_junit=output.resolve()/"owner_review.junit.xml"
        command([deno,"test","--no-config","--no-lock","--no-remote","--no-npm",
          "--reporter=dot","--junit-path",str(owner_junit),owner_registration['test_path']],
          root=root,output=output,name="owner_review_unit")
        owner_unit=dict(**parse_junit(owner_junit,owner_registration['test_count']),
          coverage='OWNER_CURRENT_REVIEW_V3_SYNTHETIC',source_bindings=owner_registration['source_bindings'],
          actual_DB='NOT_RUN',deployment='NOT_RUN')
    public_registration=current_public_registration(spec,before);public_unit=None
    if public_registration is not None:
        public_paths=[b['path']for b in public_registration['source_bindings']]
        command([deno,'check',*common,*public_paths],root=root,output=output,name='current_public_check')
        command([deno,'lint','--config',cfg['config'],*public_paths],root=root,output=output,name='current_public_lint')
        command([deno,'fmt','--check','--config',cfg['config'],*public_paths],root=root,output=output,name='current_public_fmt')
        public_junit=output.resolve()/'current_public.junit.xml'
        command([deno,'test',*common,'--reporter=dot','--junit-path',str(public_junit),
          *public_registration['test_paths']],root=root,output=output,name='current_public_unit')
        public_unit=dict(**parse_junit(public_junit,public_registration['test_count']),
          coverage='CURRENT_PUBLIC_PROVIDER_CANDIDATE_SYNTHETIC',
          source_bindings=public_registration['source_bindings'],
          actual_DB='NOT_VERIFIED_BY_SOURCE_SUITE',publication='NOT_APPROVED_BY_SOURCE_SUITE',deployment='NOT_RUN')
    whole_population_unit=None
    whole_population=whole_population_registration(spec,before)
    if whole_population is not None:
        whole_paths=[b['path']for b in whole_population['source_bindings']]
        command([deno,'check',*common,*whole_paths],root=root,output=output,name='whole_population_check')
        command([deno,'lint','--config',cfg['config'],*whole_paths],root=root,output=output,name='whole_population_lint')
        command([deno,'fmt','--check','--config',cfg['config'],*whole_paths],root=root,output=output,name='whole_population_fmt')
        whole_junit=output.resolve()/'whole_population_unit.junit.xml'
        command([deno,'test',*common,'--reporter=dot','--junit-path',str(whole_junit),whole_population['test_path']],root=root,output=output,name='whole_population_unit')
        whole_population_unit=dict(**parse_junit(whole_junit,whole_population['test_count']),
          coverage='STRICT_WHOLE_POPULATION_V2_SYNTHETIC',source_bindings=whole_population['source_bindings'],
          native_acceptance='NOT_VERIFIED_BY_SOURCE_SUITE',activation_status='NOT_RUN')
    references=cfg["python_reference"]
    reference=dict(format="jungsi.edge-python-reference/v1",basis="selected_snapshot",
      files=references["files"],source_files={p:before[p] for p in [*paths,cfg["config"],cfg["oracle"]]},
      expected_cases=cfg["oracle_count"],cases_sha256=references["cases_sha256"])
    write_new(output/"reference_manifest.json",json_bytes(reference))
    oracle=output/"oracle"
    command([python,"-B","-X","utf8",str(root/cfg["oracle"]),"--deno",deno,
      "--reference-manifest",str((output/"reference_manifest.json").resolve()),"--output-root",str(oracle.resolve())],root=root,output=output,name="oracle",timeout=60)
    receipt_path=oracle/"comparison_receipt.v1.json"
    if not receipt_path.is_file():raise EdgeFailure("oracle_result_missing")
    receipt=json.loads(receipt_path.read_bytes());require_oracle(receipt,cfg["oracle_count"],references["cases_sha256"])
    if verify_manifest(root,manifest)!=before:raise EdgeFailure("snapshot_changed_during_edge_run")
    result=dict(format="jungsi.edge-suite-result/v1",successful=True,status="PASS",edge_execution=True,
      coverage="DEV010_FOUNDATION",coexisting_edge_sources=len(scope["coexisting_bound"]),unit=unit,oracle=dict(case_count=receipt["case_count"],mismatch_count=receipt["mismatch_count"]),
      source_manifest_sha256=digest(json_bytes(manifest)),contract_receipt_sha256=digest((output/"contract/edge_contract_receipt.json").read_bytes()),
      oracle_receipt_sha256=digest(receipt_path.read_bytes()),tool=parsed["tool"],production_ready=False,operating_writes=0,**operation_registration(spec))
    if owner_unit is not None:result['owner_review_unit']=owner_unit
    if public_unit is not None:result['current_public_unit']=public_unit
    if whole_population_unit is not None:result['whole_population_unit']=whole_population_unit
    write_new(output/"edge_run_receipt.json",json_bytes(result));return result
def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ("snapshot-root","source-manifest","python","output-root"):p.add_argument("--"+name,required=True)
    p.add_argument("--deno",default=os.environ.get("JUNGSI_DENO"));a=p.parse_args()
    result=run_workspace(a.snapshot_root,json.loads(Path(a.source_manifest).read_bytes()),a.deno,a.python,a.output_root)
    print(json.dumps(result,ensure_ascii=False));return 0
if __name__=="__main__":
    try:raise SystemExit(main())
    except (ValueError,KeyError,OSError,ET.ParseError) as e:
        print(json.dumps(dict(successful=False,error=str(e)),ensure_ascii=False),file=sys.stderr);raise SystemExit(2)
