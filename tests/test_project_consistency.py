"""Catch contract drift, unauthorized paths and layer leakage with virtual edits."""
from copy import deepcopy
import json,sys,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"scripts"))
from check_project_consistency import validate_spec,generated_files,validate_content,protected_path,validate_changed_paths,validate_security_contract,SECURITY_DOCUMENT,SECURITY_CASES,SECURITY_GATES

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
        files["AGENTS.md"]=("docs/current/service_spec.json\n<!-- jungsi:security-required -->\n"+SECURITY_DOCUMENT).encode("utf-8")
        files["docs/current/service_spec.json"]=json.dumps(self.spec,ensure_ascii=False).encode("utf-8")
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

if __name__=="__main__":unittest.main()
