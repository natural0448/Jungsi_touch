"""서버 내부용 대학 환산 엔진. 연도 보정과 분리된 버전 규칙 실행기.

Excel 수식/eval/매크로를 실행하지 않는다. 원문을 검수해 만든 허용 연산과
연도별 조회표만 실행한다. 공개 API/회원 권한/DB 접속은 이 모듈의 범위 밖이다.
"""
from copy import deepcopy
from fractions import Fraction
import re
from .year_equating import number, display, YEARS, EquatingError

FORMAT = 'jungsi.university-rule/v1'

class ConversionError(ValueError):
    def __init__(self, code, message):
        self.code = code
        super().__init__(message)

def check(ok, code, message):
    if not ok: raise ConversionError(code, message)

def num(value):
    try: return number(value)
    except EquatingError as exc: raise ConversionError(exc.code,str(exc)) from exc

def round_exact(value, places, mode):
    check(type(places) is int and 0 <= places <= 8,'INVALID_PRECISION','공식 자릿수를 확인하세요.')
    check(mode in ('half_up','half_even','truncate','floor','ceil'),'ROUNDING_UNSPECIFIED','공식 반올림 방법이 필요합니다.')
    scale=10**places;v=value*scale;q,r=divmod(abs(v.numerator),v.denominator)
    if mode=='half_up':q+=int(2*r>=v.denominator)
    if mode=='half_even':q+=int(2*r>v.denominator or (2*r==v.denominator and q%2))
    if mode=='floor' and v<0:q+=int(r>0)
    if mode=='ceil' and v>=0:q+=int(r>0)
    return Fraction(-q if v<0 else q,scale)

# 각 연산의 속성까지 허용 목록으로 검사한다. 실행되지 않는 분기도 검사한다.
OPS = {
 'const': {'value'},'input':{'field'},'ref':{'node'},'sum':{'args'},'product':{'args'},
 'average':{'args'},'max':{'args'},'min':{'args'},'subtract':{'left','right'},
 'divide':{'left','right'},'lookup':{'table','key'},'bands':{'table','value'},
 'rank_weighted':{'args','weights'},'round':{'value','places','mode'},
 'if':{'condition','then','else'},'in':{'value','choices'},'eq':{'left','right'},
 'all':{'args'},'any':{'args'},
}

def _inspect(expr, nodes, inputs, tables, depth=0):
    check(depth<=40 and isinstance(expr,dict),'INVALID_EXPRESSION','연산 구조를 확인하세요.')
    op=expr.get('op');check(op in OPS,'UNSUPPORTED_OPERATOR','허용되지 않은 연산입니다.')
    check(set(expr)==OPS[op]|{'op'},'INVALID_EXPRESSION','연산 속성이 계약과 다릅니다.')
    if op=='ref':check(expr['node'] in nodes,'UNKNOWN_NODE','없는 계산 노드를 참조합니다.')
    elif op=='input':check(expr['field'] in inputs,'UNKNOWN_INPUT','등록되지 않은 성적 입력입니다.')
    elif op in ('lookup','bands'):
        check(expr['table'] in tables,'CONVERSION_TABLE_PENDING','필요한 환산표가 없습니다.')
        check(tables[expr['table']]['kind']==('lookup' if op=='lookup' else 'bands'),'TABLE_KIND_MISMATCH','조회 연산과 표 종류가 다릅니다.')
    elif op=='const':
        check(type(expr['value']) in (int,str),'INVALID_CONSTANT','정수 또는 문자열 상수만 허용합니다.')
    if op=='rank_weighted':
        check(isinstance(expr['weights'],list) and 0<len(expr['weights'])<=len(expr['args']),'INVALID_WEIGHTS','반영할 우수 영역과 비율을 확인하세요.')
        check(all(num(w)>=0 for w in expr['weights']),'INVALID_WEIGHTS','우수 순위 반영비율은 음수가 될 수 없습니다.')
    if op=='round':round_exact(Fraction(0),expr['places'],expr['mode'])
    if op=='in':check(isinstance(expr['choices'],list) and bool(expr['choices']),'INVALID_CHOICES','허용 과목 목록이 필요합니다.')
    for k,v in expr.items():
        if k in ('args',):
            check(isinstance(v,list) and bool(v),'EMPTY_ARGUMENTS','빈 연산은 허용하지 않습니다.')
            for child in v:_inspect(child,nodes,inputs,tables,depth+1)
        elif k in ('left','right','key','condition','then','else') or (k=='value' and op not in ('const',)):
            _inspect(v,nodes,inputs,tables,depth+1)

def _refs(expr):
    out=[]
    if isinstance(expr,dict):
        if expr.get('op')=='ref':out.append(expr['node'])
        for v in expr.values():out.extend(_refs(v))
    elif isinstance(expr,list):
        for v in expr:out.extend(_refs(v))
    return out

class ConversionRule:
    def __init__(self,data):
        self.data=deepcopy(data);d=self.data
        try:
            check(d['format']==FORMAT,'INVALID_RULE_FORMAT','규칙 형식을 확인하세요.')
            check(type(d['academic_year']) is int and d['academic_year'] in YEARS,'INVALID_YEAR','2024~2027 규칙이 필요합니다.')
            check(d['review_status'] in ('draft','source_verified','calculation_verified'),'INVALID_RULE_STATUS','규칙 상태를 확인하세요.')
            check(d['data_kind'] in ('official_rule','synthetic'),'INVALID_RULE_KIND','자료 종류를 확인하세요.')
            for key in ('rule_id','rule_version','score_scope'):
                check(isinstance(d[key],str) and bool(d[key]),'INVALID_RULE_METADATA','규칙 식별 정보가 필요합니다.')
            check(d['score_scope']=='csat_component','UNSUPPORTED_SCOPE','현재 엔진은 수능 부분점수를 계산합니다.')
            check(isinstance(d['source_refs'],list) and d['source_refs'],'SOURCE_REQUIRED','공식 근거가 필요합니다.')
            check(isinstance(d['inputs'],dict) and isinstance(d['tables'],dict) and isinstance(d['nodes'],dict),'INVALID_RULE_SCHEMA','입력·조회표·연산 정의가 필요합니다.')
            for spec in d['inputs'].values():
                check(spec['type'] in ('number','text'),'INVALID_INPUT_TYPE','입력 자료형을 확인하세요.')
                if spec['type']=='number':
                    check(num(spec['min'])<=num(spec['max']),'INVALID_INPUT_RANGE','성적 범위를 확인하세요.')
                    check(type(spec.get('integer',True)) is bool,'INVALID_INPUT_TYPE','정수 입력 여부를 확인하세요.')
            for table in d['tables'].values():
                check(table['academic_year']==d['academic_year'],'TABLE_YEAR_MISMATCH','다른 연도의 변환표를 대체 사용할 수 없습니다.')
                check(bool(table['version']) and bool(table['source_ref']),'SOURCE_REQUIRED','표 버전과 근거가 필요합니다.')
                check(table['status'] in ('verified','pending'),'INVALID_TABLE_STATUS','표 확인 상태를 확인하세요.')
                check(table['kind'] in ('lookup','bands'),'INVALID_TABLE_KIND','표 종류를 확인하세요.')
                if table['status']=='pending':continue
                if table['kind']=='lookup':
                    check(isinstance(table['values'],dict) and table['values'],'EMPTY_TABLE','조회표가 비어 있습니다.')
                    for value in table['values'].values():num(value)
                else:
                    check(isinstance(table['rows'],list) and table['rows'],'EMPTY_TABLE','구간표가 비어 있습니다.')
                    previous=None
                    for i,row in enumerate(table['rows']):
                        lo,hi=num(row['lower']),num(row['upper'])
                        check(lo<hi and (previous is None or previous==lo),'INVALID_BANDS','구간표에 공백 또는 중복이 있습니다.')
                        check(row.get('include_upper',False)==(i==len(table['rows'])-1),'INVALID_BANDS','마지막 구간만 상한을 포함해야 합니다.')
                        num(row['value']);previous=hi
            for expr in d['nodes'].values():_inspect(expr,d['nodes'],d['inputs'],d['tables'])
            check(d['output_node'] in d['nodes'],'UNKNOWN_NODE','출력 노드가 없습니다.')
            visited=set();active=set()
            def visit(name):
                check(name not in active,'CYCLIC_RULE','계산식에 순환 참조가 있습니다.')
                if name in visited:return
                active.add(name)
                for ref in _refs(d['nodes'][name]):visit(ref)
                active.remove(name);visited.add(name)
            for name in d['nodes']:visit(name)
        except (KeyError,TypeError,AttributeError) as exc:
            raise ConversionError('INVALID_RULE_SCHEMA','규칙 필수 속성/자료형을 확인하세요.') from exc

    def calculate(self,profile,*,research=False,include_trace=False):
        d=self.data
        check(research or (d['review_status']=='calculation_verified' and d['data_kind']=='official_rule'), 'RULE_NOT_APPROVED','공식 계산 검수를 마친 규칙만 사용합니다.')
        check(isinstance(profile,dict) and profile.get('academic_year')==d['academic_year'],'PROFILE_YEAR_MISMATCH','해당 연도로 보정된 성적이 필요합니다.')
        check(bool(profile.get('exam_id')) and bool(profile.get('profile_version')),'PROFILE_VERSION_REQUIRED','시험과 성적 버전이 필요합니다.')
        check(profile.get('score_basis') in ('actual_exam','mock_exam','year_equated_estimate','synthetic'),'INVALID_SCORE_BASIS','성적의 실제·모의·추정 구분이 필요합니다.')
        if profile['score_basis']=='year_equated_estimate':
            check(bool(profile.get('bridge_version')),'YEAR_BRIDGE_REQUIRED','성적 보정 버전이 필요합니다.')
            check(research or profile.get('bridge_validated') is True,'YEAR_BRIDGE_NOT_VALIDATED','연도 보정 검증이 필요합니다.')
        check(research or profile['score_basis']!='synthetic','SYNTHETIC_PROFILE','가상 성적은 검산 전용입니다.')
        values=profile.get('values',{});inputs={};trace={}
        for field,spec in d['inputs'].items():
            value=values.get(field)
            check(value is not None,'REQUIRED_INPUT_MISSING',f'{field} 성적을 확인하세요. 누락은 0점이 아닙니다.')
            if spec['type']=='number':
                value=num(value)
                check(num(spec['min'])<=value<=num(spec['max']),'SCORE_OUT_OF_RANGE',f'{field} 점수 범위를 확인하세요.')
                check(not spec.get('integer',True) or value.denominator==1,'INVALID_INTEGER',f'{field}은 정수여야 합니다.')
            else:
                check(isinstance(value,str) and bool(value),'INVALID_TEXT',f'{field} 값을 확인하세요.')
                if 'choices' in spec:check(value in spec['choices'],'INVALID_CHOICE',f'{field} 선택을 확인하세요.')
            inputs[field]=value
        def node(name):
            if name not in trace:trace[name]=run(d['nodes'][name])
            return trace[name]
        def run(e):
            op=e['op']
            if op=='const':
                v=e['value'];return num(v) if type(v) is int or (isinstance(v,str) and re.fullmatch(r'-?\d+(\.\d+)?',v)) else v
            if op=='input':return inputs[e['field']]
            if op=='ref':return node(e['node'])
            if op=='if':
                c=run(e['condition']);check(type(c) is bool,'INVALID_CONDITION','조건식이 논리값이어야 합니다.')
                return run(e['then'] if c else e['else'])
            if op=='in':return run(e['value']) in e['choices']
            if op=='eq':return run(e['left'])==run(e['right'])
            if op in ('lookup','bands'):
                table=d['tables'][e['table']]
                check(table['status']=='verified','CONVERSION_TABLE_PENDING','해당 연도 공식 변환표 확인 대기입니다.')
                v=run(e['key' if op=='lookup' else 'value'])
                if op=='lookup':
                    key=str(v.numerator) if isinstance(v,Fraction) and v.denominator==1 else str(v)
                    check(key in table['values'],'LOOKUP_KEY_MISSING','대응하는 공식 환산점수가 없습니다.')
                    return num(table['values'][key])
                check(isinstance(v,Fraction),'INVALID_VALUE_TYPE','구간 조회값은 숫자여야 합니다.')
                for row in table['rows']:
                    if num(row['lower'])<=v and (v<num(row['upper']) or (row.get('include_upper') and v==num(row['upper']))):return num(row['value'])
                raise ConversionError('LOOKUP_KEY_MISSING','공식 구간표 범위 밖입니다.')
            if op=='round':return round_exact(run(e['value']),e['places'],e['mode'])
            if op in ('subtract','divide'):
                a,b=run(e['left']),run(e['right'])
                check(isinstance(a,Fraction) and isinstance(b,Fraction),'INVALID_VALUE_TYPE','계산 값은 숫자여야 합니다.')
                if op=='subtract':return a-b
                check(b!=0,'DIVISION_BY_ZERO','환산 분모가 0입니다.');return a/b
            args=[run(a) for a in e['args']]
            if op in ('all','any'):
                check(all(type(a) is bool for a in args),'INVALID_CONDITION','조건식 자료형을 확인하세요.')
                return all(args) if op=='all' else any(args)
            check(all(isinstance(a,Fraction) for a in args),'INVALID_VALUE_TYPE','계산 값은 숫자여야 합니다.')
            if op=='sum':return sum(args,Fraction())
            if op=='average':return sum(args,Fraction())/len(args)
            if op=='max':return max(args)
            if op=='min':return min(args)
            if op=='rank_weighted':return sum((v*num(w) for v,w in zip(sorted(args,reverse=True),e['weights'])),Fraction())
            if op=='product':
                value=Fraction(1)
                for a in args:value*=a
                return value
            raise ConversionError('UNSUPPORTED_OPERATOR','지원하지 않는 연산입니다.')
        score=node(d['output_node']);check(isinstance(score,Fraction),'INVALID_OUTPUT','환산점수가 숫자가 아닙니다.')
        result={'academic_year':d['academic_year'],'exam_id':profile['exam_id'],'profile_version':profile['profile_version'],
                'rule_version':d['rule_version'],'score_basis':profile['score_basis'],'bridge_version':profile.get('bridge_version'),
                'calculation_status':'calculated','score_scope':d['score_scope'],
                'converted_score':display(score,d.get('display_places',2)),
                'exact_score':{'numerator':score.numerator,'denominator':score.denominator},
                'official_max_score':d.get('official_max_score'), 'admission_total_score':None,
                'eligibility_status':'needs_confirmation','non_csat_components':d.get('non_csat_components',[]),
                'college_percentile':None,'possibility':None,'advantage':None,
                'source_refs':d['source_refs'],'conversion_table_versions':[t['version'] for t in d['tables'].values()],
                'reason_codes':['CSAT_COMPONENT_ONLY','ELIGIBILITY_NOT_EVALUATED']}
        if include_trace:result['internal_trace']={k:display(v,8) if isinstance(v,Fraction) else v for k,v in trace.items()}
        return result

class ConversionRelease:
    """학년도 × 실제 모집행 PK로만 규칙 연결. 이름/최근 연도 임의 대체 없음."""
    def __init__(self,release_id,rules,bindings):
        self.release_id=release_id;self.rules={};self.bindings={}
        for raw in rules:
            rule=ConversionRule(raw);key=raw['rule_version']
            check(key not in self.rules,'DUPLICATE_RULE','중복 규칙 버전입니다.');self.rules[key]=rule
        for b in bindings:
            key=(b['academic_year'],str(b['offering_pk']))
            check(key not in self.bindings,'RULE_BINDING_AMBIGUOUS','모집행에 복수 규칙이 연결되었습니다.')
            version=b['rule_version'];check(version in self.rules,'RULE_NOT_FOUND','연결한 규칙이 없습니다.')
            check(self.rules[version].data['academic_year']==key[0],'BINDING_YEAR_MISMATCH','연결과 규칙 학년도가 다릅니다.')
            self.bindings[key]=version
    def compare_years(self,offering_by_year,profiles,*,research=False):
        out=[]
        for year in YEARS:
            base={'academic_year':year,'offering_pk':offering_by_year.get(year),'converted_score':None}
            try:
                check(year in offering_by_year,'OFFERING_MAPPING_REQUIRED','해당 학년도 모집행 연결이 필요합니다.')
                key=(year,str(offering_by_year[year]));check(key in self.bindings,'RULE_NOT_FOUND','해당 모집행 환산식 검수 대기입니다.')
                check(year in profiles,'YEAR_BRIDGE_REQUIRED','해당 연도로 보정한 성적 확인 대기입니다.')
                check(profiles[year].get('score_basis')=='year_equated_estimate','YEAR_BRIDGE_REQUIRED','4개년 비교에는 각 연도로 보정한 성적을 사용합니다.')
                result=self.rules[self.bindings[key]].calculate(profiles[year],research=research)
                base.update(result)
            except ConversionError as exc:
                base.update(calculation_status='blocked',reason_codes=[exc.code],message=str(exc))
            out.append(base)
        return {'release_id':self.release_id,'comparison_basis':'year_equated_estimate','years':out}


def prepare_equated_profile(profile_version, result, *, english_grade, korean_history_grade,
                            choices=None, research=False):
    """서버가 생성한 보정 결과를 환산 입력으로 연결. 클라이언트 입력으로 쓰지 않는다.

    백분위/등급은 목표 시험의 확인된 표에 있는 값만 옮긴다. 현재 성적표의
    백분위를 과거 성적표 백분위로 복사하거나 100-상위누적으로 임의 생성하지 않는다.
    """
    check(isinstance(result,dict) and result.get('status') in ('estimated','research_estimate'),
          'YEAR_BRIDGE_REQUIRED','총점·과목 성적 보정을 먼저 완료하세요.')
    check(research or result.get('public_eligible') is True,'YEAR_BRIDGE_NOT_VALIDATED','연도 보정 검증이 필요합니다.')
    check(result.get('absolute_grade_policy')=='hold_observed_grade','UNSUPPORTED_GRADE_BRIDGE','절대평가 등급 처리 기준을 확인하세요.')
    scores=result.get('estimated_standard_scores');reported=result.get('estimated_reported_scores',{})
    areas=('korean','math','inquiry1','inquiry2')
    check(isinstance(scores,dict) and set(scores)==set(areas),'INVALID_BRIDGE_RESULT','국수탐2 보정 점수가 필요합니다.')
    values={a+'_standard_score':scores[a] for a in areas}
    for area in areas:
        for field in ('percentile','grade'):
            values[area+'_'+field]=(reported.get(area) or {}).get(field)
    for field,value in [('english_grade',english_grade),('korean_history_grade',korean_history_grade)]:
        if value is not None:check(type(value) is int and 1<=value<=9,'INVALID_GRADE','절대평가 등급을 확인하세요.')
        values[field]=value
    for field,value in (choices or {}).items():
        check(field in ('korean_choice','math_choice','inquiry1_subject','inquiry2_subject'),
              'INVALID_CHOICE_FIELD','선택과목 외의 성적을 덮어쓸 수 없습니다.')
        values[field]=value
    return {'academic_year':result['academic_year'],'exam_id':result['target_exam_id'],
            'profile_version':profile_version,'score_basis':'year_equated_estimate',
            'source_exam_id':result['source_exam_id'],'bridge_version':result['bridge_version'],
            'bridge_validated':result.get('public_eligible') is True,'values':values}
