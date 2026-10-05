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
    def test_generated_work_items_use_current_scope_and_preserve_historical_acceptance(self):
        generated=generated_files(self.spec)
        for path,metadata in self.spec['workflow']['synchronized_work_items'].items():
            with self.subTest(path=path):
                item=json.loads(generated[path])
                self.assertEqual(item['scope'],self.spec[metadata['contract_ref']])
                historical=item['historical_scope_at_adc684_acceptance']
                key='backend_contract_acceptance' if 'backend_contract_acceptance' in historical else 'implementation_acceptance'
                self.assertEqual(historical[key]['develop_integration']['status'],'pending')
                self.assertEqual(item['scope'][key]['develop_integration']['status'],'merged_verified')

    def test_stale_work_item_pending_cannot_replace_current_integrated_scope(self):
        files=self.virtual_files()
        for path in self.spec['workflow']['synchronized_work_items']:
            with self.subTest(path=path):
                changed=dict(files);item=json.loads(changed[path])
                key='backend_contract_acceptance' if 'backend_contract_acceptance' in item['scope'] else 'implementation_acceptance'
                item['scope'][key]['develop_integration']['status']='pending'
                changed[path]=json.dumps(item,ensure_ascii=False,indent=2).encode()
                self.assertIn('Document or route drift: '+path,validate_content(list(changed),changed.__getitem__,self.spec))

    def test_generated_handoff_and_work_item_cannot_expand_to_protected_paths(self):
        wrong=deepcopy(self.spec);records=wrong['workflow']['synchronized_work_items']
        records['outputs/private.json']=records.pop('docs/work_items/DEV-006-analysis-connection.json')
        self.assertIn('Synchronized work-item scope registration drift',validate_spec(wrong))
        wrong=deepcopy(self.spec);wrong['contract_review']['handoff_response']['path']='.env'
        self.assertIn('DEV006 handoff source registration drift',validate_spec(wrong))

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
        self.assertEqual(len(frontend['operations']),len(self.spec['operations']))
        self.assertNotIn('drive_registry',frontend['backend_contract'])
        self.assertNotIn('http_adapter',frontend['operations'][0])
        self.assertNotIn('workflow_service',frontend['operations'][0])

    def test_http_response_reference_cannot_revert_to_stateless_engine(self):
        spec=deepcopy(self.spec)
        next(o for o in spec['operations'] if o['id']=='overall.analyze')['contract_ref']='overall_analysis_contract'
        self.assertIn('HTTP response schema reference drift',validate_spec(spec))

    def test_overall_engine_remains_separate_from_http_workflow(self):
        op=next(o for o in self.spec['operations'] if o['id']=='overall.analyze')
        self.assertEqual(op['engine_service'],self.spec['overall_analysis_contract']['application_service'])
        self.assertNotEqual(op['application_service'],op['engine_service'])
        self.assertEqual(op['http_contract']['response_schema'],'report')

    def test_management_route_requires_server_capability(self):
        spec=deepcopy(self.spec);spec["management_pages"][0]["capabilities"]=[]
        self.assertIn("Management capability required",validate_spec(spec))

    def test_forecast_approval_cannot_be_given_to_paid_members(self):
        spec=deepcopy(self.spec)
        next(o for o in spec["operations"] if o["id"]=="forecast.approve")["operator_capabilities"]=[]
        self.assertIn("Forecast approval capability drift",validate_spec(spec))

    def test_forecast_mutations_require_idempotency_contract(self):
        spec=deepcopy(self.spec)
        next(o for o in spec["operations"] if o["id"]=="forecast.adjust")["http_contract"]["idempotency_key_required"]=False
        self.assertIn("Forecast writes require idempotency",validate_spec(spec))

    def test_new_generated_routes_are_valid_json_and_consumer_pages_unchanged(self):
        files=generated_files(self.spec)
        frontend=json.loads(files["apps/web/route_catalog.json"])
        self.assertEqual([p["number"] for p in frontend["pages"]],[1,2,3,4])
        self.assertEqual(frontend["management_pages"][0]["path"],"/management/forecasts")
        doc=files[self.spec["current_documents"]["forecast_policy"]]
        self.assertIn("학과별".encode("utf-8"),doc)
        self.assertNotIn(bytes([92])+b"n##",doc)

    def test_original_forecast_result_and_receipt_fields_are_required(self):
        spec=deepcopy(self.spec)
        spec['backend_platform_contract']['dto_schemas']['forecast_draft']['fields'].remove('base_result')
        self.assertIn('Forecast original result required',validate_spec(spec))
        spec=deepcopy(self.spec)
        spec['backend_platform_contract']['dto_schemas']['forecast_draft']['nested']['approval'].remove('approval_hash')
        self.assertIn('Forecast receipt field missing: approval.approval_hash',validate_spec(spec))

    def test_wire_contract_cannot_diverge_from_external_frontend_contract(self):
        spec=deepcopy(self.spec)
        spec['presentation_connection_contract']['dto_shapes']['forecast_public']['fields'].append('unregistered')
        self.assertIn('Forecast DTO consumer contract drift: forecast_public',validate_spec(spec))

    def test_public_context_cannot_drop_versions_or_leak_private_fields(self):
        spec=deepcopy(self.spec)
        spec['forecast_policy_contract']['publication_context_contract']['fields'].remove('catalog_version')
        self.assertIn('Forecast context bindings missing or undocumented',validate_spec(spec))
        spec=deepcopy(self.spec)
        spec['backend_platform_contract']['dto_schemas']['forecast_public']['fields'].append('published_by')
        self.assertIn('Private forecast field in public projection',validate_spec(spec))

    def test_student_adoption_requires_same_public_projection_and_versions(self):
        spec=deepcopy(self.spec)
        spec['backend_platform_contract']['dto_schemas']['assessment']['nested']['decision_evidence'].remove('input_version')
        self.assertIn('Assessment forecast versions missing',validate_spec(spec))
        spec=deepcopy(self.spec)
        spec['forecast_policy_contract']['public_response_binding']['same_context_projection']=False
        self.assertIn('Forecast response adoption binding drift',validate_spec(spec))

    def test_display_strings_cannot_become_comparison_values(self):
        spec=deepcopy(self.spec)
        spec['forecast_policy_contract']['exact_numeric_invariants']['display_strings_are_comparison_inputs']=True
        self.assertIn('Forecast exact comparison invariant drift',validate_spec(spec))

    def test_percentile_comparison_cannot_use_total_overall_or_wrong_direction(self):
        spec=deepcopy(self.spec)
        spec['forecast_policy_contract']['comparison_contract']['total_overall_is_allowed_comparator']=True
        self.assertIn('Forecast comparison metric drift',validate_spec(spec))
        spec=deepcopy(self.spec)
        spec['forecast_policy_contract']['comparison_contract']['university_top_percent']['direction']='higher_is_better'
        self.assertIn('Forecast comparison semantics drift: university_top_percent',validate_spec(spec))

    def test_not_applicable_tie_policy_is_distinct_from_missing_policy(self):
        self.assertEqual(validate_spec(self.spec),[])
        spec=deepcopy(self.spec)
        spec['forecast_policy_contract']['comparison_contract']['converted_score'].pop('tie_policy')
        self.assertIn('Forecast comparison semantics drift: converted_score',validate_spec(spec))

    def test_outside_cannot_be_counted_as_pending(self):
        spec=deepcopy(self.spec)
        spec['forecast_policy_contract']['candidate_partition_contract']['outside_offerings']['category']='pending'
        self.assertIn('Forecast candidate partition drift: outside_offerings',validate_spec(spec))

    def test_candidate_cannot_claim_production_db_readiness(self):
        spec=deepcopy(self.spec)
        spec['forecast_policy_contract']['database_readiness'].update(status='passed',production_ready=True)
        self.assertIn('Forecast DB readiness evidence drift',validate_spec(spec))

    def test_reason_kinds_cannot_disappear_and_management_audit_is_explicit(self):
        spec=deepcopy(self.spec)
        spec['forecast_policy_contract']['recommendation_reason_contract']['groups'].pop('conversion_advantage')
        self.assertIn('Forecast reason category drift',validate_spec(spec))
        spec=deepcopy(self.spec)
        spec['backend_platform_contract']['dto_schemas']['forecast_draft']['nested']['audit_events'].append('private_trace')
        self.assertIn('Forecast audit projection drift',validate_spec(spec))

    def test_generated_consumer_contract_preserves_status_and_nested_json(self):
        files=generated_files(self.spec)
        for path in ['apps/web/route_catalog.json','src/jungsi_touch/application/route_catalog.json']:
            content=json.loads(files[path])
            self.assertEqual(content['presentation_connection_contract']['verification_status'],'verification_pending')
            self.assertEqual(content['forecast_policy_contract']['database_readiness']['status'],'NOT_RUN')
            self.assertEqual(len(content['forecast_policy_contract']['publication_context_contract']['fields']),17)
        doc=files[self.spec['current_documents']['presentation_connection']]
        self.assertIn(b'```json\n',doc)
        self.assertIn(b'base_result',doc)

if __name__=="__main__":unittest.main()
