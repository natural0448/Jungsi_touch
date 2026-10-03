"""Extract hash-pinned public wheels into a fresh retained runtime, no cleanup.

CPython 3.12 on Windows/Linux x64. Keep downloads and all previous runtime folders.
Print the site path; set PYTHONPATH to it for the server and snapshot test runner.
"""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import platform
import sys
import urllib.request
import zipfile


def bootstrap(destination, lock_path):
    if sys.version_info[:2] != (3, 12) or platform.machine().lower() not in ('amd64', 'x86_64'):
        raise ValueError('This lock supports CPython 3.12 x64 only')
    destination = Path(destination).resolve()
    destination.mkdir(parents=True, exist_ok=False)
    wheels, site = destination / 'wheels', destination / 'site'
    wheels.mkdir(); site.mkdir()
    lock = json.loads(Path(lock_path).read_text(encoding='utf-8'))
    for package in lock['packages']:
        candidates = [w for w in package['wheels'] if w['filename'].endswith('none-any.whl') or
                      ('win_amd64' in w['filename'] if sys.platform == 'win32' else 'manylinux' in w['filename'])]
        if len(candidates) != 1:
            raise ValueError('No unique wheel for '+package['name'])
        wheel = candidates[0]
        if not wheel['url'].startswith('https://files.pythonhosted.org/'):
            raise ValueError('Untrusted wheel host')
        with urllib.request.urlopen(wheel['url'], timeout=60) as response:
            content = response.read()
        if hashlib.sha256(content).hexdigest() != wheel['sha256']:
            raise ValueError('Wheel hash mismatch')
        archive = wheels / wheel['filename']
        with archive.open('xb') as file: file.write(content)
        with zipfile.ZipFile(archive) as zipped:
            for member in zipped.infolist():
                path = PurePosixPath(member.filename)
                if path.is_absolute() or '..' in path.parts or '\\' in member.filename:
                    raise ValueError('Invalid wheel member')
                if member.is_dir(): continue
                target = site.joinpath(*path.parts)
                target.parent.mkdir(parents=True, exist_ok=True)
                with target.open('xb') as file: file.write(zipped.read(member))
    return site


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--destination', required=True)
    parser.add_argument('--lock', default='backend-runtime.lock.json')
    args = parser.parse_args()
    print(bootstrap(args.destination, args.lock))
