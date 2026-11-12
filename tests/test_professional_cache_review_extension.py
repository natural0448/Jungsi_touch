"""Synthetic checks for separate review-only pro cache source registration."""
import copy
import json
from pathlib import Path
import unittest
import check_project_consistency as c

ROOT = Path(__file__).resolve().parents[1]
PATH = c.PROFESSIONAL_APP + 'student_cache_scope_candidate.ts'
SHA = 'a' * 64
ERROR = 'Professional student cache review extension invalid'

class ProfessionalCacheReviewExtensionTests(unittest.TestCase):
    def fixture(self):
        spec = json.loads((ROOT / 'docs/current/service_spec.json').read_bytes())
        contract = spec['professional_service_contract']
        reg = contract['source_registration']
        before = {x['path']: x['sha256'] for x in reg['source_bindings'] + reg['migrations']}
        history = copy.deepcopy(reg)
        existing = contract.get('student_cache_scope_review_extension')
        if existing is not None:
            # Validate the current registration before projecting a separate
            # legacy fixture on which the synthetic candidate can be added.
            current_hashes = dict(before)
            current_hashes[existing['path']] = existing['sha256']
            self.assertEqual(c.validate_professional_source_registration(spec, current_hashes), [])
            spec = copy.deepcopy(spec)
            contract = spec['professional_service_contract']
            contract.pop('student_cache_scope_review_extension')
            spec['implementation'] = [r for r in spec['implementation'] if r.get('path') != PATH]
            index = spec['workflow']['documentation_sync']['code_index']['edge_sources']['files']
            index[:] = [r for r in index if r.get('path') != PATH]
            spec['edge_harness']['files'].pop(PATH, None)
        return spec, before, history

    def test_current_extension_rejects_missing_snapshot_and_tampered_index(self):
        spec = json.loads((ROOT / 'docs/current/service_spec.json').read_bytes())
        contract = spec['professional_service_contract']
        ext = contract.get('student_cache_scope_review_extension')
        if ext is None:
            self.skipTest('current cache candidate is absent from this snapshot')
        reg = contract['source_registration']
        hashes = {x['path']: x['sha256'] for x in reg['source_bindings'] + reg['migrations']}
        hashes[ext['path']] = ext['sha256']
        self.assertEqual(c.validate_professional_source_registration(spec, hashes), [])
        missing = dict(hashes)
        missing.pop(ext['path'])
        self.assertIn(ERROR, c.validate_professional_source_registration(spec, missing))
        changed = copy.deepcopy(spec)
        rows = changed['workflow']['documentation_sync']['code_index']['edge_sources']['files']
        next(row for row in rows if row.get('path') == ext['path'])['source_sha256'] = '0' * 64
        self.assertIn(ERROR, c.validate_professional_source_registration(changed, hashes))

    def add_candidate(self, spec, hashes):
        spec['professional_service_contract']['student_cache_scope_review_extension'] = dict(
            format='jungsi.professional-student-cache-review-source/v1', status='SOURCE_CANDIDATE_REVIEW_ONLY',
            path=PATH, sha256=SHA, native_acceptance='NOT_VERIFIED_BY_SOURCE_SUITE',
            activation_status='NOT_RUN', operating_writes=0)
        spec['implementation'].append(dict(path=PATH, layer='application', requirements=['REQ-31'],
                                           symbols=[], status='SOURCE_CANDIDATE_REVIEW_ONLY'))
        spec['workflow']['documentation_sync']['code_index']['edge_sources']['files'].append(dict(path=PATH, source_sha256=SHA))
        hashes[PATH] = SHA

    def test_existing_historical_registry_alone_unchanged(self):
        spec, hashes, history = self.fixture()
        self.assertEqual(c.validate_professional_source_registration(spec, hashes), [])
        self.assertEqual(spec['professional_service_contract']['source_registration'], history)

    def test_separate_candidate_and_history_both_bound(self):
        spec, hashes, history = self.fixture(); self.add_candidate(spec, hashes)
        self.assertEqual(c.validate_professional_source_registration(spec, hashes), [])
        self.assertEqual(spec['professional_service_contract']['source_registration'], history)

    def test_unregistered_candidate_is_rejected(self):
        spec, hashes, _ = self.fixture(); hashes[PATH] = SHA
        self.assertIn(ERROR, c.validate_professional_source_registration(spec, hashes))

    def test_candidate_missing_or_forged_is_rejected(self):
        for mode in ('missing_source','forged_source','forged_pin','forged_index','wrong_status','wrong_layer','duplicate_implementation','boolean_writes'):
            with self.subTest(mode=mode):
                spec, hashes, _ = self.fixture(); self.add_candidate(spec, hashes)
                ext = spec['professional_service_contract']['student_cache_scope_review_extension']
                if mode == 'missing_source': hashes.pop(PATH)
                elif mode == 'forged_source': hashes[PATH] = 'b' * 64
                elif mode == 'forged_pin': ext['sha256'] = 'b' * 64
                elif mode == 'forged_index': spec['workflow']['documentation_sync']['code_index']['edge_sources']['files'][-1]['source_sha256'] = 'b' * 64
                elif mode == 'wrong_status': ext['activation_status'] = 'PASS'
                elif mode == 'wrong_layer': spec['implementation'][-1]['layer'] = 'data_infrastructure'
                elif mode == 'duplicate_implementation': spec['implementation'].append(copy.deepcopy(spec['implementation'][-1]))
                else: ext['operating_writes'] = False
                self.assertIn(ERROR, c.validate_professional_source_registration(spec, hashes))

    def test_existing_professional_coverage_and_hash_are_still_required(self):
        for mode in ('extra','missing','forged'):
            with self.subTest(mode=mode):
                spec, hashes, _ = self.fixture(); self.add_candidate(spec, hashes)
                old = next(x['path'] for x in spec['professional_service_contract']['source_registration']['source_bindings'])
                if mode == 'extra': hashes[c.PROFESSIONAL_APP + 'unregistered.ts'] = 'c' * 64
                elif mode == 'missing': hashes.pop(old)
                else: hashes[old] = 'c' * 64
                self.assertTrue(c.validate_professional_source_registration(spec, hashes))
