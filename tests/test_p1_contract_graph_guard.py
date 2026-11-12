"""Portable offline P1 closure guard regression; no network or writes."""
from __future__ import annotations
import copy
import hashlib
import json
import os
from pathlib import Path
import sys
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import run_edge_tests as guard

class P1ContractGraphGuardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        manifest_path = ROOT / guard.P1CG_GRAPH_MANIFEST
        reference = json.loads(manifest_path.read_bytes())
        files = set(reference["test_files"]) | {reference["config"]["path"], guard.P1CG_GRAPH_MANIFEST}
        for model in reference["graphs"].values(): files.update(model["files"])
        cls.before = {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in files}
        cls.graphs = {p: guard.reference_p1_graph_info(ROOT, cls.before, p, reference["graphs"][p])
                      for p in guard.P1CG_ROOTS}
        cls.sha = cls.before[guard.P1CG_GRAPH_MANIFEST]
        cls.spec = {"p1_recruitment_score_review_verification": {},
                    "p1_selection_bridge_review_verification": {},
                    "service_end_score_cutoff_synthetic_verification": {}}

    def verify(self, before=None, spec=None, graphs=None, sha=None):
        return guard.verify_p1_graph_manifest(
            ROOT, self.before if before is None else before,
            self.spec if spec is None else spec,
            self.sha if sha is None else sha,
            self.graphs if graphs is None else graphs,
        )

    def changed_graph(self, index):
        graphs = copy.deepcopy(self.graphs)
        return graphs, graphs[guard.P1CG_ROOTS[index]]

    def test_all_actual_graphs_and_fixture_hashes_match(self):
        result = self.verify()
        self.assertEqual((result["roots"], result["files"], result["production_ready"]), (6, 7, False))

    def test_each_test_root_and_fixture_is_required(self):
        for path in guard.P1CG_TEST_FILES:
            with self.subTest(path=path):
                before = dict(self.before); del before[path]
                with self.assertRaises(ValueError): self.verify(before=before)

    def test_extra_unregistered_test_file_fails(self):
        before = dict(self.before); before[guard.P1CG_PREFIX + "unknown.js"] = "0" * 64
        with self.assertRaises(ValueError): self.verify(before=before)

    def test_missing_or_extra_graph_root_fails(self):
        for mode in ("missing", "extra"):
            graphs = dict(self.graphs)
            if mode == "missing": del graphs[guard.P1CG_ROOTS[0]]
            else: graphs[guard.P1CG_PREFIX + "unknown.js"] = {}
            with self.subTest(mode=mode), self.assertRaises(ValueError): self.verify(graphs=graphs)

    def test_manifest_pin_and_snapshot_hash_are_required(self):
        with self.assertRaises(ValueError): self.verify(sha="0" * 64)
        before = dict(self.before); before[guard.P1CG_GRAPH_MANIFEST] = "0" * 64
        with self.assertRaises(ValueError): self.verify(before=before)

    def test_test_file_hash_cannot_be_changed(self):
        before = dict(self.before); before[guard.P1CG_ROOTS[0]] = "0" * 64
        with self.assertRaises(ValueError): self.verify(before=before)

    def test_null_registration_still_requires_corresponding_root(self):
        spec = dict(self.spec); spec["p1_selection_bridge_review_verification"] = None
        before = dict(self.before); del before[guard.P1CG_ROOTS[4]]
        with self.assertRaises(ValueError): self.verify(before=before, spec=spec)

    def test_removed_registration_with_its_files_is_rejected(self):
        spec = dict(self.spec); del spec["p1_selection_bridge_review_verification"]
        graphs = dict(self.graphs); del graphs[guard.P1CG_ROOTS[4]]
        with self.assertRaises(ValueError): self.verify(spec=spec, graphs=graphs)

    def test_selection_only_subset_remains_supported(self):
        spec = {"p1_selection_bridge_review_verification": {}}
        selected = {guard.P1CG_ROOTS[4], guard.P1CG_FIXTURE}
        before = {p: h for p, h in self.before.items() if not p.startswith(guard.P1CG_PREFIX) or p in selected}
        graphs = {guard.P1CG_ROOTS[4]: self.graphs[guard.P1CG_ROOTS[4]]}
        result = self.verify(before=before, spec=spec, graphs=graphs)
        self.assertEqual((result["roots"], result["files"]), (1, 2))

    def test_unregistered_manifest_or_files_fail(self):
        with self.assertRaises(ValueError): self.verify(spec={}, graphs={})
        before = {p: h for p, h in self.before.items()
                  if not p.startswith(guard.P1CG_PREFIX) and p != guard.P1CG_GRAPH_MANIFEST}
        self.assertEqual(self.verify(before=before, spec={}, graphs={})["roots"], 0)

    def test_remote_redirects_and_npm_are_rejected(self):
        for key, value in (("redirects", {"https://invalid.example/a": "https://invalid.example/b"}),
                           ("npmPackages", {"npm:evil": {}})):
            graphs, graph = self.changed_graph(0); graph[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError): self.verify(graphs=graphs)
        graphs, graph = self.changed_graph(0)
        graph["modules"][0]["specifier"] = "https://invalid.example/synthetic.ts"
        with self.assertRaises(ValueError): self.verify(graphs=graphs)

    def test_disallowed_node_builtin_fails(self):
        graphs, graph = self.changed_graph(4)
        node = next(m for m in graph["modules"] if m.get("kind") == "node")
        node["specifier"] = "node:fs"
        with self.assertRaises(ValueError): self.verify(graphs=graphs)

    def test_runtime_dynamic_import_is_rejected(self):
        graphs, graph = self.changed_graph(0)
        module = next(m for m in graph["modules"] if m.get("dependencies"))
        module["dependencies"][0]["isDynamic"] = True
        with self.assertRaises(ValueError): self.verify(graphs=graphs)

    def test_literal_and_computed_dynamic_import_are_rejected(self):
        for source in (b'await import("./evil.ts")', b'import(computed)'):
            with self.subTest(source=source), self.assertRaises(ValueError):
                guard._p1cg_check_literals(guard.P1CG_ROOTS[0], source)

    def test_only_exact_prior_type_import_pins_are_accepted(self):
        for path, (sha, _) in guard.P1CG_PINNED_TYPE_IMPORTS.items():
            raw = (ROOT / path).read_bytes()
            self.assertEqual(hashlib.sha256(raw).hexdigest(), sha)
            guard._p1cg_check_literals(path, raw)
            with self.subTest(path=path), self.assertRaises(ValueError):
                guard._p1cg_check_literals(path, raw + b"\n")

    def test_duplicate_or_missing_graph_module_fails(self):
        graphs, graph = self.changed_graph(0)
        graph["modules"].append(copy.deepcopy(graph["modules"][0]))
        with self.assertRaises(ValueError): self.verify(graphs=graphs)
        graphs, graph = self.changed_graph(0)
        graph["modules"].pop()
        with self.assertRaises(ValueError): self.verify(graphs=graphs)

    def test_forged_local_path_and_resolution_fail(self):
        graphs, graph = self.changed_graph(0)
        module = next(m for m in graph["modules"] if m.get("local"))
        module["local"] = r"C:\outside\synthetic.ts"
        with self.assertRaises(ValueError): self.verify(graphs=graphs)
        graphs, graph = self.changed_graph(0)
        module = next(m for m in graph["modules"] if m.get("dependencies"))
        dep = next(d for d in module["dependencies"] if "code" in d)
        target = next(m["specifier"] for m in graph["modules"]
                      if m.get("kind") == "esm" and m["specifier"] != dep["code"]["specifier"])
        dep["code"]["specifier"] = target
        with self.assertRaises(ValueError): self.verify(graphs=graphs)

    def test_domain_to_infrastructure_is_rejected_even_if_local(self):
        graphs, graph = self.changed_graph(5)
        domain = next(m for m in graph["modules"] if "/domain/" in m.get("specifier", ""))
        infra = next(m for m in graph["modules"] if "/infrastructure/" in m.get("specifier", ""))
        relative = os.path.relpath(infra["local"], Path(domain["local"]).parent).replace("\\", "/")
        if not relative.startswith("."): relative = "./" + relative
        domain.setdefault("dependencies", []).append(
            {"specifier": relative, "code": {"specifier": infra["specifier"]}}
        )
        with self.assertRaisesRegex(ValueError, "p1_contract_graph_layer"): self.verify(graphs=graphs)

    def test_duplicate_edge_fails(self):
        graphs, graph = self.changed_graph(0)
        module = next(m for m in graph["modules"] if m.get("dependencies"))
        module["dependencies"].append(copy.deepcopy(module["dependencies"][0]))
        with self.assertRaises(ValueError): self.verify(graphs=graphs)


    def test_malformed_top_level_graph_schema_fails(self):
        for key, value in (("version", True), ("redirects", []), ("npmPackages", None)):
            graphs, graph = self.changed_graph(0); graph[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError): self.verify(graphs=graphs)

    def test_pinned_type_import_must_be_in_actual_graph(self):
        graphs, graph = self.changed_graph(5)
        module = next(m for m in graph["modules"] if m.get("local", "").replace("\\", "/").endswith("/score_input_ports.ts"))
        module["dependencies"] = [d for d in module["dependencies"] if d.get("specifier") != "./session_service.ts"]
        with self.assertRaisesRegex(ValueError, "source_import_not_graphed"): self.verify(graphs=graphs)


    def test_proposal_builder_rejects_omitted_static_imports(self):
        graph = copy.deepcopy(self.graphs[guard.P1CG_ROOTS[2]])
        root_module = next(m for m in graph["modules"] if m.get("specifier") == graph["roots"][0])
        root_module["dependencies"] = []
        graph["modules"] = [root_module]
        with self.assertRaisesRegex(ValueError, "source_import_not_graphed"):
            guard.normalize_p1_graph(graph, ROOT, self.before, guard.P1CG_ROOTS[2])


    def test_pinned_manifest_preflight_accepts_real_closure_without_deno(self):
        r = guard.preflight_p1_graph_manifest(ROOT, self.before, self.spec, self.sha)
        self.assertEqual((r["roots"], r["files"]), (6, 7))

    def test_reference_preflight_rejects_omitted_import_before_deno(self):
        data = json.loads((ROOT / guard.P1CG_GRAPH_MANIFEST).read_bytes())
        entry = guard.P1CG_ROOTS[2]
        model = data["graphs"][entry]
        model["edges"] = [e for e in model["edges"] if e[0] != entry]
        info = guard.reference_p1_graph_info(ROOT, self.before, entry, model)
        with self.assertRaisesRegex(ValueError, "source_import_not_graphed"):
            guard.normalize_p1_graph(info, ROOT, self.before, entry)

    def test_direct_dynamic_evaluation_is_rejected(self):
        for source in (b"eval(1)", b"const f = eval", b'globalThis["eval"]', b'require("./x")'):
            with self.subTest(source=source), self.assertRaisesRegex(ValueError, "dynamic_evaluation"):
                guard._p1cg_static_imports(source)


    def test_real_graph_rejects_test_root_to_other_root_import(self):
        graphs, graph = self.changed_graph(4)
        other = copy.deepcopy(self.graphs[guard.P1CG_ROOTS[0]])
        existing = {m["specifier"] for m in graph["modules"]}
        graph["modules"].extend(m for m in other["modules"] if m["specifier"] not in existing)
        source = next(m for m in graph["modules"] if m["specifier"] == graph["roots"][0])
        target = other["roots"][0]
        source.setdefault("dependencies", []).append({
            "specifier": "./" + guard.P1CG_ROOTS[0].rsplit("/", 1)[-1],
            "code": {"specifier": target},
        })
        with self.assertRaisesRegex(ValueError, "test_root_cross_import"): self.verify(graphs=graphs)

    def test_bridge_fixture_is_exclusive_to_its_root(self):
        guard._p1cg_check_test_edge(guard.P1CG_ROOTS[4], guard.P1CG_FIXTURE)
        for source in (guard.P1CG_ROOTS[0], guard.P1CG_ROOTS[5], guard.P1CG_FIXTURE):
            with self.subTest(source=source), self.assertRaisesRegex(ValueError, "bridge_fixture_scope"):
                guard._p1cg_check_test_edge(source, guard.P1CG_FIXTURE)

    def test_permission_errors_propagate_and_denials_are_explicit(self):
        common = ["--no-lock", "--no-remote", "--no-npm", "--config", guard.P1CG_CONFIG_PATH]
        calls = []
        def fake(argv, **kwargs):
            calls.append(argv)
            raise guard.EdgeFailure("synthetic_permission_error")
        with mock.patch.object(guard, "command", side_effect=fake):
            with self.assertRaisesRegex(ValueError, "synthetic_permission_error"):
                guard.run_p1_contract_suite("synthetic-deno", common, "synthetic.junit",
                    [guard.P1CG_ROOTS[0]], ROOT, ROOT, "synthetic")
        self.assertEqual(len(calls), 1)
        self.assertTrue(set(guard.P1CG_DENY_FLAGS) <= set(calls[0]))
        self.assertFalse(any(x.startswith("--allow") for x in calls[0]))

    def test_missing_offline_flags_fail_before_test_process(self):
        with mock.patch.object(guard, "command") as call:
            with self.assertRaises(ValueError):
                guard.run_p1_contract_suite("synthetic-deno", [], "synthetic.junit",
                    [guard.P1CG_ROOTS[0]], ROOT, ROOT, "synthetic")
            call.assert_not_called()


if __name__ == "__main__":
    unittest.main()
