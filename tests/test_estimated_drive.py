"""Invented pinned transport for new envelopes; no cloud write or actual data."""
from copy import deepcopy
from pathlib import Path
import sys,unittest
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'src'))
import test_comparison_population as comparison
import test_estimated_curves as curves
from jungsi_touch.estimated_curves import build_total_model
from jungsi_touch.infrastructure.drive_provider import DriveDataProvider
from jungsi_touch.application.university_percentile import UniversityPercentileService
from jungsi_touch.application.platform_ports import PlatformError


class EstimatedDriveTests(unittest.TestCase):
    def test_subset_receipt_requires_second_approved_pinned_registry_entry(self):
        fixture=comparison.ComparisonPopulationTests();fixture.setUp();bundle=fixture.original
        raw=dict(format='jungsi.university-percentile-release/v1',version=bundle.version,status='approved',release_id=bundle.release_id,
            academic_year=bundle.academic_year,exam_id=bundle.exam_id,source_pack_version=bundle.source_pack_version,
            exam_type=bundle.exam_type,rule_version=bundle.rule_version,curve=bundle.curve.data,
            bindings=list(bundle.bindings),comparison_population=fixture.population,
            validation_receipt={'status':'approved'}) # inline shortcut must be ignored
        calls=[]
        class Client:
            def artifact(self,entry):
                calls.append(entry['kind'])
                return deepcopy(fixture.receipt if entry['kind']=='estimate_receipt' else raw),{}
        entries=[dict(kind='percentile',key=fixture.data.offering['offering_id'],version=raw['version'],status='approved',sha256='a'*64)]
        def provider():return DriveDataProvider(Client(),dict(format='jungsi.data-registry/v1',entries=entries))
        with self.assertRaises(PlatformError) as caught:provider().get_percentile(fixture.data.offering['offering_id'])
        self.assertEqual(caught.exception.code,'percentile_population_receipt_missing')
        entries.append(dict(kind='estimate_receipt',key=fixture.receipt['version'],version=fixture.receipt['version'],status='approved',sha256='b'*64))
        data=provider();result=UniversityPercentileService(data).calculate(fixture.data.offering,fixture.conversion)
        self.assertTrue(result.ready,result);self.assertIn('estimate_receipt',calls)
        entries[-1]['status']='research'
        result=UniversityPercentileService(provider()).calculate(fixture.data.offering,fixture.conversion)
        self.assertFalse(result.ready)
    def test_new_nested_total_model_keeps_pack_version_and_distribution_id_binding(self):
        fixture=curves.EstimatedCurvesTests();pack,p,info,w,v=fixture.prepare()
        raw,_=build_total_model(pack,p,w,info,v,curves.synthetic_curve_metadata())
        class Client:
            def artifact(self,entry):return deepcopy(raw),{}
        entry=dict(kind='total_model',key=pack.exam_id+':'+pack.pack_version,version=pack.pack_version,status='approved',
            distribution_id=raw['distribution']['metadata']['distribution_id'],sha256='a'*64)
        provider=DriveDataProvider(Client(),dict(format='jungsi.data-registry/v1',entries=[entry]))
        binding=provider.get_total_model(pack.exam_id,pack.pack_version)
        self.assertEqual(binding.model.distribution.metadata.expected_total_weight,9)
        self.assertEqual(binding.model.distribution.metadata.status,'reference') # provider does not approve body
        entry['version']='SYNTHETIC-other'
        with self.assertRaises(PlatformError):provider.get_total_model(pack.exam_id,pack.pack_version)


if __name__=='__main__':unittest.main()
