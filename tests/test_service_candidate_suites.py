"""Review-only bridge for three pinned synthetic suites; no skip on failures."""
from __future__ import annotations
import hashlib
import io
import platform
import stat
import zipfile
import json
import os
import re
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "tests/review_suite_manifest.json"
MANIFEST_SHA256 = "03e17c4a184dccae1bb1f58613678b36811ef4a915d5b56dd4062d60840ad5f6"
EDGE_RUNTIME_LOCK_SHA256 = "75981218812cb43e87ca2425da4d5efaa12d05db4acfd58b882a579483f02c98"
DENO = None
DENO_SHA256 = None
CONFIG = "supabase/functions/deno.json"
GENERATED_ROUTE = "src/jungsi_touch/application/route_catalog.json"
GENERATED_ROUTE_MARKER = "GENERATED_BY_SPEC_VIA_COMMON_GATE"
NODE_ALLOWED = ["node:assert/strict", "node:fs", "node:zlib"]
SERVICE_ROOTS = ["tests/service_end/" + name for name in (
    "test_service_end_current_review.synthetic.ts", "test_service_end_entrypoints.synthetic.ts",
    "test_service_end_error_schema.synthetic.ts", "test_service_end_http.synthetic.ts",
    "test_service_end_official_display.synthetic.ts", "test_service_end_professional.synthetic.ts",
    "test_service_end_runtime.synthetic.ts", "test_official_display_final_expiry.synthetic.ts",
)]
P1_ROOTS = ["tests/p1_review/test_p1_r27_portable_v2_gate.synthetic.v3.mjs", "tests/p1_review/test_p1_r27_release_gate.synthetic.mjs", "tests/p1_review/test_p1_r27_source_concurrency.synthetic.mjs"]
SEARCH_ROOTS = ["tests/search503/test_combined_search503_end.synthetic.v5.mjs",
                "tests/search503/test_search503_stream_limits.synthetic.v4.mjs",
                "tests/search503/test_search503_reader_unlock.synthetic.v3.mjs",
                "tests/search503/test_search503_final_error.synthetic.v2.mjs",
                "tests/search503/test_current_public_key_index_immutable.synthetic.v2.mjs"]

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def safe_file(name):
    if not isinstance(name, str) or not name or "\\" in name or ":" in name:
        raise ValueError("invalid local path")
    rel = Path(name)
    if rel.is_absolute() or ".." in rel.parts or rel.as_posix() != name:
        raise ValueError("invalid local path")
    p = ROOT / rel
    if not p.is_file() or any(x.is_symlink() for x in [p, *p.parents]):
        raise ValueError("missing or symlinked input: " + name)
    if not p.resolve().is_relative_to(ROOT.resolve()):
        raise ValueError("input leaves reviewed project")
    return p

def verify_generated_route():
    # This JSON embeds the spec digest; the exact common generator is its non-cyclic binding.
    sys.path.insert(0, str(ROOT / "scripts"))
    from check_project_consistency import generated_files
    spec = json.loads(safe_file("docs/current/service_spec.json").read_bytes())
    expected = generated_files(spec, read=lambda path: safe_file(path).read_bytes()).get(GENERATED_ROUTE)
    if expected is None or safe_file(GENERATED_ROUTE).read_bytes() != expected:
        raise ValueError("generated route catalog mismatch")

def bound_digest(name):
    return GENERATED_ROUTE_MARKER if name == GENERATED_ROUTE else sha(safe_file(name))

def scratch_root():
    raw = os.environ.get("JUNGSI_REVIEW_SUITE_SCRATCH")
    if not raw or not Path(raw).is_absolute():
        raise ValueError("runner-provided scratch is required")
    root = Path(raw)
    if (not root.is_dir() or any(x.is_symlink() or x.is_junction() for x in [root, *root.parents]) or
            root.resolve().is_relative_to(ROOT.resolve())):
        raise ValueError("scratch is unavailable, linked, or inside snapshot")
    for part in ("cache", "tmp"):
        p = root / part
        if not p.is_dir() or p.is_symlink() or p.is_junction() or not p.resolve().is_relative_to(root.resolve()):
            raise ValueError("runner scratch subdirectory invalid")
    return root.resolve()


def isolated_env():
    root = scratch_root()
    return {"DENO_DIR": str(root / "cache"), "TEMP": str(root / "tmp"), "TMP": str(root / "tmp"),
            "TMPDIR": str(root / "tmp"), "DENO_NO_UPDATE_CHECK": "1", "NO_COLOR": "1",
            "SYSTEMROOT": os.environ.get("SYSTEMROOT", ""), "PATH": os.environ.get("PATH", "")}


def verify_linux_asset(lock, archive_bytes, executable_bytes):
    asset = lock["assets"]["linux"]
    name = "deno-x86_64-unknown-linux-gnu.zip"
    if (lock.get("format") != "jungsi.edge-runtime-lock/v1" or lock.get("version") != "2.9.7" or
            asset.get("filename") != name or
            asset.get("url") != "https://github.com/denoland/deno/releases/download/v2.9.7/" + name or
            type(asset.get("bytes")) is not int or not 0 < asset["bytes"] < 80_000_000 or
            len(archive_bytes) != asset["bytes"] or hashlib.sha256(archive_bytes).hexdigest() != asset.get("sha256")):
        raise ValueError("Linux Deno archive lock mismatch")
    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as z:
        rows = z.infolist()
        if (len(rows) != 1 or rows[0].filename != "deno" or rows[0].is_dir() or
                not 0 < rows[0].file_size < 250_000_000 or stat.S_ISLNK(rows[0].external_attr >> 16)):
            raise ValueError("Linux Deno archive member invalid")
        if hashlib.sha256(z.read(rows[0])).digest() != hashlib.sha256(executable_bytes).digest():
            raise ValueError("Linux Deno executable differs from pinned archive")


def selected_runtime(data):
    raw = os.environ.get("JUNGSI_DENO")
    if not raw or not Path(raw).is_absolute():
        raise ValueError("runner-provided Deno is required")
    exe = Path(raw)
    if not exe.is_file() or any(x.is_symlink() or x.is_junction() for x in [exe, *exe.parents]):
        raise ValueError("Deno executable unavailable or linked")
    if platform.machine().lower() not in {"amd64", "x86_64"}:
        raise ValueError("unregistered runtime architecture")
    raw_binary = exe.read_bytes()
    digest = hashlib.sha256(raw_binary).hexdigest()
    if sys.platform == "win32":
        if digest != data["runtime"]["deno_sha256"]:
            raise ValueError("Windows Deno digest mismatch")
        target = "x86_64-pc-windows-msvc"
    elif sys.platform == "linux":
        lock_raw = safe_file("edge-runtime.lock.json").read_bytes()
        if hashlib.sha256(lock_raw).hexdigest() != EDGE_RUNTIME_LOCK_SHA256:
            raise ValueError("Deno runtime lock mismatch")
        lock = json.loads(lock_raw)
        archive = exe.parent.parent / "deno-x86_64-unknown-linux-gnu.zip"
        if not archive.is_file() or any(x.is_symlink() or x.is_junction() for x in [archive, *archive.parents]):
            raise ValueError("pinned Linux Deno archive unavailable")
        verify_linux_asset(lock, archive.read_bytes(), raw_binary)
        target = "x86_64-unknown-linux-gnu"
    else:
        raise ValueError("unsupported Deno runtime platform")
    return exe.resolve(), digest, target


def invoke(args, timeout=90):
    if (DENO is None or DENO_SHA256 is None or not args or Path(args[0]).resolve() != DENO or
            sha(DENO) != DENO_SHA256):
        raise ValueError("Deno changed or not validated")
    result = subprocess.run(args, cwd=ROOT, env=isolated_env(), capture_output=True, timeout=timeout)
    if result.returncode != 0:
        raise AssertionError("child failed " + str(result.returncode) + ": " +
                             result.stderr.decode("utf-8", "replace")[-3000:])
    if sha(DENO) != DENO_SHA256:
        raise ValueError("Deno changed during execution")
    return result.stdout.decode("utf-8", "strict")


def graph(root, allowed):
    cmd = [str(DENO), "info", "--json", "--no-remote", "--no-npm", "--no-lock", "--config", CONFIG, "./" + root]
    obj = json.loads(invoke(cmd, 30))
    if obj.get("redirects") or obj.get("npmPackages"):
        raise ValueError("redirect or npm graph rejected")
    nodes = {}
    builtins = set()
    for module in obj.get("modules", []):
        spec, kind = module.get("specifier", ""), module.get("kind")
        if module.get("error") is not None:
            raise ValueError("module graph error")
        if kind == "node":
            if spec not in allowed:
                raise ValueError("unapproved builtin")
            builtins.add(spec)
            continue
        if kind not in ("esm", "asserted") or not spec.startswith("file:"):
            raise ValueError("external module rejected")
        local = Path(module.get("local", ""))
        if not local.is_absolute() or not local.resolve().is_relative_to(ROOT.resolve()):
            raise ValueError("module outside reviewed root")
        name = local.resolve().relative_to(ROOT.resolve()).as_posix()
        if safe_file(name).resolve().as_uri() != spec:
            raise ValueError("specifier and local module mismatch")
        nodes[spec] = name
    if root not in nodes.values():
        raise ValueError("missing graph root")
    edges = []
    for module in obj["modules"]:
        if module.get("kind") == "node":
            continue
        source = nodes[module["specifier"]]
        for dep in module.get("dependencies", []):
            if dep.get("isDynamic") or dep.get("is_dynamic"):
                raise ValueError("dynamic import rejected")
            raw, targets = dep.get("specifier"), []
            if not isinstance(raw, str) or not raw.startswith((".", "node:")):
                raise ValueError("nonrelative import rejected")
            for typ in ("code", "type"):
                resolved = dep.get(typ)
                if resolved:
                    if resolved.get("error") is not None:
                        raise ValueError("import resolution error")
                    target = resolved.get("specifier")
                    if target in nodes:
                        target = nodes[target]
                    elif target not in allowed:
                        raise ValueError("unregistered import target")
                    targets.append([typ, target])
            if not targets:
                raise ValueError("unresolved import")
            edges.append([source, raw, targets])
    return {"files": {v: bound_digest(v) for v in sorted(set(nodes.values()))},
            "builtins": sorted(builtins), "edges": sorted(edges, key=lambda x: (x[0], x[1], str(x[2])))}

def layer(path):
 if path.startswith('node:'):return 'node_builtin'
 if path.startswith('tests/'):
  return 'suite_test' if Path(path).name.startswith('test_') else 'synthetic_fixture'
 if path=='supabase/functions/deno.json':return 'runtime_config'
 if path.startswith('src/jungsi_touch/application/') and path.endswith('.json'):return 'public_contract_json'
 if path.startswith('supabase/functions/_shared/jungsi/'):
  value=path.split('/')[4]
  if value not in ('domain','application','infrastructure'):raise ValueError('unknown 3-tier layer')
  return value
 if path in {'supabase/functions/_shared/professional_support.ts','supabase/functions/_shared/professional_budget_support.ts'}:return 'synthetic_fixture'
 if path.endswith('_support.ts'):raise ValueError('unclassified support file: '+path)
 if path.startswith('supabase/functions/_shared/'):return 'edge_adapter'
 raise ValueError('unregistered layer: '+path)
LAYER_ALLOWED={
 'domain':{'domain'}, 'application':{'application','domain'},
 'infrastructure':{'application','domain','infrastructure'},
 'edge_adapter':{'application','domain','infrastructure','edge_adapter','public_contract_json'},
 'synthetic_fixture':{'application','domain','infrastructure','edge_adapter','synthetic_fixture','public_contract_json','node_builtin'},
 'suite_test':{'application','domain','infrastructure','edge_adapter','synthetic_fixture','public_contract_json','node_builtin','suite_test'},
}
def layer_bindings(files,graphs):
 layers={p:layer(p) for p in sorted(files)}
 pairs=set()
 for g in graphs.values():
  for src,raw,targets in g['edges']:
   for typ,dst in targets:
    a,b=layer(src),layer(dst)
    if b not in LAYER_ALLOWED.get(a,set()):raise ValueError('forbidden layer edge: '+src+' -> '+dst)
    pairs.add((a,b))
 return {'files':layers,'observed_layer_edges':[list(x) for x in sorted(pairs)]}


def load_manifest():
    global DENO, DENO_SHA256
    if sha(safe_file("tests/review_suite_manifest.json")) != MANIFEST_SHA256:
        raise ValueError("review manifest mismatch")
    data = json.loads(MANIFEST.read_bytes())
    if data.get("format") != "jungsi.review-suite-closure/v2" or data.get("review_only") is not True:
        raise ValueError("invalid review manifest")
    DENO, DENO_SHA256, target = selected_runtime(data)
    version = invoke([str(DENO), "--version"], 10).splitlines()[0]
    if version != "deno 2.9.7 (stable, release, " + target + ")":
        raise ValueError("unexpected Deno version")
    return data


def verify_suite(data, name, expected_roots, allowed, expected_count):
    suite = data["suites"][name]
    if (suite["roots"] != expected_roots or suite["allowed_builtins"] != allowed or
            suite["expected_count"] != expected_count or set(suite["graphs"]) != set(expected_roots)):
        raise ValueError("suite registration mismatch")
    if name == "p1_review":
        # No computed or literal dynamic imports can bypass the pinned Deno graph.
        sys.path.insert(0, str(ROOT / "scripts"))
        from check_edge_contract import dynamic_imports
        for path in suite["files"]:
            if path.endswith((".ts", ".mjs", ".js", ".mts", ".cts")) and dynamic_imports(safe_file(path).read_text(encoding="utf8")):
                raise ValueError("dynamic import is not allowed in P1 closure")
    for path in suite["files"]:
        if path.startswith("tests/") and not path.startswith("tests/" + name + "/") and not (name == "service_end" and path == "tests/edge/synthetic_exam_pack.ts"):
            raise ValueError("unregistered test scope: " + path)
    if GENERATED_ROUTE in suite["files"]:
        verify_generated_route()
    for name, expected in suite["files"].items():
        if bound_digest(name) != expected:
            raise ValueError("file digest mismatch: " + name)
    if layer_bindings(suite["files"], suite["graphs"]) != suite["layers"]:
        raise ValueError("registered layer graph mismatch")
    for root in expected_roots:
        if graph(root, allowed) != suite["graphs"][root]:
            raise ValueError("module closure mismatch: " + root)
    return suite

class ReviewSuites(unittest.TestCase):
    def test_p1_deno_80(self):
        data = load_manifest()
        suite = verify_suite(data, "p1_review", P1_ROOTS, NODE_ALLOWED, 80)
        manual = ["tests/p1_review/fixtures/p1_public_registry_799.reference.json",
                  "src/jungsi_touch/application/public_response_schemas.json"]
        if suite["manual_read_files"] != manual:
            raise ValueError("P1 manual-read scope mismatch")
        reads = [str(safe_file(name).resolve()) for name in manual]
        if any("," in name for name in reads):
            raise ValueError("comma in allowed path is unsupported")
        expected = [
            {"cases": 37, "status": "PASS_SYNTHETIC_ONLY", "v1_and_v2_service": True},
            {"cases": 19, "status": "PASS_SYNTHETIC_ONLY", "v2_source_gate": True, "synthetic_http": True, "actual_data": False},
            {"cases": 24, "status": "PASS_SYNTHETIC_ONLY", "v2_source_gate": True, "synthetic_http": True, "actual_data": False},
        ]
        for root, wanted in zip(P1_ROOTS, expected):
            args = [str(DENO), "run", "--config", CONFIG, "--cached-only", "--no-lock", "--no-prompt",
                    "--no-remote", "--no-npm", "--allow-read=" + ",".join(reads), "--deny-write",
                    "--deny-net", "--deny-env", "--deny-run", "--deny-sys", "--deny-ffi", root]
            if json.loads(invoke(args, 90)) != wanted:
                raise AssertionError("P1 exact result or case count mismatch: " + root)
        verify_suite(data, "p1_review", P1_ROOTS, NODE_ALLOWED, 80)

    def test_service_end_deno_125(self):
        data = load_manifest()
        verify_suite(data, "service_end", SERVICE_ROOTS, [], 125)
        args = [str(DENO), "test", "--config", CONFIG, "--cached-only", "--no-lock", "--no-prompt",
                "--no-remote", "--no-npm", "--deny-read", "--deny-write", "--deny-net", "--deny-env",
                "--deny-run", "--deny-sys", "--deny-ffi", "--reporter=dot", *SERVICE_ROOTS]
        output = invoke(args, 90)
        matches = re.findall(r"^ok \| (\d+) passed \| (\d+) failed(?: \| (\d+) ignored)?(?: \| (\d+) filtered out)? \(", output, re.M)
        if len(matches) != 1 or tuple(int(n or 0) for n in matches[0]) != (125, 0, 0, 0):
            raise AssertionError("Deno result, count, ignored or filtered mismatch: " + output[-1000:])
        verify_suite(data, "service_end", SERVICE_ROOTS, [], 125)

    def test_search503_deno_48(self):
        data = load_manifest()
        allowed = ["node:assert/strict"]
        verify_suite(data, "search503", SEARCH_ROOTS, allowed, 48)
        args = [str(DENO), "test", "--config", CONFIG, "--cached-only", "--no-lock", "--no-prompt",
                "--no-remote", "--no-npm", "--deny-read", "--deny-write", "--deny-net", "--deny-env",
                "--deny-run", "--deny-sys", "--deny-ffi", "--reporter=dot", *SEARCH_ROOTS]
        output = invoke(args, 90)
        matches = re.findall(r"^ok \| (\d+) passed \| (\d+) failed(?: \| (\d+) ignored)?(?: \| (\d+) filtered out)? \(", output, re.M)
        if len(matches) != 1 or tuple(int(n or 0) for n in matches[0]) != (48, 0, 0, 0):
            raise AssertionError("503 result, count, ignored or filtered mismatch: " + output[-1000:])
        verify_suite(data, "search503", SEARCH_ROOTS, allowed, 48)

if __name__ == "__main__":
    unittest.main()
