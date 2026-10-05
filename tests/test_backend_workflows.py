"""Synthetic HTTP integration and real-engine success/error workflows."""
from copy import deepcopy
from dataclasses import replace
from datetime import timedelta
import json
from pathlib import Path
import sys
import unittest
from concurrent.futures import ThreadPoolExecutor

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'src'))
from backend_synthetic_fixture import FrozenClock,SyntheticRepository,SyntheticSessions,SyntheticData,score_input
from jungsi_touch.infrastructure.http_api import create_app
from jungsi_touch.infrastructure.settings import ServerSettings
from jungsi_touch.infrastructure.drive_provider import MissingDataProvider
from jungsi_touch.application.authorization import Actor
from jungsi_touch.application.platform_ports import PlatformError
from jungsi_touch.application.platform import PlatformService
from jungsi_touch.application.publication import ReportPublicationService
from starlette.testclient import TestClient


class BackendWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.clock=FrozenClock();self.repo=SyntheticRepository();self.data=SyntheticData(self.clock)
        self.owner='SYNTHETIC-owner';self.other='SYNTHETIC-other';self.standard='SYNTHETIC-standard'
        for owner in (self.owner,self.other):self.repo.entitlements[owner]=dict(active=True,starts_at=self.clock.now()-timedelta(days=1),expires_at=self.clock.now()+timedelta(days=1))
        self.app=create_app(settings=ServerSettings(),repository=self.repo,data=self.data,sessions=SyntheticSessions(self.clock),clock=self.clock)
        self.client=TestClient(self.app);self.keys=0
    def request(self,method,path,body=None,owner=None,key=None):
        self.keys+=1
        headers={'Authorization':'Bearer '+(owner or self.owner),'Idempotency-Key':key or 'SYNTHETIC-request-'+str(self.keys)}
        return self.client.request(method,path,json=body,headers=headers)
    def report(self,owner=None,scores=None,confirmed=True):
        profile=self.request('POST','/api/v1/score-profiles',dict(scores=scores or score_input(),confirmed=confirmed),owner)
        self.assertEqual(profile.status_code,201,profile.text)
        report=self.request('POST','/api/v1/overall-reports',dict(profile_id=profile.json()['profile_id']),owner)
        self.assertEqual(report.status_code,201,report.text)
        return report.json()
    def candidates(self,record,owner=None):
        result=self.request('POST',f"/api/v1/reports/{record['report_id']}/candidates",dict(expected_version=record['report_version']),owner)
        self.assertEqual(result.status_code,200,result.text);return result.json()
    def select(self,record,selected=True,owner=None,key=None):
        result=self.request('PUT',f"/api/v1/reports/{record['report_id']}/shortlist/SYNTHETIC-A-2027",dict(selected=selected,expected_version=record['report_version']),owner,key)
        self.assertEqual(result.status_code,200,result.text);return result.json()
    def statistics(self,record,owner=None):
        return self.request('GET',f"/api/v1/reports/{record['report_id']}/offerings/SYNTHETIC-A-2027/live-statistics",owner=owner)

    def test_decision_evidence_preserves_metrics_and_separates_forecast_from_range(self):
        record=self.candidates(self.report());evidence=record['analyses']['SYNTHETIC-A-2027']['decision_evidence']
        self.assertEqual(evidence['historical_metrics'][0]['metric_name'],'가상 발표 평균')
        self.assertEqual(evidence['forecast_70']['value'],'26')
        self.assertEqual(evidence['expected_acceptance_range']['lower'],'25')
        self.assertNotIn('verification_status',evidence['historical_metrics'][0])
        self.data.bundles['SYNTHETIC-A-2027'].decisions[2027]['evidence']['context']['offering_id']='SYNTHETIC-other'
        updated=self.candidates(record)
        self.assertEqual(updated['analyses']['SYNTHETIC-A-2027']['reason_code'],'decision_evidence_unapproved')

    def test_unpublished_forecast_is_null_without_changing_approved_range(self):
        self.data.bundles['SYNTHETIC-A-2027'].decisions[2027]['evidence']['forecast_70']=None
        result=self.candidates(self.report())['analyses']['SYNTHETIC-A-2027']
        self.assertEqual(result['status'],'ready')
        self.assertIsNone(result['decision_evidence']['forecast_70']['value'])
        self.assertEqual(result['decision_evidence']['forecast_70']['status'],'pending')

    def test_analysis_provider_hash_failure_is_per_offering_pending(self):
        def fail(oid):raise PlatformError('drive_hash_mismatch',503)
        self.data.get_analysis=fail
        record=self.candidates(self.report())
        self.assertEqual(record['analysis_status']['status'],'pending')
        self.assertTrue(all(row['reason_code']=='drive_hash_mismatch' for row in record['analyses'].values()))

    def test_private_publication_retries_same_immutable_snapshot_and_checks_access(self):
        record=self.candidates(self.report());calls=[]
        class Writer:
            def append_result(self,*args):calls.append(args);return dict(status='written')
        service=ReportPublicationService(self.app.state.platform,Writer());actor=Actor(self.owner,True)
        service.publish(actor,record['report_id'],'SYNTHETIC-write')
        self.clock.value+=timedelta(seconds=7)
        service.publish(actor,record['report_id'],'SYNTHETIC-write')
        self.assertEqual(calls[0][3],calls[1][3])
        self.assertEqual(calls[0][3]['generated_at'],record['updated_at'])
        for rejected in (Actor(self.other,True),Actor(self.standard,False)):
            with self.assertRaises(PlatformError) as caught:service.publish(rejected,record['report_id'],'SYNTHETIC-write')
            self.assertEqual(caught.exception.http_status,404 if rejected.subject_id==self.other else 403)
        self.assertEqual(len(calls),2)
        with self.assertRaises(PlatformError):ReportPublicationService(self.app.state.platform,None).publish(actor,record['report_id'],'SYNTHETIC-write')

    def test_all_contract_routes_authenticate_before_parsing_or_lookup(self):
        catalog=json.loads((ROOT/'src/jungsi_touch/application/route_catalog.json').read_text(encoding='utf-8'))
        spec=json.loads((ROOT/'docs/current/service_spec.json').read_text(encoding='utf-8'))
        self.assertEqual(len(catalog['operations']),len(spec['operations']))
        self.assertEqual({o['id'] for o in catalog['operations']},{o['id'] for o in spec['operations']})
        for operation in catalog['operations']:
            with self.subTest(operation=operation['id']):
                path=operation['path'].replace('{report_id}','SYNTHETIC-missing').replace('{offering_id}','SYNTHETIC-A-2027').replace('{draft_id}','SYNTHETIC-missing')
                result=self.client.request(operation['method'],path,content=b'{bad json')
                self.assertEqual(result.status_code,401,result.text)
                self.assertEqual(result.json()['error']['code'],'authentication_required')
        self.assertEqual(self.repo.access_calls,[]);self.assertEqual(self.data.calls,[])

    def test_paid_and_ownership_guards_precede_http_json_parsing(self):
        record=self.report();path=f"/api/v1/reports/{record['report_id']}/candidates"
        for owner,status in ((self.standard,403),(self.other,404)):
            response=self.client.post(path,content=b'{bad json',headers={'Authorization':'Bearer '+owner})
            self.assertEqual(response.status_code,status,response.text)

    def test_normal_full_pipeline_uses_actual_existing_engines(self):
        record=self.candidates(self.report())
        assessment=record['analyses']['SYNTHETIC-A-2027']
        self.assertEqual(assessment['status'],'ready',assessment)
        self.assertEqual(assessment['converted_score'],'30.00')
        self.assertEqual(assessment['category'],'core')
        self.assertEqual(assessment['advantage']['delta_pp'],'22.222222')
        self.assertEqual([y['academic_year'] for y in assessment['years']],[2024,2025,2026,2027])
        self.assertTrue(all(y['status']=='ready' for y in assessment['years']))
        self.assertTrue(record['candidates']['basic_university_groups']);self.assertTrue(record['candidates']['wildcards'])
        record=self.select(record)
        stat=self.statistics(record).json()
        self.assertEqual(stat['recommended_count'],1);self.assertEqual(stat['selected_count'],1)
        self.assertEqual(stat['selected_rank'],dict(rank=1,tie_count=1,population_count=1,tie_policy='competition'))
        export=self.request('GET',f"/api/v1/reports/{record['report_id']}/print")
        self.assertEqual(export.status_code,200)
        self.assertEqual(export.json()['snapshot_version'],record['report_version'])
        self.assertEqual(export.json()['report']['shortlist'],record['shortlist'])

    def test_official_history_preserves_metric_and_does_not_invent_rank(self):
        result=self.request('GET','/api/v1/admission-history?academic_year=2024',owner=self.standard)
        self.assertEqual(result.status_code,200,result.text)
        row=result.json()['items'][0]
        self.assertEqual(row['value'],'20');self.assertEqual(row['metric_name'],'가상 발표 평균')
        self.assertNotIn('converted_percentile',row);self.assertNotIn('category',row)

    def test_recruitment_preserves_zero_unknown_and_calendar_date(self):
        result=self.request('GET','/api/v1/offerings/SYNTHETIC-A-2027/recruitment',owner=self.standard).json()['recruitment']
        self.assertEqual(result['initial_count'],0);self.assertIsNone(result['final_count'])
        self.assertEqual(result['count_status'],'not_published');self.assertEqual(result['deadline'],'2027-01-01')

    def test_paid_search_without_score_and_practical_rows_excluded(self):
        result=self.request('GET','/api/v1/offerings/search?academic_year=2027').json()
        self.assertEqual(result['matching_offering_count'],2)
        self.assertEqual(result['matching_school_count'],2)
        self.assertEqual([r['offering_id'] for r in result['items']],['SYNTHETIC-A-2027','SYNTHETIC-B-2027'])
        self.assertEqual(self.repo.profiles,{})
        self.assertEqual(self.request('GET','/api/v1/offerings/SYNTHETIC-B-2027').status_code,200)
        self.assertEqual(self.request('GET','/api/v1/offerings/SYNTHETIC-C-2027').status_code,404)

    def test_search_filters_same_offering_and_cursor_binding(self):
        result=self.request('GET','/api/v1/offerings/search?university_q=가상A&department_q=가상분석').json()
        self.assertEqual(result['matching_offering_count'],0)
        first=self.request('GET','/api/v1/offerings/search?limit=1').json()
        self.assertIsNotNone(first['next_cursor'])
        second=self.request('GET','/api/v1/offerings/search?limit=1&cursor='+first['next_cursor'])
        self.assertEqual(second.status_code,200,second.text)
        self.data.catalog=replace(self.data.catalog,version='SYNTHETIC-catalog.v2')
        self.assertEqual(self.request('GET','/api/v1/offerings/search?limit=1&cursor='+first['next_cursor']).status_code,409)

    def test_standard_paid_endpoint_denial_contains_no_results_counts_details(self):
        for path in ('/api/v1/offerings/search','/api/v1/offerings/SYNTHETIC-A-2027'):
            response=self.request('GET',path,owner=self.standard)
            self.assertEqual(response.status_code,403,response.text)
            self.assertEqual(set(response.json()),{'status','error','request_id'})

    def test_body_identity_paid_and_source_flags_are_not_accepted(self):
        for flag in ('owner','member_type','paid_active','source_path','research'):
            with self.subTest(flag=flag):
                body=dict(scores=score_input(),confirmed=True);body[flag]=self.owner
                response=self.request('POST','/api/v1/score-profiles',body,owner=self.standard)
                self.assertEqual(response.status_code,422)
        response=self.client.get('/api/v1/offerings/search',headers={'Authorization':'Bearer '+self.standard,'X-Member-Type':'paid','X-Owner':self.owner})
        self.assertEqual(response.status_code,403)

    def test_other_owner_and_missing_report_use_same_not_found(self):
        r=self.report()
        other=self.request('GET',f"/api/v1/reports/{r['report_id']}",owner=self.other)
        missing=self.request('GET','/api/v1/reports/SYNTHETIC-missing',owner=self.other)
        self.assertEqual(other.status_code,404);self.assertEqual(missing.status_code,404)
        self.assertEqual(other.json()['error'],missing.json()['error'])
        profile_id=r['profile_id']
        self.assertEqual(self.request('POST','/api/v1/overall-reports',dict(profile_id=profile_id),owner=self.other).status_code,404)

    def test_standard_report_excludes_paid_sections_after_entitlement_expiry(self):
        r=self.select(self.candidates(self.report()))
        self.repo.entitlements[self.owner]['expires_at']=self.clock.now()
        response=self.request('GET',f"/api/v1/reports/{r['report_id']}").json()
        self.assertNotIn('analyses',response);self.assertNotIn('shortlist',response);self.assertNotIn('candidates',response)
        self.assertEqual(self.statistics(r).status_code,403)

    def test_expired_session_rejected_at_exact_utc_boundary(self):
        self.assertEqual(self.request('GET','/api/v1/admission-history',owner='SYNTHETIC-expired').status_code,401)

    def test_unconfirmed_profile_blocks_personal_analysis_and_export(self):
        r=self.report(confirmed=False)
        for method,path,body in [('POST',f"/api/v1/reports/{r['report_id']}/candidates",dict(expected_version=1)),('GET',f"/api/v1/reports/{r['report_id']}/print",None)]:
            result=self.request(method,path,body)
            self.assertEqual(result.status_code,409);self.assertEqual(result.json()['error']['code'],'score_confirmation_required')

    def test_profile_and_overall_idempotency_and_conflicting_request(self):
        body=dict(scores=score_input(),confirmed=True)
        first=self.request('POST','/api/v1/score-profiles',body,key='SYNTHETIC-same').json()
        again=self.request('POST','/api/v1/score-profiles',body,key='SYNTHETIC-same').json()
        self.assertEqual(first,again);self.assertEqual(len(self.repo.profiles),1)
        body['confirmed']=False
        self.assertEqual(self.request('POST','/api/v1/score-profiles',body,key='SYNTHETIC-same').status_code,409)
        create=dict(profile_id=first['profile_id'])
        a=self.request('POST','/api/v1/overall-reports',create,key='SYNTHETIC-overall-same').json()
        b=self.request('POST','/api/v1/overall-reports',create,key='SYNTHETIC-overall-same').json()
        self.assertEqual(a,b);self.assertEqual(len(self.repo.reports),1)

    def test_shortlist_retry_and_same_state_do_not_duplicate_counts(self):
        r=self.candidates(self.report());old_version=r['report_version'];key='SYNTHETIC-selection'
        selected=self.select(r,key=key)
        again=self.select(r,key=key)
        self.assertEqual(selected,again)
        unchanged=self.select(selected)
        self.assertEqual(unchanged['report_version'],selected['report_version'])
        self.assertEqual(self.statistics(selected).json()['selected_count'],1)
        unselected=self.select(selected,False)
        self.assertEqual(self.statistics(unselected).json()['selected_count'],0)
        self.assertTrue(self.repo.revisions[(r['report_id'],old_version+1)]['body']['shortlist']['SYNTHETIC-A-2027']['selected'])

    def test_stale_revision_and_concurrent_writers_have_one_winner(self):
        r=self.report();service=PlatformService(self.repo,self.data,self.clock)
        def write(n):
            try:return service.execute('shortlist.update',Actor(self.owner,True),body=dict(selected=True,expected_version=1),params=dict(report_id=r['report_id'],offering_id='SYNTHETIC-A-2027'),key='SYNTHETIC-race-'+str(n))
            except PlatformError as e:return e.code
        with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(write,(1,2)))
        self.assertEqual(sum(isinstance(v,dict) for v in results),1)
        self.assertIn('revision_conflict',results)

    def test_noop_replay_survives_later_report_change(self):
        selected=self.select(self.candidates(self.report()))
        noop=self.select(selected,key='SYNTHETIC-noop')
        self.select(selected,False)
        replay=self.select(selected,key='SYNTHETIC-noop')
        self.assertEqual(replay,noop)
        self.assertFalse(self.repo.reports[selected['report_id']]['body']['shortlist']['SYNTHETIC-A-2027']['selected'])

    def test_candidates_use_current_target_year_with_four_year_evidence(self):
        r=self.candidates(self.report())
        ids={item['offering']['offering_id'] for group in r['candidates']['basic_university_groups'] for item in group['offerings']}
        self.assertEqual(ids,{'SYNTHETIC-A-2027','SYNTHETIC-B-2027'})
        self.assertTrue(all(len(row['years'])==4 for row in r['analyses'].values()))

    def test_adjustment_ranges_reassess_each_student_and_preserve_components(self):
        bundle=self.data.bundles['SYNTHETIC-A-2027'];decisions=deepcopy(bundle.decisions)
        decisions[2027]['adjustment']=dict(status='approved',base_version=decisions[2027]['version'],version='SYNTHETIC-adjustment',
            ranges=[dict(lower=0,upper=35,category='challenge'),dict(lower=35,upper=100,category='core')])
        self.data.bundles['SYNTHETIC-A-2027']=replace(bundle,decisions=decisions)
        a=self.candidates(self.report())['analyses']['SYNTHETIC-A-2027']
        scores=score_input()
        for area in ('korean','math'):scores[area]['standard_score']=9
        for mark in scores['inquiry']:mark['standard_score']=9
        b=self.candidates(self.report(scores=scores))['analyses']['SYNTHETIC-A-2027']
        self.assertEqual((a['category'],b['category']),('challenge','core'))
        self.assertEqual(a['decision_components']['base_category'],'core')
        self.assertEqual(b['decision_components']['base_category'],'room')

    def test_nested_recruitment_allowlist_and_instant_date_deadlines(self):
        rows=deepcopy(self.data.catalog.offerings)
        row=next(r for r in rows if r['offering_id']=='SYNTHETIC-A-2027')
        row['recruitment'].update(deadline_at='2027-01-01T16:00:00',source_timezone='Asia/Seoul',
            changes=[dict(kind='rollover',delta=0,announced_date='2027-01-01',announced_at='2027-01-01T00:00:00',
                          source_url='https://example.invalid/synthetic',private_path='SYNTHETIC-PRIVATE-PATH',token={'raw':'SYNTHETIC-PRIVATE-TOKEN'},raw_table={'weights':[1,2]})])
        self.data.catalog=replace(self.data.catalog,offerings=rows)
        response=self.request('GET','/api/v1/offerings/SYNTHETIC-A-2027/recruitment').json()['recruitment']
        self.assertEqual(response['deadline'],'2027-01-01');self.assertEqual(response['deadline_at'],'2027-01-01T07:00:00Z')
        self.assertEqual(response['changes'][0]['announced_date'],'2027-01-01')
        self.assertEqual(response['changes'][0]['announced_at'],'2026-12-31T15:00:00Z')
        self.assertNotIn('SYNTHETIC-PRIVATE',json.dumps(response));self.assertNotIn('raw_table',json.dumps(response))

    def test_uncontracted_naive_deadline_and_nested_public_objects_are_rejected(self):
        rows=deepcopy(self.data.catalog.offerings);rows[3]['recruitment']['deadline_at']='2027-01-01T16:00:00'
        self.data.catalog=replace(self.data.catalog,offerings=rows)
        self.assertEqual(self.request('GET','/api/v1/offerings/SYNTHETIC-A-2027/recruitment').status_code,503)
        rows[3]['recruitment']['deadline_at']=None
        rows[3]['recruitment']['changes']=[dict(delta={'private_path':'SYNTHETIC-PRIVATE'})]
        self.data.catalog=replace(self.data.catalog,offerings=rows)
        response=self.request('GET','/api/v1/offerings/SYNTHETIC-A-2027/recruitment')
        self.assertEqual(response.status_code,503);self.assertNotIn('SYNTHETIC-PRIVATE',response.text)

    def test_score_revision_retains_old_report_and_invalidates_old_cohort(self):
        r=self.select(self.candidates(self.report()));old=deepcopy(self.repo.revisions[(r['report_id'],r['report_version'])])
        updated_scores=score_input()
        for field in ('korean','math'):updated_scores[field]['standard_score']=9
        for mark in updated_scores['inquiry']:mark['standard_score']=9
        p=self.request('POST','/api/v1/score-profiles',dict(scores=updated_scores,confirmed=True)).json()
        revised=self.request('POST','/api/v1/overall-reports',dict(profile_id=p['profile_id'],report_id=r['report_id'],expected_version=r['report_version'])).json()
        self.assertEqual(self.repo.revisions[(r['report_id'],r['report_version'])],old)
        self.assertEqual(revised['analyses'],{})
        self.assertEqual(revised['shortlist']['SYNTHETIC-A-2027']['assessment_status'],'needs_revalidation')
        self.assertEqual(self.statistics(revised).json()['status'],'pending')
        ready=self.candidates(revised)
        self.assertNotEqual(ready['analyses']['SYNTHETIC-A-2027']['advantage']['delta_pp'],r['analyses']['SYNTHETIC-A-2027']['advantage']['delta_pp'])

    def test_deduplicate_students_and_rank_equal_scores(self):
        own=self.select(self.candidates(self.report()))
        self.clock.advance();self.select(self.candidates(self.report()))
        self.clock.advance();self.select(self.candidates(self.report(owner=self.other),owner=self.other),owner=self.other)
        stats=self.statistics(own).json()
        self.assertEqual(stats['recommended_count'],2);self.assertEqual(stats['selected_count'],2)
        self.assertEqual(stats['selected_rank']['tie_count'],2)
        self.assertNotIn(self.other,json.dumps(stats))

    def test_model_pending_keeps_valid_score_and_blocks_forecast(self):
        self.data.binding=None
        r=self.candidates(self.report())
        self.assertEqual(r['overall']['total_standard_score'],30)
        self.assertIsNone(r['overall']['overall']['top_percent'])
        self.assertEqual(r['analyses']['SYNTHETIC-A-2027']['reason_code'],'total_model_missing')
        self.assertEqual(r['candidates']['status'],'pending')

    def test_unapproved_bridge_and_wrong_source_versions_are_pending(self):
        bundle=self.data.bundles['SYNTHETIC-A-2027']
        cases=[(replace(bundle,status='reference'),'analysis_release_not_approved'),
               (replace(bundle,source_pack_version='SYNTHETIC-old'),'analysis_pack_mismatch'),
               (replace(bundle,policy=replace(bundle.policy,status='research_only')),'BRIDGE_OR_DISTRIBUTION_NOT_VALIDATED')]
        for candidate,reason in cases:
            with self.subTest(reason=reason):
                self.data.bundles['SYNTHETIC-A-2027']=candidate
                r=self.report()
                result=self.request('POST',f"/api/v1/reports/{r['report_id']}/university-results",dict(offering_ids=['SYNTHETIC-A-2027'],expected_version=1)).json()
                row=result['analyses']['SYNTHETIC-A-2027']
                self.assertEqual(row['status'],'pending');self.assertEqual(row['reason_code'],reason)

    def test_student_specific_eligibility_and_unknown_non_score_conditions(self):
        scores=score_input();scores['english_grade']=8
        r=self.candidates(self.report(scores=scores))
        self.assertEqual(r['analyses']['SYNTHETIC-A-2027']['category'],'ineligible')
        self.assertEqual(r['candidates']['basic_university_groups'],[])
        bundle=self.data.bundles['SYNTHETIC-A-2027'];decisions=deepcopy(bundle.decisions)
        decisions[2027]['eligibility_policy']['requirements']=[dict(field='military_qualification',operator='in',values=['verified'])]
        self.data.bundles['SYNTHETIC-A-2027']=replace(bundle,decisions=decisions)
        r=self.candidates(self.report())
        self.assertEqual(r['analyses']['SYNTHETIC-A-2027']['reason_code'],'eligibility_confirmation_required')

    def test_dto_and_http_error_never_forward_internal_data(self):
        r=self.select(self.candidates(self.report()));raw=json.dumps(r)
        for forbidden in ('owner_id','source_refs','frequencies','expected_total_weight','password','internal_trace','exact_score'):
            self.assertNotIn(forbidden,raw)
        self.data.get_catalog=lambda:(_ for _ in ()).throw(OSError('private/token/database-url'))
        error=self.request('GET','/api/v1/offerings/search')
        self.assertEqual(error.status_code,503);self.assertNotIn('private/token',error.text)
        self.assertEqual(error.headers['cache-control'],'no-store')

    def test_no_configuration_has_health_but_no_synthetic_operational_fallback(self):
        client=TestClient(create_app(settings=ServerSettings(),clock=self.clock))
        self.assertEqual(client.get('/health/live').status_code,200)
        ready=client.get('/health/ready')
        self.assertEqual(ready.status_code,503);self.assertEqual(ready.json()['database']['status'],'not_run_configuration_missing')
        self.assertEqual(client.get('/api/v1/admission-history',headers={'Authorization':'Bearer fabricated'}).status_code,503)
        self.assertNotIn('SYNTHETIC',ready.text)

    def test_absent_data_returns_pending_without_zero_counts(self):
        app=create_app(settings=ServerSettings(),repository=self.repo,data=MissingDataProvider(),sessions=SyntheticSessions(self.clock),clock=self.clock)
        response=TestClient(app).get('/api/v1/offerings/search',headers={'Authorization':'Bearer '+self.owner})
        self.assertEqual(response.status_code,200);self.assertIsNone(response.json()['matching_offering_count']);self.assertEqual(response.json()['status'],'pending')

    def test_invalid_json_duplicate_query_and_missing_key_fail_safely(self):
        response=self.client.post('/api/v1/score-profiles',content=b'{invalid',headers={'Authorization':'Bearer '+self.owner})
        self.assertEqual(response.status_code,422)
        self.assertEqual(self.request('GET','/api/v1/offerings/search?limit=1&limit=2').status_code,422)
        response=self.client.post('/api/v1/score-profiles',json=dict(scores=score_input(),confirmed=True),headers={'Authorization':'Bearer '+self.owner})
        self.assertEqual(response.status_code,422)


if __name__=='__main__':unittest.main()
