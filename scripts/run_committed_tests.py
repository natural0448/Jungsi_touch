"""Run Python and required Edge checks from one retained Git snapshot. No deletion."""
from __future__ import annotations
import argparse,datetime,hashlib,json,os,re,subprocess,sys
from pathlib import Path
from edge_source_scope import classify_sources
from check_project_consistency import ROOT,GitSnapshot,validate_content,validate_changed_paths,snapshot_changed_paths,validate_snapshot_baseline,SPEC_PATH
PYTHON_SUITE_TIMEOUT_SECONDS = 3600
RETAINED_RUNNER_TIMEOUT_SECONDS = 4200

HELPER = """import importlib.util,json,pathlib,re,sys,time,unittest
root=pathlib.Path.cwd()
sys.path[:0]=[str(root/'src'),str(root/'scripts'),str(root/'tests')]
suite=unittest.TestSuite()
for path in json.load(sys.stdin):
    name='committed_'+path.replace('/','_').replace('.','_')
    spec=importlib.util.spec_from_file_location(name,root/path)
    module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module)
    suite.addTests(unittest.defaultTestLoader.loadTestsFromModule(module))
# Record only pre-selected test/class identifiers, never error or subtest text.
def selected_identifiers(node, ids, classes, modules):
    if isinstance(node,unittest.TestSuite):
        for child in node: selected_identifiers(child,ids,classes,modules)
    elif isinstance(node,unittest.TestCase):
        cls=node.__class__.__module__+'.'+node.__class__.__qualname__
        method=getattr(node,'_testMethodName','')
        ident=cls+'.'+method
        if (len(ident)<=240 and method.startswith('test') and
            callable(getattr(node.__class__,method,None)) and
            re.fullmatch(r'[A-Za-z_][A-Za-z_0-9]*(?:[.][A-Za-z_][A-Za-z_0-9]*)+',ident)):
            ids.add(ident);classes.add(cls);modules.add(node.__class__.__module__)
selected_ids=set();selected_classes=set();selected_modules=set()
selected_identifiers(suite,selected_ids,selected_classes,selected_modules)
class ProgressResult(unittest.TextTestResult):
    def __init__(self,*args,**kwargs):
        super().__init__(*args,**kwargs)
        self.failure_test_ids=[]
    def recordFailureId(self,test):
        ident='unknown'
        holder=getattr(unittest.suite,'_ErrorHolder',None)
        if holder is not None and type(test) is holder:
            description=getattr(test,'description','')
            match=re.fullmatch(r'(setUpClass|tearDownClass) [(]([A-Za-z_][A-Za-z_0-9]*(?:[.][A-Za-z_][A-Za-z_0-9]*)+)[)]',description)
            if match and match.group(2) in selected_classes:
                ident=match.group(2)+'.'+match.group(1)
            else:
                match=re.fullmatch(r'(setUpModule|tearDownModule) [(]([A-Za-z_][A-Za-z_0-9]*(?:[.][A-Za-z_][A-Za-z_0-9]*)*)[)]',description)
                if match and match.group(2) in selected_modules:
                    ident=match.group(2)+'.'+match.group(1)
        elif isinstance(test,unittest.TestCase):
            candidate=test.__class__.__module__+'.'+test.__class__.__qualname__+'.'+getattr(test,'_testMethodName','')
            if candidate in selected_ids: ident=candidate
        if len(ident)>240: ident='unknown'
        if ident not in self.failure_test_ids and len(self.failure_test_ids)<10:
            self.failure_test_ids.append(ident)
    def addError(self,test,err):
        self.recordFailureId(test)
        super().addError(test,err)
    def addFailure(self,test,err):
        self.recordFailureId(test)
        super().addFailure(test,err)
    def addSubTest(self,test,subtest,err):
        if err is not None: self.recordFailureId(test)
        super().addSubTest(test,subtest,err)
    def startTest(self,test):
        super().startTest(test)
        self.started=time.monotonic()
        name=test.__class__.__module__+'.'+test.__class__.__qualname__+'.'+getattr(test,'_testMethodName','unknown')
        self.progress_id=name if re.fullmatch(r'[A-Za-z_][A-Za-z_0-9]*(?:[.][A-Za-z_][A-Za-z_0-9]*)+',name) else 'unregistered_test_id'
        if self.testsRun%100==1:
            self.stream.write('JUNGSI_TEST_PROGRESS='+json.dumps(dict(test_number=self.testsRun,test_id=self.progress_id,phase='start'))+chr(10))
            self.stream.flush()
    def stopTest(self,test):
        elapsed=time.monotonic()-self.started
        if elapsed>=5 or self.testsRun%100==0:
            self.stream.write('JUNGSI_TEST_PROGRESS='+json.dumps(dict(test_number=self.testsRun,test_id=self.progress_id,phase='complete',elapsed_seconds=round(elapsed,3)))+chr(10))
            self.stream.flush()
        super().stopTest(test)
selected_tests=suite.countTestCases()
result=unittest.TextTestRunner(verbosity=1,resultclass=ProgressResult,failfast=True).run(suite)
print('JUNGSI_TEST_RESULT='+json.dumps(dict(tests_run=result.testsRun,selected_tests=selected_tests,not_executed=max(0,selected_tests-result.testsRun),failures=len(result.failures),errors=len(result.errors),skipped=len(result.skipped),successful=result.wasSuccessful(),failure_test_ids=result.failure_test_ids)))
sys.exit(0 if result.wasSuccessful() else 1)
"""
def encode(data):return (json.dumps(data,ensure_ascii=False,sort_keys=True,indent=2)+"\n").encode()
def create(p,data):
    p.parent.mkdir(parents=True,exist_ok=True)
    with p.open("xb") as f:f.write(data)
def files_hashes(root,names):
    values={}
    for name in names:
        p=Path(name)
        if p.is_absolute() or ".." in p.parts or "\\" in name or ":" in name:raise ValueError("Unsafe snapshot path")
        target=root/p
        if any(x.is_symlink() for x in [target,*target.parents]) or not target.is_file():raise ValueError("Nonregular retained snapshot")
        if not target.resolve().is_relative_to(root.resolve()):raise ValueError("Snapshot escape")
        values[name]=hashlib.sha256(target.read_bytes()).hexdigest()
    return values
EDGE_UNIT_KEYS = frozenset({
    "unit", "owner_review_unit", "current_public_unit", "whole_population_unit",
    "read_view_extension_unit", "professional_unit", "school_reference_unit",
    "member_shortlist_unit", "incident_recovery_unit", "service_candidate_aux_unit", "service_staged_aux_unit", "service_wildcard_unit",
    "p1_recruitment_score_review_unit", "p1_selection_bridge_review_unit", "service_end_score_cutoff_unit",
    "cursor_contract_review_unit", "reference_db_unit", "auth_503_unit", "auth_503_runtime_unit",
    "university_cancellation_unit", "reference_safety_unit",
})

def summarize_edge_units(edge, expected_foundation, recovery_required, auxiliary_required=False, staged_required=False, wildcard_required=False,
                         p1_review_required=False, p1_selection_required=False, service_end_required=False, cursor_required=False, reference_db_count=None, auth_503_required=False, auth_503_runtime_required=False, university_cancellation_required=False, reference_safety_required=False):
    """Count all executed, separately registered Edge suites; keep oracle cases separate."""
    if (not isinstance(edge,dict) or type(expected_foundation)is not int or expected_foundation<1 or
        any(type(flag) is not bool for flag in (recovery_required,auxiliary_required,staged_required,wildcard_required,
            p1_review_required,p1_selection_required,service_end_required,cursor_required,auth_503_required,auth_503_runtime_required,
            university_cancellation_required,reference_safety_required))):raise ValueError("edge_count_input_invalid")
    if auth_503_runtime_required and not auth_503_required:raise ValueError("edge_runtime_without_auth_invalid")
    if reference_db_count is not None and (type(reference_db_count) is not int or reference_db_count < 1):
        raise ValueError("reference_db_count_invalid")
    keys={name for name in edge if name=="unit" or name.endswith("_unit")}
    if "unit" not in keys or keys-EDGE_UNIT_KEYS:raise ValueError("edge_unit_coverage_invalid")
    if ("incident_recovery_unit" in keys)!=recovery_required:raise ValueError("edge_recovery_unit_missing_or_unregistered")
    if ("service_candidate_aux_unit" in keys)!=auxiliary_required:raise ValueError("edge_aux_unit_missing_or_unregistered")
    if ("service_staged_aux_unit" in keys)!=staged_required:raise ValueError("edge_staged_aux_unit_missing_or_unregistered")
    if ("service_wildcard_unit" in keys)!=wildcard_required:raise ValueError("edge_wildcard_unit_missing_or_unregistered")
    if ("reference_db_unit" in keys)!=(reference_db_count is not None):raise ValueError("edge_reference_db_unit_missing_or_unregistered")
    additional=(("p1_recruitment_score_review_unit",p1_review_required,72),
        ("p1_selection_bridge_review_unit",p1_selection_required,17),
        ("service_end_score_cutoff_unit",service_end_required,3),
        ("cursor_contract_review_unit",cursor_required,22),
        ("auth_503_unit",auth_503_required,27),
        ("auth_503_runtime_unit",auth_503_runtime_required,5),
        ("university_cancellation_unit",university_cancellation_required,6),
        ("reference_safety_unit",reference_safety_required,18))
    for name,required,_ in additional:
        if (name in keys)!=required:raise ValueError("edge_additional_unit_missing_or_unregistered:"+name)
    counts={}
    for name in sorted(keys):
        value=edge[name]
        if (not isinstance(value,dict) or type(value.get("tests_run"))is not int or value["tests_run"]<1 or
            any(type(value.get(k))is not int or value[k]!=0 for k in ("failures","errors","skipped"))):
            raise ValueError("edge_unit_result_invalid")
        counts[name]=value["tests_run"]
    if counts["unit"]!=expected_foundation:raise ValueError("edge_foundation_count_invalid")
    if recovery_required and counts["incident_recovery_unit"]!=50:raise ValueError("edge_recovery_count_invalid")
    if auxiliary_required and counts["service_candidate_aux_unit"]!=14:raise ValueError("edge_aux_count_invalid")
    if staged_required and counts["service_staged_aux_unit"]!=76:raise ValueError("edge_staged_aux_count_invalid")
    if wildcard_required and counts["service_wildcard_unit"]!=97:raise ValueError("edge_wildcard_count_invalid")
    if reference_db_count is not None and counts["reference_db_unit"]!=reference_db_count:raise ValueError("edge_reference_db_count_invalid")
    for name,required,expected in additional:
        if required and counts[name]!=expected:raise ValueError("edge_additional_count_invalid:"+name)
    return {"total_tests":sum(counts.values()),"by_suite":counts}

def additional_p1_unit_flags(spec):
    """Require each P1 unit whenever its registration key is present in the snapshot."""
    if not isinstance(spec,dict):raise ValueError("edge_count_spec_invalid")
    return dict(p1_review_required="p1_recruitment_score_review_verification" in spec,
        p1_selection_required="p1_selection_bridge_review_verification" in spec,
        service_end_required="service_end_score_cutoff_synthetic_verification" in spec)

def cursor_unit_required(spec):
    """Require the cursor suite whenever its snapshot registration is present."""
    if not isinstance(spec,dict):raise ValueError("edge_count_spec_invalid")
    return "cursor_contract_offline_graph_verification" in spec

def auth_503_unit_required(spec):
    """An existing historical spec has no new auth suite; registered suites are mandatory."""
    if not isinstance(spec,dict):raise ValueError("auth_503_spec_invalid")
    live=spec.get("supabase_deployment_contract",{}).get("live_execution",{})
    if not isinstance(live,dict):raise ValueError("auth_503_spec_invalid")
    followup=live.get("auth_503_cancel_followup_20261112")
    if followup is None:return False
    if not isinstance(followup,dict):raise ValueError("auth_503_spec_invalid")
    return "synthetic_suite" in followup

def auth_503_runtime_unit_required(spec):
    """Keep historic 27-only registrations valid; require the five when registered."""
    if not isinstance(spec,dict):raise ValueError("auth_503_spec_invalid")
    live=spec.get("supabase_deployment_contract",{}).get("live_execution",{})
    if not isinstance(live,dict):raise ValueError("auth_503_spec_invalid")
    followup=live.get("auth_503_cancel_followup_20261112")
    if followup is None:return False
    if not isinstance(followup,dict):raise ValueError("auth_503_spec_invalid")
    return "runtime_integration_suite" in followup

def reference_db_unit_count(spec):
    """Require the exact additive reference suite only when registered in this snapshot."""
    if not isinstance(spec,dict):raise ValueError("reference_db_spec_invalid")
    ext=spec.get("backend_platform_contract",{}).get("reference_db_test_extension")
    if ext is None:return None
    if not isinstance(ext,dict) or type(ext.get("test_count")) is not int or ext["test_count"]<1:
        raise ValueError("reference_db_registration_invalid")
    return ext["test_count"]


def reference_safety_required(spec):
    from reference_safety_suite import required
    return required(spec)


def university_cancellation_unit_required(spec):
    """Require the six-case suite only for its exact registered candidate contract."""
    if not isinstance(spec,dict):raise ValueError("university_cancellation_spec_invalid")
    backend=spec.get("backend_platform_contract",{})
    if not isinstance(backend,dict):raise ValueError("university_cancellation_spec_invalid")
    name="university_cancellation_test_extension"
    if name not in backend:return False
    ext=backend[name]
    if (not isinstance(ext,dict) or ext.get("format")!="jungsi.university-cancellation-tests/v1" or
        ext.get("status")!="SOURCE_REGISTERED_NOT_EXECUTED" or type(ext.get("test_count")) is not int or
        ext["test_count"]!=6 or ext.get("test_paths")!=["tests/edge/test_university_analysis_cancellation.ts"]):
        raise ValueError("university_cancellation_registration_invalid")
    return True


def suite_python_environment(base,deno,scratch):
    if not deno or not Path(deno).is_absolute() or not Path(scratch).is_absolute():
        raise ValueError("Explicit absolute Deno and suite scratch are required")
    return {**base,"JUNGSI_DENO":str(deno),"JUNGSI_REVIEW_SUITE_SCRATCH":str(scratch)}

def valid_python_receipt(receipt):
    """Accept only a complete, non-skipped execution of every selected test."""
    if not isinstance(receipt,dict) or receipt.get("successful") is not True:
        return False
    keys=("selected_tests","tests_run","not_executed","failures","errors","skipped")
    if any(type(receipt.get(key)) is not int or receipt[key]<0 for key in keys):
        return False
    return (receipt["selected_tests"]>0 and receipt["tests_run"]==receipt["selected_tests"] and
            receipt["not_executed"]==0 and receipt["failures"]==0 and
            receipt["errors"]==0 and receipt["skipped"]==0)

def run_retained(workspace,manifest,destination,deno=None):
    workspace=Path(workspace).resolve();destination=Path(destination)
    destination.mkdir(parents=True,exist_ok=False)
    before=files_hashes(workspace,manifest["files"])
    if manifest.get("format")!="jungsi.retained-snapshot/v1" or before!=manifest["files"]:raise ValueError("Retained snapshot mismatch")
    create(destination/"source_manifest.json",encode(manifest))
    content_errors=validate_content(list(before),lambda p:(workspace/p).read_bytes(),json.loads((workspace/SPEC_PATH).read_bytes()))
    if content_errors:
        summary=dict(format="jungsi.combined-snapshot-tests/v1",successful=False,common_gate_errors=content_errors,snapshot=manifest["snapshot"])
        create(destination/"verification.json",encode(summary));return summary
    tests=[p for p in before if p.startswith("tests/test_") and p.endswith(".py")]
    if not tests:raise ValueError("No selected Python tests")
    env={**os.environ,"PYTHONDONTWRITEBYTECODE":"1"}
    selected_spec=json.loads((workspace/SPEC_PATH).read_bytes())
    if selected_spec.get("backend_platform_contract",{}).get("service_candidate_suite_extension") is not None:
        scratch=destination.resolve()/"service_candidate_suite"
        scratch.mkdir(exist_ok=False)
        (scratch/"cache").mkdir(exist_ok=False)
        (scratch/"tmp").mkdir(exist_ok=False)
        env=suite_python_environment(env,deno,scratch)
    try:
        result=subprocess.run([sys.executable,"-B","-X","utf8","-c",HELPER],cwd=workspace,input=json.dumps(tests).encode(),capture_output=True,env=env,timeout=PYTHON_SUITE_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired as error:
        create(destination/"python.stdout",error.stdout or b"");create(destination/"python.stderr",error.stderr or b"")
        summary=dict(format="jungsi.combined-snapshot-tests/v1",successful=False,python=dict(successful=False,timeout=True),edge=dict(status="NOT_RUN_PYTHON_TIMEOUT"),snapshot=manifest["snapshot"],source_manifest_sha256=hashlib.sha256(encode(manifest)).hexdigest())
        create(destination/"verification.json",encode(summary));return summary
    create(destination/"python.stdout",result.stdout);create(destination/"python.stderr",result.stderr)
    lines=[l for l in result.stdout.decode("utf-8",errors="replace").splitlines() if l.startswith("JUNGSI_TEST_RESULT=")]
    if len(lines)!=1:python=dict(successful=False,missing_or_duplicate_test_result=True)
    else:python=json.loads(lines[0].split("=",1)[1])
    python["exit_code"]=result.returncode
    py_ok=result.returncode==0 and valid_python_receipt(python)
    if not py_ok:
        summary=dict(format="jungsi.combined-snapshot-tests/v1",successful=False,python=python,edge=dict(status="NOT_RUN_PYTHON_FAILED"),source_manifest_sha256=hashlib.sha256(encode(manifest)).hexdigest())
    else:
        selected_spec=json.loads((workspace/SPEC_PATH).read_bytes())
        scope=classify_sources(before,lambda p:(workspace/p).read_bytes(),selected_spec)
        edge_sources=scope["foundation_active"]
        if edge_sources:
            args=[sys.executable,"-B","-X","utf8",str(workspace/"scripts/run_edge_tests.py"),"--snapshot-root",str(workspace),"--source-manifest",str((destination/"source_manifest.json").resolve()),"--python",sys.executable,"--output-root",str((destination/"edge").resolve())]
            if deno:args+=["--deno",deno]
            try:
                edge_process=subprocess.run(args,cwd=workspace,capture_output=True,env=env,timeout=300)
            except subprocess.TimeoutExpired as error:
                create(destination/"edge.stdout",error.stdout or b"");create(destination/"edge.stderr",error.stderr or b"")
                edge=dict(successful=False,status="EDGE_TIMEOUT",timeout=True,
                    retained_results_directory=str(destination.resolve()))
                edge_ok=False
            else:
                create(destination/"edge.stdout",edge_process.stdout);create(destination/"edge.stderr",edge_process.stderr)
                p=destination/"edge/edge_run_receipt.json"
                edge=json.loads(p.read_bytes()) if p.is_file() else dict(successful=False,missing_edge_result=True)
                expected_hash=hashlib.sha256(encode(manifest)).hexdigest()
                edge_ok=edge_process.returncode==0 and edge.get("successful") is True and edge.get("status")=="PASS" and edge.get("source_manifest_sha256")==expected_hash
                if edge_ok:
                    try:
                        recovery_required=selected_spec.get("backend_platform_contract",{}).get("native_edge_v5_extension") is not None
                        auxiliary_required=selected_spec.get("backend_platform_contract",{}).get("service_aux_test_extension") is not None
                        staged_required=selected_spec.get("backend_platform_contract",{}).get("service_staged_test_extension") is not None
                        wildcard_required=selected_spec.get("backend_platform_contract",{}).get("service_wildcard_test_extension") is not None
                        counts=summarize_edge_units(edge,selected_spec["edge_harness"]["unit_count"],recovery_required,auxiliary_required,staged_required,wildcard_required,
                            cursor_required=cursor_unit_required(selected_spec),reference_db_count=reference_db_unit_count(selected_spec),
                            auth_503_required=auth_503_unit_required(selected_spec),
                            auth_503_runtime_required=auth_503_runtime_unit_required(selected_spec),
                            university_cancellation_required=university_cancellation_unit_required(selected_spec),
                            reference_safety_required=reference_safety_required(selected_spec),**additional_p1_unit_flags(selected_spec))
                        edge["total_tests"]=counts["total_tests"]
                        edge["unit_counts"]=counts["by_suite"]
                    except (KeyError,TypeError,ValueError) as error:
                        edge_ok=False
                        edge["test_count_error"]=str(error)
                edge["exit_code"]=edge_process.returncode
        else:
            edge=dict(status="NOT_APPLICABLE_NO_FOUNDATION_SOURCE",edge_execution=False,coexisting_edge_sources=len(scope["coexisting_bound"]),coverage="DEV010_FOUNDATION");edge_ok=True
        summary=dict(format="jungsi.combined-snapshot-tests/v1",successful=py_ok and edge_ok,python=python,edge=edge,source_manifest_sha256=hashlib.sha256(encode(manifest)).hexdigest())
    summary.update(snapshot=manifest["snapshot"],test_files=tests,snapshot_workspace=str(workspace),source_preserved=files_hashes(workspace,before)==before,production_ready=False)
    summary["successful"]=summary["successful"] and summary["source_preserved"]
    create(destination/"verification.json",encode(summary));return summary
def retained_results_destination(destination,workspace,environ):
    """Optionally retain all generated test results under an explicit safe external root."""
    destination=Path(destination);workspace=Path(workspace).resolve(strict=True)
    raw=environ.get("JUNGSI_RETAINED_RESULTS_ROOT")
    if raw is None:
        return destination/"results",{}
    if not isinstance(raw,str) or not raw or not Path(raw).is_absolute():
        raise ValueError("Retained results root must be an absolute directory")
    root=Path(raw)
    if any(p.is_symlink() or p.is_junction() for p in [root,*root.parents]):
        raise ValueError("Retained results root cannot use links or junctions")
    root=root.resolve(strict=True)
    if not root.is_dir() or root.is_relative_to(workspace) or workspace.is_relative_to(root):
        raise ValueError("Retained results root must be separate from the snapshot")
    stamp=destination.name
    if not re.fullmatch(r"[0-9]{8}T[0-9]{12}Z",stamp):
        raise ValueError("Retained run identifier invalid")
    run_root=root/("committed-results-"+stamp)
    run_root.mkdir(exist_ok=False)
    temporary=run_root/"tmp"
    temporary.mkdir(exist_ok=False)
    updates={key:str(temporary) for key in ("TEMP","TMP","TMPDIR")}
    updates["DENO_DIR"]=str(run_root/"deno-cache")
    return run_root/"results",updates

def main():
    parser=argparse.ArgumentParser(description=__doc__);choice=parser.add_mutually_exclusive_group()
    choice.add_argument("--staged",action="store_true");choice.add_argument("--revision")
    parser.add_argument("--deno",default=os.environ.get("JUNGSI_DENO"))
    parser.add_argument("--snapshot-root");parser.add_argument("--source-manifest");parser.add_argument("--output-root")
    args=parser.parse_args()
    if args.snapshot_root:
        if args.staged or args.revision or not args.source_manifest or not args.output_root:raise ValueError("Retained runner arguments incomplete")
        summary=run_retained(Path(args.snapshot_root),json.loads(Path(args.source_manifest).read_bytes()),Path(args.output_root),args.deno)
        print(json.dumps(summary,ensure_ascii=False,indent=2));return 0 if summary["successful"] else 1
    snapshot=GitSnapshot(staged=args.staged,revision=args.revision or (None if args.staged else "HEAD"))
    spec=json.loads(snapshot.text(SPEC_PATH))
    errors=validate_content(snapshot.paths,snapshot.read,spec)+validate_changed_paths(snapshot_changed_paths(snapshot),spec)
    if errors:raise ValueError("Snapshot fails common gate: "+"; ".join(errors))
    # Keep the existing baseline and fixed parent/index checks before executing selected code.
    baseline_errors=validate_snapshot_baseline(snapshot,spec["baseline_commit"])
    if baseline_errors:raise ValueError("Selected snapshot baseline mismatch: "+"; ".join(baseline_errors))
    stamp=datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    destination=ROOT/"outputs/committed_test_runs"/stamp;workspace=destination/"workspace";workspace.mkdir(parents=True,exist_ok=False)
    for name in snapshot.paths:create(workspace/name,snapshot.read(name))
    manifest=dict(format="jungsi.retained-snapshot/v1",snapshot=snapshot.revision or "index",files=files_hashes(workspace,snapshot.paths))
    create(destination/"source_manifest.json",encode(manifest))
    result_directory,temp_env=retained_results_destination(destination,workspace,os.environ)
    argv=[sys.executable,"-B","-X","utf8",str(workspace/"scripts/run_committed_tests.py"),"--snapshot-root",str(workspace),"--source-manifest",str(destination/"source_manifest.json"),"--output-root",str(result_directory)]
    if args.deno:argv+=["--deno",args.deno]
    if temp_env:
        create(destination/"retained_results_location.json",encode(dict(format="jungsi.retained-results-location/v1",directory=str(result_directory),source_manifest_sha256=hashlib.sha256(encode(manifest)).hexdigest())))
    try:
        selected=subprocess.run(argv,cwd=workspace,capture_output=True,env={**os.environ,"PYTHONDONTWRITEBYTECODE":"1",**temp_env},timeout=RETAINED_RUNNER_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired as error:
        create(destination/"runner.stdout",error.stdout or b"");create(destination/"runner.stderr",error.stderr or b"")
        summary=dict(format="jungsi.combined-snapshot-tests/v1",successful=False,status="RETAINED_RUNNER_TIMEOUT",
            timeout=True,snapshot=manifest["snapshot"],source_manifest_sha256=hashlib.sha256(encode(manifest)).hexdigest(),
            retained_results_directory=str(result_directory),production_ready=False)
        create(destination/"runner_failure.json",encode(summary))
        print(json.dumps(summary,ensure_ascii=False,indent=2));return 1
    create(destination/"runner.stdout",selected.stdout);create(destination/"runner.stderr",selected.stderr)
    result_path=result_directory/"verification.json"
    summary=json.loads(result_path.read_bytes()) if result_path.is_file() else dict(successful=False,missing_combined_receipt=True)
    summary["successful"]=selected.returncode==0 and summary.get("successful") is True and summary.get("source_manifest_sha256")==hashlib.sha256(encode(manifest)).hexdigest()
    if temp_env:summary["retained_results_directory"]=str(result_directory)
    if args.staged:snapshot_changed_paths(snapshot)
    print(json.dumps(summary,ensure_ascii=False,indent=2));return 0 if summary["successful"] else 1
if __name__=="__main__":
    try:raise SystemExit(main())
    except (ValueError,KeyError,OSError,subprocess.SubprocessError) as error:
        print("Committed test run failed: "+str(error),file=sys.stderr);raise SystemExit(1)
