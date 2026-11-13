"""The added source suite cannot borrow the original foundation count or stale bytes."""
import ast
import copy
import hashlib
import json
from pathlib import Path
import unittest

import run_edge_tests as runner
from check_project_consistency import MEMBER_SCHOOL_OVERLAY_FIELD, MEMBER_SCHOOL_OVERLAY_PATHS, _MU, _MC, _MX


class SchoolReferenceHarnessCases(unittest.TestCase):
    def fixture(self):
        spec = json.loads((Path(__file__).resolve().parents[1] / 'docs/current/service_spec.json').read_bytes())
        contract = spec['university_scoring_contract']['scoped_reference_contract']
        verification = contract['verification']
        rebound = contract.get('verification_current_source_rebound_20261113')
        rebound_v2 = contract.get('verification_current_source_rebound_20261113_v2')
        selected = rebound_v2 if rebound_v2 is not None else (rebound if rebound is not None else verification)
        before = {b['path']: b['sha256'] for b in selected['source_bindings']}
        overlay = spec.get(MEMBER_SCHOOL_OVERLAY_FIELD)
        if overlay is not None:
            root = Path(__file__).resolve().parents[1]
            # Check every registered source and overlay pin against selected snapshot bytes.
            for path in sorted(set(before) | set(MEMBER_SCHOOL_OVERLAY_PATHS)):
                relative = Path(path)
                if relative.is_absolute() or '..' in relative.parts or '\\' in path or ':' in path:
                    raise ValueError('unsafe snapshot source path')
                target = root / relative
                if target.is_symlink() or not target.resolve().is_relative_to(root.resolve()):
                    raise ValueError('unsafe snapshot source path')
                before[path] = hashlib.sha256(target.read_bytes()).hexdigest()
        return spec, before

    def test_separate_exact_suite_retains_foundation(self):
        spec, before = self.fixture()
        verification = runner.school_reference_registration(spec, before)
        self.assertEqual(verification['test_count'], 97)
        self.assertEqual(spec['edge_harness']['unit_count'], 656)
        source = Path(__file__).resolve().parents[1] / 'scripts/check_project_consistency.py'
        functions = [n.name for n in ast.parse(source.read_text(encoding='utf8')).body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]
        self.assertEqual(len(functions), len(set(functions)), 'Common validation functions must not silently override one another')

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
        contract = spec['university_scoring_contract']['scoped_reference_contract']
        contract.pop('verification')
        if contract.get('verification_current_source_rebound_20261113') is not None:
            with self.assertRaisesRegex(runner.EdgeFailure, 'school_reference_rebound_invalid'):
                runner.school_reference_registration(spec, before)
        contract.pop('verification_current_source_rebound_20261113', None)
        contract.pop('verification_current_source_rebound_20261113_v2', None)
        with self.assertRaisesRegex(runner.EdgeFailure, 'school_reference_verification_missing'):
            runner.school_reference_registration(spec, before)
        self.assertIsNone(runner.school_reference_registration({}, {}))

    def test_rebound_preserves_history_and_rejects_forged_either_binding(self):
        spec, before = self.fixture()
        contract = spec['university_scoring_contract']['scoped_reference_contract']
        rebound = contract.get('verification_current_source_rebound_20261113')
        if rebound is None:
            self.skipTest('current source rebound is absent from this snapshot')
        history = copy.deepcopy(contract['verification'])
        selected = copy.deepcopy(contract.get('verification_current_source_rebound_20261113_v2', rebound))
        if spec.get(MEMBER_SCHOOL_OVERLAY_FIELD) is not None:
            for row in selected['source_bindings']:
                if row['path'] in {_MU, _MC, _MX}:
                    row['sha256'] = before[row['path']]
        self.assertEqual(runner.school_reference_registration(spec, before), selected)
        self.assertEqual(contract['verification'], history)
        keys = ['verification', 'verification_current_source_rebound_20261113']
        if contract.get('verification_current_source_rebound_20261113_v2') is not None:
            keys.append('verification_current_source_rebound_20261113_v2')
        for key in keys:
            with self.subTest(forged=key):
                changed = copy.deepcopy(spec)
                changed_contract = changed['university_scoring_contract']['scoped_reference_contract']
                changed_contract[key]['source_bindings'][0]['sha256'] = '0' * 64
                with self.assertRaisesRegex(runner.EdgeFailure, 'school_reference_'):
                    runner.school_reference_registration(changed, before)
        self.assertEqual(contract['verification'], history)

    def test_current_overlay_binds_actual_snapshot_and_rejects_tampering(self):
        spec, before = self.fixture()
        self.assertIsNotNone(runner.school_reference_registration(spec, before))
        overlay = spec.get(MEMBER_SCHOOL_OVERLAY_FIELD)
        if overlay is None:
            return
        for path in overlay['source_bindings']:
            with self.subTest(path=path):
                forged = dict(before)
                forged[path] = '0' * 64 if before[path] != '0' * 64 else 'f' * 64
                with self.assertRaisesRegex(runner.EdgeFailure, 'school_reference_overlay_invalid'):
                    runner.school_reference_registration(spec, forged)

    def test_historical_only_fixture_retains_original_binding(self):
        current, before = self.fixture()
        self.assertIsNotNone(runner.school_reference_registration(current, before))
        spec = copy.deepcopy(current)
        spec.pop(MEMBER_SCHOOL_OVERLAY_FIELD, None)
        contract = spec['university_scoring_contract']['scoped_reference_contract']
        contract.pop('verification_current_source_rebound_20261113', None)
        contract.pop('verification_current_source_rebound_20261113_v2', None)
        historical = contract['verification']
        before = {b['path']: b['sha256'] for b in historical['source_bindings']}
        self.assertEqual(runner.school_reference_registration(spec, before), historical)

    def test_three_source_v2_rebound_rejects_forgery_and_preserves_history(self):
        current, before = self.fixture()
        self.assertIsNotNone(runner.school_reference_registration(current, before))
        spec = copy.deepcopy(current)
        spec.pop(MEMBER_SCHOOL_OVERLAY_FIELD, None)
        contract = spec['university_scoring_contract']['scoped_reference_contract']
        contract.pop('verification_current_source_rebound_20261113_v2', None)
        historical = copy.deepcopy(contract['verification'])
        previous = copy.deepcopy(contract['verification_current_source_rebound_20261113'])
        v2 = copy.deepcopy(previous)
        v2['format'] = 'jungsi.school-reference-current-source-rebound/v2'
        additions = {
            'supabase/functions/_shared/jungsi/infrastructure/native_data_provider.ts': 'abbc67d7a86fe0e8269252c384e7dc0ae6659e22c4be74fecb22cdbd43126f2e',
            'supabase/functions/_shared/jungsi/infrastructure/runtime_composition.ts': '1af7e8e57871a38ec61b29a3bbb2c254348d4bad6215ca5b58f4afb0bb504773',
        }
        for row in v2['source_bindings']:
            if row['path'] in additions: row['sha256'] = additions[row['path']]
        contract['verification_current_source_rebound_20261113_v2'] = v2
        before = {b['path']: b['sha256'] for b in v2['source_bindings']}
        self.assertEqual(runner.school_reference_registration(spec, before), v2)
        self.assertEqual(contract['verification'], historical)
        self.assertEqual(contract['verification_current_source_rebound_20261113'], previous)
        altered = [*additions, runner.SCHOOL_REFERENCE_CANCELLATION_SOURCE]
        other = next(p for p in before if p not in altered)
        for mode in ['history','prior_rebound','other','duplicate','missing_prior','missing_history','native','activation','count'] + altered:
            with self.subTest(mode=mode):
                changed = copy.deepcopy(spec)
                c = changed['university_scoring_contract']['scoped_reference_contract']
                value = c['verification_current_source_rebound_20261113_v2']
                if mode == 'history': c['verification']['source_bindings'][0]['sha256'] = '0' * 64
                elif mode == 'prior_rebound': c['verification_current_source_rebound_20261113']['source_bindings'][0]['sha256'] = '0' * 64
                elif mode == 'missing_prior': c.pop('verification_current_source_rebound_20261113')
                elif mode == 'missing_history': c.pop('verification')
                elif mode == 'duplicate': value['source_bindings'].append(copy.deepcopy(value['source_bindings'][0]))
                elif mode == 'native': value['native_acceptance'] = 'PASS'
                elif mode == 'activation': value['activation_status'] = 'PASS'
                elif mode == 'count': value['test_count'] = 98
                else:
                    path = other if mode == 'other' else mode
                    next(r for r in value['source_bindings'] if r['path'] == path)['sha256'] = '0' * 64
                with self.assertRaisesRegex(runner.EdgeFailure, 'school_reference_'):
                    runner.school_reference_registration(changed, before)
        for path in altered:
            with self.subTest(snapshot_mismatch=path):
                changed_before = dict(before); changed_before[path] = '0' * 64
                with self.assertRaisesRegex(runner.EdgeFailure, 'school_reference_'):
                    runner.school_reference_registration(spec, changed_before)
