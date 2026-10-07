"""Server-only GET adapter for explicitly approved private Storage artifacts.

No upload, overwrite, delete, signed/public URL, environment default or adoption
operation. The existing application data port and release decoders are reused.
"""
from hashlib import sha256
import json
import re
from urllib.error import HTTPError
from urllib.parse import quote, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from ..application.platform_ports import PlatformError
from .drive_provider import DriveDataProvider


MAX_ARTIFACT_BYTES = 32 * 1024 * 1024
MAX_BUCKET_BYTES = 50 * 1024 * 1024


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        raise HTTPError(request.full_url, code, 'redirect refused', headers, fp)


def _object_key(value):
    try:
        length = len(value.encode('utf-8')) if isinstance(value, str) else 0
    except UnicodeError:
        raise PlatformError('storage_reference_invalid', 503) from None
    if (not isinstance(value, str) or not value or length > 1024
            or '\\' in value or '%' in value or any(ord(char) < 32 or ord(char) == 127 for char in value)
            or any(part in ('', '.', '..') for part in value.split('/'))):
        raise PlatformError('storage_reference_invalid', 503)
    return value


def _json(content):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('duplicate field')
            result[key] = value
        return result

    def constant(value):
        raise ValueError('non-finite number')

    try:
        result = json.loads(content, object_pairs_hook=pairs, parse_constant=constant)
    except (ValueError, TypeError, UnicodeError, RecursionError):
        raise PlatformError('storage_artifact_invalid', 503) from None
    if not isinstance(result, dict):
        raise PlatformError('storage_artifact_invalid', 503)
    return result


class SupabaseStorageClient:
    def __init__(self, url, secret_key, bucket, *, object_prefix, opener=None):
        try:
            parsed = urlsplit(url or '')
        except (ValueError, TypeError):
            raise PlatformError('storage_configuration_invalid', 503) from None
        if (parsed.scheme != 'https' or not re.fullmatch(r'[a-z0-9-]+\.supabase\.co', parsed.netloc)
                or parsed.path not in ('', '/') or parsed.query or parsed.fragment):
            raise PlatformError('storage_configuration_invalid', 503)
        if (not isinstance(secret_key, str) or not secret_key.startswith('sb_secret_')
                or len(secret_key) > 4096 or any(char.isspace() for char in secret_key)):
            raise PlatformError('storage_configuration_invalid', 503)
        if not isinstance(bucket, str) or not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,99}', bucket):
            raise PlatformError('storage_configuration_invalid', 503)
        if not isinstance(object_prefix, str) or not object_prefix.endswith('/'):
            raise PlatformError('storage_configuration_invalid', 503)
        _object_key(object_prefix[:-1])
        self._url, self._key, self._bucket, self._prefix = url.rstrip('/'), secret_key, bucket, object_prefix
        self._open = opener or build_opener(_NoRedirect()).open

    def _call(self, path, limit):
        url = self._url + '/storage/v1/' + path
        request = Request(url, method='GET', headers={'apikey': self._key, 'Accept': 'application/json'})
        try:
            with self._open(request, timeout=10) as response:
                if response.geturl() != url or response.status != 200:
                    raise PlatformError('storage_unavailable', 503)
                content = response.read(limit + 1)
            if len(content) > limit:
                raise PlatformError('storage_artifact_too_large', 503)
            return content
        except PlatformError:
            raise
        except (OSError, ValueError, TypeError):
            raise PlatformError('storage_unavailable', 503) from None

    def validate_reference(self, entry):
        if not isinstance(entry, dict):
            raise PlatformError('storage_reference_invalid', 503)
        key = _object_key(entry.get('object_key'))
        if entry.get('bucket') != self._bucket or not key.startswith(self._prefix):
            raise PlatformError('storage_reference_scope_mismatch', 503)
        if (type(entry.get('bytes')) is not int or entry['bytes'] <= 0
                or not isinstance(entry.get('sha256'), str)
                or not re.fullmatch(r'[0-9a-f]{64}', entry['sha256'])
                or not isinstance(entry.get('version'), str) or not entry['version']):
            raise PlatformError('storage_reference_invalid', 503)
        return key

    def artifact(self, entry):
        key = self.validate_reference(entry)
        if (entry.get('status') != 'approved' or entry.get('engine_approved') is not True
                or entry.get('production_allowed') is not True):
            raise PlatformError('artifact_not_approved', 503)
        if entry.get('archive_only') is True:
            raise PlatformError('storage_archive_only', 503)
        if entry.get('archive_only') is not False:
            raise PlatformError('storage_reference_invalid', 503)
        if entry['bytes'] > MAX_ARTIFACT_BYTES:
            raise PlatformError('storage_artifact_too_large', 503)
        bucket = _json(self._call('bucket/' + quote(self._bucket, safe=''), 65536))
        if bucket.get('id') != self._bucket or bucket.get('public') is not False:
            raise PlatformError('storage_bucket_not_private', 503)
        cap = bucket.get('file_size_limit')
        if type(cap) is not int or not 0 < cap <= MAX_BUCKET_BYTES or entry['bytes'] > cap:
            raise PlatformError('storage_bucket_limit_unverified', 503)
        path = 'object/authenticated/' + quote(self._bucket, safe='') + '/' + quote(key, safe='/')
        content = self._call(path, entry['bytes'])
        if len(content) != entry['bytes']:
            raise PlatformError('storage_size_mismatch', 503)
        if sha256(content).hexdigest() != entry['sha256']:
            raise PlatformError('storage_hash_mismatch', 503)
        return _json(content), {'verified_sha256': entry['sha256'], 'verified_bytes': len(content)}


class SupabaseStorageDataProvider(DriveDataProvider):
    """Existing pinned registry/decoders with explicit Storage references.

    Registry format remains jungsi.data-registry/v1. No Drive reference is
    transformed automatically. Staged/archive rows may be retained but cannot
    feed an application operation. Only explicit server injection enables use.
    """
    def __init__(self, client, registry):
        try:
            super().__init__(client, registry)
        except PlatformError:
            raise
        except OSError:
            raise PlatformError('storage_registry_unavailable', 503) from None
        except (ValueError, TypeError, KeyError, AttributeError):
            raise PlatformError('registry_format_invalid', 503) from None
        for entry in self.entries.values():
            client.validate_reference(entry)
