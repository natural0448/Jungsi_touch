"""Synthetic validation of three source rebounds; no runtime activation."""
import copy
import json
from pathlib import Path
import unittest
import run_edge_tests as r
ROOT=Path(__file__).resolve().parents[1]

class RunnerThreeReboundTests(unittest.TestCase):
    def fixture(self):
        s=json.loads((ROOT/'docs/current/service_spec.json').read_bytes())
        original={
          'whole_population':s['overall_analysis_contract']['whole_population_transition']['verification'],
          'period_renewal':s['backend_platform_contract']['period_renewal_source_extension'],
          'p1_selection':s['p1_selection_bridge_review_verification']}
        families={k:{} for k in r.RUNNER_REBOUND_FAMILIES}
        for k,(pin,path,sha) in r.RUNNER_REBOUND_PINS.items():
            families[k]={'historical_sha256':pin,'changed_source_bindings':{path:sha}}
        s['current_source_rebounds_20261113']=dict(format='jungsi.current-source-rebounds/v1',status='SOURCE_REGISTERED_NOT_EXECUTED',activation_status='NOT_RUN',native_acceptance='NOT_VERIFIED_BY_SOURCE_SUITE',operating_writes=0,families=families)
        return s,original

    def before(self,selected):
        return {x['path']:x['sha256'] for x in selected['source_bindings']}

    def test_each_exact_rebound_and_legacy_fallback_preserves_history(self):
        spec, originals=self.fixture();history=copy.deepcopy(originals)
        for family in originals:
            with self.subTest(family=family):
                selected=r.select_runner_current_rebound(spec,family,originals[family]);before=self.before(selected)
                if family=='whole_population':result=r.whole_population_registration(spec,before)
                elif family=='period_renewal':result=r.period_renewal_registration(spec,before)
                else:
                    before.update({selected['test_path']:selected['test_sha256'],selected['fixture_path']:selected['fixture_sha256']})
                    result=r.p1_selection_bridge_registration(spec,before)
                self.assertIsNotNone(result)
                self.assertEqual(originals[family],history[family])
                old=copy.deepcopy(spec);old.pop('current_source_rebounds_20261113')
                self.assertEqual(r.select_runner_current_rebound(old,family,originals[family]),originals[family])

    def test_history_rebound_and_unrelated_source_forgery_rejected(self):
        for family in r.RUNNER_REBOUND_PINS:
            for mode in ('history','pin','changed','extra','status','bool_writes','missing_family','duplicate_source','snapshot','other_source'):
                with self.subTest(family=family,mode=mode):
                    spec,originals=self.fixture();original=originals[family];pin,path,current=r.RUNNER_REBOUND_PINS[family]
                    entry=spec['current_source_rebounds_20261113']['families'][family]
                    if mode=='history':original['source_bindings'][0]['sha256']='0'*64
                    elif mode=='pin':entry['historical_sha256']='0'*64
                    elif mode=='changed':entry['changed_source_bindings'][path]='0'*64
                    elif mode=='extra':entry['changed_source_bindings']['evil.ts']='0'*64
                    elif mode=='status':spec['current_source_rebounds_20261113']['activation_status']='PASS'
                    elif mode=='bool_writes':spec['current_source_rebounds_20261113']['operating_writes']=False
                    elif mode=='missing_family':spec['current_source_rebounds_20261113']['families'].pop('member')
                    elif mode=='duplicate_source':original['source_bindings'].append(copy.deepcopy(next(x for x in original['source_bindings'] if x['path']==path)))
                    if mode in ('snapshot','other_source'):
                        selected=r.select_runner_current_rebound(spec,family,original);before=self.before(selected)
                        target=path if mode=='snapshot' else next(x for x in before if x!=path);before[target]='0'*64
                        if family=='p1_selection':before.update({selected['test_path']:selected['test_sha256'],selected['fixture_path']:selected['fixture_sha256']})
                        call={'whole_population':r.whole_population_registration,'period_renewal':r.period_renewal_registration,'p1_selection':r.p1_selection_bridge_registration}[family]
                        with self.assertRaises(r.EdgeFailure):call(spec,before)
                    else:
                        with self.assertRaises(r.EdgeFailure):r.select_runner_current_rebound(spec,family,original)

    def test_missing_historical_or_malformed_envelope_cannot_bypass(self):
        for family in r.RUNNER_REBOUND_PINS:
            with self.subTest(missing=family):
                spec,_=self.fixture()
                if family=='whole_population':spec['overall_analysis_contract'].pop('whole_population_transition')
                elif family=='period_renewal':spec['backend_platform_contract'].pop('period_renewal_source_extension')
                else:spec.pop('p1_selection_bridge_review_verification')
                call={'whole_population':r.whole_population_registration,'period_renewal':r.period_renewal_registration,'p1_selection':r.p1_selection_bridge_registration}[family]
                with self.assertRaises(r.EdgeFailure):call(spec,{})
            with self.subTest(invalid_envelope=family):
                spec,originals=self.fixture();spec['current_source_rebounds_20261113']=None
                with self.assertRaises(r.EdgeFailure):r.select_runner_current_rebound(spec,family,originals[family])
