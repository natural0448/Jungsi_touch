"""Run only tests/code from the chosen Git index/commit in a new private copy.
Untracked private-data integration tests never enter the copy. No cleanup/delete.
"""
from __future__ import annotations
import argparse,datetime,json,os,subprocess,sys
from pathlib import Path
from check_project_consistency import ROOT,GitSnapshot,validate_content,SPEC_PATH

HELPER="""import importlib.util,json,pathlib,sys,unittest
root=pathlib.Path.cwd()
sys.path.insert(0,str(root/'src'))
sys.path.insert(0,str(root/'scripts'))
sys.path.insert(0,str(root/'tests'))
suite=unittest.TestSuite()
for path in json.load(sys.stdin):
    name='committed_'+path.replace('/','_').replace('.','_')
    spec=importlib.util.spec_from_file_location(name,root/path)
    module=importlib.util.module_from_spec(spec)
    sys.modules[name]=module
    spec.loader.exec_module(module)
    suite.addTests(unittest.defaultTestLoader.loadTestsFromModule(module))
result=unittest.TextTestRunner(verbosity=1).run(suite)
print('JUNGSI_TEST_RESULT='+json.dumps(dict(tests_run=result.testsRun,failures=len(result.failures),errors=len(result.errors),skipped=len(result.skipped),successful=result.wasSuccessful())))
sys.exit(0 if result.wasSuccessful() else 1)
"""

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    choice=parser.add_mutually_exclusive_group()
    choice.add_argument("--staged",action="store_true")
    choice.add_argument("--revision",default=None)
    args=parser.parse_args()
    snapshot=GitSnapshot(staged=args.staged,revision=args.revision or (None if args.staged else "HEAD"))
    spec=json.loads(snapshot.text(SPEC_PATH))
    errors=validate_content(snapshot.paths,snapshot.read,spec)
    if errors:raise ValueError("Snapshot fails consistency validation: "+"; ".join(errors))
    tests=[p for p in snapshot.paths if p.startswith("tests/test_") and p.endswith(".py")]
    if not tests:raise ValueError("No committed tests in the selected snapshot")
    stamp=datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    destination=ROOT/"outputs/committed_test_runs"/stamp
    workspace=destination/"workspace"
    workspace.mkdir(parents=True,exist_ok=False)
    for name in snapshot.paths:
        target=workspace/name;target.parent.mkdir(parents=True,exist_ok=True)
        with target.open("xb") as file:file.write(snapshot.read(name))
    result=subprocess.run([sys.executable,"-B","-X","utf8","-c",HELPER],cwd=workspace,
        input=json.dumps(tests).encode("utf-8"),capture_output=True,env={**os.environ,"PYTHONDONTWRITEBYTECODE":"1"})
    stdout=result.stdout.decode("utf-8",errors="replace")
    stderr=result.stderr.decode("utf-8",errors="replace")
    (destination/"stdout.txt").write_text(stdout,encoding="utf-8")
    (destination/"stderr.txt").write_text(stderr,encoding="utf-8")
    if stderr:sys.stderr.write(stderr)
    summary_lines=[line for line in stdout.splitlines() if line.startswith("JUNGSI_TEST_RESULT=")]
    summary=json.loads(summary_lines[-1].split("=",1)[1]) if summary_lines else {"successful":False,"missing_test_result":True}
    summary.update(snapshot=snapshot.revision or "index",test_files=tests,snapshot_workspace=str(workspace),exit_code=result.returncode)
    (destination/"verification.json").write_text(json.dumps(summary,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(summary,ensure_ascii=False,indent=2))
    return 0 if result.returncode==0 and summary.get("successful") else 1

if __name__=="__main__":
    try:raise SystemExit(main())
    except (ValueError,KeyError,OSError,subprocess.CalledProcessError) as error:
        print("Committed test run failed: "+str(error),file=sys.stderr)
        raise SystemExit(1)
