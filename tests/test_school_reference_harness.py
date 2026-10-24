"""The added source suite cannot borrow the original foundation count or stale bytes."""
import copy
import json
from pathlib import Path
import unittest

import run_edge_tests as runner


class SchoolReferenceHarnessCases(unittest.TestCase):
    def fixture(self):
        spec = json.loads((Path(__file__).resolve().parents[1] / 'docs/current/service_spec.json').read_bytes())
        verification = spec['university_scoring_contract']['scoped_reference_contract']['verification']
        return spec, {b['path']: b['sha256'] for b in verification['source_bindings']}

    def test_separate_exact_suite_retains_foundation(self):
        spec, before = self.fixture()
        verification = runner.school_reference_registration(spec, before)
        self.assertEqual(verification['test_count'], 46)
        self.assertEqual(spec['edge_harness']['unit_count'], 656)

    def test_additive_suite_cannot_lose_pins_or_count(self):
        for mutation in ('hash', 'count', 'baseline', 'paths'):
            with self.subTest(mutation=mutation):
                spec, before = self.fixture()
                verification = spec['university_scoring_contract']['scoped_reference_contract']['verification']
                if mutation == 'hash': verification['source_bindings'][0]['sha256'] = 'f' * 64
                elif mutation == 'count': verification['test_count'] = 45
                elif mutation == 'baseline': verification['baseline_foundation_count'] = 702
                else: verification['test_paths'] = verification['test_paths'][:-1]
                with self.assertRaisesRegex(runner.EdgeFailure, 'school_reference_'):
                    runner.school_reference_registration(spec, before)

    def test_source_cannot_drop_verification_and_original_fixture_keeps_its_scope(self):
        spec, before = self.fixture()
        spec = copy.deepcopy(spec)
        spec['university_scoring_contract']['scoped_reference_contract'].pop('verification')
        with self.assertRaisesRegex(runner.EdgeFailure, 'school_reference_verification_missing'):
            runner.school_reference_registration(spec, before)
        self.assertIsNone(runner.school_reference_registration({}, {}))
