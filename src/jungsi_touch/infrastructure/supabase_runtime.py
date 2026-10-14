"""Explicit, read-only Supabase native selection and protected readiness."""
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
from .settings import ServerSettings
from .supabase_storage import SupabaseStorageClient, SupabaseStorageDataProvider, MAX_ARTIFACT_BYTES
from .drive_provider import DriveDataProvider
from .forecast_inputs import DriveForecastInputProvider
from .secured_http import SecuredBoundary
from ..application.platform_ports import PlatformError
from ..application.university_scoring import CONTEXT_FIELDS
from ..application.overall_analysis import _identifier
from ..forecasting import generate

RUNTIME_KINDS = frozenset(('exam_pack', 'total_model', 'catalog', 'conversion', 'percentile',
                           'estimate_receipt', 'analysis', 'forecast_policy', 'forecast_inputs', 'forecast_context'))
DRIVE_SETTINGS = frozenset(('GOOGLE_DRIVE_ACCESS_TOKEN', 'GOOGLE_DRIVE_INPUT_FOLDER',
                            'GOOGLE_DRIVE_OUTPUT_FOLDER', 'JUNGSI_DRIVE_REGISTRY'))

@dataclass(frozen=True)
class RuntimeArtifactSelection:
    required: tuple[tuple[str, str], ...]

    @classmethod
    def from_manifest(cls, manifest):
        if (type(manifest) is not dict or set(manifest) != {'format','required'}
                or manifest.get('format') != 'jungsi.runtime-selection/v1'
                or type(manifest.get('required')) is not list
                or any(type(row) is not dict or set(row) != {'kind','key'} for row in manifest['required'])):
            raise PlatformError('registry_format_invalid', 503)
        return cls(tuple((row['kind'],row['key']) for row in manifest['required']))

    def __post_init__(self):
        if type(self.required) is not tuple or not self.required:
            raise PlatformError('registry_format_invalid', 503)
        seen = set()
        for item in self.required:
            if (type(item) is not tuple or len(item) != 2 or type(item[0]) is not str or item[0] not in RUNTIME_KINDS
                    or type(item[1]) is not str or not item[1].strip()
                    or any(ord(c) < 32 or ord(c) == 127 for c in item[1])):
                raise PlatformError('registry_format_invalid', 503)
            if item in seen:
                raise PlatformError('registry_identity_conflict', 503)
            seen.add(item)

class _VerifiedSnapshot:
    """Decode only objects already verified in this probe, without further GETs."""
    def __init__(self, payloads): self.payloads = payloads
    def artifact(self, entry):
        identity = (entry['kind'], entry['key'])
        if identity not in self.payloads:
            raise PlatformError('runtime_dependency_missing', 503)
        return deepcopy(self.payloads[identity]), {}

class SupabaseRuntimeReadiness:
    def __init__(self, data, selection):
        if (type(data) is not SupabaseStorageDataProvider
                or type(data.client) is not SupabaseStorageClient
                or type(selection) is not RuntimeArtifactSelection):
            raise PlatformError('storage_configuration_invalid', 503)
        self.data, self.selection = data, selection

    def _entries(self):
        entries = []
        for identity in self.selection.required:
            entry = deepcopy(self.data.entries.get(identity))
            if not isinstance(entry, dict):
                raise PlatformError('runtime_dependency_missing', 503)
            self.data.client.validate_reference(entry)
            if (entry.get('kind'), entry.get('key')) != identity:
                raise PlatformError('registry_identity_conflict', 503)
            if (entry.get('status') != 'approved' or entry.get('engine_approved') is not True
                    or entry.get('production_allowed') is not True):
                raise PlatformError('artifact_not_approved', 503)
            if entry.get('archive_only') is not False:
                raise PlatformError('storage_reference_invalid', 503)
            if entry['bytes'] > MAX_ARTIFACT_BYTES:
                raise PlatformError('storage_artifact_too_large', 503)
            entries.append(entry)
        return entries

    def probe(self):
        """Private operator receipt; never inserted into the public health body.

        Approval is checked for the entire required set before any read. Each
        selected object is size/hash/version verified once per probe, followed
        by the existing native decoders on an isolated in-memory snapshot.
        This checks compatibility, not numerical or operational approval.
        """
        receipt = dict(format='jungsi.runtime-preflight/v1', status='failed',
                       production_ready=False, artifacts=[], reason_code=None)
        try:
            entries = self._entries()
            raw = {}
            pinned = DriveDataProvider(self.data.client, {'format':'jungsi.data-registry/v1', 'entries':entries})
            for entry in entries:
                identity = (entry['kind'], entry['key'])
                payload, _ = pinned.load(*identity)
                raw[identity] = payload
                receipt['artifacts'].append({k:entry[k] for k in ('kind','key','version','sha256','bytes')})
            snapshot = DriveDataProvider(_VerifiedSnapshot(raw), {'format':'jungsi.data-registry/v1', 'entries':entries})
            for identity in self.selection.required:
                self._decode(snapshot, raw, identity)
            self._validate_bindings(snapshot, raw)
            self._validate_analysis(snapshot, raw)
            receipt['status'] = 'verified'
        except Exception:
            # Keep arbitrary adapter or decoder text, secrets and raw paths out
            # of the public response and even the safe receipt reason code.
            receipt['reason_code'] = 'runtime_preflight_failed'
        return receipt

    @staticmethod
    def _decode(data, raw, identity):
        kind, key = identity
        body = raw[identity]
        if kind == 'exam_pack':
            data.get_exam_pack(key)
        elif kind == 'total_model':
            exam, version = body['exam_id'], body['pack_version']
            if key != exam + ':' + version:
                raise PlatformError('artifact_exam_mismatch', 503)
            pack = data.get_exam_pack(exam)
            model = data.get_total_model(exam, version).model
            if pack is None or pack.pack_version != version or model.exam_id != exam or model.pack_version != version:
                raise PlatformError('artifact_version_mismatch', 503)
            metadata = model.distribution.metadata
            target = pack.validation_summary()['target_population']
            if (metadata.distribution_id != data.entries[identity].get('distribution_id')
                    or metadata.academic_year != pack.academic_year
                    or metadata.status != 'approved' or metadata.complete is not True
                    or metadata.population_verified is not True or metadata.population_id != target['population_id']
                    or not target['count_lower_bound'] <= metadata.expected_total_weight <= target['count_upper_bound']
                    or target.get('count') is not None and metadata.expected_total_weight != target['count']):
                raise PlatformError('artifact_version_mismatch', 503)
        elif kind == 'catalog':
            if key != 'service': raise PlatformError('catalog_release_invalid', 503)
            data.get_catalog()
        elif kind in ('conversion', 'percentile', 'analysis'):
            release = getattr(data, 'get_' + kind)(key)
            if release.status != 'approved': raise PlatformError('artifact_not_approved', 503)
            if kind == 'conversion' and not any(b.get('offering_pk') == key for b in release.bindings):
                raise PlatformError('conversion_release_invalid', 503)
            if kind == 'percentile' and not any(b.get('offering_pk') == key for b in release.bindings):
                raise PlatformError('percentile_release_invalid', 503)
            if kind == 'analysis' and key not in release.offerings_by_year.values():
                raise PlatformError('analysis_release_invalid', 503)
        elif kind == 'estimate_receipt':
            if (body.get('format') != 'jungsi.estimate-release-receipt/v1' or body.get('version') != key
                    or body.get('status') != 'approved' or body.get('validation_status') != 'self_validated_estimate'
                    or not isinstance(body.get('validation_checks'), dict) or not body['validation_checks']
                    or any(v is not True for v in body['validation_checks'].values())
                    or any(body.get('checks',{}).get(k) is not True for k in
                           ('model_validation','filter_complete','rule_replay','serialization'))):
                raise PlatformError('percentile_population_unverified', 503)
        elif kind == 'forecast_context':
            DriveForecastInputProvider(data).current_context(key)
        else:
            adapter = DriveForecastInputProvider(data)
            context = body['context']; offering = context['offering_id']
            if kind == 'forecast_inputs':
                if key != body['input_id'] + ':' + body['version']:
                    raise PlatformError('forecast_input_binding_mismatch', 503)
                inputs = adapter.inputs(offering, body['input_id'], body['version'])
                policies = [b for (k, _), b in raw.items() if k == 'forecast_policy' and b.get('context') == context]
                if len(policies) != 1: raise PlatformError('runtime_dependency_missing', 503)
                policy = policies[0]
            else:
                if key != body['policy_id'] + ':' + body['version']:
                    raise PlatformError('forecast_policy_binding_mismatch', 503)
                policy = adapter.policy(body['policy_id'], body['version'])
                inputs_list = [b for (k, _), b in raw.items() if k == 'forecast_inputs' and b.get('context') == context]
                if len(inputs_list) != 1: raise PlatformError('runtime_dependency_missing', 503)
                inputs = inputs_list[0]
            if context != adapter.current_context(offering):
                raise PlatformError('forecast_base_version_conflict', 503)
            generate(inputs, policy)

    @staticmethod
    def _validate_bindings(data, raw):
        """Compare the already selected releases; never expand to all sources."""
        def equal(actual, expected):
            if actual != expected: raise PlatformError('artifact_version_mismatch',503)
        def binding(release, key):
            rows=[b for b in release.bindings if b.get('offering_pk') == key
                  and b.get('academic_year') == release.academic_year]
            if len(rows) != 1: raise PlatformError('registry_identity_conflict',503)
            return rows[0]
        def context(release):
            return (release.academic_year,release.exam_id,release.source_pack_version,release.exam_type)
        packs={key:body['exam'] | {'source_pack_version':body['pack_version']}
               for (kind,key),body in raw.items() if kind == 'exam_pack'}
        catalog=data.get_catalog() if ('catalog','service') in raw else None
        conversions={key:data.get_conversion(key) for kind,key in raw if kind == 'conversion'}
        percentiles={key:data.get_percentile(key) for kind,key in raw if kind == 'percentile'}
        identity_fields=CONTEXT_FIELDS
        def verify_pack(release,key):
            pack=packs.get(release.exam_id)
            if pack is not None:
                equal(context(release),(pack['academic_year'],pack['exam_id'],pack['source_pack_version'],pack['exam_type']))
                return
            # Preserve the application's explicit approved mock-to-rule binding.
            conversion=conversions.get(key)
            compat=conversion.mock_compatibility if conversion is not None else None
            source=packs.get(compat.get('source_exam_id')) if isinstance(compat,dict) else None
            if (source is None or source['exam_type'] not in ('june_mock','september_mock')
                    or compat.get('status') != 'approved' or not _identifier(compat.get('version'))
                    or release.exam_type != 'csat'):
                raise PlatformError('artifact_exam_mismatch',503)
            expected=dict(source_exam_id=source['exam_id'],source_pack_version=source['source_pack_version'],
                          source_exam_type=source['exam_type'],rule_exam_id=release.exam_id,
                          rule_pack_version=release.source_pack_version)
            if any(compat.get(k) != v for k,v in expected.items()):
                raise PlatformError('artifact_version_mismatch',503)
            equal(source['academic_year'],release.academic_year)
        for family in (conversions,percentiles):
            for key,release in family.items():
                row=binding(release,key)
                if packs:
                    verify_pack(release,key)
                if catalog is not None:
                    offerings=[o for o in catalog.offerings if o.get('offering_id') == key]
                    if len(offerings) != 1: raise PlatformError('registry_identity_conflict',503)
                    equal(tuple(row.get(k) for k in identity_fields),tuple(offerings[0].get(k) for k in identity_fields))
                    equal(release.academic_year,offerings[0].get('academic_year'))
        for key,release in conversions.items():
            row=binding(release,key)
            rule_version=release.release.bindings.get((release.academic_year,key))
            equal(row.get('rule_version'),rule_version)
            rule=release.release.rules[rule_version].data
            if (rule.get('data_kind') != 'official_rule' or rule.get('review_status') != 'calculation_verified'
                    or any(t.get('status') != 'verified' for t in rule['tables'].values())):
                raise PlatformError('artifact_not_approved',503)
            equal(rule['academic_year'],release.academic_year)
            for metadata in [rule,*rule['tables'].values()]:
                for field in ('exam_id','source_pack_version'):
                    if metadata.get(field) is not None: equal(metadata[field],getattr(release,field))
                if metadata.get('rule_version') is not None: equal(metadata['rule_version'],rule_version)
            if rule.get('exam_type') is not None: equal(rule['exam_type'],release.exam_type)
        for key,release in percentiles.items():
            row=binding(release,key);metadata=release.curve.metadata
            if (metadata.get('status') != 'approved' or metadata.get('rule_review_status') != 'calculation_verified'
                    or metadata.get('complete') is not True or metadata.get('population_verified') is not True):
                raise PlatformError('artifact_not_approved',503)
            for field in ('academic_year','exam_id','rule_version'):
                equal(metadata[field],getattr(release,field))
            if metadata.get('source_pack_version') is not None:
                equal(metadata['source_pack_version'],release.source_pack_version)
            equal(row.get('rule_version'),release.rule_version)
            equal(row.get('curve_version'),metadata['curve_version'])
            if key in conversions:
                conversion=conversions[key];converted=binding(conversion,key)
                equal(context(release),context(conversion))
                equal(tuple(row.get(k) for k in identity_fields),tuple(converted.get(k) for k in identity_fields))
                equal(release.rule_version,conversion.release.bindings.get((conversion.academic_year,key)))
                rule=conversion.release.rules[release.rule_version].data
                for field in ('rule_id','rule_version','score_scope','score_scale_id','bonus_treatment'):
                    if rule.get(field) is not None: equal(metadata[field],rule[field])

    @staticmethod
    def _validate_analysis(data, raw):
        for kind,key in raw:
            if kind != 'analysis':continue
            release=data.get_analysis(key)
            years=[year for year,offering in release.offerings_by_year.items() if offering == key]
            if len(years) != 1:raise PlatformError('registry_identity_conflict',503)
            year=years[0];rule_version=release.release.bindings.get((year,key))
            if rule_version is None or year not in release.curves:
                raise PlatformError('runtime_dependency_missing',503)
            rule=release.release.rules[rule_version].data;metadata=release.curves[year].metadata
            if (rule.get('data_kind') != 'official_rule' or rule.get('review_status') != 'calculation_verified'
                    or any(t.get('status') != 'verified' for t in rule['tables'].values())
                    or metadata.get('status') != 'approved' or metadata.get('rule_review_status') != 'calculation_verified'
                    or metadata.get('complete') is not True or metadata.get('population_verified') is not True):
                raise PlatformError('artifact_not_approved',503)
            if (rule['academic_year'] != year or metadata['academic_year'] != year
                    or metadata['rule_version'] != rule_version or metadata['rule_id'] != rule['rule_id']
                    or any(rule.get(field) is not None and rule[field] != metadata.get(field)
                           for field in ('exam_id','score_scope','score_scale_id','bonus_treatment'))):
                raise PlatformError('artifact_version_mismatch',503)
            packs=[body['pack_version'] for (k,_),body in raw.items() if k == 'exam_pack']
            if packs and release.source_pack_version not in packs:
                raise PlatformError('artifact_version_mismatch',503)

    def missing(self, settings):
        result = [name for name in settings.missing() if name not in DRIVE_SETTINGS]
        if not result and self.probe()['status'] != 'verified':
            result.append('SUPABASE_RUNTIME_SELECTION')
        return result

def create_supabase_secured_app(*, security, settings, data, selection, repository=None,
                               sessions=None, clock=None, forecast_repository=None,
                               forecast_inputs=None, entitlements=None):
    from .http_api import _compose_app
    if type(settings) is not ServerSettings:
        raise PlatformError('storage_configuration_invalid', 503)
    policy = SupabaseRuntimeReadiness(data, selection)
    app = _compose_app(settings=settings, repository=repository, data=data, sessions=sessions,
                        clock=clock, forecast_repository=forecast_repository,
                        forecast_inputs=forecast_inputs, entitlements=entitlements,
                        boundary=SecuredBoundary(security), readiness_policy=policy)
    app.state.runtime_readiness = policy
    return app

STORAGE_ENVIRONMENT = ('SUPABASE_SECRET_KEY', 'JUNGSI_SUPABASE_STORAGE_BUCKET',
                       'JUNGSI_SUPABASE_STORAGE_PREFIX', 'JUNGSI_SUPABASE_RUNTIME_REGISTRY',
                       'JUNGSI_SUPABASE_RUNTIME_SELECTION')


def _private_path(value):
    if not isinstance(value, (str, Path)) or not str(value):
        raise PlatformError('registry_private_location_required', 503)
    path = Path(value).resolve()
    project = Path(__file__).resolve().parents[3]
    try: parts = path.relative_to(project).parts
    except ValueError: parts = path.parts
    if not any(part.lower() in ('resource','data','datas','outputs') for part in parts):
        raise PlatformError('registry_private_location_required', 503)
    return path


def configuration_status():
    """Names only; no filesystem, DB, Auth or Storage access."""
    missing = [name for name in ServerSettings.from_environment().missing() if name not in DRIVE_SETTINGS]
    missing.extend(name for name in STORAGE_ENVIRONMENT + ('JUNGSI_RELAY_TOKEN',) if not os.environ.get(name))
    return dict(status='configuration_pending' if missing else 'configured_not_verified',
                missing_settings=missing,production_ready=False)


def configured_supabase_app():
    """Opt-in Storage factory using the shared PostgreSQL pass authority."""
    from .secured_http import SecuritySettings
    from .supabase_storage import _json
    if configuration_status()['missing_settings']:
        raise PlatformError('storage_configuration_invalid', 503)
    settings = ServerSettings.from_environment()
    security = SecuritySettings.from_environment()
    registry = _private_path(os.environ['JUNGSI_SUPABASE_RUNTIME_REGISTRY'])
    selection_path = _private_path(os.environ['JUNGSI_SUPABASE_RUNTIME_SELECTION'])
    try:
        if selection_path.stat().st_size > 65536:
            raise PlatformError('registry_format_invalid', 503)
        selection = RuntimeArtifactSelection.from_manifest(_json(selection_path.read_bytes()))
        client = SupabaseStorageClient(settings.supabase_url,os.environ['SUPABASE_SECRET_KEY'],
                       os.environ['JUNGSI_SUPABASE_STORAGE_BUCKET'],
                       object_prefix=os.environ['JUNGSI_SUPABASE_STORAGE_PREFIX'])
        if registry.stat().st_size > MAX_ARTIFACT_BYTES:
            raise PlatformError('registry_format_invalid',503)
        data = SupabaseStorageDataProvider(client,_json(registry.read_bytes()))
    except PlatformError: raise
    except (OSError,ValueError,TypeError):
        raise PlatformError('storage_configuration_invalid',503) from None
    return create_supabase_secured_app(security=security,settings=settings,data=data,selection=selection)


REVIEW_STATUS_MAX_BYTES = 1024 * 1024
_REVIEW_PAGE_FIELDS = frozenset(('format', 'query_mode', 'count_status', 'status', 'items',
    'matching_observation_count', 'matching_source_school_count', 'review_version', 'as_of',
    'next_cursor', 'publication_status'))
_REVIEW_ITEM_FIELDS = frozenset(('observation_token', 'academic_year', 'university', 'department',
    'track', 'recruit_group', 'metric_kind', 'metric_value_literal', 'metric_value_json_type',
    'metric_value_numeric_text', 'cohort', 'statistic_label', 'source_member_count', 'link_scopes',
    'official_metadata', 'review_status', 'value_availability', 'hold_reasons'))
_REVIEW_METADATA_FIELDS = frozenset(('metric_definition', 'unit', 'original_scale', 'source_url',
    'source_as_of', 'publication_status'))
_REVIEW_PROVIDER_HOLDS = ('review_only_not_published', 'public_offering_mapping_not_qualified',
                        'official_metadata_not_qualified')
_REVIEW_AVAILABILITY = ('present', 'actual_null', 'missing', 'held')
_REVIEW_PUBLIC_LINK_KINDS = frozenset(('same_year_offering', 'verified_aggregate_offerings',
                                     'official_reorganized_forward_reference'))


def _review_capture_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate capture field')
        result[key] = value
    return result


def _review_capture_constant(_value):
    raise ValueError('non-finite capture number')


def _review_page_status(payload):
    """Summarize one captured v2 page; never probe, print data, or infer row approval."""
    try:
        if type(payload) is not bytes or not 0 < len(payload) <= REVIEW_STATUS_MAX_BYTES:
            raise ValueError('capture size')
        page = json.loads(payload.decode('utf-8'), object_pairs_hook=_review_capture_pairs,
                          parse_constant=_review_capture_constant)
        if (type(page) is not dict or set(page) != _REVIEW_PAGE_FIELDS or
                page['format'] != 'jungsi.current-admission-review-page/v2' or
                page['status'] != 'review' or page['query_mode'] != 'live_bounded' or
                page['publication_status'] != 'not_published' or page['count_status'] != 'unknown' or
                page['matching_observation_count'] is not None or page['matching_source_school_count'] is not None or
                type(page['items']) is not list or len(page['items']) > 100 or
                type(page['review_version']) is not str or
                re.fullmatch(r'[A-Za-z0-9_.:-]{1,128}', page['review_version']) is None or
                type(page['as_of']) is not str or len(page['as_of']) > 40 or
                page['next_cursor'] is not None and
                (type(page['next_cursor']) is not str or not 0 < len(page['next_cursor']) <= 4096)):
            raise ValueError('capture envelope')
        if re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)', page['as_of']) is None:
            raise ValueError('capture timestamp')
        instant = datetime.fromisoformat(page['as_of'].replace('Z', '+00:00'))
        if instant.tzinfo is None or instant.utcoffset() != timezone.utc.utcoffset(instant):
            raise ValueError('capture timestamp')
        availability = dict.fromkeys(_REVIEW_AVAILABILITY, 0)
        links = {}
        text_fields = _REVIEW_ITEM_FIELDS - {'observation_token', 'academic_year', 'source_member_count',
            'link_scopes', 'official_metadata', 'review_status', 'value_availability', 'hold_reasons'}
        for row in page['items']:
            if (type(row) is not dict or set(row) != _REVIEW_ITEM_FIELDS or
                    type(row['observation_token']) is not str or not row['observation_token'] or
                    type(row['academic_year']) is not int or row['academic_year'] not in (2024, 2025, 2026, 2027) or
                    type(row['source_member_count']) is not int or not 1 <= row['source_member_count'] <= 2**53 - 1 or
                    any(row[key] is not None and type(row[key]) is not str for key in text_fields) or
                    row['review_status'] != 'review_only' or row['value_availability'] not in _REVIEW_AVAILABILITY or
                    type(row['hold_reasons']) is not list or
                    any(type(reason) is not str for reason in row['hold_reasons']) or
                    not all(reason in row['hold_reasons'] for reason in _REVIEW_PROVIDER_HOLDS) or
                    type(row['official_metadata']) is not dict or set(row['official_metadata']) != _REVIEW_METADATA_FIELDS or
                    any(value is not None for value in row['official_metadata'].values()) or
                    type(row['link_scopes']) is not list):
                raise ValueError('capture item')
            state = row['value_availability']
            if state in ('held', 'missing'):
                if row['metric_value_literal'] is not None or row['metric_value_numeric_text'] is not None:
                    raise ValueError('held value exposed')
            elif state == 'actual_null':
                if (row['metric_value_literal'], row['metric_value_json_type'], row['metric_value_numeric_text']) != ('null', 'null', None):
                    raise ValueError('actual null')
            elif (not row['metric_value_literal'] or row['metric_value_json_type'] not in ('number', 'integer', 'decimal', 'string') or
                    row['metric_value_json_type'] != 'string' and row['metric_value_numeric_text'] is None):
                raise ValueError('present value')
            availability[state] += 1
            for link in row['link_scopes']:
                if (type(link) is not dict or set(link) != {'link_kind', 'population_reference_year', 'individual_offering_metric_inference_allowed'} or
                        type(link['link_kind']) is not str or not link['link_kind'] or len(link['link_kind']) > 100 or
                        any(ord(char) < 32 or ord(char) == 127 for char in link['link_kind']) or
                        type(link['population_reference_year']) is not int or
                        not -(2**53 - 1) <= link['population_reference_year'] <= 2**53 - 1 or
                        type(link['individual_offering_metric_inference_allowed']) is not bool):
                    raise ValueError('capture population link')
                kind = link['link_kind'] if link['link_kind'] in _REVIEW_PUBLIC_LINK_KINDS else 'unknown'
                key = (kind, link['population_reference_year'], link['individual_offering_metric_inference_allowed'])
                links[key] = links.get(key, 0) + 1
        return dict(format='jungsi.current-review-local-status/v1', evidence_mode='captured_response_not_fresh_probe',
            fresh_DB_probe='NOT_RUN', publication_status=page['publication_status'], query_mode=page['query_mode'],
            review_version=page['review_version'], as_of=instant.isoformat(), count_status='unknown',
            matching_observation_count=None, matching_source_school_count=None, rows_in_page=len(page['items']),
            value_availability_counts=availability, next_page_available=page['next_cursor'] is not None,
            provider_hold_reasons=list(_REVIEW_PROVIDER_HOLDS), source_review_status='NOT_EXPOSED',
            original_metadata_review_status='NOT_EXPOSED',
            review_badge_meaning='검수 전용 공급자의 표시 제한이며 원본 각 행의 검수 상태를 뜻하지 않음',
            count_meaning='전국 건수는 미계산이며 집계는 이 반환 페이지 안에서만 수행',
            value_availability_meaning='present는 표시 가능한 값 상태이며 유효한 성적 또는 공식 검수 통과를 뜻하지 않음',
            population_links=[dict(link_kind=kind, population_reference_year=year,
                individual_offering_metric_inference_allowed=allowed, links_in_page=count)
                for (kind, year, allowed), count in sorted(links.items())])
    except (ValueError, TypeError, KeyError, OverflowError, RecursionError):
        raise PlatformError('local_review_capture_invalid', 503) from None


def review_status_from_file(value):
    """Read only a bounded private capture; no env, network, DB, or output files."""
    try:
        path = _private_path(value)
        if not 0 < path.stat().st_size <= REVIEW_STATUS_MAX_BYTES:
            raise ValueError('capture size')
        with path.open('rb') as stream:
            payload = stream.read(REVIEW_STATUS_MAX_BYTES + 1)
        return _review_page_status(payload)
    except (OSError, ValueError, PlatformError):
        raise PlatformError('local_review_capture_invalid', 503) from None


_PAGE_READINESS_SETTINGS = ('SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'DATABASE_URL',
    'SUPABASE_SECRET_KEY', 'JUNGSI_SUPABASE_STORAGE_BUCKET', 'JUNGSI_SUPABASE_STORAGE_PREFIX',
    'JUNGSI_SUPABASE_RUNTIME_REGISTRY', 'JUNGSI_SUPABASE_RUNTIME_SELECTION', 'JUNGSI_RELAY_TOKEN')
_PAGE_READINESS_CAPABILITIES = (
    (1, '/admissions/results', (
        ('official_history_and_recruitment', ('catalog',)),)),
    (2, '/reports/me', (
        ('subject_scores', ('exam_pack',)),
        ('overall_percentile', ('exam_pack', 'total_model')))),
    (3, '/admissions/possibilities', (
        ('converted_score', ('catalog', 'exam_pack', 'conversion')),
        ('converted_percentile', ('catalog', 'exam_pack', 'conversion', 'percentile')),
        ('assessment', ('catalog', 'exam_pack', 'analysis')),
        ('published_forecast_basis', ('forecast_context', 'forecast_inputs', 'forecast_policy')))),
    (4, '/admissions/favorable', (
        ('conversion_advantage', ('catalog', 'exam_pack', 'conversion', 'percentile', 'analysis')),
        ('recommended_candidates', ('catalog', 'exam_pack', 'conversion', 'percentile', 'analysis')),
        ('advantage_baseline', ('exam_pack', 'total_model')),
        ('overall_percentile_basis', ('exam_pack', 'total_model')),
        ('published_forecast_basis', ('forecast_context', 'forecast_inputs', 'forecast_policy')))))
_PAGE_ENTRY_STATES = ('eligible_metadata_only', 'unverified_storage_scope', 'not_approved',
                      'missing', 'invalid_reference')


def _page_metadata_file(value):
    """Bounded private metadata only; do not follow artifact or source pointers."""
    if not value:
        return 'missing', None
    try:
        path = _private_path(value)
        if not 0 < path.stat().st_size <= REVIEW_STATUS_MAX_BYTES:
            raise ValueError('metadata size')
        with path.open('rb') as stream:
            content = stream.read(REVIEW_STATUS_MAX_BYTES + 1)
        if not 0 < len(content) <= REVIEW_STATUS_MAX_BYTES:
            raise ValueError('metadata size')
        body = json.loads(content.decode('utf-8'), object_pairs_hook=_review_capture_pairs,
                          parse_constant=_review_capture_constant)
        if type(body) is not dict:
            raise ValueError('metadata shape')
        return 'read', body
    except FileNotFoundError:
        return 'missing', None
    except (OSError, ValueError, TypeError, RecursionError):
        return 'invalid', None


def _page_entry_status(entry, identity, client):
    """Check reference/approval metadata; no remote bytes or native decoding."""
    from .supabase_storage import _object_key
    if entry is None:
        return 'missing'
    try:
        if type(entry) is not dict or (entry.get('kind'), entry.get('key')) != identity:
            raise ValueError('reference identity')
        if (entry.get('status') != 'approved' or entry.get('engine_approved') is not True or
                entry.get('production_allowed') is not True or entry.get('archive_only') is not False):
            return 'not_approved'
        if (type(entry.get('bytes')) is not int or not 0 < entry['bytes'] <= MAX_ARTIFACT_BYTES or
                type(entry.get('sha256')) is not str or re.fullmatch(r'[0-9a-f]{64}', entry['sha256']) is None or
                type(entry.get('version')) is not str or not entry['version'] or
                type(entry.get('bucket')) is not str or re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,99}', entry['bucket']) is None):
            raise ValueError('reference metadata')
        _object_key(entry.get('object_key'))
        if identity[0] == 'catalog' and identity[1] != 'service':
            raise ValueError('catalog key')
        if client is None:
            return 'unverified_storage_scope'
        client.validate_reference(entry)
        return 'eligible_metadata_only'
    except (ValueError, TypeError, KeyError):
        return 'invalid_reference'


def four_page_readiness():
    """Expose four independent metadata checklists, never real connection success.

    This private CLI reads setting existence and two bounded local manifests.
    No client artifact/probe method, DB/Auth call, source file, decoder, .env
    loader, or application factory is invoked. Missing inputs remain visible
    for every page and may not be used to suppress already available results.
    """
    def no_remote_reads(*_args, **_kwargs):
        raise PlatformError('page_readiness_metadata_only', 503)
    values = {name: os.environ.get(name) for name in _PAGE_READINESS_SETTINGS}
    missing_settings = [name for name in _PAGE_READINESS_SETTINGS if not values[name]]
    connection = 'configuration_missing' if missing_settings else 'configured_not_verified'
    registry_status, registry = _page_metadata_file(values['JUNGSI_SUPABASE_RUNTIME_REGISTRY'])
    selection_status, manifest = _page_metadata_file(values['JUNGSI_SUPABASE_RUNTIME_SELECTION'])
    entries, required = {}, None
    if registry_status == 'read':
        try:
            if registry.get('format') != 'jungsi.data-registry/v1' or type(registry.get('entries')) is not list:
                raise ValueError('registry shape')
            # Reuse the existing metadata identity/hash guard without a client.
            # Its constructor never reads referenced artifacts for a dict input.
            entries = DriveDataProvider(None, registry).entries
        except (ValueError, TypeError, KeyError):
            registry_status = 'invalid'
    if selection_status == 'read':
        try:
            required = RuntimeArtifactSelection.from_manifest(manifest).required
        except (ValueError, TypeError, KeyError):
            selection_status = 'invalid'
    client, scope = None, 'not_configured'
    storage_names = ('SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'JUNGSI_SUPABASE_STORAGE_BUCKET',
                     'JUNGSI_SUPABASE_STORAGE_PREFIX')
    if all(values[name] for name in storage_names):
        try:
            client = SupabaseStorageClient(values['SUPABASE_URL'], values['SUPABASE_SECRET_KEY'],
                values['JUNGSI_SUPABASE_STORAGE_BUCKET'], object_prefix=values['JUNGSI_SUPABASE_STORAGE_PREFIX'],
                opener=no_remote_reads)
            scope = 'reference_scope_only_not_bucket_verified'
        except (ValueError, TypeError):
            scope = 'invalid_configuration'
    kinds = {}
    for kind in sorted(RUNTIME_KINDS):
        selected = None if required is None else [identity for identity in required if identity[0] == kind]
        counts = dict.fromkeys(_PAGE_ENTRY_STATES, 0)
        if selected is None or registry_status != 'read':
            status = 'metadata_unavailable'
        elif not selected:
            status = 'not_selected'
        else:
            for identity in selected:
                counts[_page_entry_status(entries.get(identity), identity, client)] += 1
            if scope == 'invalid_configuration':
                counts['invalid_reference'] += counts['unverified_storage_scope']
                counts['unverified_storage_scope'] = 0
            eligible = counts['eligible_metadata_only']
            status = ('eligible_metadata_only' if eligible == len(selected) else
                      'partially_eligible' if eligible else 'blocked')
        kinds[kind] = dict(kind=kind, selected_count=None if selected is None else len(selected),
            metadata_status=status, selected_entry_status_counts=counts, native_decode='NOT_RUN',
            version_and_exam_binding='NOT_RUN', coverage='selected_scope_only_not_nationwide')
    pages = []
    for number, path, definitions in _PAGE_READINESS_CAPABILITIES:
        capabilities = []
        for capability, dependencies in definitions:
            missing = [kind for kind in dependencies if kinds[kind]['metadata_status'] == 'not_selected']
            blocked = [kind for kind in dependencies if kinds[kind]['metadata_status'] not in ('eligible_metadata_only', 'not_selected')]
            status = ('eligible_metadata_only' if not missing and not blocked else
                      'metadata_unavailable' if any(kinds[kind]['metadata_status'] == 'metadata_unavailable' for kind in dependencies) else
                      'missing' if missing else 'blocked')
            item = dict(capability=capability, required_kinds=list(dependencies),
                metadata_status=status, missing_kinds=missing, blocked_kinds=blocked,
                native_decode='NOT_RUN', cross_bindings='NOT_RUN', actual_calculation='NOT_RUN')
            if number == 4 and capability in ('conversion_advantage', 'recommended_candidates'):
                # Direct scoring may survive a missing standalone total model.
                # The existing evaluator can use a separately validated target
                # total distribution embedded in analysis; metadata cannot
                # prove that baseline or its population/binding compatibility.
                item.update(overall_baseline_possible_source='standalone_total_model_or_validated_embedded_analysis_target_total',
                    standalone_total_model_status=kinds['total_model']['metadata_status'],
                    embedded_analysis_baseline='NOT_CHECKED')
            capabilities.append(item)
        pages.append(dict(page_number=number, path=path, connection=connection,
            missing_settings=list(missing_settings), capabilities=capabilities, ready=False,
            runtime_connection='NOT_RUN', browser='NOT_RUN', coverage='selected_scope_only_not_nationwide'))
    return dict(format='jungsi.four-page-local-readiness/v1', evidence_mode='local_metadata_only_not_live_probe',
        check_target='configured_supabase_native_metadata_not_local_verification',
        local_purpose_native_approval='NOT_CHECKED',
        registry=registry_status, selection=selection_status, storage_scope=scope,
        database='NOT_RUN', authentication='NOT_RUN', storage_objects='NOT_RUN', engine='NOT_RUN',
        current_catalog_binding='NOT_RUN', production_ready=False, pages=pages, kinds=list(kinds.values()),
        meaning='명시 Supabase factory의 네 페이지 최소 선택 메타데이터 점검이며 로컬 목적 승인·실제 연결·산출·전국 범위·일반 공개 완료를 뜻하지 않음')


def main(argv=None):
    import argparse
    parser = argparse.ArgumentParser(description='Explicit Supabase configuration or private captured review status; no live probes.')
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument('--check-config', action='store_true', help='settings names only; no filesystem or live probes')
    modes.add_argument('--review-status-file', help='one private captured v2 JSON; no actual values or opaque tokens printed')
    modes.add_argument('--page-readiness', action='store_true', help='four-page local setting/reference metadata only; no live probes')
    args = parser.parse_args(argv)
    try:
        result = (configuration_status() if args.check_config else four_page_readiness() if args.page_readiness else
                  review_status_from_file(args.review_status_file))
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except PlatformError:
        print(json.dumps(dict(status='error', error={'code':'local_review_capture_invalid'})))
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
