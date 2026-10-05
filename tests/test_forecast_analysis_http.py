"""One API path for release pinning, historical evidence and student DTOs."""
from copy import deepcopy
from dataclasses import replace
from datetime import timedelta
import json
import unittest
from fastapi.testclient import TestClient
from backend_synthetic_fixture import FrozenClock, SyntheticSessions
from test_session_read import Entitlements
from test_university_percentile_service import SyntheticPercentileData
from forecast_synthetic_fixture import Inputs, fixture
from jungsi_touch.infrastructure.http_api import create_app
from jungsi_touch.infrastructure.memory_forecast_repository import MemoryForecastRepository
from jungsi_touch.application.university_scoring import UniversityScoringService
from jungsi_touch.application.university_percentile import UniversityPercentileService
from jungsi_touch.application.platform import PlatformService
from jungsi_touch.forecasting import digest


class ForecastAnalysisHttpTests(unittest.TestCase):
    def setUp(self):
        self.clock=FrozenClock();self.data=SyntheticPercentileData(self.clock);self.repo=Entitlements()
        self.repo.entitlements['SYNTHETIC-editor']=dict(active=True,starts_at=self.clock.now()-timedelta(days=1),expires_at=self.clock.now()+timedelta(days=1))
        self.store=MemoryForecastRepository({'SYNTHETIC-editor':dict(edit=True,approve=True,university_ids=['SYNTHETIC-A'])})
        offering=self.data.offering;self.oid=offering['offering_id']
        conversion=UniversityScoringService(self.data).calculate(offering,self.data.profile())
        percentile=UniversityPercentileService(self.data).calculate(offering,conversion)
        context=dict(conversion.context);context.update(dict(percentile.context))
        context.update(offering_id=self.oid,offering_lineage_id='SYNTHETIC-lineage',catalog_version=self.data.catalog.version,analysis_version='SYNTHETIC-analysis.v1',input_version='SYNTHETIC-input',policy_version='SYNTHETIC-policy',comparison_metric='converted_score',direction='higher_is_better',unit='점',tie_policy=None)
        bundle=self.data.bundles[self.oid];decision=bundle.decisions[2027]
        decision['context'].update(dict(percentile.context));decision['evidence']['context']=deepcopy(decision['context'])
        self.data.bundles[self.oid]=replace(bundle,source_pack_version=self.data.pack.pack_version,release=self.data.conversion.release)
        self.data.get_analysis=lambda oid:self.data.bundles.get(oid)
        self.inputs=Inputs(False);self.inputs.data,self.inputs.rules=fixture(False)
        self.inputs.data['context']=deepcopy(context);self.inputs.rules['context']=deepcopy(context)
        self.inputs.rules['eligibility_policy']=dict(status='approved',version='SYNTHETIC-eligibility',requirements=[])
        for history in ('history_70','acceptance_history'):
            for row in self.inputs.data[history]:row.update(population_id=context['population_id'],comparison_value='30')
        self.inputs.inputs=lambda oid,input_id,version:deepcopy(self.inputs.data)
        self.app=create_app(repository=self.repo,data=self.data,sessions=SyntheticSessions(self.clock),clock=self.clock,forecast_repository=self.store,forecast_inputs=self.inputs)
        self.client=TestClient(self.app);self.key=0

    def request(self,method,path,body=None):
        self.key+=1
        return self.client.request(method,path,json=body,headers={'Authorization':'Bearer SYNTHETIC-editor','Idempotency-Key':'SYNTHETIC-e2e-'+str(self.key)})

    def report(self):
        p=self.request('POST','/api/v1/score-profiles',dict(scores=self.data.profile()['scores'],confirmed=True));self.assertEqual(p.status_code,201,p.text)
        r=self.request('POST','/api/v1/overall-reports',dict(profile_id=p.json()['profile_id']));self.assertEqual(r.status_code,201,r.text)
        return self.analyze(r.json())

    def analyze(self,record):
        r=self.request('POST',f"/api/v1/reports/{record['report_id']}/university-results",dict(expected_version=record['report_version'],offering_ids=[self.oid]))
        self.assertEqual(r.status_code,200,r.text);return r.json()

    def publish(self):
        r=self.request('POST',f'/api/v1/offerings/{self.oid}/forecast-drafts',dict(input_id='SYNTHETIC-input-id',input_version='SYNTHETIC-input',policy_id='SYNTHETIC-policy-id',policy_version='SYNTHETIC-policy'))
        self.assertEqual(r.status_code,200,r.text);record=r.json()
        for action in ('validations','approvals','publications'):
            body=dict(expected_revision=record['revision'],base_result_hash=record['base_result_hash'],policy_version=record['policy_version'])
            if action=='approvals':body.update(validation_receipt_hash=record['validation']['receipt_hash'],reason='합성 검토')
            if action=='publications':body.update(approval_receipt_hash=record['approval']['approval_hash'])
            r=self.request('POST',f"/api/v1/forecast-drafts/{record['draft_id']}/{action}",body);self.assertEqual(r.status_code,200,r.text);record=r.json()
        return record

    def test_publishing_keeps_official_history_and_matches_public_identity(self):
        before=self.report();history=before['analyses'][self.oid]['decision_evidence']['historical_metrics']
        self.assertTrue(history);self.publish();after=self.analyze(before);a=after['analyses'][self.oid]
        self.assertEqual(a['status'],'ready',a);self.assertEqual(a['decision_evidence']['historical_metrics'],history)
        public=self.request('GET',f'/api/v1/offerings/{self.oid}/forecast').json();e=a['decision_evidence']
        self.assertEqual(e['forecast_release_version'],public['release_version'])
        for key in ('context','policy_version','input_version'):self.assertEqual(e[key],public[key])
        encoded=json.dumps({'assessment':a,'public':public})
        for private in ('exact_values','comparison_basis','input_hash','policy_hash','published_by','contributors','SYNTHETIC-editor'):self.assertNotIn(private,encoded)

    def test_context_or_pinned_input_drift_blocks_both_paths_and_keeps_scores(self):
        for kind in ('context','input','policy'):
            with self.subTest(kind=kind):
                self.setUp();self.publish();report=self.report()
                if kind=='context':self.inputs.current_context=lambda oid:dict(self.inputs.data['context'],source_pack_version='NEW')
                elif kind=='input':self.inputs.data['approved_evidence_refs'].append('NEW')
                else:self.inputs.rules['require_independent_approver']=True
                public=self.request('GET',f'/api/v1/offerings/{self.oid}/forecast');self.assertEqual(public.status_code,409,public.text)
                after=self.analyze(report)['analyses'][self.oid]
                self.assertEqual(after['status'],'pending');self.assertEqual(after['reason_code'],'forecast_base_version_conflict')
                self.assertEqual(after['conversion']['status'],'ready');self.assertEqual(after['percentile']['status'],'ready')

    def test_subset_population_does_not_inherit_a_whole_population_advantage(self):
        # Even a stored legacy claim cannot cross the explicit population scope.
        import jungsi_touch.application.platform as module
        from unittest.mock import patch
        self.publish()
        original=module.evaluate_offering
        def legacy(*args,**kwargs):
            result=original(*args,**kwargs);result['advantage']=dict(status='favorable',delta_pp='1');return result
        calculate=UniversityPercentileService.calculate
        def scoped(service,*args):return replace(calculate(service,*args),population_scope='required_rule_inputs_present')
        with patch.object(UniversityPercentileService,'calculate',scoped),patch.object(module,'evaluate_offering',legacy):
            result=self.report()['analyses'][self.oid]
        self.assertEqual(result['status'],'ready',result);self.assertIsNone(result['advantage'])
        self.assertFalse(any(r['code'].startswith('converted_score_position_') for r in result['recommendation_reasons']))

    def test_missing_public_context_is_pending_without_invented_defaults(self):
        self.inputs.data['context'].pop('source_pack_version');self.inputs.rules['context']=deepcopy(self.inputs.data['context'])
        self.publish();response=self.request('GET',f'/api/v1/offerings/{self.oid}/forecast')
        self.assertEqual(response.status_code,200,response.text);public=response.json()
        self.assertEqual(public['status'],'pending');self.assertEqual(public['reason_code'],'forecast_public_context_missing');self.assertIsNone(public['context'])
        assessment=self.report()['analyses'][self.oid]
        self.assertEqual(assessment['status'],'pending');self.assertEqual(assessment['reason_code'],'forecast_public_context_missing')
        self.assertEqual(assessment['conversion']['status'],'ready');self.assertEqual(assessment['percentile']['status'],'ready')


class CandidateClassificationTests(unittest.TestCase):
    def test_one_school_keeps_ready_outside_ineligible_and_pending_separate(self):
        rows=[dict(offering_id='SYNTHETIC-'+str(i),university_id='SYNTHETIC-U',university_name='가상대',practical_required=False) for i in range(5)]
        states=[('ready','core',None),('ready','room',None),('ready','outside',None),('ineligible','ineligible','eligibility_not_met'),('pending','pending','acceptance_evidence_missing')]
        analyses={row['offering_id']:dict(status=status,category=category,reason_code=reason) for row,(status,category,reason) in zip(rows,states)}
        result=PlatformService.candidates(rows,analyses,'SYNTHETIC-catalog')
        self.assertEqual([i['offering']['offering_id'] for i in result['basic_university_groups'][0]['offerings']],['SYNTHETIC-0','SYNTHETIC-1'])
        self.assertEqual([i['offering_id'] for i in result['outside_offerings']],['SYNTHETIC-2'])
        self.assertEqual([i['offering_id'] for i in result['ineligible_offerings']],['SYNTHETIC-3'])
        self.assertEqual([i['offering_id'] for i in result['pending_offerings']],['SYNTHETIC-4'])

    def test_zero_recommendations_is_ready_when_every_decision_is_resolved(self):
        rows=[dict(offering_id='SYNTHETIC-outside',university_id='SYNTHETIC-U'),dict(offering_id='SYNTHETIC-ineligible',university_id='SYNTHETIC-U')]
        analyses=dict(zip((r['offering_id'] for r in rows),[dict(status='ready',category='outside',reason_code=None),dict(status='ineligible',category='ineligible',reason_code='eligibility_not_met')]))
        result=PlatformService.candidates(rows,analyses,'SYNTHETIC-catalog')
        self.assertEqual(result['status'],'ready');self.assertIsNone(result['reason_code']);self.assertEqual(result['basic_university_groups'],[]);self.assertEqual(result['pending_offerings'],[])
        analyses['SYNTHETIC-outside']=dict(status='pending',category='pending',reason_code='acceptance_evidence_missing')
        result=PlatformService.candidates(rows,analyses,'SYNTHETIC-catalog');self.assertEqual(result['status'],'pending');self.assertEqual(result['reason_code'],'approved_candidates_missing')
