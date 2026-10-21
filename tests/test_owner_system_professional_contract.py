"""Regression checks for delegated system paths and the separate tenant contract.

These are source-policy checks; no live user, DB, JWT or institution is simulated as accepted.
"""
from copy import deepcopy
import json
from pathlib import Path
import sys
import unittest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import check_branch_policy as policy
from check_project_consistency import validate_professional_service_contract


class OwnerSystemBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.spec=json.loads((ROOT/'docs/current/service_spec.json').read_bytes())
        self.branch=self.spec['workflow']['presentation_work_branch']
        self.registry=self.spec['workflow']['branch_governance']['service_delegation_policy']

    def test_owner_can_change_auth_and_runtime_but_cannot_write_SQL_or_real_repository(self):
        self.assertEqual(policy.validate_delegated_service_paths(self.branch,self.registry['shared_system_paths'],self.spec),[])
        for path in ('database/migrations/pro.sql','supabase/functions/_shared/jungsi/infrastructure/score_input_postgres.ts',
                     'supabase/functions/_shared/jungsi/infrastructure/native_data_provider.ts',
                     'supabase/functions/_shared/jungsi/application/university_scoring.ts'):
            with self.subTest(path=path):self.assertTrue(policy.validate_delegated_service_paths(self.branch,[path],self.spec))

    def test_shared_path_registry_cannot_disguise_a_data_or_engine_exception(self):
        for field,path in (('shared_system_paths','database/pro.sql'),
                           ('shared_system_paths','supabase/functions/_shared/jungsi/infrastructure/score_input_postgres.ts'),
                           ('shared_http_paths','supabase/functions/_shared/jungsi/infrastructure/native_data_provider.ts')):
            s=deepcopy(self.spec);s['workflow']['branch_governance']['service_delegation_policy'][field].append(path)
            with self.subTest(field=field,path=path):self.assertTrue(policy.validate_service_delegation(s))

    def test_feature_must_merge_trusted_owner_delegation_instead_of_self_granting(self):
        s=deepcopy(self.spec);s['workflow']['branch_governance']['service_delegation_policy']['shared_system_paths']=[]
        self.assertTrue(policy.delegation_policy_edit_errors(self.branch,self.spec,s))
        self.assertEqual(policy.delegation_policy_edit_errors('develop',self.spec,s),[])

    def test_student_contract_stays_separate_from_registered_personal_API(self):
        self.assertEqual(validate_professional_service_contract(self.spec),[])
        current={(o['method'],o['path'])for o in self.spec['operations']}
        self.assertTrue(all((o['method'],o['path'])not in current for o in self.spec['professional_service_contract']['candidate_operations']))
        s=deepcopy(self.spec);s['professional_service_contract']['runtime_activation']='PASS'
        self.assertTrue(validate_professional_service_contract(s))

    def test_teacher_personal_ownership_and_org_admin_correction_are_rejected(self):
        for section,key,value in (('ownership','record_owner','teacher'),
                                  ('ownership','personal_report_mixing_allowed',True),
                                  ('score_input','org_admin_self_correction_allowed',True),
                                  ('identity','client_org_role_or_student_claim_trusted',True)):
            s=deepcopy(self.spec);s['professional_service_contract'][section][key]=value
            with self.subTest(section=section,key=key):self.assertTrue(validate_professional_service_contract(s))

    def test_twenty_student_workload_cannot_become_unlimited_or_admin_exempt(self):
        for key in ('administrator_exemption_substitute','unlimited_or_null_fallback','capacity_twenty_means_twenty_parallel_jobs'):
            s=deepcopy(self.spec);s['professional_service_contract']['budget'][key]=True
            with self.subTest(key=key):self.assertTrue(validate_professional_service_contract(s))


if __name__=='__main__':unittest.main()
