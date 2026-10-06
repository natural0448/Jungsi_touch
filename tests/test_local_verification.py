"""Local-only, invented data; native DPAPI is checked on Windows.

All test artifacts are preserved in outputs/. No real Drive, DB or accounts.
"""
import base64
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import timedelta
from hashlib import sha256
import io
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src')); sys.path.insert(0, str(ROOT / 'tests'))
from fastapi.testclient import TestClient
from backend_synthetic_fixture import FrozenClock, score_input
from forecast_synthetic_fixture import Inputs
from jungsi_touch.application.platform_ports import PlatformError
from jungsi_touch.infrastructure.drive_provider import DriveDataProvider
from jungsi_touch.infrastructure.local_dpapi import WindowsDpapi, write_sealed_new, read_sealed
from jungsi_touch.infrastructure.local_drive import (LocalFilesystemClient, LocalEncryptedDriveClient,
    prepare_local_cache, prepare_cache, FORMAT, LOCAL_FORMAT, entry_hash)
from jungsi_touch.infrastructure.local_repository import LocalMemoryRepository
from jungsi_touch.infrastructure.local_verification import (build_local_app, issue_sessions, LocalSessions, SUBJECTS, main)


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def b64(value):
    return base64.b64encode(value).decode()


def workspace():
    path = ROOT / 'outputs' / 'local_tests' / uuid4().hex
    path.mkdir(parents=True, exist_ok=False)
    return path


def filesystem_bundle(engine=None, *, engine_present=False, status='approved'):
    payload = dict(format='SYNTHETIC-control-flow/v1', version='SYNTHETIC-v1', marker='SYNTHETIC-PRIVATE')
    if engine_present:
        payload['engine_approved'] = engine
    raw = encoded(payload)
    row = dict(kind='catalog', key='service', local_artifact_id='SYNTHETIC-local-id', local_version='SYNTHETIC-local-v1',
               sha256=sha256(raw).hexdigest(), bytes=len(raw), payload_version='SYNTHETIC-v1', status=status,
               path='SYNTHETIC-PRIVATE-PATH', approval_evidence='SYNTHETIC-PRIVATE-EVIDENCE')
    evidence = encoded(dict(format='jungsi.local-data-approval/v1', status='approved', scope='local_verification',
        artifacts=[{k: row[k] for k in ('local_artifact_id', 'local_version', 'sha256', 'payload_version')}]))
    row['approval_evidence_sha256'] = sha256(evidence).hexdigest()
    selection = encoded(dict(format='jungsi.local-selection/v1', transport='local_filesystem', entries=[row]))
    digest = sha256(selection).hexdigest()
    bundle = dict(format=LOCAL_FORMAT, selection_sha256=digest, selection_raw=b64(selection),
        artifacts=[dict(local_artifact_id=row['local_artifact_id'], content=b64(raw), evidence=b64(evidence))] if status == 'approved' else [])
    return bundle, digest


def drive_bundle():
    raw = encoded(dict(version='SYNTHETIC-v1'))
    entry = dict(kind='catalog', key='service', file_id='SYNTHETIC-file', drive_version='1', version='SYNTHETIC-v1', status='approved', sha256=sha256(raw).hexdigest())
    registry = encoded(dict(format='jungsi.data-registry/v1', entries=[entry]))
    registry_hash = sha256(registry).hexdigest()
    row = dict(kind='catalog', key='service', file_id=entry['file_id'], drive_version='1', parents=['SYNTHETIC-folder'],
               createdTime='2026-10-01T00:00:00Z', modifiedTime='2026-10-01T00:00:00Z', path='SYNTHETIC-PRIVATE-PATH')
    selection = encoded(dict(format='jungsi.local-selection/v1', registry_sha256=registry_hash, input_folder='SYNTHETIC-folder', artifacts=[row]))
    selection_hash = sha256(selection).hexdigest()
    record = dict(kind=entry['kind'], key=entry['key'], entry_sha256=entry_hash(entry), file_id=entry['file_id'],
                  input_folder='SYNTHETIC-folder', parents=row['parents'], drive_version='1', created_at=row['createdTime'],
                  modified_at=row['modifiedTime'], source='filesystem', drive_api_verified=False, content=b64(raw))
    return dict(format=FORMAT, source='filesystem', registry_sha256=registry_hash, registry_raw=b64(registry),
                input_folder='SYNTHETIC-folder', selection_sha256=selection_hash, selection_raw=b64(selection), artifacts=[record]), registry_hash, selection_hash


class LocalCacheTests(unittest.TestCase):
    def test_local_registry_has_no_fake_drive_fields_and_load_reuses_approval(self):
        bundle, digest = filesystem_bundle()
        client = LocalFilesystemClient(bundle, digest)
        entry = client.registry['entries'][0]
        self.assertNotIn('file_id', entry); self.assertNotIn('drive_version', entry)
        value, _ = DriveDataProvider(client, client.registry).load('catalog', 'service')
        self.assertEqual(value['version'], 'SYNTHETIC-v1')
        self.assertEqual(client.artifact(entry)[1]['drive_api'], 'NOT_RUN')

    def test_independent_selection_hash_is_required_again_on_reopen(self):
        bundle, digest = filesystem_bundle()
        for wrong in (None, 'a' * 64):
            with self.subTest(wrong=wrong), self.assertRaises(PlatformError):
                LocalFilesystemClient(bundle, wrong)
        changed = deepcopy(bundle); changed['selection_raw'] = b64(encoded({'changed': True}))
        with self.assertRaises(PlatformError): LocalFilesystemClient(changed, digest)

    def test_evidence_and_artifact_bytes_are_bound_not_just_hash_format(self):
        bundle, digest = filesystem_bundle()
        for field in ('content', 'evidence'):
            changed = deepcopy(bundle); changed['artifacts'][0][field] = b64(encoded(dict(status='approved', version='other')))
            with self.subTest(field=field), self.assertRaises(PlatformError): LocalFilesystemClient(changed, digest)

    def test_false_unknown_and_nonboolean_engine_flags_remain_hold(self):
        for flag in (False, None, 0, 1, 'false', 'true'):
            bundle, digest = filesystem_bundle(flag, engine_present=True)
            client = LocalFilesystemClient(bundle, digest)
            with self.subTest(flag=flag), self.assertRaises(PlatformError):
                DriveDataProvider(client, client.registry).load('catalog', 'service')
            self.assertEqual(client.diagnostic()['engine_hold_count'], 1)
        bundle, digest = filesystem_bundle(True, engine_present=True)
        self.assertTrue(DriveDataProvider(LocalFilesystemClient(bundle, digest), LocalFilesystemClient(bundle, digest).registry).load('catalog', 'service')[0]['engine_approved'])

    def test_unapproved_does_not_read_source_and_stays_registered_hold(self):
        bundle, digest = filesystem_bundle(status='pending')
        client = LocalFilesystemClient(bundle, digest)
        self.assertEqual(client.diagnostic()['unapproved_count'], 1)
        with self.assertRaises(PlatformError): DriveDataProvider(client, client.registry).load('catalog', 'service')

    def test_prepare_pending_selection_never_reads_source_or_approval_file(self):
        bundle, digest = filesystem_bundle(status='pending')
        selection = base64.b64decode(bundle['selection_raw'])
        # Source/evidence paths deliberately do not exist. Only the selection
        # is read; no unapproved data is opened even to hash or encrypt it.
        with patch('jungsi_touch.infrastructure.local_drive.read_bounded', return_value=selection) as reader, patch('jungsi_touch.infrastructure.local_drive.write_sealed_new') as writer:
            prepare_local_cache(selection_path='outputs/SYNTHETIC-selection.json', selection_sha256=digest, destination='outputs/SYNTHETIC-new.dpapi')
            reader.assert_called_once_with('outputs/SYNTHETIC-selection.json')
            writer.assert_called_once()
            cache = writer.call_args.args[1]
            self.assertEqual(cache['artifacts'], [])
            self.assertEqual(LocalFilesystemClient(cache,digest).diagnostic()['unapproved_count'],1)

    def test_correct_evidence_hash_still_requires_approved_local_scope_and_exact_identity(self):
        for field in ('status','scope','local_artifact_id','local_version','sha256','payload_version'):
            bundle, _ = filesystem_bundle()
            selection=json.loads(base64.b64decode(bundle['selection_raw']))
            evidence=json.loads(base64.b64decode(bundle['artifacts'][0]['evidence']))
            if field in ('status','scope'):
                evidence[field]='SYNTHETIC-invalid'
            else:
                evidence['artifacts'][0][field]='SYNTHETIC-invalid'
            raw_evidence=encoded(evidence)
            selection['entries'][0]['approval_evidence_sha256']=sha256(raw_evidence).hexdigest()
            raw_selection=encoded(selection); digest=sha256(raw_selection).hexdigest()
            bundle.update(selection_sha256=digest,selection_raw=b64(raw_selection))
            bundle['artifacts'][0]['evidence']=b64(raw_evidence)
            with self.subTest(field=field), self.assertRaises(PlatformError) as caught:
                LocalFilesystemClient(bundle,digest)
            self.assertEqual(caught.exception.code,'local_approval_binding_mismatch')

    def test_duplicate_local_ids_and_missing_artifacts_are_rejected(self):
        bundle, digest = filesystem_bundle()
        changed = deepcopy(bundle); changed['artifacts'] = changed['artifacts'] * 2
        with self.assertRaises(PlatformError): LocalFilesystemClient(changed, digest)
        changed['artifacts'] = []
        with self.assertRaises(PlatformError): LocalFilesystemClient(changed, digest)

    def test_drive_receipt_independent_hash_and_source_are_mandatory_on_load(self):
        bundle, registry_hash, selection_hash = drive_bundle()
        client = LocalEncryptedDriveClient(bundle, registry_hash, trusted_source='filesystem', trusted_selection_sha256=selection_hash)
        self.assertEqual(client.diagnostic()['drive_api'], 'NOT_VERIFIED')
        for options in ({}, {'trusted_source':'filesystem'}, {'trusted_source':'filesystem','trusted_selection_sha256':'a'*64}):
            with self.subTest(options=options), self.assertRaises(PlatformError): LocalEncryptedDriveClient(bundle, registry_hash, **options)

    def test_drive_record_cannot_mutate_pinned_version_folder_receipt(self):
        bundle, registry_hash, selection_hash = drive_bundle()
        for field, value in (('drive_version','2'),('parents',['SYNTHETIC-other']),('created_at','2026-10-02T00:00:00Z'),('drive_api_verified',True)):
            changed = deepcopy(bundle); changed['artifacts'][0][field] = value
            with self.subTest(field=field), self.assertRaises(PlatformError):
                LocalEncryptedDriveClient(changed, registry_hash, trusted_source='filesystem', trusted_selection_sha256=selection_hash)

    def test_prepare_local_writes_only_sealed_destination_after_trust_checks(self):
        bundle, _ = filesystem_bundle()
        path = workspace(); row = json.loads(base64.b64decode(bundle['selection_raw']))['entries'][0]
        source = path/'synthetic-input.json'; evidence = path/'synthetic-evidence.json'
        source.write_bytes(base64.b64decode(bundle['artifacts'][0]['content']))
        evidence.write_bytes(base64.b64decode(bundle['artifacts'][0]['evidence']))
        row.update(path=str(source), approval_evidence=str(evidence))
        selection = path/'selection.json'; selection.write_bytes(encoded(dict(format='jungsi.local-selection/v1', transport='local_filesystem', entries=[row])))
        digest = sha256(selection.read_bytes()).hexdigest()
        with patch('jungsi_touch.infrastructure.local_drive.write_sealed_new') as writer:
            prepare_local_cache(selection_path=selection, selection_sha256=digest, destination=path/'new.dpapi')
            saved = writer.call_args.args[1]
            self.assertEqual(LocalFilesystemClient(saved, digest).registry['entries'][0]['transport'], 'local_filesystem')
        with patch('jungsi_touch.infrastructure.local_drive.write_sealed_new') as writer:
            with self.assertRaises(PlatformError): prepare_local_cache(selection_path=selection, selection_sha256='a'*64, destination=path/'bad.dpapi')
            writer.assert_not_called()

    def test_native_dpapi_roundtrip_tamper_and_no_overwrite(self):
        if os.name != 'nt':
            with self.assertRaises(PlatformError): WindowsDpapi().protect(b'SYNTHETIC')
            return
        path = workspace()/'native.dpapi'
        value = dict(marker='SYNTHETIC-PRIVATE-DPAPI', value=42)
        write_sealed_new(path, value)
        original = path.read_bytes()
        self.assertNotIn(b'SYNTHETIC-PRIVATE-DPAPI', original)
        self.assertEqual(read_sealed(path), value)
        with self.assertRaises(FileExistsError): write_sealed_new(path, {'different': True})
        self.assertEqual(path.read_bytes(), original)
        tampered = path.with_name('tampered.dpapi'); tampered.write_bytes(original[:-1] + bytes([original[-1] ^ 1]))
        with self.assertRaises(PlatformError): read_sealed(tampered)


class LocalHttpTests(unittest.TestCase):
    def setUp(self):
        self.clock = FrozenClock(); self.sessions = issue_sessions(self.clock)
        self.app = build_local_app(sessions=self.sessions, hold_no_data=True, clock=self.clock, university_ids=['SYNTHETIC-U'])
        self.client = TestClient(self.app, base_url='http://127.0.0.1:8000', client=('127.0.0.1', 45000))
        self.count = 0

    def request(self, method, path, body=None, role='paid'):
        self.count += 1
        return self.client.request(method, path, json=body, headers={'Authorization':'Bearer '+self.sessions['tokens'][role], 'Idempotency-Key':'SYNTHETIC-local-'+str(self.count)})

    def test_exact_22_api_routes_and_operating_settings_not_inherited(self):
        routes = [r for r in self.app.app.routes if r.path.startswith('/api/')]
        self.assertEqual(len(routes), 22)
        self.assertIsNone(self.app.state.publication.writer)
        with patch.dict(os.environ, DATABASE_URL='SYNTHETIC-PRIVATE-DSN', SUPABASE_URL='https://example.invalid', GOOGLE_DRIVE_ACCESS_TOKEN='SYNTHETIC-PRIVATE-TOKEN'):
            app = build_local_app(sessions=self.sessions, hold_no_data=True, clock=self.clock)
            self.assertIsInstance(app.state.local_repository, LocalMemoryRepository)
            self.assertIsNone(app.state.publication.writer)

    def test_readiness_has_local_memory_and_numeric_hold_never_production_ready(self):
        response = self.client.get('/health/ready'); ready = response.json()
        self.assertEqual(response.status_code, 200)
        self.assertFalse(ready['production_ready']); self.assertEqual(ready['auth'], 'test_allowlist')
        self.assertEqual(ready['real_data']['status'], 'hold')
        self.assertEqual(ready['real_data']['reason_code'], 'approved_registry_not_provided')
        self.assertNotIn('SYNTHETIC-U', response.text)

    def test_standard_paid_and_separate_editor_approver_dtos(self):
        for role in self.sessions['tokens']:
            value = self.request('GET','/api/v1/me',role=role).json()
            self.assertEqual(set(value), {'format','member_tier','entitlement_expires_at'})
            self.assertEqual(value['member_tier'], 'paid' if role=='paid' else 'standard')
        self.assertEqual(self.request('GET','/api/v1/forecast-capabilities',role='editor').json()['capabilities'], ['editor'])
        self.assertEqual(self.request('GET','/api/v1/forecast-capabilities',role='approver').json()['capabilities'], ['approver'])
        self.assertEqual(self.request('GET','/api/v1/offerings/search',role='standard').status_code,403)

    def test_peer_host_origin_and_proxy_headers_rejected_before_auth(self):
        for headers in ({'Host':'evil.invalid:8000'}, {'Host':'127.0.0.1:9000'}, {'Origin':'https://evil.invalid'}, {'X-Forwarded-For':'127.0.0.1'}):
            with self.subTest(headers=headers): self.assertEqual(self.client.get('/health/ready',headers=headers).status_code,403)
        remote = TestClient(self.app, base_url='http://127.0.0.1:8000',client=('192.0.2.10',45000))
        self.assertEqual(remote.get('/health/live').status_code,403)
        self.assertEqual(self.client.get('/health/live',headers={'Origin':'http://localhost:3000'}).status_code,200)

    def test_no_default_user_arbitrary_subject_or_claims_cannot_grant_access(self):
        for token in ('LOCAL-VERIFICATION-paid', 'not-a-token', '가상토큰'):
            self.assertIsNone(LocalSessions(self.sessions,self.clock).verify(token,self.clock.now()))
        response=self.client.get('/api/v1/me',headers={'X-Owner':SUBJECTS['paid'],'X-Member-Type':'paid'})
        self.assertEqual(response.status_code,401)
        self.assertEqual(self.client.get('/api/v1/me',headers={'Authorization':'Bearer fabricated'}).status_code,401)

    def test_exact_utc_expiry_invalid_session_duplicates_and_excess_lifetime(self):
        auth = LocalSessions(self.sessions, self.clock)
        self.assertIsNone(auth.verify(self.sessions['tokens']['paid'], auth.end))
        bad=deepcopy(self.sessions); bad['tokens']['editor']=bad['tokens']['paid']
        with self.assertRaises(PlatformError): LocalSessions(bad,self.clock)
        bad=deepcopy(self.sessions); bad['expires_at']='2027-01-01T00:00:00Z'
        with self.assertRaises(PlatformError): LocalSessions(bad,self.clock)

    def test_missing_sources_hold_and_memory_reset_do_not_invent_numbers(self):
        catalog=self.request('GET','/api/v1/offerings/search').json()
        self.assertEqual(catalog['status'],'pending'); self.assertIsNone(catalog['matching_offering_count'])
        response=self.request('POST','/api/v1/score-profiles',dict(scores=score_input(),confirmed=True))
        self.assertEqual(response.status_code,503); self.assertEqual(response.json()['error']['code'],'exam_not_available')
        self.assertEqual(self.app.state.local_repository.profiles,{})
        fresh=build_local_app(sessions=self.sessions,hold_no_data=True,clock=self.clock)
        self.assertEqual(fresh.state.local_repository.profiles,{})

    def test_forecast_independent_approval_then_publish_with_distinct_actors(self):
        self.app.state.forecasts.inputs=Inputs(True)
        record=self.request('POST','/api/v1/offerings/SYNTHETIC-O/forecast-drafts',dict(input_id='SYNTHETIC-input-id',input_version='SYNTHETIC-input',policy_id='SYNTHETIC-policy',policy_version='SYNTHETIC-policy'),role='editor').json()
        def body(record):return dict(expected_revision=record['revision'],base_result_hash=record['base_result_hash'],policy_version=record['policy_version'])
        record=self.request('POST',f"/api/v1/forecast-drafts/{record['draft_id']}/validations",body(record),role='editor').json()
        approval=dict(body(record),validation_receipt_hash=record['validation']['receipt_hash'],reason='합성 독립 검수')
        # Even when a contributor also has approver capability, policy is intact.
        self.app.state.forecasts.repository.authorities[SUBJECTS['editor']]['approve']=True
        denied=self.request('POST',f"/api/v1/forecast-drafts/{record['draft_id']}/approvals",approval,role='editor')
        self.assertEqual(denied.status_code,403); self.assertEqual(denied.json()['error']['code'],'forecast_independent_approver_required')
        record=self.request('POST',f"/api/v1/forecast-drafts/{record['draft_id']}/approvals",approval,role='approver').json()
        record=self.request('POST',f"/api/v1/forecast-drafts/{record['draft_id']}/publications",dict(body(record),approval_receipt_hash=record['approval']['approval_hash']),role='approver').json()
        self.assertEqual(record['status'],'published')

    def test_local_factory_requires_explicit_mode_and_safe_origins(self):
        with self.assertRaises(PlatformError): build_local_app(sessions=self.sessions,clock=self.clock)
        for origins in ((),('https://evil.invalid',),('http://127.0.0.1@evil.invalid',)):
            with self.subTest(origins=origins), self.assertRaises(PlatformError): build_local_app(sessions=self.sessions,hold_no_data=True,clock=self.clock,origins=origins)

    def test_token_cli_refuses_tool_stdout_and_never_loads_private_tokens(self):
        with patch('sys.stdout', new_callable=io.StringIO), patch('sys.stderr', new_callable=io.StringIO), patch('jungsi_touch.infrastructure.local_verification.read_sealed') as loader:
            self.assertEqual(main(['token','--sessions','outputs/SYNTHETIC.dpapi','--role','paid']),1)
            loader.assert_not_called()


class LocalStorageTests(unittest.TestCase):
    def test_idempotency_ownership_copy_isolation_and_one_cas_winner(self):
        repo=LocalMemoryRepository(); clock=FrozenClock()
        profile=repo.create_profile('SYNTHETIC-owner',{},True,clock.now(),'p','hash')
        self.assertEqual(repo.create_profile('SYNTHETIC-owner',{},True,clock.now(),'p','hash'),profile)
        with self.assertRaises(PlatformError): repo.create_profile('SYNTHETIC-owner',{},True,clock.now(),'p','other')
        record=repo.write_report('SYNTHETIC-owner',None,profile['profile_id'],{},None,clock.now(),'write','r','hash')
        self.assertIsNone(repo.get_report('SYNTHETIC-other',record['report_id']))
        record['body']['changed']=True
        self.assertEqual(repo.get_report('SYNTHETIC-owner',record['report_id'])['body'],{})
        def write(n):
            try:return repo.write_report('SYNTHETIC-owner',record['report_id'],profile['profile_id'],{},1,clock.now(),'write',str(n),'hash')
            except PlatformError as error:return error.code
        with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(write,(1,2)))
        self.assertEqual(sum(isinstance(r,dict) for r in results),1); self.assertIn('revision_conflict',results)
        self.assertEqual(repo.revisions[(record['report_id'],1)]['body'],{})


if __name__=='__main__': unittest.main()
