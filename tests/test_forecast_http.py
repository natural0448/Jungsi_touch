"""HTTP integration against the committed generated contract."""
import json
import unittest
from pathlib import Path
from fastapi.testclient import TestClient
from jungsi_touch.infrastructure.http_api import create_app
from jungsi_touch.infrastructure.memory_forecast_repository import MemoryForecastRepository
from backend_synthetic_fixture import FrozenClock,SyntheticSessions,SyntheticData
from test_session_read import Entitlements
from forecast_synthetic_fixture import Inputs

ROUTES=[('session.read','GET','/api/v1/me'),('forecast.capabilities','GET','/api/v1/forecast-capabilities'),('forecast.list','GET','/api/v1/forecast-drafts'),('forecast.create','POST','/api/v1/offerings/{offering_id}/forecast-drafts'),('forecast.read','GET','/api/v1/forecast-drafts/{draft_id}'),('forecast.adjust','POST','/api/v1/forecast-drafts/{draft_id}/adjustments'),('forecast.validate','POST','/api/v1/forecast-drafts/{draft_id}/validations'),('forecast.approve','POST','/api/v1/forecast-drafts/{draft_id}/approvals'),('forecast.publish','POST','/api/v1/forecast-drafts/{draft_id}/publications'),('forecast.published.read','GET','/api/v1/offerings/{offering_id}/forecast')]

class ForecastHttpTests(unittest.TestCase):
    def setUp(self):
        self.clock=FrozenClock();self.repository=Entitlements();self.inputs=Inputs(False)
        self.store=MemoryForecastRepository({'SYNTHETIC-editor':dict(edit=True,approve=True,university_ids=['SYNTHETIC-U'])})
        self.app=create_app(repository=self.repository,data=SyntheticData(self.clock),sessions=SyntheticSessions(self.clock),clock=self.clock,forecast_repository=self.store,forecast_inputs=self.inputs)
        self.client=TestClient(self.app);self.key=0
    def request(self,method,path,body=None,owner='SYNTHETIC-editor'):
        self.key+=1;headers={'Authorization':'Bearer '+owner,'Idempotency-Key':'SYNTHETIC-http-'+str(self.key)} if owner else {}
        return self.client.request(method,path,json=body,headers=headers)
    def create(self):
        response=self.request('POST','/api/v1/offerings/SYNTHETIC-O/forecast-drafts',dict(input_id='SYNTHETIC-input-id',input_version='SYNTHETIC-input',policy_id='SYNTHETIC-policy-id',policy_version='SYNTHETIC-policy'))
        self.assertEqual(response.status_code,200,response.text);return response.json()
    def test_session_and_capability_are_distinct(self):
        response=self.request('GET','/api/v1/me');self.assertEqual(response.status_code,200);self.assertEqual(response.json()['member_tier'],'standard')
        self.assertTrue(self.request('GET','/api/v1/forecast-capabilities').json()['capabilities'])
        self.assertEqual(self.request('GET','/api/v1/me',owner=None).status_code,401)
        self.assertEqual(self.request('GET','/api/v1/me?member_tier=paid').status_code,422)
    def test_management_denial_precedes_json_parsing(self):
        response=self.client.post('/api/v1/offerings/SYNTHETIC-O/forecast-drafts',content='{',headers={'Authorization':'Bearer SYNTHETIC-student','Idempotency-Key':'SYNTHETIC-key'})
        self.assertEqual(response.status_code,403);self.assertEqual(response.json()['error']['code'],'forecast_forbidden')
    def test_http_create_validate_approve_publish_and_query(self):
        record=self.create()
        for action,extra in [('validations',{}),('approvals',{'reason':'합성 승인'}),('publications',{})]:
            body=dict(expected_revision=record['revision'],base_result_hash=record['base_result_hash'],policy_version=record['policy_version'],**extra)
            if action=='approvals':body['validation_receipt_hash']=record['validation']['receipt_hash']
            if action=='publications':body['approval_receipt_hash']=record['approval']['approval_hash']
            response=self.request('POST',f"/api/v1/forecast-drafts/{record['draft_id']}/{action}",body)
            self.assertEqual(response.status_code,200,response.text);record=response.json()
        self.assertEqual(record['status'],'published');self.assertEqual(len(self.store.releases),1)
        response=self.request('GET','/api/v1/forecast-drafts');self.assertEqual(len(response.json()['items']),1)
    def test_wrong_scope_hidden_and_client_role_rejected(self):
        record=self.create();self.store.authorities['SYNTHETIC-other']=dict(edit=True,approve=True,university_ids=['OTHER'])
        self.assertEqual(self.request('GET',f"/api/v1/forecast-drafts/{record['draft_id']}",owner='SYNTHETIC-other').status_code,404)
        response=self.request('POST','/api/v1/offerings/SYNTHETIC-O/forecast-drafts',dict(input_id='SYNTHETIC-input-id',input_version='SYNTHETIC-input',policy_id='SYNTHETIC-policy-id',policy_version='SYNTHETIC-policy',role='approver'))
        self.assertEqual(response.status_code,422)

    def test_publication_requires_paid_and_public_fields_exclude_audit(self):
        from datetime import timedelta
        record=self.create()
        for action in ('validations','approvals','publications'):
            body=dict(expected_revision=record['revision'],base_result_hash=record['base_result_hash'],policy_version=record['policy_version'])
            if action=='approvals':body.update(validation_receipt_hash=record['validation']['receipt_hash'],reason='검토 완료')
            if action=='publications':body.update(approval_receipt_hash=record['approval']['approval_hash'])
            response=self.request('POST',f"/api/v1/forecast-drafts/{record['draft_id']}/{action}",body);self.assertEqual(response.status_code,200,response.text);record=response.json()
        path='/api/v1/offerings/SYNTHETIC-O/forecast'
        self.assertEqual(self.request('GET',path).status_code,403)
        self.repository.entitlements['SYNTHETIC-editor']=dict(active=True,starts_at=self.clock.now()-timedelta(seconds=1),expires_at=self.clock.now()+timedelta(seconds=60))
        response=self.request('GET',path);self.assertEqual(response.status_code,200,response.text)
        result=response.json();self.assertEqual(result['format'],'jungsi.forecast-public/v1')
        self.assertNotIn('published_by',result);self.assertNotIn('input_hash',result)
        self.assertEqual(set(result['recommendation_reasons'][0]),{'code','text','evidence_refs'})
        self.assertFalse(result['issue_summaries'][0]['numeric_effect_applied'])
        self.assertEqual(self.request('GET','/api/v1/me').json()['member_tier'],'paid')
