"""Explicit, read-only Supabase native selection and protected readiness."""
from copy import deepcopy
from dataclasses import dataclass
import json
import os
from pathlib import Path
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
    """Opt-in Uvicorn factory. The legacy configured_app remains unchanged."""
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


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Explicit Supabase backend configuration check; no live probes.')
    parser.add_argument('--check-config',action='store_true',required=True)
    parser.parse_args()
    print(json.dumps(configuration_status(),ensure_ascii=False))
