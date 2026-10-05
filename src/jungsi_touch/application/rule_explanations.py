"""Public explanations from the executed, approved rule graph, not coefficients."""
from fractions import Fraction

def explain_rule(rule, values=None, trace=None):
    nodes=rule['nodes']; seen=set(); reasons=[]
    values=values or {};trace=trace or {}
    def condition(expr):
        if not isinstance(expr,dict):return None
        op=expr.get('op')
        if op=='ref':
            value=trace.get(expr['node'])
            return value if type(value) is bool else None
        if op in ('input','const'):
            value=values.get(expr['field']) if op=='input' else expr['value']
            if type(value) is int:return Fraction(value)
            if isinstance(value,str):
                try:return Fraction(value)
                except ValueError:return value
            return None
        if op=='in':
            value=condition(expr['value'])
            return None if value is None else value in expr['choices']
        if op=='eq':
            left=condition(expr['left']);right=condition(expr['right'])
            return None if left is None or right is None else left==right
        if op in ('all','any'):
            parts=[condition(e) for e in expr['args']]
            if any(type(v) is not bool for v in parts):return None
            return all(parts) if op=='all' else any(parts)
        return None
    def chosen(expr):
        outcome=condition(expr['condition'])
        return expr['then' if outcome else 'else'] if type(outcome) is bool else None
    def fields(expr):
        if isinstance(expr,dict):
            if expr.get('op')=='if':return fields(chosen(expr))
            if expr.get('op')=='input':return {expr['field']}
            if expr.get('op')=='ref':return fields(nodes[expr['node']])
            return set().union(*(fields(v) for v in expr.values()))
        if isinstance(expr,list):return set().union(*(fields(v) for v in expr)) if expr else set()
        return set()
    def walk(expr):
        if isinstance(expr,dict):
            if expr.get('op')=='if':
                walk(chosen(expr));return
            if expr.get('op')=='ref':
                name=expr['node']
                if name not in seen:seen.add(name);walk(nodes[name])
                return
            op=expr.get('op'); inputs=fields(expr)
            if op=='rank_weighted':
                if len(expr['weights'])==1 and inputs and all(f.startswith(('inquiry1_','inquiry2_')) for f in inputs):
                    reasons.append(('best_inquiry_one','공식 반영식은 탐구 두 과목 중 우수한 한 과목을 반영합니다.'))
                else:reasons.append(('ranked_areas','공식 반영식은 영역 성적의 우수 순서에 따라 반영합니다.'))
            if op=='subtract' and 'english_grade' in fields(expr.get('right')):
                reasons.append(('english_deduction','공식 반영식에 영어 등급별 환산값을 차감하는 연산이 있습니다.'))
            elif op in ('lookup','bands') and 'english_grade' in inputs:
                reasons.append(('english_grade_table','공식 반영식에서 영어 등급별 환산표를 적용합니다.'))
            for value in expr.values():walk(value)
        elif isinstance(expr,list):
            for value in expr:walk(value)
    walk(nodes[rule['output_node']])
    return tuple(dict(code=code,text=explanation,evidence_refs=[rule['rule_version']]) for code,explanation in dict(reasons).items())
