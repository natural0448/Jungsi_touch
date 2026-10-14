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
    if live is not None:
        operations=spec.get('operations',[])
        ids=[row.get('id')for row in operations if isinstance(row,dict)]
        states=live.get('operations',{})if isinstance(live,dict)else None
        if (len(ids)!=22 or any(not isinstance(v,str)for v in ids) or len(set(ids))!=22 or
            not isinstance(states,dict)or set(states)!=set(ids)):
            raise EdgeFailure('operation_registration_coverage_invalid')
        total=len(ids)
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
            if (not isinstance(path,str)or not path.startswith('supabase/functions/') or
                not isinstance(sha,str)or len(sha)!=64 or any(c not in '0123456789abcdef'for c in sha) or
                indexed.get(path)!=sha):
                raise EdgeFailure('operation_registration_binding_invalid')
            registered.append(operation)
    status='NOT_PORTED'if not registered else ('CODE_REGISTERED'if len(registered)==total else 'PARTIAL_CODE_REGISTERED')
    return dict(all_22=status,native_acceptance='NOT_VERIFIED_BY_SOURCE_SUITE',
        source_registration=dict(format='jungsi.edge-operation-registration/v1',
            basis='checked_selected_snapshot_source_hashes',contract_operation_count=total,
            registered_operation_ids=registered,registered_operation_count=len(registered)))

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
