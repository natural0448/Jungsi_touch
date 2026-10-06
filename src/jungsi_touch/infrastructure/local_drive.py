"""DPAPI cache implementing DriveClient.artifact without bypassing releases.

The expected registry hash is supplied independently by the data publisher.
Drive provenance is checked at download time. A filesystem selection requires
its own independently supplied receipt hash and is never a Drive API proof.
"""
import base64
from copy import deepcopy
from hashlib import sha256
import json
import re
from ..application.platform_ports import PlatformError
from ..application.time_contract import utc_instant, utc_text
from .drive_provider import DriveClient, DriveDataProvider, drive_id
from .local_dpapi import read_bounded, read_sealed, write_sealed_new

FORMAT = 'jungsi.local-encrypted-drive/v1'
SELECTION_FORMAT = 'jungsi.local-selection/v1'


def checked_json(content, expected):
    if not isinstance(expected, str) or not re.fullmatch(r'[0-9a-f]{64}', expected):
        raise PlatformError('local_trusted_hash_required', 503)
    if sha256(content).hexdigest() != expected:
        raise PlatformError('local_trusted_hash_mismatch', 503)
    try:
        value = json.loads(content)
        if not isinstance(value, dict):
            raise ValueError()
        return value
    except (ValueError, UnicodeError) as error:
        raise PlatformError('local_json_invalid', 503) from error


def entry_hash(entry):
    return sha256(json.dumps(entry, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


def registry_entries(raw, trusted_hash):
    registry = checked_json(raw, trusted_hash)
    provider = DriveDataProvider(None, registry)
    if len(provider.entries) > 128:
        raise PlatformError('local_selection_too_large', 503)
    for entry in provider.entries.values():
        drive_id(entry['file_id'])
        if not isinstance(entry.get('version'), str) or not entry['version'].strip():
            raise PlatformError('artifact_version_mismatch', 503)
        if not str(entry.get('drive_version', '')).isdigit():
            raise PlatformError('drive_version_mismatch', 503)
    return registry, provider.entries


class RecordingDriveClient(DriveClient):
    """Reuse existing metadata, folder, version, hash and UTC validation."""
    def artifact(self, entry):
        self.recorded_metadata = None
        self.recorded_content = None
        payload, metadata = super().artifact(entry)
        return payload, metadata

    def call(self, path, *, params=None, **kwargs):
        content = super().call(path, params=params, **kwargs)
        if params and params.get('alt') == 'media':
            self.recorded_content = content
        elif params and 'fields' in params:
            self.recorded_metadata = json.loads(content)
        return content


def prepare_cache(*, registry_path, registry_sha256, input_folder, destination,
                  source, selection_path=None, selection_sha256=None, token=None):
    raw = read_bounded(registry_path)
    registry, entries = registry_entries(raw, registry_sha256)
    folder = drive_id(input_folder)
    selection = {}
    selection_raw = None
    if source == 'filesystem':
        selection_raw = read_bounded(selection_path)
        receipt = checked_json(selection_raw, selection_sha256)
        if receipt.get('format') != SELECTION_FORMAT or receipt.get('registry_sha256') != registry_sha256 or receipt.get('input_folder') != folder:
            raise PlatformError('local_selection_binding_mismatch', 503)
        for row in receipt['artifacts']:
            identity = (row['kind'], row['key'])
            if identity in selection or identity not in entries or entries[identity].get('status') != 'approved':
                raise PlatformError('local_selection_invalid', 503)
            selection[identity] = row
    elif source != 'drive' or not token:
        raise PlatformError('local_source_not_configured', 503)
    client = RecordingDriveClient(token, folder, None) if source == 'drive' else None
    records = []
    total = 0
    for identity, entry in entries.items():
        if entry.get('status') != 'approved':
            continue
        if client:
            client.artifact(entry)
            content, metadata = client.recorded_content, client.recorded_metadata
        else:
            if identity not in selection:
                continue
            row = selection[identity]
            content, metadata = read_bounded(row['path']), row
        if len(content) > 32 * 1024 * 1024:
            raise PlatformError('drive_artifact_too_large', 503)
        total += len(content)
        if total > 64 * 1024 * 1024:
            raise PlatformError('local_selection_too_large', 503)
        payload = checked_json(content, entry['sha256'])
        if payload.get('version', payload.get('pack_version')) != entry['version']:
            raise PlatformError('artifact_version_mismatch', 503)
        fid = metadata.get('id', metadata.get('file_id'))
        version = metadata.get('version', metadata.get('drive_version'))
        if fid != entry['file_id'] or metadata.get('trashed') or folder not in metadata.get('parents', []):
            raise PlatformError('drive_folder_mismatch', 503)
        if str(version) != str(entry['drive_version']):
            raise PlatformError('drive_version_mismatch', 503)
        created = utc_text(utc_instant(metadata['createdTime']))
        modified = utc_text(utc_instant(metadata['modifiedTime']))
        records.append(dict(kind=identity[0], key=identity[1], entry_sha256=entry_hash(entry),
                            file_id=fid, input_folder=folder, parents=metadata['parents'], drive_version=str(version),
                            created_at=created, modified_at=modified, source=source,
                            drive_api_verified=source == 'drive', content=base64.b64encode(content).decode()))
    bundle = dict(format=FORMAT, source=source, registry_sha256=registry_sha256, registry_raw=base64.b64encode(raw).decode(),
                  input_folder=folder, selection_sha256=selection_sha256 if source == 'filesystem' else None,
                  selection_raw=base64.b64encode(selection_raw).decode() if selection_raw else None, artifacts=records)
    # Validate the complete object before writing any file. Engine approval is
    # preserved; false approval remains a HOLD at artifact consumption time.
    LocalEncryptedDriveClient(bundle, registry_sha256, trusted_selection_sha256=selection_sha256, trusted_source=source)
    write_sealed_new(destination, bundle)


class LocalEncryptedDriveClient:
    production_allowed = False

    def __init__(self, bundle, trusted_registry_sha256, *, trusted_selection_sha256=None, trusted_source='drive'):
        if bundle.get('format') != FORMAT or bundle.get('registry_sha256') != trusted_registry_sha256 or trusted_source not in ('drive', 'filesystem') or bundle.get('source') != trusted_source:
            raise PlatformError('local_cache_binding_mismatch', 503)
        try:
            raw = base64.b64decode(bundle['registry_raw'], validate=True)
            self.registry, entries = registry_entries(raw, trusted_registry_sha256)
            self.folder = drive_id(bundle['input_folder'])
            selection = {}
            if trusted_source == 'filesystem':
                if bundle.get('selection_sha256') != trusted_selection_sha256:
                    raise PlatformError('local_cache_binding_mismatch', 503)
                receipt = checked_json(base64.b64decode(bundle['selection_raw'], validate=True), trusted_selection_sha256)
                if receipt.get('format') != SELECTION_FORMAT or receipt.get('registry_sha256') != trusted_registry_sha256 or receipt.get('input_folder') != self.folder:
                    raise PlatformError('local_selection_binding_mismatch', 503)
                for row in receipt['artifacts']:
                    identity = (row['kind'], row['key'])
                    if identity in selection:
                        raise PlatformError('local_selection_invalid', 503)
                    selection[identity] = row
            self.records = {}
            for record in bundle['artifacts']:
                identity = (record['kind'], record['key'])
                if identity in self.records or identity not in entries:
                    raise PlatformError('local_selection_invalid', 503)
                entry = entries[identity]
                if entry.get('status') != 'approved' or record['entry_sha256'] != entry_hash(entry):
                    raise PlatformError('local_cache_binding_mismatch', 503)
                if record['file_id'] != entry['file_id'] or record['input_folder'] != self.folder or self.folder not in record['parents']:
                    raise PlatformError('drive_folder_mismatch', 503)
                if record['drive_version'] != str(entry['drive_version']):
                    raise PlatformError('drive_version_mismatch', 503)
                source = record['source']
                if source != trusted_source or record['drive_api_verified'] is not (source == 'drive'):
                    raise PlatformError('local_provenance_invalid', 503)
                if source == 'filesystem':
                    row = selection.get(identity)
                    if row is None or row.get('file_id') != record['file_id'] or row.get('parents') != record['parents'] or str(row.get('drive_version')) != record['drive_version'] or utc_text(utc_instant(row['createdTime'])) != record['created_at'] or utc_text(utc_instant(row['modifiedTime'])) != record['modified_at']:
                        raise PlatformError('local_selection_binding_mismatch', 503)
                payload = checked_json(base64.b64decode(record['content'], validate=True), entry['sha256'])
                if payload.get('version', payload.get('pack_version')) != entry['version']:
                    raise PlatformError('artifact_version_mismatch', 503)
                utc_instant(record['created_at']); utc_instant(record['modified_at'])
                self.records[identity] = (deepcopy(record), payload)
        except (ValueError, KeyError, TypeError) as error:
            if isinstance(error, PlatformError):
                raise
            raise PlatformError('local_cache_invalid', 503) from error

    @classmethod
    def from_file(cls, path, trusted_registry_sha256, **trust):
        return cls(read_sealed(path), trusted_registry_sha256, **trust)

    def artifact(self, entry):
        row = self.records.get((entry['kind'], entry['key']))
        if row is None:
            raise PlatformError('local_artifact_missing', 503)
        record, payload = row
        if entry.get('status') != 'approved' or record['entry_sha256'] != entry_hash(entry):
            raise PlatformError('artifact_not_approved', 503)
        if any('engine_approved' in value and value['engine_approved'] is not True for value in (entry, payload)):
            raise PlatformError('artifact_not_approved', 503)
        return deepcopy(payload), dict(created_at=record['created_at'], modified_at=record['modified_at'], drive_version=record['drive_version'])

    def diagnostic(self):
        entries = list(self.registry['entries'])
        approved = sum(e.get('status') == 'approved' for e in entries)
        unapproved = len(entries) - approved
        held = sum(any('engine_approved' in value and value['engine_approved'] is not True for value in
                       (e, self.records.get((e['kind'], e['key']), ({}, {}))[1])) for e in entries)
        missing = sum(e.get('status') == 'approved' and (e['kind'], e['key']) not in self.records for e in entries)
        kinds = {identity[0] for identity in self.records}
        required = {'exam_pack', 'total_model', 'catalog', 'conversion', 'percentile', 'analysis'}
        return dict(status='hold' if unapproved or held or missing or required - kinds else 'pinned_cache_numeric_acceptance_not_run',
                    registered_count=len(entries), approved_count=approved, unapproved_count=unapproved,
                    engine_hold_count=held, verified_cache_count=len(self.records), missing_artifact_count=missing,
                    missing_kinds=sorted(required - kinds), numeric_acceptance='NOT_RUN',
                    drive_api='download_verified' if self.records and all(r[0]['drive_api_verified'] for r in self.records.values()) else 'NOT_VERIFIED')


LOCAL_FORMAT = 'jungsi.local-filesystem-cache/v1'
LOCAL_FIELDS = ('local_artifact_id', 'local_version', 'sha256', 'payload_version')


def local_selection(raw, trusted_hash):
    selection = checked_json(raw, trusted_hash)
    if selection.get('format') != SELECTION_FORMAT or selection.get('transport') != 'local_filesystem':
        raise PlatformError('local_selection_invalid', 503)
    rows = selection.get('entries')
    if not isinstance(rows, list) or len(rows) > 128:
        raise PlatformError('local_selection_invalid', 503)
    entries = []
    identities = set()
    local_ids = set()
    for row in rows:
        if not isinstance(row, dict) or any(k in row for k in ('file_id', 'drive_version', 'parents')):
            raise PlatformError('local_provenance_invalid', 503)
        for key in ('kind', 'key', 'local_artifact_id', 'local_version', 'payload_version', 'status'):
            if not isinstance(row.get(key), str) or not row[key].strip():
                raise PlatformError('local_selection_invalid', 503)
        if not re.fullmatch(r'[0-9a-f]{64}', row.get('sha256', '')) or type(row.get('bytes')) is not int or not 0 < row['bytes'] <= 32 * 1024 * 1024:
            raise PlatformError('local_selection_invalid', 503)
        identity = (row['kind'], row['key'])
        if identity in identities or row['local_artifact_id'] in local_ids:
            raise PlatformError('registry_identity_conflict', 503)
        identities.add(identity); local_ids.add(row['local_artifact_id'])
        entry = {key: row[key] for key in ('kind', 'key', 'local_artifact_id', 'local_version', 'sha256', 'status')}
        entry.update(version=row['payload_version'], transport='local_filesystem')
        for key in ('source_timezone', 'engine_approved'):
            if key in row:
                entry[key] = row[key]
        entries.append(entry)
    registry = dict(format='jungsi.data-registry/v1', entries=entries)
    DriveDataProvider(None, registry)
    return selection, registry


def local_approval(row, raw):
    evidence = checked_json(raw, row['approval_evidence_sha256'])
    binding = {key: row[key] for key in LOCAL_FIELDS}
    if evidence.get('format') != 'jungsi.local-data-approval/v1' or evidence.get('status') != 'approved' or evidence.get('scope') != 'local_verification' or binding not in evidence.get('artifacts', []):
        raise PlatformError('local_approval_binding_mismatch', 503)


def prepare_local_cache(*, selection_path, selection_sha256, destination):
    raw = read_bounded(selection_path)
    selection, _ = local_selection(raw, selection_sha256)
    records = []
    total = 0
    for row in selection['entries']:
        if row['status'] != 'approved':
            continue
        evidence = read_bounded(row['approval_evidence'])
        local_approval(row, evidence)
        content = read_bounded(row['path'])
        total += len(content)
        if len(content) != row['bytes'] or total > 64 * 1024 * 1024:
            raise PlatformError('local_cache_size_invalid', 503)
        checked_json(content, row['sha256'])
        records.append(dict(local_artifact_id=row['local_artifact_id'], content=base64.b64encode(content).decode(),
                            evidence=base64.b64encode(evidence).decode()))
    bundle = dict(format=LOCAL_FORMAT, selection_raw=base64.b64encode(raw).decode(), selection_sha256=selection_sha256, artifacts=records)
    LocalFilesystemClient(bundle, selection_sha256)
    write_sealed_new(destination, bundle)


class LocalFilesystemClient:
    """Same artifact port, explicitly NO Drive identifiers or metadata proof."""
    production_allowed = False

    def __init__(self, bundle, trusted_selection_sha256):
        if bundle.get('format') != LOCAL_FORMAT or bundle.get('selection_sha256') != trusted_selection_sha256:
            raise PlatformError('local_cache_binding_mismatch', 503)
        try:
            raw = base64.b64decode(bundle['selection_raw'], validate=True)
            selection, self.registry = local_selection(raw, trusted_selection_sha256)
            self.records = {}
            rows = {row['local_artifact_id']: row for row in selection['entries']}
            for record in bundle['artifacts']:
                identity = record['local_artifact_id']
                if identity in self.records or identity not in rows:
                    raise PlatformError('local_selection_invalid', 503)
                row = rows[identity]
                if row['status'] != 'approved':
                    raise PlatformError('artifact_not_approved', 503)
                local_approval(row, base64.b64decode(record['evidence'], validate=True))
                content = base64.b64decode(record['content'], validate=True)
                if len(content) != row['bytes']:
                    raise PlatformError('local_cache_size_invalid', 503)
                payload = checked_json(content, row['sha256'])
                if payload.get('version', payload.get('pack_version')) != row['payload_version']:
                    raise PlatformError('artifact_version_mismatch', 503)
                self.records[identity] = (deepcopy(row), payload)
            if {r['local_artifact_id'] for r in selection['entries'] if r['status'] == 'approved'} != set(self.records):
                raise PlatformError('local_artifact_missing', 503)
        except (ValueError, KeyError, TypeError) as error:
            if isinstance(error, PlatformError):
                raise
            raise PlatformError('local_cache_invalid', 503) from error

    @classmethod
    def from_file(cls, path, trusted_selection_sha256):
        return cls(read_sealed(path), trusted_selection_sha256)

    def artifact(self, entry):
        row = self.records.get(entry.get('local_artifact_id'))
        if row is None:
            raise PlatformError('local_artifact_missing', 503)
        original, payload = row
        if entry.get('transport') != 'local_filesystem' or entry.get('status') != 'approved' or any(entry.get(k) != original[k] for k in ('kind', 'key', 'local_artifact_id', 'local_version', 'sha256')) or entry.get('version') != original['payload_version']:
            raise PlatformError('local_cache_binding_mismatch', 503)
        if any('engine_approved' in value and value['engine_approved'] is not True for value in (entry, original, payload)):
            raise PlatformError('artifact_not_approved', 503)
        return deepcopy(payload), dict(transport='local_filesystem', local_artifact_id=original['local_artifact_id'],
                                       local_version=original['local_version'], drive_api='NOT_RUN')

    def diagnostic(self):
        rows = self.registry['entries']
        kinds = {r['kind'] for r in rows if r['status'] == 'approved'}
        required = {'exam_pack', 'total_model', 'catalog', 'conversion', 'percentile', 'analysis'}
        unapproved = sum(r['status'] != 'approved' for r in rows)
        held = sum(any('engine_approved' in value and value['engine_approved'] is not True for value in
                       (r, self.records.get(r['local_artifact_id'], ({}, {}))[1])) for r in rows)
        return dict(status='hold' if unapproved or held or required - kinds else 'pinned_cache_numeric_acceptance_not_run',
                    transport='local_filesystem', registered_count=len(rows), approved_count=len(rows) - unapproved,
                    unapproved_count=unapproved, engine_hold_count=held, verified_cache_count=len(self.records),
                    missing_kinds=sorted(required - kinds), numeric_acceptance='NOT_RUN', drive_api='NOT_RUN')
