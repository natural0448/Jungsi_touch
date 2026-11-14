"""Run the 503 descriptor review regressions in the retained snapshot."""
import hashlib
import json
import re
import sys
import unittest

import test_service_candidate_suites as support


TEST_PATH = "supabase/functions/_shared/current_public_catalog_descriptor_review_test.ts"
SOURCE_PATH = "supabase/functions/_shared/current_public_catalog_descriptor_review.ts"
BRIDGE_PATH = "tests/test_catalog_descriptor_review.py"
EXPECTED_CASES = 21
GRAPH_MANIFEST_PATH = "tests/catalog_descriptor_review_graph.20261113_saved_report.current.json"
GRAPH_MANIFEST_SHA256 = "68dae5ed7e6e100411adede11c8769824eb6f868167e8679ad2f730891104f05"
BASE_COMMIT = "125d112edcf8100d201487c9157a0d5c702c58e8"
SCANNER_PATH = "scripts/check_edge_contract.py"
SCANNER_SHA256 = "ee123870172124a28f4f0aa3f6ee4517e49e6747d33fdd27580137777a93392e"
SUPPORT_PATH = "tests/test_service_candidate_suites.py"
SUPPORT_SHA256 = "1681fe7d3349c2ffc4c4d71227d3d5187e0c4f254df2a175125ed6453c59ab70"


DESCRIPTOR_HISTORY_SHA256 = "b9bc0b9ed14764382488d3d14862b0ae2a64bf4ee6b4960634da1d40f7d6c1b0"
DESCRIPTOR_PREVIOUS_KEY = "descriptor_rebind_review_current_source_20261113"
DESCRIPTOR_PREVIOUS_SHA256 = "2975168d8c675251a0cc8f329e5f70507c7081151d5513966dc3595da5d4e67b"
DESCRIPTOR_CURRENT_KEY = "descriptor_rebind_review_saved_report_source_20261113"


def current_descriptor_contract(spec):
    """Select only the exact current graph while keeping historical evidence intact."""
    import copy

    supply = spec["current_public_supply_contract"]
    historical = supply["descriptor_rebind_review"]
    marker = supply[DESCRIPTOR_CURRENT_KEY]
    previous_digest = hashlib.sha256(json.dumps(
        supply[DESCRIPTOR_PREVIOUS_KEY], ensure_ascii=True, sort_keys=True, separators=(",", ":")
    ).encode()).hexdigest()
    digest = hashlib.sha256(json.dumps(
        historical, ensure_ascii=True, sort_keys=True, separators=(",", ":")
    ).encode()).hexdigest()
    expected = {
        "format", "status", "activation_status", "native_acceptance", "operating_writes",
        "historical_sha256", "previous_registration_sha256",
        "graph_manifest_path", "graph_manifest_sha256", "bridge_sha256",
    }
    if (not isinstance(marker, dict) or set(marker) != expected
        or marker["format"] != "jungsi.catalog-descriptor-current-source-rebound/v2"
        or marker["status"] != "SOURCE_REGISTERED_NOT_EXECUTED"
        or marker["activation_status"] != "NOT_RUN"
        or marker["native_acceptance"] != "NOT_VERIFIED_BY_SOURCE_SUITE"
        or type(marker["operating_writes"]) is not int or marker["operating_writes"] != 0
        or marker["historical_sha256"] != DESCRIPTOR_HISTORY_SHA256
        or digest != DESCRIPTOR_HISTORY_SHA256
        or marker["previous_registration_sha256"] != DESCRIPTOR_PREVIOUS_SHA256
        or previous_digest != DESCRIPTOR_PREVIOUS_SHA256
        or marker["graph_manifest_path"] != GRAPH_MANIFEST_PATH
        or marker["graph_manifest_sha256"] != GRAPH_MANIFEST_SHA256
        or not isinstance(marker["bridge_sha256"], str)
        or re.fullmatch(r"[0-9a-f]{64}", marker["bridge_sha256"]) is None):
        raise ValueError("descriptor current source rebound invalid")
    current = copy.deepcopy(historical)
    for key in ("graph_manifest_path", "graph_manifest_sha256", "bridge_sha256"):
        current[key] = marker[key]
    return current


def snapshot_file(name):
    # Check only this snapshot and its descendants. The retained workspace may
    # itself be under an authorized external junction in the runner's outputs.
    path = support.safe_file(name)
    cursor = path
    while True:
        if cursor.is_symlink() or cursor.is_junction():
            raise ValueError("linked snapshot path: " + name)
        if cursor == support.ROOT:
            return path
        if cursor.parent == cursor:
            raise ValueError("snapshot root not reached")
        cursor = cursor.parent


def no_duplicate_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate graph manifest key")
        result[key] = value
    return result


class CatalogDescriptorReviewSnapshotTests(unittest.TestCase):
    def test_deno_review_only_contract(self):
        # Reuse the repository's pinned Deno and isolated, retained scratch.
        support.load_manifest()
        spec = json.loads(support.safe_file("docs/current/service_spec.json").read_bytes())
        contract = current_descriptor_contract(spec)
        self.assertEqual(contract["status"], "HOLD_REVIEW_ONLY_NOT_ACTIVATED")
        self.assertEqual(contract["source"], SOURCE_PATH)
        self.assertEqual(contract["test_source"], TEST_PATH)
        self.assertEqual(contract["snapshot_test_runner"], BRIDGE_PATH)
        self.assertEqual(contract["synthetic_test_count"], EXPECTED_CASES)
        self.assertEqual(contract["graph_manifest_path"], GRAPH_MANIFEST_PATH)
        self.assertEqual(contract["graph_manifest_sha256"], GRAPH_MANIFEST_SHA256)
        for path, key in (
            (SOURCE_PATH, "source_sha256"),
            (TEST_PATH, "test_sha256"),
            (BRIDGE_PATH, "bridge_sha256"),
        ):
            self.assertEqual(support.sha(snapshot_file(path)), contract[key])

        # Authenticate the recorded graph and every raw staged/commit byte BEFORE
        # Deno info can resolve a source. A Windows worktree can have different
        # line endings; these raw pins intentionally describe the Git snapshot.
        manifest_bytes = snapshot_file(GRAPH_MANIFEST_PATH).read_bytes()
        self.assertEqual(hashlib.sha256(manifest_bytes).hexdigest(), GRAPH_MANIFEST_SHA256)
        graph_manifest = json.loads(manifest_bytes, object_pairs_hook=no_duplicate_keys)
        self.assertEqual(set(graph_manifest), {
            "base_commit", "config_sha256", "deno_sha256", "deno_version", "format",
            "graphs", "import_map_sha256", "type_import_exceptions",
        })
        self.assertEqual(graph_manifest["format"], "jungsi.descriptor-review-graph/v1")
        self.assertEqual(graph_manifest["base_commit"], BASE_COMMIT)
        self.assertRegex(graph_manifest["import_map_sha256"], r"^[0-9a-f]{64}$")
        self.assertRegex(graph_manifest["deno_sha256"], r"^[0-9a-f]{64}$")
        self.assertEqual(
            support.sha(snapshot_file(support.CONFIG)), graph_manifest["config_sha256"]
        )
        # The manifest records the prior Windows graph build. On Linux the pinned
        # executable is separately validated against edge-runtime.lock.json by
        # support.load_manifest(); do not compare it with the Windows exe hash.
        if sys.platform == "win32":
            self.assertEqual(support.DENO_SHA256, graph_manifest["deno_sha256"])
        self.assertEqual(support.sha(snapshot_file(SUPPORT_PATH)), SUPPORT_SHA256)
        self.assertEqual(support.sha(snapshot_file(SCANNER_PATH)), SCANNER_SHA256)

        graphs = graph_manifest["graphs"]
        self.assertEqual(set(graphs), {SOURCE_PATH, TEST_PATH})
        edge_index = {
            row["path"]: row["source_sha256"]
            for row in spec["workflow"]["documentation_sync"]["code_index"]["edge_sources"]["files"]
        }
        implementations = {row["path"]: row for row in spec["implementation"]}
        self.assertEqual(implementations[SOURCE_PATH]["layer"], "application")
        self.assertEqual(implementations[TEST_PATH]["layer"], "verification")
        expected_files = {}
        for root, graph in graphs.items():
            self.assertEqual(set(graph), {"builtins", "edges", "files"})
            self.assertEqual(graph["builtins"], [])
            self.assertIn(root, graph["files"])
            for path, digest in graph["files"].items():
                self.assertTrue(path.startswith("supabase/functions/") and path.endswith(".ts"))
                self.assertRegex(digest, r"^[0-9a-f]{64}$")
                if path in expected_files:
                    self.assertEqual(expected_files[path], digest, path)
                expected_files[path] = digest
            for src, raw_import, targets in graph["edges"]:
                self.assertIn(src, graph["files"])
                self.assertTrue(isinstance(raw_import, str) and raw_import.startswith("."))
                self.assertTrue(targets)
                for kind, target in targets:
                    self.assertIn(kind, ("code", "type"))
                    self.assertIn(target, graph["files"])

        sys.path.insert(0, str(support.ROOT / "scripts"))
        from check_edge_contract import dynamic_imports
        exceptions = graph_manifest["type_import_exceptions"]
        self.assertIsInstance(exceptions, dict)
        observed_exceptions = set()
        for path, expected_sha in expected_files.items():
            source = snapshot_file(path)
            raw = source.read_bytes()
            actual_sha = hashlib.sha256(raw).hexdigest()
            self.assertEqual(actual_sha, expected_sha, path)
            text = raw.decode("utf-8-sig")
            literals = dynamic_imports(text)  # raises on computed imports
            if literals:
                observed_exceptions.add(path)
                allowed = support.SERVICE_P1_PINNED_TYPE_IMPORTS.get(path)
                self.assertIsNotNone(allowed, path)
                self.assertEqual((actual_sha, literals), allowed, path)
                self.assertEqual(exceptions[path], {
                    "classification": "PINNED_TYPE_ONLY",
                    "sha256": actual_sha,
                    "specifiers": literals,
                }, path)
            # The Edge index normalizes BOM/CRLF; the manifest above uses raw bytes.
            normalized = text.replace("\r\n", "\n").encode("utf-8")
            self.assertEqual(hashlib.sha256(normalized).hexdigest(), edge_index[path], path)
        self.assertEqual(observed_exceptions, set(exceptions))

        # Check the registered layer of every direct source dependency before
        # loading Deno info; verification tests may independently import adapters.
        for src, _raw, targets in graphs[SOURCE_PATH]["edges"]:
            if src == SOURCE_PATH:
                for _kind, target in targets:
                    self.assertIn(implementations[target]["layer"], ("application", "domain"))

        # The entire normalized graph, not only nodes, must match the pinned
        # independently reviewed manifest after all preflight checks succeeded.
        self.assertEqual(support.graph(SOURCE_PATH, []), graphs[SOURCE_PATH])
        self.assertEqual(support.graph(TEST_PATH, []), graphs[TEST_PATH])

        output = support.invoke(
            [
                str(support.DENO), "test", "--no-config", "--no-lock",
                "--no-remote", "--no-npm", "--no-prompt", "--deny-read",
                "--deny-write", "--deny-net", "--deny-env", "--deny-run",
                "--deny-sys", TEST_PATH,
            ],
            timeout=90,
        )
        summaries = re.findall(r"(\d+) passed \| (\d+) failed", output)
        self.assertEqual(summaries, [(str(EXPECTED_CASES), "0")])


if __name__ == "__main__":
    unittest.main()
