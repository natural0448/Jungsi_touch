import unittest
from copy import deepcopy
from types import SimpleNamespace
from jungsi_touch.infrastructure.forecast_inputs import DriveForecastInputProvider
from jungsi_touch.application.platform_ports import PlatformError

class Data:
    def __init__(self):
        self.context=dict(offering_id='SYNTHETIC-O',academic_year=2027,university_id='SYNTHETIC-U',campus='SYNTHETIC-campus',department='SYNTHETIC-dept',track='SYNTHETIC-track',group='가',catalog_version='SYNTHETIC-catalog',exam_id='SYNTHETIC-exam',source_pack_version='SYNTHETIC-pack',rule_version='SYNTHETIC-rule',curve_version='SYNTHETIC-curve',population_id='SYNTHETIC-pop',rule_id='SYNTHETIC-rule-id',score_scope='csat_component',score_scale_id='SYNTHETIC-scale',bonus_treatment='included')
        self.catalog=SimpleNamespace(status='approved',version='SYNTHETIC-catalog',offerings=[deepcopy(self.context)])
        self.conversion=SimpleNamespace(status='approved',exam_id='SYNTHETIC-exam',source_pack_version='SYNTHETIC-pack',release=SimpleNamespace(bindings={(2027,'SYNTHETIC-O'):'SYNTHETIC-rule'}))
        self.percentile=SimpleNamespace(status='approved',rule_version='SYNTHETIC-rule',curve=SimpleNamespace(metadata=deepcopy(self.context)))
    def load(self,kind,key):return dict(context=deepcopy(self.context)),{}
    def get_catalog(self):return self.catalog
    def get_conversion(self,oid):return self.conversion
    def get_percentile(self,oid):return self.percentile

class ForecastInputAdapterTests(unittest.TestCase):
    def test_context_is_checked_against_live_catalog_rule_and_curve(self):
        data=Data();provider=DriveForecastInputProvider(data)
        self.assertEqual(provider.current_context('SYNTHETIC-O'),data.context)
        for mutate in (lambda d:setattr(d.catalog,'version','NEW'),lambda d:d.conversion.release.bindings.update({(2027,'SYNTHETIC-O'):'NEW'}),lambda d:d.percentile.curve.metadata.update(curve_version='NEW'),lambda d:d.catalog.offerings[0].update(campus='OTHER')):
            data=Data();mutate(data)
            with self.assertRaises(PlatformError) as error:DriveForecastInputProvider(data).current_context('SYNTHETIC-O')
            self.assertEqual(error.exception.http_status,409)
    def test_pending_execution_source_blocks_adoption(self):
        data=Data();data.percentile.status='draft'
        with self.assertRaises(PlatformError) as error:DriveForecastInputProvider(data).current_context('SYNTHETIC-O')
        self.assertEqual(error.exception.code,'forecast_execution_sources_pending')
