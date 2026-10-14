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
if __name__=="__main__":unittest.main()
