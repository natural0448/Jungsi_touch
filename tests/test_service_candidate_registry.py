"""Fail-closed synthetic regressions for the review suite registry and closure."""
from __future__ import annotations
import copy
import hashlib
import importlib.util
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import check_project_consistency as checker

class CandidateSuiteRegistryTests(unittest.TestCase):
    def setUp(self):
        self.spec = json.loads((ROOT / "docs/current/service_spec.json").read_bytes())
        self.ext = self.spec["backend_platform_contract"]["service_candidate_suite_extension"]
        self.manifest = json.loads((ROOT / self.ext["manifest"]["path"]).read_bytes())
        self.names = {p for suite in self.manifest["suites"].values() for p in suite["files"]}
        self.names |= {self.ext[k]["path"] for k in ("manifest", "wrapper", "regression_test")}
        self.overrides = {}

    def read(self, path):
        return self.overrides[path] if path in self.overrides else (ROOT / path).read_bytes()

    def rebind_manifest(self, manifest):
        raw = (json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode()
        self.overrides[self.ext["manifest"]["path"]] = raw
        self.ext["manifest"]["sha256"] = hashlib.sha256(raw).hexdigest()

    def errors(self):
        return checker.service_candidate_suite_errors(sorted(self.names), self.read, self.spec)

    def test_exact_three_suites_are_registered(self):
        self.assertEqual(self.errors(), [])
        self.assertEqual([self.ext["groups"][x]["test_count"] for x in ("p1_review", "service_end", "search503")], [80, 125, 48])
        self.assertEqual(self.ext["activation_status"], "NOT_RUN")

    def test_missing_registry_never_silently_omits_suites(self):
        del self.spec["backend_platform_contract"]["service_candidate_suite_extension"]
        self.assertTrue(self.errors())

    def test_unregistered_group_file_and_missing_source_fail(self):
        self.names.add("tests/search503/unregistered.synthetic.ts")
        self.assertTrue(self.errors())
        self.names.remove("tests/search503/unregistered.synthetic.ts")
        self.names.remove(self.ext["groups"]["p1_review"]["roots"][0])
        self.assertTrue(self.errors())

    def test_changed_guard_or_production_claim_is_rejected(self):
        path = self.ext["wrapper"]["path"]
        self.overrides[path] = b"synthetic changed wrapper"
        self.assertTrue(self.errors())
        self.overrides.clear()
        self.ext["native_acceptance"] = "PASS"
        self.assertTrue(self.errors())

    def test_rehashed_external_or_unregistered_graph_edge_is_rejected(self):
        suite = self.manifest["suites"]["search503"]
        graph = suite["graphs"][suite["roots"][0]]
        changed = copy.deepcopy(self.manifest)
        changed_graph = changed["suites"]["search503"]["graphs"][suite["roots"][0]]
        changed_graph["edges"][0][1] = "https://invalid.example/unapproved.ts"
        self.rebind_manifest(changed)
        self.assertTrue(self.errors())
        changed = copy.deepcopy(self.manifest)
        changed_graph = changed["suites"]["search503"]["graphs"][suite["roots"][0]]
        changed_graph["edges"][0][2][0][1] = "supabase/functions/_shared/jungsi/application/unregistered.ts"
        self.rebind_manifest(changed)
        self.assertTrue(self.errors())

    def test_malformed_count_and_missing_manual_json_are_rejected(self):
        changed = copy.deepcopy(self.manifest)
        changed["suites"]["p1_review"]["expected_count"] = 36
        self.rebind_manifest(changed)
        self.assertTrue(self.errors())
        changed = copy.deepcopy(self.manifest)
        changed["suites"]["p1_review"]["manual_read_files"] = []
        self.rebind_manifest(changed)
        self.assertTrue(self.errors())

    def test_runtime_missing_is_failure_not_skip_for_each_suite(self):
        path = ROOT / self.ext["wrapper"]["path"]
        module_spec = importlib.util.spec_from_file_location("service_candidate_wrapper_for_regression", path)
        module = importlib.util.module_from_spec(module_spec)
        module_spec.loader.exec_module(module)
        with patch.object(module, "load_manifest", side_effect=FileNotFoundError("synthetic missing runtime")):
            for name in ("test_p1_deno_80", "test_service_end_deno_125", "test_search503_deno_48"):
                result = unittest.TestResult()
                module.ReviewSuites(name).run(result)
                self.assertFalse(result.wasSuccessful())
                self.assertEqual(result.skipped, [])
                self.assertEqual(len(result.failures) + len(result.errors), 1)

    def test_generated_route_must_exist_and_match_common_generator(self):
        route = "src/jungsi_touch/application/route_catalog.json"
        self.overrides[route] = b"synthetic corrupt generated route"
        self.assertTrue(self.errors())
        self.overrides.clear()
        self.names.remove(route)
        self.assertTrue(self.errors())

    def test_marker_cannot_exempt_a_different_json(self):
        changed = copy.deepcopy(self.manifest)
        public_schema = "src/jungsi_touch/application/public_response_schemas.json"
        changed["suites"]["p1_review"]["files"][public_schema] = "GENERATED_BY_SPEC_VIA_COMMON_GATE"
        self.rebind_manifest(changed)
        self.assertTrue(self.errors())

    def test_generated_route_failure_stops_suite_before_runtime_invocation(self):
        path = ROOT / self.ext["wrapper"]["path"]
        module_spec = importlib.util.spec_from_file_location("candidate_route_guard_regression", path)
        module = importlib.util.module_from_spec(module_spec)
        module_spec.loader.exec_module(module)
        with patch.object(module, "load_manifest", return_value=self.manifest), \
             patch.object(module, "verify_generated_route", side_effect=ValueError("synthetic route mismatch")), \
             patch.object(module, "invoke") as invoke:
            result = unittest.TestResult()
            module.ReviewSuites("test_service_end_deno_125").run(result)
            self.assertFalse(result.wasSuccessful())
            self.assertEqual(result.skipped, [])
            invoke.assert_not_called()


class CandidateRuntimePortabilityTests(unittest.TestCase):
    def setUp(self):
        path=ROOT/"tests/test_service_candidate_suites.py"
        spec=importlib.util.spec_from_file_location("portable_candidate_suite_test",path)
        self.m=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.m)
        self.data=json.loads((ROOT/"tests/review_suite_manifest.json").read_bytes())

    def test_runtime_and_scratch_are_required_without_skip(self):
        with patch.dict(self.m.os.environ,{},clear=True):
            with self.assertRaisesRegex(ValueError,"Deno is required"):self.m.selected_runtime(self.data)
            with self.assertRaisesRegex(ValueError,"scratch is required"):self.m.scratch_root()
        with patch.dict(self.m.os.environ,{"JUNGSI_REVIEW_SUITE_SCRATCH":str(ROOT)},clear=True):
            with self.assertRaisesRegex(ValueError,"inside snapshot"):self.m.scratch_root()

    def test_wrong_windows_binary_and_unknown_platform_fail(self):
        with patch.dict(self.m.os.environ,{"JUNGSI_DENO":sys.executable},clear=True), \
             patch.object(self.m.platform,"machine",return_value="x86_64"), \
             patch.object(self.m.sys,"platform","win32"):
            with self.assertRaisesRegex(ValueError,"digest mismatch"):self.m.selected_runtime(self.data)
        with patch.dict(self.m.os.environ,{"JUNGSI_DENO":sys.executable},clear=True), \
             patch.object(self.m.platform,"machine",return_value="x86_64"), \
             patch.object(self.m.sys,"platform","darwin"):
            with self.assertRaisesRegex(ValueError,"unsupported"):self.m.selected_runtime(self.data)

    def test_linux_archive_and_executable_must_both_match_lock(self):
        import io,zipfile
        binary=b"synthetic deno"
        buf=io.BytesIO()
        with zipfile.ZipFile(buf,"w") as z:z.writestr("deno",binary)
        archive=buf.getvalue();name="deno-x86_64-unknown-linux-gnu.zip"
        lock={"format":"jungsi.edge-runtime-lock/v1","version":"2.9.7","assets":{"linux":{
            "filename":name,"url":"https://github.com/denoland/deno/releases/download/v2.9.7/"+name,
            "bytes":len(archive),"sha256":hashlib.sha256(archive).hexdigest()}}}
        self.m.verify_linux_asset(lock,archive,binary)
        with self.assertRaisesRegex(ValueError,"executable differs"):self.m.verify_linux_asset(lock,archive,b"other")
        with self.assertRaisesRegex(ValueError,"archive lock"):self.m.verify_linux_asset(lock,archive+b"changed",binary)

    def test_p1_uses_deno_and_only_two_explicit_read_files(self):
        import json
        manual=["tests/p1_review/fixtures/p1_public_registry_799.reference.json",
                "src/jungsi_touch/application/public_response_schemas.json"]
        suite={"manual_read_files":manual}
        outputs=[{"cases":37,"status":"PASS_SYNTHETIC_ONLY","v1_and_v2_service":True},
                 {"cases":19,"status":"PASS_SYNTHETIC_ONLY","v2_source_gate":True,"synthetic_http":True,"actual_data":False},
                 {"cases":24,"status":"PASS_SYNTHETIC_ONLY","v2_source_gate":True,"synthetic_http":True,"actual_data":False}]
        with patch.object(self.m,"load_manifest",return_value=self.data), \
             patch.object(self.m,"verify_suite",return_value=suite), \
             patch.object(self.m,"DENO",Path(sys.executable)), \
             patch.object(self.m,"invoke",side_effect=[json.dumps(x) for x in outputs]) as call:
            self.m.ReviewSuites("test_p1_deno_80").test_p1_deno_80()
        self.assertEqual(call.call_count,3)
        for invocation in call.call_args_list:
            args=invocation.args[0]
            self.assertEqual(args[1],"run")
            for flag in ("--cached-only","--no-remote","--no-npm","--deny-write","--deny-net","--deny-env","--deny-run","--deny-sys","--deny-ffi"):
                self.assertIn(flag,args)
            self.assertEqual([x for x in args if x.startswith("--allow-read=")],
                             ["--allow-read="+",".join(str((ROOT/p).resolve()) for p in manual)])
            self.assertFalse(any("node" in Path(x).name.lower() for x in args[:1]))

    def test_incorrect_manual_read_scope_fails_before_execution(self):
        with patch.object(self.m,"load_manifest",return_value=self.data), \
             patch.object(self.m,"verify_suite",return_value={"manual_read_files":[]}), \
             patch.object(self.m,"invoke") as call:
            with self.assertRaisesRegex(ValueError,"manual-read scope"):self.m.ReviewSuites("test_p1_deno_80").test_p1_deno_80()
            call.assert_not_called()

    def test_runner_requires_absolute_runtime_and_scratch(self):
        import run_committed_tests as runner
        actual=runner.suite_python_environment({"X":"1"},sys.executable,str(ROOT.parent))
        self.assertEqual(actual["JUNGSI_DENO"],sys.executable)
        self.assertEqual(actual["JUNGSI_REVIEW_SUITE_SCRATCH"],str(ROOT.parent))
        for deno,scratch in ((None,str(ROOT.parent)),("relative",str(ROOT.parent)),(sys.executable,"relative")):
            with self.subTest(deno=deno,scratch=scratch),self.assertRaises(ValueError):
                runner.suite_python_environment({},deno,scratch)

if __name__ == "__main__":
    unittest.main()
