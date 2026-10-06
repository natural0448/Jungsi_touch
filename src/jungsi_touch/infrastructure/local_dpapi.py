"""Current-user Windows DPAPI; no passwords, plaintext cache or dependencies.

Create the cache on the receiving PC under its own Windows account. This is
file-at-rest protection, not isolation from that account or an administrator.
"""
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
from ..application.platform_ports import PlatformError

MAGIC = b'JUNGSI-LOCAL-DPAPI-1\n'
LIMIT = 128 * 1024 * 1024


class Blob(ctypes.Structure):
    _fields_ = [('size', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_ubyte))]


class WindowsDpapi:
    def _transform(self, data, protect):
        if os.name != 'nt':
            raise PlatformError('local_windows_dpapi_required', 503)
        if not isinstance(data, bytes) or not data or len(data) > LIMIT:
            raise PlatformError('local_cache_size_invalid', 503)
        crypto = ctypes.WinDLL('crypt32', use_last_error=True)
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.LocalFree.argtypes = [ctypes.c_void_p]
        kernel.LocalFree.restype = ctypes.c_void_p
        function = crypto.CryptProtectData if protect else crypto.CryptUnprotectData
        function.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.POINTER(Blob),
                             ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
        function.restype = wintypes.BOOL
        buffer = (ctypes.c_ubyte * len(data)).from_buffer_copy(data)
        source = Blob(len(data), buffer)
        result = Blob()
        try:
            # UI forbidden; deliberately never CRYPTPROTECT_LOCAL_MACHINE.
            if not function(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(result)):
                raise PlatformError('local_dpapi_failed', 503)
            if not result.size or result.size > LIMIT:
                raise PlatformError('local_cache_size_invalid', 503)
            return ctypes.string_at(result.data, result.size)
        finally:
            ctypes.memset(buffer, 0, len(data))
            if result.data:
                ctypes.memset(result.data, 0, result.size)
                kernel.LocalFree(result.data)

    def protect(self, data):
        return self._transform(data, True)

    def unprotect(self, data):
        return self._transform(data, False)


def private_path(path):
    resolved = Path(path).resolve()
    if not any(p.lower() in ('data', 'datas', 'outputs', 'resource') for p in resolved.parts):
        raise PlatformError('local_private_location_required', 503)
    return resolved


def read_bounded(path):
    with private_path(path).open('rb') as stream:
        content = stream.read(LIMIT + 1)
    if not content or len(content) > LIMIT:
        raise PlatformError('local_cache_size_invalid', 503)
    return content


def write_sealed_new(path, value):
    destination = private_path(path)
    content = json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    encrypted = WindowsDpapi().protect(content)
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Never overwrite, delete, rotate or leave a plaintext staging file.
    with destination.open('xb') as stream:
        stream.write(MAGIC + encrypted)


def read_sealed(path):
    encrypted = read_bounded(path)
    if not encrypted.startswith(MAGIC):
        raise PlatformError('local_encrypted_cache_required', 503)
    try:
        value = json.loads(WindowsDpapi().unprotect(encrypted[len(MAGIC):]))
        if not isinstance(value, dict):
            raise ValueError()
        return value
    except (ValueError, UnicodeError) as error:
        raise PlatformError('local_cache_invalid', 503) from error
