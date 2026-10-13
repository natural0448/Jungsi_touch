"""Synthetic batch publication scope, exact validation and no SQL N+1."""
from contextlib import contextmanager
from copy import deepcopy
from datetime import timedelta
import unittest

from backend_synthetic_fixture import FrozenClock
from forecast_synthetic_fixture import fixture
from jungsi_touch.application.authorization import Actor
from jungsi_touch.application.forecast_policy import ForecastPolicyService
from jungsi_touch.application.platform_ports import PlatformError
from jungsi_touch.infrastructure.memory_forecast_repository import MemoryForecastRepository
from jungsi_touch.infrastructure.postgres_forecast_repository import PUBLISHED_MANY_SQL, PostgresForecastRepository
from jungsi_touch.forecasting import digest


OFFERINGS=('SYNTHETIC-O','SYNTHETIC-O2')


class BatchInputs:
    def __init__(self):
        self.values={}
        for offering in OFFERINGS:
            data,policy=fixture(False)
            data['context']['offering_id']=offering;policy['context']['offering_id']=offering
            self.values[offering]=(data,policy)
    def inputs(self,offering,input_id,version):return deepcopy(self.values[offering][0])
    def policy(self,policy_id,version):return deepcopy(self.values[policy_id.removeprefix('policy-')][1])
    def current_context(self,offering):return deepcopy(self.values[offering][0]['context'])


class CountedMemory(MemoryForecastRepository):
    def __init__(self):
        super().__init__({'SYNTHETIC-editor':dict(edit=True,approve=True,university_ids=['SYNTHETIC-U'])})
        self.batch_calls=[];self.single_calls=[]
    def published(self,offering):self.single_calls.append(offering);return super().published(offering)
    def published_many(self,offerings):self.batch_calls.append(tuple(offerings));return super().published_many(offerings)


class BatchValidationTests(unittest.TestCase):
    def setUp(self):
        self.clock=FrozenClock();self.inputs=BatchInputs();self.store=CountedMemory()
        self.service=ForecastPolicyService(self.store,self.inputs,self.clock)
        self.actor=Actor('SYNTHETIC-editor',True,'aal2','active');self.key=0
        for offering in OFFERINGS:self.publish(offering)
    def call(self,operation,body,params):
        self.key+=1
        return self.service.execute(operation,self.actor,body=body,params=params,key='SYNTHETIC-batch-'+str(self.key))
    def publish(self,offering):
        record=self.call('forecast.create',dict(input_id='input-'+offering,input_version='SYNTHETIC-input',
            policy_id='policy-'+offering,policy_version='SYNTHETIC-policy'),dict(offering_id=offering))
        for operation,extra in [('forecast.validate',{}),('forecast.approve',{'reason':'합성 검수'}),('forecast.publish',{})]:
            body=dict(expected_revision=record['revision'],base_result_hash=record['base_result_hash'],policy_version=record['policy_version'],**extra)
            if operation=='forecast.approve':body['validation_receipt_hash']=record['validation']['receipt_hash']
            if operation=='forecast.publish':body['approval_receipt_hash']=record['approval']['approval_hash']
            record=self.call(operation,body,dict(draft_id=record['draft_id']))
    def repin(self,release):
        release.pop('release_hash',None);release['release_hash']=digest(release)

    def test_two_offerings_and_missing_keep_their_own_validated_identity_in_one_batch(self):
        values=self.service.validated_releases([*OFFERINGS,'SYNTHETIC-missing'])
        self.assertEqual(self.store.batch_calls,[(*OFFERINGS,'SYNTHETIC-missing')])
        self.assertEqual(self.store.single_calls,[])
        self.assertIsNone(values['SYNTHETIC-missing'])
        self.assertEqual([values[offering]['context']['offering_id'] for offering in OFFERINGS],list(OFFERINGS))
        for offering in OFFERINGS:self.assertEqual(values[offering],self.service.validated_release(offering))

    def test_one_tampered_release_is_pending_without_discarding_its_valid_sibling(self):
        release=next(r for r in self.store.releases.values() if r['context']['offering_id']==OFFERINGS[0])
        release['result']['forecast_70']['value']='SYNTHETIC-tampered'
        values=self.service.validated_releases(OFFERINGS)
        self.assertIsInstance(values[OFFERINGS[0]],PlatformError)
        self.assertEqual(values[OFFERINGS[0]].code,'forecast_release_invalid')
        self.assertEqual(values[OFFERINGS[1]]['context']['offering_id'],OFFERINGS[1])

    def test_rehashed_but_drifted_context_still_fails_the_existing_proof(self):
        release=next(r for r in self.store.releases.values() if r['context']['offering_id']==OFFERINGS[0])
        release['context']['catalog_version']='SYNTHETIC-old';self.repin(release)
        values=self.service.validated_releases(OFFERINGS)
        self.assertEqual(values[OFFERINGS[0]].code,'forecast_base_version_conflict')
        self.assertIsInstance(values[OFFERINGS[1]],dict)

    def test_unrequested_or_sparse_batch_keys_fail_without_per_offering_fallback(self):
        valid=self.store.published_many(OFFERINGS)
        for mapping in ({OFFERINGS[0]:valid[OFFERINGS[0]]},dict(valid,**{'SYNTHETIC-foreign':None}),list(valid.items())):
            self.store.published_many=lambda ids:mapping
            with self.subTest(kind=type(mapping).__name__),self.assertRaises(PlatformError):self.service.validated_releases(OFFERINGS)
        self.assertEqual(self.store.single_calls,[])

    def test_custom_single_reader_remains_available_but_no_batch_fallback_is_invented(self):
        release=self.store.published(OFFERINGS[0])
        class Single:
            def __init__(self):self.calls=0
            def published(self,offering):self.calls+=1;return deepcopy(release)
        single=Single();service=ForecastPolicyService(single,self.inputs,self.clock)
        with self.assertRaises(PlatformError) as caught:service.validated_releases(OFFERINGS)
        self.assertEqual(caught.exception.code,'forecast_not_configured');self.assertEqual(single.calls,0)
        self.assertEqual(service.validated_release(OFFERINGS[0]),release)

    def test_memory_batch_uses_exact_timestamp_then_release_id_order(self):
        original=self.store.published(OFFERINGS[0])
        for release_id,at in [('SYNTHETIC-old','2026-10-01T00:00:00Z'),('SYNTHETIC-A','2026-10-05T00:00:00Z'),('SYNTHETIC-Z','2026-10-05T00:00:00Z')]:
            row=deepcopy(original);row.update(release_id=release_id,published_at=at);self.store.publish(row)
        self.assertEqual(self.store.published_many(OFFERINGS)[OFFERINGS[0]]['release_id'],'SYNTHETIC-Z')
        self.assertEqual(self.store.published_many(OFFERINGS)[OFFERINGS[0]],self.store.published(OFFERINGS[0]))


class SQLRepository:
    def __init__(self,rows):self.rows=rows;self.calls=[];self.read_modes=[]
    @contextmanager
    def transaction(self,*,read_only=False):self.read_modes.append(read_only);yield self
    def execute(self,query,params):self.calls.append((query,params));return self
    def fetchall(self):return self.rows


class BatchSQLTests(unittest.TestCase):
    def test_parameterized_join_is_once_and_missing_is_explicit_none(self):
        database=SQLRepository([(OFFERINGS[0],{'format':'SYNTHETIC'}),(OFFERINGS[1],False)])
        repo=PostgresForecastRepository(database)
        values=repo.published_many([*OFFERINGS,'SYNTHETIC-missing',OFFERINGS[0]])
        self.assertEqual(database.read_modes,[True]);self.assertEqual(len(database.calls),1)
        query,params=database.calls[0]
        self.assertEqual(query,PUBLISHED_MANY_SQL)
        self.assertIn('JOIN unnest(%s::text[])',query)
        self.assertIn('f.published_at DESC,f.release_id DESC',query)
        self.assertEqual(params,([*OFFERINGS,'SYNTHETIC-missing'],))
        self.assertIs(values[OFFERINGS[1]],False)
        self.assertIsNone(values['SYNTHETIC-missing'])

    def test_duplicate_foreign_or_malformed_sql_rows_are_rejected(self):
        for rows in ([('SYNTHETIC-foreign',{})],[(OFFERINGS[0],{}),(OFFERINGS[0],{})],[(OFFERINGS[0],)],None):
            with self.subTest(rows=rows),self.assertRaises(PlatformError):PostgresForecastRepository(SQLRepository(rows)).published_many(OFFERINGS)

    def test_present_json_null_is_invalid_instead_of_missing(self):
        values=PostgresForecastRepository(SQLRepository([(OFFERINGS[0],None)])).published_many(OFFERINGS)
        self.assertIsInstance(values[OFFERINGS[0]],PlatformError)
        self.assertIsNone(values[OFFERINGS[1]])

    def test_empty_batch_reads_nothing_and_native_identifier_types_are_not_coerced(self):
        database=SQLRepository([]);repo=PostgresForecastRepository(database)
        self.assertEqual(repo.published_many([]),{});self.assertEqual(database.calls,[])
        for value in (None,'SYNTHETIC', [False], [None], ['']):
            with self.subTest(value=value),self.assertRaises(PlatformError):repo.published_many(value)
        self.assertEqual(database.calls,[])
