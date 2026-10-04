"""Invented subset receipts; they simulate server guard branches only."""
from copy import deepcopy
from dataclasses import replace
from pathlib import Path
import sys
import unittest
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'src'))
from backend_synthetic_fixture import FrozenClock
from test_university_percentile_service import SyntheticPercentileData
from jungsi_touch.application.university_scoring import UniversityScoringService
from jungsi_touch.application.university_percentile import UniversityPercentileService
from jungsi_touch.estimated_profiles import digest
from jungsi_touch.admission_result_percentile import UniversityScoreDistribution
from jungsi_touch.percentile import POPULATION_ID


class ComparisonPopulationTests(unittest.TestCase):
    def setUp(self):
        self.data=SyntheticPercentileData(FrozenClock())
        self.scoring=UniversityScoringService(self.data);self.service=UniversityPercentileService(self.data)
        self.conversion=self.scoring.calculate(self.data.offering,self.data.profile())
        raw=deepcopy(self.data.percentile.curve.data);raw['metadata']['population_id']='SYNTHETIC-required-present'
        curve=UniversityScoreDistribution(raw);m=curve.metadata
        expected={k:m[k] for k in ('population_id','academic_year','exam_id','source_pack_version','rule_version','curve_version')}
        self.population=dict(expected,format='jungsi.university-comparison-population/v1',status='approved',
            scope='required_rule_inputs_present',base_population_id=POPULATION_ID,
            required_input_fields=list(self.conversion.required_input_fields),validation_receipt_version='SYNTHETIC-validation.v1')
        missing=self.conversion.required_input_fields[0]
        self.receipt=dict(expected,format='jungsi.estimate-release-receipt/v1',status='approved',version='SYNTHETIC-validation.v1',
            source_model_version=m['source_model_version'],required_input_fields=list(self.conversion.required_input_fields),
            curve_sha256=digest(raw),validation_status='self_validated_estimate',validation_checks={'SYNTHETIC-model':True},
            checks={k:True for k in ('model_validation','filter_complete','rule_replay','serialization')},
            population_ledger=dict(total_complete_weight=10,retained_weight=9,excluded_weight=1,
                exclusions=[dict(missing_input_fields=[missing],weight=1)]))
        self.original=replace(self.data.percentile,curve=curve,comparison_population=self.population,validation_receipt=self.receipt)
        self.data.percentile=deepcopy(self.original)
    def result(self):return self.service.calculate(self.data.offering,self.conversion)
    def test_approved_required_input_subset_can_be_displayed_independently(self):
        result=self.result();self.assertTrue(result.ready,result)
        self.assertEqual(result.dto()['population_scope'],'required_rule_inputs_present')
        self.assertEqual(result.dto()['population_id'],'SYNTHETIC-required-present')
        for key in ('required_input_fields','population_ledger','validation_checks','curve_sha256'):self.assertNotIn(key,result.dto())
    def test_legacy_global_population_keeps_whole_complete_scope(self):
        self.data=SyntheticPercentileData(FrozenClock());self.scoring.data=self.data;self.service.data=self.data
        self.conversion=self.scoring.calculate(self.data.offering,self.data.profile())
        self.assertEqual(self.result().dto()['population_scope'],'whole_complete')
    def test_subset_id_or_approval_flag_alone_cannot_bypass_receipt(self):
        for field in ('comparison_population','validation_receipt'):
            self.data.percentile=replace(self.original,**{field:None})
            with self.subTest(field=field):self.assertFalse(self.result().ready)
        self.data.percentile=deepcopy(self.original);self.data.percentile.validation_receipt['status']='research'
        self.assertEqual(self.result().reason_code,'percentile_population_receipt_mismatch')
    def test_receipt_binds_exam_pack_model_rule_curve_inputs_and_actual_curve_hash(self):
        for field in ('exam_id','source_pack_version','rule_version','curve_version','population_id','source_model_version','curve_sha256'):
            self.data.percentile=deepcopy(self.original);self.data.percentile.validation_receipt[field]='SYNTHETIC-other'
            with self.subTest(field=field):self.assertFalse(self.result().ready)
        self.data.percentile=deepcopy(self.original);self.data.percentile.comparison_population['required_input_fields']=[]
        self.assertEqual(self.result().reason_code,'percentile_population_context_mismatch')
    def test_weight_ledger_and_exclusion_reason_are_checked_exactly(self):
        for field,value in [('total_complete_weight',11),('retained_weight',8),('excluded_weight',0),('exclusions',[]),
            ('exclusions',[dict(weight=1,missing_input_fields=['SYNTHETIC-irrelevant'])])]:
            self.data.percentile=deepcopy(self.original);self.data.percentile.validation_receipt['population_ledger'][field]=value
            with self.subTest(field=field,value=value):self.assertFalse(self.result().ready)
    def test_failed_model_or_rule_replay_or_partial_filter_cannot_be_ready(self):
        for field in ('model_validation','filter_complete','rule_replay','serialization'):
            self.data.percentile=deepcopy(self.original);self.data.percentile.validation_receipt['checks'][field]=False
            with self.subTest(field=field):self.assertEqual(self.result().reason_code,'percentile_population_unverified')
        self.data.percentile=deepcopy(self.original);self.data.percentile.validation_receipt['validation_checks']['SYNTHETIC-model']=False
        self.assertFalse(self.result().ready)
    def test_actual_conversion_required_fields_are_immutable_and_not_public(self):
        self.assertEqual(self.conversion.required_input_fields,tuple(sorted(self.data.raw_rule['inputs'])))
        self.assertNotIn('required_input_fields',self.conversion.dto())
        self.data.percentile=deepcopy(self.original)
        self.conversion=replace(self.conversion,required_input_fields=('SYNTHETIC-other',))
        self.assertFalse(self.result().ready)


if __name__=='__main__':unittest.main()
