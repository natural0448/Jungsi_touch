"""Run the registered Edge suite in exactly the retained Python-suite snapshot.
No runtime install, source fallback, skipped green result, cleanup or live service calls.
A separate native shell check may resolve only the existing frozen driver package.
"""
from __future__ import annotations
import argparse,base64,binascii,copy,hashlib,io,json,os,re,sys,tarfile,xml.etree.ElementTree as ET
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit
from edge_source_scope import classify_sources
from reference_safety_suite import registration as reference_safety_registration
from check_edge_contract import EdgeFailure,check_workspace,command,digest,hashes,json_bytes,verify_manifest,write_new,dynamic_imports,local_url,safe_path,tokens

def deno_test_command(argv, **kwargs):
    """Stop the current Deno suite on first failure; preserve all other arguments."""
    if len(argv)<2 or argv[1]!="test":
        raise EdgeFailure("deno_test_command_scope_invalid")
    if any(isinstance(arg,str) and (arg=="--fail-fast" or arg.startswith("--fail-fast=")) for arg in argv[2:]):
        raise EdgeFailure("deno_test_fail_fast_conflict")
    return command([*argv[:2],"--fail-fast",*argv[2:]], **kwargs)
def parse_junit(path,expected):
    if not Path(path).is_file():raise EdgeFailure("deno_test_result_missing")
    root=ET.fromstring(Path(path).read_bytes());cases=list(root.iter("testcase"))
    if len(cases)!=expected or any(list(c) for c in cases if any(x.tag in {"failure","error","skipped"} for x in c)):
        raise EdgeFailure("deno_test_count_failure_or_skip")
    return dict(tests_run=len(cases),failures=0,errors=0,skipped=0)

def split_auth_runtime_foundation(path, expected_foundation, runtime_suite):
    """Partition one JUnit run into the retained foundation and five exact new cases."""
    if runtime_suite is None:
        return parse_junit(path, expected_foundation), None
    if type(expected_foundation) is not int or expected_foundation not in (625, 656):
        raise EdgeFailure("auth_503_runtime_foundation_count_invalid")
    parse_junit(path, expected_foundation + runtime_suite["test_count"])
    cases = list(ET.fromstring(Path(path).read_bytes()).iter("testcase"))
    identities = [((case.get("classname") or "").replace(chr(92), "/").removeprefix("./"),
                   case.get("name")) for case in cases]
    if (any(not classname or not isinstance(name, str) or not name for classname, name in identities) or
        len(set(identities)) != len(identities)):
        raise EdgeFailure("auth_503_runtime_duplicate_or_invalid_identity")
    path_name = runtime_suite["test_path"]
    observed = [name for classname, name in identities if classname == path_name]
    additional = set(runtime_suite["case_names"])
    if any([classname for classname, actual_name in identities if actual_name == name] != [path_name]
           for name in additional):
        raise EdgeFailure("auth_503_runtime_case_source_or_duplicate_invalid")
    baseline = [name for name in observed if name not in additional]
    baseline_hash = hashlib.sha256(json.dumps(sorted(baseline), ensure_ascii=False,
                                   separators=(",", ":")).encode("utf-8")).hexdigest()
    if (len(additional) != runtime_suite["test_count"] or len(observed) != 30 or
        not additional.issubset(observed) or len(baseline) != runtime_suite["baseline_runtime_count"] or
        baseline_hash != runtime_suite["baseline_runtime_names_sha256"]):
        raise EdgeFailure("auth_503_runtime_case_partition_invalid")
    retained = dict(tests_run=expected_foundation, failures=0, errors=0, skipped=0)
    additive = dict(tests_run=runtime_suite["test_count"], failures=0, errors=0, skipped=0,
        coverage="AUTH_503_RUNTIME_INTEGRATION_SYNTHETIC", shared_foundation_junit=True,
        baseline_foundation_count=runtime_suite["baseline_foundation_count"],
        test_path=path_name, test_source_sha256=runtime_suite["test_source_sha256"],
        case_names=list(runtime_suite["case_names"]), native_acceptance="NOT_VERIFIED_BY_SOURCE_SUITE",
        activation_status="NOT_RUN", operating_writes=0)
    return retained, additive

def require_no_auth_runtime_overlap(path, runtime_suite):
    if runtime_suite is None: return
    names = {case.get("name") for case in ET.fromstring(Path(path).read_bytes()).iter("testcase")}
    if names.intersection(runtime_suite["case_names"]):
        raise EdgeFailure("auth_503_runtime_cross_suite_duplicate")
def require_oracle(receipt,count,cases_sha):
    if receipt.get("successful") is not True or receipt.get("case_count")!=count or receipt.get("mismatch_count")!=0 or receipt.get("deno_exit_code")!=0 or receipt.get("cases_sha256")!=cases_sha or receipt.get("oracle_references_match_basis") is not True:
        raise EdgeFailure("oracle_receipt_invalid")
def operation_registration(spec):
    """Report declared, hash-bound source registrations; never operating acceptance."""
    live=spec.get('supabase_deployment_contract',{}).get('live_execution')
    registered=[]
    total=None
    policy=spec.get('score_input_policy_contract');extension_registration=None;pinned_legacy=[]
    if live is not None:
        operations=spec.get('operations',[])
        ids=[row.get('id')for row in operations if isinstance(row,dict)]
        states=live.get('operations',{})if isinstance(live,dict)else None
        all_ids=ids
        if policy is not None:
            from check_project_consistency import validate_score_input_policy
            if validate_score_input_policy(spec):raise EdgeFailure('operation_registration_coverage_or_extension_binding_invalid')
            ids=policy['legacy_operation_ids']
        if (len(ids)!=22 or any(not isinstance(v,str)for v in ids) or len(set(ids))!=22 or
            not isinstance(states,dict)or set(states)!=set(ids)):
            raise EdgeFailure('operation_registration_coverage_invalid')
        total=len(all_ids)
        indexed={p:row.get('declarations',{}).get('source_sha256')
            for p,row in spec.get('edge_harness',{}).get('files',{}).items()}
        index=spec.get('workflow',{}).get('documentation_sync',{}).get('code_index',{}).get('edge_sources',{})
        indexed.update({row['path']:row.get('source_sha256')for row in index.get('files',[])})
        for operation in ids:
            state=states[operation]
            if not isinstance(state,dict)or state.get('code')not in {'NOT_PORTED','FOUNDATION_ONLY','PORTED'}:
                raise EdgeFailure('operation_registration_state_invalid')
            if state['code']!='PORTED':continue
            binding=state.get('binding')
            path=binding.get('path')if isinstance(binding,dict)else None
            sha=binding.get('source_sha256')if isinstance(binding,dict)else None
            matches=indexed.get(path)==sha
            if policy is not None and not matches:
                from check_project_consistency import policy_baseline_source_matches
                matches=policy_baseline_source_matches(spec,path,sha,indexed)
                if matches:pinned_legacy.append(operation)
            if (not isinstance(path,str)or not path.startswith('supabase/functions/') or
                not isinstance(sha,str)or len(sha)!=64 or any(c not in '0123456789abcdef'for c in sha) or not matches):
                raise EdgeFailure('operation_registration_binding_invalid')
            registered.append(operation)
        if policy is not None:
            extension_registration=dict(format='jungsi.edge-policy-extension-source-registration/v1',
                basis='checked_selected_snapshot_implementation_runtime_and_test_hashes',
                contract_operation_count=3,registered_operation_ids=policy['extension_operation_ids'],
                registered_operation_count=3,status='CODE_REGISTERED',
                implementation_bindings=policy['extension_implementation_bindings'],
                runtime_test_bindings=policy['extension_runtime_test_bindings'],
                native_acceptance='NOT_VERIFIED_BY_SOURCE_SUITE',activation_status='NOT_RUN')
    status='NOT_PORTED'if not registered else ('CODE_REGISTERED'if len(registered)==22 else 'PARTIAL_CODE_REGISTERED')
    result=dict(all_22=status,native_acceptance='NOT_VERIFIED_BY_SOURCE_SUITE',
        source_registration=dict(format='jungsi.edge-operation-registration/v1',
            basis='checked_selected_snapshot_and_exact_pinned_legacy_hashes'if pinned_legacy else 'checked_selected_snapshot_source_hashes',contract_operation_count=total,
            legacy_scope_operation_count=22,pinned_legacy_binding_operation_ids=pinned_legacy,
            registered_operation_ids=registered,registered_operation_count=len(registered)))
    if extension_registration is not None:result['policy_extension_source_registration']=extension_registration
    view=spec.get('read_view_extension_contract')
    if view is not None:
        from check_project_consistency import validate_read_view_extension
        if validate_read_view_extension(spec):raise EdgeFailure('read_view_extension_registration_invalid')
        result['read_view_extension_source_registration']=dict(
          format='jungsi.edge-read-view-extension-source-registration/v1',
          contract_operation_count=3,registered_operation_ids=view['operation_ids'],registered_operation_count=3,
          implementation_bindings=view['implementation_bindings'],runtime_test_bindings=view['runtime_test_bindings'],
          status='CODE_REGISTERED',native_acceptance='NOT_VERIFIED_BY_SOURCE_SUITE',activation_status='NOT_RUN')
    from check_project_consistency import member_shortlist_registration
    member,member_errors=member_shortlist_registration(spec)
    if member_errors:raise EdgeFailure('member_shortlist_source_registration_invalid')
    if member is not None:
        result['member_shortlist_source_registration']=dict(
            format='jungsi.member-shortlist-source-registration-receipt/v1',
            contract_operation_count=2,registered_operation_ids=member['operation_ids'],registered_operation_count=2,
            baseline_operation_count=28,status='CODE_REGISTERED',
            implementation_bindings=member['implementation_bindings'],
            native_acceptance='NOT_VERIFIED_BY_SOURCE_SUITE',activation_status='NOT_RUN')
    return result

OWNER_V4_CASE_NAMES = ('owner v4 keeps approved subjects expiry and actual percentile security invoker', 'owner v4 descriptor rejects the legacy v3 contract', 'owner v4 rejects a cursor bound to the previous projection', 'owner SQL no longer fetches a separate detailed review array', 'owner current-state SQL avoids the legacy review table entirely', 'owner SQL rejects unpinned or mixed state relations', 'owner observation state binds a validated archive digest', 'owner query is closed and binds explicit activity and exact current identifiers', 'owner response includes original metric identity explicit source version and unknown counts', 'owner relay and explicit subject remain required', 'owner approval expiry is rechecked on every page', 'owner percentile head changes invalidate next cursor with 409', 'owner admission head changes invalidate next cursor with 409', 'owner activity filter changes cannot reuse cursor', 'owner inactive observations stay visible with explicit exclusion reason', 'owner zero null and missing preserve native meaning', 'owner uncomputed percentile stays missing without fallback student rank', 'owner multiple healthy sources are never automatically duplicate errors', 'owner formula percentile preserves precise text and hides raw formula evidence', 'owner v4 rejects a legacy raw review array rather than ignoring it', 'owner multiple variants stay explicit with offline review archive metadata', 'owner stale source hold is preserved without substituting old percentile', 'owner calculated percentile rejects invalid bounds identity and publication flags', 'owner percentile diagnostic overflow is visible and bounded', 'owner empty filtered window returns continuation without global no-match claim', 'owner invalid scan metadata cannot imply complete current coverage', 'owner null percentile head is explicit and never a numeric zero', 'owner SQL retains canonical C ordering and bounded keys without global counts', 'owner SQL joins only page keys with current head and exact reference semantics', 'owner SQL rejects missing or repeated pinned view dependencies', 'owner nested original JSON remains held and never leaks extra internals', 'bounded admission definitions preserve SQL regex dollar tokens literally', 'bounded percentile definitions preserve replacement tokens without duplicating SQL', 'owner metadata seeds include the release table directly read outside the current view', 'owner full descriptor rejects missing direct release dependency even with valid hash', 'owner stable head session and query survive fourteen seconds of wall clock advance', 'owner stable short JWT expiry cap permits advance and still rejects actual expiry', 'owner equivalent UTC timestamp spellings keep the same head revision', 'owner changing the actual timestamp by one microsecond remains a head rejection', 'owner actual admission and percentile revisions report the source comparison stage', 'owner changed session expiry remains rejected and reports only safe enum and request ID', 'owner changed query subject and approval expiry are still denied', 'owner current state unapproved maps to distinct safe third comparison reason')
OWNER_V3_HISTORY_SHA256 = "8c02c05ca95a146295cdd9e18002352ecd4bf979a03fd5f4f5d415036289f40e"
OWNER_V3_REBOUND_CASE_NAMES = ('owner v3 keeps approved subjects expiry and actual percentile security invoker', 'owner query is closed and binds explicit activity and exact current identifiers', 'owner response includes original metric identity explicit source version and unknown counts', 'owner relay and explicit subject remain required', 'owner approval expiry is rechecked on every page', 'owner percentile head changes invalidate next cursor with 409', 'owner admission head changes invalidate next cursor with 409', 'owner activity filter changes cannot reuse cursor', 'owner inactive observations stay visible with explicit exclusion reason', 'owner zero null and missing preserve native meaning', 'owner uncomputed percentile stays missing without fallback student rank', 'owner multiple healthy sources are never automatically duplicate errors', 'owner formula percentile preserves precise text and hides raw formula evidence', 'owner multiple variants and review items remain explicit', 'owner stale source hold is preserved without substituting old percentile', 'owner calculated percentile rejects invalid bounds identity and publication flags', 'owner diagnostic overflow is visible and bounded', 'owner empty filtered window returns continuation without global no-match claim', 'owner invalid scan metadata cannot imply complete current coverage', 'owner null percentile head is explicit and never a numeric zero', 'owner SQL retains canonical C ordering and bounded keys without global counts', 'owner SQL joins only page keys with current head and exact reference semantics', 'owner SQL rejects missing or repeated pinned view dependencies', 'owner nested original JSON remains held and never leaks extra internals', 'bounded admission definitions preserve SQL regex dollar tokens literally', 'bounded percentile definitions preserve replacement tokens without duplicating SQL', 'owner metadata seeds include the release table directly read outside the current view', 'owner full descriptor rejects missing direct release dependency even with valid hash', 'owner stable head session and query survive fourteen seconds of wall clock advance', 'owner stable short JWT expiry cap permits advance and still rejects actual expiry', 'owner equivalent UTC timestamp spellings keep the same head revision', 'owner changing the actual timestamp by one microsecond remains a head rejection', 'owner actual admission and percentile revisions report the source comparison stage', 'owner changed session expiry remains rejected and reports only safe enum and request ID', 'owner changed query subject and approval expiry are still denied', 'owner current state unapproved maps to distinct safe third comparison reason')

def owner_review_registration(spec,before):
    """Retain the v3 record and run v4 independently when its exact registration exists."""
    c=spec.get("owner_current_review_contract")
    entry="supabase/functions/_shared/current_admission_owner_test.ts"
    if c is None:
        if entry in before:raise EdgeFailure("owner_review_contract_missing")
        return None
    v=c.get("verification",{})
    if (c.get("format")!="jungsi.owner-current-review-contract/v1" or
        v.get("test_path")!=entry or v.get("test_count")!=36 or
        not isinstance(v.get("source_bindings"),list) or not v["source_bindings"]):
        raise EdgeFailure("owner_review_verification_invalid")
    required={entry,*["supabase/functions/_shared/"+name+".ts" for name in
      ["current_admission_owner","current_admission_owner_sql","current_admission_review",
       "current_admission_review_sql","current_admission_display","official_history_display"]]}
    v4=c.get("verification_v4")
    rebound=c.get("verification_v3_rebound_20261030")
    if v4 is not None and rebound is not None:
        raise EdgeFailure("owner_rebound_and_v4_conflict")
    if rebound is not None:
        old_hash=hashlib.sha256(json.dumps(v,sort_keys=True,separators=(",",":"),ensure_ascii=True).encode()).hexdigest()
        required_fields={"format","status","test_path","test_count","case_names","historical_v3_verification_sha256",
                         "source_bindings","activation_status","operating_writes","native_acceptance"}
        if (old_hash!=OWNER_V3_HISTORY_SHA256 or not isinstance(rebound,dict) or set(rebound)!=required_fields or
            rebound.get("format")!="jungsi.owner-v3-current-source-synthetic/v1" or
            rebound.get("status")!="SOURCE_REGISTERED_NOT_EXECUTED" or
            rebound.get("test_path")!=entry or type(rebound.get("test_count")) is not int or rebound.get("test_count")!=36 or
            rebound.get("case_names")!=list(OWNER_V3_REBOUND_CASE_NAMES) or
            rebound.get("historical_v3_verification_sha256")!=OWNER_V3_HISTORY_SHA256 or
            rebound.get("activation_status")!="NOT_RUN" or rebound.get("native_acceptance")!="NOT_VERIFIED_BY_SOURCE_SUITE" or
            type(rebound.get("operating_writes")) is not int or rebound.get("operating_writes")!=0):
            raise EdgeFailure("owner_rebound_verification_invalid")
        v=rebound
    if v4 is not None:
        old_hash=hashlib.sha256(json.dumps(v,sort_keys=True,separators=(",",":"),ensure_ascii=True).encode()).hexdigest()
        if (old_hash!=OWNER_V3_HISTORY_SHA256 or not isinstance(v4,dict) or
            v4.get("format")!="jungsi.owner-current-review-v4-synthetic-verification/v1" or
            v4.get("test_path")!=entry or v4.get("test_count")!=43 or
            v4.get("case_names")!=list(OWNER_V4_CASE_NAMES) or
            v4.get("historical_v3_verification_sha256")!=OWNER_V3_HISTORY_SHA256 or
            v4.get("activation_status")!="NOT_RUN" or
            type(v4.get("operating_writes"))is not int or v4.get("operating_writes")!=0):
            raise EdgeFailure("owner_v4_verification_invalid")
        v=v4
    bindings=v.get("source_bindings")
    if (not isinstance(bindings,list) or len(bindings)!=len(required) or
        {b.get("path") for b in bindings if isinstance(b,dict)}!=required or
        any(not isinstance(b,dict) or set(b)!={"path","sha256"} or
            not isinstance(b.get("sha256"),str) or before.get(b["path"])!=b["sha256"] for b in bindings)):
        raise EdgeFailure("owner_review_source_binding_invalid")
    return v

def select_saved_report_runner_binding(spec, before, family, historical, selected):
    """Bind runner input to the current candidate without rewriting historical receipts.

    This is registration only: the five new receipt statuses remain NOT_RUN.
    Exact historical digest, exact prior path and current snapshot pins are required.
    """
    from check_project_consistency import saved_report_overlay, SAVED_REPORT_RECEIPT_PATHS
    try:
        pins = saved_report_overlay(spec, before)
        if pins is None:
            return selected
        if family not in SAVED_REPORT_RECEIPT_PATHS:
            raise ValueError("unknown saved report receipt")
        result = copy.deepcopy(selected)
        for path in SAVED_REPORT_RECEIPT_PATHS[family]:
            prior = [row for row in historical["source_bindings"] if isinstance(row, dict) and row.get("path") == path]
            current = [row for row in result["source_bindings"] if isinstance(row, dict) and row.get("path") == path]
            if len(prior) != 1 or len(current) != 1 or current[0].get("sha256") != prior[0].get("sha256"):
                raise ValueError("historical source binding")
            if path not in pins or before.get(path) != pins[path]:
                raise ValueError("current snapshot binding")
            current[0]["sha256"] = pins[path]
        return result
    except (KeyError, TypeError, ValueError, AttributeError) as exc:
        raise EdgeFailure("saved_report_receipt_source_binding_invalid") from exc

def current_public_registration(spec,before):
    """Exact separate provider proposal suite; no activation or legacy-count change."""
    prefix='supabase/functions/_shared/'
    names=['current_public_catalog','current_public_catalog_compat','current_public_catalog_runtime',
      'current_public_catalog_sql','current_public_catalog_sql_test','current_public_catalog_test',
      'current_public_key_index','current_public_key_index_test','current_public_key_storage',
      'current_public_key_storage_test','score_map_attendance_test']
    required={prefix+n+'.ts' for n in names}
    c=spec.get('current_public_supply_contract',{}).get('verification')
    if c is None:
        if required.intersection(before):raise EdgeFailure('current_public_verification_missing')
        return None
    tests=[prefix+n+'.ts'for n in names if n.endswith('_test')]
    c=select_saved_report_runner_binding(spec,before,'current_public',c,c)
    bindings=c.get('source_bindings')
    if (c.get('format')!='jungsi.current-public-provider-verification/v1' or
        c.get('test_paths')!=tests or c.get('test_count')!=84 or
        not isinstance(bindings,list) or len(bindings)!=len(required) or
        {b.get('path')for b in bindings}!=required or
        any(not isinstance(b.get('sha256'),str)or before.get(b['path'])!=b['sha256']for b in bindings)):
        raise EdgeFailure('current_public_source_or_test_binding_invalid')
    return c

def current_public_own_2027_registration(spec,before):
    """Bind the separate own-2027 internal candidate without changing the old provider suite."""
    source='supabase/functions/_shared/current_public_r27_selection.ts'
    test='supabase/functions/_shared/current_public_r27_selection_test.ts'
    existing='supabase/functions/_shared/current_public_catalog.ts'
    bounded='supabase/functions/_shared/current_public_r27_bounded.ts'
    bounded_test='supabase/functions/_shared/current_public_r27_bounded_test.ts'
    required={source,test,existing,bounded,bounded_test}
    contract=spec.get('current_public_supply_contract',{}).get('own_2027_batch_verification')
    if contract is None:
        if any(p in before for p in required if p!=existing):raise EdgeFailure('own_2027_batch_verification_missing')
        return None
    contract=select_saved_report_runner_binding(spec,before,'own_2027',contract,contract)
    bindings=contract.get('source_bindings') if isinstance(contract,dict) else None
    if (not isinstance(contract,dict) or contract.get('format')!='jungsi.own-2027-batch-verification/v1' or
        contract.get('status')!='SOURCE_CANDIDATE_SYNTHETIC_ONLY_NOT_ACTIVATED' or
        contract.get('test_path')!=test or contract.get('test_count')!=11 or
        contract.get('bounded_test_path')!=bounded_test or contract.get('bounded_test_count')!=8 or
        not isinstance(bindings,list) or len(bindings)!=len(required) or
        {b.get('path') for b in bindings if isinstance(b,dict)}!=required or
        any(not isinstance(b,dict) or set(b)!={'path','sha256'} or
            not isinstance(b.get('sha256'),str) or before.get(b['path'])!=b['sha256'] for b in bindings)):
        raise EdgeFailure('own_2027_batch_source_or_test_binding_invalid')
    return contract

def current_public_snapshot_batch_registration(spec,before):
    """Pin the non-activated snapshot batch candidate and its synthetic tests."""
    prefix='supabase/functions/_shared/'
    source=prefix+'current_public_p1_snapshot_batch.ts'
    test=prefix+'current_public_p1_snapshot_batch_test.ts'
    required={source,test,prefix+'current_public_catalog.ts',prefix+'current_public_key_index.ts'}
    contract=spec.get('current_public_supply_contract',{}).get('snapshot_batch_verification')
    if contract is None:
        if source in before or test in before:raise EdgeFailure('snapshot_batch_verification_missing')
        return None
    contract=select_saved_report_runner_binding(spec,before,'snapshot_batch',contract,contract)
    bindings=contract.get('source_bindings') if isinstance(contract,dict) else None
    if (not isinstance(contract,dict) or contract.get('format')!='jungsi.snapshot-batch-verification/v1' or
        contract.get('status')!='SOURCE_CANDIDATE_SYNTHETIC_ONLY_NOT_ACTIVATED' or
        contract.get('test_path')!=test or contract.get('test_count')!=46 or
        not isinstance(bindings,list) or len(bindings)!=len(required) or
        {b.get('path') for b in bindings if isinstance(b,dict)}!=required or
        any(not isinstance(b,dict) or set(b)!={'path','sha256'} or
            not isinstance(b.get('sha256'),str) or before.get(b['path'])!=b['sha256'] for b in bindings)):
        raise EdgeFailure('snapshot_batch_source_or_test_binding_invalid')
    return contract


def current_page_projection_registration(spec,before):
    """Pin a disabled current-page application candidate and its synthetic tests."""
    source="supabase/functions/_shared/jungsi/application/history_current_page.ts"
    test="supabase/functions/_shared/jungsi/application/history_current_page_test.ts"
    prefix="supabase/functions/_shared/"
    guide=prefix+"current_2027_guide_search_review_only.ts"
    direct=prefix+"current_2027_guide_direct_review_only.ts"
    matcher=prefix+"p1_local_scope_matcher_review_only.ts"
    adapter=prefix+"p1_verified_scope_review_adapter_review_only.ts"
    issuer=prefix+"jungsi/application/current_guide_scope_issuer.campus.review-only.ts"
    fixture=prefix+"jungsi/application/scope_adapter_synthetic_fixture.ts"
    standalone=prefix+"jungsi/application/r27_standalone.ts"
    guide_tests=[prefix+"current_2027_guide_search_review_only_test.ts",prefix+"current_2027_guide_search_sql_integration_test.ts",prefix+"current_2027_guide_direct_integration_test.ts",prefix+"p1_local_scope_matcher_review_only_test.ts",prefix+"p1_verified_scope_review_adapter_review_only_test.ts"]
    required={source,test,guide,direct,matcher,adapter,issuer,fixture,standalone,*guide_tests,prefix+"current_public_catalog.ts",prefix+"current_public_catalog_sql.ts"}
    contract=spec.get("current_public_supply_contract",{}).get("current_page_projection_verification")
    if contract is None:
        if source in before or test in before:raise EdgeFailure("current_page_projection_verification_missing")
        return None
    contract=select_saved_report_runner_binding(spec,before,'current_page_projection',contract,contract)
    bindings=contract.get("source_bindings") if isinstance(contract,dict) else None
    if (not isinstance(contract,dict) or contract.get("format")!="jungsi.current-page-projection-verification/v1" or
        contract.get("status")!="SOURCE_CANDIDATE_SYNTHETIC_ONLY_NOT_ACTIVATED" or
        contract.get("test_path")!=test or contract.get("test_count")!=48 or
        contract.get("guide_test_paths")!=guide_tests or contract.get("guide_test_count")!=81 or
        contract.get("activation")!="NOT_RUN" or contract.get("production_ready") is not False or
        not isinstance(bindings,list) or len(bindings)!=len(required) or
        {b.get("path") for b in bindings if isinstance(b,dict)}!=required or
        any(not isinstance(b,dict) or set(b)!={"path","sha256"} or
            not isinstance(b.get("sha256"),str) or before.get(b["path"])!=b["sha256"] for b in bindings)):
        raise EdgeFailure("current_page_projection_source_or_test_binding_invalid")
    return contract


def current_page_route_registration(spec,before):
    """Pin the disabled current-page route, recursive schema and synthetic tests."""
    prefix="supabase/functions/_shared/jungsi/"
    tests=["tests/edge/test_current_page_routing.synthetic.ts",prefix+"application/history_current_page_public_registry_test.ts"]
    schema=prefix+"application/history_current_page_public_registry.review-only.json"
    required={*tests,schema,prefix+"application/history_current_page.ts",
        prefix+"application/api_dispatch.ts",prefix+"application/request_budget.ts",
        prefix+"application/member_shortlist_schema.ts",prefix+"application/public_response.ts",
        prefix+"infrastructure/api_http.ts",prefix+"infrastructure/runtime_budget.ts",
        prefix+"infrastructure/runtime_composition.ts",prefix+"infrastructure/current_page_request_ports.review-only.ts"}
    contract=spec.get("current_public_supply_contract",{}).get("current_page_route_verification")
    try:
        from check_project_consistency import select_current_source_rebound
        if contract is not None: contract=select_current_source_rebound(spec,"current_page",contract)
    except (KeyError,TypeError,ValueError,AttributeError):
        raise EdgeFailure("current_page_route_current_source_rebound_invalid")
    if contract is None:
        if any(path in before for path in tests):raise EdgeFailure("current_page_route_verification_missing")
        return None
    bindings=contract.get("source_bindings") if isinstance(contract,dict) else None
    if (not isinstance(contract,dict) or contract.get("format")!="jungsi.current-page-route-verification/v1" or
        contract.get("status")!="SOURCE_CANDIDATE_SYNTHETIC_ONLY_NOT_ACTIVATED" or
        contract.get("test_paths")!=tests or contract.get("test_count")!=40 or
        contract.get("schema_path")!=schema or contract.get("activation")!="NOT_RUN" or
        contract.get("production_ready") is not False or not isinstance(bindings,list) or
        len(bindings)!=len(required) or {b.get("path") for b in bindings if isinstance(b,dict)}!=required or
        any(not isinstance(b,dict) or set(b)!={"path","sha256"} or
            not isinstance(b.get("sha256"),str) or before.get(b["path"])!=b["sha256"] for b in bindings)):
        raise EdgeFailure("current_page_route_source_or_test_binding_invalid")
    return contract


RUNNER_REBOUND_PINS = {
    'whole_population': ('c3c9eb550c22a2c8fdfa0ad44236e07e5cb4a7db19033b78937845a47403a9ee',
      'supabase/functions/_shared/jungsi/infrastructure/native_data_provider.ts', 'abbc67d7a86fe0e8269252c384e7dc0ae6659e22c4be74fecb22cdbd43126f2e'),
    'period_renewal': ('2dbd67ed543cd12053d873675485ad36b2812091ffa84861a0911dd914781e2e',
      'supabase/functions/_shared/jungsi/infrastructure/runtime_budget.ts', '8565612cd404fdfd98ff9c8e3b32f2d0bedc2029fcd2ec51184ccac55f2e1756'),
    'p1_selection': ('baae156bbc3786fd45e09730e4c662ee44d99b38c0ce4b8ebc2e44883c325db7',
      'supabase/functions/_shared/jungsi/application/api_dispatch.ts', '9bcc0fa7a404dbcf4d1825b7989906a10324f7daa613e30c288896db25fe8901'),
}
RUNNER_REBOUND_FAMILIES = {'member','auth','current_page','read_view','req27',
                           'whole_population','period_renewal','p1_selection'}

def select_runner_current_rebound(spec, family, historical):
    """Return a verified virtual copy; never rewrite historic evidence."""
    if 'current_source_rebounds_20261113' not in spec:return historical
    sibling=spec['current_source_rebounds_20261113']
    try:
        fields={'format','status','activation_status','native_acceptance','operating_writes','families'}
        if (not isinstance(sibling,dict) or set(sibling)!=fields or
            sibling['format']!='jungsi.current-source-rebounds/v1' or sibling['status']!='SOURCE_REGISTERED_NOT_EXECUTED' or
            sibling['activation_status']!='NOT_RUN' or sibling['native_acceptance']!='NOT_VERIFIED_BY_SOURCE_SUITE' or
            type(sibling['operating_writes']) is not int or sibling['operating_writes']!=0 or
            not isinstance(sibling['families'],dict) or set(sibling['families'])!=RUNNER_REBOUND_FAMILIES):
            raise ValueError('rebound envelope')
        pin,path,current=RUNNER_REBOUND_PINS[family];entry=sibling['families'][family]
        actual=hashlib.sha256(json.dumps(historical,sort_keys=True,separators=(',',':'),ensure_ascii=True).encode()).hexdigest()
        if (actual!=pin or not isinstance(entry,dict) or set(entry)!={'historical_sha256','changed_source_bindings'} or
            entry['historical_sha256']!=pin or entry['changed_source_bindings']!={path:current}):
            raise ValueError('historical or changed source')
        selected=copy.deepcopy(historical);rows=selected['source_bindings']
        matches=[r for r in rows if isinstance(r,dict) and r.get('path')==path]
        if len(matches)!=1:raise ValueError('exact source occurrence')
        matches[0]['sha256']=current
        return selected
    except (KeyError,TypeError,ValueError,AttributeError):
        raise EdgeFailure('runner_current_source_rebound_invalid')


def period_renewal_registration(spec,before):
    """Verify source scope only; no renewal execution or operational claim."""
    historical=spec.get('backend_platform_contract',{}).get('period_renewal_source_extension')
    if historical is None:
        if 'current_source_rebounds_20261113' in spec:raise EdgeFailure('period_renewal_source_binding_invalid')
        return None
    selected=select_runner_current_rebound(spec,'period_renewal',historical)
    try:
        # A separate current candidate may rebind only the two named source
        # files after the original period-renewal receipt was verified above.
        from check_project_consistency import saved_report_overlay
        candidate=saved_report_overlay(spec,before)
        if candidate is not None:
            expected={
                'supabase/functions/_shared/jungsi/infrastructure/runtime_budget.ts':
                    '8565612cd404fdfd98ff9c8e3b32f2d0bedc2029fcd2ec51184ccac55f2e1756',
                'supabase/functions/_shared/jungsi/infrastructure/score_input_postgres.ts':
                    '7481a67980de4d0dc9e0882ef03d6f7922e94c42bb9f55b2cc2f46e483635b77',
            }
            selected=copy.deepcopy(selected)
            for path,old in expected.items():
                matches=[row for row in selected['source_bindings']
                         if isinstance(row,dict) and row.get('path')==path]
                if len(matches)!=1 or matches[0].get('sha256')!=old:
                    raise ValueError('period renewal previous source binding')
                matches[0]['sha256']=candidate[path]
        rows=selected['source_bindings'];paths=[r['path'] for r in rows]
        if (not isinstance(rows,list) or len(paths)!=len(set(paths)) or
            selected.get('format')!='jungsi.period-renewal-source-extension/v1' or
            selected.get('status')!='SOURCE_PREPARED_NOT_ACTIVATED' or selected.get('test_count')!=9 or
            any(not isinstance(r.get('sha256'),str) or not re.fullmatch(r'[a-f0-9]{64}',r['sha256']) or
                before.get(r['path'])!=r['sha256'] for r in rows)):
            raise ValueError('period renewal bindings')
        return selected
    except (KeyError,TypeError,ValueError,AttributeError):
        raise EdgeFailure('period_renewal_source_binding_invalid')


def whole_population_registration(spec,before):
    """Separate strict v2 regressions; keep the foundation and v1 checks exact."""
    prefix='supabase/functions/_shared/'
    test=prefix+'all_examinees_total_model_test.ts'
    contract=spec.get('overall_analysis_contract',{}).get('whole_population_transition')
    if contract is None:
        if test in before or 'current_source_rebounds_20261113' in spec:raise EdgeFailure('whole_population_contract_missing')
        return None
    c=select_runner_current_rebound(spec,'whole_population',contract.get('verification',{}))
    required={test,prefix+'current_public_catalog_compat.ts',*[prefix+'jungsi/'+p+'.ts'for p in
      ['domain/all_examinees_total_model','domain/exam_pack','application/overall_analysis','infrastructure/native_data_provider']]}
    bindings=c.get('source_bindings')
    if (contract.get('format')!='jungsi.whole-population-model-transition/v1' or
        c.get('test_path')!=test or c.get('test_count')!=14 or
        not isinstance(bindings,list) or len(bindings)!=len(required) or
        {b.get('path')for b in bindings}!=required or
        any(not isinstance(b.get('sha256'),str)or before.get(b['path'])!=b['sha256']for b in bindings)):
        raise EdgeFailure('whole_population_source_or_test_binding_invalid')
    return c

def read_view_registration(spec,before):
    """Exact read3 suite, independently counted from legacy foundation and policy3."""
    from check_project_consistency import validate_read_view_extension
    if validate_read_view_extension(spec):raise EdgeFailure('read_view_extension_registration_invalid')
    contract=spec.get('read_view_extension_contract')
    if contract is None:return None
    try:
        from check_project_consistency import select_current_source_rebound
        contract=select_current_source_rebound(spec,"read_view",contract)
    except (KeyError,TypeError,ValueError,AttributeError):
        raise EdgeFailure('read_view_current_source_rebound_invalid')
    v=contract['verification']
    if any(before.get(b['path'])!=b['sha256']for b in v['source_bindings']):
        raise EdgeFailure('read_view_extension_snapshot_binding_invalid')
    return v


SCHOOL_REFERENCE_TESTS=tuple('tests/edge/'+name+'.ts'for name in (
    'test_school_reference_scoring','test_school_reference_provider','test_history_metric_alias','test_saved_reference_projection',
    'test_scope_signal_followup.synthetic','test_saved_tail_scope_cache.followup.synthetic'))
SCHOOL_REFERENCE_SOURCES=tuple('supabase/functions/_shared/jungsi/'+name+'.ts'for name in (
    'application/school_score_inputs','application/school_reference_scoring','application/history_metric_alias',
    'domain/saved_reference_projection','infrastructure/school_reference_source','application/university_scoring',
    'application/university_analysis','application/offering_analysis','domain/exam_pack','infrastructure/native_data_provider',
    'infrastructure/native_source_selection','infrastructure/supabase_artifacts','infrastructure/runtime_controls',
    'infrastructure/runtime_composition','application/reference_candidate_scope','application/reference_percentile',
    'infrastructure/reference_runtime_authority','infrastructure/runtime_context','infrastructure/saved_reference_tail_source'))

SCHOOL_REFERENCE_PRE_CANCELLATION_SHA256 = '9e1d9cee2e51a77b3b7142de3ed4980f887fffabae110478ec4795ff7364e296'
SCHOOL_REFERENCE_CANCELLATION_SOURCE = 'supabase/functions/_shared/jungsi/application/university_analysis.ts'
SCHOOL_REFERENCE_CANCELLATION_SHA256 = '234df307771d354ad0122d411b16782d743619ffeaaac829a2eb69dfc2d62638'

def school_reference_registration(spec,before):
    """Keep the original 656 cases and bind the additive reference suite to exact snapshot bytes."""
    contract=spec.get('university_scoring_contract',{}).get('scoped_reference_contract',{})
    v=contract.get('verification')
    rebound=contract.get('verification_current_source_rebound_20261113')
    rebound_v2=contract.get('verification_current_source_rebound_20261113_v2')
    if rebound_v2 is not None and rebound is None:
        raise EdgeFailure('school_reference_rebound_invalid')
    if rebound is not None or rebound_v2 is not None:
        # Preserve and independently authenticate the historic 97-case receipt,
        # the prior one-source rebound, and the later three-source registration.
        try:
            historical=hashlib.sha256(json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True).encode()).hexdigest()
            expected={'format','status','historical_verification_sha256','baseline_foundation_count','test_count',
                      'test_paths','source_bindings','native_acceptance','activation_status','operating_writes'}
            old={b['path']:b['sha256'] for b in v['source_bindings']}
            if historical!=SCHOOL_REFERENCE_PRE_CANCELLATION_SHA256 or len(old)!=len(v['source_bindings']):
                raise ValueError('historic reference binding')
            permitted_v1={SCHOOL_REFERENCE_CANCELLATION_SOURCE:SCHOOL_REFERENCE_CANCELLATION_SHA256}
            permitted_v2={**permitted_v1,
              'supabase/functions/_shared/jungsi/infrastructure/native_data_provider.ts':'abbc67d7a86fe0e8269252c384e7dc0ae6659e22c4be74fecb22cdbd43126f2e',
              'supabase/functions/_shared/jungsi/infrastructure/runtime_composition.ts':'1af7e8e57871a38ec61b29a3bbb2c254348d4bad6215ca5b58f4afb0bb504773'}
            for candidate,fmt,permitted in ((rebound,'jungsi.school-reference-current-source-rebound/v1',permitted_v1),
                                            (rebound_v2,'jungsi.school-reference-current-source-rebound/v2',permitted_v2)):
                if candidate is None:continue
                if not isinstance(candidate,dict) or set(candidate)!=expected:raise ValueError('rebound fields')
                now={b['path']:b['sha256'] for b in candidate['source_bindings']}
                if (candidate['format']!=fmt or candidate['status']!='SOURCE_REGISTERED_NOT_EXECUTED' or
                    candidate['historical_verification_sha256']!=historical or
                    candidate['baseline_foundation_count']!=656 or candidate['test_count']!=97 or
                    candidate['test_paths']!=list(SCHOOL_REFERENCE_TESTS) or
                    candidate['native_acceptance']!='NOT_VERIFIED_BY_SOURCE_SUITE' or
                    candidate['activation_status']!='NOT_RUN' or type(candidate['operating_writes']) is not int or
                    candidate['operating_writes']!=0 or len(now)!=len(candidate['source_bindings']) or
                    set(now)!=set(old) or not set(permitted)<=set(old) or
                    any(now[p]!=permitted.get(p,old[p]) for p in old)):
                    raise ValueError('historical/current reference binding')
            v=rebound_v2 if rebound_v2 is not None else rebound
        except (KeyError,TypeError,ValueError,AttributeError):
            raise EdgeFailure('school_reference_rebound_invalid')
    if v is None:
        if set(SCHOOL_REFERENCE_TESTS).intersection(before):raise EdgeFailure('school_reference_verification_missing')
        return None
    from check_project_consistency import apply_member_school_overlay
    try:
        v=apply_member_school_overlay(spec,"school",v,before)
    except (KeyError,TypeError,ValueError,AttributeError) as error:
        raise EdgeFailure("school_reference_overlay_invalid") from error
    required={*SCHOOL_REFERENCE_SOURCES,*SCHOOL_REFERENCE_TESTS,'tests/edge/synthetic_school_reference.ts',
      'tests/edge/reference_candidate_scope_cases.ts','tests/edge/saved_reference_tail_source_cases.ts',
      'tests/edge/test_saved_tail_scope_cache.followup.synthetic.ts',
      'tests/edge/test_university_analysis.ts','supabase/functions/_shared/current_public_catalog.ts',
      'supabase/functions/_shared/current_public_catalog_test.ts','src/jungsi_touch/application/public_response_schemas.json',
      'tests/edge/public_api_contract_fixture.ts'}
    bindings=v.get('source_bindings')
    if (v.get('format')!=('jungsi.school-reference-current-source-rebound/v2' if rebound_v2 is not None else ('jungsi.school-reference-current-source-rebound/v1' if rebound is not None else 'jungsi.school-reference-synthetic-verification/v1')) or
        v.get('baseline_foundation_count')!=656 or v.get('test_count')!=97 or
        v.get('test_paths')!=list(SCHOOL_REFERENCE_TESTS) or
        not isinstance(bindings,list) or len(bindings)!=len(required) or
        {b.get('path')for b in bindings}!=required or
        any(not isinstance(b.get('sha256'),str) or before.get(b['path'])!=b['sha256']for b in bindings)):
        raise EdgeFailure('school_reference_source_or_test_binding_invalid')
    return v

def member_shortlist_suite_registration(spec,before):
    from check_project_consistency import member_shortlist_registration
    registered,errors=member_shortlist_registration(spec,before)
    if errors:raise EdgeFailure('member_shortlist_source_or_test_binding_invalid')
    return registered

def professional_suite_registration(spec,before):
    """Separate exact pro source/SQL suite; source registration never opens an institution."""
    from check_project_consistency import validate_professional_source_registration
    if validate_professional_source_registration(spec,before):
        raise EdgeFailure('professional_source_or_SQL_registration_invalid')
    contract=spec.get('professional_service_contract',{})
    return contract.get('source_registration')


PROFESSIONAL_NATIVE_ENTRYPOINT='supabase/functions/jungsi-pro-api/index.ts'
PROFESSIONAL_NATIVE_LOCK='supabase/functions/jungsi-api/deno.lock'
PROFESSIONAL_NATIVE_SOURCES=('supabase/functions/jungsi-api/postgres_pool.ts','supabase/functions/_shared/node_compat_bootstrap.ts')
PROFESSIONAL_NATIVE_LOCK_SHA256='774160ee9e5942b0bc50eac30caf68fb282210a319ed12b3f88940c7da0b8e26'

_NATIVE_SEED_ENABLE='JUNGSI_NATIVE_NPM_SEED'
_NATIVE_SEED_FIELDS=('JUNGSI_NATIVE_NPM_MANIFEST','JUNGSI_NATIVE_NPM_MANIFEST_SHA256',
    'JUNGSI_NATIVE_NPM_TARBALL','JUNGSI_NATIVE_NPM_APPROVED_SCRATCH','JUNGSI_NATIVE_NPM_DENY_PROXY')
_NATIVE_SEED_HEX=re.compile(r'[a-f0-9]{64}\Z')
_NATIVE_SEED_RESERVED={'CON','PRN','AUX','NUL',*(f'COM{i}' for i in range(1,10)),
    *(f'LPT{i}' for i in range(1,10))}

def _native_seed_error(reason):
    raise EdgeFailure('native_seed_'+reason)

def _native_junction_supported():
    return os.name!='nt' or hasattr(Path,'is_junction')

def _native_no_reparse(path):
    if not _native_junction_supported():_native_seed_error('junction_detection_unavailable')
    if not isinstance(path,(str,os.PathLike)):_native_seed_error('path_invalid')
    path=Path(path)
    if not path.is_absolute():_native_seed_error('path_not_absolute')
    for item in (path,*path.parents):
        if item.is_symlink() or (hasattr(item,'is_junction') and item.is_junction()):
            _native_seed_error('reparse_path')
    return path

def _native_inside(root,path):
    root=_native_no_reparse(root).resolve(strict=True)
    path=_native_no_reparse(path).resolve(strict=False)
    if not path.is_relative_to(root):_native_seed_error('outside_approved_scratch')
    return path

def _native_file(path,maximum):
    path=_native_no_reparse(path)
    if not path.is_file() or path.stat().st_nlink!=1:_native_seed_error('file_not_regular')
    with path.open('rb') as stream:
        raw=stream.read(maximum+1)
    if len(raw)>maximum:_native_seed_error('file_too_large')
    return raw

def _native_json(raw):
    def pairs(values):
        out={}
        for key,value in values:
            if key in out:_native_seed_error('duplicate_json_key')
            out[key]=value
        return out
    def bad_constant(_value):_native_seed_error('invalid_json_constant')
    try:return json.loads(raw,object_pairs_hook=pairs,parse_constant=bad_constant)
    except (UnicodeError,ValueError,TypeError) as error:raise EdgeFailure('native_seed_json_invalid') from error

def _native_rel(name):
    if not isinstance(name,str) or not name or '\\' in name or ':' in name:
        _native_seed_error('unsafe_path')
    parts=name.split('/')
    if any(not p or p in {'.','..'} or p[-1] in {'.',' '} or
           any(ord(c)<32 or ord(c)==127 or c in '<>"|?*' for c in p) or
           p.split('.')[0].upper() in _NATIVE_SEED_RESERVED for p in parts):
        _native_seed_error('unsafe_path')
    parsed=PurePosixPath(name)
    if parsed.is_absolute() or parsed.as_posix()!=name:_native_seed_error('unsafe_path')
    return parsed

def _native_inventory(root):
    root=_native_no_reparse(root)
    if not root.exists():return set()
    if not root.is_dir():_native_seed_error('cache_not_directory')
    found=set()
    def onerror(error):raise EdgeFailure('native_seed_inventory_unavailable') from error
    for parent,dirs,files in os.walk(root,followlinks=False,onerror=onerror):
        for name in dirs:_native_no_reparse(Path(parent)/name)
        for name in files:
            path=_native_no_reparse(Path(parent)/name)
            if not path.is_file() or path.stat().st_nlink!=1:_native_seed_error('file_not_regular')
            found.add(path.relative_to(root).as_posix())
    return found

def _native_check_directories(root,names):
    if not root.exists():return
    allowed=set()
    for name in names:
        path=_native_rel(name)
        for parent in path.parents:
            if parent.as_posix()!='.':allowed.add(parent.as_posix())
    def onerror(error):raise EdgeFailure('native_seed_inventory_unavailable') from error
    for parent,dirs,_files in os.walk(root,followlinks=False,onerror=onerror):
        for name in dirs:
            path=_native_no_reparse(Path(parent)/name)
            if path.relative_to(root).as_posix() not in allowed:
                _native_seed_error('unexpected_cache_directory')

def _native_verify_cache(destination,files):
    _native_check_directories(destination,files)
    if _native_inventory(destination)!=set(files):_native_seed_error('destination_inventory_mismatch')
    for name,expected in files.items():
        if _native_file(destination.joinpath(*_native_rel(name).parts),len(expected))!=expected:
            _native_seed_error('destination_content_mismatch')

def prepare_optional_native_seed(lock_bytes,output):
    """Seed only the exact approved native npm cache; no installation or network proof."""
    enabled=os.environ.get(_NATIVE_SEED_ENABLE)
    if enabled is None:return None
    if enabled!='1':_native_seed_error('opt_in_invalid')
    values=[os.environ.get(key) for key in _NATIVE_SEED_FIELDS]
    if any(not isinstance(value,str) or not value for value in values):_native_seed_error('input_missing')
    manifest_path,manifest_sha,tar_path,scratch_raw,proxy=values
    if not _NATIVE_SEED_HEX.fullmatch(manifest_sha):_native_seed_error('approval_pin_invalid')
    try:
        parsed_proxy=urlsplit(proxy)
        port=parsed_proxy.port
    except ValueError as error:raise EdgeFailure('native_seed_proxy_invalid') from error
    if (parsed_proxy.scheme!='http' or parsed_proxy.hostname!='127.0.0.1' or port is None or
        not 1<=port<=65535 or parsed_proxy.username is not None or parsed_proxy.password is not None or
        parsed_proxy.path not in ('','/') or parsed_proxy.query or parsed_proxy.fragment):
        _native_seed_error('proxy_invalid')
    scratch=_native_no_reparse(scratch_raw)
    if not scratch.is_dir():_native_seed_error('scratch_missing')
    scratch=scratch.resolve(strict=True)
    out=_native_inside(scratch,Path(output)/'deno_cache')
    if not out.parent.is_dir():_native_seed_error('output_parent_missing')
    manifest_raw=_native_file(manifest_path,262144)
    if digest(manifest_raw)!=manifest_sha:_native_seed_error('manifest_not_approved')
    manifest=_native_json(manifest_raw)
    lock=_native_json(lock_bytes)
    if (not isinstance(manifest,dict) or manifest.get('format')!='offline-postgres-cache-observation/v1' or
        not isinstance(lock,dict)):_native_seed_error('manifest_invalid')
    try:
        integrity=lock['npm']['postgres@3.4.5']['integrity']
        if lock['specifiers']['npm:postgres@3.4.5']!='3.4.5':_native_seed_error('lock_identity')
        if (not isinstance(integrity,str) or not integrity.startswith('sha512-') or
            len(base64.b64decode(integrity[7:],validate=True))!=64 or
            manifest.get('lock_integrity')!=integrity):_native_seed_error('lock_identity')
    except (KeyError,TypeError,binascii.Error,ValueError) as error:
        raise EdgeFailure('native_seed_lock_invalid') from error
    source=_native_inside(scratch,manifest.get('cache_root'))
    tar_path=_native_inside(scratch,tar_path)
    if not source.is_dir():_native_seed_error('source_missing')
    # Bind the approved root to the source's exact retained Deno cache layout;
    # an ancestor such as a drive root must never broaden the write boundary.
    relative=source.relative_to(scratch).parts
    if len(relative)!=5 or tuple(relative[1:])!=('deno','npm','registry.npmjs.org','postgres'):
        _native_seed_error('source_scratch_binding')
    tar_raw=_native_file(tar_path,16777216)
    if 'sha512-'+base64.b64encode(hashlib.sha512(tar_raw).digest()).decode('ascii')!=integrity:
        _native_seed_error('tarball_integrity_mismatch')
    rows=manifest.get('files')
    if not isinstance(rows,list) or len(rows)!=38:_native_seed_error('inventory_invalid')
    entries={};folded=set()
    for row in rows:
        if (not isinstance(row,dict) or set(row)!={'path','bytes','sha256'} or
            type(row['bytes']) is not int or not 0<=row['bytes']<=16777216 or
            not isinstance(row['sha256'],str) or not _NATIVE_SEED_HEX.fullmatch(row['sha256'])):
            _native_seed_error('file_record_invalid')
        name=_native_rel(row['path']).as_posix()
        if name in entries or name.casefold() in folded:_native_seed_error('duplicate_path')
        entries[name]=row;folded.add(name.casefold())
    if sum(row['bytes'] for row in entries.values())>33554432:_native_seed_error('cache_size_limit')
    _native_check_directories(source,entries)
    if _native_inventory(source)!=set(entries):_native_seed_error('source_inventory_mismatch')
    files={}
    for name,row in entries.items():
        path=_native_inside(source,source.joinpath(*_native_rel(name).parts))
        raw=_native_file(path,row['bytes'])
        if len(raw)!=row['bytes'] or digest(raw)!=row['sha256']:_native_seed_error('source_content_mismatch')
        files[name]=raw
    if 'registry.json' not in files:_native_seed_error('registry_missing')
    tar_files={};tar_size=0
    try:
        with tarfile.open(fileobj=io.BytesIO(tar_raw),mode='r:gz') as archive:
            for member in archive:
                path=_native_rel(member.name)
                if not member.isfile() or len(path.parts)<2 or path.parts[0]!='package':
                    _native_seed_error('tar_member_invalid')
                name='3.4.5/'+PurePosixPath(*path.parts[1:]).as_posix()
                if name in tar_files or member.size<0 or member.size>16777216:
                    _native_seed_error('tar_member_invalid')
                tar_size+=member.size
                if tar_size>33554432:_native_seed_error('cache_size_limit')
                stream=archive.extractfile(member)
                if stream is None:_native_seed_error('tar_member_invalid')
                with stream:raw=stream.read(member.size+1)
                if len(raw)!=member.size:_native_seed_error('tar_member_invalid')
                tar_files[name]=raw
    except (tarfile.TarError,OSError,EOFError) as error:
        raise EdgeFailure('native_seed_tar_invalid') from error
    if len(tar_files)!=37 or set(files)-{'registry.json'}!=set(tar_files):
        _native_seed_error('tar_inventory_mismatch')
    if any(files[name]!=raw for name,raw in tar_files.items()):_native_seed_error('tar_content_mismatch')
    registry=_native_json(files['registry.json']);package=_native_json(files['3.4.5/package.json'])
    try:
        if (registry['name']!='postgres' or registry['versions']['3.4.5']['dist']['integrity']!=integrity or
            package['name']!='postgres' or package['version']!='3.4.5'):
            _native_seed_error('registry_package_identity')
    except (KeyError,TypeError) as error:raise EdgeFailure('native_seed_registry_invalid') from error
    destination=out/'npm'/'registry.npmjs.org'/'postgres'
    if destination.is_relative_to(source) or source.is_relative_to(destination):
        _native_seed_error('source_destination_overlap')
    _native_check_directories(destination,files)
    current=_native_inventory(destination)
    if not current.issubset(files):_native_seed_error('unexpected_existing_cache_file')
    for name in current:
        if _native_file(destination.joinpath(*_native_rel(name).parts),len(files[name]))!=files[name]:
            _native_seed_error('existing_cache_conflict')
    for name,raw in files.items():
        target=_native_inside(scratch,destination.joinpath(*_native_rel(name).parts))
        target.parent.mkdir(parents=True,exist_ok=True)
        _native_no_reparse(target)
        if target.exists():
            if _native_file(target,len(raw))!=raw:_native_seed_error('destination_changed')
        else:
            with target.open('xb') as stream:stream.write(raw)
    _native_verify_cache(destination,files)
    return dict(proxy=proxy,destination=destination,files=files,manifest_sha256=manifest_sha)

def professional_native_dependency_inputs(entrypoint,lock_bytes,before):
    """The native shell may resolve only the already pinned PostgreSQL dependency."""
    if entrypoint!=PROFESSIONAL_NATIVE_ENTRYPOINT or digest(lock_bytes.replace(b'\r\n',b'\n'))!=PROFESSIONAL_NATIVE_LOCK_SHA256:
        raise EdgeFailure('professional_native_entrypoint_or_lock_not_pinned')
    bindings={}
    for path in (entrypoint,PROFESSIONAL_NATIVE_LOCK,*PROFESSIONAL_NATIVE_SOURCES):
        value=before.get(path)
        if not isinstance(value,str)or len(value)!=64 or any(c not in '0123456789abcdef'for c in value):
            raise EdgeFailure('professional_native_dependency_snapshot_binding_missing:'+path)
        bindings[path]=value
    if bindings[PROFESSIONAL_NATIVE_LOCK]!=digest(lock_bytes):
        raise EdgeFailure('professional_native_lock_snapshot_mismatch')
    return bindings

def professional_native_graph(info,root,before):
    """Require the deployable static pool/bootstrap closure, not a hidden dynamic import."""
    from check_edge_contract import local_url
    if not isinstance(info,dict)or not isinstance(info.get('modules'),list)or not isinstance(info.get('roots'),list):
        raise EdgeFailure('professional_native_graph_invalid')
    if len(info['roots'])!=1 or local_url(info['roots'][0],root)!=PROFESSIONAL_NATIVE_ENTRYPOINT:
        raise EdgeFailure('professional_native_graph_root_invalid')
    packages=info.get('npmPackages')
    if not isinstance(packages,dict)or set(packages)!={'postgres@3.4.5'}:
        raise EdgeFailure('professional_native_npm_dependency_drift')
    package=packages['postgres@3.4.5']
    if not isinstance(package,dict)or package.get('name')!='postgres'or package.get('version')!='3.4.5'or package.get('dependencies')!=[]or package.get('registryUrl')!='https://registry.npmjs.org/':
        raise EdgeFailure('professional_native_npm_dependency_drift')
    files={};npm_nodes=0
    for module in info['modules']:
        if not isinstance(module,dict)or 'error'in module or not isinstance(module.get('specifier'),str):
            raise EdgeFailure('professional_native_graph_module_invalid')
        url=module['specifier']
        if url.startswith('file:'):
            path=local_url(url,root)
            if path in files or path not in before:
                raise EdgeFailure('professional_native_graph_file_unbound')
            files[path]=module
        elif module.get('kind')=='npm'and module.get('npmPackage')=='postgres@3.4.5'and url=='npm:/postgres@3.4.5':npm_nodes+=1
        elif not url.startswith('node:'):raise EdgeFailure('professional_native_graph_external_dependency')
    if npm_nodes!=1 or not {PROFESSIONAL_NATIVE_ENTRYPOINT,*PROFESSIONAL_NATIVE_SOURCES}<=set(files):
        raise EdgeFailure('professional_native_static_pool_closure_missing')
    for parent,child in ((PROFESSIONAL_NATIVE_ENTRYPOINT,PROFESSIONAL_NATIVE_SOURCES[0]),(PROFESSIONAL_NATIVE_SOURCES[0],PROFESSIONAL_NATIVE_SOURCES[1])):
        edges=[edge for edge in files[parent].get('dependencies',[])if isinstance(edge,dict)and isinstance(edge.get('code'),dict)and edge['code'].get('specifier','').startswith('file:')and local_url(edge['code']['specifier'],root)==child]
        if len(edges)!=1 or edges[0].get('isDynamic')is True:
            raise EdgeFailure('professional_native_static_pool_edge_missing')
    return dict(local_sources={path:before[path]for path in sorted(files)},npm_package='postgres@3.4.5',static_pool_and_bootstrap=True)

def check_professional_native_entrypoint(root,before,deno,config,output,entrypoint):
    lock_path=Path(root)/PROFESSIONAL_NATIVE_LOCK
    lock_bytes=lock_path.read_bytes()
    bindings=professional_native_dependency_inputs(entrypoint,lock_bytes,before)
    seed=prepare_optional_native_seed(lock_bytes,output)
    proxy=seed['proxy'] if seed else None
    native=['--no-remote','--node-modules-dir=none','--lock',PROFESSIONAL_NATIVE_LOCK,'--frozen-lockfile','--config',config]
    extra={'native_deno_proxy':proxy} if seed else {}
    check_cache=['--cached-only'] if seed else []
    command([deno,'check',*check_cache,*native,entrypoint],root=root,output=output,name='professional_native_check',**extra)
    if seed:_native_verify_cache(seed['destination'],seed['files'])
    raw=command([deno,'info','--json',*native,entrypoint],root=root,output=output,name='professional_native_info',**extra)
    if seed:_native_verify_cache(seed['destination'],seed['files'])
    try:graph=json.loads(raw)
    except (UnicodeError,ValueError)as error:raise EdgeFailure('professional_native_graph_JSON_invalid')from error
    closure=professional_native_graph(graph,root,before)
    if lock_path.read_bytes()!=lock_bytes:raise EdgeFailure('professional_native_lock_changed')
    return dict(status='PASS_PINNED_NATIVE_TYPECHECK_AND_STATIC_GRAPH',source_bindings=bindings,closure=closure,
        fixed_lock=True,local_node_modules_created=False,foundation_and_business_tests_no_npm=True,
        actual_DB='NOT_RUN',JWT_OTP_BFF='NOT_RUN',deployment='NOT_RUN',
        **({'native_cache_seed':dict(manifest_sha256=seed['manifest_sha256'],package_files=37,
            registry_files=1,tarball_sri='MATCHED',proxy_network_isolation='NOT_VERIFIED')} if seed else {}))

def require_professional_operation_tests(junit,names_by_operation):
    """A declared route cannot borrow evidence from a testcase that never ran."""
    ran={case.get('name')for case in junit.iter('testcase')}
    if any(not set(names)<=ran for names in names_by_operation.values()):
        raise EdgeFailure('professional_operation_test_did_not_run')


def recovery_test_filter(names):
    # Deno uses Rust regex; avoid unsupported lookaround and match exact known names.
    pattern="(?:"+"|".join(re.escape(name).replace("\\ "," ") for name in names)+")"
    return "/^"+pattern+"$/"

def require_exact_junit_names(path,expected):
    root=ET.fromstring(Path(path).read_bytes())
    names=[case.get("name") for case in root.iter("testcase")]
    if len(names)!=len(expected) or len(set(names))!=len(names) or set(names)!=set(expected):
        raise EdgeFailure("incident_recovery_junit_names_or_duplicates_invalid")

def parse_recovery_partition_junit(path,selected,excluded,expected_class):
    """Allow only the exact other partition's unexecuted JUnit records, never a selected skip."""
    if not Path(path).is_file():raise EdgeFailure("deno_test_result_missing")
    cases=list(ET.fromstring(Path(path).read_bytes()).iter("testcase"))
    selected=set(selected);excluded=set(excluded)
    if selected&excluded or len(cases)!=len(selected)+len(excluded):
        raise EdgeFailure("recovery_partition_junit_count_invalid")
    names=[case.get("name") for case in cases]
    if len(set(names))!=len(names) or set(names)!=selected|excluded:
        raise EdgeFailure("recovery_partition_junit_names_invalid")
    for case in cases:
        name=case.get("name")
        classname=(case.get("classname") or "").replace(chr(92),"/")
        if not classname.endswith(expected_class):raise EdgeFailure("recovery_partition_junit_source_invalid")
        children=list(case)
        if name in selected:
            if children or case.get("time") is None:raise EdgeFailure("selected_recovery_test_not_passed")
        elif len(children)!=1 or children[0].tag!="skipped" or case.get("time") is not None:
            raise EdgeFailure("unexpected_recovery_partition_skip")
    return dict(tests_run=len(selected),failures=0,errors=0,skipped=0,filtered_out=len(excluded))

def require_unique_junit_identities(path):
    root=ET.fromstring(Path(path).read_bytes())
    keys=[(case.get("classname"),case.get("name")) for case in root.iter("testcase")]
    if len(set(keys))!=len(keys):raise EdgeFailure("foundation_junit_duplicate_identity")

def require_disjoint_junit_identities(left,right):
    def identities(path):
        return {(case.get("classname"),case.get("name")) for case in ET.fromstring(Path(path).read_bytes()).iter("testcase")}
    if identities(left)&identities(right):raise EdgeFailure("foundation_junit_cross_suite_duplicate")

def require_no_recovery_cases(path,excluded):
    names={case.get("name") for case in ET.fromstring(Path(path).read_bytes()).iter("testcase")}
    if names&set(excluded):raise EdgeFailure("recovery_case_leaked_into_foundation")

def require_auxiliary_junit_identities(path, cases):
    root = ET.fromstring(Path(path).read_bytes())
    actual = []
    for case in root.iter("testcase"):
        classname = (case.get("classname") or "").replace(chr(92), "/").removeprefix("./")
        actual.append((classname, case.get("name")))
    expected = {(path, name) for path, names in cases.items() for name in names}
    if len(actual) != len(expected) or len(set(actual)) != len(actual) or set(actual) != expected:
        raise EdgeFailure("service_auxiliary_junit_identity_invalid")

P1_REVIEW_SOURCES = (
    "supabase/functions/_shared/jungsi/application/recruitment_final_qualification.ts",
    "supabase/functions/_shared/jungsi/application/p1_quota_fingerprint_adapter.ts",
    "supabase/functions/_shared/jungsi/application/history_score_context_review.ts",
)
P1_REVIEW_SUITES = (
    ("tests/p1_contract_review/test_recruitment_final_qualification.js", 38),
    ("tests/p1_contract_review/test_p1_quota_fingerprint_adapter.js", 12),
    ("tests/p1_contract_review/test_history_score_context_review.js", 21),
    ("tests/p1_contract_review/test_history_score_context_validator.js", 1),
)
P1_REVIEW_AGGREGATION_TEST = "tests/test_p1_edge_unit_aggregation.py"

def p1_review_registration(spec, before):
    """Bind additive P1 review suites without changing the foundation test set."""
    contract = spec.get("p1_recruitment_score_review_verification")
    required = set(P1_REVIEW_SOURCES) | {path for path, _ in P1_REVIEW_SUITES} | {P1_REVIEW_AGGREGATION_TEST}
    if contract is None:
        if required & set(before): raise EdgeFailure("p1_review_registration_missing")
        return None
    if (not isinstance(contract, dict) or
        contract.get("format") != "jungsi.p1-recruitment-score-review/v1" or
        contract.get("status") != "SOURCE_CANDIDATE_SYNTHETIC_ONLY_NOT_ACTIVATED" or
        contract.get("baseline_foundation_count") != 656 or
        contract.get("baseline_foundation_test_files") != 44 or
        contract.get("production_ready") is not False):
        raise EdgeFailure("p1_review_registration_invalid")
    cfg = spec.get("edge_harness", {})
    if cfg.get("unit_count") != 656 or len(cfg.get("tests", [])) != 44 or required & set(cfg.get("tests", [])):
        raise EdgeFailure("p1_review_foundation_scope_invalid")
    sources = contract.get("source_bindings")
    suites = contract.get("test_suites")
    if (not isinstance(sources, list) or len(sources) != len(P1_REVIEW_SOURCES) or
        not all(isinstance(x, dict) for x in sources) or
        {x.get("path") for x in sources} != set(P1_REVIEW_SOURCES) or
        not isinstance(suites, list) or len(suites) != len(P1_REVIEW_SUITES) or
        not all(isinstance(x, dict) for x in suites) or
        [(x.get("path"), x.get("count")) for x in suites] != list(P1_REVIEW_SUITES)):
        raise EdgeFailure("p1_review_bindings_invalid")
    for item in [*sources, *suites]:
        if (not isinstance(item.get("sha256"), str) or not re.fullmatch(r"[a-f0-9]{64}", item["sha256"]) or
            before.get(item["path"]) != item["sha256"]):
            raise EdgeFailure("p1_review_snapshot_binding_invalid")
    regression = contract.get("aggregation_regression")
    if (not isinstance(regression, dict) or set(regression) != {"path", "sha256"} or
        regression.get("path") != P1_REVIEW_AGGREGATION_TEST or
        not isinstance(regression.get("sha256"), str) or not re.fullmatch(r"[a-f0-9]{64}", regression["sha256"]) or
        before.get(P1_REVIEW_AGGREGATION_TEST) != regression["sha256"]):
        raise EdgeFailure("p1_review_aggregation_regression_invalid")
    names = {}
    for suite in suites:
        cases = suite.get("case_names")
        if (not isinstance(cases, list) or len(cases) != suite["count"] or
            any(not isinstance(n, str) or not n for n in cases) or len(set(cases)) != len(cases)):
            raise EdgeFailure("p1_review_case_names_invalid")
        names[suite["path"]] = cases
    return dict(test_paths=[x["path"] for x in suites], test_count=sum(x["count"] for x in suites),
        case_names_by_path=names, source_bindings=sources, test_bindings=suites, regression_binding=regression)

P1_SELECTION_BRIDGE_SOURCES = (
    "supabase/functions/_shared/p1_r27_selection_bridge.ts",
    "supabase/functions/_shared/current_public_r27_bounded.ts",
    "supabase/functions/_shared/current_public_r27_selection.ts",
    "supabase/functions/_shared/current_public_catalog.ts",
    "supabase/functions/_shared/jungsi/application/api_dispatch.ts",
    "supabase/functions/_shared/jungsi/application/p1_r27_composition.ts",
    "supabase/functions/_shared/jungsi/application/r27_standalone.ts",
    "supabase/functions/_shared/jungsi/application/history_snapshot.ts",
    "supabase/functions/_shared/jungsi/domain/json_value.ts",
    "supabase/functions/_shared/jungsi/domain/native_json.ts",
)
P1_SELECTION_BRIDGE_TEST = "tests/p1_contract_review/test_p1_r27_selection_bridge.synthetic.js"
P1_SELECTION_BRIDGE_FIXTURE = "tests/p1_contract_review/fixture.bridge.v2.synthetic.mjs"

def p1_selection_bridge_registration(spec, before):
    """Bind P1 selection source, reused sources and offline test fixture."""
    c = spec.get("p1_selection_bridge_review_verification")
    historical = c
    if c is not None:
        c = select_runner_current_rebound(spec,"p1_selection",c)
        c = select_saved_report_runner_binding(spec,before,"p1_selection",historical,c)
    required = set(P1_SELECTION_BRIDGE_SOURCES) | {P1_SELECTION_BRIDGE_TEST, P1_SELECTION_BRIDGE_FIXTURE}
    if c is None:
        if P1_SELECTION_BRIDGE_SOURCES[0] in before or 'current_source_rebounds_20261113' in spec: raise EdgeFailure("p1_selection_bridge_registration_missing")
        return None
    if (not isinstance(c, dict) or c.get("format") != "jungsi.p1-selection-bridge-review/v1" or
        c.get("status") != "SOURCE_CANDIDATE_SYNTHETIC_ONLY_NOT_ACTIVATED" or
        c.get("baseline_foundation_count") != 656 or c.get("baseline_foundation_test_files") != 44 or
        c.get("production_ready") is not False or c.get("test_count") != 17 or
        c.get("test_path") != P1_SELECTION_BRIDGE_TEST or c.get("fixture_path") != P1_SELECTION_BRIDGE_FIXTURE):
        raise EdgeFailure("p1_selection_bridge_registration_invalid")
    cfg = spec.get("edge_harness", {})
    if cfg.get("unit_count") != 656 or len(cfg.get("tests", [])) != 44 or required & set(cfg.get("tests", [])):
        raise EdgeFailure("p1_selection_bridge_foundation_scope_invalid")
    bindings = c.get("source_bindings")
    if (not isinstance(bindings, list) or len(bindings) != len(P1_SELECTION_BRIDGE_SOURCES) or
        not all(isinstance(x, dict) for x in bindings) or
        {x.get("path") for x in bindings} != set(P1_SELECTION_BRIDGE_SOURCES)):
        raise EdgeFailure("p1_selection_bridge_bindings_invalid")
    test_bindings = [{"path": P1_SELECTION_BRIDGE_TEST, "sha256": c.get("test_sha256")},
                     {"path": P1_SELECTION_BRIDGE_FIXTURE, "sha256": c.get("fixture_sha256")}]
    for item in [*bindings, *test_bindings]:
        if (not isinstance(item.get("sha256"), str) or not re.fullmatch(r"[a-f0-9]{64}", item["sha256"]) or
            before.get(item["path"]) != item["sha256"]):
            raise EdgeFailure("p1_selection_bridge_snapshot_binding_invalid")
    names = c.get("case_names")
    if (not isinstance(names, list) or len(names) != 17 or
        any(not isinstance(n, str) or not n for n in names) or len(set(names)) != 17):
        raise EdgeFailure("p1_selection_bridge_case_names_invalid")
    return dict(test_path=P1_SELECTION_BRIDGE_TEST, test_count=17,
        case_names_by_path={P1_SELECTION_BRIDGE_TEST: names}, source_bindings=bindings, test_bindings=test_bindings)

SERVICE_END_SYNTHETIC_SOURCES = (
    "supabase/functions/_shared/jungsi/application/operating_policy.ts",
    "supabase/functions/_shared/jungsi/infrastructure/score_input_postgres.ts",
    "supabase/functions/_shared/jungsi/application/service_end_admission.ts",
    "supabase/functions/_shared/jungsi/domain/time.ts",
    "tests/edge/synthetic_score_input_policy.ts",
    "tests/edge/synthetic_exam_pack.ts",
    "tests/edge/fixture.ts",
)
SERVICE_END_SYNTHETIC_TEST = "tests/p1_contract_review/test_score_010_cutoff.synthetic.js"

def service_end_synthetic_registration(spec, before):
    """Bind simulated cutoff and expired rollout checks, without executing SQL."""
    c = spec.get("service_end_score_cutoff_synthetic_verification")
    if c is None:
        if SERVICE_END_SYNTHETIC_TEST in before: raise EdgeFailure("service_end_synthetic_registration_missing")
        return None
    if (not isinstance(c, dict) or c.get("format") != "jungsi.service-end-score-cutoff-synthetic/v1" or
        c.get("status") != "SYNTHETIC_ONLY_NO_OPERATING_ACCEPTANCE" or
        c.get("baseline_foundation_count") != 656 or c.get("baseline_foundation_test_files") != 44 or
        c.get("production_ready") is not False or c.get("test_count") != 3 or
        c.get("test_path") != SERVICE_END_SYNTHETIC_TEST):
        raise EdgeFailure("service_end_synthetic_registration_invalid")
    cfg = spec.get("edge_harness", {})
    if cfg.get("unit_count") != 656 or len(cfg.get("tests", [])) != 44 or SERVICE_END_SYNTHETIC_TEST in cfg.get("tests", []):
        raise EdgeFailure("service_end_synthetic_foundation_scope_invalid")
    bindings = c.get("source_bindings")
    if (not isinstance(bindings, list) or len(bindings) != len(SERVICE_END_SYNTHETIC_SOURCES) or
        not all(isinstance(x, dict) for x in bindings) or
        {x.get("path") for x in bindings} != set(SERVICE_END_SYNTHETIC_SOURCES)):
        raise EdgeFailure("service_end_synthetic_bindings_invalid")
    test_binding = {"path": SERVICE_END_SYNTHETIC_TEST, "sha256": c.get("test_sha256")}
    for item in [*bindings, test_binding]:
        if (not isinstance(item.get("sha256"), str) or not re.fullmatch(r"[a-f0-9]{64}", item["sha256"]) or
            before.get(item["path"]) != item["sha256"]):
            raise EdgeFailure("service_end_synthetic_snapshot_binding_invalid")
    names = c.get("case_names")
    if (not isinstance(names, list) or len(names) != 3 or
        any(not isinstance(n, str) or not n for n in names) or len(set(names)) != 3):
        raise EdgeFailure("service_end_synthetic_case_names_invalid")
    return dict(test_path=SERVICE_END_SYNTHETIC_TEST, test_count=3,
        case_names_by_path={SERVICE_END_SYNTHETIC_TEST: names}, source_bindings=bindings, test_binding=test_binding)

P1CG_PREFIX = "tests/p1_contract_review/"
P1CG_ROOTS = tuple(P1CG_PREFIX + n for n in (
    "test_recruitment_final_qualification.js", "test_p1_quota_fingerprint_adapter.js",
    "test_history_score_context_review.js", "test_history_score_context_validator.js",
    "test_p1_r27_selection_bridge.synthetic.js", "test_score_010_cutoff.synthetic.js"))
P1CG_FIXTURE = P1CG_PREFIX + "fixture.bridge.v2.synthetic.mjs"
P1CG_TEST_FILES = frozenset((*P1CG_ROOTS, P1CG_FIXTURE))
P1CG_GRAPH_MANIFEST = "tests/p1_contract_review_graph.20261113_fmt.current.json"
P1CG_GRAPH_FORMAT = "jungsi.p1-contract-offline-closure/v1"
P1CG_CONFIG_PATH = "supabase/functions/deno.json"
P1CG_SHARED_FIXTURES = frozenset((
    "tests/edge/fixture.ts", "tests/edge/synthetic_exam_pack.ts",
    "tests/edge/synthetic_score_input_policy.ts"))
P1CG_EDGE_ADAPTERS = frozenset((
    "supabase/functions/_shared/current_public_catalog.ts",
    "supabase/functions/_shared/current_public_r27_bounded.ts",
    "supabase/functions/_shared/current_public_r27_selection.ts",
    "supabase/functions/_shared/p1_r27_selection_bridge.ts"))
P1CG_NODE_BY_ROOT = {p: frozenset() for p in P1CG_ROOTS}
P1CG_NODE_BY_ROOT[P1CG_ROOTS[4]] = frozenset(("node:assert/strict", "node:zlib"))
P1CG_PINNED_TYPE_IMPORTS = {
    "supabase/functions/_shared/jungsi/application/platform_repository.ts": (
        "a90983b9f970cdb3aec8f564df4971ae37ce85b3f457d56381cc06eaf43d5639", ["./score_input_ports.ts"]),
    "supabase/functions/_shared/jungsi/application/profile_reports.ts": (
        "c7e5ba17c07f6f3e74442093e581ac06e8f43a4014291486d3012b52a3f3bf87",
        ["./score_input_ports.ts", "./score_input_ports.ts"]),
    "supabase/functions/_shared/jungsi/application/score_input_ports.ts": (
        "c17d798e08750bdc7a8e0ec5ace5fb0cd3c132f8e9256288baebe5077c5df71c", ["./session_service.ts"] * 6),
    "supabase/functions/_shared/jungsi/application/score_input_service.ts": (
        "26cb702657fe67e66334435e8632e631451572f7d3032ba1897aa6ece0b1caa1", ["./score_input_ports.ts"]),
}
P1CG_ALLOWED_LAYERS = {
    "domain": {"domain"}, "application": {"application", "domain"},
    "infrastructure": {"application", "domain", "infrastructure"},
    "edge_adapter": {"application", "domain", "infrastructure", "edge_adapter"},
    "synthetic_fixture": {"application", "domain", "infrastructure", "edge_adapter",
                          "synthetic_fixture", "node_builtin"},
    "suite_test": {"application", "domain", "infrastructure", "edge_adapter",
                   "synthetic_fixture", "node_builtin"},
}
P1CG_MEDIA = {".ts": "TypeScript", ".tsx": "Tsx", ".js": "JavaScript", ".mjs": "Mjs"}

def _p1cg_need(ok, reason):
    if not ok:
        raise EdgeFailure("p1_contract_graph_" + reason)

def _p1cg_sha(raw):
    return hashlib.sha256(raw).hexdigest()

def _p1cg_snapshot_bytes(root, before, path):
    safe_path(path)
    _p1cg_need(isinstance(before, dict) and isinstance(before.get(path), str), "missing_snapshot_entry")
    p = root / path
    _p1cg_need(not any(q.is_symlink() or (hasattr(q, "is_junction") and q.is_junction())
                  for q in (p, *p.parents)), "linked_path")
    _p1cg_need(p.is_file() and p.resolve().is_relative_to(root.resolve()), "unsafe_file")
    raw = p.read_bytes()
    _p1cg_need(_p1cg_sha(raw) == before[path], "snapshot_hash")
    return raw

def _p1cg_layer(path):
    if path.startswith("node:"):
        return "node_builtin"
    if path in P1CG_TEST_FILES:
        return "suite_test" if PurePosixPath(path).name.startswith("test_") else "synthetic_fixture"
    if path in P1CG_SHARED_FIXTURES:
        return "synthetic_fixture"
    if path.startswith("supabase/functions/_shared/jungsi/"):
        category = path.split("/")[4]
        _p1cg_need(category in {"application", "domain", "infrastructure"}, "unknown_layer")
        return category
    if path in P1CG_EDGE_ADAPTERS:
        return "edge_adapter"
    raise EdgeFailure("p1_contract_graph_unapproved_source")

def _p1cg_check_literals(path, raw):
    try:
        literals = dynamic_imports(raw.decode("utf-8"))
    except (UnicodeError, ValueError) as error:
        raise EdgeFailure("p1_contract_graph_invalid_source") from error
    if literals:
        pin = P1CG_PINNED_TYPE_IMPORTS.get(path)
        _p1cg_need(pin is not None and _p1cg_sha(raw) == pin[0] and literals == pin[1], "dynamic_import")
    return literals


def _p1cg_static_imports(raw):
    """Conservatively extract literal ES imports/re-exports from the source lexer."""
    try:
        stream = tokens(raw.decode("utf-8"))
    except (UnicodeError, ValueError) as error:
        raise EdgeFailure("p1_contract_graph_invalid_source") from error
    _p1cg_need(not any(k in ("word", "string") and v in ("eval", "Function", "require")
                  for k, v, _, _ in stream), "dynamic_evaluation")
    found = []
    for i, (kind, word, _, _) in enumerate(stream):
        if kind != "word" or word not in ("import", "export") or (i and stream[i-1][1] == "."):
            continue
        j = i + 1
        if j >= len(stream):
            if word == "import": raise EdgeFailure("p1_contract_graph_invalid_import")
            continue
        nxt = stream[j][1]
        if word == "import" and nxt in ("(", "."):
            continue
        if word == "import" and stream[j][0] == "string":
            value = stream[j][1]
            _p1cg_need("\\" not in value, "escaped_import")
            found.append(value)
            continue
        if word == "export":
            if nxt == "type" and j+1 < len(stream) and stream[j+1][1] in ("{", "*"):
                j += 1; nxt = stream[j][1]
            if nxt == "{":
                depth = 1; j += 1
                while j < len(stream) and depth:
                    if stream[j][1] == "{": depth += 1
                    elif stream[j][1] == "}": depth -= 1
                    j += 1
                _p1cg_need(depth == 0, "invalid_export")
                if j < len(stream) and stream[j][1] == "from":
                    _p1cg_need(j+1 < len(stream) and stream[j+1][0] == "string", "invalid_export")
                    value = stream[j+1][1]; _p1cg_need("\\" not in value, "escaped_import"); found.append(value)
                continue
            if nxt != "*":
                continue
        found_from = False
        while j < len(stream):
            t = stream[j]
            if t[1] == ";" or (j > i+1 and t[0] == "word" and t[1] in ("import", "export")):
                break
            if t[0] == "word" and t[1] == "from" and j+1 < len(stream) and stream[j+1][0] == "string":
                value = stream[j+1][1]; _p1cg_need("\\" not in value, "escaped_import")
                found.append(value); found_from = True; break
            j += 1
        _p1cg_need(found_from, "invalid_import")
    return found


def _p1cg_check_test_edge(source, target):
    _p1cg_need(not (source in P1CG_ROOTS and target in P1CG_ROOTS), "test_root_cross_import")
    if target == P1CG_FIXTURE:
        _p1cg_need(source == P1CG_ROOTS[4], "bridge_fixture_scope")

def normalize_p1_graph(info, root, before, entry):
    """Validate one fresh Deno info graph and return a path-independent model."""
    root = Path(root).resolve()
    _p1cg_need(entry in P1CG_ROOTS and isinstance(info, dict) and
          set(info) == {"version", "roots", "modules", "redirects", "npmPackages"} and
          type(info.get("version")) is int and info["version"] == 1, "schema")
    _p1cg_need(type(info.get("redirects")) is dict and info["redirects"] == {} and
          type(info.get("npmPackages")) is dict and info["npmPackages"] == {}, "external_graph")
    roots = info.get("roots")
    _p1cg_need(isinstance(roots, list) and len(roots) == 1 and local_url(roots[0], root) == entry, "root")
    modules = info.get("modules")
    _p1cg_need(isinstance(modules, list) and 1 <= len(modules) <= 512, "module_count")
    uri_to_path, file_hashes, modules_by_path, module_literals = {}, {}, {}, {}
    node_specs = set()
    for m in modules:
        _p1cg_need(isinstance(m, dict) and m.get("error") is None, "module")
        uri, kind = m.get("specifier"), m.get("kind")
        _p1cg_need(isinstance(uri, str) and uri not in uri_to_path, "duplicate_module")
        if kind == "node":
            _p1cg_need(uri in P1CG_NODE_BY_ROOT[entry] and uri not in node_specs, "node_builtin")
            node_specs.add(uri); uri_to_path[uri] = uri
            continue
        _p1cg_need(kind == "esm" and isinstance(m.get("local"), str), "module_kind")
        path = local_url(uri, root)
        _p1cg_need(path not in modules_by_path and uri == (root / path).resolve().as_uri(), "module_alias")
        _p1cg_need(Path(m["local"]).resolve() == (root / path).resolve(), "module_local")
        _p1cg_need(P1CG_MEDIA.get(PurePosixPath(path).suffix) == m.get("mediaType"), "media_type")
        _p1cg_layer(path)
        raw = _p1cg_snapshot_bytes(root, before, path)
        _p1cg_need(type(m.get("size")) is int and m["size"] == len(raw), "module_size")
        module_literals[path] = _p1cg_check_literals(path, raw) + _p1cg_static_imports(raw)
        uri_to_path[uri] = path; modules_by_path[path] = m; file_hashes[path] = _p1cg_sha(raw)
    _p1cg_need(node_specs == P1CG_NODE_BY_ROOT[entry] and entry in modules_by_path, "node_coverage")
    edges = []
    for path, module in modules_by_path.items():
        deps = module.get("dependencies", [])
        _p1cg_need(isinstance(deps, list), "dependencies")
        _p1cg_need(set(module_literals[path]) <= {d.get("specifier") for d in deps if isinstance(d, dict)},
              "source_import_not_graphed")
        for dep in deps:
            _p1cg_need(isinstance(dep, dict) and dep.get("isDynamic", False) is False and
                  dep.get("is_dynamic", False) is False, "dynamic_import")
            raw = dep.get("specifier")
            _p1cg_need(isinstance(raw, str) and (raw.startswith(("./", "../")) or raw.startswith("node:"))
                  and not any(x in raw for x in ("\\", "?", "#", "%")), "specifier")
            targets = []
            for kind in ("code", "type"):
                resolved = dep.get(kind)
                if resolved is None:
                    continue
                _p1cg_need(isinstance(resolved, dict) and resolved.get("error") is None and
                      resolved.get("specifier") in uri_to_path, "unresolved")
                target = uri_to_path[resolved["specifier"]]
                if raw.startswith("node:"):
                    _p1cg_need(raw == target and target in node_specs, "node_resolution")
                else:
                    _p1cg_need(not target.startswith("node:") and (root / path).parent.joinpath(raw).resolve()
                          == (root / target).resolve(), "relative_resolution")
                _p1cg_check_test_edge(path, target)
                src_layer, dst_layer = _p1cg_layer(path), _p1cg_layer(target)
                _p1cg_need(dst_layer in P1CG_ALLOWED_LAYERS[src_layer], "layer")
                targets.append([kind, target])
            _p1cg_need(bool(targets), "unresolved")
            edges.append([path, raw, targets])
    _p1cg_need(len(edges) <= 4096, "edge_count")
    ordered = sorted(edges, key=lambda v: json.dumps(v, sort_keys=True))
    _p1cg_need(len({json.dumps(v, sort_keys=True) for v in edges}) == len(edges), "duplicate_edge")
    reachable, pending = {entry}, [entry]
    while pending:
        source = pending.pop()
        for edge in edges:
            if edge[0] == source:
                for _, target in edge[2]:
                    if target not in reachable:
                        reachable.add(target); pending.append(target)
    _p1cg_need(reachable == set(file_hashes) | node_specs, "unreachable_module")
    return {"files": {p: file_hashes[p] for p in sorted(file_hashes)},
            "builtins": sorted(node_specs), "edges": ordered}

def build_p1_graph_manifest(root, before, graphs):
    """Generate a proposed model only; acceptance requires independent review."""
    root = Path(root).resolve()
    _p1cg_need(set(graphs) == set(P1CG_ROOTS), "root_inventory")
    _p1cg_need({p for p in before if p.startswith(P1CG_PREFIX)} == P1CG_TEST_FILES, "test_inventory")
    tests = {p: _p1cg_sha(_p1cg_snapshot_bytes(root, before, p)) for p in sorted(P1CG_TEST_FILES)}
    config_sha = _p1cg_sha(_p1cg_snapshot_bytes(root, before, P1CG_CONFIG_PATH))
    normalized = {p: normalize_p1_graph(graphs[p], root, before, p) for p in P1CG_ROOTS}
    shared = {p for g in normalized.values() for p in g["files"]
              if p.startswith("tests/") and not p.startswith(P1CG_PREFIX)}
    _p1cg_need(shared == P1CG_SHARED_FIXTURES, "shared_fixture_coverage")
    return {"format": P1CG_GRAPH_FORMAT, "roots": list(P1CG_ROOTS), "test_files": tests,
            "config": {"path": P1CG_CONFIG_PATH, "sha256": config_sha}, "graphs": normalized}

def active_p1_roots(spec):
    _p1cg_need(isinstance(spec, dict), "spec")
    roots = []
    if "p1_recruitment_score_review_verification" in spec: roots.extend(P1CG_ROOTS[:4])
    if "p1_selection_bridge_review_verification" in spec: roots.append(P1CG_ROOTS[4])
    if "service_end_score_cutoff_synthetic_verification" in spec: roots.append(P1CG_ROOTS[5])
    return tuple(roots)

def verify_p1_graph_manifest(root, before, spec, manifest_sha256, graphs):
    """Verify a separately pinned proposal and fresh offline graphs; supports subsets."""
    root = Path(root).resolve(); active = active_p1_roots(spec)
    observed = {p for p in before if p.startswith(P1CG_PREFIX)}
    if not active:
        _p1cg_need(not observed and P1CG_GRAPH_MANIFEST not in before, "unregistered_files")
        return {"status": "NOT_APPLICABLE_NO_P1_CONTRACT_SUITE", "roots": 0}
    expected_files = set(active)
    if P1CG_ROOTS[4] in active: expected_files.add(P1CG_FIXTURE)
    _p1cg_need(observed == expected_files and set(graphs) == set(active), "test_inventory")
    raw = _p1cg_snapshot_bytes(root, before, P1CG_GRAPH_MANIFEST)
    _p1cg_need(isinstance(manifest_sha256, str) and len(manifest_sha256) == 64 and
          _p1cg_sha(raw) == manifest_sha256, "manifest_pin")
    try: ref = json.loads(raw)
    except (UnicodeError, ValueError) as error:
        raise EdgeFailure("p1_contract_graph_manifest_invalid") from error
    _p1cg_need(isinstance(ref, dict) and set(ref) == {"format", "roots", "test_files", "config", "graphs"}
          and ref["format"] == P1CG_GRAPH_FORMAT and ref["roots"] == list(P1CG_ROOTS)
          and isinstance(ref["test_files"], dict) and set(ref["test_files"]) == P1CG_TEST_FILES
          and isinstance(ref["graphs"], dict) and set(ref["graphs"]) == set(P1CG_ROOTS), "manifest_schema")
    _p1cg_need(ref["config"] == {"path": P1CG_CONFIG_PATH,
          "sha256": _p1cg_sha(_p1cg_snapshot_bytes(root, before, P1CG_CONFIG_PATH))}, "config_pin")
    for path in expected_files:
        _p1cg_need(ref["test_files"][path] == _p1cg_sha(_p1cg_snapshot_bytes(root, before, path)), "test_pin")
    for entry in active:
        _p1cg_need(normalize_p1_graph(graphs[entry], root, before, entry) == ref["graphs"][entry],
              "graph_changed")
    return {"status": "PASS_OFFLINE_PINNED_GRAPH_REVIEW_ONLY", "roots": len(active),
            "files": len(expected_files), "production_ready": False}


def reference_p1_graph_info(root, before, entry, model):
    """Build a synthetic info object from a pinned model for pre-read validation."""
    root = Path(root).resolve()
    _p1cg_need(entry in P1CG_ROOTS and isinstance(model, dict) and set(model) == {"files", "builtins", "edges"},
          "reference_schema")
    files, builtins, edges = model["files"], model["builtins"], model["edges"]
    _p1cg_need(isinstance(files, dict) and 1 <= len(files) <= 512 and entry in files and
          isinstance(builtins, list) and len(builtins) == len(set(builtins)) and
          set(builtins) == P1CG_NODE_BY_ROOT[entry] and isinstance(edges, list) and len(edges) <= 4096,
          "reference_schema")
    nodes = {}
    for path, expected in files.items():
        _p1cg_layer(path)
        raw = _p1cg_snapshot_bytes(root, before, path)
        _p1cg_need(_p1cg_sha(raw) == expected and PurePosixPath(path).suffix in P1CG_MEDIA, "reference_source_pin")
        p = (root / path).resolve()
        nodes[path] = {"kind": "esm", "specifier": p.as_uri(), "local": str(p),
                       "mediaType": P1CG_MEDIA[PurePosixPath(path).suffix], "size": len(raw),
                       "dependencies": []}
    for edge in edges:
        _p1cg_need(isinstance(edge, list) and len(edge) == 3 and edge[0] in nodes and
              isinstance(edge[1], str) and isinstance(edge[2], list), "reference_edge")
        dep = {"specifier": edge[1]}
        for pair in edge[2]:
            _p1cg_need(isinstance(pair, list) and len(pair) == 2 and pair[0] in ("code", "type") and
                  pair[0] not in dep and (pair[1] in nodes or pair[1] in builtins), "reference_edge")
            target = pair[1] if pair[1] in builtins else (root / pair[1]).resolve().as_uri()
            dep[pair[0]] = {"specifier": target}
        nodes[edge[0]]["dependencies"].append(dep)
    return {"version": 1, "roots": [(root / entry).resolve().as_uri()],
            "modules": [*nodes.values(), *({"kind": "node", "specifier": n} for n in builtins)],
            "redirects": {}, "npmPackages": {}}

def preflight_p1_graph_manifest(root, before, spec, manifest_sha256):
    """Check pinned source/import closure before invoking Deno info."""
    root = Path(root).resolve()
    active = active_p1_roots(spec)
    if not active:
        return verify_p1_graph_manifest(root, before, spec, manifest_sha256, {})
    raw = _p1cg_snapshot_bytes(root, before, P1CG_GRAPH_MANIFEST)
    _p1cg_need(isinstance(manifest_sha256, str) and _p1cg_sha(raw) == manifest_sha256, "manifest_pin")
    try: ref = json.loads(raw)
    except (UnicodeError, ValueError) as error:
        raise EdgeFailure("p1_contract_graph_manifest_invalid") from error
    _p1cg_need(isinstance(ref, dict) and isinstance(ref.get("graphs"), dict) and
          all(p in ref["graphs"] for p in active), "manifest_schema")
    graphs = {p: reference_p1_graph_info(root, before, p, ref["graphs"][p]) for p in active}
    return verify_p1_graph_manifest(root, before, spec, manifest_sha256, graphs)


P1CG_META_KEY = "p1_contract_offline_graph_verification"
P1CG_REGRESSION_PATH = "tests/test_p1_contract_graph_guard.py"
P1CG_DENY_FLAGS = ("--no-prompt", "--deny-read", "--deny-net", "--deny-env", "--deny-run",
                   "--deny-sys", "--deny-ffi", "--deny-write")

def _p1cg_unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        _p1cg_need(key not in result, "duplicate_json_key")
        result[key] = value
    return result

def run_p1_contract_offline_guard(root, before, spec, deno, cfg, output, tool):
    active = active_p1_roots(spec)
    if not active:
        _p1cg_need(P1CG_META_KEY not in spec, "orphan_registration")
        verify_p1_graph_manifest(root, before, spec, "", {})
        return None
    meta = spec.get(P1CG_META_KEY)
    _p1cg_need(isinstance(meta, dict) and set(meta) == {
        "format", "status", "manifest_path", "manifest_sha256", "regression_test", "production_ready"
    } and meta.get("format") == "jungsi.p1-contract-offline-verification/v1"
       and meta.get("status") == "SOURCE_CANDIDATE_SYNTHETIC_ONLY_NOT_ACTIVATED"
       and meta.get("manifest_path") == P1CG_GRAPH_MANIFEST
       and meta.get("production_ready") is False, "registration")
    regression = meta.get("regression_test")
    _p1cg_need(isinstance(regression, dict) and set(regression) == {"path", "sha256"}
       and regression.get("path") == P1CG_REGRESSION_PATH
       and regression.get("sha256") == _p1cg_sha(_p1cg_snapshot_bytes(root, before, P1CG_REGRESSION_PATH)),
       "regression_binding")
    _p1cg_need(isinstance(cfg, dict) and cfg.get("config") == P1CG_CONFIG_PATH, "config_path")
    config = json.loads(_p1cg_snapshot_bytes(root, before, P1CG_CONFIG_PATH),
                        object_pairs_hook=_p1cg_unique_pairs)
    _p1cg_need(isinstance(config, dict) and not any(config.get(k) for k in
       ("imports", "scopes", "extends", "importMap", "vendor", "nodeModulesDir"))
       and isinstance(config.get("compilerOptions", {}), dict)
       and not any(config.get("compilerOptions", {}).get(k) for k in ("types", "jsxImportSource")),
       "config_resolution")
    # Validate the pinned model, its source hashes and literal import closure before Deno parses files.
    preflight_p1_graph_manifest(root, before, spec, meta.get("manifest_sha256"))
    executable = Path(deno)
    _p1cg_need(isinstance(tool, dict) and isinstance(tool.get("sha256"), str) and executable.is_file()
       and not any(p.is_symlink() or (hasattr(p, "is_junction") and p.is_junction())
                   for p in (executable, *executable.parents))
       and _p1cg_sha(executable.read_bytes()) == tool["sha256"], "deno_pin")
    graphs = {}
    for i, entry in enumerate(active):
        _p1cg_need(_p1cg_sha(executable.read_bytes()) == tool["sha256"], "deno_pin")
        raw = command([deno, "info", "--json", "--no-lock", "--no-remote", "--no-npm",
                       "--config", P1CG_CONFIG_PATH, "./" + entry],
                      root=root, output=output, name="p1_contract_graph_info_" + str(i))
        _p1cg_need(len(raw) <= 8_388_608 and _p1cg_sha(executable.read_bytes()) == tool["sha256"],
                   "deno_pin_or_graph_size")
        graphs[entry] = json.loads(raw, object_pairs_hook=_p1cg_unique_pairs)
    result = verify_p1_graph_manifest(root, before, spec, meta["manifest_sha256"], graphs)
    test_paths = list(active) + ([P1CG_FIXTURE] if P1CG_ROOTS[4] in active else [])
    common = ["--no-lock", "--no-remote", "--no-npm", "--config", P1CG_CONFIG_PATH]
    command([deno, "check", *common, *test_paths], root=root, output=output, name="p1_contract_check")
    command([deno, "lint", "--config", P1CG_CONFIG_PATH, *test_paths],
            root=root, output=output, name="p1_contract_lint")
    command([deno, "fmt", "--check", "--config", P1CG_CONFIG_PATH, *test_paths],
            root=root, output=output, name="p1_contract_fmt")
    _p1cg_need(_p1cg_sha(executable.read_bytes()) == tool["sha256"], "deno_pin")
    return result

def run_p1_contract_suite(deno, common, junit, paths, root, output, name):
    _p1cg_need(common == ["--no-lock", "--no-remote", "--no-npm", "--config", P1CG_CONFIG_PATH]
       and isinstance(paths, (list, tuple)) and paths and set(paths) <= set(P1CG_ROOTS),
       "suite_scope")
    return deno_test_command([deno, "test", *common, *P1CG_DENY_FLAGS, "--reporter=dot",
                    "--junit-path", str(junit), *paths], root=root, output=output, name=name)


# Separately pinned offline closure for cursor tests. Inserted into the existing
# snapshot runner only; does not alter the existing P1 graph policy.
CURCG_PREFIX = "tests/cursor_contract_review/"
CURCG_ROOTS = (CURCG_PREFIX + "combined_policy_catalog_runtime.test.ts",
               CURCG_PREFIX + "current_public_bound_cursor.test.ts")
CURCG_FIXTURE = CURCG_PREFIX + "combined_policy_catalog_runtime.original.ts"
CURCG_SHARED = "tests/edge/synthetic_api_contract.ts"
CURCG_TEST_FILES = frozenset((*CURCG_ROOTS, CURCG_FIXTURE))
CURCG_MANIFEST = "tests/cursor_contract_review_graph.20261114_pr75.current.json"
CURCG_FORMAT = "jungsi.cursor-contract-offline-closure/v1"
CURCG_META = "cursor_contract_offline_graph_verification"
CURCG_REGRESSION = "tests/test_cursor_contract_graph_guard.py"
CURCG_AGGREGATION = "tests/test_cursor_edge_unit_aggregation.py"
CURCG_ADAPTERS = frozenset("supabase/functions/_shared/" + p for p in (
    "combined_policy_catalog_runtime.ts", "current_public_bound_cursor.ts",
    "current_public_catalog.ts", "current_public_catalog_sql.ts", "current_public_key_index.ts",
    "current_public_key_storage.ts", "current_public_scoped_service.ts", "search_failure_diagnostic.ts"))
CURCG_NEW_SOURCES = frozenset(("supabase/functions/_shared/current_public_bound_cursor.ts",
    "supabase/functions/_shared/current_public_scoped_service.ts"))
CURCG_PROJECT_BINDING = "supabase/functions/_shared/jungsi/infrastructure/project_binding.ts"
CURCG_PROJECT_SHA = "a56602afe22e4e26ef608c297e83a18a895a374adcb440f83ababb5a568cf490"
CURCG_LAYERS = {
    "domain": {"domain"}, "application": {"application", "domain"},
    "infrastructure": {"application", "domain", "infrastructure"},
    "edge_adapter": {"application", "domain", "infrastructure", "edge_adapter"},
    "synthetic_fixture": {"application", "domain", "infrastructure", "edge_adapter", "synthetic_fixture"},
    "suite_test": {"application", "domain", "infrastructure", "edge_adapter", "synthetic_fixture"},
}

def _curcg_need(ok, reason):
    if not ok: raise EdgeFailure("cursor_contract_graph_" + reason)

def _curcg_layer(path):
    if path in CURCG_ROOTS: return "suite_test"
    if path in (CURCG_FIXTURE, CURCG_SHARED): return "synthetic_fixture"
    if path.startswith("supabase/functions/_shared/jungsi/"):
        layer = path.split("/")[4]
        _curcg_need(layer in {"application", "domain", "infrastructure"}, "layer")
        return layer
    if path in CURCG_ADAPTERS: return "edge_adapter"
    raise EdgeFailure("cursor_contract_graph_unapproved_source")

def _curcg_imports(path, raw):
    # The existing, pinned project-binding source contains the literal string
    # "require" as an SSL-mode name, not a JavaScript require call.
    _p1cg_check_literals(path, raw)
    if path == CURCG_PROJECT_BINDING:
        _curcg_need(_p1cg_sha(raw) == CURCG_PROJECT_SHA and raw.count(b'"require"') == 1,
                    "project_binding_pin")
        raw = raw.replace(b'"require"', b'"sslmode_require_literal"', 1)
    return _p1cg_check_literals(path, raw) + _p1cg_static_imports(raw)

def normalize_cursor_graph(info, root, before, entry):
    root = Path(root).resolve()
    _curcg_need(entry in CURCG_ROOTS and isinstance(info, dict) and
        set(info) == {"version", "roots", "modules", "redirects", "npmPackages"} and
        type(info.get("version")) is int and info["version"] == 1 and
        info.get("redirects") == {} and info.get("npmPackages") == {}, "schema_or_external")
    _curcg_need(isinstance(info.get("roots"), list) and len(info["roots"]) == 1 and
        local_url(info["roots"][0], root) == entry, "root")
    modules = info.get("modules")
    _curcg_need(isinstance(modules, list) and 1 <= len(modules) <= 512, "module_count")
    uri_to_path, modules_by_path, file_hashes, literals = {}, {}, {}, {}
    for module in modules:
        _curcg_need(isinstance(module, dict) and module.get("error") is None and
            module.get("kind") == "esm" and isinstance(module.get("local"), str), "module_kind")
        uri = module.get("specifier")
        _curcg_need(isinstance(uri, str) and uri not in uri_to_path, "duplicate_module")
        path = local_url(uri, root)
        _curcg_need(path not in modules_by_path and uri == (root / path).resolve().as_uri() and
            Path(module["local"]).resolve() == (root / path).resolve(), "module_alias")
        _curcg_need(P1CG_MEDIA.get(PurePosixPath(path).suffix) == module.get("mediaType"), "media_type")
        _curcg_layer(path)
        raw = _p1cg_snapshot_bytes(root, before, path)
        _curcg_need(type(module.get("size")) is int and module["size"] == len(raw), "module_size")
        literals[path] = _curcg_imports(path, raw)
        uri_to_path[uri] = path; modules_by_path[path] = module; file_hashes[path] = _p1cg_sha(raw)
    _curcg_need(entry in modules_by_path, "root_missing")
    edges = []
    for path, module in modules_by_path.items():
        deps = module.get("dependencies", [])
        _curcg_need(isinstance(deps, list) and set(literals[path]) <=
            {d.get("specifier") for d in deps if isinstance(d, dict)}, "ungraphed_import")
        for dep in deps:
            _curcg_need(isinstance(dep, dict) and dep.get("isDynamic", False) is False and
                dep.get("is_dynamic", False) is False, "dynamic_import")
            raw = dep.get("specifier")
            _curcg_need(isinstance(raw, str) and raw.startswith(("./", "../")) and
                not any(x in raw for x in ("\\", "?", "#", "%")), "specifier")
            targets = []
            for kind in ("code", "type"):
                resolved = dep.get(kind)
                if resolved is None: continue
                _curcg_need(isinstance(resolved, dict) and resolved.get("error") is None and
                    resolved.get("specifier") in uri_to_path, "unresolved")
                target = uri_to_path[resolved["specifier"]]
                _curcg_need((root / path).parent.joinpath(raw).resolve() == (root / target).resolve(),
                    "relative_resolution")
                _curcg_need(not (path in CURCG_ROOTS and target in CURCG_ROOTS), "cross_test")
                if target in (CURCG_FIXTURE, CURCG_SHARED):
                    _curcg_need(path == CURCG_ROOTS[0], "fixture_scope")
                _curcg_need(_curcg_layer(target) in CURCG_LAYERS[_curcg_layer(path)], "dependency_layer")
                targets.append([kind, target])
            _curcg_need(bool(targets), "unresolved")
            edges.append([path, raw, targets])
    _curcg_need(len(edges) <= 4096 and len({json.dumps(v, sort_keys=True) for v in edges}) == len(edges),
        "edge_inventory")
    reachable, pending = {entry}, [entry]
    while pending:
        source = pending.pop()
        for edge in edges:
            if edge[0] == source:
                for _, target in edge[2]:
                    if target not in reachable: reachable.add(target); pending.append(target)
    _curcg_need(reachable == set(file_hashes), "unreachable")
    return {"files": {p: file_hashes[p] for p in sorted(file_hashes)},
            "edges": sorted(edges, key=lambda v: json.dumps(v, sort_keys=True))}

def build_cursor_graph_manifest(root, before, graphs):
    root = Path(root).resolve()
    _curcg_need(set(graphs) == set(CURCG_ROOTS) and
        {p for p in before if p.startswith(CURCG_PREFIX)} == CURCG_TEST_FILES, "inventory")
    tests = {p: _p1cg_sha(_p1cg_snapshot_bytes(root, before, p)) for p in sorted(CURCG_TEST_FILES)}
    cfg = {"path": P1CG_CONFIG_PATH, "sha256": _p1cg_sha(_p1cg_snapshot_bytes(root, before, P1CG_CONFIG_PATH))}
    normalized = {p: normalize_cursor_graph(graphs[p], root, before, p) for p in CURCG_ROOTS}
    _curcg_need(CURCG_NEW_SOURCES <= set(normalized[CURCG_ROOTS[0]]["files"]) and
        "supabase/functions/_shared/current_public_bound_cursor.ts" in normalized[CURCG_ROOTS[1]]["files"], "required_sources")
    shared = {p for g in normalized.values() for p in g["files"] if p.startswith("tests/") and not p.startswith(CURCG_PREFIX)}
    _curcg_need(shared == {CURCG_SHARED}, "shared_fixture_coverage")
    return {"format": CURCG_FORMAT, "roots": list(CURCG_ROOTS), "test_files": tests, "config": cfg, "graphs": normalized}

def reference_cursor_graph_info(root, before, entry, model):
    root = Path(root).resolve()
    _curcg_need(entry in CURCG_ROOTS and isinstance(model, dict) and set(model) == {"files", "edges"}, "reference_schema")
    files, edges = model["files"], model["edges"]
    _curcg_need(isinstance(files, dict) and 1 <= len(files) <= 512 and entry in files and
        isinstance(edges, list) and len(edges) <= 4096, "reference_schema")
    nodes = {}
    for path, expected in files.items():
        _curcg_layer(path)
        raw = _p1cg_snapshot_bytes(root, before, path)
        _curcg_need(_p1cg_sha(raw) == expected and PurePosixPath(path).suffix in P1CG_MEDIA, "reference_pin")
        p = (root / path).resolve()
        nodes[path] = {"kind": "esm", "specifier": p.as_uri(), "local": str(p),
            "mediaType": P1CG_MEDIA[PurePosixPath(path).suffix], "size": len(raw), "dependencies": []}
    for edge in edges:
        _curcg_need(isinstance(edge, list) and len(edge) == 3 and edge[0] in nodes and
            isinstance(edge[1], str) and isinstance(edge[2], list), "reference_edge")
        dep = {"specifier": edge[1]}
        for pair in edge[2]:
            _curcg_need(isinstance(pair, list) and len(pair) == 2 and pair[0] in ("code", "type") and
                pair[0] not in dep and pair[1] in nodes, "reference_edge")
            dep[pair[0]] = {"specifier": (root / pair[1]).resolve().as_uri()}
        nodes[edge[0]]["dependencies"].append(dep)
    return {"version": 1, "roots": [(root / entry).resolve().as_uri()],
            "modules": list(nodes.values()), "redirects": {}, "npmPackages": {}}

def verify_cursor_graph_manifest(root, before, meta, graphs):
    root = Path(root).resolve()
    _curcg_need({p for p in before if p.startswith(CURCG_PREFIX)} == CURCG_TEST_FILES and
        set(graphs) == set(CURCG_ROOTS), "inventory")
    raw = _p1cg_snapshot_bytes(root, before, CURCG_MANIFEST)
    _curcg_need(isinstance(meta, dict) and _p1cg_sha(raw) == meta.get("manifest_sha256"), "manifest_pin")
    try: ref = json.loads(raw, object_pairs_hook=_p1cg_unique_pairs)
    except (UnicodeError, ValueError) as error: raise EdgeFailure("cursor_contract_graph_manifest_invalid") from error
    _curcg_need(isinstance(ref, dict) and set(ref) == {"format", "roots", "test_files", "config", "graphs"} and
        ref["format"] == CURCG_FORMAT and ref["roots"] == list(CURCG_ROOTS) and
        isinstance(ref["test_files"], dict) and set(ref["test_files"]) == CURCG_TEST_FILES and
        isinstance(ref["graphs"], dict) and set(ref["graphs"]) == set(CURCG_ROOTS), "manifest_schema")
    _curcg_need(ref["config"] == {"path": P1CG_CONFIG_PATH,
        "sha256": _p1cg_sha(_p1cg_snapshot_bytes(root, before, P1CG_CONFIG_PATH))}, "config_pin")
    for path in CURCG_TEST_FILES:
        _curcg_need(ref["test_files"][path] == _p1cg_sha(_p1cg_snapshot_bytes(root, before, path)), "test_pin")
    _curcg_need(CURCG_NEW_SOURCES <= set(ref["graphs"][CURCG_ROOTS[0]]["files"]) and
        "supabase/functions/_shared/current_public_bound_cursor.ts" in ref["graphs"][CURCG_ROOTS[1]]["files"], "required_sources")
    for entry in CURCG_ROOTS:
        _curcg_need(normalize_cursor_graph(graphs[entry], root, before, entry) == ref["graphs"][entry], "graph_changed")
    return {"status": "PASS_OFFLINE_PINNED_GRAPH_REVIEW_ONLY", "roots": len(CURCG_ROOTS),
            "files": len(CURCG_TEST_FILES), "production_ready": False}

def preflight_cursor_graph_manifest(root, before, meta):
    raw = _p1cg_snapshot_bytes(Path(root).resolve(), before, CURCG_MANIFEST)
    _curcg_need(isinstance(meta, dict) and _p1cg_sha(raw) == meta.get("manifest_sha256"), "manifest_pin")
    try: ref = json.loads(raw, object_pairs_hook=_p1cg_unique_pairs)
    except (UnicodeError, ValueError) as error: raise EdgeFailure("cursor_contract_graph_manifest_invalid") from error
    _curcg_need(isinstance(ref, dict) and isinstance(ref.get("graphs"), dict) and
        set(ref["graphs"]) == set(CURCG_ROOTS), "manifest_schema")
    graphs = {p: reference_cursor_graph_info(root, before, p, ref["graphs"][p]) for p in CURCG_ROOTS}
    return verify_cursor_graph_manifest(root, before, meta, graphs)

def cursor_contract_registration(root, before, spec):
    meta = spec.get(CURCG_META)
    if meta is None:
        _curcg_need(not any(p.startswith(CURCG_PREFIX) for p in before) and CURCG_MANIFEST not in before and
                    not CURCG_NEW_SOURCES.intersection(before), "unregistered_files")
        return None
    _curcg_need(isinstance(meta, dict) and set(meta) == {
        "format", "status", "manifest_path", "manifest_sha256", "regression_test", "aggregation_test",
        "cases", "production_ready"} and
        meta.get("format") == "jungsi.cursor-contract-offline-verification/v1" and
        meta.get("status") == "SOURCE_CANDIDATE_SYNTHETIC_ONLY_NOT_ACTIVATED" and
        meta.get("manifest_path") == CURCG_MANIFEST and meta.get("production_ready") is False, "registration")
    for field, path in (("regression_test", CURCG_REGRESSION), ("aggregation_test", CURCG_AGGREGATION)):
        item = meta.get(field)
        _curcg_need(isinstance(item, dict) and set(item) == {"path", "sha256"} and item.get("path") == path and
            item.get("sha256") == _p1cg_sha(_p1cg_snapshot_bytes(root, before, path)), "regression_binding")
    cases = meta.get("cases")
    _curcg_need(isinstance(cases, dict) and set(cases) == set(CURCG_ROOTS), "case_registration")
    for entry, count in zip(CURCG_ROOTS, (7, 15)):
        names = cases[entry]
        _curcg_need(isinstance(names, list) and len(names) == count and all(isinstance(n, str) and n for n in names) and
            len(set(names)) == count, "case_registration")
    cfg = spec.get("edge_harness", {})
    _curcg_need(cfg.get("unit_count") == 656 and len(cfg.get("tests", [])) == 44 and
        not set(CURCG_ROOTS) & set(cfg.get("tests", [])), "foundation_scope")
    return meta

def run_cursor_contract_guard(root, before, spec, deno, cfg, output, tool):
    meta = cursor_contract_registration(root, before, spec)
    if meta is None: return None
    _curcg_need(cfg.get("config") == P1CG_CONFIG_PATH, "config_path")
    config = json.loads(_p1cg_snapshot_bytes(root, before, P1CG_CONFIG_PATH), object_pairs_hook=_p1cg_unique_pairs)
    _curcg_need(isinstance(config, dict) and not any(config.get(k) for k in
        ("imports", "scopes", "extends", "importMap", "vendor", "nodeModulesDir")) and
        isinstance(config.get("compilerOptions", {}), dict) and not any(config.get("compilerOptions", {}).get(k)
        for k in ("types", "jsxImportSource")), "config_resolution")
    # Validate the pinned source and literal dependency closure before launching Deno.
    preflight_cursor_graph_manifest(root, before, meta)
    executable = Path(deno)
    _curcg_need(isinstance(tool, dict) and isinstance(tool.get("sha256"), str) and executable.is_file() and
        not any(p.is_symlink() or (hasattr(p, "is_junction") and p.is_junction()) for p in (executable, *executable.parents)) and
        _p1cg_sha(executable.read_bytes()) == tool["sha256"], "deno_pin")
    graphs = {}
    for i, entry in enumerate(CURCG_ROOTS):
        _curcg_need(_p1cg_sha(executable.read_bytes()) == tool["sha256"], "deno_pin")
        raw = command([deno, "info", "--json", "--no-lock", "--no-remote", "--no-npm", "--config", P1CG_CONFIG_PATH,
            "./" + entry], root=root, output=output, name="cursor_contract_graph_info_" + str(i))
        _curcg_need(len(raw) <= 8_388_608 and _p1cg_sha(executable.read_bytes()) == tool["sha256"], "deno_pin_or_graph_size")
        graphs[entry] = json.loads(raw, object_pairs_hook=_p1cg_unique_pairs)
    result = verify_cursor_graph_manifest(root, before, meta, graphs)
    paths = [*CURCG_ROOTS, CURCG_FIXTURE]
    common = ["--no-lock", "--no-remote", "--no-npm", "--config", P1CG_CONFIG_PATH]
    command([deno, "check", *common, *paths], root=root, output=output, name="cursor_contract_check")
    command([deno, "lint", "--config", P1CG_CONFIG_PATH, *paths], root=root, output=output, name="cursor_contract_lint")
    command([deno, "fmt", "--check", "--config", P1CG_CONFIG_PATH, *paths], root=root, output=output, name="cursor_contract_fmt")
    _curcg_need(_p1cg_sha(executable.read_bytes()) == tool["sha256"], "deno_pin")
    return result



def run_workspace(root,manifest,deno,python,output):
    root=Path(root).resolve();output=Path(output);output.mkdir(parents=True,exist_ok=False)
    before=verify_manifest(root,manifest);spec=json.loads((root/"docs/current/service_spec.json").read_bytes())
    scope=classify_sources(before,lambda p:(root/p).read_bytes(),spec)
    active=scope["foundation_active"]
    if not active:
        result=dict(successful=True,status="NOT_APPLICABLE_NO_FOUNDATION_SOURCE",edge_execution=False,coexisting_edge_sources=len(scope["coexisting_bound"]),coverage="DEV010_FOUNDATION")
        write_new(output/"edge_run_receipt.json",json_bytes(result));return result
    period_renewal_registration(spec,before)
    if not python or not Path(python).is_file():raise EdgeFailure("python_runtime_unavailable")
    cfg=spec["edge_harness"]
    parsed=check_workspace(root,manifest,deno,output/"contract")
    p1_graph_guard=run_p1_contract_offline_guard(root,before,spec,deno,cfg,output,parsed["tool"])
    cursor_graph_guard=run_cursor_contract_guard(root,before,spec,deno,cfg,output,parsed["tool"])
    paths=list(cfg["files"]);common=["--no-lock","--no-remote","--no-npm","--config",cfg["config"]]
    command([deno,"check",*common,*paths],root=root,output=output,name="check")
    command([deno,"lint","--config",cfg["config"],*paths],root=root,output=output,name="lint")
    command([deno,"fmt","--check","--config",cfg["config"],*paths],root=root,output=output,name="fmt")
    from check_project_consistency import (recovery_input_registration,verify_recovery_test_partition,
      auth_503_runtime_registration, RECOVERY_SAMEFILE_NAMES,RECOVERY_STANDALONE_NAMES,
      RECOVERY_BASELINE_NAMES,RECOVERY_SAMEFILE_PATH)
    recovery,recovery_errors=recovery_input_registration(spec,before)
    if recovery_errors:raise EdgeFailure("incident_recovery_source_or_test_binding_invalid")
    auth_runtime,auth_runtime_errors=auth_503_runtime_registration(spec,before)
    if auth_runtime_errors:raise EdgeFailure("auth_503_runtime_registration_invalid")
    if recovery is not None:verify_recovery_test_partition((root/RECOVERY_SAMEFILE_PATH).read_bytes())
    junit=output.resolve()/"deno.junit.xml"
    if junit.exists():raise EdgeFailure("deno_test_output_exists")
    recovery_unit=None
    if recovery is None:
        deno_test_command([deno,"test",*common,"--reporter=dot","--junit-path",str(junit),*cfg["tests"]],root=root,output=output,name="unit")
        unit,auth_503_runtime_unit=split_auth_runtime_foundation(junit,cfg["unit_count"],auth_runtime)
    else:
        # Run every other foundation module without a filter; select the old score cases by exact positive names.
        rest=[path for path in cfg["tests"] if path!=RECOVERY_SAMEFILE_PATH]
        deno_test_command([deno,"test",*common,"--reporter=dot","--junit-path",str(junit),*rest],root=root,output=output,name="unit")
        other,auth_503_runtime_unit=split_auth_runtime_foundation(junit,625,auth_runtime)
        require_unique_junit_identities(junit)
        require_no_recovery_cases(junit,RECOVERY_SAMEFILE_NAMES)
        base_junit=output.resolve()/"recovery_baseline_score.junit.xml"
        deno_test_command([deno,"test",*common,"--filter",recovery_test_filter(RECOVERY_BASELINE_NAMES),
          "--reporter=dot","--junit-path",str(base_junit),RECOVERY_SAMEFILE_PATH],
          root=root,output=output,name="recovery_baseline_score")
        score=parse_recovery_partition_junit(base_junit,RECOVERY_BASELINE_NAMES,RECOVERY_SAMEFILE_NAMES,RECOVERY_SAMEFILE_PATH)
        require_unique_junit_identities(base_junit)
        require_disjoint_junit_identities(junit,base_junit)
        unit=dict(tests_run=other["tests_run"]+score["tests_run"],failures=0,errors=0,skipped=0)
        if unit["tests_run"]!=cfg["unit_count"]:raise EdgeFailure("foundation_split_count_invalid")
        added_junit=output.resolve()/"recovery_samefile.junit.xml"
        deno_test_command([deno,"test",*common,"--filter",recovery_test_filter(RECOVERY_SAMEFILE_NAMES),
          "--reporter=dot","--junit-path",str(added_junit),RECOVERY_SAMEFILE_PATH],
          root=root,output=output,name="recovery_samefile")
        same=parse_recovery_partition_junit(added_junit,RECOVERY_SAMEFILE_NAMES,RECOVERY_BASELINE_NAMES,RECOVERY_SAMEFILE_PATH)
        standalone_junit=output.resolve()/"recovery_standalone.junit.xml"
        deno_test_command([deno,"test",*common,"--reporter=dot","--junit-path",str(standalone_junit),
          *recovery["test_paths"]],root=root,output=output,name="recovery_standalone")
        standalone=parse_junit(standalone_junit,33);require_exact_junit_names(standalone_junit,RECOVERY_STANDALONE_NAMES)
        recovery_unit=dict(tests_run=same["tests_run"]+standalone["tests_run"],failures=0,errors=0,skipped=0,
          same_file_tests=same["tests_run"],standalone_tests=standalone["tests_run"],
          baseline_score_filtered_out=score["filtered_out"],same_file_filtered_out=same["filtered_out"],
          baseline_foundation_count=656,baseline_score_tests=31,coverage="INCIDENT_RECOVERY_V5_SYNTHETIC",
          source_bindings=recovery["source_bindings"],native_acceptance="NOT_VERIFIED_BY_SOURCE_SUITE",
          activation_status="NOT_RUN",operating_writes=0)
    cursor_unit = None
    if cursor_graph_guard is not None:
        cursor_meta = cursor_contract_registration(root, before, spec)
        cursor_junit = output.resolve() / "cursor_contract_review.junit.xml"
        deno_test_command([deno, "test", *common, *P1CG_DENY_FLAGS, "--reporter=dot",
                 "--junit-path", str(cursor_junit), *CURCG_ROOTS],
                root=root, output=output, name="cursor_contract_review_unit")
        counted = parse_junit(cursor_junit, 22)
        require_auxiliary_junit_identities(cursor_junit, cursor_meta["cases"])
        cursor_unit = dict(**counted, coverage="CURSOR_SCOPE_CONTINUITY_SYNTHETIC",
            graph_manifest_sha256=cursor_meta["manifest_sha256"], baseline_foundation_count=656,
            native_acceptance="NOT_VERIFIED_BY_SOURCE_SUITE", activation_status="NOT_RUN",
            actual_DB="NOT_RUN", deployment="NOT_RUN", operating_writes=0)
    # Separate auth cancellation suite: do not change the foundation count or
    # imply native transport or production acceptance from synthetic results.
    from check_project_consistency import auth_503_registration
    auth_503, auth_503_errors = auth_503_registration(spec, before)
    if auth_503_errors: raise EdgeFailure("auth_503_registration_invalid")
    auth_503_unit = None
    if auth_503 is not None:
        auth_junit = output.resolve() / "auth_503_synthetic.junit.xml"
        deno_test_command([deno, "test", *common, *P1CG_DENY_FLAGS, "--reporter=dot",
                 "--junit-path", str(auth_junit), *auth_503["test_paths"]],
                root=root, output=output, name="auth_503_unit")
        counted = parse_junit(auth_junit, auth_503["test_count"])
        require_auxiliary_junit_identities(auth_junit, auth_503["case_names_by_path"])
        require_no_auth_runtime_overlap(auth_junit,auth_runtime)
        auth_503_unit = dict(**counted, coverage="AUTH_503_CANCELLATION_SYNTHETIC",
            source_bindings=auth_503["source_bindings"], baseline_foundation_count=656,
            native_acceptance="NOT_VERIFIED_BY_SOURCE_SUITE", activation_status="NOT_RUN",
            operating_writes=0)
    p1_review = p1_review_registration(spec, before)
    p1_review_unit = None
    if p1_review is not None:
        p1_junit = output.resolve() / "p1_recruitment_score_review.junit.xml"
        run_p1_contract_suite(deno, common, p1_junit, p1_review["test_paths"], root, output, "p1_recruitment_score_review_unit")
        counted = parse_junit(p1_junit, p1_review["test_count"])
        require_auxiliary_junit_identities(p1_junit, p1_review["case_names_by_path"])
        p1_review_unit = dict(**counted, coverage="P1_RECRUITMENT_SCORE_REVIEW_SYNTHETIC",
            source_bindings=p1_review["source_bindings"], test_bindings=p1_review["test_bindings"],
            regression_binding=p1_review["regression_binding"], baseline_foundation_count=656, native_acceptance="NOT_VERIFIED_BY_SOURCE_SUITE",
            activation_status="NOT_RUN", operating_writes=0)
    p1_selection = p1_selection_bridge_registration(spec, before)
    p1_selection_unit = None
    if p1_selection is not None:
        selection_junit = output.resolve() / "p1_selection_bridge_review.junit.xml"
        run_p1_contract_suite(deno, common, selection_junit, [p1_selection["test_path"]], root, output, "p1_selection_bridge_review_unit")
        counted = parse_junit(selection_junit, p1_selection["test_count"])
        require_auxiliary_junit_identities(selection_junit, p1_selection["case_names_by_path"])
        p1_selection_unit = dict(**counted, coverage="P1_SELECTION_BRIDGE_REVIEW_SYNTHETIC",
            source_bindings=p1_selection["source_bindings"], test_bindings=p1_selection["test_bindings"],
            baseline_foundation_count=656, native_acceptance="NOT_VERIFIED_BY_SOURCE_SUITE",
            actual_DB="NOT_RUN", activation_status="NOT_RUN", operating_writes=0)
    service_end_check = service_end_synthetic_registration(spec, before)
    service_end_unit = None
    if service_end_check is not None:
        end_junit = output.resolve() / "service_end_score_cutoff_synthetic.junit.xml"
        run_p1_contract_suite(deno, common, end_junit, [service_end_check["test_path"]], root, output, "service_end_score_cutoff_unit")
        counted = parse_junit(end_junit, service_end_check["test_count"])
        require_auxiliary_junit_identities(end_junit, service_end_check["case_names_by_path"])
        service_end_unit = dict(**counted, coverage="SERVICE_END_SCORE_CUTOFF_SYNTHETIC",
            source_bindings=service_end_check["source_bindings"], test_binding=service_end_check["test_binding"],
            baseline_foundation_count=656, native_acceptance="NOT_VERIFIED_BY_SOURCE_SUITE",
            actual_DB="NOT_RUN", sql_010_application="NOT_RUN", activation_status="NOT_RUN", operating_writes=0)
    owner_registration=owner_review_registration(spec,before);owner_unit=None
    if owner_registration is not None:
        owner_junit=output.resolve()/"owner_review.junit.xml"
        deno_test_command([deno,"test","--no-config","--no-lock","--no-remote","--no-npm",
          "--reporter=dot","--junit-path",str(owner_junit),owner_registration['test_path']],
          root=root,output=output,name="owner_review_unit")
        owner_format=owner_registration.get("format")
        if owner_format=="jungsi.owner-current-review-v4-synthetic-verification/v1":
            require_exact_junit_names(owner_junit,OWNER_V4_CASE_NAMES)
        elif owner_format=="jungsi.owner-v3-current-source-synthetic/v1":
            require_exact_junit_names(owner_junit,OWNER_V3_REBOUND_CASE_NAMES)
        owner_coverage=('OWNER_CURRENT_REVIEW_V4_SYNTHETIC' if owner_format=="jungsi.owner-current-review-v4-synthetic-verification/v1"
            else 'OWNER_CURRENT_REVIEW_V3_REBOUND_SYNTHETIC' if owner_format=="jungsi.owner-v3-current-source-synthetic/v1"
            else 'OWNER_CURRENT_REVIEW_V3_SYNTHETIC')
        owner_unit=dict(**parse_junit(owner_junit,owner_registration['test_count']),
          coverage=owner_coverage,source_bindings=owner_registration['source_bindings'],actual_DB='NOT_RUN',deployment='NOT_RUN')
        if owner_format in ("jungsi.owner-current-review-v4-synthetic-verification/v1","jungsi.owner-v3-current-source-synthetic/v1"):
            owner_unit["historical_v3_verification_sha256"]=OWNER_V3_HISTORY_SHA256
    public_registration=current_public_registration(spec,before);public_unit=None
    if public_registration is not None:
        public_paths=[b['path']for b in public_registration['source_bindings']]
        command([deno,'check',*common,*public_paths],root=root,output=output,name='current_public_check')
        command([deno,'lint','--config',cfg['config'],*public_paths],root=root,output=output,name='current_public_lint')
        command([deno,'fmt','--check','--config',cfg['config'],*public_paths],root=root,output=output,name='current_public_fmt')
        public_junit=output.resolve()/'current_public.junit.xml'
        deno_test_command([deno,'test',*common,'--reporter=dot','--junit-path',str(public_junit),
          *public_registration['test_paths']],root=root,output=output,name='current_public_unit')
        attendance_path = "supabase/functions/_shared/score_map_attendance_test.ts"
        attendance_expected = set(['approved cached score stays available to its owner only', 'cached reference cannot bypass required self reported attendance', 'historical pending never masks newly ready score and is not modified', 'reference results count toward unchanged per request calculation limit', 'reference without attendance requirement remains visible after verification', 'transient pending is not inserted and can become approved ready'])
        attendance_actual = [case.get("name") for case in ET.fromstring(public_junit.read_bytes()).iter("testcase")
            if (case.get("classname") or "").replace(chr(92), "/").removeprefix("./") == attendance_path]
        if len(attendance_actual) != 6 or len(set(attendance_actual)) != 6 or set(attendance_actual) != attendance_expected:
            raise EdgeFailure("score_map_attendance_junit_identity_invalid")
        preview_path = "supabase/functions/_shared/current_public_catalog_test.ts"
        preview_expected = set(['HTTP budget or canceled admission failures are not turned into successful searches', 'HTTP search returns existing rows with score unavailable without any score map access', 'an already aborted request never starts optional score work', 'disabled score map preserves search and does not touch a missing 011 table'])
        preview_actual = [case.get("name") for case in ET.fromstring(public_junit.read_bytes()).iter("testcase")
            if (case.get("classname") or "").replace(chr(92), "/").removeprefix("./") == preview_path
            and case.get("name") in preview_expected]
        if len(preview_actual) != 4 or len(set(preview_actual)) != 4 or set(preview_actual) != preview_expected:
            raise EdgeFailure("score_map_preview_junit_identity_invalid")
        public_unit=dict(**parse_junit(public_junit,public_registration['test_count']),
          coverage='CURRENT_PUBLIC_PROVIDER_CANDIDATE_SYNTHETIC',
          source_bindings=public_registration['source_bindings'],
          actual_DB='NOT_VERIFIED_BY_SOURCE_SUITE',publication='NOT_APPROVED_BY_SOURCE_SUITE',deployment='NOT_RUN')
    own_2027=current_public_own_2027_registration(spec,before)
    if own_2027 is not None:
        if public_unit is None:raise EdgeFailure('own_2027_requires_current_public_provider')
        own_paths=['supabase/functions/_shared/current_public_r27_selection.ts',own_2027['test_path'],
          'supabase/functions/_shared/current_public_r27_bounded.ts',own_2027['bounded_test_path']]
        command([deno,'check',*common,*own_paths],root=root,output=output,name='own_2027_batch_check')
        command([deno,'lint','--config',cfg['config'],*own_paths],root=root,output=output,name='own_2027_batch_lint')
        command([deno,'fmt','--check','--config',cfg['config'],*own_paths],root=root,output=output,name='own_2027_batch_fmt')
        own_junit=output.resolve()/'own_2027_batch.junit.xml'
        deno_test_command([deno,'test',*common,'--reporter=dot','--junit-path',str(own_junit),own_2027['test_path'],own_2027['bounded_test_path']],
          root=root,output=output,name='own_2027_batch_unit')
        own_unit=dict(**parse_junit(own_junit,own_2027['test_count']+own_2027['bounded_test_count']),
          coverage='OWN_2027_BATCH_SYNTHETIC',source_bindings=own_2027['source_bindings'],
          actual_DB='NOT_RUN',publication='NOT_RUN',deployment='NOT_RUN')
        public_unit['baseline_tests_run']=public_unit['tests_run']
        public_unit['own_2027_batch']=own_unit
        public_unit['tests_run']+=own_unit['tests_run']
    snapshot_batch=current_public_snapshot_batch_registration(spec,before)
    if snapshot_batch is not None:
        if public_unit is None:raise EdgeFailure('snapshot_batch_requires_current_public_provider')
        snapshot_paths=['supabase/functions/_shared/current_public_p1_snapshot_batch.ts',snapshot_batch['test_path']]
        command([deno,'check',*common,*snapshot_paths],root=root,output=output,name='snapshot_batch_check')
        command([deno,'lint','--config',cfg['config'],*snapshot_paths],root=root,output=output,name='snapshot_batch_lint')
        command([deno,'fmt','--check','--config',cfg['config'],*snapshot_paths],root=root,output=output,name='snapshot_batch_fmt')
        snapshot_junit=output.resolve()/'snapshot_batch.junit.xml'
        deno_test_command([deno,'test',*common,'--reporter=dot','--junit-path',str(snapshot_junit),snapshot_batch['test_path']],
          root=root,output=output,name='snapshot_batch_unit')
        batch_unit=dict(**parse_junit(snapshot_junit,snapshot_batch['test_count']),
          coverage='SNAPSHOT_BATCH_SYNTHETIC_NOT_ACTIVATED',source_bindings=snapshot_batch['source_bindings'],
          actual_DB='NOT_RUN',publication='NOT_RUN',deployment='NOT_RUN')
        public_unit['snapshot_batch']=batch_unit
        public_unit['tests_run']+=batch_unit['tests_run']
    current_page=current_page_projection_registration(spec,before)
    if current_page is not None:
        if public_unit is None:raise EdgeFailure("current_page_requires_current_public_provider")
        current_page_paths=["supabase/functions/_shared/jungsi/application/history_current_page.ts",current_page["test_path"]]
        command([deno,"check",*common,*current_page_paths],root=root,output=output,name="current_page_check")
        command([deno,"lint","--config",cfg["config"],*current_page_paths],root=root,output=output,name="current_page_lint")
        command([deno,"fmt","--check","--config",cfg["config"],*current_page_paths],root=root,output=output,name="current_page_fmt")
        current_page_junit=output.resolve()/"current_page_projection.junit.xml"
        deno_test_command([deno,"test",*common,"--deny-read","--deny-write","--deny-net","--deny-env","--deny-run","--deny-sys","--deny-ffi",
          "--reporter=dot","--junit-path",str(current_page_junit),current_page["test_path"]],
          root=root,output=output,name="current_page_unit")
        current_page_unit=dict(**parse_junit(current_page_junit,current_page["test_count"]),
          coverage="CURRENT_PAGE_PROJECTION_SYNTHETIC_NOT_ACTIVATED",source_bindings=current_page["source_bindings"],
          actual_DB="NOT_RUN",publication="NOT_RUN",deployment="NOT_RUN")
        public_unit["current_page_projection"]=current_page_unit
        public_unit["tests_run"]+=current_page_unit["tests_run"]
        guide_paths=["supabase/functions/_shared/current_2027_guide_search_review_only.ts","supabase/functions/_shared/current_2027_guide_direct_review_only.ts","supabase/functions/_shared/p1_local_scope_matcher_review_only.ts","supabase/functions/_shared/p1_verified_scope_review_adapter_review_only.ts","supabase/functions/_shared/jungsi/application/current_guide_scope_issuer.campus.review-only.ts","supabase/functions/_shared/jungsi/application/scope_adapter_synthetic_fixture.ts",*current_page["guide_test_paths"]]
        command([deno,"check",*common,*guide_paths],root=root,output=output,name="current_guide_check")
        command([deno,"lint","--config",cfg["config"],*guide_paths],root=root,output=output,name="current_guide_lint")
        command([deno,"fmt","--check","--config",cfg["config"],*guide_paths],root=root,output=output,name="current_guide_fmt")
        guide_junit=output.resolve()/"current_guide_adapter.junit.xml"
        deno_test_command([deno,"test",*common,"--deny-read","--deny-write","--deny-net","--deny-env","--deny-run","--deny-sys","--deny-ffi",
          "--reporter=dot","--junit-path",str(guide_junit),*current_page["guide_test_paths"]],root=root,output=output,name="current_guide_unit")
        guide_unit=dict(**parse_junit(guide_junit,current_page["guide_test_count"]),
          coverage="CURRENT_GUIDE_ADAPTER_SYNTHETIC_NOT_ACTIVATED",actual_DB="NOT_RUN",publication="NOT_RUN",deployment="NOT_RUN")
        public_unit["current_guide_adapter"]=guide_unit
        public_unit["tests_run"]+=guide_unit["tests_run"]
    current_page_route=current_page_route_registration(spec,before)
    if current_page_route is not None:
        if public_unit is None:raise EdgeFailure("current_page_route_requires_current_public_provider")
        route_paths=current_page_route["test_paths"]
        command([deno,"check",*common,*route_paths],root=root,output=output,name="current_page_route_check")
        command([deno,"lint","--config",cfg["config"],*route_paths],root=root,output=output,name="current_page_route_lint")
        command([deno,"fmt","--check","--config",cfg["config"],*route_paths],root=root,output=output,name="current_page_route_fmt")
        route_junit=output.resolve()/"current_page_route.junit.xml"
        schema_path=str((root/current_page_route["schema_path"]).resolve())
        deno_test_command([deno,"test",*common,"--allow-read="+schema_path,"--deny-write","--deny-net","--deny-env","--deny-run","--deny-sys","--deny-ffi",
          "--reporter=dot","--junit-path",str(route_junit),*route_paths],root=root,output=output,name="current_page_route_unit")
        route_unit=dict(**parse_junit(route_junit,current_page_route["test_count"]),
          coverage="CURRENT_PAGE_ROUTE_SYNTHETIC_NOT_ACTIVATED",source_bindings=current_page_route["source_bindings"],
          actual_DB="NOT_RUN",publication="NOT_RUN",deployment="NOT_RUN")
        public_unit["current_page_route"]=route_unit
        public_unit["tests_run"]+=route_unit["tests_run"]
    whole_population_unit=None
    whole_population=whole_population_registration(spec,before)
    if whole_population is not None:
        whole_paths=[b['path']for b in whole_population['source_bindings']]
        command([deno,'check',*common,*whole_paths],root=root,output=output,name='whole_population_check')
        command([deno,'lint','--config',cfg['config'],*whole_paths],root=root,output=output,name='whole_population_lint')
        command([deno,'fmt','--check','--config',cfg['config'],*whole_paths],root=root,output=output,name='whole_population_fmt')
        whole_junit=output.resolve()/'whole_population_unit.junit.xml'
        deno_test_command([deno,'test',*common,'--reporter=dot','--junit-path',str(whole_junit),whole_population['test_path']],root=root,output=output,name='whole_population_unit')
        whole_population_unit=dict(**parse_junit(whole_junit,whole_population['test_count']),
          coverage='STRICT_WHOLE_POPULATION_V2_SYNTHETIC',source_bindings=whole_population['source_bindings'],
          native_acceptance='NOT_VERIFIED_BY_SOURCE_SUITE',activation_status='NOT_RUN')
    read_view_unit=None
    read_view=read_view_registration(spec,before)
    if read_view is not None:
        read_view_junit=output.resolve()/'read_view_extension.junit.xml'
        deno_test_command([deno,'test',*common,'--reporter=dot','--junit-path',str(read_view_junit),
          *read_view['test_paths']],root=root,output=output,name='read_view_extension_unit')
        read_view_unit=dict(**parse_junit(read_view_junit,read_view['test_count']),
          coverage='READ_VIEW_EXTENSION_SYNTHETIC',source_bindings=read_view['source_bindings'],
          baseline_foundation_count=656,native_acceptance='NOT_VERIFIED_BY_SOURCE_SUITE',
          activation_status='NOT_RUN',operating_writes=0)
    from check_project_consistency import service_aux_registration
    auxiliary, auxiliary_errors = service_aux_registration(spec, before)
    if auxiliary_errors: raise EdgeFailure("service_auxiliary_registration_invalid")
    service_candidate_aux_unit = None
    if auxiliary is not None:
        aux_junit = output.resolve() / "service_candidate_aux.junit.xml"
        deno_test_command([deno, "test", *common, "--reporter=dot", "--junit-path", str(aux_junit),
                 *auxiliary["test_paths"]], root=root, output=output, name="service_candidate_aux_unit")
        counted = parse_junit(aux_junit, auxiliary["test_count"])
        require_auxiliary_junit_identities(aux_junit, auxiliary["case_names_by_path"])
        service_candidate_aux_unit = dict(**counted, coverage="SERVICE_AUXILIARY_SYNTHETIC",
            source_bindings=auxiliary["source_bindings"], baseline_foundation_count=656,
            native_acceptance="NOT_VERIFIED_BY_SOURCE_SUITE", activation_status="NOT_RUN", operating_writes=0)
    from check_project_consistency import service_staged_registration
    staged, staged_errors = service_staged_registration(spec, before)
    if staged_errors: raise EdgeFailure("service_staged_registration_invalid")
    service_staged_aux_unit = None
    if staged is not None:
        staged_junit = output.resolve() / "service_staged_aux.junit.xml"
        deno_test_command([deno, "test", *common, "--reporter=dot", "--junit-path", str(staged_junit),
                 *staged["test_paths"]], root=root, output=output, name="service_staged_aux_unit")
        counted = parse_junit(staged_junit, staged["test_count"])
        require_auxiliary_junit_identities(staged_junit, staged["case_names_by_path"])
        service_staged_aux_unit = dict(**counted, coverage="SERVICE_STAGED_P1_WAITLIST_SYNTHETIC",
            source_bindings=staged["source_bindings"], baseline_foundation_count=656,
            native_acceptance="NOT_VERIFIED_BY_SOURCE_SUITE", activation_status="NOT_RUN", operating_writes=0)
    from check_project_consistency import service_wildcard_registration
    wildcard, wildcard_errors = service_wildcard_registration(spec, before)
    if wildcard_errors: raise EdgeFailure("service_wildcard_registration_invalid")
    service_wildcard_unit = None
    if wildcard is not None:
        wildcard_junit = output.resolve() / "service_wildcard.junit.xml"
        deno_test_command([deno, "test", *common, "--reporter=dot", "--junit-path", str(wildcard_junit),
                 *wildcard["test_paths"]], root=root, output=output, name="service_wildcard_unit")
        counted = parse_junit(wildcard_junit, wildcard["test_count"])
        require_auxiliary_junit_identities(wildcard_junit, wildcard["case_names_by_path"])
        service_wildcard_unit = dict(**counted, coverage="WILDCARD_AND_REPORT_SAFETY_SYNTHETIC",
            source_bindings=wildcard["source_bindings"], baseline_foundation_count=656,
            native_acceptance="NOT_VERIFIED_BY_SOURCE_SUITE", activation_status="NOT_RUN", operating_writes=0)
    from check_project_consistency import reference_db_registration
    reference_db, reference_db_errors = reference_db_registration(spec, before)
    if reference_db_errors: raise EdgeFailure("reference_db_registration_invalid")
    reference_db_unit = None
    if reference_db is not None:
        reference_db_junit = output.resolve() / "reference_db.junit.xml"
        deno_test_command([deno, "test", *common, "--reporter=dot", "--junit-path", str(reference_db_junit),
                 *reference_db["test_paths"]], root=root, output=output, name="reference_db_unit")
        counted = parse_junit(reference_db_junit, reference_db["test_count"])
        require_auxiliary_junit_identities(reference_db_junit, reference_db["case_names_by_path"])
        reference_db_unit = dict(**counted, coverage="REFERENCE_DB_REPORT_SYNTHETIC",
            source_bindings=reference_db["source_bindings"], baseline_foundation_count=656,
            native_acceptance="NOT_VERIFIED_BY_SOURCE_SUITE", activation_status="NOT_RUN", operating_writes=0)
    member_shortlist_unit=None
    member=member_shortlist_suite_registration(spec,before)
    if member is not None:
        member_junit=output.resolve()/'member_shortlist.junit.xml'
        deno_test_command([deno,'test',*common,'--reporter=dot','--junit-path',str(member_junit),
          *member['verification']['test_paths']],root=root,output=output,name='member_shortlist_unit')
        member_shortlist_unit=dict(**parse_junit(member_junit,member['verification']['test_count']),
          coverage='MEMBER_JSON_SHORTLIST_SYNTHETIC',source_bindings=member['verification']['source_bindings'],
          baseline_foundation_count=656,native_acceptance='NOT_VERIFIED_BY_SOURCE_SUITE',activation_status='NOT_RUN',operating_writes=0)
    professional_unit=None
    school_reference_unit=None
    school_reference=school_reference_registration(spec,before)
    if school_reference is not None:
        reference_junit=output.resolve()/'school_reference.junit.xml'
        deno_test_command([deno,'test',*common,'--reporter=dot','--junit-path',str(reference_junit),
          *school_reference['test_paths']],root=root,output=output,name='school_reference_unit')
        school_reference_unit=dict(**parse_junit(reference_junit,school_reference['test_count']),
          coverage='SCOPED_SCHOOL_REFERENCE_SYNTHETIC',source_bindings=school_reference['source_bindings'],
          baseline_foundation_count=656,native_acceptance='NOT_VERIFIED_BY_SOURCE_SUITE',activation_status='NOT_RUN',operating_writes=0)
    from check_project_consistency import university_cancellation_test_registration
    cancellation,cancellation_errors=university_cancellation_test_registration(spec,before)
    if cancellation_errors:raise EdgeFailure('university_cancellation_source_or_test_binding_invalid')
    university_cancellation_unit=None
    if cancellation is not None:
        cancellation_junit=output.resolve()/'university_cancellation.junit.xml'
        deno_test_command([deno,'test',*common,'--reporter=dot','--junit-path',str(cancellation_junit),
          *cancellation['test_paths']],root=root,output=output,name='university_cancellation_unit')
        counted=parse_junit(cancellation_junit,cancellation['test_count'])
        require_auxiliary_junit_identities(cancellation_junit,cancellation['case_names_by_path'])
        university_cancellation_unit=dict(**counted,coverage='UNIVERSITY_CANCELLATION_SYNTHETIC',
          source_bindings=cancellation['source_bindings'],baseline_foundation_count=656,
          native_acceptance='NOT_VERIFIED_BY_SOURCE_SUITE',activation_status='NOT_RUN',operating_writes=0)
    try:
        safety = reference_safety_registration(spec,before,lambda path:(root/path).read_bytes())
    except (ValueError,KeyError,TypeError,OSError) as error:
        raise EdgeFailure("reference_safety_registration_invalid") from error
    reference_safety_unit=None
    if safety is not None:
        safety_junit=output.resolve()/"reference_safety.junit.xml"
        deno_test_command([deno,"test",*common,"--deny-read","--deny-write","--deny-net",
          "--deny-env","--deny-run","--deny-sys","--deny-ffi","--reporter=dot",
          "--junit-path",str(safety_junit),*safety["test_paths"]],
          root=root,output=output,name="reference_safety_unit")
        counted=parse_junit(safety_junit,safety["test_count"])
        require_auxiliary_junit_identities(safety_junit,safety["case_names_by_path"])
        reference_safety_unit=dict(**counted,coverage="REFERENCE_SAFETY_SYNTHETIC",
          source_bindings=safety["source_bindings"],manifest_sha256=safety["manifest_sha256"],
          baseline_foundation_count=656,native_acceptance="NOT_VERIFIED_BY_SOURCE_SUITE",
          activation_status="NOT_RUN",operating_writes=0)
    professional=professional_suite_registration(spec,before)
    if professional is not None:
        professional_paths=[binding['path']for binding in professional['source_bindings']]
        verification=professional['verification']
        core_paths=[path for path in professional_paths if path!=professional['entrypoint']]
        command([deno,'check',*common,*core_paths],root=root,output=output,name='professional_check')
        native_entrypoint=check_professional_native_entrypoint(root,before,deno,cfg['config'],output,professional['entrypoint'])
        command([deno,'lint','--config',cfg['config'],*professional_paths],root=root,output=output,name='professional_lint')
        command([deno,'fmt','--check','--config',cfg['config'],*professional_paths],root=root,output=output,name='professional_fmt')
        professional_junit=output.resolve()/'professional.junit.xml'
        deno_test_command([deno,'test',*common,'--reporter=dot','--junit-path',str(professional_junit),
            *verification['test_paths']],root=root,output=output,name='professional_unit')
        counted=parse_junit(professional_junit,verification['test_count'])
        require_professional_operation_tests(ET.fromstring(professional_junit.read_bytes()),verification['operation_test_names'])
        professional_unit=dict(**counted,coverage='PROFESSIONAL_SEPARATE_TENANT_SYNTHETIC',native_entrypoint_verification=native_entrypoint,
            source_bindings=professional['source_bindings'],migration_bindings=professional['migrations'],
            registered_operation_ids=sorted(professional['operation_bindings']),registered_operation_count=21,
            existing_individual_operation_count=len(spec['operations']),baseline_foundation_count=656,
            actual_DB='NOT_VERIFIED_BY_SOURCE_SUITE',native_acceptance='NOT_VERIFIED_BY_SOURCE_SUITE',
            activation_status='NOT_RUN',operating_writes=0)
    references=cfg["python_reference"]
    reference=dict(format="jungsi.edge-python-reference/v1",basis="selected_snapshot",
      files=references["files"],source_files={p:before[p] for p in [*paths,cfg["config"],cfg["oracle"]]},
      expected_cases=cfg["oracle_count"],cases_sha256=references["cases_sha256"])
    write_new(output/"reference_manifest.json",json_bytes(reference))
    oracle=output/"oracle"
    command([python,"-B","-X","utf8",str(root/cfg["oracle"]),"--deno",deno,
      "--reference-manifest",str((output/"reference_manifest.json").resolve()),"--output-root",str(oracle.resolve())],root=root,output=output,name="oracle",timeout=60)
    receipt_path=oracle/"comparison_receipt.v1.json"
    if not receipt_path.is_file():raise EdgeFailure("oracle_result_missing")
    receipt=json.loads(receipt_path.read_bytes());require_oracle(receipt,cfg["oracle_count"],references["cases_sha256"])
    if verify_manifest(root,manifest)!=before:raise EdgeFailure("snapshot_changed_during_edge_run")
    result=dict(format="jungsi.edge-suite-result/v1",successful=True,status="PASS",edge_execution=True,
      coverage="DEV010_FOUNDATION",coexisting_edge_sources=len(scope["coexisting_bound"]),unit=unit,oracle=dict(case_count=receipt["case_count"],mismatch_count=receipt["mismatch_count"]),
      source_manifest_sha256=digest(json_bytes(manifest)),contract_receipt_sha256=digest((output/"contract/edge_contract_receipt.json").read_bytes()),
      oracle_receipt_sha256=digest(receipt_path.read_bytes()),tool=parsed["tool"],production_ready=False,operating_writes=0,**operation_registration(spec))
    if p1_graph_guard is not None:result['p1_contract_offline_graph_guard']=p1_graph_guard
    if cursor_graph_guard is not None:result['cursor_contract_offline_graph_guard']=cursor_graph_guard
    if cursor_unit is not None:result['cursor_contract_review_unit']=cursor_unit
    if auth_503_unit is not None:result['auth_503_unit']=auth_503_unit
    if auth_503_runtime_unit is not None:result['auth_503_runtime_unit']=auth_503_runtime_unit
    if p1_review_unit is not None:result['p1_recruitment_score_review_unit']=p1_review_unit
    if p1_selection_unit is not None:result['p1_selection_bridge_review_unit']=p1_selection_unit
    if service_end_unit is not None:result['service_end_score_cutoff_unit']=service_end_unit
    if recovery_unit is not None:result['incident_recovery_unit']=recovery_unit
    if owner_unit is not None:result['owner_review_unit']=owner_unit
    if public_unit is not None:result['current_public_unit']=public_unit
    if whole_population_unit is not None:result['whole_population_unit']=whole_population_unit
    if read_view_unit is not None:result['read_view_extension_unit']=read_view_unit
    if professional_unit is not None:result['professional_unit']=professional_unit
    if school_reference_unit is not None:result['school_reference_unit']=school_reference_unit
    if university_cancellation_unit is not None:result['university_cancellation_unit']=university_cancellation_unit
    if reference_safety_unit is not None:result['reference_safety_unit']=reference_safety_unit
    if reference_db_unit is not None:result['reference_db_unit']=reference_db_unit
    if member_shortlist_unit is not None:result['member_shortlist_unit']=member_shortlist_unit
    if service_candidate_aux_unit is not None:result['service_candidate_aux_unit']=service_candidate_aux_unit
    if service_staged_aux_unit is not None:result['service_staged_aux_unit']=service_staged_aux_unit
    if service_wildcard_unit is not None:result['service_wildcard_unit']=service_wildcard_unit
    write_new(output/"edge_run_receipt.json",json_bytes(result));return result
def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ("snapshot-root","source-manifest","python","output-root"):p.add_argument("--"+name,required=True)
    p.add_argument("--deno",default=os.environ.get("JUNGSI_DENO"));a=p.parse_args()
    result=run_workspace(a.snapshot_root,json.loads(Path(a.source_manifest).read_bytes()),a.deno,a.python,a.output_root)
    print(json.dumps(result,ensure_ascii=False));return 0
if __name__=="__main__":
    try:raise SystemExit(main())
    except (ValueError,KeyError,OSError,ET.ParseError) as e:
        print(json.dumps(dict(successful=False,error=str(e)),ensure_ascii=False),file=sys.stderr);raise SystemExit(2)
