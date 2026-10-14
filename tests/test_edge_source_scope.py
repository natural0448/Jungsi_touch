"""Regression cases for coexistence: never treat other Edge code as foundation PASS."""
import copy,hashlib,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from edge_source_scope import SCOPE,ScopeFailure,classify_sources,foundation_present
class EdgeSourceScopeTests(unittest.TestCase):
    def test_required_registry_without_foundation_cannot_report_not_applicable(self):
        _,b,s=self.fixture();s["edge_harness"]["state"]="required"
        with self.assertRaisesRegex(ScopeFailure,"required_foundation_sources_missing"):
            self.check(b,s)
    def fixture(self):
        path="supabase/functions/_shared/synthetic_existing.ts";body=b"export const x=1;\n"
        item=dict(path=path,layer="application",status="synthetic_preexisting",requirements=["REQ-01"],symbols=["x"])
        row={k:item[k] for k in ("path","layer","status","requirements")}
        row.update(source_sha256=hashlib.sha256(body).hexdigest(),declared_exports=["x"])
        spec=dict(edge_harness=dict(state="prepared",source_scope=copy.deepcopy(SCOPE)),
                  implementation=[item],workflow=dict(documentation_sync=dict(code_index=dict(edge_sources=dict(
                    format="jungsi.typescript-source-hash-index/v1",verification="whole_source_hash_not_type_or_runtime_proof",files=[row])))))
        return path,{path:body},spec
    def check(self,bodies,spec):return classify_sources(bodies,bodies.__getitem__,spec)
    def test_existing_index_is_bound_without_foundation_pass(self):
        p,b,s=self.fixture();result=self.check(b,s)
        self.assertFalse(result["foundation_active"]);self.assertEqual(result["coexisting_bound"],[p])
    def test_no_contract_keeps_current_index_gate(self):
        p,b,s=self.fixture();s.pop("edge_harness")
        self.assertFalse(self.check(b,s)["foundation_active"])
    def test_unknown_outside_file_is_rejected(self):
        p,b,s=self.fixture();b["supabase/functions/unknown/index.ts"]=b"export {};"
        with self.assertRaisesRegex(ScopeFailure,"coverage_drift"):self.check(b,s)
    def test_coexisting_body_drift_is_rejected(self):
        p,b,s=self.fixture();b[p]=b"export const x=2;"
        with self.assertRaisesRegex(ScopeFailure,"hash_drift"):self.check(b,s)
    def test_missing_coexisting_index_is_rejected(self):
        p,b,s=self.fixture();s["workflow"]={}
        with self.assertRaisesRegex(ScopeFailure,"index_missing"):self.check(b,s)
    def test_scope_cannot_be_widened_to_hide_sources(self):
        p,b,s=self.fixture();s["edge_harness"]["source_scope"]["source_roots"]=["supabase/"]
        with self.assertRaisesRegex(ScopeFailure,"unsupported_edge_suite_scope"):self.check(b,s)
    def test_duplicate_index_entries_fail_closed(self):
        p,b,s=self.fixture();rows=s["workflow"]["documentation_sync"]["code_index"]["edge_sources"]["files"];rows.append(copy.deepcopy(rows[0]))
        with self.assertRaisesRegex(ScopeFailure,"duplicate"):self.check(b,s)
    def test_registration_owner_drift_is_rejected(self):
        p,b,s=self.fixture();s["implementation"][0]["layer"]="data_infrastructure"
        with self.assertRaisesRegex(ScopeFailure,"registration_drift"):self.check(b,s)
    def test_foundation_and_existing_paths_are_separate(self):
        p,b,s=self.fixture();core="supabase/functions/_shared/jungsi/application/synthetic.ts";b[core]=b"export {};"
        result=self.check(b,s);self.assertTrue(result["foundation_active"]);self.assertEqual(result["foundation_ts"],[core])
    def test_config_only_is_partial_foundation(self):
        p,b,s=self.fixture();b["supabase/functions/deno.json"]=b"{}"
        self.assertTrue(self.check(b,s)["foundation_active"])
    def test_foundation_without_contract_is_rejected(self):
        p,b,s=self.fixture();s.pop("edge_harness");b["tests/edge/synthetic.ts"]=b"export {};"
        with self.assertRaisesRegex(ScopeFailure,"foundation_registry_missing"):self.check(b,s)
    def test_unavailable_outside_manifest_is_rejected(self):
        p,b,s=self.fixture()
        with self.assertRaisesRegex(ScopeFailure,"source_unavailable"):
            classify_sources(b,lambda name:(_ for _ in ()).throw(KeyError(name)),s)
    def test_unsafe_path_is_rejected(self):
        p,b,s=self.fixture();b["supabase/../private.ts"]=b"export {};"
        with self.assertRaisesRegex(ScopeFailure,"unsafe_edge_inventory_path"):self.check(b,s)
    def test_windows_line_endings_use_existing_index_policy(self):
        p,b,s=self.fixture();b[p]=b"export const x=1;\r\n"
        self.assertEqual(self.check(b,s)["coexisting_bound"],[p])
if __name__=="__main__":unittest.main()
