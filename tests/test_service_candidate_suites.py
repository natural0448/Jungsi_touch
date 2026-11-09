"""Review-only bridge for four pinned synthetic suites; no skip on failures."""
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
MANIFEST_SHA256 = "dd5767b0eec2bb010c4e5bdbf6d0ae90958807985a49ef3cbd47580f6032917b"
EDGE_RUNTIME_LOCK_SHA256 = "75981218812cb43e87ca2425da4d5efaa12d05db4acfd58b882a579483f02c98"
DENO = None
DENO_SHA256 = None
CONFIG = "supabase/functions/deno.json"
GENERATED_ROUTE = "src/jungsi_touch/application/route_catalog.json"
GENERATED_ROUTE_MARKER = "GENERATED_BY_SPEC_VIA_COMMON_GATE"
NODE_ALLOWED = ["node:assert/strict", "node:fs", "node:zlib"]
SERVICE_CANDIDATE_SHARED_FIXTURES = {
    "service_end": frozenset({"tests/edge/synthetic_exam_pack.ts"}),
    "service_p1": frozenset(['tests/edge/fixture.ts', 'tests/edge/synthetic_api_contract.ts', 'tests/edge/synthetic_history_qualification.ts', 'tests/edge/synthetic_history_snapshot.ts', 'tests/edge/synthetic_runtime_binding.ts']),
}

SERVICE_P1_PINNED_TYPE_IMPORTS = {'supabase/functions/_shared/jungsi/application/platform_repository.ts': ('839a70ed64ef53b626b0b404b91a0a4fbbdc58704159d5b6d76ed82945f57744', ['./score_input_ports.ts']), 'supabase/functions/_shared/jungsi/application/profile_reports.ts': ('190a4d6746cfcc77dc36f000e8d0eec9338b4a7950543c9f903b5af0b961b29d', ['./score_input_ports.ts', './score_input_ports.ts']), 'supabase/functions/_shared/jungsi/application/score_input_ports.ts': ('c17d798e08750bdc7a8e0ec5ace5fb0cd3c132f8e9256288baebe5077c5df71c', ['./session_service.ts', './session_service.ts', './session_service.ts', './session_service.ts', './session_service.ts', './session_service.ts']), 'supabase/functions/_shared/jungsi/application/score_input_service.ts': ('26cb702657fe67e66334435e8632e631451572f7d3032ba1897aa6ece0b1caa1', ['./score_input_ports.ts'])}

SCORE_NULL_SUITE_ROOT = "tests/service_p1/test_score_null_reason_review.synthetic.mjs"
SERVICE_P1_ROOTS = ['tests/service_p1/test_p1_r27_partial_scope.synthetic.mjs', 'tests/service_p1/test_p1_r27_admission_integration.synthetic.mjs', 'tests/service_p1/test_p1_r27_runtime_partial_join.synthetic.mjs', 'tests/service_p1/test_p1_r27_request_admission.synthetic.ts', 'tests/service_p1/test_p1_r27_http_order.synthetic.ts', SCORE_NULL_SUITE_ROOT]

SERVICE_ROOTS = ["tests/service_end/" + name for name in (
    "test_service_end_current_review.synthetic.ts", "test_service_end_entrypoints.synthetic.ts",
    "test_service_end_error_schema.synthetic.ts", "test_service_end_http.synthetic.ts",
    "test_service_end_official_display.synthetic.ts", "test_service_end_professional.synthetic.ts",
    "test_service_end_runtime.synthetic.ts", "test_official_display_final_expiry.synthetic.ts",
)]
P1_ROOTS = ["tests/p1_review/test_p1_r27_portable_v2_gate.synthetic.v3.mjs", "tests/p1_review/test_p1_r27_release_gate.synthetic.mjs", "tests/p1_review/test_p1_r27_source_concurrency.synthetic.mjs", "tests/p1_review/test_p1_multipart_input_preflight.synthetic.mjs", "tests/p1_review/test_p1_admission_guidance_single.review-only.synthetic.mjs"]
P1_MULTIPART_CASES = ['real validators accept per-part synthetic history and retain 85 pending as unpublished input', 'missing track or group is rejected without conversion to null', 'absent campus stays page-bound UNKNOWN without changing source or becoming confirmed null', 'ambiguous grant campuses remain held instead of selecting a value', 'absent campus does not convert quota zero, null or missing stage', 'same school and PK with conflicting track or group is held when campus is absent', 'same PK conflicts across campus presence and separate source pages hold only related claims', 'same PK collisions hold present-campus and formerly excluded claims', 'source page also honors the requested max_depth before schema validation', 'explicit null is a separate input value and does not issue prior-decision approval', 'existing q requires real previous qualified context and never authorizes the new publication', 'a source scope candidate is not a prior-decision approval', 'unverified initial stage stays unspecified while native source stage and zero are preserved', 'explicit review-pending scope stays held and is not promoted by a different grant', 'global duplicate identities across parts fail closed', 'previous head and source head are checked before and after their reads', 'false or null from current-head assertions is rejected', 'compressed and source page alterations fail their own pins', 'part and compressed input arrays reject getters and sparse elements', 'source bytes and all input rows, including held rows, consume explicit budgets', 'mutable limits are snapshotted before the first asynchronous boundary', 'combined source and baseline cannot exceed the existing row limit', 'unsealed evidence and missing scope context do not create publication authority', '151 synthetic parts and 15476 prior rows above 64 MiB are validated part by part']
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
    suite_name = name
    suite = data["suites"][name]
    if (suite["roots"] != expected_roots or suite["allowed_builtins"] != allowed or
            suite["expected_count"] != expected_count or set(suite["graphs"]) != set(expected_roots)):
        raise ValueError("suite registration mismatch")
    if name in {"p1_review", "service_p1"}:
        # No computed or literal dynamic imports can bypass the pinned Deno graph.
        sys.path.insert(0, str(ROOT / "scripts"))
        from check_edge_contract import dynamic_imports
        for path in suite["files"]:
            if not path.endswith((".ts", ".mjs", ".js", ".mts", ".cts")):
                continue
            source = safe_file(path)
            literals = dynamic_imports(source.read_text(encoding="utf8"))
            if literals:
                pinned = SERVICE_P1_PINNED_TYPE_IMPORTS.get(path) if name == "service_p1" else None
                if pinned is None or sha(source) != pinned[0] or literals != pinned[1]:
                    raise ValueError("dynamic import is not allowed in P1 closure")
    for path in suite["files"]:
        if path.startswith("tests/") and not path.startswith("tests/" + name + "/") and path not in SERVICE_CANDIDATE_SHARED_FIXTURES.get(name, frozenset()):
            raise ValueError("unregistered test scope: " + path)
    extra_fixtures = {p for p in suite["files"] if p.startswith("tests/") and not p.startswith("tests/" + name + "/")}
    if extra_fixtures != set(SERVICE_CANDIDATE_SHARED_FIXTURES.get(name, frozenset())):
        raise ValueError("exact shared fixture set mismatch")
    if GENERATED_ROUTE in suite["files"]:
        verify_generated_route()
    for name, expected in suite["files"].items():
        if bound_digest(name) != expected:
            raise ValueError("file digest mismatch: " + name)
    if layer_bindings(suite["files"], suite["graphs"]) != suite["layers"]:
        raise ValueError("registered layer graph mismatch")
    for root in expected_roots:
        root_allowed = ["node:assert/strict", "node:test"] if suite_name == "service_p1" and root == SCORE_NULL_SUITE_ROOT else allowed
        if graph(root, root_allowed) != suite["graphs"][root]:
            raise ValueError("module closure mismatch: " + root)
    return suite

class ReviewSuites(unittest.TestCase):
    def test_p1_deno_80(self):
        data = load_manifest()
        suite = verify_suite(data, "p1_review", P1_ROOTS, NODE_ALLOWED, 108)
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
            {"status": "PASS_SYNTHETIC_PRELIGHT_ONLY", "tests": 24, "cases": P1_MULTIPART_CASES, "db_calls": 0, "storage_calls": 0, "output_parts": "NOT_BUILT", "publication": "NOT_RUN"},
            {'status': 'PASS_SYNTHETIC_SINGLE_REVIEW_ONLY', 'cases': 4, 'case_names': ['single_source_without_field_review_stays_pending_through_existing_gate', 'invalid_field_pending_without_blocking_other_rows', 'source_page_or_head_change_rejected', 'previous_snapshot_preserved_and_new_guidance_pending'], 'owner': 'NOT_CONNECTED', 'publication': 'NOT_RUN'},
        ]
        if len(P1_ROOTS) != len(expected):
            raise ValueError("P1 output registration incomplete")
        for root, wanted in zip(P1_ROOTS, expected):
            args = [str(DENO), "run", "--config", CONFIG, "--cached-only", "--no-lock", "--no-prompt",
                    "--no-remote", "--no-npm", "--allow-read=" + ",".join(reads), "--deny-write",
                    "--deny-net", "--deny-env", "--deny-run", "--deny-sys", "--deny-ffi", root]
            if json.loads(invoke(args, 90)) != wanted:
                raise AssertionError("P1 exact result or case count mismatch: " + root)
        verify_suite(data, "p1_review", P1_ROOTS, NODE_ALLOWED, 108)

    def test_service_p1_deno_46(self):
        data = load_manifest()
        suite = verify_suite(data, "service_p1", SERVICE_P1_ROOTS, NODE_ALLOWED, 81)
        manual = ["src/jungsi_touch/application/public_response_schemas.json"]
        if suite["manual_read_files"] != manual:
            raise ValueError("service P1 manual-read scope mismatch")
        path = str(safe_file(manual[0]).resolve())
        if "," in path:
            raise ValueError("comma in allowed path is unsupported")
        expected = [
            {"cases": 23, "status": "PASS_SYNTHETIC_ONLY", "v1_and_v2_service": True},
            {"result": "SYNTHETIC_ONLY", "passed": 4, "cases": [
                "real runtime context wires request admission into synthetic P1 v2 source",
                "invalid optional R27 settings and credentials fail v2 before r27 metadata",
                "same optional R27 failures keep actual synthetic P1 v1 usable",
                "common runtime binding failure propagates"]},
            {"result": "SYNTHETIC_ONLY", "passed": 3, "cases": [
                "request context partial v2 head and body preserve pinned coverage and exclude held rows",
                "missing or incorrect dedicated credential blocks both partial head and direct read",
                "repinned legacy or unsupported consumer approval cannot release partial head or body"]},
        ]
        for i, (root, wanted) in enumerate(zip(SERVICE_P1_ROOTS[:3], expected)):
            reads = "--allow-read=" + path if i == 0 else "--deny-read"
            args = [str(DENO), "run", "--config", CONFIG, "--cached-only", "--no-lock", "--no-prompt",
                    "--no-remote", "--no-npm", reads, "--deny-write", "--deny-net", "--deny-env",
                    "--deny-run", "--deny-sys", "--deny-ffi", root]
            if json.loads(invoke(args, 90)) != wanted:
                raise AssertionError("service P1 exact result or case mismatch: " + root)
        args = [str(DENO), "test", "--config", CONFIG, "--cached-only", "--no-lock", "--no-prompt",
                "--no-remote", "--no-npm", "--deny-read", "--deny-write", "--deny-net", "--deny-env",
                "--deny-run", "--deny-sys", "--deny-ffi", "--reporter=dot", *SERVICE_P1_ROOTS[3:5]]
        output = invoke(args, 90)
        matches = re.findall(r"^ok \| (\d+) passed \| (\d+) failed(?: \| (\d+) ignored)?(?: \| (\d+) filtered out)? \(", output, re.M)
        if len(matches) != 1 or tuple(int(n or 0) for n in matches[0]) != (18, 0, 0, 0):
            raise AssertionError("service P1 Deno result/count mismatch: " + output[-1000:])
        args = [str(DENO), "test", "--config", CONFIG, "--cached-only", "--no-lock", "--no-prompt",
                "--no-remote", "--no-npm", "--deny-read", "--deny-write", "--deny-net", "--deny-env",
                "--deny-run", "--deny-sys", "--deny-ffi", "--reporter=dot", SCORE_NULL_SUITE_ROOT]
        output = invoke(args, 90)
        matches = re.findall(r"^ok \| (\d+) passed \| (\d+) failed(?: \| (\d+) ignored)?(?: \| (\d+) filtered out)? \(", output, re.M)
        if len(matches) != 1 or tuple(int(n or 0) for n in matches[0]) != (33, 0, 0, 0):
            raise AssertionError("score-null Deno result/count mismatch: " + output[-1000:])
        verify_suite(data, "service_p1", SERVICE_P1_ROOTS, NODE_ALLOWED, 81)

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
