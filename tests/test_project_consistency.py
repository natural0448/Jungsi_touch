"""Catch contract drift, unauthorized paths and layer leakage with virtual edits."""
from copy import deepcopy
import json,sys,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"scripts"))
from check_project_consistency import validate_spec,generated_files,validate_content,protected_path,validate_changed_paths

class ConsistencyTests(unittest.TestCase):
    def setUp(self):
        self.spec=json.loads((ROOT/"docs/current/service_spec.json").read_text(encoding="utf-8"))
    def test_free_access_cannot_be_added_to_paid_page(self):
        spec=deepcopy(self.spec);spec["pages"][2]["member_tiers"]=["standard","paid"]
        self.assertIn("Paid page policy drift",validate_spec(spec))
    def test_paid_search_cannot_require_confirmed_scores(self):
        spec=deepcopy(self.spec)
        op=next(x for x in spec["operations"] if x["id"]=="offerings.search")
        op["confirmed_score_profile"]=True
        self.assertIn("Paid catalog search policy drift",validate_spec(spec))
    def test_report_path_cannot_drop_owner_check(self):
        spec=deepcopy(self.spec)
        op=next(x for x in spec["operations"] if x["id"]=="university.analyze")
        op["report_owner"]=False
        self.assertIn("Report path missing ownership check",validate_spec(spec))
    def test_unknown_requirement_cannot_be_referenced(self):
        spec=deepcopy(self.spec);spec["pages"][0]["requirements"]=["REQ-MISSING"]
        self.assertIn("Unknown requirement reference",validate_spec(spec))
    def test_duplicate_http_route_rejected(self):
        spec=deepcopy(self.spec);spec["operations"].append(deepcopy(spec["operations"][0]))
        self.assertIn("Duplicate API method/path",validate_spec(spec))
    def test_wildcards_layout_cannot_drift(self):
        spec=deepcopy(self.spec);spec["pages"][3]["desktop_columns"]=[1,1]
        self.assertIn("Page4 two-to-one layout drift",validate_spec(spec))
    def test_nested_and_case_variant_private_data_rejected(self):
        for path in ["DATA/private.json","nested/Resource/source.json","backend/datas/scores.json",".env.example","api/.ENV.local","copies/source.XLSX"]:
            self.assertTrue(protected_path(path,self.spec["workflow"]["shared_tools"]),path)
    def test_unreviewed_script_cannot_be_shared(self):
        self.assertTrue(protected_path("scripts/unreviewed_data_patch.py",self.spec["workflow"]["shared_tools"]))
    def virtual_files(self):
        files=generated_files(self.spec)
        files["README.md"]=b"<!-- jungsi:current -->"
        files["AGENTS.md"]=b"docs/current/service_spec.json"
        for path in self.spec["source_documents"]:files.setdefault(path,b"")
        for row in self.spec["implementation"]:
            files.setdefault(row["path"],(ROOT/row["path"]).read_bytes())
        return files
    def test_generated_doc_change_is_detected(self):
        files=self.virtual_files()
        target=self.spec["current_documents"]["routing"];files[target]+=b"changed route\n"
        self.assertIn("Document or route drift: "+target,validate_content(list(files),files.__getitem__,self.spec))
    def test_application_cannot_import_concrete_database_adapter(self):
        files=self.virtual_files()
        path="src/jungsi_touch/application/leak.py"
        files[path]=b"from jungsi_touch.infrastructure import memory_report_repository\n"
        self.assertIn("Application concrete infrastructure import: "+path,validate_content(list(files),files.__getitem__,self.spec))
    def test_ignored_actual_data_checks_cannot_be_force_added(self):
        for path in ["tests/test_university_conversion.py","docs/implementation/analysis.md","docs/planning/2026-09-23-v0.6/검증_기록.json"]:
            self.assertTrue(protected_path(path,self.spec["workflow"]["shared_tools"]))
    def test_code_only_commit_is_rejected(self):
        errors=validate_changed_paths(["src/jungsi_touch/percentile.py"],self.spec)
        self.assertTrue(errors)
    def test_code_with_matching_current_documents_is_accepted(self):
        changed=["src/jungsi_touch/percentile.py","docs/current/service_spec.json",
                 self.spec["current_documents"]["planning"],self.spec["current_documents"]["routing"]]
        self.assertEqual(validate_changed_paths(changed,self.spec),[])
    def test_shared_check_and_schema_are_allowed(self):
        self.assertFalse(protected_path("scripts/check_project_consistency.py",self.spec["workflow"]["shared_tools"]))
        self.assertFalse(protected_path("database/structure.sql",self.spec["workflow"]["shared_tools"]))

    def test_overall_service_must_remain_available_to_standard_and_paid(self):
        spec=deepcopy(self.spec)
        next(row for row in spec["operations"] if row["id"]=="overall.analyze")["member_tiers"]=["paid"]
        self.assertIn("Overall analysis access policy drift",validate_spec(spec))

    def test_overall_http_flag_must_match_registered_platform_adapter(self):
        spec=deepcopy(self.spec)
        spec["overall_analysis_contract"]["http_handler_implemented"]=not spec['overall_analysis_contract']['http_handler_implemented']
        self.assertIn("Overall application boundary drift",validate_spec(spec))

    def test_frontend_contract_contains_dto_without_internal_provider_reference(self):
        generated=generated_files(self.spec)
        public=json.loads(generated["apps/web/route_catalog.json"])["overall_analysis_contract"]
        internal=json.loads(generated["src/jungsi_touch/application/route_catalog.json"])["overall_analysis_contract"]
        self.assertEqual(public["response_fields"],internal["response_fields"])
        self.assertNotIn("application_service",public)
        self.assertNotIn("provider",public)

    def test_backend_readiness_cannot_omit_an_operation(self):
        spec=deepcopy(self.spec);spec['backend_platform_contract']['operation_gaps'].pop()
        self.assertIn('Backend readiness operation drift',validate_spec(spec))

    def test_presentation_api_contract_excludes_internal_adapter_and_registry(self):
        frontend=json.loads(generated_files(self.spec)['apps/web/route_catalog.json'])
        self.assertEqual(len(frontend['operations']),12)
        self.assertNotIn('drive_registry',frontend['backend_contract'])
        self.assertNotIn('http_adapter',frontend['operations'][0])
        self.assertNotIn('workflow_service',frontend['operations'][0])

if __name__=="__main__":unittest.main()
