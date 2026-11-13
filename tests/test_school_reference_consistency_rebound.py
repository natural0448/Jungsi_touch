"""School reference rebound selection; planning draft fixture is NOT acceptance."""
import copy
import json
from pathlib import Path
import unittest
import check_project_consistency as c
import run_edge_tests as runner

ROOT = Path(__file__).resolve().parents[1]
ERROR = 'School reference source/test registration invalid'

class SchoolReferenceConsistencyReboundTests(unittest.TestCase):
    def setUp(self):
        self.spec=json.loads((ROOT/'docs/current/service_spec.json').read_bytes())
        self.contract=self.spec['university_scoring_contract']['scoped_reference_contract']
        self.assertIsNotNone(self.contract.get('verification_current_source_rebound_20261113_v2'))

    def align_index_to(self, verification):
        bindings={x['path']:x['sha256'] for x in verification['source_bindings']}
        for path,row in self.spec['edge_harness']['files'].items():
            if path in bindings:row['declarations']['source_sha256']=bindings[path]
        for row in self.spec['workflow']['documentation_sync']['code_index']['edge_sources']['files']:
            if row['path'] in bindings:row['source_sha256']=bindings[row['path']]

    def test_v2_clears_registration_and_downstream_read_view_and_req27_drift(self):
        history=copy.deepcopy(self.contract['verification'])
        paths,errors=c.school_reference_test_registration(self.spec)
        self.assertEqual(errors,[]);self.assertEqual(paths,set(runner.SCHOOL_REFERENCE_TESTS))
        self.assertNotIn('Read-view separate exact suite registration drift',c.validate_read_view_extension(self.spec))
        self.assertNotIn('REQ-27 exact legacy22 plus extension3 scope drift',c.validate_score_input_policy(self.spec))
        self.assertEqual(self.contract['verification'],history)

    def test_prior_and_history_fallbacks(self):
        # This isolated historical fixture predates the newer member-results overlay.
        self.spec.pop(c.MEMBER_SCHOOL_OVERLAY_FIELD, None)
        self.contract.pop('verification_current_source_rebound_20261113_v2')
        v1=self.contract['verification_current_source_rebound_20261113'];self.align_index_to(v1)
        self.assertEqual(c.school_reference_test_registration(self.spec)[1],[])
        self.contract.pop('verification_current_source_rebound_20261113');self.align_index_to(self.contract['verification'])
        self.assertEqual(c.school_reference_test_registration(self.spec)[1],[])

    def test_history_prior_v2_and_index_forgery_remain_rejected(self):
        for mode in ('history','v1','v2','other','source_index','empty_v2','non_dict_v2','missing_v1'):
            with self.subTest(mode=mode):
                spec=copy.deepcopy(self.spec);contract=spec['university_scoring_contract']['scoped_reference_contract']
                v2=contract['verification_current_source_rebound_20261113_v2']
                if mode in ('history','v1','v2'):
                    k={'history':'verification','v1':'verification_current_source_rebound_20261113','v2':'verification_current_source_rebound_20261113_v2'}[mode]
                    contract[k]['source_bindings'][0]['sha256']='0'*64
                elif mode=='other':next(x for x in v2['source_bindings'] if x['path'] not in {runner.SCHOOL_REFERENCE_CANCELLATION_SOURCE, 'supabase/functions/_shared/jungsi/infrastructure/native_data_provider.ts', 'supabase/functions/_shared/jungsi/infrastructure/runtime_composition.ts'})['sha256']='0'*64
                elif mode=='source_index':
                    p='supabase/functions/_shared/jungsi/infrastructure/runtime_composition.ts'
                    next(x for x in spec['workflow']['documentation_sync']['code_index']['edge_sources']['files'] if x['path']==p)['source_sha256']='0'*64
                elif mode=='empty_v2':contract['verification_current_source_rebound_20261113_v2']={}
                elif mode=='non_dict_v2':contract['verification_current_source_rebound_20261113_v2']='invalid'
                else:contract.pop('verification_current_source_rebound_20261113')
                self.assertIn(ERROR,c.school_reference_test_registration(spec)[1])
