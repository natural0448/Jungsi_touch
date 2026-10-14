"""Run Python and required Edge checks from one retained Git snapshot. No deletion."""
from __future__ import annotations
import argparse,datetime,hashlib,json,os,subprocess,sys
from pathlib import Path
from edge_source_scope import classify_sources
from check_project_consistency import ROOT,GitSnapshot,validate_content,validate_changed_paths,snapshot_changed_paths,validate_snapshot_baseline,SPEC_PATH
HELPER = """import importlib.util,json,pathlib,sys,unittest
root=pathlib.Path.cwd()
sys.path[:0]=[str(root/'src'),str(root/'scripts'),str(root/'tests')]
suite=unittest.TestSuite()
for path in json.load(sys.stdin):
    name='committed_'+path.replace('/','_').replace('.','_')
    spec=importlib.util.spec_from_file_location(name,root/path)
    module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module)
    suite.addTests(unittest.defaultTestLoader.loadTestsFromModule(module))
result=unittest.TextTestRunner(verbosity=1).run(suite)
print('JUNGSI_TEST_RESULT='+json.dumps(dict(tests_run=result.testsRun,failures=len(result.failures),errors=len(result.errors),skipped=len(result.skipped),successful=result.wasSuccessful())))
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
    try:
        result=subprocess.run([sys.executable,"-B","-X","utf8","-c",HELPER],cwd=workspace,input=json.dumps(tests).encode(),capture_output=True,env=env,timeout=900)
    except subprocess.TimeoutExpired as error:
        create(destination/"python.stdout",error.stdout or b"");create(destination/"python.stderr",error.stderr or b"")
        summary=dict(format="jungsi.combined-snapshot-tests/v1",successful=False,python=dict(successful=False,timeout=True),edge=dict(status="NOT_RUN_PYTHON_TIMEOUT"),snapshot=manifest["snapshot"],source_manifest_sha256=hashlib.sha256(encode(manifest)).hexdigest())
        create(destination/"verification.json",encode(summary));return summary
    create(destination/"python.stdout",result.stdout);create(destination/"python.stderr",result.stderr)
    lines=[l for l in result.stdout.decode("utf-8",errors="replace").splitlines() if l.startswith("JUNGSI_TEST_RESULT=")]
    if len(lines)!=1:python=dict(successful=False,missing_or_duplicate_test_result=True)
    else:python=json.loads(lines[0].split("=",1)[1])
    python["exit_code"]=result.returncode
    py_ok=result.returncode==0 and python.get("successful") is True and python.get("tests_run",0)>0 and python.get("skipped",0)==0
    if not py_ok:
        summary=dict(format="jungsi.combined-snapshot-tests/v1",successful=False,python=python,edge=dict(status="NOT_RUN_PYTHON_FAILED"),source_manifest_sha256=hashlib.sha256(encode(manifest)).hexdigest())
    else:
        scope=classify_sources(before,lambda p:(workspace/p).read_bytes(),json.loads((workspace/SPEC_PATH).read_bytes()))
        edge_sources=scope["foundation_active"]
        if edge_sources:
            args=[sys.executable,"-B","-X","utf8",str(workspace/"scripts/run_edge_tests.py"),"--snapshot-root",str(workspace),"--source-manifest",str((destination/"source_manifest.json").resolve()),"--python",sys.executable,"--output-root",str((destination/"edge").resolve())]
            if deno:args+=["--deno",deno]
            edge_process=subprocess.run(args,cwd=workspace,capture_output=True,env=env,timeout=300)
            create(destination/"edge.stdout",edge_process.stdout);create(destination/"edge.stderr",edge_process.stderr)
            p=destination/"edge/edge_run_receipt.json"
            edge=json.loads(p.read_bytes()) if p.is_file() else dict(successful=False,missing_edge_result=True)
            expected_hash=hashlib.sha256(encode(manifest)).hexdigest()
            edge_ok=edge_process.returncode==0 and edge.get("successful") is True and edge.get("status")=="PASS" and edge.get("source_manifest_sha256")==expected_hash
            edge["exit_code"]=edge_process.returncode
        else:
            edge=dict(status="NOT_APPLICABLE_NO_FOUNDATION_SOURCE",edge_execution=False,coexisting_edge_sources=len(scope["coexisting_bound"]),coverage="DEV010_FOUNDATION");edge_ok=True
        summary=dict(format="jungsi.combined-snapshot-tests/v1",successful=py_ok and edge_ok,python=python,edge=edge,source_manifest_sha256=hashlib.sha256(encode(manifest)).hexdigest())
    summary.update(snapshot=manifest["snapshot"],test_files=tests,snapshot_workspace=str(workspace),source_preserved=files_hashes(workspace,before)==before,production_ready=False)
    summary["successful"]=summary["successful"] and summary["source_preserved"]
    create(destination/"verification.json",encode(summary));return summary
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
    argv=[sys.executable,"-B","-X","utf8",str(workspace/"scripts/run_committed_tests.py"),"--snapshot-root",str(workspace),"--source-manifest",str(destination/"source_manifest.json"),"--output-root",str(destination/"results")]
    if args.deno:argv+=["--deno",args.deno]
    selected=subprocess.run(argv,cwd=workspace,capture_output=True,env={**os.environ,"PYTHONDONTWRITEBYTECODE":"1"},timeout=1250)
    create(destination/"runner.stdout",selected.stdout);create(destination/"runner.stderr",selected.stderr)
    result_path=destination/"results/verification.json"
    summary=json.loads(result_path.read_bytes()) if result_path.is_file() else dict(successful=False,missing_combined_receipt=True)
    summary["successful"]=selected.returncode==0 and summary.get("successful") is True and summary.get("source_manifest_sha256")==hashlib.sha256(encode(manifest)).hexdigest()
    if args.staged:snapshot_changed_paths(snapshot)
    print(json.dumps(summary,ensure_ascii=False,indent=2));return 0 if summary["successful"] else 1
if __name__=="__main__":
    try:raise SystemExit(main())
    except (ValueError,KeyError,OSError,subprocess.SubprocessError) as error:
        print("Committed test run failed: "+str(error),file=sys.stderr);raise SystemExit(1)
