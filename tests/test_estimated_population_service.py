"""Private ports/workflow with invented data. No file deletion in these tests."""
from copy import deepcopy
from dataclasses import replace
from pathlib import Path
import json
import sys
import unittest
from uuid import uuid4
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'src'))
from test_overall_analysis_service import synthetic_pack
from test_estimated_profiles import synthetic_scenario
from test_estimated_validation import synthetic_validation_policy,synthetic_validation_reference
from test_estimated_curves import synthetic_curve_metadata,synthetic_executable_rule
from jungsi_touch.application.estimated_population import EstimationInputs,EstimatedPopulationService
from jungsi_touch.infrastructure.private_estimation import PrivateJsonEstimationStore,PrivateJsonEstimationInputs,bytes_json
from jungsi_touch.estimated_profiles import EstimationError,digest
from jungsi_touch.exam_pack import ExamPack
from hashlib import sha256


class MemoryStore:
    def __init__(self):self.records={};self.order=[]
    def begin(self,run_id,manifest):self.append(run_id,'frozen_inputs.json',manifest)
    def append(self,run_id,name,payload):
        key=(run_id,name)
        if key in self.records:raise FileExistsError(name)
        self.records[key]=deepcopy(payload);self.order.append(key)
        return dict(name=name,sha256=sha256(bytes_json(payload)).hexdigest())


class Inputs:
    def __init__(self):
        raw=deepcopy(synthetic_pack()._data);raw['exam']['exam_type']='csat';pack=ExamPack(raw)
        first=synthetic_scenario(pack);second=deepcopy(first);second.update(version='SYNTHETIC-proposal.v2',seed=first['seed']+1)
        self.value=EstimationInputs(raw,synthetic_validation_policy(pack),(first,second),9,synthetic_curve_metadata(),
            synthetic_validation_reference(pack),universities=({'rule':synthetic_executable_rule(pack).data,
                'metadata':dict(synthetic_curve_metadata(),validation_scores=['1.234']), 'bindings':[]},))
    def get_estimation_inputs(self,version):return self.value


class EstimatedPopulationServiceTests(unittest.TestCase):
    def setUp(self):self.inputs=Inputs();self.store=MemoryStore();self.service=EstimatedPopulationService(self.inputs,self.store)
    def test_policy_is_saved_before_generation_and_same_inputs_are_reproducible(self):
        before=deepcopy(self.inputs.value)
        first=self.service.run('SYNTHETIC-input','SYNTHETIC-run','0'*40)
        second=self.service.run('SYNTHETIC-input','SYNTHETIC-repeat','0'*40)
        self.assertEqual(self.store.order[0],('SYNTHETIC-run','frozen_inputs.json'))
        self.assertEqual(first['receipt']['artifacts'],second['receipt']['artifacts'])
        self.assertEqual(self.inputs.value,before);self.assertEqual(first['receipt']['status'],'self_validated_estimate')
        self.assertEqual(first['total']['distribution']['metadata']['status'],'reference')
        self.assertEqual(first['curves'][0]['curve']['metadata']['status'],'research')
        self.assertEqual(first['receipt']['publication_status'],'not_adopted')
        self.assertTrue(first['receipt']['validation']['serialized_validation']['passed'])
    def test_failed_validation_stays_research_and_stores_measurements(self):
        value=self.inputs.value;r=deepcopy(value.reference);r['points'][0]['top_fraction']='0.2'
        self.inputs.value=replace(value,reference=r)
        result=self.service.run('SYNTHETIC-input','SYNTHETIC-failed','0'*40)
        self.assertEqual(result['receipt']['status'],'research_only')
        self.assertEqual(result['receipt']['validation']['metrics']['withheld_max_error_pp'],80)
        self.assertIn(('SYNTHETIC-failed','receipt.json'),self.store.records)
    def test_failed_fit_is_retained_and_policy_is_not_overwritten(self):
        value=self.inputs.value;policy=deepcopy(value.policy);policy['optimization']['max_iterations']=1
        self.inputs.value=replace(value,policy=policy)
        result=self.service.run('SYNTHETIC-input','SYNTHETIC-short','0'*40)
        self.assertEqual(result['receipt']['status'],'research_only')
        self.assertFalse(self.store.records[('SYNTHETIC-short','SYNTHETIC-proposal.v1.fit.json')]['fit']['converged'])
        with self.assertRaises(FileExistsError):self.service.run('SYNTHETIC-input','SYNTHETIC-short','0'*40)
    def test_invalid_rule_failure_leaves_original_candidates_fit_and_failure(self):
        value=self.inputs.value;universities=deepcopy(value.universities);universities[0]['rule']['review_status']='source_verified'
        self.inputs.value=replace(value,universities=universities)
        with self.assertRaises(EstimationError):self.service.run('SYNTHETIC-input','SYNTHETIC-rule-fail','0'*40)
        names=[name for run,name in self.store.records]
        self.assertIn('frozen_inputs.json',names);self.assertIn('SYNTHETIC-proposal.v1.fit.json',names);self.assertIn('failure.json',names)
    def test_new_reference_exclusion_scenario_is_rerun_without_changed_tolerances(self):
        value=self.inputs.value;scenarios=list(deepcopy(value.scenarios));other=deepcopy(scenarios[0])
        other.update(version='SYNTHETIC-reference-excluded',reference_mode='excluded');scenarios.append(other)
        self.inputs.value=replace(value,scenarios=tuple(scenarios))
        result=self.service.run('SYNTHETIC-input','SYNTHETIC-excluded','0'*40)
        fit=self.store.records[('SYNTHETIC-excluded','SYNTHETIC-reference-excluded.fit.json')]['fit']
        self.assertEqual(fit['training_point_ids'],[]);self.assertEqual(fit['policy_hash'],digest(value.policy))
        self.assertIn('reference_exclusion',result['receipt']['validation']['sensitivity'][-1]['dimensions'])
    def test_private_files_are_exclusive_and_input_hashes_are_pinned(self):
        root=ROOT/'outputs'/'synthetic_dev005_tests'/uuid4().hex
        store=PrivateJsonEstimationStore(root);store.begin('SYNTHETIC-run',{'SYNTHETIC':True})
        store.append('SYNTHETIC-run','SYNTHETIC.json',{'value':0})
        with self.assertRaises(FileExistsError):store.append('SYNTHETIC-run','SYNTHETIC.json',{'value':1})
        path=root/'SYNTHETIC-input.json';raw=bytes_json(self.inputs.value.pack);path.write_bytes(raw)
        manifest=root/'SYNTHETIC-manifest.json'
        manifest.write_text(json.dumps(dict(format='jungsi.estimate-inputs/v1',version='SYNTHETIC-v1',
            artifacts={'pack':{'path':path.name,'sha256':'0'*64}})),encoding='utf-8')
        with self.assertRaises(EstimationError):PrivateJsonEstimationInputs(manifest).get_estimation_inputs('SYNTHETIC-v1')
        with self.assertRaises(EstimationError):PrivateJsonEstimationStore(ROOT/'src'/'SYNTHETIC')
        self.assertEqual(json.loads((root/'SYNTHETIC-run'/'SYNTHETIC.json').read_text())['value'],0)

    def test_private_ancestor_does_not_authorize_shared_paths_in_nested_checkout(self):
        root=ROOT/'outputs'/'synthetic_dev005_tests'/uuid4().hex/'workspace'
        (root/'docs/current').mkdir(parents=True,exist_ok=False)
        with (root/'AGENTS.md').open('x',encoding='utf-8') as handle:handle.write('SYNTHETIC checkout')
        with (root/'docs/current/service_spec.json').open('x',encoding='utf-8') as handle:handle.write('{}')
        for shared in ('src','docs','apps','database'):
            with self.subTest(shared=shared),self.assertRaises(EstimationError):
                PrivateJsonEstimationStore(root/shared/'SYNTHETIC')
        self.assertEqual(PrivateJsonEstimationStore(root/'OuTpUtS'/'SYNTHETIC').root,
            (root/'OuTpUtS'/'SYNTHETIC').resolve())



class EstimatedReleaseServiceTests(unittest.TestCase):
    def setUp(self):
        from jungsi_touch.application.estimated_population import EstimatedReleaseService
        self.inputs=Inputs();value=self.inputs.value;universities=deepcopy(value.universities)
        rule=universities[0]['rule'];universities[0]['bindings']=[dict(academic_year=2027,university_id='SYNTHETIC-U',
            campus='SYNTHETIC-C',department='SYNTHETIC-D',track='SYNTHETIC-T',group='SYNTHETIC-G',
            offering_pk='SYNTHETIC-offering',rule_version=rule['rule_version'])]
        self.inputs.value=replace(value,universities=universities)
        self.store=MemoryStore();self.result=EstimatedPopulationService(self.inputs,self.store).run('SYNTHETIC-input','SYNTHETIC-run','0'*40)
        self.approval=dict(status='approved',run_id='SYNTHETIC-run',release_version='SYNTHETIC-adopted',
            run_receipt_hash=digest(self.result['receipt']),code_sha='0'*40,exam_type='csat',rule_reviews={
                rule['rule_version']:dict(curve_hash=digest(self.result['curves'][0]['curve']),
                    candidate_hash=self.result['receipt']['candidate_hash'],weights_hash=self.result['receipt']['weights_hash'],
                    independent_replay_passed=True,independent_cases=3,new_curve_version='SYNTHETIC-adopted-curve')})
        outer=self
        class Approvals:
            def get_estimate_approval(self,run_id):return outer.approval
        self.service=EstimatedReleaseService(Approvals(),self.store)
    def adopt(self):return self.service.adopt('SYNTHETIC-run',self.result,'SYNTHETIC-adopted')
    def test_new_release_retains_original_research_and_requires_bound_replay(self):
        before=deepcopy(self.result);result=self.adopt()
        self.assertEqual(self.result,before);self.assertEqual(result['total']['distribution']['metadata']['status'],'approved')
        self.assertEqual(result['percentile_releases'][0]['curve']['metadata']['status'],'approved')
        self.assertNotEqual(result['percentile_releases'][0]['curve']['metadata']['curve_version'],
            self.result['curves'][0]['curve']['metadata']['curve_version'])
    def test_absent_server_approval_or_other_code_cannot_promote(self):
        for field,value in [('status','research'),('code_sha','1'*40),('run_receipt_hash','1'*64)]:
            original=deepcopy(self.approval);self.approval[field]=value
            with self.subTest(field=field),self.assertRaises(EstimationError):self.adopt()
            self.approval=original
    def test_failed_scientific_validation_even_with_server_flag_is_rejected(self):
        self.result['receipt']['validation']['checks']['SYNTHETIC-failure']=False
        self.result['receipt']['validation']['adoption_checks']['SYNTHETIC-failure']=False
        self.approval['run_receipt_hash']=digest(self.result['receipt'])
        with self.assertRaises(EstimationError) as caught:self.adopt()
        self.assertEqual(caught.exception.code,'estimate_validation_failed')
    def test_modified_output_cannot_reuse_old_validation_receipt(self):
        self.result['total']['distribution']['metadata']['source_name']='SYNTHETIC-tamper'
        with self.assertRaises(EstimationError) as caught:self.adopt()
        self.assertEqual(caught.exception.code,'estimate_output_hash_mismatch')
    def test_independent_rule_proof_is_required_and_failed_version_is_preserved(self):
        review=next(iter(self.approval['rule_reviews'].values()));review['independent_replay_passed']=False
        with self.assertRaises(EstimationError) as caught:self.adopt()
        self.assertEqual(caught.exception.code,'estimate_rule_replay_unverified')
        self.assertIn(('SYNTHETIC-adopted','failure.json'),self.store.records)

if __name__=='__main__':unittest.main()
