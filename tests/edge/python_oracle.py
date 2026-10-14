"""Independent local Python-versus-Deno oracle, invented cases only.

Creates append-only outputs; no remote services, real data, deletion or cleanup.
Deno must be supplied explicitly. Python reference modules stay unchanged.
This is not the common CI runner and does not mark any of API22 as ported.
"""
from __future__ import annotations
import argparse
from collections import Counter
from copy import deepcopy
from datetime import datetime, timezone
from decimal import Decimal, localcontext, ROUND_HALF_UP, ROUND_HALF_EVEN, ROUND_DOWN, ROUND_FLOOR, ROUND_CEILING
from fractions import Fraction
from hashlib import sha256
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'src'))
sys.path.insert(0, str(ROOT / 'tests'))
from jungsi_touch.university_conversion import ConversionRule, ConversionRelease, num, round_exact
from jungsi_touch.percentile import DistributionMetadata, ScoreFrequency, StandardScores, TotalScoreDistribution
from jungsi_touch.application.time_contract import utc_instant, utc_text, seoul_date_range
from jungsi_touch.infrastructure.drive_provider import _integer_keys
from jungsi_touch.infrastructure.supabase_storage import _json
from test_conversion_rule_synthetic import invented_rule, invented_profile, inp, const, number_input, lookup_table


def ratio(value):
    return dict(numerator=str(value.numerator), denominator=str(value.denominator))


def display(value, places):
    # A second arithmetic oracle: Decimal quantization, independent of round_exact.
    with localcontext() as ctx:
        ctx.prec = max(80, len(str(abs(value.numerator))) + len(str(value.denominator)) + places + 20)
        number = Decimal(value.numerator) / Decimal(value.denominator)
        result = number.quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP)
        if not result: result = abs(result)
        return format(result, f'.{places}f')


def single_fixture():
    rule = invented_rule({'korean': number_input(), 'math': number_input()}, {'score': {'op': 'sum', 'args': [inp('korean'), {'op': 'product', 'args': [inp('math'), const('0.5')]}]}})
    offering = dict(academic_year=2027, offering_id='SYNTHETIC-OFFERING', university_id='SYNTHETIC-U', campus='SYNTHETIC-C', department='SYNTHETIC-D', track='SYNTHETIC-T', group='SYNTHETIC-G')
    pack = dict(academic_year=2027, exam_id='SYNTHETIC-EXAM', pack_version='SYNTHETIC-PACK-v1', exam_type='csat')
    profile = invented_profile({'korean': 10, 'math': 14}) | {'pack_version': pack['pack_version']}
    bundle = dict(data_kind='synthetic', status='synthetic', academic_year=2027, exam_id=pack['exam_id'], source_pack_version=pack['pack_version'], exam_type='csat', rule=rule, bindings=[offering | dict(offering_pk=offering['offering_id'], rule_version=rule['rule_version'])])
    return dict(offering=offering, pack=pack, bundle=bundle, profile=profile)


def make_cases():
    cases, expected = [], []
    def add(kind, payload, run):
        identifier = f'{kind}-{len(cases):05d}'
        cases.append(dict(id=identifier, kind=kind, payload=payload))
        try: expected.append(dict(id=identifier, result=run()))
        except Exception as error: expected.append(dict(id=identifier, error=getattr(error, 'code', 'invalid_value')))
    modes = dict(half_up=ROUND_HALF_UP, half_even=ROUND_HALF_EVEN, truncate=ROUND_DOWN, floor=ROUND_FLOOR, ceil=ROUND_CEILING)
    values = ['0', '0.000000005', '-0.000000005', '1.005', '-1.005', '1.235', '-1.235', '1.245', '-1.245', '2.679', '-2.679', '9007199254740993.125', '-9007199254740993.125', '1.00000000000000001', '-1.00000000000000001', '1e-12', '+.5', '1_000.00']
    for value in values:
        for places in range(9):
            for mode, decimal_mode in modes.items():
                def run(value=value, places=places, mode=mode, decimal_mode=decimal_mode):
                    actual = round_exact(num(value), places, mode)
                    with localcontext() as ctx:
                        ctx.prec=100
                        independent=Fraction(Decimal(value).quantize(Decimal(1).scaleb(-places),rounding=decimal_mode))
                    assert actual == independent
                    return dict(ratio=ratio(actual), display=display(actual, places))
                add('round', dict(value=value, places=places, mode=mode), run)
    for value, places, mode in [(True,2,'half_up'),(1.0,2,'half_up'),('NaN',2,'half_up'),(1,True,'half_up'),(1,9,'half_up'),(1,2,'unknown')]:
        add('round',dict(value=value,places=places,mode=mode),lambda v=value,p=places,m=mode: ratio(round_exact(num(v),p,m)))
    def conversion(rule, values=None, research=True):
        profile = invented_profile(values or {})
        def run():
            r=ConversionRule(rule).calculate(profile,research=research)
            value=Fraction(**r['exact_score']); return dict(ratio=ratio(value),display=r['converted_score'])
        add('conversion',dict(rule=rule,profile=profile,research=research),run)
    conversion(invented_rule({'korean':number_input(),'math':number_input()},{'score':{'op':'product','args':[{'op':'divide','left':{'op':'sum','args':[inp('korean'),{'op':'product','args':[inp('math'),const('1.1')]}]},'right':const(20)},const(100)]}}),{'korean':10,'math':15})
    conversion(invented_rule({'a':number_input(),'b':number_input()},{'score':{'op':'rank_weighted','args':[{'op':'lookup','table':'inquiry','key':inp('a')},{'op':'lookup','table':'inquiry','key':inp('b')}],'weights':[1]}},tables={'inquiry':lookup_table({'80':17,'60':31})}),{'a':80,'b':60})
    conversion(invented_rule({}, {'score':{'op':'sum','args':[{'op':'round','value':const('1.235'),'places':2,'mode':'half_up'},{'op':'round','value':const('1.235'),'places':2,'mode':'half_up'}]}}))
    conversion(invented_rule({}, {'score':{'op':'round','value':{'op':'sum','args':[const('1.235'),const('1.235')]},'places':2,'mode':'half_up'}}))
    for op in ['sum','product','average','max','min','rank_weighted']:
        expr={'op':op,'args':[const(7),const(3),const(5)]}
        if op=='rank_weighted':expr['weights']=['0.6','0.4']
        conversion(invented_rule({}, {'score':expr}))
    for condition in [{'op':'in','value':const('SYNTHETIC-A'),'choices':['SYNTHETIC-A']},{'op':'eq','left':const(1),'right':const('1')},{'op':'all','args':[{'op':'eq','left':const(1),'right':const(1)}]},{'op':'any','args':[{'op':'eq','left':const(1),'right':const(2)}]}]:
        conversion(invented_rule({}, {'score':{'op':'if','condition':condition,'then':const(3),'else':const(7)}}))
    conversion(invented_rule({}, {'base':const('2.5'),'score':{'op':'subtract','left':{'op':'ref','node':'base'},'right':const('1.25')}}))
    bands=dict(academic_year=2027,version='SYNTHETIC-BANDS-v1',source_ref='SYNTHETIC',status='verified',kind='bands',rows=[dict(lower=0,upper=3,value=11),dict(lower=3,upper=6,value=29,include_upper=True)])
    for score in [0,2,3,6,7]:conversion(invented_rule({'score':number_input()},{'score':{'op':'bands','table':'band','value':inp('score')}},tables={'band':bands}),{'score':score})
    for value in [True,1.0,'NaN',None,101,'1.5']:
        conversion(invented_rule({'score':number_input()},{'score':inp('score')}),{'score':value})
    conversion(invented_rule({'score':number_input()},{'score':inp('score')}),{})
    conversion(invented_rule({}, {'score':{'op':'divide','left':const(1),'right':const(0)}}))
    conversion(invented_rule({}, {'score':{'op':'ref','node':'other'},'other':{'op':'ref','node':'score'}}))
    conversion(invented_rule({}, {'score':{'op':'if','condition':{'op':'eq','left':const(1),'right':const(1)},'then':const(3),'else':{'op':'eval','value':'SYNTHETIC'}}}))
    conversion(invented_rule({}, {'score':const(0)}),research=False)
    table=lookup_table({'80':17})
    for mutation in ['missing','pending','wrong_year']:
        t=deepcopy(table)
        if mutation=='pending':t['status']='pending'
        if mutation=='wrong_year':t['academic_year']=2026
        conversion(invented_rule({'score':number_input()},{'score':{'op':'lookup','table':'t','key':inp('score')}},tables={'t':t}),{'score':79 if mutation=='missing' else 80})
    for weights,kind in [([1,3,2],'observed_counts'),(['0.5','1.5',1],'estimated_weights'),([9007199254740993,1,2],'observed_counts')]:
        rows=[dict(score=i+1,weight=w) for i,w in enumerate(weights)]
        total=sum((Fraction(w) for w in weights),Fraction())
        total_value=total.numerator if total.denominator==1 else display(total,4)
        metadata=DistributionMetadata('SYNTHETIC-DIST',2027,'SYNTHETIC-SOURCE','2026-10-07','korean_math_inquiry2_standard_sum','all_examinees_with_korean_math_two_inquiry_scores',kind,'synthetic',False,True,0,100,total_value)
        distribution=TotalScoreDistribution(metadata,[ScoreFrequency(r['score'],r['weight']) for r in rows])
        for score in [0,1,2,3,4]:
            for tie in ['include_equal','exclude_equal']:
                for places in [0,2,6,12]:
                    def run(d=distribution,s=score,t=tie,p=places):
                        result=d.calculate(StandardScores(2027,s,0,0,0),tie_policy=t,require_approved=False)
                        return dict(top=ratio(result.top_fraction),inclusive=ratio(result.inclusive_fraction),exclusive=ratio(result.exclusive_fraction),display=display(result.top_percent,p),tie=display(result.equal_weight/result.total_weight*100,p))
                    add('tail',dict(rows=rows,total=total_value,observed=kind=='observed_counts',score=score,tie=tie,places=places),run)
    for value,source in [('2027-01-01T00:00:00.000001+09:00',None),('2027-01-01T00:00:00','Asia/Seoul'),('2024-02-29 23:59:59.123456-03:30',None),('1969-12-31T23:59:59.999999Z',None),('2026-12-31T23:59:59.999999Z',None),('2027-01-01T00:00:00+23:59',None),('1960-01-01T00:00:00','Asia/Seoul'),('1988-10-09T02:30:00','Asia/Seoul')]:
        add('time',dict(value=value,source=source),lambda v=value,s=source:utc_text(utc_instant(v,source_timezone=s)))
    for start,end in [('2024-02-29','2024-02-29'),('2026-12-31','2027-01-01')]:
        add('range',dict(start=start,end=end),lambda s=start,e=end:list(map(utc_text,seoul_date_range(s,e))))
    for text in ['{"0":0,"1":null}','{"9007199254740993":1}','{"01":0}','{"+1":0}','{"-1":0}','{" 1":0}','{"1.0":0}','{"1":0,"\\u0031":1}','{"x":NaN}','{"0":true}','[]','{"'+('1'*129)+'":1}']:
        add('integer_keys',dict(text=text),lambda t=text:sorted(map(str,_integer_keys(_json(t.encode())))))
    fixture=single_fixture()
    release=ConversionRelease('SYNTHETIC-RELEASE',[fixture['bundle']['rule']],fixture['bundle']['bindings'])
    calc=release.rules[release.bindings[(2027,'SYNTHETIC-OFFERING')]].calculate(fixture['profile'],research=True)
    result=dict(ratio=ratio(Fraction(**calc['exact_score'])),display=calc['converted_score'],scoring='ready',percentile='pending',judgment='pending',production_ready=False)
    add('single',fixture,lambda:result)
    return cases,expected


def legacy_main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--deno',required=True);args=parser.parse_args()
    stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    destination=ROOT/'outputs/dev010_independent_comparison'/stamp;destination.mkdir(parents=True,exist_ok=False)
    cases,expected=make_cases()
    encoded=json.dumps(cases,ensure_ascii=False,allow_nan=False,separators=(',',':')).encode('utf-8')
    (destination/'cases.v1.json').write_bytes(encoded)
    (destination/'python_expected.v1.json').write_text(json.dumps(expected,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    result=subprocess.run([args.deno,'run','--no-config','--no-lock','--no-remote','--no-npm',str(ROOT/'tests/edge/parity_driver.ts')],input=encoded,capture_output=True,cwd=ROOT,env={**os.environ,'DENO_DIR':str(destination/'deno_cache')},timeout=45)
    (destination/'deno_stdout.txt').write_bytes(result.stdout);(destination/'deno_stderr.txt').write_bytes(result.stderr)
    actual=json.loads(result.stdout) if result.returncode==0 else []
    (destination/'deno_actual.v1.json').write_text(json.dumps(actual,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    mismatches=[]
    if len(actual)!=len(expected):mismatches.append(dict(error='case_count_mismatch',actual=len(actual),expected=len(expected)))
    for index,(a,b) in enumerate(zip(actual,expected)):
        if a!=b:mismatches.append(dict(case=cases[index],actual=a,expected=b))
    (destination/'mismatches.v1.json').write_text(json.dumps(mismatches,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    references=['src/jungsi_touch/university_conversion.py','src/jungsi_touch/year_equating.py','src/jungsi_touch/percentile.py','src/jungsi_touch/application/time_contract.py','src/jungsi_touch/infrastructure/drive_provider.py','src/jungsi_touch/infrastructure/supabase_storage.py']
    hashes={p:sha256((ROOT/p).read_bytes()).hexdigest() for p in references}
    reference_match=all(subprocess.run(['git','show','4c3c5770bc397f36df5fc96c98e0057f330c769f:'+p],cwd=ROOT,capture_output=True,check=True).stdout==(ROOT/p).read_bytes() for p in references)
    sources=[p for folder in ['supabase','tests/edge'] for p in (ROOT/folder).rglob('*') if p.is_file()]
    receipt=dict(format='jungsi.dev010-independent-comparison/v1',basis='4c3c5770bc397f36df5fc96c98e0057f330c769f',data_kind='synthetic',case_count=len(cases),by_kind=dict(Counter(c['kind'] for c in cases)),mismatch_count=len(mismatches),deno_exit_code=result.returncode,successful=result.returncode==0 and not mismatches and reference_match,oracle_references_match_basis=reference_match,oracle_reference_sha256=hashes,cases_sha256=sha256(encoded).hexdigest(),source_sha256={p.relative_to(ROOT).as_posix():sha256(p.read_bytes()).hexdigest() for p in sources},actual_Auth_DB_Storage_Edge_BFF_browser='NOT_RUN',production_ready=False,files_deleted=0,limitations=['local Deno is not hosted Supabase Edge','single offering is a synthetic research seam, not university.analyze API','full native decoders, approval, mock/bridge, staff scope and quota adapters not ported','ASCII Decimal subset and canonical calendar ISO only; no full Python input language equivalence claim'])
    (destination/'comparison_receipt.v1.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(dict(destination=str(destination),case_count=len(cases),mismatch_count=len(mismatches),successful=receipt['successful']),ensure_ascii=False))
    return 0 if receipt['successful'] else 1

def typed_tree(value):
    if isinstance(value,dict):return ("object",tuple(sorted((k,typed_tree(v)) for k,v in value.items())))
    if isinstance(value,list):return ("array",tuple(typed_tree(v) for v in value))
    return (type(value).__name__,value)

def registered_main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--deno',required=True);parser.add_argument('--reference-manifest',required=True);parser.add_argument('--output-root',required=True)
    args=parser.parse_args()
    reference=json.loads(Path(args.reference_manifest).read_bytes())
    if reference.get('format')!='jungsi.edge-python-reference/v1':raise ValueError('reference_manifest_invalid')
    def checked(mapping):
        for name,expected in mapping.items():
            path=Path(name)
            if path.is_absolute() or '..' in path.parts or '\\' in name or ':' in name or (ROOT/path).is_symlink():raise ValueError('unsafe_reference_path')
            if sha256((ROOT/path).read_bytes()).hexdigest()!=expected:raise ValueError('reference_bytes_mismatch')
    checked(reference['files']);checked(reference['source_files'])
    destination=Path(args.output_root);destination.mkdir(parents=True,exist_ok=False)
    def create(name,raw):
        with (destination/name).open('xb') as f:f.write(raw)
    def encoded_json(value):return (json.dumps(value,ensure_ascii=False,indent=2,allow_nan=False)+'\n').encode()
    cases,expected=make_cases()
    encoded=json.dumps(cases,ensure_ascii=False,allow_nan=False,separators=(',',':')).encode('utf-8')
    if len(cases)!=reference['expected_cases'] or sha256(encoded).hexdigest()!=reference['cases_sha256']:raise ValueError('oracle_case_basis_drift')
    create('cases.v1.json',encoded);create('python_expected.v1.json',encoded_json(expected))
    try:
        result=subprocess.run([args.deno,'run','--no-config','--no-lock','--no-remote','--no-npm',str(ROOT/'tests/edge/parity_driver.ts')],input=encoded,capture_output=True,cwd=ROOT,env={**os.environ,'DENO_DIR':str(destination/'deno_cache'),'DENO_NO_UPDATE_CHECK':'1'},timeout=45)
    except subprocess.TimeoutExpired as error:
        create('deno_stdout.txt',error.stdout or b'');create('deno_stderr.txt',error.stderr or b'')
        raise ValueError('oracle_timeout') from error
    create('deno_stdout.txt',result.stdout);create('deno_stderr.txt',result.stderr)
    # No zero-length substitute for a failed or malformed Deno result.
    if result.returncode!=0:raise ValueError('oracle_deno_failed')
    actual=json.loads(result.stdout)
    if not isinstance(actual,list):raise ValueError('oracle_result_not_array')
    create('deno_actual.v1.json',encoded_json(actual))
    mismatches=[]
    if len(actual)!=len(expected):mismatches.append(dict(error='case_count_mismatch',actual=len(actual),expected=len(expected)))
    for i,(a,b) in enumerate(zip(actual,expected)):
        if typed_tree(a)!=typed_tree(b):mismatches.append(dict(case=cases[i],actual=a,expected=b))
    create('mismatches.v1.json',encoded_json(mismatches))
    checked(reference['files']);checked(reference['source_files'])
    receipt=dict(format='jungsi.dev010-independent-comparison/v1',basis='selected_snapshot',data_kind='synthetic',
      case_count=len(cases),by_kind=dict(Counter(c['kind'] for c in cases)),mismatch_count=len(mismatches),deno_exit_code=result.returncode,
      successful=not mismatches,oracle_references_match_basis=True,oracle_reference_sha256=reference['files'],
      cases_sha256=sha256(encoded).hexdigest(),source_sha256=reference['source_files'],
      actual_Auth_DB_Storage_Edge_BFF_browser='NOT_RUN',production_ready=False,files_deleted=0)
    create('comparison_receipt.v1.json',encoded_json(receipt))
    print(json.dumps(dict(destination=str(destination),case_count=len(cases),mismatch_count=len(mismatches),successful=receipt['successful']),ensure_ascii=False))
    return 0 if receipt['successful'] else 1
def main():
    # Historical --deno-only replay keeps its old evidence/basis; common harness always supplies a manifest.
    return registered_main() if '--reference-manifest' in sys.argv else legacy_main()
if __name__=='__main__':raise SystemExit(main())
