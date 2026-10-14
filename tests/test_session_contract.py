"""Formal session permissions/DTO cannot drift toward client roles or legacy API."""
from copy import deepcopy
import json,sys,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
from check_project_consistency import validate_spec,generated_files
class FormalSessionContractTests(unittest.TestCase):
    def setUp(self):
        self.spec=json.loads((ROOT/'docs/current/service_spec.json').read_bytes())
        self.session=next(o for o in self.spec['operations'] if o['id']=='session.read')
    def test_formal_contract_and_current_SQL_condition_pass(self):
        self.assertEqual(validate_spec(self.spec),[])
    def test_wrong_paid_standard_or_guest_access_is_rejected(self):
        for tiers in [['paid'],['guest','standard','paid'],['standard','admin']]:
            with self.subTest(tiers=tiers):
                self.session['member_tiers']=tiers
                self.assertIn('Formal session access contract drift',validate_spec(self.spec))
    def test_owner_or_confirmed_score_prerequisite_is_rejected(self):
        for field in ['report_owner','confirmed_score_profile']:
            for value in [True,None,0]:
                with self.subTest(field=field,value=value):
                    s=deepcopy(self.spec);next(o for o in s['operations'] if o['id']=='session.read')[field]=value
                    self.assertIn('Formal session access contract drift',validate_spec(s))
    def test_client_role_email_ID_or_missing_expiry_is_rejected(self):
        for fields in [['id','email','role'],['format','member_tier'],['format','member_tier','entitlement_expires_at','role']]:
            with self.subTest(fields=fields):
                self.spec['backend_platform_contract']['dto_schemas']['session']['fields']=fields
                self.assertIn('Formal session DTO contract drift',validate_spec(self.spec))
    def test_wrong_path_method_body_or_idempotency_is_rejected(self):
        for key,value in [('method','POST'),('path','/api/v1/jeongsi/me')]:
            s=deepcopy(self.spec);next(o for o in s['operations'] if o['id']=='session.read')[key]=value
            self.assertIn('Formal session access contract drift',validate_spec(s))
        for key,value in [('body',['role']),('query',['member_tier']),('idempotency_key_required',True),('response_schema','profile')]:
            s=deepcopy(self.spec);next(o for o in s['operations'] if o['id']=='session.read')['http_contract'][key]=value
            self.assertIn('Formal session DTO contract drift',validate_spec(s))
    def test_legacy_status_product_rule_is_not_invented(self):
        self.spec['backend_platform_contract']['dto_schemas']['session']['rules'][0]='status=active and product=jeongsi'
        self.assertIn('Formal session entitlement rule drift',validate_spec(self.spec))
    def test_confirmed_own_profile_status_does_not_permit_a_pass_status_column(self):
        self.assertIn('public.profiles.status=active',self.spec['backend_platform_contract']['dto_schemas']['session']['rules'][0])
        self.assertEqual(validate_spec(self.spec),[])
        for clause in [' public.jeongsi_passes.status=active',' status=active']:
            wrong=deepcopy(self.spec);wrong['backend_platform_contract']['dto_schemas']['session']['rules'][0]+=clause
            self.assertIn('Formal session entitlement rule drift',validate_spec(wrong))
    def test_superseded_proposed_session_is_not_revived(self):
        self.spec['session_contract']={'status':'proposed'}
        self.assertIn('Superseded proposed session contract must not be revived',validate_spec(self.spec))
    def test_generated_API_title_uses_current_operations_count(self):
        path=self.spec['current_documents']['api_dto'];text=generated_files(self.spec)[path].decode()
        self.assertIn('## 22개 요청과 응답',text);self.assertNotIn('## 12개 요청과 응답',text)
if __name__=='__main__':unittest.main()
