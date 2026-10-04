"""Invented distributions and API transports; never production approval/data."""
from copy import deepcopy
from dataclasses import replace, FrozenInstanceError
from fractions import Fraction
from pathlib import Path
import hashlib
import json
import sys
import unittest

ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'src'))
from test_university_scoring_service import SyntheticScoringData
import test_backend_workflows as workflows
from backend_synthetic_fixture import FrozenClock
from jungsi_touch.application.platform_ports import UniversityPercentileRelease, PlatformError
from jungsi_touch.application.university_scoring import UniversityScoringService
from jungsi_touch.application.university_percentile import UniversityPercentileService
from jungsi_touch.admission_result_percentile import UniversityScoreDistribution, ResultPercentileError, MATCH_FIELDS
from jungsi_touch.infrastructure.drive_provider import DriveDataProvider, DriveClient
from jungsi_touch.exam_pack import ExamPack
from test_conversion_rule_synthetic import const
from test_backend_adapters import Response


class SyntheticPercentileData(SyntheticScoringData):
    production_allowed=False
    def __init__(self,clock):
        super().__init__(clock)
        self.raw_rule.update(score_scale_id='SYNTHETIC-scale',bonus_treatment='excluded',output_range={'min':0,'max':100})
        self.conversion=self.release(self.raw_rule)
        self.percentile=self.percentile_release()
    def percentile_release(self,raw=None):
        raw=deepcopy(raw or self.bundles['SYNTHETIC-A-2027'].curves[2027].data)
        raw['metadata'].update(exam_id=self.pack.exam_id,source_pack_version=self.pack.pack_version)
        binding=dict(self.conversion.bindings[0],curve_version=raw['metadata']['curve_version'])
        return UniversityPercentileRelease('SYNTHETIC-percentile.v1','approved','SYNTHETIC-percentile-release',2027,
            self.pack.exam_id,self.pack.pack_version,self.pack._data['exam']['exam_type'],self.raw_rule['rule_version'],
            UniversityScoreDistribution(raw),(binding,))
    def get_percentile(self,oid):
        self.calls.append(('percentile',oid));return self.percentile if oid==self.offering['offering_id'] else None
    def set_score(self,value):
        raw=dict(self.raw_rule,inputs={},nodes={'score':const(value)},output_node='score')
        self.conversion=self.release(raw)


class UniversityPercentileTests(unittest.TestCase):
    def setUp(self):
        self.data=SyntheticPercentileData(FrozenClock());self.scoring=UniversityScoringService(self.data)
        self.service=UniversityPercentileService(self.data)
    def calculate(self):
        conversion=self.scoring.calculate(self.data.offering,self.data.profile())
        return self.service.calculate(self.data.offering,conversion)
    def test_independent_ready_without_total_bridge_decision_or_eligibility(self):
        result=self.calculate();self.assertTrue(result.ready,result)
        self.assertEqual(result.inclusive,Fraction(4,9));self.assertEqual(result.exclusive,Fraction(4,9))
        self.assertEqual([row[0] for row in self.data.calls],['pack','conversion','percentile'])
        self.assertEqual(result.dto()['score_basis'],'actual_exam')
    def test_tie_inclusive_exclusive_and_exact_share_match_hand_counts(self):
        self.data.set_score(20);result=self.calculate();dto=result.dto()
        self.assertEqual((result.inclusive,result.exclusive),(Fraction(7,9),Fraction(4,9)))
        self.assertEqual(dto['top_percent'],'77.777778');self.assertEqual(dto['exclusive_top_percent'],'44.444444')
        self.assertEqual(dto['tie_share_percent'],'33.333333')
        self.assertEqual(dto['inclusive_top_percent'],dto['top_percent'])
    def test_min_max_and_outside_observed_support_are_actual_zero_or_hundred(self):
        for score,inclusive,exclusive in [(4,Fraction(1),Fraction(7,9)),(36,Fraction(4,9),Fraction(0)),
                                          (3,Fraction(1),Fraction(1)),(37,Fraction(0),Fraction(0))]:
            self.data.set_score(score);result=self.calculate()
            with self.subTest(score=score):
                self.assertTrue(result.ready,result);self.assertEqual((result.inclusive,result.exclusive),(inclusive,exclusive))
                self.assertIsNotNone(result.dto()['top_percent'])
        self.assertEqual(self.calculate().dto()['top_percent'],'0.000000')
    def test_all_tied_has_hundred_inclusive_zero_exclusive(self):
        raw=deepcopy(self.data.percentile.curve.data);raw['metadata'].update(score_min=20,score_max=20)
        raw['frequencies']=[dict(converted_score=20,weight=9)];self.data.percentile=self.data.percentile_release(raw)
        self.data.set_score(20);result=self.calculate()
        self.assertEqual((result.inclusive,result.exclusive),(Fraction(1),Fraction(0)))
        self.assertEqual(result.dto()['tie_share_percent'],'100.000000')
    def test_estimated_weights_preserve_model_kind_and_fractional_weights(self):
        raw=deepcopy(self.data.percentile.curve.data);raw['metadata'].update(kind='estimated_weights',expected_total_weight=2)
        raw['frequencies']=[dict(converted_score=4,weight='0.5'),dict(converted_score=20,weight='1.25'),dict(converted_score=36,weight='0.25')]
        self.data.percentile=self.data.percentile_release(raw);self.data.set_score(20);result=self.calculate()
        self.assertEqual((result.inclusive,result.exclusive),(Fraction(3,4),Fraction(1,8)))
        self.assertEqual(result.dto()['data_kind'],'estimated_weights');self.assertEqual(result.dto()['tie_share_percent'],'62.500000')
    def test_exact_score_is_not_replaced_by_display_rounding(self):
        self.data.set_score('1.234');raw=deepcopy(self.data.percentile.curve.data)
        raw['metadata'].update(score_min='1.231',score_max='1.235')
        raw['frequencies']=[dict(converted_score='1.231',weight=5),dict(converted_score='1.235',weight=4)]
        self.data.percentile=self.data.percentile_release(raw)
        conversion=self.scoring.calculate(self.data.offering,self.data.profile());self.assertEqual(conversion.converted_score,'1.23')
        result=self.service.calculate(self.data.offering,conversion)
        self.assertEqual((result.inclusive,result.exclusive),(Fraction(4,9),Fraction(4,9)))
    def test_admissions_cutoff_lookup_keeps_its_original_domain_guard(self):
        curve=self.data.percentile.curve;record={k:curve.metadata[k] for k in MATCH_FIELDS}
        record.update(score_metric=curve.metadata['score_metric'],score_value=37,publication_precision={'mode':'exact'})
        with self.assertRaises(ResultPercentileError) as caught:curve.lookup(record)
        self.assertEqual(caught.exception.code,'CUTOFF_OUTSIDE_DOMAIN')
    def test_missing_scale_or_bonus_is_pending_without_guessing(self):
        for field in ('score_scale_id','bonus_treatment'):
            raw=deepcopy(self.data.raw_rule);raw.pop(field)
            self.data.conversion=self.data.release(raw);conversion=self.scoring.calculate(self.data.offering,self.data.profile())
            self.assertTrue(conversion.ready)
            result=self.service.calculate(self.data.offering,conversion)
            self.assertEqual(result.reason_code,'percentile_conversion_context_missing');self.assertIsNone(result.dto()['top_percent'])
    def test_binding_checks_all_catalog_dimensions_and_versions(self):
        original=deepcopy(self.data.percentile)
        for field in ('university_id','campus','department','track','group','rule_version','curve_version'):
            self.data.percentile=deepcopy(original);self.data.percentile.bindings[0][field]='SYNTHETIC-other'
            with self.subTest(field=field):self.assertEqual(self.calculate().reason_code,'percentile_binding_mismatch')
        self.data.percentile=replace(original,bindings=original.bindings*2)
        self.assertEqual(self.calculate().reason_code,'percentile_binding_ambiguous')
        self.data.percentile=deepcopy(original);self.data.percentile.bindings[0]['offering_pk']='SYNTHETIC-other'
        self.assertEqual(self.calculate().reason_code,'percentile_binding_missing')
    def test_release_binds_year_exam_pack_rule_and_exam_type(self):
        original=self.data.percentile
        for field,value in [('academic_year',2026),('exam_id','SYNTHETIC-other'),('source_pack_version','SYNTHETIC-other'),
                            ('rule_version','SYNTHETIC-other'),('exam_type','september_mock')]:
            self.data.percentile=replace(original,**{field:value})
            with self.subTest(field=field):self.assertEqual(self.calculate().reason_code,'percentile_release_context_mismatch')
    def test_curve_binds_rule_scale_bonus_exam_population_and_optional_pack(self):
        original=deepcopy(self.data.percentile)
        for field,value in [('rule_id','SYNTHETIC-other'),('rule_version','SYNTHETIC-other'),('score_scale_id','SYNTHETIC-other'),
            ('bonus_treatment','included'),('exam_id','SYNTHETIC-other'),('academic_year',2026),('source_pack_version','SYNTHETIC-other'),
            ('population_id','SYNTHETIC-service-users-only')]:
            self.data.percentile=deepcopy(original);self.data.percentile.curve.data['metadata'][field]=value
            with self.subTest(field=field):
                result=self.calculate();self.assertFalse(result.ready);self.assertIsNone(result.dto()['top_percent'])
    def test_release_curve_rule_approval_and_population_completeness_are_not_promoted(self):
        original=deepcopy(self.data.percentile)
        self.data.percentile=replace(original,status='reviewed');self.assertEqual(self.calculate().reason_code,'percentile_release_not_approved')
        for field,value in [('status','research'),('rule_review_status','source_verified'),('complete',False),('population_verified',False)]:
            self.data.percentile=deepcopy(original);self.data.percentile.curve.data['metadata'][field]=value
            before=deepcopy(self.data.percentile.curve.data)
            self.assertFalse(self.calculate().ready);self.assertEqual(self.data.percentile.curve.data,before)
    def test_bad_weights_counts_totals_and_numeric_types_block_readiness(self):
        original=deepcopy(self.data.percentile)
        for field,value in [('weight',0),('weight',-1),('weight',True),('weight',0.5),('weight','NaN'),('weight','Infinity'),('weight','0.5'),
                            ('converted_score',True),('converted_score',1.25)]:
            self.data.percentile=deepcopy(original);self.data.percentile.curve.data['frequencies'][0][field]=value
            with self.subTest(field=field,value=value):self.assertFalse(self.calculate().ready)
        self.data.percentile=deepcopy(original);self.data.percentile.curve.data['metadata']['expected_total_weight']=10
        self.assertEqual(self.calculate().reason_code,'WEIGHT_MISMATCH')
        self.data.percentile=deepcopy(original);self.data.percentile.curve.data['frequencies'].append(dict(converted_score=20,weight=1))
        self.assertEqual(self.calculate().reason_code,'DUPLICATE_SCORE')
    def test_conversion_is_required_and_for_different_offering_never_reused(self):
        self.data.conversion=replace(self.data.conversion,status='draft')
        conversion=self.scoring.calculate(self.data.offering,self.data.profile());calls=len(self.data.calls)
        self.assertEqual(self.service.calculate(self.data.offering,conversion).reason_code,'conversion_not_ready')
        self.assertEqual(len(self.data.calls),calls)
        self.data.conversion=self.data.release(self.data.raw_rule);conversion=self.scoring.calculate(self.data.offering,self.data.profile())
        self.assertEqual(self.service.calculate(dict(self.data.offering,offering_id='SYNTHETIC-B-2027'),conversion).reason_code,'percentile_conversion_context_mismatch')
    def test_mock_compatibility_does_not_authorize_the_actual_csat_curve(self):
        raw=deepcopy(self.data.pack._data);raw['exam'].update(exam_type='september_mock',exam_id='SYNTHETIC-new-mock');self.data.pack=ExamPack(raw)
        compat=dict(status='approved',version='SYNTHETIC-compat.v1',source_exam_id=self.data.pack.exam_id,
            source_pack_version=self.data.pack.pack_version,source_exam_type='september_mock',
            rule_exam_id=self.data.conversion.exam_id,rule_pack_version=self.data.conversion.source_pack_version)
        self.data.conversion=replace(self.data.conversion,mock_compatibility=compat)
        self.assertEqual(self.calculate().reason_code,'percentile_release_context_mismatch')
        self.data.percentile=self.data.percentile_release();result=self.calculate()
        self.assertTrue(result.ready,result);self.assertEqual(result.dto()['score_basis'],'mock_exam')
    def test_mutable_public_dto_cannot_edit_original_result_curve_or_rule(self):
        original_curve=deepcopy(self.data.percentile.curve.data);original_rule=deepcopy(self.data.conversion.release.rules[self.data.raw_rule['rule_version']].data)
        result=self.calculate();dto=result.dto();dto['top_percent']='SYNTHETIC-edit';dto['population_id']='SYNTHETIC-edit'
        with self.assertRaises(FrozenInstanceError):result.inclusive=Fraction(0)
        self.assertEqual(result.inclusive,Fraction(4,9));self.assertEqual(self.data.percentile.curve.data,original_curve)
        self.assertEqual(self.data.conversion.release.rules[self.data.raw_rule['rule_version']].data,original_rule)
        contract=json.loads((ROOT/'docs/current/service_spec.json').read_text(encoding='utf-8'))['university_percentile_contract']['public_result_contract']['fields']
        self.assertEqual(set(result.dto()),set(contract))
        for field in ('exact_score','context','frequencies','source_refs','weight','owner_id'):self.assertNotIn(field,result.dto())
    def test_public_version_identifiers_cannot_contain_private_paths(self):
        self.data.percentile.curve.data['metadata']['source_model_version']='outputs/SYNTHETIC-private'
        result=self.calculate();self.assertFalse(result.ready);self.assertNotIn('outputs/',json.dumps(result.dto()))


class UniversityPercentileHttpTests(unittest.TestCase):
    request=workflows.BackendWorkflowTests.request
    report=workflows.BackendWorkflowTests.report
    def setUp(self):
        workflows.BackendWorkflowTests.setUp(self);self.data=SyntheticPercentileData(self.clock)
        platform=self.app.state.platform;platform.data=self.data;platform.overall._data=self.data
        platform.scoring.data=self.data;platform.percentile.data=self.data
    def analyze(self,record,key=None,owner=None):
        return self.request('POST',f"/api/v1/reports/{record['report_id']}/university-results",
            dict(expected_version=record['report_version'],offering_ids=['SYNTHETIC-A-2027']),owner=owner,key=key)
    def test_api_independent_triple_state_and_compatibility_value(self):
        record=self.report(scores=self.data.scores());response=self.analyze(record);self.assertEqual(response.status_code,200,response.text)
        result=response.json()['analyses']['SYNTHETIC-A-2027']
        self.assertEqual(result['conversion']['status'],'ready');self.assertEqual(result['percentile']['status'],'ready')
        self.assertEqual(result['status'],'pending');self.assertEqual(result['converted_percentile'],result['percentile']['top_percent'])
        self.assertIsNone(result['advantage']);self.assertEqual(result['eligibility_status'],'needs_confirmation')
        self.assertTrue(all('percentile' not in row for row in result['years']))
        self.assertTrue(all(row['converted_score'] is None for row in result['years'] if row['academic_year']!=2027))
    def test_analysis_and_total_failures_cannot_erase_percentile(self):
        for failure in (KeyError('SYNTHETIC-private'),PlatformError('drive_hash_mismatch',503),None):
            def supply(oid):
                if failure:raise failure
                return None
            self.data.get_analysis=supply
            self.data.get_total_model=lambda *args:None
            response=self.analyze(self.report(scores=self.data.scores()));self.assertEqual(response.status_code,200,response.text)
            result=response.json()['analyses']['SYNTHETIC-A-2027']
            self.assertEqual(result['percentile']['status'],'ready');self.assertEqual(result['status'],'pending')
            self.assertNotIn('SYNTHETIC-private',response.text)
    def test_missing_unapproved_or_failed_curve_preserves_conversion_and_null_rank(self):
        original=self.data.percentile
        for release in (None,replace(original,status='research')):
            self.data.percentile=release
            response=self.analyze(self.report(scores=self.data.scores()));result=response.json()['analyses']['SYNTHETIC-A-2027']
            self.assertEqual(result['conversion']['status'],'ready');self.assertEqual(result['percentile']['status'],'pending')
            self.assertIsNone(result['converted_percentile']);self.assertIsNone(result['percentile']['top_percent'])
        def failure(oid):raise OSError('SYNTHETIC-private-curve')
        self.data.get_percentile=failure
        response=self.analyze(self.report(scores=self.data.scores()));self.assertEqual(response.status_code,200)
        self.assertEqual(response.json()['analyses']['SYNTHETIC-A-2027']['conversion']['status'],'ready')
        self.assertNotIn('SYNTHETIC-private-curve',response.text)
    def test_actual_zero_survives_report_export_and_candidate_dto(self):
        self.data.set_score(37);record=self.report(scores=self.data.scores());response=self.analyze(record);ready=response.json()
        self.assertEqual(ready['analyses']['SYNTHETIC-A-2027']['percentile']['top_percent'],'0.000000')
        for suffix in ('','/print'):
            response=self.request('GET',f"/api/v1/reports/{record['report_id']}"+suffix)
            self.assertEqual(response.status_code,200,response.text)
            self.assertIn('0.000000',response.text);self.assertNotIn('frequencies',response.text);self.assertNotIn('exact_score',response.text)
        response=self.request('POST',f"/api/v1/reports/{record['report_id']}/candidates",dict(expected_version=ready['report_version']))
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(response.json()['analyses']['SYNTHETIC-A-2027']['percentile']['status'],'ready')
    def test_paid_owner_confirmation_revision_and_idempotency_guard_new_port(self):
        record=self.report(scores=self.data.scores());calls=len(self.data.calls)
        for owner,status in ((self.standard,403),(self.other,404)):
            self.assertEqual(self.analyze(record,owner=owner).status_code,status)
        self.assertEqual(len(self.data.calls),calls)
        first=self.analyze(record,key='SYNTHETIC-pct-replay');calls=len(self.data.calls)
        self.assertEqual(first.json(),self.analyze(record,key='SYNTHETIC-pct-replay').json());self.assertEqual(len(self.data.calls),calls)
        self.assertEqual(self.analyze(record).status_code,409);self.assertEqual(len(self.data.calls),calls)
        unconfirmed=self.report(scores=self.data.scores(),confirmed=False);calls=len(self.data.calls)
        self.assertEqual(self.analyze(unconfirmed).status_code,409);self.assertEqual(len(self.data.calls),calls)
        self.repo.entitlements[self.owner]['active']=False
        read=self.request('GET',f"/api/v1/reports/{record['report_id']}")
        self.assertNotIn('analyses',read.json());self.assertNotIn('percentile',read.text)
        self.assertEqual(self.analyze(record,key='SYNTHETIC-pct-replay').status_code,403)
    def test_client_cannot_supply_curve_research_or_approval(self):
        record=self.report(scores=self.data.scores());calls=len(self.data.calls)
        for field in ('curve','percentile','research','approved'):
            response=self.request('POST',f"/api/v1/reports/{record['report_id']}/university-results",
                dict(expected_version=record['report_version'],offering_ids=['SYNTHETIC-A-2027'],**{field:True}))
            self.assertEqual(response.status_code,422)
        self.assertEqual(len(self.data.calls),calls)
    def test_approved_legacy_bridge_keeps_percentile_value_and_estimate_basis(self):
        # Original accepted backend fixture exercises the approved legacy path.
        workflows.BackendWorkflowTests.setUp(self)
        record=self.report()
        response=self.request('POST',f"/api/v1/reports/{record['report_id']}/candidates",dict(expected_version=record['report_version']))
        result=response.json()['analyses']['SYNTHETIC-A-2027']
        self.assertEqual(result['status'],'ready');self.assertEqual(result['percentile']['status'],'ready')
        self.assertEqual(result['percentile']['score_basis'],'year_equated_estimate')
        self.assertEqual(result['converted_percentile'],result['percentile']['top_percent'])
    def decision_bundle(self):
        old=self.data.bundles['SYNTHETIC-A-2027']
        bundle=replace(deepcopy(old),release=self.data.conversion.release,source_pack_version=self.data.pack.pack_version,bridges={},curves={})
        decision=bundle.decisions[2027];decision['context']['exam_id']=self.data.pack.exam_id
        decision['evidence']['context']=deepcopy(decision['context'])
        return bundle
    def test_missing_policy_or_evidence_keeps_independent_percentile(self):
        for missing in ('policy','evidence'):
            bundle=self.decision_bundle()
            if missing=='policy':bundle.decisions[2027]=None
            else:bundle.decisions[2027]['evidence']=None
            self.data.analysis=bundle
            response=self.analyze(self.report(scores=self.data.scores()));self.assertEqual(response.status_code,200,response.text)
            result=response.json()['analyses']['SYNTHETIC-A-2027']
            self.assertEqual(result['percentile']['status'],'ready');self.assertEqual(result['status'],'pending')
            self.assertEqual(result['reason_code'],'decision_policy_missing' if missing=='policy' else 'decision_evidence_unapproved')
    def test_decision_can_use_independent_bound_curve_without_a_duplicate_curve(self):
        self.data.analysis=self.decision_bundle()
        response=self.analyze(self.report(scores=self.data.scores()));result=response.json()['analyses']['SYNTHETIC-A-2027']
        self.assertEqual(result['status'],'ready',result);self.assertEqual(result['category'],'core')
        self.assertEqual(result['percentile']['status'],'ready');self.assertIsNone(result['advantage'])
    def test_decision_for_another_curve_version_cannot_change_percentile(self):
        self.data.analysis=self.decision_bundle()
        self.data.percentile.curve.data['metadata']['curve_version']='SYNTHETIC-new-curve-v2'
        self.data.percentile.bindings[0]['curve_version']='SYNTHETIC-new-curve-v2'
        response=self.analyze(self.report(scores=self.data.scores()));result=response.json()['analyses']['SYNTHETIC-A-2027']
        self.assertEqual(result['percentile']['status'],'ready');self.assertEqual(result['status'],'pending')
        self.assertEqual(result['reason_code'],'decision_version_mismatch')
    def test_absent_or_none_new_port_preserves_approved_same_year_success(self):
        curve=deepcopy(self.data.percentile.curve)
        # Accepted old conversion rules may have no new scale/bonus context.
        raw=deepcopy(self.data.raw_rule);raw.pop('score_scale_id');raw.pop('bonus_treatment')
        self.data.conversion=self.data.release(raw)
        for absent in (False,True):
            bundle=self.decision_bundle();bundle.curves[2027]=curve;self.data.analysis=bundle
            self.data.percentile=None
            if absent:self.data.get_percentile=None
            response=self.analyze(self.report(scores=self.data.scores()));result=response.json()['analyses']['SYNTHETIC-A-2027']
            self.assertEqual(result['status'],'ready',result);self.assertEqual(result['percentile']['status'],'ready')
            self.assertEqual(result['percentile']['score_basis'],'actual_exam')
            self.assertEqual(result['converted_percentile'],'44.444444')
            self.assertEqual(result['percentile']['release_version'],bundle.version)
    def test_present_invalid_or_unapproved_new_port_never_bypasses_to_legacy(self):
        original=deepcopy(self.data.percentile)
        self.data.analysis=self.decision_bundle();self.data.analysis.curves[2027]=original.curve
        for bundle in (replace(original,status='reviewed'),replace(original,rule_version='SYNTHETIC-other'),{'status':'approved'}):
            self.data.get_percentile=lambda oid:bundle
            response=self.analyze(self.report(scores=self.data.scores()));result=response.json()['analyses']['SYNTHETIC-A-2027']
            self.assertEqual(result['percentile']['status'],'pending');self.assertEqual(result['status'],'pending')
            self.assertIsNone(result['converted_percentile'])
    def test_private_path_in_analysis_version_is_rejected_without_erasing_percentile(self):
        self.data.analysis=replace(self.decision_bundle(),version='outputs/SYNTHETIC-private.json')
        response=self.analyze(self.report(scores=self.data.scores()));result=response.json()['analyses']['SYNTHETIC-A-2027']
        self.assertEqual(result['status'],'pending');self.assertEqual(result['reason_code'],'analysis_release_invalid')
        self.assertEqual(result['percentile']['status'],'ready');self.assertNotIn('outputs/',response.text)


class PercentileDriveTests(unittest.TestCase):
    def artifact(self):
        data=SyntheticPercentileData(FrozenClock());r=data.percentile
        return data,dict(format='jungsi.university-percentile-release/v1',version=r.version,status=r.status,release_id=r.release_id,
            academic_year=r.academic_year,exam_id=r.exam_id,source_pack_version=r.source_pack_version,exam_type=r.exam_type,
            rule_version=r.rule_version,curve=r.curve.data,bindings=list(r.bindings))
    def test_independent_pinned_artifact_and_approval_version_gates(self):
        data,raw=self.artifact();calls=[]
        class Client:
            def artifact(self,entry):calls.append(entry);return deepcopy(raw),{}
        entry=dict(kind='percentile',key=data.offering['offering_id'],sha256='a'*64,version=raw['version'],status='approved')
        provider=DriveDataProvider(Client(),dict(format='jungsi.data-registry/v1',entries=[entry]))
        self.assertIsInstance(provider.get_percentile(data.offering['offering_id']),UniversityPercentileRelease)
        self.assertEqual([r['kind'] for r in calls],['percentile'])
        entry['status']='research'
        with self.assertRaises(PlatformError) as caught:provider.get_percentile(data.offering['offering_id'])
        self.assertEqual(caught.exception.code,'artifact_not_approved')
        entry['status']='approved';raw['version']='SYNTHETIC-other'
        with self.assertRaises(PlatformError) as caught:provider.get_percentile(data.offering['offering_id'])
        self.assertEqual(caught.exception.code,'artifact_version_mismatch')
    def test_format_and_malformed_curve_are_pending_provider_errors(self):
        data,raw=self.artifact()
        class Client:
            def artifact(self,entry):return deepcopy(raw),{}
        entry=dict(kind='percentile',key=data.offering['offering_id'],sha256='a'*64,version=raw['version'],status='approved')
        provider=DriveDataProvider(Client(),dict(format='jungsi.data-registry/v1',entries=[entry]))
        raw['format']='SYNTHETIC-invalid'
        with self.assertRaises(PlatformError):provider.get_percentile(data.offering['offering_id'])
        raw['format']='jungsi.university-percentile-release/v1';raw['curve']['frequencies'][0]['weight']=0
        with self.assertRaises(PlatformError) as caught:provider.get_percentile(data.offering['offering_id'])
        self.assertEqual(caught.exception.code,'percentile_release_invalid')
    def test_fixed_folder_hash_and_drive_version_checked_before_curve_load(self):
        data,raw=self.artifact();content=json.dumps(raw).encode()
        entry=dict(kind='percentile',key=data.offering['offering_id'],version=raw['version'],status='approved',
            file_id='SYNTHETIC-FILE',drive_version='7',sha256=hashlib.sha256(content).hexdigest())
        meta=dict(id='SYNTHETIC-FILE',parents=['SYNTHETIC-INPUT'],trashed=False,version='7',
                  createdTime='2026-10-04T00:00:00Z',modifiedTime='2026-10-04T00:00:00Z')
        def opener(request,timeout):return Response(content if 'alt=media' in request.full_url else meta)
        client=DriveClient('SYNTHETIC-OAUTH','SYNTHETIC-INPUT','SYNTHETIC-OUTPUT',opener=opener)
        def provider(changes=None):return DriveDataProvider(client,dict(format='jungsi.data-registry/v1',entries=[dict(entry,**(changes or {}))]))
        self.assertIsInstance(provider().get_percentile(data.offering['offering_id']),UniversityPercentileRelease)
        for changes,code in [({'sha256':'0'*64},'drive_hash_mismatch'),({'drive_version':'8'},'drive_version_mismatch')]:
            with self.subTest(code=code),self.assertRaises(PlatformError) as caught:provider(changes).get_percentile(data.offering['offering_id'])
            self.assertEqual(caught.exception.code,code)
        meta['parents']=['SYNTHETIC-other']
        with self.assertRaises(PlatformError) as caught:provider().get_percentile(data.offering['offering_id'])
        self.assertEqual(caught.exception.code,'drive_folder_mismatch')
        meta['parents']=['SYNTHETIC-INPUT'];meta['trashed']=True
        with self.assertRaises(PlatformError):provider().get_percentile(data.offering['offering_id'])


if __name__=='__main__':unittest.main()
