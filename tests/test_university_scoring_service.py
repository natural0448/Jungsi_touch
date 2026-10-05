"""Invented rules and transport fixtures only; no workbook or actual data.

Approval flags simulate production guard branches, never authorize a real rule.
"""
from copy import deepcopy
from dataclasses import replace, FrozenInstanceError
from fractions import Fraction
from pathlib import Path
import json
import sys
import unittest

ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'src'))
from backend_synthetic_fixture import SyntheticData, FrozenClock, score_input, rule
import test_backend_workflows as workflows
from jungsi_touch.exam_pack import ExamPack
from jungsi_touch.application.platform_ports import UniversityConversionRelease, PlatformError
from jungsi_touch.application.university_scoring import UniversityScoringService, CONTEXT_FIELDS
from jungsi_touch.university_conversion import ConversionRelease, ConversionError
from jungsi_touch.infrastructure.drive_provider import DriveDataProvider
from jungsi_touch.admission_result_percentile import UniversityScoreDistribution, MATCH_FIELDS
from jungsi_touch.application.offering_analysis import evaluate_offering
from jungsi_touch.application.overall_analysis import OverallAnalysisService, OverallAnalysisError
from jungsi_touch.application.authorization import Actor, AccessController
from test_conversion_rule_synthetic import inp, const, number_input, lookup_table


class SyntheticScoringData(SyntheticData):
    production_allowed=False
    def __init__(self,clock):
        super().__init__(clock)
        raw=deepcopy(self.pack._data)
        raw['exam'].update(exam_type='csat',exam_id='SYNTHETIC-current-csat')
        self.pack=ExamPack(raw);self.binding=None
        self.offering=next(r for r in self.catalog.offerings if r['offering_id']=='SYNTHETIC-A-2027')
        self.raw_rule=rule(2027,'A')
        self.conversion=self.release(self.raw_rule)
        self.analysis=None
    def release(self,raw):
        raw=deepcopy(raw)
        raw.update(exam_id=self.pack.exam_id,source_pack_version=self.pack.pack_version)
        binding=dict({k:self.offering[k] for k in CONTEXT_FIELDS},offering_pk=self.offering['offering_id'],rule_version=raw['rule_version'])
        release=ConversionRelease('SYNTHETIC-release.v1',[raw],[binding])
        return UniversityConversionRelease('SYNTHETIC-release.v1','approved',2027,self.pack.exam_id,self.pack.pack_version,
            'csat',release,(binding,))
    def get_conversion(self,oid):self.calls.append(('conversion',oid));return self.conversion if oid==self.offering['offering_id'] else None
    def get_analysis(self,oid):self.calls.append(('analysis',oid));return self.analysis
    def scores(self):
        scores=score_input();scores['exam_id']=self.pack.exam_id;return scores
    def profile(self):return dict(profile_id='SYNTHETIC-profile',scores=self.scores())


class UniversityScoringServiceTests(unittest.TestCase):
    def setUp(self):self.data=SyntheticScoringData(FrozenClock());self.service=UniversityScoringService(self.data)
    def calculate(self,profile=None):return self.service.calculate(self.data.offering,profile or self.data.profile())
    def test_actual_same_exam_without_any_aggregate_or_analysis(self):
        result=self.calculate();self.assertTrue(result.ready,result)
        self.assertEqual(result.score,Fraction(30));self.assertEqual(result.dto()['score_basis'],'actual_exam')
        self.assertEqual([r[0] for r in self.data.calls],['pack','conversion'])
    def test_internal_result_and_returned_dto_are_isolated(self):
        profile=self.data.profile();before=deepcopy(profile);rule_before=deepcopy(self.data.conversion.release.rules['SYNTHETIC-A-2027'].data)
        result=self.calculate(profile);self.assertEqual(profile,before)
        with self.assertRaises(FrozenInstanceError):result.score=Fraction(99)
        dto=result.dto();dto['table_versions'].append('SYNTHETIC-edit')
        self.assertEqual(result.dto()['table_versions'],[])
        self.assertEqual(self.data.conversion.release.rules['SYNTHETIC-A-2027'].data,rule_before)
        self.assertNotIn('exact_score',dto);self.assertNotIn('values',dto)
    def test_catalog_identity_mismatch_blocks_each_dimension(self):
        for field in ('university_id','campus','department','track','group'):
            with self.subTest(field=field):
                bundle=self.data.release(self.data.raw_rule);bundle.bindings[0][field]='SYNTHETIC-other'
                self.data.conversion=bundle
                self.assertEqual(self.calculate().reason_code,'conversion_context_mismatch')
    def test_offering_pk_year_pack_exam_and_rule_metadata_are_bound(self):
        base=self.data.conversion
        cases=[(replace(base,academic_year=2026),'conversion_year_mismatch'),
            (replace(base,exam_id='SYNTHETIC-other'),'conversion_exam_mismatch'),
            (replace(base,source_pack_version='SYNTHETIC-other'),'conversion_exam_mismatch')]
        for bundle,code in cases:
            self.data.conversion=bundle;self.assertEqual(self.calculate().reason_code,code)
        self.data.conversion=self.data.release(self.data.raw_rule)
        self.data.conversion.release.rules['SYNTHETIC-A-2027'].data['exam_id']='SYNTHETIC-other'
        self.assertEqual(self.calculate().reason_code,'conversion_rule_context_mismatch')
        self.data.conversion=base
        self.assertEqual(self.service.calculate(dict(self.data.offering,academic_year=2026),self.data.profile()).reason_code,'year_bridge_required')
        self.assertEqual(self.service.calculate(dict(self.data.offering,offering_id='SYNTHETIC-missing'),self.data.profile()).reason_code,'conversion_release_missing')
    def test_duplicate_binding_and_unapproved_data_fail_closed(self):
        bundle=self.data.conversion
        self.data.conversion=replace(bundle,bindings=bundle.bindings*2)
        self.assertEqual(self.calculate().reason_code,'RULE_BINDING_AMBIGUOUS')
        self.data.conversion=replace(bundle,status='draft');self.assertEqual(self.calculate().reason_code,'conversion_release_not_approved')
        for kind,status in [('official_rule','source_verified'),('synthetic','calculation_verified')]:
            self.data.conversion=self.data.release(dict(self.data.raw_rule,data_kind=kind,review_status=status))
            self.assertEqual(self.calculate().reason_code,'RULE_NOT_APPROVED')
    def test_mock_requires_exact_approved_compatibility(self):
        raw=deepcopy(self.data.pack._data);raw['exam']['exam_type']='september_mock';self.data.pack=ExamPack(raw)
        self.assertEqual(self.calculate().reason_code,'mock_compatibility_not_approved')
        compat=dict(status='approved',version='SYNTHETIC-compat.v1',source_exam_id=self.data.pack.exam_id,
            source_pack_version=self.data.pack.pack_version,source_exam_type='september_mock',
            rule_exam_id=self.data.conversion.exam_id,rule_pack_version=self.data.conversion.source_pack_version)
        self.data.conversion=replace(self.data.conversion,mock_compatibility=compat)
        self.assertEqual(self.calculate().dto()['score_basis'],'mock_exam');self.assertTrue(self.calculate().ready)
        compat['source_pack_version']='SYNTHETIC-other'
        self.assertEqual(self.calculate().reason_code,'mock_compatibility_not_approved')
    def test_missing_percentile_is_pending_and_not_inferred_from_rank(self):
        raw=dict(self.data.raw_rule,inputs={'inquiry1_percentile':number_input()},nodes={'score':inp('inquiry1_percentile')},output_node='score')
        self.data.conversion=self.data.release(raw)
        self.assertEqual(self.calculate().reason_code,'REQUIRED_INPUT_MISSING')
        profile=self.data.profile();profile['scores']['inquiry'][0]['percentile']=0
        result=self.calculate(profile);self.assertEqual(result.score,0)
        self.assertEqual(dict(result.reported_sources)['inquiry1_percentile'],'student_report')
    def test_verified_mapping_can_fill_missing_input_and_reject_conflict(self):
        raw=deepcopy(self.data.pack._data);ref=raw['subjects']['가상탐구가']['frequencies'][0]['source_ref']
        raw['subjects']['가상탐구가']['reported_scores']={'7':dict(percentile=83,grade=3,source_ref=ref)}
        self.data.pack=ExamPack(raw)
        self.data.conversion=self.data.release(dict(self.data.raw_rule,inputs={'inquiry1_percentile':number_input()},nodes={'score':inp('inquiry1_percentile')},output_node='score'))
        result=self.calculate();self.assertEqual(result.score,83)
        self.assertEqual(dict(result.reported_sources)['inquiry1_percentile'],'verified_exam_mapping')
        profile=self.data.profile();profile['scores']['inquiry'][0]['percentile']=82
        self.assertEqual(self.calculate(profile).reason_code,'reported_percentile_conflict')
        profile=self.data.profile();profile['scores']['math']['grade']=3
        self.assertEqual(self.calculate(profile).reason_code,'reported_grade_conflict')
    def test_optional_reported_values_have_strict_type_range_and_unknown_field_guards(self):
        for area in ('korean','math','inquiry'):
            for field,values in [('percentile',(True,0.5,-1,101,None)),('grade',(True,1.5,0,10,None))]:
                for value in values:
                    profile=self.data.profile();row=profile['scores'][area] if area!='inquiry' else profile['scores'][area][0];row[field]=value
                    with self.subTest(area=area,field=field,value=value):self.assertEqual(self.calculate(profile).reason_code,'invalid_reported_'+field)
        for value in (0,100):
            profile=self.data.profile();profile['scores']['korean']['percentile']=value;self.assertTrue(self.calculate(profile).ready)
        profile=self.data.profile();profile['scores']['math']['research']=True
        self.assertEqual(self.calculate(profile).reason_code,'invalid_request')
    def test_reported_mapping_checks_observed_scores_sources_and_integer_values(self):
        base=deepcopy(self.data.pack._data);ref=base['subjects']['가상탐구가']['frequencies'][0]['source_ref']
        for key,mapped in [('99',dict(percentile=80,source_ref=ref)),('7',dict(percentile=True,source_ref=ref)),
            ('7',dict(percentile=80,source_ref='SYNTHETIC-NOT-REGISTERED:score')),('7',dict(grade=4,source_ref=ref))]:
            raw=deepcopy(base);raw['subjects']['가상탐구가']['reported_scores']={key:mapped}
            with self.subTest(key=key,mapped=mapped),self.assertRaises(ValueError):ExamPack(raw)
    def test_provider_failure_and_pending_table_keep_null_without_private_content(self):
        def failure(oid):raise OSError('SYNTHETIC-private-source-path')
        self.data.get_conversion=failure
        result=self.calculate();self.assertFalse(result.ready);self.assertIsNone(result.converted_score)
        self.assertNotIn('SYNTHETIC-private-source-path',json.dumps(result.dto()))
        self.data.get_conversion=lambda oid:self.data.conversion
        raw=dict(self.data.raw_rule,tables={'pending':dict(lookup_table({'1':0}),status='pending')})
        self.data.conversion=self.data.release(raw)
        self.assertEqual(self.calculate().reason_code,'CONVERSION_TABLE_PENDING')
    def test_unsupported_second_language_is_not_a_zero_or_substitute(self):
        self.data.conversion=self.data.release(dict(self.data.raw_rule,inputs={'second_language_grade':number_input(1,9)},nodes={'score':inp('second_language_grade')},output_node='score'))
        self.assertEqual(self.calculate().reason_code,'unsupported_conversion_input')
    def test_normalized_inquiry_names_select_subject_specific_tables_then_rank(self):
        tables={'first':lookup_table({'80':17}), 'second':lookup_table({'60':31})}
        for table in tables.values():table.update(exam_id=self.data.pack.exam_id,source_pack_version=self.data.pack.pack_version)
        raw=dict(self.data.raw_rule,inputs={'inquiry1_subject':dict(type='text'),'inquiry1_percentile':number_input(),'inquiry2_percentile':number_input()},tables=tables,
            nodes={'score':{'op':'if','condition':{'op':'eq','left':inp('inquiry1_subject'),'right':const('가상탐구가')},
              'then':{'op':'rank_weighted','args':[{'op':'lookup','table':'first','key':inp('inquiry1_percentile')},{'op':'lookup','table':'second','key':inp('inquiry2_percentile')}],'weights':[1]},'else':const(0)}},output_node='score')
        self.data.conversion=self.data.release(raw)
        profile=self.data.profile();profile['scores']['inquiry'][0].update(subject='가상 탐구가',percentile=80);profile['scores']['inquiry'][1]['percentile']=60
        before=deepcopy(profile);self.assertEqual(self.calculate(profile).score,31);self.assertEqual(profile,before)
        self.data.conversion.release.rules['SYNTHETIC-A-2027'].data['tables']['first']['exam_id']='SYNTHETIC-other'
        self.assertEqual(self.calculate(profile).reason_code,'conversion_rule_context_mismatch')
    def test_exact_value_drives_curve_and_decision_while_display_is_rounded(self):
        raw=dict(self.data.raw_rule,inputs={},nodes={'score':const('1.234')},output_node='score')
        self.data.conversion=self.data.release(raw);conversion=self.calculate()
        bundle=self.data.bundles['SYNTHETIC-A-2027'];bundle=replace(bundle,source_pack_version=self.data.pack.pack_version,release=self.data.conversion.release,bridges={})
        metadata=deepcopy(bundle.curves[2027].metadata);metadata.update(exam_id=self.data.pack.exam_id,score_min='1.231',score_max='1.235')
        curve=UniversityScoreDistribution(dict(format='jungsi.university-score-distribution/v1',metadata=metadata,source_refs=['SYNTHETIC'],
            frequencies=[dict(converted_score='1.231',weight=5),dict(converted_score='1.235',weight=4)]))
        bundle.curves[2027]=curve
        decision=bundle.decisions[2027];decision['context'].update(exam_id=self.data.pack.exam_id)
        decision['evidence']['context']=deepcopy(decision['context'])
        decision['ranges']=[dict(lower=0,upper='1.232',category='challenge'),dict(lower='1.232',upper=2,category='core')]
        overall=dict(exam=dict(academic_year=2027),overall=dict(status='pending',reason_code='total_model_missing',model_version=None))
        result=evaluate_offering(self.data.offering,self.data.profile(),overall,bundle,conversion=conversion)
        self.assertEqual(result['status'],'ready',result);self.assertEqual(result['converted_score'],'1.23')
        self.assertEqual(result['category'],'core');self.assertEqual(result['converted_percentile'],'44.444444')
        self.assertNotIn('exact_score',json.dumps(result))


class UniversityScoringHttpTests(unittest.TestCase):
    request=workflows.BackendWorkflowTests.request
    report=workflows.BackendWorkflowTests.report
    def setUp(self):
        workflows.BackendWorkflowTests.setUp(self)
        data=SyntheticScoringData(self.clock);self.data=data
        self.app.state.platform.data=data;self.app.state.platform.overall._data=data;self.app.state.platform.scoring.data=data
    def analyze(self,record,key=None):
        return self.request('POST',f"/api/v1/reports/{record['report_id']}/university-results",
            dict(expected_version=record['report_version'],offering_ids=['SYNTHETIC-A-2027']),key=key)
    def test_actual_conversion_survives_missing_or_malformed_analysis_and_no_total(self):
        for failure in (None,ValueError('SYNTHETIC-private'),PlatformError('drive_hash_mismatch',503)):
            def supply(oid):
                if failure:raise failure
                return None
            self.data.get_analysis=supply
            record=self.report(scores=self.data.scores());self.assertEqual(record['overall']['overall']['status'],'pending')
            response=self.analyze(record);self.assertEqual(response.status_code,200,response.text)
            assessment=response.json()['analyses']['SYNTHETIC-A-2027']
            self.assertEqual(assessment['conversion']['status'],'ready');self.assertEqual(assessment['converted_score'],'30.00')
            self.assertEqual(assessment['status'],'pending');self.assertEqual(assessment['conversion']['score_basis'],'actual_exam')
            self.assertNotIn('SYNTHETIC-private',response.text);self.assertNotIn('exact_score',response.text)
    def test_authorization_revision_and_idempotency_apply_to_conversion(self):
        record=self.report(scores=self.data.scores());path=f"/api/v1/reports/{record['report_id']}/university-results"
        calls=len(self.data.calls)
        for owner,status in ((self.standard,403),(self.other,404)):
            result=self.request('POST',path,dict(expected_version=record['report_version'],offering_ids=['SYNTHETIC-A-2027']),owner=owner)
            self.assertEqual(result.status_code,status)
        self.assertEqual(len(self.data.calls),calls)
        first=self.analyze(record,key='SYNTHETIC-replay');replayed=self.analyze(record,key='SYNTHETIC-replay')
        self.assertEqual(first.json(),replayed.json());self.assertEqual(first.json()['report_version'],2)
        self.assertEqual(self.analyze(record).status_code,409)
        self.repo.entitlements[self.owner]['active']=False
        read=self.request('GET',f"/api/v1/reports/{record['report_id']}");self.assertEqual(read.status_code,200)
        self.assertNotIn('analyses',read.json());self.assertNotIn('conversion',read.text)
        self.assertEqual(self.analyze(record,key='SYNTHETIC-replay').status_code,403)
    def test_unconfirmed_profile_blocks_before_rule_supply(self):
        record=self.report(scores=self.data.scores(),confirmed=False);calls=len(self.data.calls)
        self.assertEqual(self.analyze(record).status_code,409);self.assertEqual(len(self.data.calls),calls)
    def test_malformed_total_supply_preserves_profile_and_independent_conversion(self):
        def failure(*args):raise KeyError('SYNTHETIC-private-model-key')
        self.data.get_total_model=failure
        record=self.report(scores=self.data.scores())
        self.assertEqual(record['overall']['overall']['reason_code'],'total_model_invalid')
        response=self.analyze(record)
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(response.json()['analyses']['SYNTHETIC-A-2027']['conversion']['status'],'ready')
        self.assertNotIn('SYNTHETIC-private-model-key',response.text)
    def test_profile_mapping_conflict_rejected_and_valid_optional_value_persisted(self):
        scores=self.data.scores();scores['korean']['grade']=1;scores['inquiry'][0]['percentile']=100
        record=self.report(scores=scores)
        stored=self.repo.profiles[record['profile_id']]['scores'];self.assertEqual(stored,scores)
        scores['korean']['grade']=2
        result=self.request('POST','/api/v1/score-profiles',dict(scores=scores,confirmed=True))
        self.assertEqual(result.status_code,422);self.assertEqual(result.json()['error']['code'],'reported_grade_conflict')
    def test_candidates_share_conversion_and_do_not_turn_it_into_a_decision(self):
        record=self.report(scores=self.data.scores())
        response=self.request('POST',f"/api/v1/reports/{record['report_id']}/candidates",dict(expected_version=record['report_version']))
        self.assertEqual(response.status_code,200,response.text)
        assessment=response.json()['analyses']['SYNTHETIC-A-2027']
        self.assertEqual(assessment['conversion']['status'],'ready');self.assertEqual(assessment['category'],'pending')


class ConversionDriveContractTests(unittest.TestCase):
    def test_conversion_artifact_uses_approved_pinned_loader_without_analysis_parse(self):
        data=SyntheticScoringData(FrozenClock());binding=data.conversion.bindings[0]
        raw=dict(format='jungsi.university-conversion-release/v1',version=data.conversion.version,status='approved',academic_year=2027,
            exam_id=data.pack.exam_id,source_pack_version=data.pack.pack_version,exam_type='csat',release_id='SYNTHETIC-release.v1',
            rules=[data.conversion.release.rules[binding['rule_version']].data],bindings=[binding])
        calls=[]
        class Client:
            def artifact(self,entry):calls.append(entry);return deepcopy(raw),{}
        entry=dict(kind='conversion',key=data.offering['offering_id'],sha256='a'*64,version=raw['version'],status='approved')
        provider=DriveDataProvider(Client(),dict(format='jungsi.data-registry/v1',entries=[entry]))
        bundle=provider.get_conversion(data.offering['offering_id']);self.assertIsInstance(bundle,UniversityConversionRelease)
        self.assertEqual(len(calls),1);self.assertEqual(calls[0]['kind'],'conversion')
        entry['status']='draft'
        with self.assertRaises(PlatformError) as caught:provider.get_conversion(data.offering['offering_id'])
        self.assertEqual(caught.exception.code,'artifact_not_approved')
    def test_wrong_payload_version_and_duplicate_rule_bindings_fail(self):
        data=SyntheticScoringData(FrozenClock());binding=data.conversion.bindings[0]
        raw=dict(format='jungsi.university-conversion-release/v1',version='SYNTHETIC-other',status='approved',academic_year=2027,
            exam_id=data.pack.exam_id,source_pack_version=data.pack.pack_version,exam_type='csat',release_id='SYNTHETIC-release.v1',
            rules=[data.conversion.release.rules[binding['rule_version']].data],bindings=[binding,binding])
        class Client:
            def artifact(self,entry):return deepcopy(raw),{}
        entry=dict(kind='conversion',key=data.offering['offering_id'],sha256='a'*64,version='SYNTHETIC-release.v1',status='approved')
        provider=DriveDataProvider(Client(),dict(format='jungsi.data-registry/v1',entries=[entry]))
        with self.assertRaises(PlatformError) as caught:provider.get_conversion(data.offering['offering_id'])
        self.assertEqual(caught.exception.code,'artifact_version_mismatch')
        raw['version']=entry['version']
        with self.assertRaises(PlatformError) as caught:provider.get_conversion(data.offering['offering_id'])
        self.assertEqual(caught.exception.code,'conversion_release_invalid')


if __name__=='__main__':unittest.main()
