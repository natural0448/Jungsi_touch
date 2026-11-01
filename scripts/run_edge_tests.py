"""Run the registered Edge suite in exactly the retained Python-suite snapshot.
No runtime install, source fallback, skipped green result, cleanup or live service calls.
A separate native shell check may resolve only the existing frozen driver package.
"""
from __future__ import annotations
import argparse,base64,binascii,hashlib,io,json,os,re,sys,tarfile,xml.etree.ElementTree as ET
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit
from edge_source_scope import classify_sources
from check_edge_contract import EdgeFailure,check_workspace,command,digest,hashes,json_bytes,verify_manifest,write_new
def parse_junit(path,expected):
    if not Path(path).is_file():raise EdgeFailure("deno_test_result_missing")
    root=ET.fromstring(Path(path).read_bytes());cases=list(root.iter("testcase"))
    if len(cases)!=expected or any(list(c) for c in cases if any(x.tag in {"failure","error","skipped"} for x in c)):
        raise EdgeFailure("deno_test_count_failure_or_skip")
    return dict(tests_run=len(cases),failures=0,errors=0,skipped=0)
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

def current_public_registration(spec,before):
    """Exact separate provider proposal suite; no activation or legacy-count change."""
    prefix='supabase/functions/_shared/'
    names=['current_public_catalog','current_public_catalog_compat','current_public_catalog_runtime',
      'current_public_catalog_sql','current_public_catalog_sql_test','current_public_catalog_test',
      'current_public_key_index','current_public_key_index_test','current_public_key_storage',
      'current_public_key_storage_test']
    required={prefix+n+'.ts' for n in names}
    c=spec.get('current_public_supply_contract',{}).get('verification')
    if c is None:
        if required.intersection(before):raise EdgeFailure('current_public_verification_missing')
        return None
    tests=[prefix+n+'.ts'for n in names if n.endswith('_test')]
    bindings=c.get('source_bindings')
    if (c.get('format')!='jungsi.current-public-provider-verification/v1' or
        c.get('test_paths')!=tests or c.get('test_count')!=70 or
        not isinstance(bindings,list) or len(bindings)!=len(required) or
        {b.get('path')for b in bindings}!=required or
        any(not isinstance(b.get('sha256'),str)or before.get(b['path'])!=b['sha256']for b in bindings)):
        raise EdgeFailure('current_public_source_or_test_binding_invalid')
    return c

def whole_population_registration(spec,before):
    """Separate strict v2 regressions; keep the foundation and v1 checks exact."""
    prefix='supabase/functions/_shared/'
    test=prefix+'all_examinees_total_model_test.ts'
    contract=spec.get('overall_analysis_contract',{}).get('whole_population_transition')
    if contract is None:
        if test in before:raise EdgeFailure('whole_population_contract_missing')
        return None
    c=contract.get('verification',{})
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
    v=contract['verification']
    if any(before.get(b['path'])!=b['sha256']for b in v['source_bindings']):
        raise EdgeFailure('read_view_extension_snapshot_binding_invalid')
    return v


SCHOOL_REFERENCE_TESTS=tuple('tests/edge/'+name+'.ts'for name in (
    'test_school_reference_scoring','test_school_reference_provider','test_history_metric_alias','test_saved_reference_projection'))
SCHOOL_REFERENCE_SOURCES=tuple('supabase/functions/_shared/jungsi/'+name+'.ts'for name in (
    'application/school_score_inputs','application/school_reference_scoring','application/history_metric_alias',
    'domain/saved_reference_projection','infrastructure/school_reference_source','application/university_scoring',
    'application/university_analysis','application/offering_analysis','domain/exam_pack','infrastructure/native_data_provider',
    'infrastructure/native_source_selection','infrastructure/supabase_artifacts','infrastructure/runtime_controls',
    'infrastructure/runtime_composition'))

def school_reference_registration(spec,before):
    """Keep the original 656 cases and bind the additive reference suite to exact snapshot bytes."""
    v=spec.get('university_scoring_contract',{}).get('scoped_reference_contract',{}).get('verification')
    if v is None:
        if set(SCHOOL_REFERENCE_TESTS).intersection(before):raise EdgeFailure('school_reference_verification_missing')
        return None
    required={*SCHOOL_REFERENCE_SOURCES,*SCHOOL_REFERENCE_TESTS,'tests/edge/synthetic_school_reference.ts',
      'tests/edge/test_university_analysis.ts','supabase/functions/_shared/current_public_catalog.ts',
      'supabase/functions/_shared/current_public_catalog_test.ts','src/jungsi_touch/application/public_response_schemas.json',
      'tests/edge/public_api_contract_fixture.ts'}
    bindings=v.get('source_bindings')
    if (v.get('format')!='jungsi.school-reference-synthetic-verification/v1' or
        v.get('baseline_foundation_count')!=656 or v.get('test_count')!=46 or
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

def run_workspace(root,manifest,deno,python,output):
    root=Path(root).resolve();output=Path(output);output.mkdir(parents=True,exist_ok=False)
    before=verify_manifest(root,manifest);spec=json.loads((root/"docs/current/service_spec.json").read_bytes())
    scope=classify_sources(before,lambda p:(root/p).read_bytes(),spec)
    active=scope["foundation_active"]
    if not active:
        result=dict(successful=True,status="NOT_APPLICABLE_NO_FOUNDATION_SOURCE",edge_execution=False,coexisting_edge_sources=len(scope["coexisting_bound"]),coverage="DEV010_FOUNDATION")
        write_new(output/"edge_run_receipt.json",json_bytes(result));return result
    if not python or not Path(python).is_file():raise EdgeFailure("python_runtime_unavailable")
    cfg=spec["edge_harness"]
    parsed=check_workspace(root,manifest,deno,output/"contract")
    paths=list(cfg["files"]);common=["--no-lock","--no-remote","--no-npm","--config",cfg["config"]]
    command([deno,"check",*common,*paths],root=root,output=output,name="check")
    command([deno,"lint","--config",cfg["config"],*paths],root=root,output=output,name="lint")
    command([deno,"fmt","--check","--config",cfg["config"],*paths],root=root,output=output,name="fmt")
    from check_project_consistency import (recovery_input_registration,verify_recovery_test_partition,
      RECOVERY_SAMEFILE_NAMES,RECOVERY_STANDALONE_NAMES,RECOVERY_BASELINE_NAMES,RECOVERY_SAMEFILE_PATH)
    recovery,recovery_errors=recovery_input_registration(spec,before)
    if recovery_errors:raise EdgeFailure("incident_recovery_source_or_test_binding_invalid")
    if recovery is not None:verify_recovery_test_partition((root/RECOVERY_SAMEFILE_PATH).read_bytes())
    junit=output.resolve()/"deno.junit.xml"
    if junit.exists():raise EdgeFailure("deno_test_output_exists")
    recovery_unit=None
    if recovery is None:
        command([deno,"test",*common,"--reporter=dot","--junit-path",str(junit),*cfg["tests"]],root=root,output=output,name="unit")
        unit=parse_junit(junit,cfg["unit_count"])
    else:
        # Run every other foundation module without a filter; select the old score cases by exact positive names.
        rest=[path for path in cfg["tests"] if path!=RECOVERY_SAMEFILE_PATH]
        command([deno,"test",*common,"--reporter=dot","--junit-path",str(junit),*rest],root=root,output=output,name="unit")
        other=parse_junit(junit,625)
        require_unique_junit_identities(junit)
        require_no_recovery_cases(junit,RECOVERY_SAMEFILE_NAMES)
        base_junit=output.resolve()/"recovery_baseline_score.junit.xml"
        command([deno,"test",*common,"--filter",recovery_test_filter(RECOVERY_BASELINE_NAMES),
          "--reporter=dot","--junit-path",str(base_junit),RECOVERY_SAMEFILE_PATH],
          root=root,output=output,name="recovery_baseline_score")
        score=parse_recovery_partition_junit(base_junit,RECOVERY_BASELINE_NAMES,RECOVERY_SAMEFILE_NAMES,RECOVERY_SAMEFILE_PATH)
        require_unique_junit_identities(base_junit)
        require_disjoint_junit_identities(junit,base_junit)
        unit=dict(tests_run=other["tests_run"]+score["tests_run"],failures=0,errors=0,skipped=0)
        if unit["tests_run"]!=cfg["unit_count"]:raise EdgeFailure("foundation_split_count_invalid")
        added_junit=output.resolve()/"recovery_samefile.junit.xml"
        command([deno,"test",*common,"--filter",recovery_test_filter(RECOVERY_SAMEFILE_NAMES),
          "--reporter=dot","--junit-path",str(added_junit),RECOVERY_SAMEFILE_PATH],
          root=root,output=output,name="recovery_samefile")
        same=parse_recovery_partition_junit(added_junit,RECOVERY_SAMEFILE_NAMES,RECOVERY_BASELINE_NAMES,RECOVERY_SAMEFILE_PATH)
        standalone_junit=output.resolve()/"recovery_standalone.junit.xml"
        command([deno,"test",*common,"--reporter=dot","--junit-path",str(standalone_junit),
          *recovery["test_paths"]],root=root,output=output,name="recovery_standalone")
        standalone=parse_junit(standalone_junit,33);require_exact_junit_names(standalone_junit,RECOVERY_STANDALONE_NAMES)
        recovery_unit=dict(tests_run=same["tests_run"]+standalone["tests_run"],failures=0,errors=0,skipped=0,
          same_file_tests=same["tests_run"],standalone_tests=standalone["tests_run"],
          baseline_score_filtered_out=score["filtered_out"],same_file_filtered_out=same["filtered_out"],
          baseline_foundation_count=656,baseline_score_tests=31,coverage="INCIDENT_RECOVERY_V5_SYNTHETIC",
          source_bindings=recovery["source_bindings"],native_acceptance="NOT_VERIFIED_BY_SOURCE_SUITE",
          activation_status="NOT_RUN",operating_writes=0)
    owner_registration=owner_review_registration(spec,before);owner_unit=None
    if owner_registration is not None:
        owner_junit=output.resolve()/"owner_review.junit.xml"
        command([deno,"test","--no-config","--no-lock","--no-remote","--no-npm",
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
        command([deno,'test',*common,'--reporter=dot','--junit-path',str(public_junit),
          *public_registration['test_paths']],root=root,output=output,name='current_public_unit')
        public_unit=dict(**parse_junit(public_junit,public_registration['test_count']),
          coverage='CURRENT_PUBLIC_PROVIDER_CANDIDATE_SYNTHETIC',
          source_bindings=public_registration['source_bindings'],
          actual_DB='NOT_VERIFIED_BY_SOURCE_SUITE',publication='NOT_APPROVED_BY_SOURCE_SUITE',deployment='NOT_RUN')
    whole_population_unit=None
    whole_population=whole_population_registration(spec,before)
    if whole_population is not None:
        whole_paths=[b['path']for b in whole_population['source_bindings']]
        command([deno,'check',*common,*whole_paths],root=root,output=output,name='whole_population_check')
        command([deno,'lint','--config',cfg['config'],*whole_paths],root=root,output=output,name='whole_population_lint')
        command([deno,'fmt','--check','--config',cfg['config'],*whole_paths],root=root,output=output,name='whole_population_fmt')
        whole_junit=output.resolve()/'whole_population_unit.junit.xml'
        command([deno,'test',*common,'--reporter=dot','--junit-path',str(whole_junit),whole_population['test_path']],root=root,output=output,name='whole_population_unit')
        whole_population_unit=dict(**parse_junit(whole_junit,whole_population['test_count']),
          coverage='STRICT_WHOLE_POPULATION_V2_SYNTHETIC',source_bindings=whole_population['source_bindings'],
          native_acceptance='NOT_VERIFIED_BY_SOURCE_SUITE',activation_status='NOT_RUN')
    read_view_unit=None
    read_view=read_view_registration(spec,before)
    if read_view is not None:
        read_view_junit=output.resolve()/'read_view_extension.junit.xml'
        command([deno,'test',*common,'--reporter=dot','--junit-path',str(read_view_junit),
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
        command([deno, "test", *common, "--reporter=dot", "--junit-path", str(aux_junit),
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
        command([deno, "test", *common, "--reporter=dot", "--junit-path", str(staged_junit),
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
        command([deno, "test", *common, "--reporter=dot", "--junit-path", str(wildcard_junit),
                 *wildcard["test_paths"]], root=root, output=output, name="service_wildcard_unit")
        counted = parse_junit(wildcard_junit, wildcard["test_count"])
        require_auxiliary_junit_identities(wildcard_junit, wildcard["case_names_by_path"])
        service_wildcard_unit = dict(**counted, coverage="WILDCARD_AND_REPORT_SAFETY_SYNTHETIC",
            source_bindings=wildcard["source_bindings"], baseline_foundation_count=656,
            native_acceptance="NOT_VERIFIED_BY_SOURCE_SUITE", activation_status="NOT_RUN", operating_writes=0)
    member_shortlist_unit=None
    member=member_shortlist_suite_registration(spec,before)
    if member is not None:
        member_junit=output.resolve()/'member_shortlist.junit.xml'
        command([deno,'test',*common,'--reporter=dot','--junit-path',str(member_junit),
          *member['verification']['test_paths']],root=root,output=output,name='member_shortlist_unit')
        member_shortlist_unit=dict(**parse_junit(member_junit,member['verification']['test_count']),
          coverage='MEMBER_JSON_SHORTLIST_SYNTHETIC',source_bindings=member['verification']['source_bindings'],
          baseline_foundation_count=656,native_acceptance='NOT_VERIFIED_BY_SOURCE_SUITE',activation_status='NOT_RUN',operating_writes=0)
    professional_unit=None
    school_reference_unit=None
    school_reference=school_reference_registration(spec,before)
    if school_reference is not None:
        reference_junit=output.resolve()/'school_reference.junit.xml'
        command([deno,'test',*common,'--reporter=dot','--junit-path',str(reference_junit),
          *school_reference['test_paths']],root=root,output=output,name='school_reference_unit')
        school_reference_unit=dict(**parse_junit(reference_junit,school_reference['test_count']),
          coverage='SCOPED_SCHOOL_REFERENCE_SYNTHETIC',source_bindings=school_reference['source_bindings'],
          baseline_foundation_count=656,native_acceptance='NOT_VERIFIED_BY_SOURCE_SUITE',activation_status='NOT_RUN',operating_writes=0)
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
        command([deno,'test',*common,'--reporter=dot','--junit-path',str(professional_junit),
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
    if recovery_unit is not None:result['incident_recovery_unit']=recovery_unit
    if owner_unit is not None:result['owner_review_unit']=owner_unit
    if public_unit is not None:result['current_public_unit']=public_unit
    if whole_population_unit is not None:result['whole_population_unit']=whole_population_unit
    if read_view_unit is not None:result['read_view_extension_unit']=read_view_unit
    if professional_unit is not None:result['professional_unit']=professional_unit
    if school_reference_unit is not None:result['school_reference_unit']=school_reference_unit
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
