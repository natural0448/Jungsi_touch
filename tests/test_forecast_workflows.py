import unittest
from jungsi_touch.application.forecast_policy import ForecastPolicyService
from jungsi_touch.application.authorization import Actor
from jungsi_touch.application.platform_ports import PlatformError
from jungsi_touch.infrastructure.memory_forecast_repository import MemoryForecastRepository
from backend_synthetic_fixture import FrozenClock
from forecast_synthetic_fixture import Inputs,CONTEXT

class ForecastWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.editor=Actor('SYNTHETIC-editor',True);self.approver=Actor('SYNTHETIC-approver',True)
        self.repo=MemoryForecastRepository({self.editor.subject_id:dict(edit=True,approve=True,university_ids=['SYNTHETIC-U']),self.approver.subject_id:dict(edit=False,approve=True,university_ids=['SYNTHETIC-U'])})
        self.inputs=Inputs();self.service=ForecastPolicyService(self.repo,self.inputs,FrozenClock());self.key=0
    def call(self,operation,record=None,actor=None,extra=None,key=None):
        self.key+=1
        body=dict(expected_revision=record['revision'],base_result_hash=record['base_result_hash'],policy_version=record['policy_version']) if record else dict(input_id='SYNTHETIC-input-id',input_version='SYNTHETIC-input',policy_id='SYNTHETIC-policy-id',policy_version='SYNTHETIC-policy')
        body.update(extra or {})
        return self.service.execute(operation,actor or self.editor,body=body,params={'draft_id':record['draft_id']} if record else {'offering_id':CONTEXT['offering_id']},key=key or 'SYNTHETIC-'+str(self.key))
    def create(self):return self.call('forecast.create')
    def validate(self,r):return self.call('forecast.validate',r)
    def approve(self,r,actor=None):return self.call('forecast.approve',r,actor or self.approver,dict(validation_receipt_hash=r['validation']['receipt_hash'],reason='검토 완료'))
    def test_full_lifecycle_is_immutable_and_separate(self):
        a=self.create();b=self.validate(a);c=self.approve(b);d=self.call('forecast.publish',c,self.approver,dict(approval_receipt_hash=c['approval']['approval_hash']))
        self.assertEqual(d['status'],'published');self.assertEqual(self.repo.revisions[(a['draft_id'],1)]['status'],'draft')
        public=self.service.execute('forecast.published.read',self.editor,params={'offering_id':CONTEXT['offering_id']})
        self.assertEqual(public['forecast_70']['value'],'56');self.assertNotIn('published_by',public)
    def test_independent_approval_is_explicit_policy(self):
        r=self.validate(self.create())
        with self.assertRaises(PlatformError) as e:self.approve(r,self.editor)
        self.assertEqual(e.exception.code,'forecast_independent_approver_required')
        self.inputs.rules['require_independent_approver']=False;r=self.validate(self.create())
        self.assertEqual(self.approve(r,self.editor)['status'],'approved')
    def test_adjustment_is_single_replacement_and_invalidates_validation(self):
        a=self.validate(self.create());body=dict(policy_version=a['policy_version'],target='forecast_70',replacement=dict(value='57',unit='점'),reason='근거 있는 조정',evidence_refs=['SYNTHETIC-manual'])
        b=self.call('forecast.adjust',a,extra=body,key='SYNTHETIC-adjust')
        replay=self.call('forecast.adjust',a,extra=body,key='SYNTHETIC-adjust')
        self.assertEqual(b,replay);self.assertEqual(b['base_result']['forecast_70']['value'],'56');self.assertEqual(b['result']['forecast_70']['value'],'57');self.assertIsNone(b['validation'])
    def test_stale_revision_and_changed_policy_are_rejected(self):
        a=self.create();self.validate(a)
        with self.assertRaises(PlatformError):self.validate(a)
        b=self.create();self.inputs.rules['forecast_70']['minimum_years']=2
        with self.assertRaises(PlatformError) as e:self.validate(b)
        self.assertEqual(e.exception.code,'forecast_base_version_conflict')
    def test_paid_membership_does_not_give_management_authority(self):
        with self.assertRaises(PlatformError) as e:self.call('forecast.create',actor=Actor('SYNTHETIC-student',True))
        self.assertEqual(e.exception.http_status,403)
    def test_wrong_scope_and_missing_approval_do_not_publish(self):
        a=self.create()
        with self.assertRaises(PlatformError):self.call('forecast.publish',a,self.approver,dict(approval_receipt_hash='missing'))
        self.repo.authorities[self.editor.subject_id]['university_ids']=[]
        with self.assertRaises(PlatformError) as e:self.validate(a)
        self.assertEqual(e.exception.http_status,404)

    def test_concurrent_revision_writers_have_one_winner(self):
        from concurrent.futures import ThreadPoolExecutor
        record=self.create()
        def write(index):
            try:return self.service.execute('forecast.validate',self.editor,body=dict(expected_revision=record['revision'],base_result_hash=record['base_result_hash'],policy_version=record['policy_version']),params=dict(draft_id=record['draft_id']),key='SYNTHETIC-concurrent-'+str(index))['status']
            except PlatformError as error:return error.code
        with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(write,range(2)))
        self.assertCountEqual(results,['validated','revision_conflict'])
    def test_per_school_role_does_not_expand_from_other_school(self):
        record=self.validate(self.create())
        self.repo.authorities[self.approver.subject_id]=dict(edit=True,approve=True,university_ids=['SYNTHETIC-U','OTHER'],edit_university_ids=['SYNTHETIC-U'],approve_university_ids=['OTHER'])
        with self.assertRaises(PlatformError) as error:self.approve(record)
        self.assertEqual(error.exception.http_status,404)
    def test_validation_failure_receipt_is_preserved_and_cannot_approve(self):
        record=self.create();body=dict(policy_version=record['policy_version'],target='acceptance_range',replacement=dict(lower='53',upper='58',unit='점'),reason='조정 검토',evidence_refs=['SYNTHETIC-manual'])
        record=self.call('forecast.adjust',record,extra=body);record=self.validate(record)
        self.assertEqual(record['validation']['status'],'failed');self.assertEqual(record['validation']['reason_code'],'forecast_core_range_mismatch')
        with self.assertRaises(PlatformError):self.approve(record)
    def test_receipt_hash_and_policy_request_cannot_be_forged(self):
        record=self.validate(self.create())
        with self.assertRaises(PlatformError):self.call('forecast.approve',record,self.approver,dict(validation_receipt_hash='WRONG',reason='검토'))
        with self.assertRaises(PlatformError):self.call('forecast.validate',record,extra=dict(policy_version='WRONG'))

    def published(self):
        r=self.approve(self.validate(self.create()))
        return self.call('forecast.publish',r,self.approver,dict(approval_receipt_hash=r['approval']['approval_hash']))

    def test_management_projection_does_not_copy_private_persistence_fields(self):
        record=self.create();stored=self.repo.get(record['draft_id'])
        stored['secret']='SYNTHETIC-private';stored['context']['secret']='SYNTHETIC-private';stored['result']['secret']='SYNTHETIC-private';stored['validation']=dict(status='failed',receipt_hash='a'*64,secret='SYNTHETIC-private')
        self.repo.drafts[record['draft_id']]=stored
        dto=self.service.execute('forecast.read',self.editor,params=dict(draft_id=record['draft_id']))
        import json
        self.assertNotIn('SYNTHETIC-private',json.dumps(dto));self.assertNotIn('exact_values',json.dumps(dto));self.assertNotIn('input_hash',dto);self.assertNotIn('policy_hash',dto)
        self.assertEqual(set(dto['audit_events'][0]),{'action','actor','at'})
        self.assertEqual(dto['result'],record['result']);self.assertEqual(dto['base_result'],record['base_result'])

    def test_published_release_requires_entire_current_context_and_pinned_artifacts(self):
        self.published()
        for mutate in (lambda:setattr(self.inputs,'current_context',lambda oid:dict(self.inputs.data['context'],catalog_version='NEW')),lambda:self.inputs.data.update(status='pending'),lambda:self.inputs.rules.update(status='pending')):
            previous_context=self.inputs.current_context;previous_data=__import__('copy').deepcopy(self.inputs.data);previous_policy=__import__('copy').deepcopy(self.inputs.rules)
            mutate()
            with self.assertRaises(PlatformError) as e:self.service.validated_release(CONTEXT['offering_id'])
            self.assertEqual(e.exception.code,'forecast_base_version_conflict')
            self.inputs.current_context=previous_context;self.inputs.data=previous_data;self.inputs.rules=previous_policy

    def test_adjustment_retains_exact_replacement_and_formats_display_once(self):
        record=self.create();body=dict(target='forecast_70',replacement=dict(value='56.004',unit='점'),reason='합성 검토',evidence_refs=['SYNTHETIC-manual'])
        updated=self.call('forecast.adjust',record,extra=body)
        self.assertEqual(updated['result']['forecast_70']['value'],'56')
        self.assertEqual(self.repo.get(record['draft_id'])['result']['exact_values']['forecast_70'],'14001/250')
        self.assertEqual(self.validate(updated)['validation']['status'],'passed')

    def test_current_input_and_policy_versions_are_explicit_context_requirements(self):
        for key in ('input_version','policy_version'):
            with self.subTest(key=key):
                previous=__import__('copy').deepcopy(self.inputs.data['context'])
                self.inputs.data['context'].pop(key);self.inputs.rules['context']=__import__('copy').deepcopy(self.inputs.data['context'])
                with self.assertRaises(PlatformError) as error:self.create()
                self.assertEqual(error.exception.code,'forecast_base_version_conflict')
                self.inputs.data['context']=previous;self.inputs.rules['context']=__import__('copy').deepcopy(previous)
