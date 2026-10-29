"""Read-only/synthetic graph binding tests; no DB, network, file deletion or temp cleanup."""
import copy
import hashlib
import json
import sys
import unittest
from unittest.mock import patch
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import check_edge_contract as edge

GOOD = ROOT
SRC = "tests/edge/synthetic.ts"
CAT = edge.CURRENT_CATALOG_PATH
SCHEMA = edge.PUBLIC_SCHEMA_PATH
EXPECTED = edge.PUBLIC_SCHEMA_SHA256

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def snapshot(root):
    return {SCHEMA: EXPECTED, CAT: sha((root / CAT).read_bytes())}

def source_spec(root):
    source = (root / CAT).read_bytes().decode("utf-8-sig").replace("\r\n", "\n").encode()
    row = dict(path=CAT, layer="application", status="SYNTHETIC", requirements=["SYN-REQ"],
               declared_exports=["Synthetic"], source_sha256=sha(source))
    impl = dict(path=CAT, layer="application", status="SYNTHETIC", requirements=["SYN-REQ"], symbols=["Synthetic"])
    index = dict(format="jungsi.typescript-source-hash-index/v1",
                 verification="whole_source_hash_not_type_or_runtime_proof", files=[row])
    return dict(workflow=dict(documentation_sync=dict(code_index=dict(edge_sources=index))), implementation=[impl])

def schema_graph(root):
    source = (root / SRC).as_uri()
    asset = (root / SCHEMA).as_uri()
    dep = dict(specifier="../../src/jungsi_touch/application/public_response_schemas.json",
               code=dict(specifier=asset), assertionType="json")
    modules = [dict(kind="esm", mediaType="TypeScript", specifier=source, dependencies=[dep]),
               dict(kind="asserted", mediaType="Json", specifier=asset, size=(GOOD / SCHEMA).stat().st_size)]
    return dict(version=1, roots=[source], modules=modules, redirects={}, npmPackages={})

def with_catalog(raw, root):
    url = (root / CAT).as_uri()
    raw["modules"][0]["dependencies"].append(dict(specifier="../../supabase/functions/_shared/current_public_catalog.ts", code=dict(specifier=url)))
    raw["modules"].append(dict(kind="esm", mediaType="TypeScript", specifier=url, dependencies=[]))
    return raw

class PublicJsonGraphTests(unittest.TestCase):
    def run_graph(self, raw=None, root=GOOD, manifest=None, layers=None, coexisting=None):
        return edge.normalize_graph(raw or schema_graph(root), root, {SRC}, layers or {SRC:"verification"},
                                    manifest=snapshot(root) if manifest is None else manifest,
                                    coexisting=coexisting)
    def test_exact_json_node_and_assertion_are_retained_as_dependency(self):
        graph, seen = self.run_graph()
        self.assertIn(SCHEMA, seen)
        self.assertNotIn(SCHEMA, graph)
        self.assertEqual(graph[SRC][0]["targets"], [dict(kind="code", path=SCHEMA)])
    def test_manifest_missing_json_denied(self):
        with self.assertRaisesRegex(edge.EdgeFailure, "manifest_missing"):
            self.run_graph(manifest={CAT:snapshot(GOOD)[CAT]})
    def test_manifest_wrong_json_sha_denied(self):
        manifest=snapshot(GOOD);manifest[SCHEMA]="0"*64
        with self.assertRaises(edge.EdgeFailure):self.run_graph(manifest=manifest)
    def test_missing_json_file_denied(self):
        actual=Path.is_file
        def fake(path):return False if path==GOOD/SCHEMA else actual(path)
        with patch.object(Path,"is_file",fake), self.assertRaises(edge.EdgeFailure):self.run_graph()
    def test_tampered_json_file_denied(self):
        actual=Path.read_bytes
        def fake(path):
            raw=actual(path)
            return raw+b" " if path==GOOD/SCHEMA else raw
        with patch.object(Path,"read_bytes",fake), self.assertRaises(edge.EdgeFailure):self.run_graph()
    def test_same_bytes_at_another_json_path_denied(self):
        raw=schema_graph(GOOD);raw["modules"][0]["dependencies"][0]["code"]["specifier"]=(GOOD/"src/jungsi_touch/application/other.json").as_uri()
        with self.assertRaises(edge.EdgeFailure):self.run_graph(raw)
    def test_non_json_assertion_denied(self):
        raw=schema_graph(GOOD);raw["modules"][0]["dependencies"][0]["assertionType"]="text"
        with self.assertRaisesRegex(edge.EdgeFailure,"import_invalid"):self.run_graph(raw)
    def test_dynamic_json_denied(self):
        raw=schema_graph(GOOD);raw["modules"][0]["dependencies"][0]["isDynamic"]=True
        with self.assertRaisesRegex(edge.EdgeFailure,"import_invalid"):self.run_graph(raw)
    def test_type_only_json_denied(self):
        raw=schema_graph(GOOD);dep=raw["modules"][0]["dependencies"][0];dep["type"]=dep.pop("code")
        with self.assertRaisesRegex(edge.EdgeFailure,"import_invalid"):self.run_graph(raw)
    def test_json_node_kind_media_and_size_checked(self):
        for key,value in [("kind","esm"),("mediaType","TypeScript"),("size",0)]:
            with self.subTest(key=key):
                raw=schema_graph(GOOD);raw["modules"][1][key]=value
                with self.assertRaisesRegex(edge.EdgeFailure,"node_invalid"):self.run_graph(raw)
    def test_missing_json_graph_node_denied(self):
        raw=schema_graph(GOOD);raw["modules"].pop()
        with self.assertRaisesRegex(edge.EdgeFailure,"graph_incomplete"):self.run_graph(raw)
    def test_unreferenced_json_node_denied(self):
        raw=schema_graph(GOOD);raw["modules"][0]["dependencies"]=[]
        with self.assertRaisesRegex(edge.EdgeFailure,"graph_incomplete"):self.run_graph(raw)
    def test_json_as_root_denied(self):
        raw=schema_graph(GOOD);raw["roots"]=[raw["modules"][1]["specifier"]]
        with self.assertRaisesRegex(edge.EdgeFailure,"cannot_be_graph_root"):self.run_graph(raw)
    def test_json_layer_gate_stays_enforced(self):
        with self.assertRaisesRegex(edge.EdgeFailure,"layer_dependency"):self.run_graph(layers={SRC:"presentation"})
    def test_remote_resolution_stays_denied(self):
        raw=schema_graph(GOOD);raw["modules"][0]["dependencies"][0]["code"]["specifier"]="https://invalid.example/schema.json"
        with self.assertRaisesRegex(edge.EdgeFailure,"nonlocal"):self.run_graph(raw)

class CoexistingGraphTests(unittest.TestCase):
    def proof(self,root=GOOD,spec=None,manifest=None):
        return edge.graph_coexisting_catalog(root,{"coexisting_bound":[CAT]},spec or source_spec(root),snapshot(root) if manifest is None else manifest)
    def test_registered_catalog_graph_and_json_share_snapshot(self):
        proof=self.proof();raw=with_catalog(schema_graph(GOOD),GOOD)
        graph,seen=edge.normalize_graph(raw,GOOD,{SRC},{SRC:"verification"},manifest=snapshot(GOOD),coexisting=proof)
        self.assertIn(CAT,graph);self.assertIn(CAT,seen);self.assertIn(SCHEMA,seen)
    def test_coexisting_requires_manifest(self):
        with self.assertRaisesRegex(edge.EdgeFailure,"manifest_missing"):self.proof(manifest={SCHEMA:EXPECTED})
    def test_coexisting_requires_matching_manifest_bytes(self):
        manifest=snapshot(GOOD);manifest[CAT]="0"*64
        with self.assertRaisesRegex(edge.EdgeFailure,"manifest_mismatch"):self.proof(manifest=manifest)
    def test_coexisting_requires_matching_index_hash(self):
        spec=source_spec(GOOD);spec["workflow"]["documentation_sync"]["code_index"]["edge_sources"]["files"][0]["source_sha256"]="0"*64
        with self.assertRaisesRegex(edge.EdgeFailure,"index_mismatch"):self.proof(spec=spec)
    def test_coexisting_requires_registered_application_layer(self):
        spec=source_spec(GOOD);spec["workflow"]["documentation_sync"]["code_index"]["edge_sources"]["files"][0]["layer"]="verification"
        spec["implementation"][0]["layer"]="verification"
        with self.assertRaisesRegex(edge.EdgeFailure,"registration_mismatch"):self.proof(spec=spec)
    def test_coexisting_requires_matching_owner_registration(self):
        spec=source_spec(GOOD);spec["implementation"][0]["requirements"]=["OTHER"]
        with self.assertRaisesRegex(edge.EdgeFailure,"registration_mismatch"):self.proof(spec=spec)
    def test_coexisting_requires_original_index_format(self):
        spec=source_spec(GOOD);spec["workflow"]["documentation_sync"]["code_index"]["edge_sources"]["format"]="UNKNOWN"
        with self.assertRaisesRegex(edge.EdgeFailure,"index_unsupported"):self.proof(spec=spec)
    def test_coexisting_import_must_have_graph_node(self):
        raw=with_catalog(schema_graph(GOOD),GOOD);raw["modules"].pop()
        with self.assertRaisesRegex(edge.EdgeFailure,"coexisting_graph_incomplete"):
            edge.normalize_graph(raw,GOOD,{SRC},{SRC:"verification"},manifest=snapshot(GOOD),coexisting=self.proof())
    def test_coexisting_cannot_import_verification_layer(self):
        raw=with_catalog(schema_graph(GOOD),GOOD);raw["modules"][-1]["dependencies"]=[dict(specifier="../../tests/edge/synthetic.ts",code=dict(specifier=(GOOD/SRC).as_uri()))]
        with self.assertRaisesRegex(edge.EdgeFailure,"layer_dependency"):
            edge.normalize_graph(raw,GOOD,{SRC},{SRC:"verification"},manifest=snapshot(GOOD),coexisting=self.proof())
    def test_unlisted_coexisting_path_is_not_accepted(self):
        with self.assertRaisesRegex(edge.EdgeFailure,"scope_invalid"):
            edge.normalize_graph(schema_graph(GOOD),GOOD,{SRC},{SRC:"verification"},manifest=snapshot(GOOD),coexisting={"other.ts":{}})

class CoexistingDynamicImportTests(unittest.TestCase):
    def test_repinning_tampered_json_does_not_bypass_fixed_pin(self):
        actual=Path.read_bytes
        altered=actual(GOOD/SCHEMA)+b" "
        manifest=snapshot(GOOD);manifest[SCHEMA]=sha(altered)
        def fake(path):return altered if path==GOOD/SCHEMA else actual(path)
        with patch.object(Path,"read_bytes",fake), self.assertRaisesRegex(edge.EdgeFailure,"public_schema_hash_mismatch"):
            edge.normalize_graph(schema_graph(GOOD),GOOD,{SRC},{SRC:"verification"},manifest=manifest)
    def test_coexisting_computed_import_rejected_before_runtime(self):
        contract={"files":{SRC:{"layer":"verification","symbols":[]}}}
        scope={"foundation_ts":[SRC],"coexisting_bound":[CAT]}
        coexisting={CAT:{"layer":"application","source_sha256":"0"*64}}
        def fake_read_text(path,*args,**kwargs):
            return 'const value = import(requestPath)' if str(path).replace('\\','/').endswith(CAT) else ''
        with patch.object(edge,"classify_sources",return_value=scope), \
             patch.object(edge,"graph_coexisting_catalog",return_value=coexisting), \
             patch.object(edge,"hashes",return_value={}), \
             patch.object(Path,"read_text",fake_read_text), \
             patch.object(edge,"runtime") as runtime:
            with self.assertRaisesRegex(edge.EdgeFailure,"computed_dynamic_import_unsupported"):
                edge.parse_contract(GOOD,contract,None,GOOD,spec={},manifest_names=None)
            runtime.assert_not_called()
    def test_coexisting_literal_import_must_be_present_in_graph(self):
        with patch.object(Path,"read_text",return_value='const value = import("./wanted.ts")'):
            with self.assertRaisesRegex(edge.EdgeFailure,"dynamic_graph_incomplete"):
                edge.verify_graph_literals(GOOD,{CAT:[{"specifier":"./other.ts"}]},[CAT])
    def test_coexisting_literal_import_accepts_same_graph_specifier(self):
        with patch.object(Path,"read_text",return_value='const value = import("./wanted.ts")'):
            edge.verify_graph_literals(GOOD,{CAT:[{"specifier":"./wanted.ts"}]},[CAT])
    def test_missing_coexisting_graph_source_is_not_empty_success(self):
        with patch.object(Path,"read_text",return_value=''):
            with self.assertRaisesRegex(edge.EdgeFailure,"dynamic_graph_source_missing"):
                edge.verify_graph_literals(GOOD,{},[CAT])
if __name__=="__main__":
    unittest.main()