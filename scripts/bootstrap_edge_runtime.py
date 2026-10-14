"""Supply a hash-pinned official Deno binary in a fresh retained directory.

No shell installer, system installation, cleanup, version fallback, or overwrite.
CI calls this explicitly; local hooks keep using their explicitly configured Deno.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import stat
import subprocess
import sys
import urllib.request
import zipfile

VERSION = "2.9.7"
FORMAT = "jungsi.edge-runtime-lock/v1"
RELEASE = "https://github.com/denoland/deno/releases/download/v" + VERSION + "/"
TARGETS = {"linux": ("deno-x86_64-unknown-linux-gnu.zip", "deno"),
           "win32": ("deno-x86_64-pc-windows-msvc.zip", "deno.exe")}


def checked_destination(destination):
    """Refuse any existing target or linked ancestor before creating files."""
    raw = Path(os.path.abspath(destination))
    for part in [raw, *raw.parents]:
        if part.is_symlink() or part.is_junction():
            raise ValueError("Runtime destination must not traverse a link")
    if raw.exists():
        raise FileExistsError("Existing runtime is preserved; choose a fresh destination")
    return raw


def read_lock(lock_path, system, machine):
    if machine.lower() not in {"amd64", "x86_64"} or system not in TARGETS:
        raise ValueError("This lock supports Linux and Windows x64 only")
    lock = json.loads(Path(lock_path).read_text(encoding="utf-8"))
    if lock.get("format") != FORMAT or lock.get("version") != VERSION:
        raise ValueError("The fixed Deno lock version is required")
    name, member = TARGETS[system]
    asset = lock.get("assets", {}).get(system)
    if (not isinstance(asset, dict) or asset.get("filename") != name or
            asset.get("url") != RELEASE + name or
            not re.fullmatch(r"[0-9a-f]{64}", str(asset.get("sha256", ""))) or
            type(asset.get("bytes")) is not int or not 0 < asset["bytes"] < 80_000_000):
        raise ValueError("Invalid fixed official Deno asset")
    return asset, member


def download_asset(url, limit):
    with urllib.request.urlopen(url, timeout=60) as response:
        return response.read(limit + 1)


def probe_version(executable, destination):
    allowed = {"PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "LANG", "LC_ALL"}
    environment = {key: value for key, value in os.environ.items() if key.upper() in allowed}
    environment.update(DENO_NO_UPDATE_CHECK="1", DENO_DIR=str(destination / "cache"))
    result = subprocess.run([str(executable), "--version"], capture_output=True,
                            text=True, timeout=30, env=environment, cwd=destination)
    if result.returncode:
        raise RuntimeError("Pinned Deno version probe failed")
    first = result.stdout.splitlines()[0] if result.stdout else ""
    if first != "deno " + VERSION + " (stable, release, " + (
            "x86_64-pc-windows-msvc" if executable.name.endswith(".exe") else
            "x86_64-unknown-linux-gnu") + ")":
        raise RuntimeError("Pinned Deno version or target mismatch")
    return VERSION


def bootstrap(destination, lock_path="edge-runtime.lock.json", *, system=None, machine=None,
              downloader=download_asset, version_probe=probe_version):
    asset, member = read_lock(lock_path, system or sys.platform, machine or platform.machine())
    destination = checked_destination(destination)
    destination.mkdir(parents=True, exist_ok=False)
    payload = downloader(asset["url"], asset["bytes"])
    archive = destination / asset["filename"]
    with archive.open("xb") as output:
        output.write(payload)
    digest = hashlib.sha256(payload).hexdigest()
    if len(payload) != asset["bytes"] or digest != asset["sha256"]:
        raise ValueError("Deno archive hash or size mismatch; downloaded evidence is preserved")
    with zipfile.ZipFile(archive) as zipped:
        rows = zipped.infolist()
        if (len(rows) != 1 or rows[0].filename != member or rows[0].is_dir() or
                rows[0].file_size <= 0 or rows[0].file_size > 250_000_000 or
                stat.S_ISLNK(rows[0].external_attr >> 16)):
            raise ValueError("Deno archive must contain exactly the regular pinned executable")
        body = zipped.read(rows[0])
    binary_dir = destination / "bin"
    binary_dir.mkdir(exist_ok=False)
    executable = binary_dir / member
    with executable.open("xb") as output:
        output.write(body)
    if member == "deno":
        executable.chmod(0o755)
    version = version_probe(executable, destination)
    receipt = {"format": "jungsi.edge-runtime-receipt/v1", "version": version,
               "status": "PINNED_RUNTIME_SUPPLIED_NOT_SUITE_PROOF",
               "archive": {"name": asset["filename"], "url": asset["url"],
                           "bytes": len(payload), "sha256": digest},
               "executable": {"path": str(executable), "bytes": len(body),
                              "sha256": hashlib.sha256(body).hexdigest()},
               "fresh_destination": True, "cleanup": False}
    with (destination / "receipt.json").open("x", encoding="utf-8") as output:
        json.dump(receipt, output, ensure_ascii=False, indent=2)
        output.write("\n")
    return executable


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--destination", required=True)
    parser.add_argument("--lock", default="edge-runtime.lock.json")
    args = parser.parse_args()
    print(json.dumps({"executable": str(bootstrap(args.destination, args.lock)),
                      "version": VERSION, "suite_executed": False}))
