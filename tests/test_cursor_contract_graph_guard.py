"""Offline synthetic regressions for the separately pinned cursor graph."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import unittest

from run_edge_tests import (CURCG_ADAPTERS, CURCG_AGGREGATION, CURCG_FIXTURE, CURCG_MANIFEST,
    CURCG_META, CURCG_PREFIX, CURCG_PROJECT_BINDING, CURCG_REGRESSION, CURCG_ROOTS, CURCG_SHARED,
    CURCG_TEST_FILES, EdgeFailure, _curcg_imports, _curcg_layer, cursor_contract_registration,
    preflight_cursor_graph_manifest, reference_cursor_graph_info, verify_cursor_graph_manifest)

ROOT = Path(__file__).resolve().parents[1]

def sha(path):
    return hashlib.sha256((ROOT / path).read_bytes()).hexdigest()

class CursorGraphGuardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.model=json.loads((ROOT/CURCG_MANIFEST).read_bytes())
        names={CURCG_MANIFEST, CURCG_REGRESSION, CURCG_AGGREGATION, cls.model['config']['path']}|set(CURCG_TEST_FILES)
        names|={p for g in cls.model['graphs'].values() for p in g['files']}
        cls.before={p:sha(p) for p in names}
        cls.meta={'manifest_sha256':cls.before[CURCG_MANIFEST]}
        cls.graphs={p:reference_cursor_graph_info(ROOT,cls.before,p,cls.model['graphs'][p]) for p in CURCG_ROOTS}

    def test_pinned_closure_and_static_preflight(self):
        self.assertEqual(preflight_cursor_graph_manifest(ROOT,self.before,self.meta)['roots'],2)
        self.assertEqual(verify_cursor_graph_manifest(ROOT,self.before,self.meta,self.graphs)['files'],3)

    def test_manifest_pin_mismatch_fails(self):
        with self.assertRaises(EdgeFailure):preflight_cursor_graph_manifest(ROOT,self.before,{'manifest_sha256':'0'*64})

    def test_missing_or_unregistered_cursor_test_fails(self):
        for path in (CURCG_ROOTS[0],CURCG_FIXTURE):
            before=dict(self.before);del before[path]
            with self.assertRaises(EdgeFailure):verify_cursor_graph_manifest(ROOT,before,self.meta,self.graphs)
        before={**self.before,CURCG_PREFIX+'extra.test.ts':'a'*64}
        with self.assertRaises(EdgeFailure):verify_cursor_graph_manifest(ROOT,before,self.meta,self.graphs)

    def test_changed_snapshot_file_fails_before_deno(self):
        before=dict(self.before);before[CURCG_ROOTS[0]]='a'*64
        with self.assertRaises(EdgeFailure):preflight_cursor_graph_manifest(ROOT,before,self.meta)

    def test_changed_graph_edge_fails(self):
        graphs=deepcopy(self.graphs); first=graphs[CURCG_ROOTS[0]]
        module=next(m for m in first['modules'] if m.get('dependencies'))
        module['dependencies'][0]['isDynamic']=True
        with self.assertRaises(EdgeFailure):verify_cursor_graph_manifest(ROOT,self.before,self.meta,graphs)

    def test_missing_or_extra_root_fails(self):
        graphs=dict(self.graphs);del graphs[CURCG_ROOTS[1]]
        with self.assertRaises(EdgeFailure):verify_cursor_graph_manifest(ROOT,self.before,self.meta,graphs)

    def test_external_module_kind_is_rejected(self):
        graphs=deepcopy(self.graphs);graphs[CURCG_ROOTS[0]]['modules'][0]['kind']='npm'
        with self.assertRaises(EdgeFailure):verify_cursor_graph_manifest(ROOT,self.before,self.meta,graphs)

    def test_remote_or_dynamic_source_import_rejected(self):
        for raw in (b'import("https://example.invalid/module.ts")', b'const f = eval'):
            with self.subTest(raw=raw),self.assertRaises(EdgeFailure):_curcg_imports('candidate.ts',raw)

    def test_project_binding_exception_is_exactly_hash_pinned(self):
        self.assertTrue(_curcg_imports(CURCG_PROJECT_BINDING,(ROOT/CURCG_PROJECT_BINDING).read_bytes()))
        with self.assertRaises(EdgeFailure):_curcg_imports(CURCG_PROJECT_BINDING,b'const x="require";')

    def test_unapproved_test_or_adapter_path_rejected(self):
        for path in (CURCG_PREFIX+'extra.ts','supabase/functions/_shared/unregistered.ts','../escape.ts'):
            with self.subTest(path=path),self.assertRaises(EdgeFailure):_curcg_layer(path)

    def test_metadata_registration_requires_exact_22_cases_and_pinned_regressions(self):
        meta={'format':'jungsi.cursor-contract-offline-verification/v1',
          'status':'SOURCE_CANDIDATE_SYNTHETIC_ONLY_NOT_ACTIVATED','manifest_path':CURCG_MANIFEST,
          'manifest_sha256':self.meta['manifest_sha256'],
          'regression_test':{'path':CURCG_REGRESSION,'sha256':self.before[CURCG_REGRESSION]},
          'aggregation_test':{'path':CURCG_AGGREGATION,'sha256':self.before[CURCG_AGGREGATION]},
          'cases':{CURCG_ROOTS[0]:[f'syn{i}' for i in range(7)],CURCG_ROOTS[1]:[f'syn{i}' for i in range(15)]},
          'production_ready':False}
        spec={CURCG_META:meta,'edge_harness':{'unit_count':656,'tests':[f'test{i}' for i in range(44)]}}
        self.assertIsNotNone(cursor_contract_registration(ROOT,self.before,spec))
        bad=deepcopy(spec);bad[CURCG_META]['cases'][CURCG_ROOTS[0]].pop()
        with self.assertRaises(EdgeFailure):cursor_contract_registration(ROOT,self.before,bad)
        bad=deepcopy(spec);bad[CURCG_META]['regression_test']['sha256']='0'*64
        with self.assertRaises(EdgeFailure):cursor_contract_registration(ROOT,self.before,bad)

    def test_registration_cannot_disappear_while_tests_remain(self):
        with self.assertRaises(EdgeFailure):cursor_contract_registration(ROOT,self.before,{})
        source_only={p:v for p,v in self.before.items() if not p.startswith(CURCG_PREFIX) and p!=CURCG_MANIFEST}
        with self.assertRaises(EdgeFailure):cursor_contract_registration(ROOT,source_only,{})

if __name__=='__main__': unittest.main()
