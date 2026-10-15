"""Catch contract drift, unauthorized paths and layer leakage with virtual edits."""
from copy import deepcopy
import json,sys,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"scripts"))
from check_project_consistency import validate_supabase_deployment_contract,validate_runtime_connection_preparation,validate_public_response_catalog,validate_public_response_registry,PUBLIC_RESPONSE_SCHEMA_PATH,validate_spec,generated_files,validate_content,protected_path,validate_changed_paths,validate_security_contract,validate_frontend_reply_contract,validate_frontend_followup_contract,FRONTEND_REPLY_DOCUMENT,FRONTEND_FOLLOWUP_DOCUMENT,SECURITY_DOCUMENT,SECURITY_CASES,SECURITY_GATES

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
        files["README.md"]=("<!-- jungsi:current -->\n"+SECURITY_DOCUMENT).encode("utf-8")
        files[".github/pull_request_template.md"]=SECURITY_DOCUMENT.encode("utf-8")
        files["AGENTS.md"]=("docs/current/service_spec.json\n<!-- jungsi:security-required -->\n<!-- jungsi:documentation-sync-required -->\n"+SECURITY_DOCUMENT).encode("utf-8")
        files["docs/current/service_spec.json"]=json.dumps(self.spec,ensure_ascii=False).encode("utf-8")
        for path in self.spec["source_documents"]:files.setdefault(path,b"")
        for row in self.spec["implementation"]:
            files.setdefault(row["path"],(ROOT/row["path"]).read_bytes())
        for row in self.spec.get('workflow',{}).get('documentation_sync',{}).get('code_index',{}).get('files',[]):
            files.setdefault(row['path'],(ROOT/row['path']).read_bytes())
        return files
    def test_generated_work_items_use_current_scope_and_preserve_historical_acceptance(self):
        generated=generated_files(self.spec)
        for path,metadata in self.spec['workflow']['synchronized_work_items'].items():
            with self.subTest(path=path):
                item=json.loads(generated[path])
                self.assertEqual(item['scope'],self.spec[metadata['contract_ref']])
                if 'historical_scope_at_adc684_acceptance' not in item:
                    self.assertIn(metadata['contract_ref'],{'secured_backend_preparation_contract','runtime_connection_preparation_contract','supabase_deployment_contract','official_history_db_display_contract'})
                    self.assertEqual(item['scope'],self.spec[metadata['contract_ref']])
                    self.assertFalse(item['scope']['production_ready'])
                    continue
                historical=item['historical_scope_at_adc684_acceptance']
                key='backend_contract_acceptance' if 'backend_contract_acceptance' in historical else 'implementation_acceptance'
                self.assertEqual(historical[key]['develop_integration']['status'],'pending')
                self.assertEqual(item['scope'][key]['develop_integration']['status'],'merged_verified')

    def test_stale_work_item_pending_cannot_replace_current_integrated_scope(self):
        files=self.virtual_files()
        for path in self.spec['workflow']['synchronized_work_items']:
            with self.subTest(path=path):
                changed=dict(files);item=json.loads(changed[path])
                if self.spec['workflow']['synchronized_work_items'][path]['contract_ref'] in {'secured_backend_preparation_contract','runtime_connection_preparation_contract','supabase_deployment_contract','official_history_db_display_contract'}:
                    item['scope']['code_status']='unreviewed_implementation'
                else:
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
    def test_edge_code_only_commit_is_rejected(self):
        self.assertTrue(validate_changed_paths(['supabase/functions/official-history-display/index.ts'],self.spec))
    def test_display_purpose_cannot_disappear_or_enable_operating_engine(self):
        missing=deepcopy(self.spec); missing.pop('official_history_db_display_contract')
        self.assertIn('Official history DB display purpose contract missing',validate_spec(missing))
        for key in ('global_source_flags_changed','local_C_approval_is_cloud_approval','engine_or_forecast_auto_adopted'):
            changed=deepcopy(self.spec); changed['official_history_db_display_contract']['scope'][key]=True
            self.assertIn('Official history DB display approval boundary drift',validate_spec(changed))
    def test_display_RLS_and_bulk_join_cannot_be_disabled(self):
        for key in ('parameterized_bulk_join','row_security_on','enforce_effective_RLS','reject_superuser_bypassrls_owner','verify_view_security_invoker_or_use_direct_RLS_relation'):
            changed=deepcopy(self.spec); changed['official_history_db_display_contract']['query_contract'][key]=False
            self.assertIn('Official history DB display RLS or bulk query boundary drift',validate_spec(changed))
        for key,value in (('data_queries_per_catalog',2),('data_queries_per_catalog',True),('data_queries_per_catalog',1.0),('row_by_row_query_allowed',True),('automatic_unverified_fallback',True)):
            changed=deepcopy(self.spec); changed['official_history_db_display_contract']['query_contract'][key]=value
            self.assertIn('Official history DB display RLS or bulk query boundary drift',validate_spec(changed))
    def test_display_contract_invalid_type_is_rejected(self):
        changed=deepcopy(self.spec); changed['official_history_db_display_contract']=[]
        self.assertIn('Official history DB display purpose contract invalid',validate_spec(changed))
    def test_code_with_matching_current_documents_is_accepted(self):
        changed=["src/jungsi_touch/percentile.py","docs/current/service_spec.json",
                 self.spec["current_documents"]["planning"],self.spec["current_documents"]["routing"]]
        if self.spec['workflow'].get('documentation_sync'):
            changed.extend(self.spec['current_documents'][k] for k in ('architecture','workflow','development_sync'))
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


class LocalVerificationContractTests(unittest.TestCase):
    """Virtual attacks against local preparation, with no private inputs or cleanup."""
    def setUp(self):
        self.spec=json.loads((ROOT/'docs/current/service_spec.json').read_text(encoding='utf-8'))

    def changed(self,path,value):
        spec=deepcopy(self.spec);target=spec['local_verification_contract']
        parts=path.split('.')
        for name in parts[:-1]:target=target[name]
        target[parts[-1]]=value
        return spec

    def test_local_preparation_is_valid_and_guide_is_linked_without_internal_frontend_injection(self):
        self.assertEqual(validate_spec(self.spec),[])
        files=generated_files(self.spec)
        guide=self.spec['current_documents']['local_verification']
        self.assertIn(guide,files)
        self.assertIn('production_ready=false'.encode(),files[guide])
        for key in ('planning','routing','architecture','backend_readiness','presentation_handoff','presentation_connection'):
            with self.subTest(document=key):
                self.assertIn('로컬_검증_연결.md'.encode(),files[self.spec['current_documents'][key]])
        frontend=json.loads(files['apps/web/route_catalog.json'])['local_verification_contract']
        self.assertNotIn('composition',frontend)
        self.assertNotIn('source_provenance',frontend)
        self.assertNotIn('local_filesystem_selection',frontend)
        self.assertEqual(len(self.spec['operations']),22)

    def test_local_guide_cannot_be_redirected_or_contract_removed(self):
        for path in ('.env','outputs/private.md','docs/current/임의가이드.md'):
            with self.subTest(path=path):
                wrong=deepcopy(self.spec);wrong['current_documents']['local_verification']=path
                self.assertIn('Local verification source or document registration drift',validate_spec(wrong))
        wrong=deepcopy(self.spec);wrong.pop('local_verification_contract')
        self.assertIn('Local verification contract required',validate_spec(wrong))

    def test_production_factory_auth_and_writes_cannot_select_local_adapters(self):
        for path,value in (
            ('composition.production_configured_app_unchanged',False),
            ('composition.production_settings_selection_unchanged',False),
            ('composition.local_factory_separate',False),
            ('composition.production_can_select_local_adapter',True),
            ('composition.operational_SQL_or_Drive_result_writes',True),
            ('composition.adopt_or_register_estimated_model',True),
            ('local_auth.production_entry_accepts_local_tokens',True),
            ('network.allow_wildcard_host',True),
            ('network.bind_host','0.0.0.0'),
            ('network.CORS','*'),
            ('network.proxy_headers',True),
            ('network.forwarded_headers_allowed',True),
        ):
            with self.subTest(path=path):
                self.assertIn('Local verification invariant drift: '+path,validate_spec(self.changed(path,value)))

    def test_client_paid_staff_and_self_approval_cannot_override_server_scope(self):
        for path,value in (
            ('local_auth.server_allowlist_only',False),
            ('local_auth.client_role_or_paid_fields_authoritative',True),
            ('local_auth.profiles',['standard','paid','operator']),
            ('local_auth.distinct_subjects_required',False),
            ('local_auth.staff_is_paid',True),
            ('local_auth.session_issue_required',False),
            ('local_auth.maximum_TTL_hours',24),
            ('local_auth.operator_university_allowlist_default','all'),
            ('independent_approval.existing_policy_unchanged',False),
            ('independent_approval.distinct_editor_and_approver_subjects',False),
            ('independent_approval.self_approval_expected_HTTP',200),
        ):
            with self.subTest(path=path):
                self.assertIn('Local verification invariant drift: '+path,validate_spec(self.changed(path,value)))

    def test_hashes_receipts_and_source_identity_cannot_be_self_approved_or_aliased(self):
        for path,value in (
            ('data_authority.drive_requires_trusted_registry_sha256',False),
            ('data_authority.local_requires_trusted_selection_sha256',False),
            ('data_authority.explicit_engine_approved_requires_exact_true',None),
            ('data_authority.automatic_status_promotion',True),
            ('data_authority.source_completion_is_engine_approval',True),
            ('source_provenance.trusted_receipt_sha256_required',False),
            ('source_provenance.every_read_revalidation',False),
            ('source_provenance.fabricate_drive_metadata_for_filesystem',True),
            ('local_filesystem_selection.fake_Google_file_id_or_drive_version_or_parents',True),
            ('local_filesystem_selection.approval_scope_is_production_approval',True),
            ('local_filesystem_selection.approval_fields.scope','production'),
            ('local_filesystem_selection.approval_fields.artifacts',['local_artifact_id']),
        ):
            with self.subTest(path=path):
                self.assertIn('Local verification invariant drift: '+path,validate_spec(self.changed(path,value)))
        for path,missing in (('source_provenance.drive_required','drive_version'),
                             ('source_provenance.local_required','source_receipt_sha256'),
                             ('local_filesystem_selection.entry_fields','approval_evidence_sha256')):
            with self.subTest(path=path,missing=missing):
                original=self.spec['local_verification_contract']
                for part in path.split('.'):original=original[part]
                self.assertIn('Local verification receipt or diagnostic fields drift: '+path,
                              validate_spec(self.changed(path,[x for x in original if x!=missing])))

    def test_dpapi_receiving_user_and_plaintext_preservation_cannot_be_weakened(self):
        for path,value in (
            ('encryption.scope','local_machine'),
            ('encryption.CRYPTPROTECT_LOCAL_MACHINE',True),
            ('encryption.recipient_encrypts_on_recipient_PC',False),
            ('encryption.encryption_key_sharing',True),
            ('encryption.new_plaintext_disk_write',True),
            ('encryption.delete_existing_plaintext_originals',True),
            ('encryption.decrypt_success_is_approval',True),
            ('encryption.no_payload_key_in_logs_or_receipts',False),
            ('private_git_boundary.real_payloads_env_and_registry_in_git',True),
        ):
            with self.subTest(path=path):
                self.assertIn('Local verification invariant drift: '+path,validate_spec(self.changed(path,value)))

    def test_memory_ready_and_numeric_hold_are_not_operational_acceptance(self):
        for path,value in (
            ('storage.DB_verified',True),
            ('storage.restart_loses_state',False),
            ('storage.DB002','verified'),
            ('health.production_ready',True),
            ('implementation_acceptance.production_ready',True),
            ('implementation_acceptance.actual_model_operating_registration',True),
            ('health.real_Supabase','verified'),
            ('health.local_ready_is_production_ready',True),
            ('score_results.missing_approved_curve','estimated'),
            ('score_results.preserve_successful_total',False),
            ('score_results.invent_numeric_expected_result',True),
            ('api_boundary.operation_count',23),
            ('api_boundary.nullable_unchanged',False),
        ):
            with self.subTest(path=path):
                self.assertIn('Local verification invariant drift: '+path,validate_spec(self.changed(path,value)))

    def test_null_numeric_and_string_flags_fail_closed_instead_of_boolean_coercion(self):
        for path in ('encryption.CRYPTPROTECT_LOCAL_MACHINE','health.production_ready',
                     'composition.production_can_select_local_adapter',
                     'data_authority.local_requires_trusted_selection_sha256'):
            for value in (None,0,1,'false','true'):
                with self.subTest(path=path,value=value):
                    self.assertIn('Local verification invariant drift: '+path,validate_spec(self.changed(path,value)))
        wrong=self.changed('source_provenance.drive_required',['registry_sha256',False])
        self.assertIn('Local verification receipt or diagnostic fields drift: source_provenance.drive_required',validate_spec(wrong))


class SecurityContractTests(unittest.TestCase):
    def setUp(self):
        self.spec=json.loads((ROOT/"docs/current/service_spec.json").read_text(encoding="utf-8"))
    virtual_files=ConsistencyTests.virtual_files

    def test_security_contract_is_mandatory_not_an_optional_extension(self):
        wrong=deepcopy(self.spec);wrong.pop("security_contract")
        self.assertIn("Required external security contract absent",validate_spec(wrong))

    def test_security_document_cannot_be_unregistered_or_moved_to_private_output(self):
        for target in ("outputs/security.md",".env","docs/current/optional_security.md"):
            with self.subTest(target=target):
                wrong=deepcopy(self.spec)
                wrong["security_contract"]["document"]=target
                wrong["current_documents"]["external_security"]=target
                wrong["workflow"]["development_harness"]["security_document"]=target
                self.assertIn("Mandatory security document registration drift",validate_spec(wrong))

    def test_security_harness_cannot_be_disabled_or_drop_required_reading(self):
        wrong=deepcopy(self.spec);wrong["workflow"].pop("development_harness")
        self.assertIn("Mandatory security harness registration drift",validate_spec(wrong))
        for key,value in (("security_required",False),("invariants_required",1),("required_documents",[])):
            with self.subTest(key=key):
                wrong=deepcopy(self.spec);wrong["workflow"]["development_harness"][key]=value
                self.assertIn("Mandatory security harness registration drift",validate_spec(wrong))

    def test_security_flags_preserve_true_type_for_each_invariant(self):
        for flag in self.spec["security_contract"]["invariants"]:
            for value in (False,None,1,"true"):
                with self.subTest(flag=flag,value=value):
                    wrong=deepcopy(self.spec);wrong["security_contract"]["invariants"][flag]=value
                    self.assertIn("Security invariant missing or weakened",validate_security_contract(wrong))

    def test_every_operation_must_keep_all_required_security_controls(self):
        for op in self.spec["operations"]:
            wrong=deepcopy(self.spec)
            changed=next(o for o in wrong["operations"] if o["id"]==op["id"])
            changed.pop("security_policy")
            self.assertIn("Operation security policy drift: "+op["id"],validate_security_contract(wrong))

    def test_free_overall_profile_and_paid_candidates_cannot_bypass_quota(self):
        for identifier in ("overall.analyze","score-profile.create","candidates.build"):
            with self.subTest(identifier=identifier):
                wrong=deepcopy(self.spec)
                wrong["security_contract"]["quota_policy"]["analysis_operations"].remove(identifier)
                self.assertIn("Free or paid security quota coverage drift",validate_security_contract(wrong))
                wrong=deepcopy(self.spec)
                op=next(o for o in wrong["operations"] if o["id"]==identifier)
                op["security_policy"]["control_ids"].remove("SEC-06")
                self.assertIn("Operation security policy drift: "+identifier,validate_security_contract(wrong))

    def test_quota_cannot_switch_to_id_or_session_keys_or_per_worker_memory(self):
        for key,value,error in [
            ("identity",["JWT","profile_id","period"],"Security quota identity drift"),
            ("input_paths",["owned_profile_id"],"Security quota input path bypass"),
            ("input_paths",["direct_scores"],"Security quota input path bypass"),
            ("rotation_does_not_reset",["JWT"],"Shared quota persistence or rotation drift"),
            ("storage","memory_per_worker","Shared quota persistence or rotation drift"),
            ("cache_binding",["normalized_scores"],"Security cache identity or version binding drift"),
        ]:
            with self.subTest(key=key,value=value):
                wrong=deepcopy(self.spec);wrong["security_contract"]["quota_policy"][key]=value
                self.assertIn(error,validate_security_contract(wrong))

    def test_no_operational_threshold_or_unlimited_default_can_be_committed(self):
        for value in (0,100,"unlimited"):
            wrong=deepcopy(self.spec);wrong["security_contract"]["quota_policy"]["limits"]["distinct_scores"]=value
            self.assertIn("Operational quota values must stay private and unset in Git",validate_security_contract(wrong))

    def test_origin_or_machine_identity_alone_cannot_authorize_analysis(self):
        for key,value in (("mode","cors"),("server_identity_required",False),
                          ("user_authorization_in_application_required",False),
                          ("direct_browser_analysis_allowed",True),("credentials_in_browser_allowed",True)):
            wrong=deepcopy(self.spec);wrong["security_contract"]["gateway_policy"][key]=value
            self.assertIn("Authenticated relay security drift",validate_security_contract(wrong))

    def test_response_boundary_covers_recursive_error_replay_export_and_staff_dto(self):
        wrong=deepcopy(self.spec);wrong["security_contract"]["response_boundary"]["covers"].remove("idempotent_replay")
        self.assertIn("Recursive response boundary drift",validate_security_contract(wrong))
        boundary=self.spec["security_contract"]["response_boundary"]
        self.assertTrue(any("직원" in value["description"] for value in boundary["preserve"]))
        self.assertTrue(self.spec["security_contract"]["invariants"]["successful_score_pending_judgment_preserved"])

    def test_required_security_gates_cannot_disappear_even_if_both_lists_are_edited(self):
        for key in SECURITY_GATES:
            wrong=deepcopy(self.spec)
            wrong["security_contract"]["mandatory_release_gates"].remove(key)
            gate=wrong["workflow"]["branch_governance"]["release_gate"]
            gate["checks"]=[r for r in gate["checks"] if r["id"]!=key]
            self.assertIn("Mandatory security release gate absent or duplicated",validate_security_contract(wrong))

    def test_security_passed_and_ready_cannot_be_claimed_without_runtime_evidence(self):
        wrong=deepcopy(self.spec)
        for gate in wrong["workflow"]["branch_governance"]["release_gate"]["checks"]:
            if gate["id"] in SECURITY_GATES:gate["status"]="passed"
        wrong["security_contract"]["production_ready"]=True
        wrong["security_contract"]["implementation_status"]="implemented"
        errors=validate_security_contract(wrong)
        self.assertIn("Security production readiness lacks all required acceptance",errors)
        self.assertIn("Security implementation readiness lacks evidence",errors)
        self.assertTrue(any("Security release gate lacks" in error for error in errors))

    def test_contract_harness_evidence_cannot_stand_in_for_browser_or_operational_db(self):
        wrong=deepcopy(self.spec);c=wrong["security_contract"]
        commit="a"*40;c["implementation_commit"]=commit
        c["acceptance_evidence"]=[{"case_id":"SEC-QA-02","control":"SEC-02","scope":"contract_harness",
            "result":"passed","implementation_commit":commit,"policy_revision":c["revision"],
            "evidence_ref":"synthetic-review"}]
        c["controls"][1]["implementation_status"]="implemented"
        self.assertIn("Security evidence incomplete or mismatched",validate_security_contract(wrong))
        self.assertIn("Security control completion lacks scoped evidence: SEC-02",validate_security_contract(wrong))

    def test_security_evidence_must_bind_to_one_implementation_and_policy_revision(self):
        for mutation in ("wrong_commit","old_revision","missing_ref"):
            wrong=deepcopy(self.spec);c=wrong["security_contract"];c["implementation_commit"]="a"*40
            row={"case_id":"SEC-QA-08","control":"SEC-08","scope":"contract_harness",
                 "result":"passed","implementation_commit":"a"*40,"policy_revision":c["revision"],
                 "evidence_ref":"synthetic-review"}
            if mutation=="wrong_commit":row["implementation_commit"]="b"*40
            elif mutation=="old_revision":row["policy_revision"]="old-policy"
            else:row.pop("evidence_ref")
            c["acceptance_evidence"]=[row]
            errors=validate_security_contract(wrong)
            self.assertTrue(any(error.startswith("Security evidence") for error in errors),mutation)

    def future_security_candidate(self):

        candidate=deepcopy(self.spec);c=candidate["security_contract"];commit="a"*40
        c["implementation_commit"]=commit;c["implementation_status"]="implemented"
        c["production_ready"]=True;c["status"]="accepted"
        c["quota_policy"]["policy_values_status"]="approved_private_runtime_configuration"
        for row in c["controls"]:
            row["implementation_status"]="implemented";row["operational_verification"]="passed"
        c["acceptance_evidence"]=[{"case_id":key,"control":value[0],"scope":value[1],"result":"passed",
            "implementation_commit":commit,"policy_revision":c["revision"],"evidence_ref":"synthetic-fixture-only"}
            for key,value in SECURITY_CASES.items()]
        for gate in candidate["workflow"]["branch_governance"]["release_gate"]["checks"]:
            if gate["id"] in SECURITY_GATES:gate["status"]="passed"
        for op in candidate["operations"]:op["security_policy"]["enforcement_status"]="implemented"
        c["gateway_policy"]["implementation_status"]="implemented"
        for row in c["planned_errors"]:row["status"]="implemented"
        candidate["routing_policy"]["security_enforcement_status"]="implemented"
        for key in ("backend_platform_contract","presentation_connection_contract","supabase_operations_handoff_contract"):
            candidate[key]["security_transition_status"]="implemented"
        return candidate

    def test_security_evidence_can_represent_a_reviewed_future_candidate_without_false_current_acceptance(self):
        candidate=self.future_security_candidate()
        self.assertEqual(validate_security_contract(candidate),[])
        self.assertFalse(self.spec["security_contract"]["production_ready"])
        self.assertEqual(self.spec["security_contract"]["acceptance_evidence"],[])


    def test_error_catalog_projection_does_not_copy_unregistered_internal_fields(self):
        wrong=deepcopy(self.spec)
        wrong["security_contract"]["planned_errors"][0]["internal_debug"]={"private_storage":"synthetic-private-value"}
        public=json.loads(generated_files(wrong)["apps/web/route_catalog.json"])["security_contract"]
        self.assertNotIn("internal_debug",public["planned_errors"][0])
        self.assertNotIn("synthetic-private-value",json.dumps(public))
        self.assertIn("Security planned error contract drift: rate_limit_exceeded",validate_security_contract(wrong))

    def test_unknown_and_duplicate_security_errors_are_rejected(self):
        for duplicate in (False,True):
            wrong=deepcopy(self.spec);row=deepcopy(wrong["security_contract"]["planned_errors"][0])
            if not duplicate:row["code"]="unexpected_debug"
            wrong["security_contract"]["planned_errors"].append(row)
            self.assertIn("Security planned errors missing unknown or duplicated",validate_security_contract(wrong))

    def test_complete_security_requires_implemented_operations_gateway_errors_and_route_transition(self):
        for target in ("operation","gateway","error","routing","handoff"):
            with self.subTest(target=target):
                wrong=self.future_security_candidate()
                if target=="operation":wrong["operations"][0]["security_policy"]["enforcement_status"]="pending_runtime_implementation"
                elif target=="gateway":wrong["security_contract"]["gateway_policy"]["implementation_status"]="pending"
                elif target=="error":wrong["security_contract"]["planned_errors"][0]["status"]="planned_not_implemented"
                elif target=="routing":wrong["routing_policy"]["security_enforcement_status"]="pending_runtime_implementation"
                else:wrong["presentation_connection_contract"]["security_transition_status"]="pending_runtime_implementation"
                self.assertIn("Completed security runtime state drift",validate_security_contract(wrong))

    def test_operational_passed_evidence_cannot_hide_not_run_or_failed_verification(self):
        for control in ("SEC-02","SEC-04","SEC-06"):
            for state in ("NOT_RUN","failed"):
                wrong=self.future_security_candidate()
                next(r for r in wrong["security_contract"]["controls"] if r["id"]==control)["operational_verification"]=state
                self.assertIn("Security evidence contradicts verification state: "+control,validate_security_contract(wrong))

    def test_duplicate_and_conflicting_current_acceptance_evidence_is_rejected(self):
        for result in ("passed","failed","NOT_RUN"):
            wrong=self.future_security_candidate();row=deepcopy(wrong["security_contract"]["acceptance_evidence"][0])
            row["result"]=result;wrong["security_contract"]["acceptance_evidence"].append(row)
            self.assertIn("Security evidence duplicated or conflicting",validate_security_contract(wrong))

    def test_shortlist_response_cannot_bypass_shared_result_volume_quota(self):
        wrong=deepcopy(self.spec);wrong["security_contract"]["quota_policy"]["read_operations"].remove("shortlist.update")
        self.assertIn("Free or paid security quota coverage drift",validate_security_contract(wrong))
        wrong=deepcopy(self.spec)
        op=next(o for o in wrong["operations"] if o["id"]=="shortlist.update")
        op["security_policy"]["control_ids"].remove("SEC-05")
        self.assertIn("Operation security policy drift: shortlist.update",validate_security_contract(wrong))

    def test_boundary_categories_cannot_be_empty_duplicate_missing_or_untyped(self):
        for category in ("forbidden","preserve"):
            for mutation in ("empty","duplicate","missing","untyped"):
                wrong=deepcopy(self.spec);rows=wrong["security_contract"]["response_boundary"][category]
                if mutation=="empty":
                    for row in rows:row["description"]=" "
                elif mutation=="duplicate":rows[-1]=deepcopy(rows[0])
                elif mutation=="missing":rows.pop()
                else:rows[0]=""
                self.assertIn("Mandatory response boundary category drift: "+category,validate_security_contract(wrong))
        wrong=deepcopy(self.spec);wrong["security_contract"]["acceptance_cases"][0]["expected"]=""
        self.assertIn("Mandatory security acceptance cases drift",validate_security_contract(wrong))

    def test_security_document_includes_staff_scope_independent_approval_and_owner_rights(self):
        doc=generated_files(self.spec)[SECURITY_DOCUMENT].decode("utf-8")
        for identifier,requirements in (
            ("forecast.create",["editor","허용 학교 scope"]),
            ("forecast.approve",["approver","독립","자기승인 거절","허용 학교 scope"]),
            ("forecast.publish",["approver","독립","자기승인 거절","허용 학교 scope"]),
            ("report.read",["본인 소유"]),
        ):
            row=next(line for line in doc.splitlines() if line.startswith("| "+identifier+" |"))
            for required in requirements:self.assertIn(required,row)
        self.assertTrue(self.spec["security_contract"]["invariants"]["role_specific_management_receipts_preserved"])

    def test_server_relay_ownership_preserves_external_frontend_and_service_branches(self):
        wrong=deepcopy(self.spec)
        wrong["security_contract"]["gateway_policy"]["owner_roles"][0]["branch"]="feature/application-pre-data-platform"
        self.assertIn("Relay owner split drift",validate_security_contract(wrong))

    def test_mandatory_security_document_and_agents_reference_are_checked_in_same_snapshot(self):
        for kind in ("missing_document","drifted_document","missing_agents_marker","missing_agents_link"):
            with self.subTest(kind=kind):
                files=self.virtual_files()
                if kind=="missing_document":
                    files.pop(SECURITY_DOCUMENT);expected="Missing generated file: "+SECURITY_DOCUMENT
                elif kind=="drifted_document":
                    files[SECURITY_DOCUMENT]+=b"unexpected";expected="Document or route drift: "+SECURITY_DOCUMENT
                else:
                    files["AGENTS.md"]=(b"docs/current/service_spec.json" if kind=="missing_agents_marker" else
                                        b"docs/current/service_spec.json\\n<!-- jungsi:security-required -->")
                    expected="AGENTS missing mandatory security reference"
                self.assertIn(expected,validate_content(list(files),files.__getitem__,self.spec))

    def test_security_readme_and_pr_entry_points_cannot_lose_mandatory_link(self):
        for path in ("README.md",".github/pull_request_template.md"):
            files=self.virtual_files();files[path]=b"<!-- jungsi:current -->"
            self.assertIn("Mandatory security entry point absent: "+path,
                          validate_content(list(files),files.__getitem__,self.spec))

    def test_catalogs_publish_matching_policy_references_without_private_storage_or_thresholds(self):
        files=generated_files(self.spec)
        frontend=json.loads(files["apps/web/route_catalog.json"])
        backend=json.loads(files["src/jungsi_touch/application/route_catalog.json"])
        self.assertEqual(frontend["security_contract"],backend["security_contract"])
        public=frontend["security_contract"]
        for forbidden in ("quota_policy","identity","limits","cache_binding","storage","acceptance_evidence"):
            self.assertNotIn(forbidden,public)
        self.assertEqual(frontend["mandatory_security_document"],SECURITY_DOCUMENT)
        for op in frontend["operations"]:
            canonical=next(o for o in self.spec["operations"] if o["id"]==op["id"])
            self.assertEqual(op["security_policy"],canonical["security_policy"])

    def test_frontend_reply_cannot_disappear_from_current_spec(self):
        self.assertEqual(validate_frontend_reply_contract(self.spec),[])
        wrong=deepcopy(self.spec);wrong['supabase_operations_handoff_contract'].pop('reply_contract')
        self.assertIn('Frontend reply contract missing',validate_spec(wrong))

    def test_frontend_reply_cannot_point_to_a_different_or_private_document(self):
        for field in ('contract','registration'):
            wrong=deepcopy(self.spec)
            if field=='contract':wrong['supabase_operations_handoff_contract']['reply_contract']['document']='outputs/private.md'
            else:wrong['current_documents']['frontend_reply']='outputs/private.md'
            self.assertIn('Frontend reply source registration drift',validate_frontend_reply_contract(wrong))

    def test_frontend_reply_missing_or_duplicated_work_item_is_rejected(self):
        for mutation in ('missing','duplicate','invalid_type'):
            wrong=deepcopy(self.spec);items=wrong['supabase_operations_handoff_contract']['reply_contract']['items']
            if mutation=='missing':items.pop()
            elif mutation=='duplicate':items[-1]=deepcopy(items[0])
            else:items[0]['id']=[]
            self.assertIn('Frontend reply six work items incomplete',validate_frontend_reply_contract(wrong))

    def test_frontend_reply_must_assign_owners_inputs_dependencies_and_evidence(self):
        for field in ('owners','requested_reply','our_answer','dependencies','completion_evidence'):
            for invalid in ([],[' '],'untyped'):
                wrong=deepcopy(self.spec);row=wrong['supabase_operations_handoff_contract']['reply_contract']['items'][0];row[field]=invalid
                self.assertIn('Frontend reply work item incomplete: '+row['id']+'/'+field,validate_frontend_reply_contract(wrong))

    def test_frontend_reply_cannot_invent_or_duplicate_an_api_operation(self):
        for refs in (['not.registered'],['session.read','session.read'],[]):
            wrong=deepcopy(self.spec);row=wrong['supabase_operations_handoff_contract']['reply_contract']['items'][0];row['route_refs']=refs
            self.assertIn('Frontend reply operation reference drift: '+row['id'],validate_frontend_reply_contract(wrong))

    def test_frontend_reply_requires_all_six_original_local_answers(self):
        for mutation in ('missing','duplicate','untyped'):
            wrong=deepcopy(self.spec);rows=wrong['supabase_operations_handoff_contract']['reply_contract']['local_request_answers']
            if mutation=='missing':rows.pop()
            elif mutation=='duplicate':rows[-1]=deepcopy(rows[0])
            else:rows[0]['number']=True
            self.assertIn('Frontend reply six local answers incomplete',validate_frontend_reply_contract(wrong))

    def test_frontend_reply_local_answer_cannot_drop_boundary_or_completion_evidence(self):
        for field in ('our_answer','dependencies','completion_evidence'):
            wrong=deepcopy(self.spec);row=wrong['supabase_operations_handoff_contract']['reply_contract']['local_request_answers'][0];row[field]=[]
            self.assertIn('Frontend reply local answer incomplete: '+str(row['number'])+'/'+field,validate_frontend_reply_contract(wrong))

    def test_frontend_reply_final_document_cannot_claim_pending_work_is_operational(self):
        wrong=deepcopy(self.spec);wrong['supabase_operations_handoff_contract']['production_ready']=True
        self.assertIn('Frontend reply pending work cannot certify production readiness',validate_frontend_reply_contract(wrong))
        wrong=deepcopy(self.spec);row=wrong['supabase_operations_handoff_contract']['reply_contract']['items'][0];row['status']='completed'
        self.assertIn('Frontend reply work item status drift: '+row['id'],validate_frontend_reply_contract(wrong))

    def test_frontend_reply_target_adoption_cannot_silently_replace_current_adapter(self):
        wrong=deepcopy(self.spec);a=wrong['supabase_operations_handoff_contract']['architecture'];a['current_entitlement_adapter']['table']='public.jeongsi_passes'
        self.assertIn('Frontend reply current adapter boundary drift',validate_frontend_reply_contract(wrong))
        wrong=deepcopy(self.spec);wrong['supabase_operations_handoff_contract']['architecture']['authority_target']='jungsi_backend.entitlements'
        self.assertIn('Frontend reply adopted authority target drift',validate_frontend_reply_contract(wrong))

    def test_frontend_reply_confirmed_deployment_cannot_revert_to_unselected_or_run(self):
        for field,value in (('selection','not_selected'),('deployment_status','passed')):
            wrong=deepcopy(self.spec);wrong['supabase_operations_handoff_contract']['architecture'][field]=value
            self.assertIn('Frontend reply deployment decision boundary drift',validate_frontend_reply_contract(wrong))

    def test_frontend_reply_requires_exact_start_commit_and_unresolved_inputs(self):
        wrong=deepcopy(self.spec);r=wrong['supabase_operations_handoff_contract']['reply_contract'];r['basis_commit']='e764583'
        self.assertIn('Frontend reply basis commit invalid',validate_frontend_reply_contract(wrong))
        wrong=deepcopy(self.spec);wrong['supabase_operations_handoff_contract']['reply_contract']['unresolved']=[]
        self.assertIn('Frontend reply unresolved inputs missing',validate_frontend_reply_contract(wrong))

    def test_frontend_reply_is_generated_and_cannot_drift_independently(self):
        files=self.virtual_files();self.assertIn(FRONTEND_REPLY_DOCUMENT,files)
        files[FRONTEND_REPLY_DOCUMENT]+=b'completed live connection\n'
        self.assertIn('Document or route drift: '+FRONTEND_REPLY_DOCUMENT,validate_content(list(files),files.__getitem__,self.spec))

    def test_frontend_reply_and_restart_loss_are_direct_handoff_references(self):
        files=generated_files(self.spec)
        for key in ('planning','routing','architecture','backend_readiness','presentation_handoff','presentation_connection'):
            with self.subTest(document=key):
                body=files[self.spec['current_documents'][key]].decode('utf-8')
                self.assertIn('화면팀_회신요청_최종.md',body)
                self.assertIn('서버 재시작 시 사라진다',body)

    def test_frontend_followup_requires_all_five_owner_tasks(self):
        self.assertEqual(validate_frontend_followup_contract(self.spec),[])
        wrong=deepcopy(self.spec);wrong['supabase_operations_handoff_contract']['reply_contract']['followup']['tasks'].pop()
        self.assertIn('Frontend followup five tasks incomplete',validate_spec(wrong))

    def test_frontend_followup_cannot_claim_pending_browser_or_integration_as_completed(self):
        wrong=deepcopy(self.spec);row=wrong['supabase_operations_handoff_contract']['reply_contract']['followup']['tasks'][-1];row['status']='completed'
        self.assertIn('Frontend followup work status drift: '+row['id'],validate_spec(wrong))
        wrong=deepcopy(self.spec);wrong['supabase_operations_handoff_contract']['reply_contract']['followup']['basis_commit']='e764583'
        self.assertIn('Frontend followup basis commit drift',validate_spec(wrong))

    def test_frontend_followup_cannot_omit_concrete_sup_reply_and_review_boundaries(self):
        for field in ('sup_reply','local_review_boundary','unresolved'):
            wrong=deepcopy(self.spec);wrong['supabase_operations_handoff_contract']['reply_contract']['followup'][field]=[]
            self.assertTrue(any('Frontend followup' in v for v in validate_spec(wrong)))

    def test_frontend_followup_work_must_keep_inputs_evidence_and_public_operation_scope(self):
        for field,value in (('owner',''),('work',[]),('completion',[]),('route_refs',['private.dump']),('depends_on',None)):
            wrong=deepcopy(self.spec);row=wrong['supabase_operations_handoff_contract']['reply_contract']['followup']['tasks'][0];row[field]=value
            self.assertTrue(any('Frontend followup' in v for v in validate_spec(wrong)))

    def test_frontend_followup_is_generated_and_referenced_by_planning_and_routing(self):
        files=self.virtual_files();self.assertIn(FRONTEND_FOLLOWUP_DOCUMENT,files)
        for key in ('planning','routing','presentation_handoff'):
            self.assertIn('화면팀_후속작업_지시.md',files[self.spec['current_documents'][key]].decode('utf-8'))
        files[FRONTEND_FOLLOWUP_DOCUMENT]+=b'operational pass\n'
        self.assertIn('Document or route drift: '+FRONTEND_FOLLOWUP_DOCUMENT,validate_content(list(files),files.__getitem__,self.spec))

    def test_branch_documents_use_source_observation_without_fixed_unmerged_claim(self):
        spec=deepcopy(self.spec)
        spec['collaboration']['presentation_branch_status']='SOURCE_PRESENTATION_STATE_PENDING_BROWSER'
        observation=spec['workflow']['branch_governance']['remote_inventory']['latest_observation']
        observation['develop']='1234567890abcdef1234567890abcdef12345678'
        files=generated_files(spec)
        body=files[spec['current_documents']['workflow']].decode('utf-8')
        self.assertIn('SOURCE_PRESENTATION_STATE_PENDING_BROWSER',body)
        self.assertIn('최신 통합 관측일 '+observation['date']+', develop '+observation['develop'],body)
        self.assertIn('정책 등록일 ',body)
        self.assertIn('현재 원격 전체 ref 재조회 결과와 구분한다',body)
        self.assertNotIn('열린 PR #6의 화면 변경은 develop의 현재 구현이 아니다',body)

    def test_previous_acceptance_uses_retained_historical_observation(self):
        spec=deepcopy(self.spec)
        inventory=spec['workflow']['branch_governance']['remote_inventory']
        historical=inventory['historical_observation_before_PR6_merge']
        historical['frontend']='HISTORICAL_FRONTEND_ONLY'
        historical['sameRelease_observation']='HISTORICAL_RELEASE_OBSERVATION_ONLY'
        inventory['latest_observation'].pop('frontend',None)
        inventory['latest_observation'].pop('sameRelease_observation',None)
        body=generated_files(spec)[spec['current_documents']['workflow']].decode('utf-8')
        self.assertIn('당시 외부 프런트 관측 / HISTORICAL_FRONTEND_ONLY; HISTORICAL_RELEASE_OBSERVATION_ONLY',body.replace('|','/'))



class SnapshotChangedPathsTests(unittest.TestCase):
    """Retain independent synthetic Git DAGs; never edit or clean the real repository."""
    @classmethod
    def setUpClass(cls):
        import datetime
        cls.fixture_root=ROOT/"outputs/consistency_merge_fixtures"/datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        cls.fixture_root.mkdir(parents=True,exist_ok=False)
        cls.fixture_number=0

    def setUp(self):
        import os
        from unittest.mock import patch
        import check_project_consistency as checker
        # Git hooks export repository/index variables. Synthetic DAGs must stay independent.
        isolated={k:v for k,v in os.environ.items() if not k.startswith("GIT_")}
        isolation=patch.dict(os.environ,isolated,clear=True)
        isolation.start();self.addCleanup(isolation.stop)
        self.checker=checker
        type(self).fixture_number+=1
        self.repo=self.fixture_root/str(type(self).fixture_number)
        self.repo.mkdir()
        self.call("init","-q","-b","develop")
        self.call("config","core.longpaths","true")
        self.call("config","user.name","Synthetic consistency fixture")
        self.call("config","user.email","fixture@example.invalid")
        self.call("config","core.hooksPath",".disabled-fixture-hooks")
        self.call("config","commit.gpgSign","false")
        self.planning="docs/current/서비스_기획.md"
        self.routing="docs/current/라우팅_명세.md"
        self.required={"docs/current/service_spec.json",self.planning,self.routing}
        self.spec={"workflow":{"shared_tools":["scripts/check_project_consistency.py"]},
                   "current_documents":{"planning":self.planning,"routing":self.routing}}
        initial={"docs/current/service_spec.json":json.dumps(self.spec),self.planning:"base planning\n",self.routing:"base routing\n","src/score.py":"value = 1\n",
                 "README.md":"baseline synthetic note\n","apps/web/candidate.ts":"export const value = 1;\n",
                 "src/left.py":"value = 1\n","src/right.py":"value = 1\n","src/third.py":"value = 1\n"}
        self.baseline_paths=set(initial)
        self.write(initial)
        self.commit("synthetic baseline")
        self.base=self.oid()

    def call(self,*args,input=None,expected=0):
        import subprocess
        transition=args[0] in {"checkout","merge"}
        before={p.decode("utf-8") for p in self.call("ls-files","-z").split(b"\0") if p} if transition else set()
        result=subprocess.run(["git","-c","core.longpaths=true",*args],cwd=self.repo,input=input,capture_output=True)
        self.assertEqual(result.returncode,expected,result.stderr.decode("utf-8","replace"))
        if transition:
            after={p.decode("utf-8") for p in self.call("ls-files","-z").split(b"\0") if p}
            removed=sorted(before-after);missing=sorted(p for p in before if not (self.repo/p).is_file())
            record={"fixture":str(self.repo),"transition":list(args),"removed_tracked_paths":removed,"missing_previous_files":missing}
            with (self.fixture_root/"transition-receipts.jsonl").open("a",encoding="utf-8") as log:log.write(json.dumps(record,ensure_ascii=False)+"\n")
            self.assertEqual(removed,[],"Fixture transition removed a tracked path")
            self.assertEqual(missing,[],"Fixture transition removed a previous file")
        return result.stdout

    def oid(self):return self.call("rev-parse","HEAD").decode().strip()

    def write(self,changes):
        for path,text in changes.items():
            target=self.repo/path;target.parent.mkdir(parents=True,exist_ok=True)
            target.write_text(text,encoding="utf-8")

    def commit(self,message):
        self.call("add",".");self.call("commit","-q","-m",message)

    def documents(self,label):return {path:label+" "+path+"\n" for path in self.required}

    def changes(self,*,staged=False,revision=None):
        from unittest.mock import patch
        with patch.object(self.checker,"ROOT",self.repo):
            return self.checker.snapshot_changed_paths(self.checker.GitSnapshot(staged=staged,revision=revision))

    def merge(self,left,right,*,conflict=False):
        self.call("checkout","-q","-b","feature/application-pre-data-platform",self.base)
        self.write(left);self.commit("feature contribution");left_oid=self.oid()
        self.call("checkout","-q","develop")
        self.write(right);self.commit("develop contribution");right_oid=self.oid()
        self.call("checkout","-q","feature/application-pre-data-platform")
        self.call("merge","--no-ff","--no-commit","develop",expected=1 if conflict else 0)
        return left_oid,right_oid

    def merge_head_path(self):
        path=Path(self.call("rev-parse","--git-path","MERGE_HEAD").decode().strip())
        return path if path.is_absolute() else self.repo/path

    def test_ordinary_staged_code_only_stays_rejected(self):
        self.write({"src/score.py":"value = 2\n"});self.call("add",".")
        self.assertEqual(self.changes(staged=True),["src/score.py"])
        self.assertTrue(validate_changed_paths(self.changes(staged=True),self.spec))

    def test_ordinary_staged_matching_documents_stays_accepted(self):
        self.write({**self.documents("next"),"src/score.py":"value = 2\n"});self.call("add",".")
        changed=self.changes(staged=True)
        self.assertEqual(changed,sorted(self.required|{"src/score.py"}))
        self.assertEqual(validate_changed_paths(changed,self.spec),[])

    def test_single_parent_code_only_stays_rejected(self):
        self.write({"src/score.py":"value = 2\n"});self.call("add",".")
        staged=self.changes(staged=True);self.call("commit","-q","-m","code only")
        self.assertEqual(self.changes(revision=self.oid()),staged)
        self.assertTrue(validate_changed_paths(staged,self.spec))

    def test_single_parent_matching_documents_stays_accepted(self):
        self.write({**self.documents("next"),"src/score.py":"value = 2\n"});self.call("add",".")
        staged=self.changes(staged=True);self.call("commit","-q","-m","documented change")
        self.assertEqual(self.changes(revision=self.oid()),staged)
        self.assertEqual(validate_changed_paths(staged,self.spec),[])

    def test_approved_direction_staged_feature_docs_and_develop_code_are_combined(self):
        self.merge(self.documents("feature"),{"apps/web/candidate.ts":"export const value = 2;\n"})
        changed=self.changes(staged=True)
        self.assertEqual(changed,sorted(self.required|{"apps/web/candidate.ts"}))
        self.assertEqual(validate_changed_paths(changed,self.spec),[])

    def test_approved_direction_staged_feature_code_and_develop_docs_are_combined(self):
        self.merge({"src/score.py":"value = 2\n"},self.documents("develop"))
        self.assertEqual(validate_changed_paths(self.changes(staged=True),self.spec),[])

    def test_two_parent_committed_and_staged_merge_have_identical_paths(self):
        self.merge(self.documents("feature"),{"apps/web/candidate.ts":"export const value = 2;\n"})
        staged=self.changes(staged=True)
        self.call("commit","-q","-m","approved-direction synthetic merge")
        committed=self.changes(revision=self.oid())
        self.assertEqual(staged,committed)
        self.assertEqual(validate_changed_paths(committed,self.spec),[])

    def test_two_parent_code_only_merge_stays_rejected_in_both_modes(self):
        self.merge({"src/left.py":"value = 2\n"},{"src/right.py":"value = 3\n"})
        staged=self.changes(staged=True)
        self.assertTrue(validate_changed_paths(staged,self.spec))
        self.call("commit","-q","-m","undocumented synthetic merge")
        self.assertEqual(staged,self.changes(revision=self.oid()))
        self.assertTrue(validate_changed_paths(self.changes(revision=self.oid()),self.spec))

    def test_required_document_equal_to_every_parent_is_not_counted(self):
        docs=self.documents("feature");docs.pop(self.routing)
        self.merge(docs,{"src/right.py":"value = 3\n"})
        changed=self.changes(staged=True)
        self.assertNotIn(self.routing,changed)
        self.assertTrue(validate_changed_paths(changed,self.spec))

    def test_committed_code_hidden_from_first_parent_is_still_rejected(self):
        self.call("checkout","-q","-b","feature/application-pre-data-platform",self.base)
        self.write({"src/score.py":"value = 2\n"});self.commit("undocumented feature code");left=self.oid()
        self.call("checkout","-q","develop");self.write({"README.md":"synthetic side note\n"});self.commit("side note");right=self.oid()
        tree=self.call("rev-parse",left+"^{tree}").decode().strip()
        merge=self.call("commit-tree",tree,"-p",left,"-p",right,input=b"synthetic resolution keeps first-parent tree\n").decode().strip()
        changed=self.changes(revision=merge)
        self.assertIn("src/score.py",changed)
        self.assertTrue(validate_changed_paths(changed,self.spec))

    def test_conflict_resolution_and_new_resolution_file_are_detected(self):
        self.merge({**self.documents("feature"),"src/score.py":"value = 2\n"},{"src/score.py":"value = 3\n"},conflict=True)
        self.write({"src/score.py":"value = 4\n","src/resolution_only.py":"value = 4\n"});self.call("add",".")
        staged=self.changes(staged=True)
        self.assertIn("src/score.py",staged);self.assertIn("src/resolution_only.py",staged)
        self.call("commit","-q","-m","explicit synthetic resolution")
        self.assertEqual(staged,self.changes(revision=self.oid()))

    def test_committed_root_with_documents_preserves_existing_rejection(self):
        import subprocess
        with self.assertRaises((ValueError,subprocess.CalledProcessError)):self.changes(revision=self.base)

    def test_committed_code_only_root_preserves_existing_rejection(self):
        blob=self.call("hash-object","-w","--stdin",input=b"value = 2\n").decode().strip()
        tree=self.call("mktree",input=("100644 blob "+blob+"\tcode.py\n").encode()).decode().strip()
        root_tree=self.call("mktree",input=("040000 tree "+tree+"\tsrc\n").encode()).decode().strip()
        root=self.call("commit-tree",root_tree,input=b"synthetic code-only root\n").decode().strip()
        import subprocess
        with self.assertRaises((ValueError,subprocess.CalledProcessError)):self.changes(revision=root)

    def test_every_actual_parent_is_compared_for_committed_three_parent_merge(self):
        self.call("checkout","-q","-b","feature/application-pre-data-platform",self.base)
        self.write(self.documents("feature"));self.commit("feature docs");left=self.oid()
        self.call("checkout","-q","develop");self.write({"src/right.py":"value = 2\n"});self.commit("develop code");right=self.oid()
        self.call("checkout","-q","-b","synthetic-third",self.base);self.write({"src/third.py":"value = 3\n"});self.commit("third code");third=self.oid()
        tree=self.call("rev-parse",left+"^{tree}").decode().strip()
        merge=self.call("commit-tree",tree,"-p",left,"-p",right,"-p",third,input=b"synthetic three-parent resolution\n").decode().strip()
        changed=self.changes(revision=merge)
        self.assertTrue({"src/right.py","src/third.py"}<=set(changed))
        self.assertTrue(self.required<=set(changed))
        self.assertEqual(validate_changed_paths(changed,self.spec),[])

    def test_empty_merge_head_is_not_treated_as_ordinary_stage(self):
        self.merge_head_path().write_bytes(b"")
        with self.assertRaises(ValueError):self.changes(staged=True)

    def test_multiple_merge_heads_are_rejected_for_staged_merge(self):
        self.merge_head_path().write_bytes((self.base+"\n"+self.base+"\n").encode())
        with self.assertRaises(ValueError):self.changes(staged=True)

    def test_missing_merge_parent_object_fails_closed(self):
        import subprocess
        self.merge_head_path().write_bytes(("f"*40+"\n").encode())
        with self.assertRaises(subprocess.CalledProcessError):self.changes(staged=True)

    def test_same_head_as_merge_parent_is_rejected(self):
        self.merge_head_path().write_bytes((self.base+"\n").encode())
        with self.assertRaises(ValueError):self.changes(staged=True)

    def test_malformed_merge_head_is_rejected(self):
        self.merge_head_path().write_bytes(b"not-a-fixed-commit\n")
        with self.assertRaises(ValueError):self.changes(staged=True)

    def test_merge_head_change_during_diff_fails_closed(self):
        from unittest.mock import patch
        self.merge(self.documents("feature"),{"src/right.py":"value = 3\n"})
        original=self.checker.git;changed=False
        def mutate(*args,**kwargs):
            nonlocal changed
            result=original(*args,**kwargs)
            if args[0]=="ls-tree" and not changed:
                self.merge_head_path().write_bytes((self.base+"\n").encode());changed=True
            return result
        with patch.object(self.checker,"git",side_effect=mutate):
            with self.assertRaises(ValueError):self.changes(staged=True)

    def test_head_change_during_merge_diff_fails_closed(self):
        from unittest.mock import patch
        self.merge(self.documents("feature"),{"src/right.py":"value = 3\n"})
        original=self.checker.git;head_calls=0
        def mutate(*args,**kwargs):
            nonlocal head_calls
            if args==("rev-parse","--verify","HEAD^{commit}"):
                head_calls+=1
                if head_calls==2:return (self.base+"\n").encode()
            return original(*args,**kwargs)
        with patch.object(self.checker,"git",side_effect=mutate):
            with self.assertRaises(ValueError):self.changes(staged=True)

    def test_merge_state_appearing_during_ordinary_stage_fails_closed(self):
        from unittest.mock import patch
        original=self.checker.git
        def mutate(*args,**kwargs):
            result=original(*args,**kwargs)
            if args[0]=="ls-tree":self.merge_head_path().write_bytes((self.base+"\n").encode())
            return result
        with patch.object(self.checker,"git",side_effect=mutate):
            with self.assertRaises(ValueError):self.changes(staged=True)

    def test_commit_parent_query_failure_is_not_a_root(self):
        import subprocess
        from unittest.mock import patch
        from types import SimpleNamespace
        original=self.checker.git
        def fail(*args,**kwargs):
            if args[0]=="cat-file":raise subprocess.CalledProcessError(128,["git",*args])
            return original(*args,**kwargs)
        with patch.object(self.checker,"ROOT",self.repo),patch.object(self.checker,"git",side_effect=fail):
            with self.assertRaises(subprocess.CalledProcessError):
                self.checker.snapshot_changed_paths(SimpleNamespace(staged=False,revision=self.base))

    def test_malformed_parent_metadata_is_not_a_root(self):
        from unittest.mock import patch
        from types import SimpleNamespace
        original=self.checker.git
        for header in (b"missing tree\n\nmessage\n",b"tree "+b"a"*40+b"\nparent broken\n\nmessage\n",b"tree "+b"a"*40+b"\nparent "+b"b"*40+b"\nparent "+b"b"*40+b"\n\nmessage\n"):
            def invalid(*args,**kwargs):
                if args[0]=="cat-file":return header
                return original(*args,**kwargs)
            with patch.object(self.checker,"ROOT",self.repo),patch.object(self.checker,"git",side_effect=invalid):
                with self.assertRaises(ValueError):
                    self.checker.snapshot_changed_paths(SimpleNamespace(staged=False,revision=self.base))

    def test_recorded_but_unavailable_parent_is_not_a_root(self):
        import subprocess
        from unittest.mock import patch
        from types import SimpleNamespace
        original=self.checker.git
        def unavailable(*args,**kwargs):
            if args[0]=="cat-file":return b"tree "+b"a"*40+b"\nparent "+b"f"*40+b"\n\nmessage\n"
            return original(*args,**kwargs)
        with patch.object(self.checker,"ROOT",self.repo),patch.object(self.checker,"git",side_effect=unavailable):
            with self.assertRaises(subprocess.CalledProcessError):
                self.checker.snapshot_changed_paths(SimpleNamespace(staged=False,revision=self.base))

    def test_parent_diff_failure_is_not_an_empty_success(self):
        import subprocess
        from unittest.mock import patch
        self.merge(self.documents("feature"),{"src/right.py":"value = 3\n"})
        original=self.checker.git
        def fail(*args,**kwargs):
            if args[0]=="ls-tree":raise subprocess.CalledProcessError(128,["git",*args])
            return original(*args,**kwargs)
        with patch.object(self.checker,"git",side_effect=fail):
            with self.assertRaises(subprocess.CalledProcessError):self.changes(staged=True)


    def test_index_changed_after_snapshot_capture_is_rejected(self):
        from unittest.mock import patch
        self.merge(self.documents("feature"),{"src/right.py":"value = 3\n"})
        with patch.object(self.checker,"ROOT",self.repo):
            snapshot=self.checker.GitSnapshot(staged=True)
            old_entries=dict(snapshot.entries)
            self.write({"src/score.py":"value = 99\n"});self.call("add","src/score.py")
            with self.assertRaises(ValueError):self.checker.snapshot_changed_paths(snapshot)
            self.assertEqual(snapshot.entries,old_entries)

    def test_index_change_between_parent_tree_reads_is_rejected(self):
        from unittest.mock import patch
        self.merge(self.documents("feature"),{"src/right.py":"value = 3\n"})
        original=self.checker.git;changed=False
        def mutate(*args,**kwargs):
            nonlocal changed
            result=original(*args,**kwargs)
            if args[0]=="ls-tree" and not changed:
                self.write({"src/score.py":"value = 99\n"});self.call("add","src/score.py");changed=True
            return result
        with patch.object(self.checker,"git",side_effect=mutate):
            with self.assertRaises(ValueError):self.changes(staged=True)

    def test_index_content_change_with_same_paths_is_rejected(self):
        from unittest.mock import patch
        self.write({**self.documents("next"),"src/score.py":"value = 2\n"});self.call("add",".")
        with patch.object(self.checker,"ROOT",self.repo):
            snapshot=self.checker.GitSnapshot(staged=True);old_names=set(snapshot.entries)
            self.write({"src/score.py":"value = 999\n"});self.call("add","src/score.py")
            self.assertEqual(old_names,{p.decode() for p in self.call("ls-files","-z").split(b"\0") if p})
            with self.assertRaises(ValueError):self.checker.snapshot_changed_paths(snapshot)

    def test_index_change_before_final_comparison_is_rejected(self):
        from unittest.mock import patch
        self.merge(self.documents("feature"),{"src/right.py":"value = 3\n"})
        with patch.object(self.checker,"ROOT",self.repo):snapshot=self.checker.GitSnapshot(staged=True)
        original=self.checker.git;index_calls=0
        def mutate(*args,**kwargs):
            nonlocal index_calls
            if args==("ls-files","--stage","-z"):
                index_calls+=1
                if index_calls==2:self.write({"src/score.py":"value = 99\n"});self.call("add","src/score.py")
            return original(*args,**kwargs)
        with patch.object(self.checker,"ROOT",self.repo),patch.object(self.checker,"git",side_effect=mutate):
            with self.assertRaises(ValueError):self.checker.snapshot_changed_paths(snapshot)

    def test_existing_head_lookup_failure_is_not_unborn_stage(self):
        import subprocess
        from unittest.mock import patch
        original=self.checker.git
        def fail(*args,**kwargs):
            if args==("rev-parse","--verify","HEAD^{commit}"):raise subprocess.CalledProcessError(128,["git",*args])
            return original(*args,**kwargs)
        with patch.object(self.checker,"git",side_effect=fail):
            with self.assertRaises(subprocess.CalledProcessError):self.changes(staged=True)

    def test_ordinary_initial_staging_preserves_existing_path_policy(self):
        previous_repo=self.repo
        self.repo=self.fixture_root/(str(type(self).fixture_number)+"-unborn");self.repo.mkdir()
        self.call("init","-q","-b","develop");self.call("config","core.longpaths","true")
        self.write({**self.documents("initial"),"src/score.py":"value = 1\n"});self.call("add",".")
        self.assertEqual(self.changes(staged=True),sorted(self.required|{"src/score.py"}))
        self.assertEqual(validate_changed_paths(self.changes(staged=True),self.spec),[])
        self.repo=previous_repo

    def test_unresolved_index_is_rejected_before_path_selection(self):
        self.merge({"src/score.py":"value = 2\n"},{"src/score.py":"value = 3\n"},conflict=True)
        with self.assertRaises(ValueError):self.changes(staged=True)

    def test_working_tree_mode_stays_outside_changed_path_gate(self):
        from types import SimpleNamespace
        self.assertEqual(self.checker.snapshot_changed_paths(SimpleNamespace(staged=False,revision=None)),[])



    def baseline_selected(self,**options):
            from unittest.mock import patch
            with patch.object(self.checker,'ROOT',self.repo):
                snapshot=self.checker.GitSnapshot(**options)
                self.checker.snapshot_changed_paths(snapshot)
                return snapshot

    def baseline_check(self,snapshot,baseline):
            from unittest.mock import patch
            with patch.object(self.checker,'ROOT',self.repo):
                return self.checker.validate_snapshot_baseline(snapshot,baseline)

    def test_baseline_ordinary_parent(self):
            self.write({'src/score.py':'value = 2\n'});self.call('add','.')
            self.assertEqual(self.baseline_check(self.baseline_selected(staged=True),self.base),[])

    def test_baseline_incoming_parent(self):
            left,right=self.merge({'src/left.py':'value = 2\n'},{'src/right.py':'value = 3\n'})
            self.assertEqual(self.baseline_check(self.baseline_selected(staged=True),right),[])
            self.assertEqual(self.call('merge-base','--is-ancestor',right,left,expected=1),b'')

    def test_baseline_committed_merge(self):
            _,right=self.merge({'src/left.py':'value = 2\n'},{'src/right.py':'value = 3\n'})
            self.call('commit','-q','-m','synthetic merge')
            self.assertEqual(self.baseline_check(self.baseline_selected(revision=self.oid()),right),[])

    def test_baseline_unrelated_commit_rejected(self):
            tree=self.call('rev-parse','HEAD^{tree}').decode().strip()
            unrelated=self.call('commit-tree',tree,input=b'synthetic unrelated root\n').decode().strip()
            self.assertEqual(self.baseline_check(self.baseline_selected(staged=True),unrelated),['Development baseline is not an ancestor of the selected commit'])

    def test_baseline_missing_commit_fails_closed(self):
            import subprocess
            with self.assertRaises(subprocess.CalledProcessError):self.baseline_check(self.baseline_selected(staged=True),'f'*40)

    def test_baseline_merge_context_mutation_rejected(self):
            _,right=self.merge({'src/left.py':'value = 2\n'},{'src/right.py':'value = 3\n'})
            snapshot=self.baseline_selected(staged=True)
            target=self.merge_head_path()
            target.with_name('MERGE_HEAD.retained').write_bytes(target.read_bytes())
            target.write_text(self.base+'\n',encoding='ascii')
            with self.assertRaises(ValueError):self.baseline_check(snapshot,right)

    def test_baseline_index_mutation_rejected(self):
            snapshot=self.baseline_selected(staged=True)
            self.write({'src/score.py':'value = 5\n'});self.call('add','.')
            with self.assertRaises(ValueError):self.baseline_check(snapshot,self.base)

    def test_baseline_git_query_failure_rejected(self):
            from unittest.mock import patch
            from types import SimpleNamespace
            snapshot=self.baseline_selected(staged=True)
            original=self.checker.subprocess.run
            def failed(args,**kwargs):
                if args[:2]==['git','merge-base']:return SimpleNamespace(returncode=128)
                return original(args,**kwargs)
            with patch.object(self.checker.subprocess,'run',failed):
                with self.assertRaises(ValueError):self.baseline_check(snapshot,self.base)


class MergeValidationBoundaryTests(unittest.TestCase):
    """Use only in-memory payloads; never force-track private paths or credentials."""
    def context(self):
        fixture=ConsistencyTests(methodName="test_code_only_commit_is_rejected")
        fixture.setUp()
        return fixture,fixture.virtual_files()

    def test_private_path_remains_rejected_without_real_git_tracking(self):
        fixture,files=self.context();path="nested/Resource/private.json"
        files[path]=b'{"synthetic":true}'
        self.assertIn("Private file tracked: "+path,validate_content(list(files),files.__getitem__,fixture.spec))

    def test_synthetic_credential_pattern_remains_rejected_in_memory(self):
        fixture,files=self.context();path="apps/web/example.ts"
        files[path]=b"const synthetic = '"+b"sb_secret_"+b"x"*24+b"';\n"
        self.assertIn("Credential pattern in shared file: "+path,validate_content(list(files),files.__getitem__,fixture.spec))

    def test_generated_routing_drift_remains_rejected_in_memory(self):
        fixture,files=self.context();path=fixture.spec["current_documents"]["routing"]
        files[path]+=b"synthetic independent route edit\n"
        self.assertIn("Document or route drift: "+path,validate_content(list(files),files.__getitem__,fixture.spec))




class SecuredPreparationContractTests(unittest.TestCase):
    def setUp(self):
        self.spec=json.loads((ROOT/"docs/current/service_spec.json").read_text(encoding="utf-8"))
    def test_default_factory_cannot_be_automatically_switched(self):
        spec=deepcopy(self.spec);spec["secured_backend_preparation_contract"]["composition"]["default_factories_unchanged"]=True
        self.assertIn("DEV-008 default composition preservation drift",validate_spec(spec))
    def test_relay_cannot_replace_user_authorization(self):
        spec=deepcopy(self.spec);spec["secured_backend_preparation_contract"]["relay"]["relay_alone_grants_user_access"]=True
        self.assertIn("DEV-008 relay identity/privacy drift",validate_spec(spec))
    def test_missing_operation_or_untyped_nested_values_cannot_pass(self):
        spec=deepcopy(self.spec);c=spec["secured_backend_preparation_contract"]
        c["protected_operations"].pop();c["response_projection"]["free_form_Any_allowed"]=True
        self.assertIn("DEV-008 operation coverage drift",validate_spec(spec))
        self.assertIn("DEV-008 recursive response boundary drift",validate_spec(spec))
    def test_ready_cannot_expose_private_settings_or_promote_production(self):
        spec=deepcopy(self.spec);c=spec["secured_backend_preparation_contract"]
        c["health"]["ready_public_fields"].append("database_url");c["production_ready"]=True
        self.assertIn("DEV-008 safe health boundary drift",validate_spec(spec))
        self.assertIn("DEV-008 scoped preparation cannot promote production",validate_spec(spec))
    def test_preparation_and_work_item_cannot_disappear(self):
        spec=deepcopy(self.spec);del spec["secured_backend_preparation_contract"]
        del spec["workflow"]["synchronized_work_items"]["docs/work_items/DEV-008-secured-backend-boundary.json"]
        self.assertIn("DEV-008 required secure preparation contract missing",validate_spec(spec))
    def test_synthetic_completion_requires_fixed_snapshot_evidence(self):
        spec=deepcopy(self.spec);contract=spec["secured_backend_preparation_contract"]
        contract["code_status"]="accepted_on_develop_scoped_synthetic_verified"
        contract["verification"].update(implementation_commit=None,synthetic_test_count=None,status="NOT_RUN")
        self.assertIn("DEV-008 implementation completion lacks fixed synthetic evidence",validate_spec(spec))


class PublicResponseRegistryContractTests(unittest.TestCase):
    def setUp(self):
        self.spec=json.loads((ROOT/"docs/current/service_spec.json").read_text(encoding="utf-8"))
        self.catalog={"format":"jungsi.public-response-schemas/v1","operations":[],"schemas":{},"auxiliary_roots":{}}
        for operation in self.spec["operations"]:
            dto=self.spec["backend_platform_contract"]["dto_schemas"][operation["http_contract"]["response_schema"]]
            roots={}
            for role in ("standard","paid"):
                fields=dto["fields"]+(dto.get("paid_fields",[]) if role=="paid" else [])
                name=operation["id"]+"."+role
                self.catalog["schemas"][name]={"type":"object","properties":{f:{"type":"string","nullable":True} for f in fields},"required":[],"optional":fields}
                roots[role]={"ref":name}
            self.catalog["operations"].append({"id":operation["id"],"contract_ref":operation["contract_ref"],"roots":roots})
        self.catalog["schemas"]["safe_error"]={"type":"object","properties":{"code":{"type":"string"}},"required":["code"],"optional":[]}
        self.catalog["schemas"]["error"]={"type":"object","properties":{"status":{"type":"string"},"error":{"ref":"safe_error"},"request_id":{"type":"string"}},"required":["status","error","request_id"],"optional":[]}
        self.catalog["schemas"]["readiness"]={"type":"object","properties":{f:{"type":"string"} for f in ("status","server_timezone","production_ready","security_boundary")},"required":["status","server_timezone","production_ready","security_boundary"],"optional":[]}
        self.catalog["auxiliary_roots"]={"error":{"ref":"error"},"readiness":{"ref":"readiness"}}
        self.catalog["schemas"]["nested"]={"type":"object","properties":{"rows":{"type":"array","items":{"ref":"safe_error"}},"by_id":{"type":"map","keys":{"type":"string"},"values":{"ref":"safe_error"}}},"required":["rows"],"optional":["by_id"]}
    def test_complete_typed_graph_matches_existing_operation_fields(self):
        self.assertEqual(validate_public_response_catalog(self.catalog,self.spec),[])
    def test_missing_duplicate_or_changed_operation_binding_is_rejected(self):
        for mode in ("missing","duplicate","changed_ref"):
            with self.subTest(mode=mode):
                c=deepcopy(self.catalog)
                if mode=="missing":c["operations"].pop()
                elif mode=="duplicate":c["operations"].append(deepcopy(c["operations"][0]))
                else:c["operations"][0]["contract_ref"]="unregistered.private"
                self.assertIn("DEV-008 public response schema operation binding drift",validate_public_response_catalog(c,self.spec))
    def test_untyped_nested_values_bad_references_and_cycles_are_rejected(self):
        cases=[{"type":"Any"},{"type":"array"},{"type":"map","keys":{"type":"string"}}, {"ref":"missing"},{"ref":"nested"},{"type":"enum","values":[{"private":"SYNTHETIC"}]}]
        for node in cases:
            with self.subTest(node=node):
                c=deepcopy(self.catalog);c["schemas"]["nested"]["properties"]["by_id"]=node
                self.assertIn("DEV-008 public response schema type/reference graph invalid",validate_public_response_catalog(c,self.spec))
    def test_required_optional_partition_and_open_objects_are_rejected(self):
        for mode in ("missing","overlap","duplicate","open"):
            with self.subTest(mode=mode):
                c=deepcopy(self.catalog);node=c["schemas"]["nested"]
                if mode=="missing":node["optional"]=[]
                elif mode=="overlap":node["optional"].append("rows")
                elif mode=="duplicate":node["required"].append("rows")
                else:node["additionalProperties"]=True
                self.assertIn("DEV-008 public response schema type/reference graph invalid",validate_public_response_catalog(c,self.spec))
    def test_standard_report_cannot_add_paid_or_private_fields(self):
        c=deepcopy(self.catalog);node=c["schemas"]["report.read.standard"]
        node["properties"]["analyses"]={"ref":"nested"};node["optional"].append("analyses")
        self.assertIn("DEV-008 public response schema field boundary drift",validate_public_response_catalog(c,self.spec))
    def test_auxiliary_error_and_ready_cannot_add_private_fields(self):
        for name,field in (("safe_error","raw_exception"),("readiness","database_role")):
            with self.subTest(name=name):
                c=deepcopy(self.catalog);node=c["schemas"][name]
                node["properties"][field]={"type":"string"};node["optional"].append(field)
                self.assertIn("DEV-008 public response auxiliary boundary drift",validate_public_response_catalog(c,self.spec))
    def test_completed_implementation_requires_registry_and_unique_json_keys(self):
        planned=deepcopy(self.spec);planned["secured_backend_preparation_contract"]["code_status"]="planned"
        self.assertEqual(validate_public_response_registry([],lambda p:b"",planned),[])
        s=deepcopy(self.spec);s["secured_backend_preparation_contract"]["code_status"]="implemented_synthetic_verified_integration_pending"
        self.assertIn("DEV-008 public response schema registry missing",validate_public_response_registry([],lambda p:b"",s))
        raw=b'{"format":"jungsi.public-response-schemas/v1","format":"duplicate"}'
        self.assertIn("DEV-008 public response schema registry invalid",validate_public_response_registry([PUBLIC_RESPONSE_SCHEMA_PATH],lambda p:raw,self.spec))


class RuntimeConnectionPreparationContractTests(unittest.TestCase):
    def setUp(self):
        self.spec=json.loads((ROOT/'docs/current/service_spec.json').read_text(encoding='utf-8'))
    def test_source_validation_cannot_become_native_approval(self):
        for field in ['historical_source_only_records_are_canonical','source_validation_is_engine_approval','source_or_archive_auto_adoption','actual_source_data_in_Git']:
            with self.subTest(field=field):
                wrong=deepcopy(self.spec);wrong['runtime_connection_preparation_contract']['source_lineage'][field]=True
                self.assertIn('DEV-009 source registration cannot promote native runtime',validate_runtime_connection_preparation(wrong))
    def test_explicit_storage_readiness_cannot_inherit_drive_or_drop_relay(self):
        for field,value in [('legacy_Drive_requirements_apply',True),('relay_required',False),('selected_native_probe_required',False),('database_verified_required',False),('draft_or_false_approval_or_bad_integrity_is_ready',True)]:
            with self.subTest(field=field):
                wrong=deepcopy(self.spec);wrong['runtime_connection_preparation_contract']['readiness'][field]=value
                self.assertIn('DEV-009 provider readiness or public boundary drift',validate_runtime_connection_preparation(wrong))
    def test_native_selection_cannot_omit_approval_integrity_or_select_archive(self):
        for field,value in [('native_decoder_required',False),('engine_approved_required',False),('production_allowed_required',False),('reference_size_hash_version_binding_required',False),('selected_native_cross_bindings_required',False),('implicit_all_artifacts_selection',True),('archive_only_required',True),('source_files_overwritten',True),('selection_format','unbound-selection/v0')]:
            with self.subTest(field=field):
                wrong=deepcopy(self.spec);wrong['runtime_connection_preparation_contract']['runtime_selection'][field]=value
                self.assertIn('DEV-009 native selection approval or integrity drift',validate_runtime_connection_preparation(wrong))
    def test_source_fix_preserves_default_factories_and_minimal_health(self):
        wrong=deepcopy(self.spec);wrong['runtime_connection_preparation_contract']['composition']['default_factories_unchanged']=True
        self.assertIn('DEV-009 explicit composition preservation drift',validate_runtime_connection_preparation(wrong))
        wrong=deepcopy(self.spec);wrong['runtime_connection_preparation_contract']['readiness']['ready_public_fields'].append('private_registry')
        self.assertIn('DEV-009 provider readiness or public boundary drift',validate_runtime_connection_preparation(wrong))
    def test_scoped_acceptance_needs_evidence_and_cannot_claim_live(self):
        wrong=deepcopy(self.spec);c=wrong['runtime_connection_preparation_contract'];c['code_status']='accepted_on_develop_scoped_synthetic_verified'
        c['verification'].update(implementation_commit=None,synthetic_test_count=0,status='NOT_RUN')
        self.assertIn('DEV-009 implementation completion lacks fixed synthetic evidence',validate_runtime_connection_preparation(wrong))
        wrong=deepcopy(self.spec);c=wrong['runtime_connection_preparation_contract'];c['production_ready']=True;c['deployment']['actual_deployment']='PASS'
        self.assertIn('DEV-009 preparation cannot promote production or source data',validate_runtime_connection_preparation(wrong))
        self.assertIn('DEV-009 deployment preparation cannot certify live acceptance',validate_runtime_connection_preparation(wrong))
    def test_runtime_implementation_index_and_CI_bind_verified_code(self):
        wrong=deepcopy(self.spec)
        wrong['implementation']=[x for x in wrong['implementation'] if x['path']!='src/jungsi_touch/infrastructure/supabase_runtime.py']
        self.assertIn('DEV-009 runtime implementation or entrypoint registration drift',validate_runtime_connection_preparation(wrong))
        wrong=deepcopy(self.spec);wrong['runtime_connection_preparation_contract']['verification']['CI']['headSha']='f'*40
        self.assertIn('DEV-009 CI evidence does not bind verified implementation',validate_runtime_connection_preparation(wrong))

    def test_runtime_contract_and_work_item_cannot_be_removed(self):
        wrong=deepcopy(self.spec);wrong.pop('runtime_connection_preparation_contract')
        self.assertIn('DEV-009 required runtime connection contract missing',validate_spec(wrong))
        wrong=deepcopy(self.spec);wrong['workflow']['synchronized_work_items'].pop('docs/work_items/DEV-009-runtime-connection-preparation.json')
        self.assertIn('Synchronized work-item scope registration drift',validate_spec(wrong))


class SupabaseDeploymentContractTests(unittest.TestCase):

    def test_runtime_assembly_missing_scope_or_stale_entry_cannot_claim_source_assembly(self):
        from check_project_consistency import validate_live_execution
        for field in ('native_entry','composition'):
            spec=deepcopy(self.spec)
            spec['supabase_deployment_contract']['live_execution']['runtime_assembly']['bindings'][field]['source_sha256']='f'*64
            self.assertIn('DEV-010 runtime assembly source binding drift: '+field,validate_live_execution(spec))
        spec=deepcopy(self.spec)
        spec['supabase_deployment_contract']['live_execution']['runtime_assembly']['operation_ids'].pop()
        self.assertIn('DEV-010 runtime assembly scope drift',validate_live_execution(spec))
        spec=deepcopy(self.spec)
        spec['supabase_deployment_contract']['live_execution'].pop('runtime_assembly')
        self.assertIn('DEV-010 runtime assembly missing',validate_live_execution(spec))

    def test_runtime_assembly_settings_cannot_contain_actual_values_or_drop_pending_inputs(self):
        from check_project_consistency import validate_live_execution
        spec=deepcopy(self.spec)
        spec['supabase_deployment_contract']['live_execution']['runtime_assembly']['environment'][0]['value']='SYNTHETIC'
        self.assertIn('DEV-010 runtime environment contract drift',validate_live_execution(spec))
        spec=deepcopy(self.spec)
        spec['supabase_deployment_contract']['live_execution']['runtime_assembly']['waiting']=[]
        self.assertIn('DEV-010 runtime assembly waiting conditions missing',validate_live_execution(spec))

    def test_runtime_assembly_keeps_native_and_deployment_evidence_requirements(self):
        from check_project_consistency import validate_live_execution
        spec=deepcopy(self.spec)
        live=spec['supabase_deployment_contract']['live_execution']
        live['operations']['session.read'].update(native='PASS',deployment='PASS')
        errors=validate_live_execution(spec)
        self.assertIn('DEV-010 live operating evidence missing: session.read.native',errors)
        self.assertIn('DEV-010 live operating evidence missing: session.read.deployment',errors)

    def test_runtime_assembly_generated_contract_lists_pending_server_inputs(self):
        from check_project_consistency import live_execution_document
        body=live_execution_document(self.spec)
        for value in ('jungsi-api/index.ts','JUNGSI_DATABASE_CA','JUNGSI_API_BINDING_JSON','JUNGSI_API_BINDING_SHA256','JUNGSI_API_BINDING_MAX_BYTES','runtime-usage-policy/v1','005','실제 연결'):
            self.assertIn(value,body)


    def test_live_execution_cannot_omit_one_of_the_existing_routes(self):
        from check_project_consistency import validate_live_execution
        spec=deepcopy(self.spec);spec['supabase_deployment_contract']['live_execution']['operations'].pop('session.read')
        self.assertIn('DEV-010 live operation coverage drift',validate_live_execution(spec))

    def test_live_native_pass_cannot_reuse_synthetic_foundation_only(self):
        from check_project_consistency import validate_live_execution
        spec=deepcopy(self.spec);row=spec['supabase_deployment_contract']['live_execution']['operations']['session.read'];row['native']='PASS'
        self.assertIn('DEV-010 live operating evidence missing: session.read.native',validate_live_execution(spec))

    def test_live_port_requires_a_registered_source_hash(self):
        from check_project_consistency import validate_live_execution
        spec=deepcopy(self.spec);row=spec['supabase_deployment_contract']['live_execution']['operations']['report.read']
        row.update(code='PORTED',binding={'path':'supabase/functions/unregistered/index.ts','source_sha256':'a'*64})
        self.assertIn('DEV-010 live implementation binding invalid: report.read',validate_live_execution(spec))

    def test_owner_totp_and_final_completion_need_actual_evidence(self):
        from check_project_consistency import validate_live_execution
        spec=deepcopy(self.spec);live=spec['supabase_deployment_contract']['live_execution'];live['status']='VERIFIED';live['stages']['owner_totp_verification']['status']='VERIFIED'
        result=validate_live_execution(spec)
        self.assertIn('DEV-010 live stage evidence missing: owner_totp_verification',result)
        self.assertIn('DEV-010 live completion has unfinished acceptance',result)


    def setUp(self):
        self.spec=json.loads((ROOT/'docs/current/service_spec.json').read_text(encoding='utf-8'))

    def test_supabase_only_constraint_rejects_external_hosting_and_extra_cost(self):
        for field in ('external_hosting_allowed','additional_billable_service_allowed','plan_upgrade_allowed','paid_add_on_allowed','automatic_overage_opt_in_allowed'):
            with self.subTest(field=field):
                spec=deepcopy(self.spec);spec['supabase_deployment_contract']['platform_policy'][field]=True
                self.assertIn('DEV-010 platform or additional-cost constraint drift',validate_supabase_deployment_contract(spec))
        spec=deepcopy(self.spec);spec['supabase_deployment_contract']['platform_policy']['allowed'].append('render')
        self.assertIn('DEV-010 platform or additional-cost constraint drift',validate_supabase_deployment_contract(spec))
    def test_edge_plan_cannot_claim_python_hosting_or_browser_engine(self):
        for field in ('python_hosted_unchanged','engine_in_browser_allowed'):
            spec=deepcopy(self.spec);spec['supabase_deployment_contract']['architecture'][field]=True
            self.assertIn('DEV-010 Edge and Python reference boundary drift',validate_supabase_deployment_contract(spec))
    def test_edge_plan_preserves_exact_relay_and_application_user_authorization(self):
        spec=deepcopy(self.spec);spec['supabase_deployment_contract']['security']['relay_header']='X-Jungsi-Relay'
        self.assertIn('DEV-010 relay or application authorization drift',validate_supabase_deployment_contract(spec))
        spec=deepcopy(self.spec);spec['supabase_deployment_contract']['security']['user_authorization_in_application_required']=False
        self.assertIn('DEV-010 relay or application authorization drift',validate_supabase_deployment_contract(spec))
    def test_edge_plan_cannot_promote_source_or_use_historical_count_as_trigger(self):
        for field in ('source_state_only_promotion_allowed','historical_source_count_trigger_allowed'):
            spec=deepcopy(self.spec);spec['supabase_deployment_contract']['native_publication'][field]=True
            self.assertIn('DEV-010 native publication or historical trigger drift',validate_supabase_deployment_contract(spec))
    def test_edge_preparation_cannot_certify_actual_operations_or_cost(self):
        spec=deepcopy(self.spec);spec['supabase_deployment_contract']['production_ready']=True
        self.assertIn('DEV-010 preparation cannot certify operating or billing acceptance',validate_supabase_deployment_contract(spec))
        for field in ('actual_Auth_DB_Storage_Edge_BFF_browser_deployment','actual_billing_and_quota_verification'):
            spec=deepcopy(self.spec);spec['supabase_deployment_contract']['verification'][field]='PASS'
            self.assertIn('DEV-010 preparation cannot certify operating or billing acceptance',validate_supabase_deployment_contract(spec))
    def test_edge_implementation_completion_needs_exact_commit_and_scoped_evidence(self):
        spec=deepcopy(self.spec);spec['supabase_deployment_contract']['code_status']='accepted_on_develop_scoped_synthetic_verified'
        self.assertIn('DEV-010 implementation completion lacks fixed scoped evidence',validate_supabase_deployment_contract(spec))
    def test_new_platform_contract_and_work_item_are_mandatory(self):
        spec=deepcopy(self.spec);spec.pop('supabase_deployment_contract')
        self.assertIn('DEV-010 required platform contract missing',validate_spec(spec))
        spec=deepcopy(self.spec);spec['workflow']['synchronized_work_items'].pop('docs/work_items/DEV-010-supabase-platform-deployment.json')
        self.assertIn('Synchronized work-item scope registration drift',validate_spec(spec))

    def test_edge_port_cannot_assume_float_rounding_or_drop_independent_comparison(self):
        for field,value in [('Number_or_Math_round_equivalence_assumed',True),('independent_python_edge_comparison_required',False),('heavy_model_generation_in_request_allowed',True)]:
            with self.subTest(field=field):
                spec=deepcopy(self.spec);spec['supabase_deployment_contract']['numerical_compatibility'][field]=value
                self.assertIn('DEV-010 precision or heavy-compute compatibility drift',validate_supabase_deployment_contract(spec))

if __name__=="__main__":unittest.main()


class OpeningSecurityOperationsTests(unittest.TestCase):
    def setUp(self):
        self.spec=json.loads((ROOT/'docs/current/service_spec.json').read_text(encoding='utf-8'))
    def test_legacy_fallback_or_missing_confirmed_admin_decision_is_rejected(self):
        for branch,key,value in [('entitlement','legacy_table_fallback_allowed',True),('user_decisions','admin_paid_override',False)]:
            wrong=deepcopy(self.spec);wrong['opening_security_operations_contract'][branch][key]=value
            self.assertIn('Opening paid authority or failure boundary drift',validate_spec(wrong))
    def test_confirmed_admin_exception_exact_identity_expiry_and_scope_contract(self):
        self.assertFalse(validate_spec(self.spec))
        changes=[('role',None),('account_status','inactive'),('verified_aal','aal1'),
                 ('internal_origin_required',False),('request_local_origin_identity_required',False),
                 ('own_profile_queries_per_request',2),('own_profile_queries_per_request',True),
                 ('entitlement_expires_at','9999-12-31T00:00:00Z'),('real_expiry_preserved',False),
                 ('ownership_school_review_approval_scope_override',True),
                 ('next_request_profile_reevaluation_required',False),('editor_or_approver_is_admin',True)]
        for key,value in changes:
            with self.subTest(key=key,value=value):
                wrong=deepcopy(self.spec);wrong['opening_security_operations_contract']['entitlement']['admin_access_exception'][key]=value
                self.assertIn('Opening administrator exception identity, expiry or scope drift',validate_spec(wrong))
        wrong=deepcopy(self.spec);wrong['opening_security_operations_contract']['entitlement']['admin_access_exception'].pop('role')
        self.assertIn('Opening administrator exception identity, expiry or scope drift',validate_spec(wrong))
    def test_management_cannot_trust_client_or_expand_to_students(self):
        for key in ['client_roles_or_user_metadata_trusted','new_app_role_profiles_GRANT_allowed','student_or_paid_service_MFA_required','profile_admin_override_allowed']:
            wrong=deepcopy(self.spec);wrong['opening_security_operations_contract']['management'][key]=True
            self.assertIn('Opening management MFA or active scope drift',validate_spec(wrong))
    def test_public_forecast_read_cannot_inherit_management(self):
        wrong=deepcopy(self.spec);next(o for o in wrong['operations']if o['id']=='forecast.published.read')['management_security_contract_ref']='opening_security_operations_contract.management'
        self.assertIn('Opening management route coverage drift',validate_spec(wrong))
    def test_mfa_guard_cannot_omit_a_manage_route(self):
        wrong=deepcopy(self.spec);next(o for o in wrong['operations']if o['id']=='forecast.publish').pop('management_security_contract_ref')
        self.assertIn('Opening management route coverage drift',validate_spec(wrong))
    def test_paid_lookup_cannot_duplicate_or_cross_request_cache(self):
        for key,value in [('metadata_and_entitlement_data_queries_per_request',2),('cross_request_entitlement_cache_allowed',True)]:
            wrong=deepcopy(self.spec);wrong['opening_security_operations_contract']['entitlement'][key]=value
            self.assertIn('Opening paid authority or failure boundary drift',validate_spec(wrong))
    def test_cleanup_cannot_be_granted_by_unpublished_flag(self):
        wrong=deepcopy(self.spec);wrong['opening_security_operations_contract']['capacity']['production_allowed_false_means_unused']=True
        self.assertIn('Opening capacity preservation contract drift',validate_spec(wrong))
    def test_unbounded_ui_query_or_N_plus_1_is_rejected(self):
        for key in ['unbounded_current_scan_for_UI_allowed','N_plus_1_allowed','test_intake_in_production_allowed']:
            wrong=deepcopy(self.spec);wrong['opening_security_operations_contract']['queries'][key]=True
            self.assertIn('Opening bounded query contract drift',validate_spec(wrong))


class OpeningAcceptanceAndReferenceTests(unittest.TestCase):
    def setUp(self):
        self.spec=json.loads((ROOT/'docs/current/service_spec.json').read_text(encoding='utf-8'))
    def test_wrong_head_or_unrun_CI_cannot_certify_integration(self):
        for field,value in [('headSha','f'*40),('conclusion','not_run')]:
            wrong=deepcopy(self.spec);wrong['opening_security_operations_contract']['verification']['CI'][0][field]=value
            self.assertIn('Opening develop acceptance lacks exact scoped evidence',validate_spec(wrong))
    def test_mandatory_reference_resolves_from_other_layer_readmes(self):
        files=generated_files(self.spec)
        for path,target in [('apps/web/README.md','../../docs/current/오픈전_보안운영_변경.md'),('database/README.md','../docs/current/오픈전_보안운영_변경.md'),('docs/team_sessions/2026-10-05/DEV006_서비스_DB_응답.md','../../current/오픈전_보안운영_변경.md')]:
            with self.subTest(path=path):self.assertIn(']('+target+')',files[path].decode('utf-8'))
