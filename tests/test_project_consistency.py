"""Catch contract drift, unauthorized paths and layer leakage with virtual edits."""
from copy import deepcopy
import json,sys,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"scripts"))
from check_project_consistency import validate_supabase_deployment_contract,validate_runtime_connection_preparation,validate_public_response_catalog,validate_public_response_registry,PUBLIC_RESPONSE_SCHEMA_PATH,validate_spec,generated_files,validate_content,protected_path,validate_changed_paths,validate_security_contract,validate_frontend_reply_contract,validate_frontend_followup_contract,FRONTEND_REPLY_DOCUMENT,FRONTEND_FOLLOWUP_DOCUMENT,SECURITY_DOCUMENT,SECURITY_CASES,SECURITY_GATES

def observer_epoch_spec(spec):
    """Explicit legacy-only view; preserve the supplied current spec and every original record."""
    view=deepcopy(spec)
    current_live=view["supabase_deployment_contract"]["live_execution"]
    deployment_id="OPS-SAFE-OBSERVER-DEPLOYED-20261016"
    attempt_id="OPS-P2-OBSERVER-ATTEMPT-20261016"
    installation=current_live.get("current_deployment")
    if not isinstance(installation,dict) or installation.get("evidence_id")!=deployment_id:
        deployments=current_live.get("deployment_history",{})
        installation=deployments.get(deployment_id) if isinstance(deployments,dict) else None
    if not isinstance(installation,dict) or installation.get("evidence_id")!=deployment_id:
        raise AssertionError("The preserved observer installation is required for this legacy fixture")
    history=current_live.get("P2_attempt_history",{})
    if not isinstance(history,dict):
        raise AssertionError("The preserved P2 history is required for this legacy fixture")
    attempt=current_live.get("current_P2_attempt")
    if not isinstance(attempt,dict) or attempt.get("evidence_id")!=attempt_id:
        attempt=history.get(attempt_id)
    if not isinstance(attempt,dict) or attempt.get("evidence_id")!=attempt_id:
        raise AssertionError("The preserved observer P2 attempt is required for this legacy fixture")
    # Keep only predecessors of the old attempt; later attempts belong to the actual-current tests.
    earlier={}
    cursor=attempt.get("previous_receipt_evidence_id")
    while cursor in history:
        if cursor==attempt_id or cursor in earlier:
            raise AssertionError("The preserved observer predecessor chain must not contain a cycle")
        record=history[cursor]
        if not isinstance(record,dict) or record.get("evidence_id")!=cursor:
            raise AssertionError("The preserved observer predecessor reference is malformed")
        earlier[cursor]=record
        cursor=record.get("previous_receipt_evidence_id")
    current_live["current_deployment"]=installation
    current_live["current_P2_attempt"]=attempt
    current_live["P2_attempt_history"]=earlier
    current_live.pop("deployment_history",None)
    fix=current_live.get("admin_session_identity_fix")
    if isinstance(fix,dict) and "historical_preparation" in fix:
        if not isinstance(fix["historical_preparation"],dict):
            raise AssertionError("The original identity-fix preparation snapshot is required")
        current_live["admin_session_identity_fix"]=fix["historical_preparation"]
    view["version"]="1.9.70"
    return view


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

    def test_overall_service_requires_paid_in_current_policy(self):
        spec=deepcopy(self.spec)
        next(row for row in spec["operations"] if row["id"]=="overall.analyze")["member_tiers"]=["standard","paid"]
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
        from check_project_consistency import registered_member_shortlist_ids
        member_ids=set(registered_member_shortlist_ids(self.spec))
        self.assertEqual(len(self.spec['operations']),28+len(member_ids))
        self.assertEqual(len([o for o in self.spec['operations'] if o['id'] not in ({'history.snapshot.head','history.snapshot.read','report.list-own'}|member_ids)]),25)

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
                fields=dto["fields"]+dto.get("optional_role_fields",{}).get(role,[])+(dto.get("paid_fields",[]) if role=="paid" else [])
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

    def test_current_external_live_report_preserves_history_and_reports_only_observed_scope(self):
        from check_project_consistency import validate_live_execution,live_execution_document
        self.assertEqual(validate_live_execution(self.spec),[])
        text=live_execution_document(self.spec)
        self.assertIn('EXTERNAL_REPORTED_FUNCTIONAL_PASS',text)
        self.assertIn('operation_scope_not_approved',text)
        self.assertEqual(self.spec['supabase_deployment_contract']['live_execution']['post_registration_acceptance']['real_user_acceptance'],'NOT_RUN')
        self.assertIn('SOURCE_DEPLOYED_REMOTE_EDITOR_VERIFIED',text)
        self.assertIn('0/22 / 0/22',text)
        live=self.spec['supabase_deployment_contract']['live_execution']
        self.assertIs(live['post_live_receipt']['source_fix_deployed'],True)
        self.assertIs(live['post_live_receipt']['historical_source_fix_deployed_before_editor_update'],False)
        self.assertEqual(live['post_registration_acceptance']['source_graph']['recorded_installed_source'],'9e6365e43c748afecf84c9b08e2a70f7ca711c14')

    def test_partial_external_live_report_cannot_promote_unrun_business_or_approval(self):
        from check_project_consistency import validate_live_execution
        for key,value in [('P2_save_analysis_reread','PASS'),('ownership','PASS'),('business_native_accepted',1),('search_scope_approved',True)]:
            wrong=deepcopy(self.spec)
            wrong['supabase_deployment_contract']['live_execution']['post_live_receipt'][key]=value
            self.assertIn('DEV-010 partial BFF report cannot promote unrun business or approval',validate_live_execution(wrong))

    def test_deployed_source_true_requires_actual_receipt_and_registry_entry(self):
        from check_project_consistency import validate_live_execution
        for target in ('deployment','registry'):
            with self.subTest(target=target):
                wrong=deepcopy(self.spec);live=wrong['supabase_deployment_contract']['live_execution']
                if target=='deployment':live.pop('actual_editor_deployment')
                else:live['evidence'].pop(live['actual_editor_deployment']['evidence_id'])
                self.assertIn('DEV-010 actual editor deployment requires receipt-bound evidence',validate_live_execution(wrong))

    def test_actual_deployment_candidate_bundle_and_editor_receipt_must_match(self):
        from check_project_consistency import validate_live_execution
        for field in ('candidate_commit','accepted_develop_merge','tree','bundle','editor_receipt','receipt_sha256','remote_readback'):
            with self.subTest(field=field):
                wrong=deepcopy(self.spec);deployment=wrong['supabase_deployment_contract']['live_execution']['actual_editor_deployment']
                if field in ('candidate_commit','accepted_develop_merge','tree'):deployment['source'][field]='f'*40
                elif field=='bundle':deployment['source']['bundle']['sha256']='f'*64
                elif field in ('editor_receipt','remote_readback'):deployment[field]['sha256']='f'*64
                else:deployment[field]='f'*64
                self.assertIn('DEV-010 actual editor deployment requires receipt-bound evidence',validate_live_execution(wrong))

    def test_actual_deployment_source_hash_must_match_indexed_runtime_code(self):
        from check_project_consistency import validate_live_execution
        wrong=deepcopy(self.spec);live=wrong['supabase_deployment_contract']['live_execution']
        deployment=live['actual_editor_deployment']
        path='supabase/functions/_shared/jungsi/infrastructure/runtime_context.ts'
        deployment['source']['runtime_source_bindings'][path]='f'*64
        live['evidence'][deployment['evidence_id']]['source']=deepcopy(deployment['source'])
        self.assertIn('DEV-010 actual editor deployment source binding drift',validate_live_execution(wrong))

    def test_editor_install_receipt_cannot_certify_operation_or_security_acceptance(self):
        from check_project_consistency import validate_live_execution
        for field,value in [('native','PASS'),('deployment','PASS'),('security_3_gates','PASS'),('production_ready',True),('operation_scope_expanded',True)]:
            with self.subTest(field=field):
                wrong=deepcopy(self.spec);live=wrong['supabase_deployment_contract']['live_execution']
                if field in ('native','deployment'):live['operations']['report.read'][field]=value
                else:live['actual_editor_deployment'][field]=value
                self.assertIn('DEV-010 editor source update cannot certify unrun business or security acceptance',validate_live_execution(wrong))
        wrong=deepcopy(self.spec);live=wrong['supabase_deployment_contract']['live_execution']
        live['evidence'][live['actual_editor_deployment']['evidence_id']]['operations']=['report.read']
        self.assertIn('DEV-010 actual editor deployment requires receipt-bound evidence',validate_live_execution(wrong))

    def test_actual_deployment_cannot_relax_verify_jwt_or_remote_source_match(self):
        from check_project_consistency import validate_live_execution
        for field in ('verify_jwt_remained_true','editor_copyback_match','remote_reload_match','same_existing_project_and_function'):
            with self.subTest(field=field):
                wrong=deepcopy(self.spec)
                wrong['supabase_deployment_contract']['live_execution']['actual_editor_deployment'][field]=False
                self.assertIn('DEV-010 actual editor deployment requires receipt-bound evidence',validate_live_execution(wrong))

    def test_post_deployment_health_and_BFF_observations_need_their_own_receipts(self):
        from check_project_consistency import validate_live_execution
        for field in ('native_readiness','same_BFF_error_observation'):
            with self.subTest(field=field):
                wrong=deepcopy(self.spec);live=wrong['supabase_deployment_contract']['live_execution']
                observation=live['actual_editor_deployment'][field]
                live['evidence'].pop(observation['evidence_id'])
                self.assertIn('DEV-010 deployed follow-up requires scoped receipt-bound evidence: '+field,validate_live_execution(wrong))
                wrong=deepcopy(self.spec);live=wrong['supabase_deployment_contract']['live_execution']
                live['actual_editor_deployment'][field]['bundle_sha256']='f'*64
                self.assertIn('DEV-010 deployed follow-up requires scoped receipt-bound evidence: '+field,validate_live_execution(wrong))

    def test_readiness_and_UI_error_cannot_claim_real_user_or_captured_HTTP_or_aal2(self):
        from check_project_consistency import validate_live_execution
        for field,value in [('actual_user_Bearer_used',True),('DB_student_or_budget_writes_by_probe',1)]:
            wrong=deepcopy(self.spec)
            wrong['supabase_deployment_contract']['live_execution']['actual_editor_deployment']['native_readiness'][field]=value
            self.assertIn('DEV-010 readiness preparation cannot imply real-user or student-write acceptance',validate_live_execution(wrong))
        for field in ('HTTP_status_independently_captured','independent_aal2_admin_verification'):
            wrong=deepcopy(self.spec)
            wrong['supabase_deployment_contract']['live_execution']['actual_editor_deployment']['same_BFF_error_observation'][field]=True
            self.assertIn('DEV-010 BFF safe error observation cannot certify HTTP status or administrator aal2',validate_live_execution(wrong))

    def test_current_failed_P2_attempt_preserves_unknown_HTTP_creation_and_writes(self):
        epoch_spec=observer_epoch_spec(self.spec)
        from check_project_consistency import validate_live_execution,live_execution_document
        live=epoch_spec['supabase_deployment_contract']['live_execution']
        self.assertEqual(live['post_live_receipt']['P2_save_analysis_reread'],'NOT_RUN')
        self.assertIn('ACTUAL_UI_SAVE_ATTEMPT_FAILED_UNDETAILED',live_execution_document(epoch_spec))
        for field,value in [('HTTP_status',422),('safe_error_code','invalid_request'),('profile_created',False),('report_created',True),('DB_writes_independently_observed',0),('retry_count',1),('memory_validation_is_actual_request_result',True),('step_2_analyze','NOT_RUN'),('step_3_reread','NOT_RUN'),('step_2_success_acceptance','PASS')]:
            with self.subTest(field=field):
                wrong=deepcopy(epoch_spec)
                wrong['supabase_deployment_contract']['live_execution']['current_P2_attempt'][field]=value
                self.assertIn('DEV-010 current P2 failed attempt requires receipt and preserves unconfirmed stages',validate_live_execution(wrong))
        for target in ('current_P2_attempt','evidence'):
            wrong=deepcopy(epoch_spec);live=wrong['supabase_deployment_contract']['live_execution']
            if target=='current_P2_attempt':live.pop(target)
            else:live['evidence'].pop(live['current_P2_attempt']['evidence_id'])
            self.assertIn('DEV-010 current P2 failed attempt requires receipt and preserves unconfirmed stages',validate_live_execution(wrong))

    def test_redacted_browser_value_cannot_prove_idempotency_preservation_or_key_DB_readback(self):
        epoch_spec=observer_epoch_spec(self.spec)
        from check_project_consistency import validate_live_execution,live_execution_document
        live=epoch_spec['supabase_deployment_contract']['live_execution']
        self.assertIsNone(live['current_P2_attempt']['same_form_idempotency_key'])
        previous=live['P2_attempt_history'][live['frontend_P2_reply']['earlier_root_attempt']['evidence_id']]
        self.assertEqual(previous['idempotency_context_status'],'BROWSER_VALUE_REDACTED_NOT_CAPTURED')
        self.assertIs(previous['idempotency_capture_claim_corrected'],True)
        self.assertIn('NOT_COLLECTED_BY_FRONTEND',live_execution_document(epoch_spec))
        for field,value in [('same_form_idempotency_key',True),('idempotency_context_status','KEY_PRESERVED'),('reload_after_submit',True),('exact_key_DB_readback_count',1)]:
            with self.subTest(field=field):
                wrong=deepcopy(epoch_spec)
                wrong['supabase_deployment_contract']['live_execution']['current_P2_attempt'][field]=value
                self.assertIn('DEV-010 current P2 failed attempt requires receipt and preserves unconfirmed stages',validate_live_execution(wrong))

    def test_frontend_P2_reply_preserves_previous_attempt_and_separates_unpushed_worker(self):
        from check_project_consistency import validate_live_execution,live_execution_document
        live=self.spec['supabase_deployment_contract']['live_execution'];reply=live['frontend_P2_reply']
        self.assertEqual(validate_live_execution(self.spec),[])
        self.assertNotEqual(reply['earlier_root_attempt']['evidence_id'],reply['current_P2_attempt_evidence_id'])
        self.assertIn('PENDING_DEPLOYMENT_AND_SOURCE_SHA',live_execution_document(self.spec))
        for field,value in [('source_commit','f'*40),('source_pushed',True),('independent_source_binding_verified',True)]:
            with self.subTest(field=field):
                wrong=deepcopy(self.spec)
                wrong['supabase_deployment_contract']['live_execution']['frontend_P2_reply']['reported_worker_deployment'][field]=value
                self.assertIn('DEV-010 external P2 report cannot certify source HTTP stage or zero writes',validate_live_execution(wrong))

    def test_frontend_P2_generic_failure_cannot_prove_HTTP_stage_or_zero_writes(self):
        from check_project_consistency import validate_live_execution
        for field,value in [('HTTP_status',503),('stage','overall.analyze'),('safe_error_code','security_policy_unavailable'),('request_id','captured'),('idempotency_key','captured'),('DB_writes_independently_observed',0),('partial_profile_possible',False),('same_fixture_as_root_attempt',True),('overall_success','PASS'),('retry_count',1)]:
            with self.subTest(field=field):
                wrong=deepcopy(self.spec)
                wrong['supabase_deployment_contract']['live_execution']['frontend_P2_reply']['separate_frontend_attempt'][field]=value
                self.assertIn('DEV-010 external P2 report cannot certify source HTTP stage or zero writes',validate_live_execution(wrong))
        wrong=deepcopy(self.spec)
        wrong['supabase_deployment_contract']['live_execution']['frontend_P2_reply']['earlier_root_attempt']['HTTP_status']=422
        self.assertIn('DEV-010 external P2 report cannot certify source HTTP stage or zero writes',validate_live_execution(wrong))

    def test_P2_pending_diagnostics_cannot_expose_keys_or_claim_deployment(self):
        from check_project_consistency import validate_live_execution
        for field,value in [('deployed',True),('source_commit','f'*40),('server_only_fields',['stage','path','status','code','request_id','body']),('user_visible_fields',['stage','safe_error_code','request_id']),('forbidden_fields',[])]:
            with self.subTest(field=field):
                wrong=deepcopy(self.spec)
                wrong['supabase_deployment_contract']['live_execution']['frontend_P2_reply']['safe_observation_followup'][field]=value
                self.assertIn('DEV-010 pending P2 diagnostics must keep safe observation and approval boundaries',validate_live_execution(wrong))

    def test_frontend_P2_reply_cannot_drop_history_receipt_or_promote_admin_UI(self):
        from check_project_consistency import validate_live_execution
        for target in ('frontend_P2_reply','P2_attempt_history','reply_evidence'):
            wrong=deepcopy(self.spec);live=wrong['supabase_deployment_contract']['live_execution']
            if target=='reply_evidence':live['evidence'].pop(live['frontend_P2_reply']['evidence_id'])
            else:live.pop(target)
            self.assertIn('DEV-010 frontend P2 reply requires scoped evidence and preserved history',validate_live_execution(wrong))
        for field in ('independent_API_JWT_trace','independent_aal2_trace','earlier_standard_headline_contradicted'):
            wrong=deepcopy(self.spec)
            wrong['supabase_deployment_contract']['live_execution']['frontend_P2_reply']['admin_UI_observation'][field]=True
            self.assertIn('DEV-010 administrator UI observation cannot certify API JWT or aal2',validate_live_execution(wrong))

    def test_preserved_root_P2_history_cannot_gain_inferred_HTTP_or_zero_writes(self):
        from check_project_consistency import validate_live_execution
        for field,value in [('HTTP_status',422),('safe_error_code','exam_not_available'),('profile_created',False),('report_created',False),('DB_writes_independently_observed',0),('retry_count',1),('reload_after_submit',True),('exact_key_DB_readback_count',1),('production_ready',True),('step_2_analyze','PASS')]:
            with self.subTest(field=field):
                wrong=deepcopy(self.spec);live=wrong['supabase_deployment_contract']['live_execution']
                live['P2_attempt_history'][live['frontend_P2_reply']['earlier_root_attempt']['evidence_id']][field]=value
                self.assertIn('DEV-010 historical P2 attempt must preserve unknown result and no-retry boundaries',validate_live_execution(wrong))
        wrong=deepcopy(self.spec)
        live=wrong['supabase_deployment_contract']['live_execution']
        live['P2_attempt_history'][live['frontend_P2_reply']['current_P2_attempt_evidence_id']]['previous_receipt_evidence_id']='unrelated'
        self.assertIn('DEV-010 frontend P2 reply requires scoped evidence and preserved history',validate_live_execution(wrong))

    def test_backend_observation_plan_cannot_claim_deployment_or_share_request_context(self):
        from check_project_consistency import validate_live_execution
        for field,value in [('implementation','PASS'),('verification','PASS'),('deployment','PASS'),('implementation_candidate_commit','f'*40),('shared_mutable_diagnostic_context',True),('request_local_context',False),('normalized_template_path_only',False),('existing_error_DTO_preserved',False),('security_or_budget_relaxed',True),('server_only_fields',['operation','stage','path','status','code','request_id','subject'])]:
            with self.subTest(field=field):
                wrong=deepcopy(self.spec)
                wrong['supabase_deployment_contract']['live_execution']['backend_safe_observation_plan'][field]=value
                self.assertIn('DEV-010 backend safe observation requires source-bound scoped evidence without deployment acceptance',validate_live_execution(wrong))

    def test_observation_candidate_requires_exact_source_and_test_hash_bindings(self):
        from check_project_consistency import validate_live_execution
        for key in ('source_bindings','test_bindings'):
            for mutation in ('missing','hash','extra'):
                with self.subTest(key=key,mutation=mutation):
                    wrong=deepcopy(self.spec);bindings=wrong['supabase_deployment_contract']['live_execution']['backend_safe_observation_plan'][key]
                    path=next(iter(bindings))
                    if mutation=='missing':bindings.pop(path)
                    elif mutation=='hash':bindings[path]='0'*64
                    else:bindings['unregistered.ts']='0'*64
                    self.assertIn('DEV-010 backend safe observation requires source-bound scoped evidence without deployment acceptance',validate_live_execution(wrong))

    def test_observation_candidate_cannot_promote_native_or_change_log_scope(self):
        from check_project_consistency import validate_live_execution
        for key,value in [('native_verification','PASS'),('business_native_accepted',1),('business_deployment_accepted',True),('production_ready',True),('event_policy','ALL_REQUESTS'),('observer_failure_does_not_rerun_work',False),('created_response_body_unread',False),('forbidden_fields',[]),('status','VERIFIED')]:
            with self.subTest(key=key):
                wrong=deepcopy(self.spec);wrong['supabase_deployment_contract']['live_execution']['backend_safe_observation_plan'][key]=value
                self.assertIn('DEV-010 backend safe observation requires source-bound scoped evidence without deployment acceptance',validate_live_execution(wrong))

    def test_observation_candidate_requires_focused_synthetic_evidence_and_normal_gate(self):
        from check_project_consistency import validate_live_execution
        for key,value in [('scope','REAL_USER_PASS'),('new_tests',0),('focused_passed',0),('focused_failed',1),('focused_log_sha256',''),('focused_log_sha256',int('1'*64)),('full_suite_expected',0),('full_suite_expected',584.0),('full_snapshot_gate_required',False),('deployment_or_real_user_evidence',True)]:
            with self.subTest(key=key):
                wrong=deepcopy(self.spec);wrong['supabase_deployment_contract']['live_execution']['backend_safe_observation_plan']['synthetic_verification'][key]=value
                self.assertIn('DEV-010 backend safe observation requires source-bound scoped evidence without deployment acceptance',validate_live_execution(wrong))

    def test_observation_contract_preserves_pending_legacy_and_documents_source_candidate(self):
        from check_project_consistency import validate_backend_safe_observation_plan,live_execution_document
        self.assertEqual(validate_backend_safe_observation_plan(self.spec),[])
        self.assertIn('설치 당시 관측 계약·소스4개·테스트2개 고정',live_execution_document(self.spec))
        wrong=deepcopy(self.spec);b=wrong['supabase_deployment_contract']['live_execution']['backend_safe_observation_plan']
        b.update(status='CONTRACT_PREPARED_IMPLEMENTATION_PENDING',implementation_candidate_commit=None,implementation='NOT_RUN',verification='NOT_RUN',deployment='NOT_RUN',native_verification='NOT_RUN',server_only_fields=['operation','stage','path','status','code','request_id'],forbidden_fields=['subject','account','scores','body','token','keys','cookie','query','stack'])
        self.assertEqual(validate_backend_safe_observation_plan(wrong),[])
        b['implementation']='PASS'
        self.assertTrue(validate_backend_safe_observation_plan(wrong))
        b['implementation']='NOT_RUN'
        for key,value in [('native_verification','PASS'),('production_ready',True),('business_native_accepted',True),('business_native_accepted',1),('business_deployment_accepted',True),('business_deployment_accepted',1)]:
            with self.subTest(key=key,value=value):
                pending=deepcopy(wrong);pending['supabase_deployment_contract']['live_execution']['backend_safe_observation_plan'][key]=value
                self.assertTrue(validate_backend_safe_observation_plan(pending))
        for key in ('native_verification','production_ready','business_native_accepted','business_deployment_accepted'):b.pop(key)
        self.assertEqual(validate_backend_safe_observation_plan(wrong),[])


    def test_admin_identity_fix_preserves_deployed_observer_and_requires_current_hashes(self):
        epoch_spec=observer_epoch_spec(self.spec)
        from check_project_consistency import validate_live_execution,deployed_observer_contract_pinned,live_execution_document
        self.assertEqual(validate_live_execution(epoch_spec),[])
        self.assertTrue(deployed_observer_contract_pinned(epoch_spec))
        live=epoch_spec['supabase_deployment_contract']['live_execution']
        self.assertEqual(live['backend_safe_observation_plan']['synthetic_verification']['full_suite_expected'],584)
        self.assertEqual(live['admin_session_identity_fix']['synthetic_verification']['full_suite_expected'],590)
        self.assertEqual(epoch_spec['edge_harness']['unit_count'],656)
        self.assertIn('관리자 세션의 예산 연결 수정 후보 · 미배포',live_execution_document(epoch_spec))

    def test_admin_identity_fix_rejects_missing_or_stale_source_and_test_binding(self):
        epoch_spec=observer_epoch_spec(self.spec)
        from check_project_consistency import validate_live_execution
        for key in ('source_bindings','test_bindings'):
            for kind in ('missing','hash','extra'):
                wrong=deepcopy(epoch_spec);bindings=wrong['supabase_deployment_contract']['live_execution']['admin_session_identity_fix'][key]
                path=next(iter(bindings))
                if kind=='missing':bindings.pop(path)
                elif kind=='hash':bindings[path]='0'*64
                else:bindings['unregistered.ts']='0'*64
                self.assertIn('DEV-010 admin session identity fix requires immutable provenance current hashes and undeployed acceptance',validate_live_execution(wrong))

    def test_admin_identity_fix_cannot_mint_brand_relax_guards_or_promote_native(self):
        epoch_spec=observer_epoch_spec(self.spec)
        from check_project_consistency import validate_live_execution
        for key,value in [('both_frozen_required',False),('mutable_session_copy_defense_preserved',False),('body_query_params_copy_preserved',False),('weakset_mutated',True),('serialized_admin_origin_trusted',True),('auth_or_expiry_relaxed',True),('policy_or_scope_changed',True),('actual_failed_request_fully_attributed',True),('production_ready',True),('deployment','PASS'),('native_verification','PASS'),('business_native_accepted',True),('business_deployment_accepted',1),('actual_HTTP_requests',1),('actual_HTTP_requests',False),('implementation_candidate_commit','f'*40)]:
            wrong=deepcopy(epoch_spec);wrong['supabase_deployment_contract']['live_execution']['admin_session_identity_fix'][key]=value
            self.assertIn('DEV-010 admin session identity fix requires immutable provenance current hashes and undeployed acceptance',validate_live_execution(wrong))

    def test_admin_identity_fix_requires_native_counts_hashes_and_full_snapshot_gate(self):
        epoch_spec=observer_epoch_spec(self.spec)
        from check_project_consistency import validate_live_execution
        for key,value in [('new_tests',0),('before_failed',0),('focused_passed',108.0),('focused_failed',True),('focused_failed',False),('full_suite_expected',590.0),('focused_log_sha256',int('1'*64)),('focused_log_sha256','g'*64),('before_log_sha256',''),('full_snapshot_gate_required',False),('deployment_or_real_user_evidence',True)]:
            wrong=deepcopy(epoch_spec);wrong['supabase_deployment_contract']['live_execution']['admin_session_identity_fix']['synthetic_verification'][key]=value
            self.assertIn('DEV-010 admin session identity fix requires immutable provenance current hashes and undeployed acceptance',validate_live_execution(wrong))

    def test_admin_identity_fix_cannot_rewrite_deployed_observer_contract(self):
        epoch_spec=observer_epoch_spec(self.spec)
        from check_project_consistency import validate_live_execution
        for target in ('historical_count','historical_test','pin'):
            wrong=deepcopy(epoch_spec);live=wrong['supabase_deployment_contract']['live_execution']
            if target=='historical_count':live['backend_safe_observation_plan']['synthetic_verification']['full_suite_expected']=590
            elif target=='historical_test':live['backend_safe_observation_plan']['test_bindings']['tests/edge/test_runtime_budget.ts']=live['admin_session_identity_fix']['test_bindings']['tests/edge/test_runtime_budget.ts']
            else:live['admin_session_identity_fix']['deployed_observer_contract_sha256']='0'*64
            self.assertIn('DEV-010 admin session identity fix requires immutable provenance current hashes and undeployed acceptance',validate_live_execution(wrong))

    def test_admin_identity_fix_is_required_and_preparation_parent_cannot_be_forged(self):
        epoch_spec=observer_epoch_spec(self.spec)
        from check_project_consistency import validate_live_execution
        for target in ('missing','parent','status'):
            wrong=deepcopy(epoch_spec);live=wrong['supabase_deployment_contract']['live_execution']
            if target=='missing':live.pop('admin_session_identity_fix')
            elif target=='parent':live['admin_session_identity_fix']['basis_commit']='f'*40
            else:live['admin_session_identity_fix']['basis_verification']='UNVERIFIED_READY'
            self.assertIn('DEV-010 admin session identity fix requires immutable provenance current hashes and undeployed acceptance',validate_live_execution(wrong))

    def test_current_source_deployment_preserves_old_installation_and_failed_attempts(self):
        epoch_spec=observer_epoch_spec(self.spec)
        from check_project_consistency import validate_live_execution,live_execution_document,live_P2_attempt
        live=epoch_spec['supabase_deployment_contract']['live_execution']
        self.assertEqual(validate_live_execution(epoch_spec),[])
        self.assertEqual(live['actual_editor_deployment']['source']['spec_version'],'1.9.65')
        self.assertEqual(live['current_deployment']['source']['spec_version'],'1.9.68')
        self.assertNotEqual(live['actual_editor_deployment']['receipt_sha256'],live['current_deployment']['receipt_sha256'])
        for evidence_id in (live['frontend_P2_reply']['earlier_root_attempt']['evidence_id'],live['frontend_P2_reply']['current_P2_attempt_evidence_id']):
            row=live_P2_attempt(live,evidence_id)
            self.assertIsNone(row['HTTP_status']);self.assertIsNone(row['DB_writes_independently_observed'])
        self.assertIn('TIME_AND_OPERATION_ONLY',live_execution_document(epoch_spec))
        self.assertIn('OWNER_CASE_SNAPSHOT_ONLY',live_execution_document(epoch_spec))

    def test_current_source_deployment_requires_bound_receipt_manifest_and_remote_bytes(self):
        epoch_spec=observer_epoch_spec(self.spec)
        from check_project_consistency import validate_current_deployment
        for field,value in [('receipt_sha256','f'*64),('receipt_bytes',True),('remote_readback',{}),('editor_reload_verified',False),('verify_jwt_remained_true',False),('previous_deployment_evidence_id','unrelated'),('business_native_accepted',True),('production_ready',True)]:
            with self.subTest(field=field):
                wrong=deepcopy(epoch_spec);wrong['supabase_deployment_contract']['live_execution']['current_deployment'][field]=value
                self.assertTrue(validate_current_deployment(wrong))
        for field,value in [('source_files_count',64.0),('runtime_source_bindings',{}),('source_manifest',{'bytes':True,'sha256':'f'*64})]:
            wrong=deepcopy(epoch_spec);wrong['supabase_deployment_contract']['live_execution']['current_deployment']['source'][field]=value
            self.assertTrue(validate_current_deployment(wrong))

    def test_current_readiness_cannot_use_other_deployment_receipt_or_business_proof(self):
        epoch_spec=observer_epoch_spec(self.spec)
        from check_project_consistency import validate_current_deployment
        for field,value in [('source_deployment_receipt_sha256','f'*64),('bundle_sha256','f'*64),('actual_user_Bearer_used',True),('DB_student_or_budget_writes_by_probe',False)]:
            wrong=deepcopy(epoch_spec);wrong['supabase_deployment_contract']['live_execution']['current_deployment']['native_readiness'][field]=value
            self.assertTrue(validate_current_deployment(wrong))
        wrong=deepcopy(epoch_spec);live=wrong['supabase_deployment_contract']['live_execution']
        live['evidence'][live['current_deployment']['native_readiness']['evidence_id']]['source_deployment_receipt_sha256']='f'*64
        self.assertTrue(validate_current_deployment(wrong))

    def test_current_P2_history_rejects_duplicate_cycle_or_unrelated_previous_receipt(self):
        epoch_spec=observer_epoch_spec(self.spec)
        from check_project_consistency import validate_P2_attempt_records
        for mutation in ('duplicate','self','unrelated','cycle','external_http'):
            with self.subTest(mutation=mutation):
                wrong=deepcopy(epoch_spec);live=wrong['supabase_deployment_contract']['live_execution'];row=live['current_P2_attempt']
                external=live['P2_attempt_history'][live['frontend_P2_reply']['current_P2_attempt_evidence_id']]
                if mutation=='duplicate':live['P2_attempt_history'][row['evidence_id']]=deepcopy(row)
                elif mutation=='self':row['previous_receipt_evidence_id']=row['evidence_id']
                elif mutation=='unrelated':row['previous_receipt_evidence_id']=live['current_deployment']['native_readiness']['evidence_id']
                elif mutation=='cycle':external['previous_receipt_evidence_id']=row['evidence_id']
                else:external['HTTP_status']=503
                self.assertTrue(validate_P2_attempt_records(live,live['evidence']))

    def test_current_P2_scoped_logs_and_snapshots_cannot_certify_UI_or_all_writes(self):
        epoch_spec=observer_epoch_spec(self.spec)
        from check_project_consistency import validate_P2_attempt_records
        for target,field,value in [('row','UI_HTTP_status',503),('row','DB_writes_independently_observed',0),('log','actor_binding_proven',True),('log','BFF_request_id_binding_proven',True),('log','UI_status_binding_proven',True),('snapshot','all_database_writes_zero_proven',True),('snapshot','browser_Bearer_subject_binding_proven',True),('snapshot','owner_exact_match_count',True)]:
            with self.subTest(target=target,field=field):
                wrong=deepcopy(epoch_spec);live=wrong['supabase_deployment_contract']['live_execution'];row=live['current_P2_attempt']
                selected=row if target=='row'else row['scoped_safe_logs'][0]if target=='log'else row['scoped_readonly_observations'][0]
                selected[field]=value
                self.assertTrue(validate_P2_attempt_records(live,live['evidence']))

    def test_current_P2_step_requires_exact_attempt_operation_and_request_binding(self):
        epoch_spec=observer_epoch_spec(self.spec)
        from check_project_consistency import validate_P2_attempt_records
        wrong=deepcopy(epoch_spec);live=wrong['supabase_deployment_contract']['live_execution']
        previous=deepcopy(live['current_P2_attempt'])
        live['P2_attempt_history'][previous['evidence_id']]=previous
        row=deepcopy(previous);row['evidence_id']='SYNTHETIC-EXACT-ATTEMPT'
        row['receipt_sha256']='6'*64;row['previous_receipt_evidence_id']=previous['evidence_id']
        row['scope']='Synthetic exact-response unit fixture; the original failed attempt is preserved.'
        live['current_P2_attempt']=row
        live['evidence'][row['evidence_id']]=dict(deepcopy(live['evidence'][previous['evidence_id']]),receipt_sha256=row['receipt_sha256'])
        row['steps']['profile_create'].update(status='OBSERVED_FAILURE',HTTP_status=503,safe_error_code='security_policy_unavailable',evidence_id=row['scoped_safe_logs'][0]['evidence_id'])
        self.assertTrue(validate_P2_attempt_records(live,live['evidence']))
        proof=deepcopy(live['evidence'][row['evidence_id']]);ref='SYNTHETIC-EXACT-PROFILE-RESPONSE'
        proof.update(kind='native_api',attempt_evidence_id=row['evidence_id'],operation_id='score-profile.create',observation_scope='EXACT_ATTEMPT_OPERATION_RESPONSE',exact_request_binding_verified=True,receipt_sha256='1'*64)
        live['evidence'][ref]=proof;row['steps']['profile_create'].update(status='OBSERVED_SUCCESS',HTTP_status=201,safe_error_code=None,evidence_id=ref)
        self.assertEqual(validate_P2_attempt_records(live,live['evidence']),[])
        for field,value in [('attempt_evidence_id','unrelated'),('operation_id','overall.analyze'),('exact_request_binding_verified',False)]:
            changed=deepcopy(live);changed['evidence'][ref][field]=value
            self.assertTrue(validate_P2_attempt_records(changed,changed['evidence']))
        row['steps']['profile_create']['HTTP_status']=True
        self.assertTrue(validate_P2_attempt_records(live,live['evidence']))

    def test_current_deployment_requires_reverse_P2_pointer_and_keeps_synthetic_scope(self):
        epoch_spec=observer_epoch_spec(self.spec)
        from check_project_consistency import validate_current_deployment,validate_backend_safe_observation_plan
        for value in (None,'unrelated'):
            wrong=deepcopy(epoch_spec);wrong['supabase_deployment_contract']['live_execution']['current_deployment']['current_P2_attempt_evidence_id']=value
            self.assertTrue(validate_current_deployment(wrong))
        wrong=deepcopy(epoch_spec);wrong['supabase_deployment_contract']['live_execution']['backend_safe_observation_plan']['synthetic_verification']['deployment_or_real_user_evidence']=True
        self.assertTrue(validate_backend_safe_observation_plan(wrong))

    def test_current_observer_visible_events_cannot_certify_all_logs_actor_or_business(self):
        epoch_spec=observer_epoch_spec(self.spec)
        from check_project_consistency import validate_current_deployment
        for field,value in [('visible_event_count',True),('exact_fields',['operation','stage','status','code','request_id','body']),('all_checked_event_keys_match',False),('all_checked_request_ids_match',False),('whole_log_nonexposure_proven',True),('specific_BFF_actor_binding_proven',True),('business_success_proven',True),('source_deployment_receipt_sha256','f'*64)]:
            wrong=deepcopy(epoch_spec);wrong['supabase_deployment_contract']['live_execution']['current_deployment']['safe_observer_acceptance'][field]=value
            self.assertTrue(validate_current_deployment(wrong))
        wrong=deepcopy(epoch_spec);live=wrong['supabase_deployment_contract']['live_execution'];obs=live['current_deployment']['safe_observer_acceptance']
        live['evidence'][obs['evidence_id']]['source_deployment_receipt_sha256']='f'*64
        self.assertTrue(validate_current_deployment(wrong))

    def test_scope_error_cannot_be_success_or_hide_invalid_policy(self):
        from check_project_consistency import validate_live_execution
        wrong=deepcopy(self.spec)
        wrong['supabase_deployment_contract']['live_execution']['post_live_receipt']['scope_error_contract']['invalid_binding_or_policy']['code']='operation_scope_not_approved'
        self.assertIn('DEV-010 operation scope classification cannot expand approval or bypass policy',validate_live_execution(wrong))


    def test_post_registration_readiness_cannot_be_used_as_user_business_or_performance_acceptance(self):
        from check_project_consistency import validate_live_execution
        for key,value in (('real_user_acceptance','PASS'),('BFF_live_browser','PASS'),('business_native_accepted',1),('performance_acceptance',True)):
            wrong=deepcopy(self.spec)
            wrong['supabase_deployment_contract']['live_execution']['post_registration_acceptance'][key]=value
            self.assertIn('DEV-010 readiness cannot promote user business or performance acceptance',validate_live_execution(wrong))

    def test_post_registration_owner_report_and_readiness_require_their_actual_evidence(self):
        from check_project_consistency import validate_live_execution
        wrong=deepcopy(self.spec)
        post=wrong['supabase_deployment_contract']['live_execution']['post_registration_acceptance']
        post['owner_registration']['independent_Dashboard_reread']=True
        post['readiness']['receipt_sha256']='f'*64
        result=validate_live_execution(wrong)
        self.assertIn('DEV-010 owner report evidence scope drift',result)
        self.assertIn('DEV-010 readiness requires scoped real response evidence',result)

    def test_post_registration_limited_bff_sequence_cannot_collect_tokens_or_expand_selected_data_scope(self):
        from check_project_consistency import validate_live_execution
        for change in ('sequence','scope','preview'):
            wrong=deepcopy(self.spec)
            post=wrong['supabase_deployment_contract']['live_execution']['post_registration_acceptance']
            if change=='sequence':post['next_sequence']=['OWNER_EXPORT_JWT_TO_SERVICE']
            elif change=='scope':post['selected_runtime_operations'].append('candidates.build')
            else:post['preview_gate_preserved']=False
            self.assertIn('DEV-010 limited BFF sequence or approved scope drift',validate_live_execution(wrong))


    def test_bff_source_reply_cannot_be_promoted_to_registration_or_live_acceptance(self):
        from check_project_consistency import validate_live_execution
        for change in ('owner','native','browser'):
            wrong=deepcopy(self.spec)
            intake=wrong['supabase_deployment_contract']['live_execution']['bff_reply_intake']
            if change=='owner':
                intake['registration']['receipt_sha256']=None
                expected='DEV-010 BFF registration needs owner receipt'
            elif change=='native':
                intake['source_review_is_operating_acceptance']=True
                expected='DEV-010 BFF reply cannot certify live acceptance'
            else:
                intake['reported_state']['live_browser']='PASS'
                expected='DEV-010 BFF synthetic reply is not native evidence'
            self.assertIn(expected,validate_live_execution(wrong))

    def test_bff_same_bearer_relay_and_ingress_contract_cannot_drift(self):
        from check_project_consistency import validate_live_execution
        for key,value in (('caller_appends','/api/v1/api/v1'),('relay_header','X-Other-Relay'),('same_verified_Bearer_required',False),('same_verified_Bearer_required',1)):
            wrong=deepcopy(self.spec)
            wrong['supabase_deployment_contract']['live_execution']['bff_reply_intake']['transport'][key]=value
            self.assertIn('DEV-010 BFF source transport contract drift',validate_live_execution(wrong))

    def test_bff_source_hash_and_required_owner_browser_security_gates_are_bound(self):
        from check_project_consistency import validate_live_execution,live_execution_document
        wrong=deepcopy(self.spec)
        intake=wrong['supabase_deployment_contract']['live_execution']['bff_reply_intake']
        intake['source_review']['service']['supabase/functions/_shared/jungsi/infrastructure/auth_relay.ts']='f'*64
        intake['acceptance_gates'].pop()
        errors=validate_live_execution(wrong)
        self.assertIn('DEV-010 BFF service source binding drift',errors)
        self.assertIn('DEV-010 BFF remaining acceptance gates drift',errors)
        text=live_execution_document(self.spec)
        for value in ('OWNER_REPORTED_REGISTERED','BFF_LIVE_BROWSER','SECURITY_3_GATES','새 API 호출'):
            self.assertIn(value,text)


    def test_preconnection_cases_follow_canonical_routes_and_cover_all_operations(self):
        from check_project_consistency import validate_live_execution,live_execution_document
        wrong=deepcopy(self.spec)
        prep=wrong['supabase_deployment_contract']['live_execution']['preconnection_preparation']
        prep['cases'].pop('history.search')
        self.assertIn('DEV-010 preparation acceptance cases drift',validate_live_execution(wrong))
        wrong=deepcopy(self.spec)
        wrong['operations'][0]['path']='/api/v1/synthetic-current-route'
        body=live_execution_document(wrong)
        self.assertIn('history.search / GET /api/v1/synthetic-current-route',body)
        self.assertIn('실제 native/deployment 증거가 아니다',body)

    def test_preconnection_cannot_promote_source_or_prepared_case_to_live_approval(self):
        from check_project_consistency import validate_live_execution
        for field in ('source_registration_is_execution_approval','prepared_cases_are_execution_evidence'):
            wrong=deepcopy(self.spec)
            wrong['supabase_deployment_contract']['live_execution']['preconnection_preparation'][field]=True
            self.assertIn('DEV-010 preparation cannot promote approval or live acceptance',validate_live_execution(wrong))

    def test_preconnection_requires_all_packages_and_bound_execution_evidence(self):
        from check_project_consistency import validate_live_execution
        wrong=deepcopy(self.spec)
        prep=wrong['supabase_deployment_contract']['live_execution']['preconnection_preparation']
        prep['packages'][-1]['operation_ids'].pop()
        self.assertIn('DEV-010 preparation acceptance package omits operations',validate_live_execution(wrong))
        wrong=deepcopy(self.spec)
        wrong['supabase_deployment_contract']['live_execution']['preconnection_preparation']['evidence_fields'].remove('artifact_snapshot_sha256')
        self.assertIn('DEV-010 preparation evidence binding missing',validate_live_execution(wrong))


    def test_runtime_alias_contract_rejects_privileged_defaults_and_generated_docs_keep_the_boundary(self):
        from check_project_consistency import validate_live_execution,live_execution_document
        modes=(False,True) if 'current_aux_source_rebounds_20261113' in self.spec else (False,)
        for rebound in modes:
            for name in ('DATABASE_URL','SUPABASE_SECRET_KEY'):
                with self.subTest(rebound=rebound,name=name):
                    spec=deepcopy(self.spec)
                    if not rebound:spec.pop('current_aux_source_rebounds_20261113',None)
                    spec['supabase_deployment_contract']['live_execution']['runtime_assembly']['environment_aliases'][name]='SUPABASE_DB_URL'
                    expected=('DEV-010 runtime assembly current source rebound invalid' if rebound else 'DEV-010 runtime environment aliases drift')
                    self.assertIn(expected,validate_live_execution(spec))
        text=live_execution_document(self.spec)
        for value in ('JUNGSI_DISPLAY_DATABASE_URL','JUNGSI_DISPLAY_DATABASE_CA','JUNGSI_DISPLAY_PUBLISHABLE_KEY','JUNGSI_DISPLAY_STORAGE_SECRET','빈 값','복수 key','display descriptor'):
            self.assertIn(value,text)

    def test_runtime_assembly_missing_scope_or_stale_entry_cannot_claim_source_assembly(self):
        from check_project_consistency import validate_live_execution
        modes=(False,True) if 'current_aux_source_rebounds_20261113' in self.spec else (False,)
        for rebound in modes:
            for mutation in ('native_entry','composition','scope','missing'):
                with self.subTest(rebound=rebound,mutation=mutation):
                    spec=deepcopy(self.spec)
                    if not rebound:spec.pop('current_aux_source_rebounds_20261113',None)
                    live=spec['supabase_deployment_contract']['live_execution']
                    if mutation in ('native_entry','composition'):
                        live['runtime_assembly']['bindings'][mutation]['source_sha256']='f'*64
                        legacy='DEV-010 runtime assembly source binding drift: '+mutation
                    elif mutation=='scope':
                        live['runtime_assembly']['operation_ids'].pop()
                        legacy='DEV-010 runtime assembly scope drift'
                    else:
                        live.pop('runtime_assembly')
                        legacy='DEV-010 runtime assembly missing'
                    expected='DEV-010 runtime assembly current source rebound invalid' if rebound else legacy
                    self.assertIn(expected,validate_live_execution(spec))

    def test_runtime_assembly_settings_cannot_contain_actual_values_or_drop_pending_inputs(self):
        from check_project_consistency import validate_live_execution
        modes=(False,True) if 'current_aux_source_rebounds_20261113' in self.spec else (False,)
        for rebound in modes:
            for mutation in ('environment','waiting'):
                with self.subTest(rebound=rebound,mutation=mutation):
                    spec=deepcopy(self.spec)
                    if not rebound:spec.pop('current_aux_source_rebounds_20261113',None)
                    assembly=spec['supabase_deployment_contract']['live_execution']['runtime_assembly']
                    if mutation=='environment':
                        assembly['environment'][0]['value']='SYNTHETIC'
                        legacy='DEV-010 runtime environment contract drift'
                    else:
                        assembly['waiting']=[]
                        legacy='DEV-010 runtime assembly waiting conditions missing'
                    expected='DEV-010 runtime assembly current source rebound invalid' if rebound else legacy
                    self.assertIn(expected,validate_live_execution(spec))

    def test_runtime_assembly_current_rebound_rejects_forged_or_missing_binding(self):
        from check_project_consistency import validate_live_execution
        if 'current_aux_source_rebounds_20261113' not in self.spec:
            self.skipTest('historical snapshot has no current auxiliary rebound')
        original=deepcopy(self.spec)
        for mutation in ('history_pin','current_pin','missing_family','wrong_state','missing_assembly'):
            with self.subTest(mutation=mutation):
                spec=deepcopy(self.spec);marker=spec['current_aux_source_rebounds_20261113']
                entry=marker['families']['dev010_runtime_assembly']
                if mutation=='history_pin':entry['historical_sha256']='0'*64
                elif mutation=='current_pin':entry['changed_source_bindings'][next(iter(entry['changed_source_bindings']))]='0'*64
                elif mutation=='missing_family':marker['families'].pop('dev010_runtime_assembly')
                elif mutation=='wrong_state':marker['activation_status']='PASS'
                else:spec['supabase_deployment_contract']['live_execution'].pop('runtime_assembly')
                self.assertIn('DEV-010 runtime assembly current source rebound invalid',validate_live_execution(spec))
        self.assertEqual(self.spec,original)

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

# Planning1.9.71 regressions share the existing authorized test path.
# The standalone source module remains preserved and is not imported here.
import check_project_consistency as _planning1971_checker
_PLANNING1971_ROOT = ROOT

_PLANNING1971_SYNTHETIC_DEPLOYMENT = 'SYNTHETIC-UNIT-DEPLOYMENT'
_PLANNING1971_SYNTHETIC_ATTEMPT = 'SYNTHETIC-UNIT-P2-V2'
_PLANNING1971_SYNTHETIC_COMMIT = _planning1971_checker.ADMIN_FIX_SOURCE_COMMIT
_PLANNING1971_SYNTHETIC_DEPLOYMENT_SHA = 'b' * 64
_PLANNING1971_SYNTHETIC_ATTEMPT_SHA = 'c' * 64

def _planning1971_observer_epoch_spec(spec):
    """Explicit legacy-only view; preserve the supplied current spec and every original record."""
    view = deepcopy(spec)
    current_live = view['supabase_deployment_contract']['live_execution']
    deployment_id = 'OPS-SAFE-OBSERVER-DEPLOYED-20261016'
    attempt_id = 'OPS-P2-OBSERVER-ATTEMPT-20261016'
    installation = current_live.get('current_deployment')
    if not isinstance(installation, dict) or installation.get('evidence_id') != deployment_id:
        deployments = current_live.get('deployment_history', {})
        installation = deployments.get(deployment_id) if isinstance(deployments, dict) else None
    if not isinstance(installation, dict) or installation.get('evidence_id') != deployment_id:
        raise AssertionError('The preserved observer installation is required for this legacy fixture')
    history = current_live.get('P2_attempt_history', {})
    if not isinstance(history, dict):
        raise AssertionError('The preserved P2 history is required for this legacy fixture')
    attempt = current_live.get('current_P2_attempt')
    if not isinstance(attempt, dict) or attempt.get('evidence_id') != attempt_id:
        attempt = history.get(attempt_id)
    if not isinstance(attempt, dict) or attempt.get('evidence_id') != attempt_id:
        raise AssertionError('The preserved observer P2 attempt is required for this legacy fixture')
    earlier = {}
    cursor = attempt.get('previous_receipt_evidence_id')
    while cursor in history:
        if cursor == attempt_id or cursor in earlier:
            raise AssertionError('The preserved observer predecessor chain must not contain a cycle')
        record = history[cursor]
        if not isinstance(record, dict) or record.get('evidence_id') != cursor:
            raise AssertionError('The preserved observer predecessor reference is malformed')
        earlier[cursor] = record
        cursor = record.get('previous_receipt_evidence_id')
    current_live['current_deployment'] = installation
    current_live['current_P2_attempt'] = attempt
    current_live['P2_attempt_history'] = earlier
    current_live.pop('deployment_history', None)
    fix = current_live.get('admin_session_identity_fix')
    if isinstance(fix, dict) and 'historical_preparation' in fix:
        if not isinstance(fix['historical_preparation'], dict):
            raise AssertionError('The original identity-fix preparation snapshot is required')
        current_live['admin_session_identity_fix'] = fix['historical_preparation']
    view['version'] = '1.9.70'
    return view

def _planning1971_live(spec):
    return spec['supabase_deployment_contract']['live_execution']

def _planning1971_synthetic_proof(candidate, deployment_sha, digest, kind='bff_browser', **extra):
    return {'kind': kind, 'candidate_commit': candidate, 'source_deployment_receipt_sha256': deployment_sha, 'receipt_sha256': digest, 'operations': [], 'does_not_imply_operation_acceptance': True, **extra}

class Planning1971DeploymentHistoryTests(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.baseline = json.loads((_PLANNING1971_ROOT / 'docs/current/service_spec.json').read_text(encoding='utf-8'))

    def spec(self):
        return _planning1971_observer_epoch_spec(self.baseline)

    def history_model(self):
        spec = _planning1971_observer_epoch_spec(self.spec())
        spec['version'] = '1.9.71'
        current_live = _planning1971_live(spec)
        installed = deepcopy(current_live['current_deployment'])
        current_live['deployment_history'] = {installed['evidence_id']: installed}
        current_live['current_deployment'] = {'evidence_id': _PLANNING1971_SYNTHETIC_DEPLOYMENT, 'receipt_sha256': _PLANNING1971_SYNTHETIC_DEPLOYMENT_SHA, 'source': {'candidate_commit': _PLANNING1971_SYNTHETIC_COMMIT}}
        return spec

    def runtime_model(self):
        """Keep real baseline records in memory; all added records use synthetic keys and values."""
        spec = self.history_model()
        current_live = _planning1971_live(spec)
        previous = deepcopy(current_live['current_P2_attempt'])
        current_live['P2_attempt_history'][previous['evidence_id']] = previous
        row = {'format': 'jungsi.p2-runtime-attempt/v2', 'status': 'ACTUAL_STEPS_OBSERVED', 'observation_basis': 'RUNTIME_FOLLOWUP', 'evidence_id': _PLANNING1971_SYNTHETIC_ATTEMPT, 'receipt_sha256': _PLANNING1971_SYNTHETIC_ATTEMPT_SHA, 'source_deployment_evidence_id': _PLANNING1971_SYNTHETIC_DEPLOYMENT, 'source_deployment_receipt_sha256': _PLANNING1971_SYNTHETIC_DEPLOYMENT_SHA, 'submit_count': 1, 'retry_count': 0, 'reload_after_submit': False, 'same_form_idempotency_key': None, 'idempotency_context_status': 'PRIVATE_REFERENCE_ONLY', 'DB_writes_independently_observed': None, 'UI_HTTP_status': None, 'UI_safe_error_code': None, 'UI_request_id': None, 'business_native_accepted': 0, 'business_deployment_accepted': 0, 'production_ready': False, 'scope': 'Synthetic unit model of an unconfirmed single submission.', 'preservation_rule': 'Preserve old failures; no service acceptance or actual execution is implied.', 'previous_receipt_evidence_id': previous['evidence_id'], 'steps': {name: {'operation_id': operation, 'status': 'UNCONFIRMED', 'HTTP_status': None, 'safe_error_code': None, 'evidence_id': None} for name, operation in (('profile_create', 'score-profile.create'), ('overall_analyze', 'overall.analyze'), ('report_read', 'report.read'))}, 'scoped_safe_logs': [], 'scoped_readonly_observations': [], 'submitted_at_UTC': '2030-01-01T00:00:00Z', 'result_observed_at_UTC': '2030-01-01T00:00:01Z', 'functional_observations': {name: {'status': 'NOT_RUN' if name == 'report_reload_ui' else 'UNCONFIRMED', 'evidence_id': None} for name in ('save_analysis_ui', 'report_reload_ui')}, 'report_reload_count': 0}
        current_live['current_P2_attempt'] = row
        current_live['evidence'][_PLANNING1971_SYNTHETIC_ATTEMPT] = _planning1971_synthetic_proof(_PLANNING1971_SYNTHETIC_COMMIT, _PLANNING1971_SYNTHETIC_DEPLOYMENT_SHA, _PLANNING1971_SYNTHETIC_ATTEMPT_SHA)
        return spec

    def with_functional_success(self):
        spec = self.runtime_model()
        current_live = _planning1971_live(spec)
        row = current_live['current_P2_attempt']
        for index, name in enumerate(('save_analysis_ui', 'report_reload_ui'), start=1):
            ref = 'SYNTHETIC-UNIT-UI-' + name
            current_live['evidence'][ref] = _planning1971_synthetic_proof(_PLANNING1971_SYNTHETIC_COMMIT, _PLANNING1971_SYNTHETIC_DEPLOYMENT_SHA, str(index) * 64, attempt_evidence_id=_PLANNING1971_SYNTHETIC_ATTEMPT, functional_id=name, observation_scope='SINGLE_OWNER_CASE_UI', exact_request_binding_verified=False)
            row['functional_observations'][name] = {'status': 'OBSERVED_SUCCESS', 'evidence_id': ref}
        row['report_reload_count'] = 1
        row['reload_after_submit'] = True
        return spec

    def synthetic_admin_installation_model(self):
        """Generic in-memory unit fixture; every new receipt is synthetic, never operating evidence."""
        spec = self.history_model()
        current_live = _planning1971_live(spec)
        previous = next(iter(current_live['deployment_history'].values()))
        plan = current_live['backend_safe_observation_plan']
        fix = current_live['admin_session_identity_fix']
        preparation = deepcopy(fix)
        source = {'candidate_commit': _planning1971_checker.ADMIN_FIX_SOURCE_COMMIT, 'accepted_develop_merge': 'd' * 40, 'tree': 'e' * 40, 'spec_version': '1.9.70', 'source_files_count': 64, 'bundle': deepcopy(_planning1971_checker.ADMIN_FIX_BUNDLE), 'source_manifest': {'bytes': 1, 'sha256': '1' * 64, 'source_files_count': 64}, 'deployment_package': {'bytes': 1, 'sha256': '2' * 64}, 'runtime_source_bindings': {**plan['source_bindings'], **fix['source_bindings']}}
        ref = 'SYNTHETIC-UNIT-SOURCE032-RECEIPT'
        deployment = {'format': 'jungsi.current-source-deployment/v1', 'status': 'SOURCE_DEPLOYED_REMOTE_EDITOR_VERIFIED', 'evidence_id': ref, 'source': source, 'receipt_bytes': 17, 'receipt_sha256': '3' * 64, 'previous_deployment_evidence_id': previous['evidence_id'], 'previous_bundle': deepcopy(previous['source']['bundle']), 'remote_readback': deepcopy(_planning1971_checker.ADMIN_FIX_BUNDLE), 'editor_reload_verified': True, 'verify_jwt_remained_true': True, 'same_existing_project_and_function': True, 'auth_or_secret_or_policy_changes': False, 'operation_scope_expanded': False, 'data_or_budget_approval_changed': False, 'production_ready': False, 'business_native_accepted': 0, 'business_deployment_accepted': 0, 'scope': 'synthetic unit scope', 'observed_at_UTC': '2030-01-01T00:00:00Z', 'new_version_health': 'NOT_RUN', 'native_readiness': None, 'safe_observer_acceptance': None, 'current_P2_attempt_evidence_id': None}
        current_live['current_deployment'] = deployment
        current_live['evidence'][ref] = _planning1971_synthetic_proof(_planning1971_checker.ADMIN_FIX_SOURCE_COMMIT, deployment['receipt_sha256'], deployment['receipt_sha256'], kind='edge_deployment', source=deepcopy(source))
        current_live['stages']['edge_deployment']['evidence_ids'].append(ref)
        fix.update(status='SOURCE_DEPLOYED_FUNCTIONAL_FOLLOWUP_PENDING', implementation_candidate_commit=_planning1971_checker.ADMIN_FIX_SOURCE_COMMIT, deployment='SOURCE_DEPLOYED_REMOTE_EDITOR_VERIFIED', actual_deployment_evidence_id=ref, historical_preparation=preparation)
        return spec

    def assert_p2_valid(self, spec):
        current_live = _planning1971_live(spec)
        self.assertEqual(_planning1971_checker.validate_P2_attempt_records(current_live, current_live['evidence']), [])

    def assert_p2_invalid(self, spec):
        current_live = _planning1971_live(spec)
        self.assertTrue(_planning1971_checker.validate_P2_attempt_records(current_live, current_live['evidence']))

    def test_actual_source_ci_counts_remain_source_only_and_runtime_rendering_is_scoped(self):
        baseline = deepcopy(self.baseline)
        self.assertEqual(_planning1971_checker.validate_current_source_verification(baseline), [])
        proof = _planning1971_live(baseline)['current_source_verification']
        self.assertEqual(proof['spec_version'], '1.9.70')
        self.assertEqual(proof['verified_source_test_counts'], {'python': 1065, 'deno': 590, 'oracle': 993, 'oracle_mismatches': 0})
        self.assertEqual(len(proof['ci_runs']), 3)
        self.assertIs(proof['source_only'], True)
        self.assertEqual(proof['business_native_accepted'], 0)
        self.assertEqual(proof['business_deployment_accepted'], 0)
        self.assertIs(proof['production_ready'], False)
        self.assertEqual(_planning1971_live(baseline)['current_P2_attempt']['business_native_accepted'], 0)
        self.assertIs(_planning1971_live(baseline)['current_P2_attempt']['production_ready'], False)
        for mutation in ('deno_float', 'oracle_bool', 'source_only_false', 'CI_head', 'CI_oracle_bool'):
            with self.subTest(mutation=mutation):
                changed = deepcopy(self.baseline)
                changed_proof = _planning1971_live(changed)['current_source_verification']
                if mutation == 'deno_float':
                    changed_proof['verified_source_test_counts']['deno'] = 590.0
                elif mutation == 'oracle_bool':
                    changed_proof['verified_source_test_counts']['oracle_mismatches'] = False
                elif mutation == 'source_only_false':
                    changed_proof['source_only'] = False
                elif mutation == 'CI_head':
                    changed_proof['ci_runs'][0]['headSha'] = '0' * 40
                else:
                    changed_proof['ci_runs'][0]['verified_source_test_counts']['oracle_mismatches'] = False
                self.assertTrue(_planning1971_checker.validate_current_source_verification(changed))
        rendered = _planning1971_checker.live_execution_document(self.baseline)
        self.assertIn('201 / 없음', rendered)
        self.assertIn('전체 누백·조합분포는 미발행 pending', rendered)
        self.assertIn('UNCONFIRMED', rendered)

    def test_actual_baseline_current_is_validated_without_an_epoch_view(self):
        self.assertEqual(_planning1971_checker.validate_live_execution(deepcopy(self.baseline)), [])

    def test_observer_epoch_view_resolves_history_without_mutating_actual_current(self):
        spec = self.runtime_model()
        current_live = _planning1971_live(spec)
        preparation = deepcopy(current_live['admin_session_identity_fix'])
        current_live['admin_session_identity_fix']['historical_preparation'] = preparation
        before = deepcopy(spec)
        epoch = _planning1971_observer_epoch_spec(spec)
        self.assertEqual(spec, before)
        self.assertEqual(_planning1971_live(spec)['current_deployment']['evidence_id'], _PLANNING1971_SYNTHETIC_DEPLOYMENT)
        self.assertEqual(_planning1971_live(spec)['current_P2_attempt']['evidence_id'], _PLANNING1971_SYNTHETIC_ATTEMPT)
        self.assertEqual(epoch['version'], '1.9.70')
        self.assertEqual(_planning1971_live(epoch)['current_deployment']['evidence_id'], 'OPS-SAFE-OBSERVER-DEPLOYED-20261016')
        self.assertEqual(_planning1971_live(epoch)['current_P2_attempt']['evidence_id'], 'OPS-P2-OBSERVER-ATTEMPT-20261016')
        self.assertNotIn('deployment_history', _planning1971_live(epoch))
        self.assertNotIn('OPS-P2-OBSERVER-ATTEMPT-20261016', _planning1971_live(epoch)['P2_attempt_history'])
        self.assertEqual(_planning1971_live(epoch)['admin_session_identity_fix'], preparation)

    def test_minor_zero_bool_and_nonhex_log_hash_regressions(self):
        for group, key, value in ((None, 'actual_HTTP_requests', False), ('synthetic_verification', 'focused_failed', False), ('synthetic_verification', 'focused_log_sha256', 'g' * 64)):
            with self.subTest(group=group, key=key):
                spec = _planning1971_observer_epoch_spec(self.spec())
                target = _planning1971_live(spec)['admin_session_identity_fix']
                if group is not None:
                    target = target[group]
                target[key] = value
                self.assertTrue(_planning1971_checker.validate_admin_session_identity_fix(spec))

    def test_deployment_resolver_selects_unique_current_and_history(self):
        model = {'actual_editor_deployment': {'evidence_id': 'SYNTHETIC-OLD', 'receipt_sha256': '1' * 64}, 'current_deployment': {'evidence_id': 'SYNTHETIC-CURRENT', 'receipt_sha256': '2' * 64}, 'deployment_history': {'SYNTHETIC-HISTORY': {'evidence_id': 'SYNTHETIC-HISTORY', 'receipt_sha256': '3' * 64}}}
        for ref, digest in (('SYNTHETIC-CURRENT', '2' * 64), ('SYNTHETIC-HISTORY', '3' * 64)):
            with self.subTest(ref=ref):
                self.assertEqual(_planning1971_checker.live_deployment(model, evidence_id=ref)['receipt_sha256'], digest)
                self.assertEqual(_planning1971_checker.live_deployment(model, receipt_sha256=digest)['evidence_id'], ref)
                self.assertEqual(_planning1971_checker.live_deployment(model, evidence_id=ref, receipt_sha256=digest)['evidence_id'], ref)

    def test_deployment_resolver_rejects_missing_crossed_or_wrong_type_selectors(self):
        model = {'current_deployment': {'evidence_id': 'SYNTHETIC-CURRENT', 'receipt_sha256': '2' * 64}, 'deployment_history': {}}
        for kwargs in ({}, {'evidence_id': 'missing'}, {'receipt_sha256': '0' * 64}, {'evidence_id': 'SYNTHETIC-CURRENT', 'receipt_sha256': '0' * 64}, {'evidence_id': []}, {'receipt_sha256': False}):
            with self.subTest(kwargs=kwargs):
                self.assertEqual(_planning1971_checker.live_deployment(model, **kwargs), {})

    def test_deployment_resolver_rejects_duplicate_id_or_receipt(self):
        for field in ('evidence_id', 'receipt_sha256'):
            model = {'current_deployment': {'evidence_id': 'SYNTHETIC-CURRENT', 'receipt_sha256': '2' * 64}, 'deployment_history': {'SYNTHETIC-HISTORY': {'evidence_id': 'SYNTHETIC-HISTORY', 'receipt_sha256': '3' * 64}}}
            model['deployment_history']['SYNTHETIC-HISTORY'][field] = model['current_deployment'][field]
            self.assertEqual(_planning1971_checker.live_deployment(model, **{field: model['current_deployment'][field]}), {})

    def test_history_is_optional_only_for_baseline_and_required_for_1971(self):
        spec = _planning1971_observer_epoch_spec(self.spec())
        _planning1971_live(spec).pop('deployment_history', None)
        self.assertEqual(_planning1971_checker.validate_deployment_history(spec), [])
        spec['version'] = '1.9.71'
        self.assertTrue(_planning1971_checker.validate_deployment_history(spec))
        self.assertEqual(_planning1971_checker.validate_deployment_history(self.history_model()), [])

    def test_history_rejects_malformed_missing_duplicate_and_changed_old_installation(self):
        for change in ('type', 'empty', 'value', 'wrong_key', 'duplicate_id', 'duplicate_sha', 'old_hash'):
            with self.subTest(change=change):
                spec = self.history_model()
                current_live = _planning1971_live(spec)
                history = current_live['deployment_history']
                old_ref = next(iter(history))
                if change == 'type':
                    current_live['deployment_history'] = []
                elif change == 'empty':
                    current_live['deployment_history'] = {}
                elif change == 'value':
                    history[old_ref] = None
                elif change == 'wrong_key':
                    history['SYNTHETIC-WRONG-HISTORY-KEY'] = history.pop(old_ref)
                elif change == 'duplicate_id':
                    current_live['current_deployment']['evidence_id'] = old_ref
                elif change == 'duplicate_sha':
                    current_live['current_deployment']['receipt_sha256'] = history[old_ref]['receipt_sha256']
                else:
                    history[old_ref]['source']['bundle']['bytes'] += 1
                self.assertTrue(_planning1971_checker.validate_deployment_history(spec))

    def test_history_accepts_new_current_and_preserved_v1_failure_in_history(self):
        self.assertEqual(_planning1971_checker.validate_deployment_history(self.runtime_model()), [])

    def test_history_rejects_rewriting_the_preserved_v1_failure(self):
        spec = self.history_model()
        _planning1971_live(spec)['current_P2_attempt']['UI_HTTP_status'] = 503
        self.assertTrue(_planning1971_checker.validate_deployment_history(spec))

    def test_actual_admin_fix_requires_native_outer_zero_counters(self):
        spec = self.synthetic_admin_installation_model()
        self.assertEqual(_planning1971_checker.validate_admin_session_identity_fix(spec), [])
        for field in ('actual_HTTP_requests', 'business_native_accepted'):
            with self.subTest(field=field):
                changed = deepcopy(spec)
                _planning1971_live(changed)['admin_session_identity_fix'][field] = False
                self.assertTrue(_planning1971_checker.validate_admin_session_identity_fix(changed))

    def test_admin_installation_rejects_bad_reference_and_non_native_nested_counts(self):
        spec = self.synthetic_admin_installation_model()
        self.assertEqual(_planning1971_checker.validate_admin_fix_deployment(spec), [])
        for change in ('readiness_bad_id', 'observer_bad_id', 'registry_source_float', 'previous_bundle_float', 'current_extra', 'source_extra'):
            with self.subTest(change=change):
                changed = deepcopy(spec)
                current_live = _planning1971_live(changed)
                deployment = current_live['current_deployment']
                if change == 'readiness_bad_id':
                    deployment['new_version_health'] = 'OBSERVED_PARTIAL'
                    deployment['native_readiness'] = {'evidence_id': []}
                elif change == 'observer_bad_id':
                    deployment['safe_observer_acceptance'] = {'evidence_id': []}
                elif change == 'registry_source_float':
                    current_live['evidence'][deployment['evidence_id']]['source']['source_files_count'] = 64.0
                elif change == 'previous_bundle_float':
                    deployment['previous_bundle']['bytes'] = float(deployment['previous_bundle']['bytes'])
                elif change == 'current_extra':
                    deployment['raw_request_id'] = 'synthetic-unit-value'
                else:
                    deployment['source']['scores'] = 'synthetic-unit-value'
                result = _planning1971_checker.validate_admin_fix_deployment(changed)
                self.assertIsInstance(result, list)
                self.assertTrue(result)

    def test_preserved_editor_and_first_two_failures_reject_one_cell_metadata_changes(self):
        baseline = deepcopy(self.baseline)
        self.assertEqual(_planning1971_checker.validate_deployment_history(baseline), [])
        self.assert_p2_valid(baseline)
        cases = (('editor', 'scope', 'synthetic historical scope mutation'), ('editor', 'observed_at_UTC', '2030-01-01T00:00:00Z'), ('root', 'scope', 'synthetic historical scope mutation'), ('root', 'submitted_at_UTC', '2030-01-01T00:00:00Z'), ('frontend', 'scope', 'synthetic historical scope mutation'), ('frontend', 'submitted_at_UTC', '2030-01-01T00:00:00Z'))
        for target, field, value in cases:
            with self.subTest(target=target, field=field):
                changed = deepcopy(self.baseline)
                current_live = _planning1971_live(changed)
                if target == 'editor':
                    record = current_live['actual_editor_deployment']
                else:
                    reply = current_live['frontend_P2_reply']
                    ref = reply['earlier_root_attempt']['evidence_id'] if target == 'root' else reply['current_P2_attempt_evidence_id']
                    record = _planning1971_checker.live_P2_attempt(current_live, ref)
                record[field] = value
                self.assertTrue(_planning1971_checker.validate_deployment_history(changed))
                if target != 'editor':
                    self.assert_p2_invalid(changed)
                self.assertEqual(current_live['current_P2_attempt']['business_native_accepted'], 0)
                self.assertIs(current_live['current_P2_attempt']['production_ready'], False)

    def test_admin_installation_requires_scopes_and_exact_metadata_shapes(self):
        model = self.synthetic_admin_installation_model()
        self.assertEqual(_planning1971_checker.validate_admin_fix_deployment(model), [])
        source = _planning1971_live(model)['current_deployment']['source']
        self.assertEqual(set(source['source_manifest']), {'bytes', 'sha256', 'source_files_count'})
        self.assertEqual(set(source['deployment_package']), {'bytes', 'sha256'})
        for name in ('source_manifest', 'deployment_package'):
            for mutation in ('extra', 'bytes_float'):
                with self.subTest(metadata=name, mutation=mutation):
                    changed = deepcopy(model)
                    meta = _planning1971_live(changed)['current_deployment']['source'][name]
                    if mutation == 'extra':
                        meta['scores'] = 'synthetic-unit-value'
                    else:
                        meta['bytes'] = float(meta['bytes'])
                    self.assertTrue(_planning1971_checker.validate_admin_fix_deployment(changed))
        actual = deepcopy(self.baseline)
        self.assertEqual(_planning1971_checker.validate_admin_fix_deployment(actual), [])
        for component in ('current_deployment', 'native_readiness', 'safe_observer_acceptance'):
            for mutation in ('absent', 'null', 'empty', 'number', 'extra'):
                with self.subTest(component=component, mutation=mutation):
                    changed = deepcopy(actual)
                    deployment = _planning1971_live(changed)['current_deployment']
                    record = deployment if component == 'current_deployment' else deployment[component]
                    self.assertIsInstance(record, dict)
                    if mutation == 'absent':
                        record.pop('scope', None)
                    elif mutation == 'null':
                        record['scope'] = None
                    elif mutation == 'empty':
                        record['scope'] = ''
                    elif mutation == 'number':
                        record['scope'] = 3
                    else:
                        record['synthetic_extra'] = 'synthetic-unit-value'
                    result = _planning1971_checker.validate_admin_fix_deployment(changed)
                    self.assertIsInstance(result, list)
                    self.assertTrue(result)

    def test_generic_admin_installation_model_is_not_service_acceptance(self):
        spec = self.synthetic_admin_installation_model()
        self.assertEqual(_planning1971_checker.validate_admin_fix_deployment(spec), [])
        self.assertEqual(_planning1971_live(spec)['current_deployment']['business_native_accepted'], 0)
        self.assertFalse(_planning1971_live(spec)['current_deployment']['production_ready'])

    def test_source032_requires_new_receipt_instead_of_missing_or_copied_evidence(self):
        for change in ('missing_entry', 'missing_sha', 'numeric_sha', 'copied_readiness'):
            with self.subTest(change=change):
                spec = self.synthetic_admin_installation_model()
                current_live = _planning1971_live(spec)
                deployment = current_live['current_deployment']
                if change == 'missing_entry':
                    current_live['evidence'].pop(deployment['evidence_id'])
                elif change == 'missing_sha':
                    deployment.pop('receipt_sha256')
                elif change == 'numeric_sha':
                    deployment['receipt_sha256'] = int('1' * 64)
                else:
                    previous = next(iter(current_live['deployment_history'].values()))
                    deployment['native_readiness'] = deepcopy(previous['native_readiness'])
                    deployment['new_version_health'] = previous['new_version_health']
                self.assertTrue(_planning1971_checker.validate_admin_fix_deployment(spec))

    def test_v1_baseline_remains_valid_and_immutable_after_v2_is_added(self):
        self.assert_p2_valid(_planning1971_observer_epoch_spec(self.spec()))
        spec = self.runtime_model()
        self.assert_p2_valid(spec)
        previous_id = _planning1971_live(spec)['current_P2_attempt']['previous_receipt_evidence_id']
        _planning1971_live(spec)['P2_attempt_history'][previous_id]['UI_HTTP_status'] = 503
        self.assert_p2_invalid(spec)

    def test_v2_unconfirmed_ui_does_not_invent_http_or_functional_success(self):
        spec = self.runtime_model()
        self.assert_p2_valid(spec)
        for key in ('UI_HTTP_status', 'UI_safe_error_code', 'UI_request_id'):
            changed = deepcopy(spec)
            _planning1971_live(changed)['current_P2_attempt'][key] = 503 if key == 'UI_HTTP_status' else 'synthetic'
            self.assert_p2_invalid(changed)

    def test_v2_functional_success_and_reload_leave_all_steps_unconfirmed(self):
        spec = self.with_functional_success()
        self.assert_p2_valid(spec)
        row = _planning1971_live(spec)['current_P2_attempt']
        self.assertTrue(all((step['status'] == 'UNCONFIRMED' for step in row['steps'].values())))
        self.assertEqual(row['business_native_accepted'], 0)
        self.assertEqual(row['business_deployment_accepted'], 0)
        self.assertIs(row['production_ready'], False)

    def test_v2_functional_proof_cannot_cross_attempt_or_functional_scope(self):
        for field, value in (('attempt_evidence_id', 'unrelated'), ('functional_id', 'report_reload_ui'), ('observation_scope', 'EXACT_ATTEMPT_OPERATION_RESPONSE'), ('candidate_commit', '0' * 40), ('source_deployment_receipt_sha256', '0' * 64), ('kind', 'sql')):
            with self.subTest(field=field):
                spec = self.with_functional_success()
                current_live = _planning1971_live(spec)
                ref = current_live['current_P2_attempt']['functional_observations']['save_analysis_ui']['evidence_id']
                current_live['evidence'][ref][field] = value
                self.assert_p2_invalid(spec)

    def test_v2_functional_proof_rejects_extra_private_fields(self):
        for field in ('raw_request_id', 'account', 'scores'):
            with self.subTest(field=field):
                spec = self.with_functional_success()
                current_live = _planning1971_live(spec)
                ref = current_live['current_P2_attempt']['functional_observations']['save_analysis_ui']['evidence_id']
                current_live['evidence'][ref][field] = 'synthetic-unit-value'
                self.assert_p2_invalid(spec)

    def test_v2_reload_requires_native_count_and_matching_boolean(self):
        for count, reloaded in ((True, True), (1.0, True), (2, True), (1, False), (0, True)):
            with self.subTest(count=count, reloaded=reloaded):
                spec = self.with_functional_success()
                _planning1971_live(spec)['current_P2_attempt'].update(report_reload_count=count, reload_after_submit=reloaded)
                self.assert_p2_invalid(spec)

    def test_v2_ui_positive_cannot_be_reused_as_exact_operation_response(self):
        spec = self.with_functional_success()
        row = _planning1971_live(spec)['current_P2_attempt']
        row['steps']['profile_create'].update(status='OBSERVED_SUCCESS', HTTP_status=201, safe_error_code=None, evidence_id=row['functional_observations']['save_analysis_ui']['evidence_id'])
        self.assert_p2_invalid(spec)

    def test_v2_exact_operation_proof_can_succeed_without_global_acceptance(self):
        spec = self.with_functional_success()
        current_live = _planning1971_live(spec)
        ref = 'SYNTHETIC-UNIT-EXACT-PROFILE'
        current_live['evidence'][ref] = _planning1971_synthetic_proof(_PLANNING1971_SYNTHETIC_COMMIT, _PLANNING1971_SYNTHETIC_DEPLOYMENT_SHA, '4' * 64, kind='native_api', attempt_evidence_id=_PLANNING1971_SYNTHETIC_ATTEMPT, operation_id='score-profile.create', observation_scope='EXACT_ATTEMPT_OPERATION_RESPONSE', exact_request_binding_verified=True)
        current_live['current_P2_attempt']['steps']['profile_create'].update(status='OBSERVED_SUCCESS', HTTP_status=201, safe_error_code=None, evidence_id=ref)
        self.assert_p2_valid(spec)
        for field, value in (('operation_id', 'overall.analyze'), ('exact_request_binding_verified', False)):
            changed = deepcopy(spec)
            _planning1971_live(changed)['evidence'][ref][field] = value
            self.assert_p2_invalid(changed)

    def test_v2_complete_log_is_time_only_without_ui_or_exact_response_promotion(self):
        spec = self.runtime_model()
        current_live = _planning1971_live(spec)
        row = current_live['current_P2_attempt']
        ref = 'SYNTHETIC-UNIT-COMPLETE-LOG'
        current_live['evidence'][ref] = _planning1971_synthetic_proof(_PLANNING1971_SYNTHETIC_COMMIT, _PLANNING1971_SYNTHETIC_DEPLOYMENT_SHA, '7' * 64, kind='native_api')
        row['scoped_safe_logs'].append({'evidence_id': ref, 'operation_id': 'overall.analyze', 'stage': 'complete', 'HTTP_status': 201, 'safe_error_code': None, 'observed_at_UTC': '2030-01-01T00:00:03Z', 'correlation_scope': 'TIME_AND_OPERATION_ONLY', 'actor_binding_proven': False, 'BFF_request_id_binding_proven': False, 'UI_status_binding_proven': False})
        self.assert_p2_valid(spec)
        self.assertIsNone(row['UI_HTTP_status'])
        self.assertTrue(all((step['status'] == 'UNCONFIRMED' for step in row['steps'].values())))
        self.assertEqual(row['business_native_accepted'], 0)
        self.assertIs(row['production_ready'], False)
        for field, value in (('stage', 'budget_plan'), ('HTTP_status', True), ('safe_error_code', 'invalid_request'), ('actor_binding_proven', True)):
            with self.subTest(field=field):
                changed = deepcopy(spec)
                _planning1971_live(changed)['current_P2_attempt']['scoped_safe_logs'][0][field] = value
                self.assert_p2_invalid(changed)
        changed = deepcopy(spec)
        _planning1971_live(changed)['current_P2_attempt']['UI_HTTP_status'] = 201
        self.assert_p2_invalid(changed)
        changed = deepcopy(spec)
        _planning1971_live(changed)['current_P2_attempt']['steps']['overall_analyze'].update(status='OBSERVED_SUCCESS', HTTP_status=201, safe_error_code=None, evidence_id=ref)
        self.assert_p2_invalid(changed)

    def test_v2_four_point_display_is_metadata_only_with_distribution_pending(self):
        spec = self.with_functional_success()
        current_live = _planning1971_live(spec)
        row = current_live['current_P2_attempt']
        ref = 'SYNTHETIC-UNIT-FOUR-POINT-DISPLAY'
        current_live['evidence'][ref] = _planning1971_synthetic_proof(_PLANNING1971_SYNTHETIC_COMMIT, _PLANNING1971_SYNTHETIC_DEPLOYMENT_SHA, '8' * 64, kind='bff_browser', attempt_evidence_id=_PLANNING1971_SYNTHETIC_ATTEMPT, observation_scope='APPROVED_FOUR_POINT_SUBJECT_DISPLAY_ONLY', exact_request_binding_verified=False)
        row.update(analysis_result_scope='SAVED_PROFILE_AND_SUBJECT_RESULTS_WITH_OVERALL_DISTRIBUTION_PENDING', overall_percentile_computed=False, combination_percentiles_computed=False, subject_display_verification={'evidence_id': ref, 'receipt_bytes': 31, 'receipt_sha256': '8' * 64, 'confirmed_point_count': 4, 'actual_values_published': False, 'whole_or_combination_percentile_accepted': False, 'JWT_subject_or_BFF_authority_independently_proven': False})
        self.assert_p2_valid(spec)
        self.assertTrue(all((step['status'] == 'UNCONFIRMED' for step in row['steps'].values())))
        self.assertEqual(row['business_native_accepted'], 0)
        self.assertIs(row['production_ready'], False)
        cases = (('subject', 'confirmed_point_count', True), ('subject', 'confirmed_point_count', 4.0), ('subject', 'actual_values_published', True), ('subject', 'whole_or_combination_percentile_accepted', True), ('subject', 'JWT_subject_or_BFF_authority_independently_proven', True), ('row', 'overall_percentile_computed', True), ('row', 'combination_percentiles_computed', True), ('proof', 'attempt_evidence_id', 'unrelated'), ('proof', 'exact_request_binding_verified', True))
        for target, field, value in cases:
            with self.subTest(target=target, field=field, value=value):
                changed = deepcopy(spec)
                changed_live = _planning1971_live(changed)
                changed_row = changed_live['current_P2_attempt']
                selected = changed_row['subject_display_verification'] if target == 'subject' else changed_row if target == 'row' else changed_live['evidence'][ref]
                selected[field] = value
                self.assert_p2_invalid(changed)

    def test_v2_positive_owner_aggregate_remains_snapshot_only(self):
        spec = self.with_functional_success()
        current_live = _planning1971_live(spec)
        ref = 'SYNTHETIC-UNIT-OWNER-SNAPSHOT'
        current_live['evidence'][ref] = _planning1971_synthetic_proof(_PLANNING1971_SYNTHETIC_COMMIT, _PLANNING1971_SYNTHETIC_DEPLOYMENT_SHA, '5' * 64, kind='sql')
        snapshot = {'evidence_id': ref, 'receipt_sha256': '5' * 64, 'receipt_bytes': 11, 'observed_at_UTC': '2030-01-01T00:00:02Z', 'owner_exact_match_count': 1, 'counts': {'profiles': 1, 'profile_success_requests': 1, 'overall_success_requests': 1, 'reports': 1}, 'scope': 'OWNER_CASE_SNAPSHOT_ONLY', 'all_database_writes_zero_proven': False, 'browser_Bearer_subject_binding_proven': False}
        current_live['current_P2_attempt']['scoped_readonly_observations'].append(snapshot)
        self.assert_p2_valid(spec)
        for field in ('all_database_writes_zero_proven', 'browser_Bearer_subject_binding_proven'):
            changed = deepcopy(spec)
            _planning1971_live(changed)['current_P2_attempt']['scoped_readonly_observations'][0][field] = True
            self.assert_p2_invalid(changed)

    def test_v2_cannot_promote_native_or_add_write_retry(self):
        for field, value in (('retry_count', 1), ('business_native_accepted', False), ('business_deployment_accepted', 1), ('production_ready', True)):
            with self.subTest(field=field):
                spec = self.with_functional_success()
                _planning1971_live(spec)['current_P2_attempt'][field] = value
                self.assert_p2_invalid(spec)

class FrontendFollowup1972Tests(unittest.TestCase):
    """현재 화면 메타데이터의 범위와 이전 API·P2 원장 보존만 검사한다."""
    @classmethod
    def setUpClass(cls):
        import check_project_consistency
        cls.checker=check_project_consistency
        cls.baseline=json.loads((ROOT/'docs/current/service_spec.json').read_text(encoding='utf-8'))

    def fixture(self):
        return deepcopy(self.baseline)

    def model(self,spec):
        return spec['supabase_deployment_contract']['live_execution']['current_BFF_deployment']

    def invalid(self,spec):
        self.assertTrue(self.checker.validate_frontend_bff_followup(spec))

    def test_current_metadata_and_limited_evidence_are_valid(self):
        self.assertEqual([],self.checker.validate_frontend_bff_followup(self.baseline))

    def test_current_metadata_is_required(self):
        spec=self.fixture();del spec['supabase_deployment_contract']['live_execution']['current_BFF_deployment'];self.invalid(spec)

    def test_nested_extra_private_payload_keys_are_rejected(self):
        paths=[(),('owner_report',),('owner_report','receipt'),('git_source_verification',),('git_source_verification','CI'),('git_source_verification','lineage'),('git_source_verification','required_develop_sync'),('search_failure_correlations',),('search_failure_correlations','rows',0),('root_readonly_UI_observation',),('followup_contract',)]
        for path in paths:
            with self.subTest(path=path):
                spec=self.fixture();row=self.model(spec)
                for key in path:row=row[key]
                row['private_payload']='SYNTHETIC-UNIT-EXTRA';self.invalid(spec)

    def test_required_scope_is_nonempty_text(self):
        for key in ('owner_report','git_source_verification','search_failure_correlations','root_readonly_UI_observation','followup_contract'):
            for value in (None,'',False,1,[]):
                with self.subTest(key=key,value=value):
                    spec=self.fixture();self.model(spec)[key]['scope']=value;self.invalid(spec)
            spec=self.fixture();del self.model(spec)[key]['scope'];self.invalid(spec)

    def test_boolean_counts_and_text_ids_are_rejected(self):
        paths=[('owner_report','reported_POST_count'),('owner_report','receipt','bytes'),('git_source_verification','CI','run_id'),('git_source_verification','CI','job_id'),('git_source_verification','changed_files','tests'),('search_failure_correlations','matched_count'),('search_failure_correlations','rows',0,'HTTP_status'),('root_readonly_UI_observation','GET_count'),('business_native_accepted',)]
        for path in paths:
            for value in (False,True,'2',2.0):
                with self.subTest(path=path,value=value):
                    spec=self.fixture();row=self.model(spec)
                    for key in path[:-1]:row=row[key]
                    row[path[-1]]=value;self.invalid(spec)

    def test_receipt_hash_and_source_bindings_are_exact(self):
        for key in ('owner_report','search_failure_correlations','root_readonly_UI_observation'):
            for value in (False,'g'*64,'a'*64):
                spec=self.fixture();self.model(spec)[key]['receipt']['sha256']=value;self.invalid(spec)
        for key in ('owner_report','git_source_verification'):
            spec=self.fixture();self.model(spec)[key]['source_commit']='a'*40;self.invalid(spec)
        spec=self.fixture();self.model(spec)['git_source_verification']['CI']['head_commit']='a'*40;self.invalid(spec)

    def test_git_and_ci_cannot_certify_worker_bytes(self):
        spec=self.fixture();self.model(spec)['git_source_verification']['worker_bytes_independently_verified']=True;self.invalid(spec)
        spec=self.fixture();self.model(spec)['owner_report']['deployment_source_mapping']='INDEPENDENTLY_VERIFIED';self.invalid(spec)
        spec=self.fixture();self.model(spec)['git_source_verification']['CI']['scope']='OPERATING_ACCEPTANCE';self.invalid(spec)

    def test_older_frontend_planning_requires_develop_sync(self):
        mutations=[(('frontend_source_spec_version',),'1.9.72'),(('planning_sync_pending',),False),(('required_develop_sync','integration_status'),'PASS'),(('lineage','current_planning_synchronized_into_frontend'),True),(('lineage','planning_is_frontend_ancestor'),True),(('lineage','frontend_is_planning_ancestor'),True),(('lineage','merge_base'),'a'*40)]
        for path,value in mutations:
            spec=self.fixture();row=self.model(spec)['git_source_verification']
            for key in path[:-1]:row=row[key]
            row[path[-1]]=value;self.invalid(spec)

    def test_exact_two_failed_responses_cannot_promote_auth_or_p2(self):
        for key in ('raw_request_ids_published','JWT_subject_binding_proven','actor_binding_proven','P2_operation_exact_proven','native_acceptance_implied'):
            spec=self.fixture();self.model(spec)['search_failure_correlations'][key]=True;self.invalid(spec)
        for path,value in [(('matched_count',),1),(('rows',0,'operation'),'overall.analyze'),(('rows',1,'HTTP_status'),200),(('rows',1,'stage'),'complete')]:
            spec=self.fixture();row=self.model(spec)['search_failure_correlations']
            for key in path[:-1]:row=row[key]
            row[path[-1]]=value;self.invalid(spec)

    def test_root_readonly_gets_are_separate_from_correlated_responses(self):
        for key in ('request_ids_captured','same_requests_as_correlated_receipt_proven','JWT_subject_binding_proven','actor_binding_proven','P2_operation_exact_proven'):
            spec=self.fixture();self.model(spec)['root_readonly_UI_observation'][key]=True;self.invalid(spec)
        spec=self.fixture();self.model(spec)['root_readonly_UI_observation']['POST_count']=1;self.invalid(spec)

    def test_prepared_followup_is_not_deployed_or_verified(self):
        for key,value in [('status','DEPLOYED'),('verification','PASS'),('deployment','PASS'),('published_candidate_commit','a'*40)]:
            spec=self.fixture();self.model(spec)['followup_contract'][key]=value;self.invalid(spec)
        spec=self.fixture();self.model(spec)['followup_contract']['planned_runtime_guards'].remove('CONSTANT_ROUTE_TEMPLATE_INCLUDING_GENERIC_ERROR');self.invalid(spec)

    def test_native_security_and_permission_boundaries_stay_closed(self):
        for key,value in [('business_native_accepted',1),('business_deployment_accepted',1),('production_ready',True),('operation_scope_expanded',True),('purpose_or_budget_changed',True),('key_or_role_changed',True)]:
            spec=self.fixture();self.model(spec)[key]=value;self.invalid(spec)

    def test_installed_api_and_successful_p2_remain_canonical(self):
        for key in ('current_deployment','current_P2_attempt'):
            spec=self.fixture();spec['supabase_deployment_contract']['live_execution'][key]['scope']='SYNTHETIC-UNIT-CHANGED';self.invalid(spec)

    def test_renderer_separates_current_frontend_and_historical_reply(self):
        rendered=self.checker.live_execution_document(self.baseline)
        for expected in ('현재 화면 BFF 배포 보고','이전 화면팀 P2 저장 검수 회신 이력','1.9.62','최신 develop 1.9.72 통합 대기','검색 실패 응답 2건만의 정확 대조','PREPARED_NOT_DEPLOYED','0/22 / 0/22'):
            self.assertIn(expected,rendered)
        self.assertNotIn('SYNTHETIC-UNIT-EXTRA',rendered)

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


class ServicePerformanceBoundaryTests(unittest.TestCase):
    def source(self):
        return json.loads((ROOT/'docs/current/service_spec.json').read_bytes())

    def test_cache_cannot_adopt_authorization_or_remove_logical_charges(self):
        from check_project_consistency import validate_service_performance
        spec=self.source();self.assertEqual(validate_service_performance(spec),[])
        for field,value in [('logical_charge_on_hit',False),('max_entries',17),('fresh_checks',[])]:
            changed=deepcopy(spec);changed['service_performance_contract']['cache'][field]=value
            self.assertTrue(validate_service_performance(changed))

    def test_performance_tests_are_additive_to_req27_source_baseline(self):
        from check_project_consistency import validate_service_performance
        spec=self.source();spec['service_performance_contract']['verification']['baseline_edge_tests']=0
        self.assertTrue(validate_service_performance(spec))
        spec=self.source();spec['edge_harness']['unit_count']=624
        self.assertTrue(validate_service_performance(spec))

    def test_batch_proposal_and_cache_cannot_activate_operations_or_deployment(self):
        from check_project_consistency import validate_service_performance
        for section,field,value in [('batch_cr','status','IMPLEMENTED'),('activation','deploy','PASS'),('activation','006_sql_changed',True)]:
            spec=self.source();spec['service_performance_contract'][section][field]=value
            self.assertTrue(validate_service_performance(spec))


class CatalogPayloadBoundaryTests(unittest.TestCase):
    def source(self):
        return json.loads((ROOT/'docs/current/service_spec.json').read_bytes())

    def test_catalog_projection_cannot_skip_reference_auth_or_whole_readiness(self):
        from check_project_consistency import validate_catalog_payload_scope
        spec=self.source();self.assertEqual(validate_catalog_payload_scope(spec),[])
        for field,value in [('operations',['history.search','university.analyze']),('all_selected_reference_metadata',False),('health_ready','catalog_only'),('current_checks',[])]:
            changed=deepcopy(spec);changed['catalog_payload_scope_contract'][field]=value
            self.assertTrue(validate_catalog_payload_scope(changed))

    def test_catalog_projection_requires_separate_parent_and_additive_test_evidence(self):
        from check_project_consistency import validate_catalog_payload_scope
        spec=self.source();spec['catalog_payload_scope_contract']['verification']['added_edge_tests']=0
        self.assertTrue(validate_catalog_payload_scope(spec))
        spec=self.source();spec['service_performance_contract']['parent_cache_candidate']['preserved']=False
        self.assertTrue(validate_catalog_payload_scope(spec))


# Additional strict member-JSON registration cases; existing planning tests retain their scope.
import copy
import check_project_consistency as checker
import run_edge_tests as runner

class MemberShortlistRegistrationCases(unittest.TestCase):
    def legacy28(self,current):
        registration,errors=checker.member_shortlist_registration(current)
        self.assertEqual([],errors)
        spec=copy.deepcopy(current)
        # This synthetic legacy view has no member receipt. Do not attach a
        # current-source sibling whose canonical member receipt it cannot prove.
        spec.pop(checker.CURRENT_SOURCE_REBOUND_FIELD,None)
        spec.pop(checker.MEMBER_SCHOOL_OVERLAY_FIELD,None)
        spec.pop(checker.SAVED_REPORT_OVERLAY_FIELD,None)
        if registration is not None:
            spec['operations']=[r for r in spec['operations']if r['id']not in checker.MEMBER_SHORTLIST_ROUTES]
            for path in checker.MEMBER_SHORTLIST_TESTS:spec['edge_harness']['files'].pop(path,None)
            index=spec['workflow']['documentation_sync']['code_index']['edge_sources']
            index['files']=[r for r in index['files']if r['path']not in checker.MEMBER_SHORTLIST_TESTS]
        spec.pop('member_shortlist_contract',None)
        return spec
    def fixture(self):
        spec=json.loads((Path(__file__).resolve().parents[1]/'docs/current/service_spec.json').read_bytes())
        # Validate the actual current receipt before constructing an independent
        # synthetic historical registration with synthetic source hashes.
        self.assertEqual([],checker.member_shortlist_registration(spec)[1])
        spec.pop(checker.CURRENT_SOURCE_REBOUND_FIELD,None)
        spec.pop(checker.MEMBER_SCHOOL_OVERLAY_FIELD,None)
        spec.pop(checker.SAVED_REPORT_OVERLAY_FIELD,None)
        spec.pop('member_shortlist_contract',None)
        spec['operations']=[r for r in spec['operations']if r['id']not in checker.MEMBER_SHORTLIST_ROUTES]
        base=copy.deepcopy(spec['operations'][0])
        for oid,(method,path)in checker.MEMBER_SHORTLIST_ROUTES.items():
            row={**base,'id':oid,'method':method,'path':path,'member_tiers':['paid'],'report_owner':False,'confirmed_score_profile':False,'requirements':['REQ-11','REQ-24','REQ-25','REQ-26']}
            row['http_contract']={**row.get('http_contract',{}),'idempotency_key_required':method=='PUT','response_schema':'member_shortlist'}
            row['contract_ref']='backend_platform_contract.dto_schemas.member_shortlist'
            spec['operations'].append(row)
        impl='supabase/functions/_shared/jungsi/application/member_shortlist.ts'
        required=checker.MEMBER_SHORTLIST_CRITICAL_SOURCES|set(checker.MEMBER_SHORTLIST_TESTS)|{impl}
        hashes={p:'1'*64 for p in required}
        for p,sha in hashes.items():spec['edge_harness']['files'][p]={'declarations':{'source_sha256':sha},'layer':'verification'if p in checker.MEMBER_SHORTLIST_TESTS else 'application'}
        for row in spec['workflow']['documentation_sync']['code_index']['edge_sources']['files']:
            if row['path']in hashes:row['source_sha256']=hashes[row['path']]
        bindings={oid:dict(path=impl,source_sha256=hashes[impl],symbol='MemberShortlistService.execute')for oid in checker.MEMBER_SHORTLIST_ROUTES}
        reg=dict(format='jungsi.member-shortlist-source-registration/v1',status='SOURCE_REGISTERED_NOT_ACTIVATED',operation_ids=list(checker.MEMBER_SHORTLIST_ROUTES),baseline_operation_count=28,source_operation_count=30,activation_status='NOT_RUN',native_acceptance='NOT_VERIFIED_BY_SOURCE_SUITE',operating_writes=0,new_DB_result_tables=0,implementation_bindings=bindings,verification=dict(coverage='MEMBER_JSON_SHORTLIST_SYNTHETIC',test_paths=list(checker.MEMBER_SHORTLIST_TESTS),test_count=4,baseline_foundation_count=656,source_bindings=[dict(path=p,sha256=sha)for p,sha in sorted(hashes.items())]))
        spec['member_shortlist_contract']={'source_registration':reg}
        return spec,hashes
    def test_current_receipt_forgery_is_rejected_before_synthetic_projection(self):
        spec=json.loads((Path(__file__).resolve().parents[1]/'docs/current/service_spec.json').read_bytes())
        if checker.CURRENT_SOURCE_REBOUND_FIELD not in spec:
            self.skipTest('current source rebound is absent from this snapshot')
        self.assertEqual([],checker.member_shortlist_registration(spec)[1])
        spec['member_shortlist_contract']['source_registration']['verification']['test_count']+=1
        self.assertTrue(checker.member_shortlist_registration(spec)[1])
    def test_current_member_school_overlay_forgery_is_rejected(self):
        spec=json.loads((Path(__file__).resolve().parents[1]/'docs/current/service_spec.json').read_bytes())
        self.assertEqual([],checker.member_shortlist_registration(spec)[1])
        overlay=spec[checker.MEMBER_SCHOOL_OVERLAY_FIELD]
        overlay['operating_writes']=1
        self.assertTrue(checker.member_shortlist_registration(spec)[1])
    def test_default28_has_no_implicit_registration(self):
        spec=json.loads((Path(__file__).resolve().parents[1]/'docs/current/service_spec.json').read_bytes())
        spec=self.legacy28(spec)
        self.assertEqual((None,[]),checker.member_shortlist_registration(spec))
        self.assertIsNone(runner.member_shortlist_suite_registration(spec,{}))
        self.assertEqual(28,len(spec['operations']))
    def test_legacy_fixture_keeps_actual_registered30_and_its_evidence_unchanged(self):
        current,_=self.fixture();before=copy.deepcopy(current)
        legacy=self.legacy28(current)
        self.assertEqual(before,current)
        self.assertEqual(30,len(current['operations']))
        self.assertEqual(28,len(legacy['operations']))
        self.assertEqual((None,[]),checker.member_shortlist_registration(legacy))
        self.assertEqual(656,legacy['edge_harness']['unit_count'])
    def test_exact_member2_registration_preserves_foundation656(self):
        spec,before=self.fixture()
        registration,errors=checker.member_shortlist_registration(spec,before)
        self.assertEqual([],errors)
        self.assertEqual(2,len(checker.registered_member_shortlist_ids(spec)))
        self.assertEqual(656,spec['edge_harness']['unit_count'])
        self.assertEqual(4,registration['verification']['test_count'])
        self.assertIs(registration,runner.member_shortlist_suite_registration(spec,before))
    def test_registration_required_for_new_route_or_test(self):
        spec,_=self.fixture();spec['member_shortlist_contract'].pop('source_registration')
        self.assertTrue(checker.member_shortlist_registration(spec)[1])
        with self.assertRaises(runner.EdgeFailure):runner.member_shortlist_suite_registration(spec,{})
    def test_wrong_method_path_tier_or_legacy_replacement_is_rejected(self):
        for key,value in [('method','POST'),('path','/api/v1/anything'),('member_tiers',['standard','paid']),('report_owner',True),('aliases',['shortlist.update'])]:
            with self.subTest(key=key):
                spec,_=self.fixture();row=next(r for r in spec['operations']if r['id']=='member-shortlist.update');row[key]=value
                self.assertTrue(checker.member_shortlist_registration(spec)[1])
        spec,_=self.fixture();next(r for r in spec['operations']if r['id']=='shortlist.update')['path']='/api/v1/me/shortlist'
        self.assertTrue(checker.member_shortlist_registration(spec)[1])
    def test_extra_or_missing_operation_fails_closed(self):
        spec,_=self.fixture();spec['operations'].append({**spec['operations'][-1],'id':'member-shortlist.export'})
        self.assertTrue(checker.member_shortlist_registration(spec)[1])
        spec,_=self.fixture();spec['operations'].pop()
        self.assertTrue(checker.member_shortlist_registration(spec)[1])
    def test_source_drift_missing_duplicate_or_stale_snapshot_is_rejected(self):
        for mode in ('missing','duplicate','hash','bytes'):
            with self.subTest(mode=mode):
                spec,before=self.fixture();rows=spec['member_shortlist_contract']['source_registration']['verification']['source_bindings']
                if mode=='missing':rows.pop()
                elif mode=='duplicate':rows.append(rows[0].copy())
                elif mode=='hash':rows[0]['sha256']='2'*64
                else:before[rows[0]['path']]='3'*64
                self.assertTrue(checker.member_shortlist_registration(spec,before)[1])
    def test_suite_count_paths_and_operating_claim_cannot_drift(self):
        for mode in ('foundation','paths','count','activation','table','writes'):
            with self.subTest(mode=mode):
                spec,_=self.fixture();r=spec['member_shortlist_contract']['source_registration'];v=r['verification']
                if mode=='foundation':v['baseline_foundation_count']=660
                elif mode=='paths':v['test_paths'].append('tests/edge/test_unregistered.ts')
                elif mode=='count':v['test_count']=0
                elif mode=='activation':r['activation_status']='PASS'
                elif mode=='table':r['new_DB_result_tables']=1
                else:r['operating_writes']=True
                self.assertTrue(checker.member_shortlist_registration(spec)[1])
    def test_public_schema_is_bound_to_actual_snapshot_not_an_unrelated_index(self):
        spec,before=self.fixture()
        path='src/jungsi_touch/application/public_response_schemas.json'
        spec['edge_harness']['files'].pop(path)
        self.assertEqual([],checker.member_shortlist_registration(spec,before)[1])
        before[path]='f'*64
        self.assertTrue(checker.member_shortlist_registration(spec,before)[1])
    def test_write_cannot_drop_idempotency_or_use_an_unrelated_DTO(self):
        for mode in ('key','schema','contract'):
            with self.subTest(mode=mode):
                spec,_=self.fixture();row=next(r for r in spec['operations']if r['id']=='member-shortlist.update')
                if mode=='key':row['http_contract']['idempotency_key_required']=False
                elif mode=='schema':row['http_contract']['response_schema']='report'
                else:row['contract_ref']='backend_platform_contract.dto_schemas.report'
                self.assertTrue(checker.member_shortlist_registration(spec)[1])
    def test_no_silent_duplicate_common_definitions(self):
        import ast
        path=Path(__file__).resolve().parents[1]/'scripts/check_project_consistency.py'
        functions=[n.name for n in ast.parse(path.read_text(encoding='utf8')).body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef))]
        self.assertEqual(len(functions),len(set(functions)))
