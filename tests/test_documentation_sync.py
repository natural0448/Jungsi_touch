"""Protect stale documents and delta-only review without weakening snapshot gates."""
import copy
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import audit_documentation_sync as audit


class DocumentationSyncTests(unittest.TestCase):
    def fixture(self):
        spec = {
            "version": "1.9.15",
            "implementation": [{"path": "src/jungsi_touch/a.py", "layer": "application",
                                "status": "synthetic_verified", "requirements": ["REQ-01"]}],
            "current_documents": {"planning": "docs/current/서비스_기획.md", "routing": "docs/current/라우팅_명세.md",
                                  "architecture": "docs/current/3티어_개발구조.md", "workflow": "docs/current/개발_브랜치_운영.md",
                                  "development_sync": audit.SYNC_DOCUMENT},
            "workflow": {"shared_tools": ["scripts/audit_documentation_sync.py"], "documentation_sync": {
                "format": "jungsi.documentation-sync-policy/v1", "required": True, "delta_first": True,
                "same_snapshot_required": True, "mandatory_gates_unchanged": True, "preserve_previous_results": True,
                "initial_verified_commit": "a" * 40, "index_document": audit.INDEX_DOCUMENT,
                "source_scope": "tracked_public_python_and_explicit_shared_tools"}}
        }
        files = {"src/jungsi_touch/a.py": b"def compute(value: int = 1) -> int:\n    return value\n",
                 "src/jungsi_touch/b.py": b"class Helper:\n    def read(self):\n        return None\n",
                 "AGENTS.md": audit.AGENT_MARKER, "docs/current/test.md": b"generated\n"}
        index, _ = audit.refresh_catalog(files, files.__getitem__, spec)
        spec["workflow"]["documentation_sync"]["code_index"] = index
        return spec, files

    def delta(self, spec, files, prior, original):
        with patch("check_project_consistency.generated_files", return_value={"docs/current/test.md": b"generated\n"}):
            return audit.delta_audit(files, files.__getitem__, spec, original, original.__getitem__, prior)

    def test_signatures_preserve_defaults_types_decorators_bases_and_nested_methods(self):
        raw = b"@decorate(1)\nclass Outer(Base, metaclass=Meta):\n    @staticmethod\n    async def fetch(value: int = 2, /, *, flag: bool = False) -> list[str]:\n        def inner(x=3):\n            return x\n        return []\n"
        symbols = {x["name"]: x for x in audit.extract_signatures(raw, "synthetic.py")}
        self.assertEqual(symbols["Outer"]["signature"], "class Outer(Base, metaclass=Meta):")
        self.assertEqual(symbols["Outer"]["decorators"], ["decorate(1)"])
        self.assertEqual(symbols["Outer.fetch"]["signature"], "async def fetch(value: int=2, /, *, flag: bool=False) -> list[str]:")
        self.assertEqual(symbols["Outer.fetch"]["decorators"], ["staticmethod"])
        self.assertIn("Outer.fetch.inner", symbols)

    def test_windows_bom_and_line_endings_do_not_invalidate_code(self):
        self.assertEqual(audit.source_digest(b"\xef\xbb\xbfdef read():\r\n    pass\r\n"),
                         audit.source_digest(b"def read():\n    pass\n"))

    def edge_fixture(self):
        spec, files = self.fixture()
        path = 'supabase/functions/_shared/display.ts'
        spec['implementation'].append({'path': path, 'layer': 'application', 'status': 'candidate',
                                       'requirements': ['REQ-01'], 'symbols': ['display']})
        files[path] = b'export function display(value: string) { return value; }\n'
        spec['workflow']['documentation_sync']['code_index'], _ = audit.refresh_catalog(files, files.__getitem__, spec)
        return spec, files, path

    def test_edge_body_only_change_cannot_reuse_old_whole_source_hash(self):
        spec, files, path = self.edge_fixture()
        files[path] = files[path].replace(b'return value;', b'return "changed";')
        self.assertIn('Public Edge whole source index drift', audit.validate_catalog(files, files.__getitem__, spec))

    def test_edge_missing_or_unregistered_dependency_is_rejected(self):
        spec, files, _ = self.edge_fixture()
        files['supabase/functions/_shared/new_dependency.ts'] = b'export const dependency = true;\n'
        self.assertIn('Public Edge source registration or encoding invalid', audit.validate_catalog(files, files.__getitem__, spec))
        with self.assertRaisesRegex(ValueError, 'Unregistered public Edge source'):
            audit.refresh_catalog(files, files.__getitem__, spec)

    def test_edge_type_change_updates_hash_but_is_not_claimed_as_type_proof(self):
        spec, files, path = self.edge_fixture()
        old = spec['workflow']['documentation_sync']['code_index']['edge_sources']
        files[path] = files[path].replace(b'value: string', b'value: number')
        current, _ = audit.refresh_catalog(files, files.__getitem__, spec)
        self.assertNotEqual(old['files'][0]['source_sha256'], current['edge_sources']['files'][0]['source_sha256'])
        self.assertEqual(current['edge_sources']['verification'], 'whole_source_hash_not_type_or_runtime_proof')

    def test_edge_delta_lists_changed_source_and_preserves_python_scope(self):
        spec, files, path = self.edge_fixture()
        prior, original = copy.deepcopy(spec), dict(files)
        files[path] = files[path].replace(b'value: string', b'value: number')
        spec['workflow']['documentation_sync']['code_index'], _ = audit.refresh_catalog(files, files.__getitem__, spec)
        result = self.delta(spec, files, prior, original)
        self.assertTrue(result['passed'], result['errors'])
        self.assertEqual(result['changed_source_files'], 0)
        self.assertEqual(result['changed_edge_source_files'], [path])

    def test_unchanged_sync_reuses_every_signature_without_ast_read(self):
        spec, files = self.fixture()
        with patch.object(audit, "extract_signatures", side_effect=AssertionError("Unchanged AST should be reused")):
            _, receipt = audit.refresh_catalog(files, files.__getitem__, spec)
        self.assertEqual(receipt["parsed_files"], [])
        self.assertEqual(len(receipt["reused_files"]), 2)

    def test_body_only_change_updates_hash_without_false_signature_change(self):
        spec, files = self.fixture()
        previous = spec["workflow"]["documentation_sync"]["code_index"]["files"][0]
        files["src/jungsi_touch/a.py"] = files["src/jungsi_touch/a.py"].replace(b"return value", b"return value + 1")
        index, receipt = audit.refresh_catalog(files, files.__getitem__, spec)
        self.assertEqual(receipt["parsed_files"], ["src/jungsi_touch/a.py"])
        self.assertEqual(index["files"][0]["symbols"], previous["symbols"])
        self.assertNotEqual(index["files"][0]["source_sha256"], previous["source_sha256"])

    def test_added_public_module_cannot_be_missing_from_index(self):
        spec, files = self.fixture()
        files["src/jungsi_touch/c.py"] = b"def new():\n    pass\n"
        self.assertIn("Documentation code index coverage drift", audit.validate_catalog(files, files.__getitem__, spec))

    def test_forged_current_hash_cannot_hide_a_stale_signature_in_snapshot_gate(self):
        spec, files = self.fixture()
        path = "src/jungsi_touch/a.py"
        files[path] = files[path].replace(b"int = 1", b"int = 2")
        spec["workflow"]["documentation_sync"]["code_index"]["files"][0]["source_sha256"] = audit.source_digest(files[path])
        self.assertIn("Documentation code index drift: " + path, audit.validate_catalog(files, files.__getitem__, spec))

    def test_duplicate_index_row_is_rejected(self):
        spec, files = self.fixture()
        rows = spec["workflow"]["documentation_sync"]["code_index"]["files"]
        rows.append(copy.deepcopy(rows[0]))
        self.assertIn("Documentation code index coverage drift", audit.validate_catalog(files, files.__getitem__, spec))

    def test_syntax_failure_is_not_treated_as_unchanged(self):
        spec, files = self.fixture()
        files["src/jungsi_touch/a.py"] = b"def broken(:\n"
        self.assertIn("Documentation code index parse failure: src/jungsi_touch/a.py", audit.validate_catalog(files, files.__getitem__, spec))

    def test_private_unregistered_and_test_paths_are_not_indexed(self):
        spec, files = self.fixture()
        self.assertEqual(audit.source_paths([*files, "data/private.py", "nested/Resource/source.py", "scripts/private.py",
                                              "tests/test_synthetic.py", "scripts/audit_documentation_sync.py"], spec),
                         ["scripts/audit_documentation_sync.py", "src/jungsi_touch/a.py", "src/jungsi_touch/b.py"])

    def test_requirement_metadata_changes_refresh_without_reparsing_source(self):
        prior, original = self.fixture()
        spec, files = copy.deepcopy(prior), dict(original)
        spec["implementation"][0]["requirements"] = ["REQ-02"]
        index, receipt = audit.refresh_catalog(files, files.__getitem__, spec)
        spec["workflow"]["documentation_sync"]["code_index"] = index
        self.assertEqual(receipt["parsed_files"], [])
        result = self.delta(spec, files, prior, original)
        self.assertTrue(result["passed"], result)
        self.assertEqual(result["index_entries_revalidated"], 1)

    def test_one_changed_source_parses_only_that_current_and_prior_file(self):
        prior, original = self.fixture()
        spec, files = copy.deepcopy(prior), dict(original)
        files["src/jungsi_touch/a.py"] = files["src/jungsi_touch/a.py"].replace(b"int = 1", b"int = 9")
        spec["workflow"]["documentation_sync"]["code_index"], _ = audit.refresh_catalog(files, files.__getitem__, spec)
        with patch.object(audit, "extract_signatures", wraps=audit.extract_signatures) as extract:
            result = self.delta(spec, files, prior, original)
        self.assertTrue(result["passed"], result)
        self.assertEqual(extract.call_count, 2)
        self.assertEqual(result["changed_source_files"], 1)
        self.assertEqual(result["unchanged_source_files_reused"], 1)
        self.assertTrue(result["source_observations"][0]["signature_changed"])

    def test_unchanged_verified_baseline_does_not_parse_ast_again(self):
        spec, files = self.fixture()
        with patch.object(audit, "extract_signatures", side_effect=AssertionError("Unchanged source should not be parsed")):
            result = self.delta(spec, files, spec, files)
        self.assertTrue(result["passed"], result)
        self.assertEqual(result["index_entries_revalidated"], 0)
        self.assertEqual(result["changed_source_files"], 0)

    def test_index_only_signature_tampering_is_checked_in_delta_review(self):
        prior, original = self.fixture()
        spec = copy.deepcopy(prior)
        spec["workflow"]["documentation_sync"]["code_index"]["files"][0]["symbols"][0]["signature"] = "def fake():"
        result = self.delta(spec, original, prior, original)
        self.assertFalse(result["passed"])
        self.assertEqual(result["index_entries_revalidated"], 1)
        self.assertIn("Documentation code index signature drift: src/jungsi_touch/a.py", result["errors"])

    def test_pre_index_baseline_initializes_once_with_explicit_receipt(self):
        spec, files = self.fixture()
        prior = copy.deepcopy(spec)
        prior["workflow"].pop("documentation_sync")
        result = self.delta(spec, files, prior, files)
        self.assertTrue(result["passed"], result)
        self.assertTrue(result["initial_index_verification"])
        self.assertEqual(result["index_entries_revalidated"], 2)

    def test_removed_source_does_not_silently_drop_the_prior_document_record(self):
        prior, original = self.fixture()
        files = dict(original)
        files.pop("src/jungsi_touch/b.py")
        result = self.delta(prior, files, prior, original)
        self.assertFalse(result["passed"])
        self.assertIn("Deleted source requires explicit user authorization: src/jungsi_touch/b.py", result["errors"])

    def test_paired_document_drift_is_caught_even_without_code_change(self):
        spec, files = self.fixture()
        changed = dict(files)
        changed["docs/current/test.md"] = b"manually changed\n"
        result = self.delta(spec, changed, spec, files)
        self.assertFalse(result["passed"])
        self.assertIn("Document or route drift: docs/current/test.md", result["errors"])

    def test_agent_obligation_cannot_be_missing_from_handoff(self):
        spec, files = self.fixture()
        changed = dict(files)
        changed["AGENTS.md"] = b"unrelated instructions\n"
        self.assertIn("AGENTS missing mandatory documentation synchronization", self.delta(spec, changed, spec, files)["errors"])

    def test_mandatory_gates_and_same_snapshot_cannot_be_disabled(self):
        spec, _ = self.fixture()
        for key in ("required", "delta_first", "same_snapshot_required", "mandatory_gates_unchanged", "preserve_previous_results"):
            changed = copy.deepcopy(spec)
            changed["workflow"]["documentation_sync"][key] = False
            self.assertIn("Documentation synchronization mandatory rule drift: " + key, audit.validate_sync_policy(changed))

    def test_current_specification_cannot_remove_the_sync_policy(self):
        spec, _ = self.fixture()
        spec["workflow"].pop("documentation_sync")
        self.assertEqual(audit.validate_sync_policy(spec), ["Documentation synchronization policy missing"])
        spec["version"] = "1.9.14"
        self.assertEqual(audit.validate_sync_policy(spec), [])

    def test_new_parser_invalidates_prior_signatures(self):
        spec, files = self.fixture()
        spec["workflow"]["documentation_sync"]["code_index"]["parser"] = "unknown-parser"
        _, receipt = audit.refresh_catalog(files, files.__getitem__, spec)
        self.assertEqual(len(receipt["parsed_files"]), 2)
        self.assertEqual(receipt["reused_files"], [])

    def test_invalid_current_parser_cannot_pass_an_unchanged_delta(self):
        prior, files = self.fixture()
        spec = copy.deepcopy(prior)
        spec["workflow"]["documentation_sync"]["code_index"]["parser"] = "unknown-parser"
        self.assertIn("Documentation code index parser/format missing", self.delta(spec, files, prior, files)["errors"])


if __name__ == "__main__":
    unittest.main()
