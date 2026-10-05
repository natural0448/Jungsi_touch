"""Independent synthetic arithmetic checks; no workbook, real rule or data.

The invented rules stay data_kind=synthetic/draft and run only in research tests.
They cannot be published by the production calculation path.
"""
from copy import deepcopy
from decimal import Decimal, ROUND_HALF_UP, ROUND_HALF_EVEN, ROUND_DOWN, ROUND_FLOOR, ROUND_CEILING
from fractions import Fraction
from pathlib import Path
import sys
import unittest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'src'))
from jungsi_touch.university_conversion import ConversionRule,ConversionRelease,ConversionError,round_exact


def inp(field):return {'op':'input','field':field}
def const(value):return {'op':'const','value':value}
def number_input(lo=0,hi=100):return {'type':'number','min':lo,'max':hi,'integer':True}
def invented_rule(inputs,nodes,output='score',tables=None):
    return dict(format='jungsi.university-rule/v1',academic_year=2027,rule_id='SYNTHETIC-RULE',rule_version='SYNTHETIC-RULE-v1',
        review_status='draft',data_kind='synthetic',score_scope='csat_component',source_refs=['SYNTHETIC-INVENTED-NO-WORKBOOK'],
        inputs=inputs,tables=tables or {},nodes=nodes,output_node=output,display_places=2,official_max_score=100,
        non_csat_components=[{'component':'SYNTHETIC-NON-CSAT','status':'not_computed'}])
def invented_profile(values):
    return dict(academic_year=2027,exam_id='SYNTHETIC-EXAM',profile_version='SYNTHETIC-PROFILE',score_basis='synthetic',values=values)
def exact(result):return Fraction(result['exact_score']['numerator'],result['exact_score']['denominator'])
def lookup_table(values):
    return dict(academic_year=2027,version='SYNTHETIC-TABLE-v1',source_ref='SYNTHETIC-TABLE',status='verified',kind='lookup',values=values)


class SyntheticConversionRuleTests(unittest.TestCase):
    def calculate(self,rule,values):return ConversionRule(rule).calculate(invented_profile(values),research=True)
    def test_bonus_before_scale_conversion_has_independent_expected_score(self):
        # official_max_score is the base scale, not a bonus-inclusive hard cap.
        # Only an explicit output_range defines the executable final bounds.
        rule=invented_rule({'korean':number_input(),'math':number_input()}, {'score':{
            'op':'product','args':[{'op':'divide','left':{'op':'sum','args':[inp('korean'),{'op':'product','args':[inp('math'),const('1.1')]}]},'right':const(20)},const(100)]}})
        self.assertEqual(exact(self.calculate(rule,{'korean':10,'math':15})),Fraction(265,2))
    def test_inquiry_conversion_precedes_best_subject_selection(self):
        rule=invented_rule({'inquiry1_percentile':number_input(),'inquiry2_percentile':number_input()}, {'score':{
            'op':'rank_weighted','args':[{'op':'lookup','table':'inquiry','key':inp('inquiry1_percentile')},
                                      {'op':'lookup','table':'inquiry','key':inp('inquiry2_percentile')}],'weights':[1]}},
            tables={'inquiry':lookup_table({'80':17,'60':31})})
        self.assertEqual(exact(self.calculate(rule,{'inquiry1_percentile':80,'inquiry2_percentile':60})),31)
    def test_grade_deduction_after_weighting_is_not_zero_imputation(self):
        rule=invented_rule({'korean':number_input(),'math':number_input(),'english_grade':number_input(1,9)},
            {'base':{'op':'sum','args':[inp('korean'),{'op':'product','args':[inp('math'),const('0.5')]}]},
             'score':{'op':'subtract','left':{'op':'ref','node':'base'},'right':{'op':'lookup','table':'english','key':inp('english_grade')}}},
            tables={'english':lookup_table({'1':0,'2':3,'3':7})})
        self.assertEqual(exact(self.calculate(rule,{'korean':10,'math':14,'english_grade':2})),14)
        with self.assertRaises(ConversionError) as caught:self.calculate(rule,{'korean':10,'math':14})
        self.assertEqual(caught.exception.code,'REQUIRED_INPUT_MISSING')
    def test_choice_condition_and_max_of_alternatives(self):
        rule=invented_rule({'korean':number_input(),'math':number_input(),'math_choice':{'type':'text','choices':['SYNTHETIC-A','SYNTHETIC-B']}},
            {'score':{'op':'max','args':[inp('korean'),{'op':'if','condition':{'op':'in','value':inp('math_choice'),'choices':['SYNTHETIC-A']},
                'then':{'op':'product','args':[inp('math'),const('1.2')]},'else':inp('math')}]}})
        self.assertEqual(exact(self.calculate(rule,{'korean':11,'math':10,'math_choice':'SYNTHETIC-A'})),12)
        self.assertEqual(exact(self.calculate(rule,{'korean':11,'math':10,'math_choice':'SYNTHETIC-B'})),11)
    def test_step_rounding_changes_result_and_is_explicit_in_the_rule(self):
        rule=invented_rule({}, {'score':{'op':'sum','args':[{'op':'round','value':const('1.235'),'places':2,'mode':'half_up'},
                                                        {'op':'round','value':const('1.235'),'places':2,'mode':'half_up'}]}})
        self.assertEqual(exact(self.calculate(rule,{})),Fraction('2.48'))
        rule['nodes']['score']={'op':'round','value':{'op':'sum','args':[const('1.235'),const('1.235')]},'places':2,'mode':'half_up'}
        self.assertEqual(exact(self.calculate(rule,{})),Fraction('2.47'))
    def test_positive_negative_ties_match_independent_decimal_oracle(self):
        modes=dict(half_up=ROUND_HALF_UP,half_even=ROUND_HALF_EVEN,truncate=ROUND_DOWN,floor=ROUND_FLOOR,ceil=ROUND_CEILING)
        for value in ('1.235','1.245','-1.235','-1.245'):
            for name,mode in modes.items():
                with self.subTest(value=value,mode=name):
                    self.assertEqual(round_exact(Fraction(value),2,name),Fraction(Decimal(value).quantize(Decimal('.01'),rounding=mode)))
    def test_exact_score_survives_display_rounding(self):
        result=self.calculate(invented_rule({}, {'score':const('1.234')}),{})
        self.assertEqual(exact(result),Fraction(617,500));self.assertEqual(result['converted_score'],'1.23')
    def test_missing_pending_and_wrong_year_tables_fail_closed(self):
        table=lookup_table({'80':17})
        rule=invented_rule({'percentile':number_input()}, {'score':{'op':'lookup','table':'inquiry','key':inp('percentile')}},tables={'inquiry':table})
        with self.assertRaises(ConversionError) as caught:self.calculate(rule,{'percentile':79})
        self.assertEqual(caught.exception.code,'LOOKUP_KEY_MISSING')
        table['status']='pending'
        with self.assertRaises(ConversionError) as caught:self.calculate(rule,{'percentile':80})
        self.assertEqual(caught.exception.code,'CONVERSION_TABLE_PENDING')
        table['academic_year']=2026
        with self.assertRaises(ConversionError) as caught:ConversionRule(rule)
        self.assertEqual(caught.exception.code,'TABLE_YEAR_MISMATCH')
    def test_zero_divisor_and_invalid_input_are_not_silently_coerced(self):
        rule=invented_rule({'score':number_input()}, {'score':{'op':'divide','left':inp('score'),'right':const(0)}})
        with self.assertRaises(ConversionError) as caught:self.calculate(rule,{'score':1})
        self.assertEqual(caught.exception.code,'DIVISION_BY_ZERO')
        for value in (True,1.0,'NaN',None):
            with self.subTest(value=value),self.assertRaises(ConversionError):self.calculate(rule,{'score':value})
    def test_ambiguous_and_cross_year_binding_cannot_select_another_rule(self):
        rule=invented_rule({'score':number_input()},{'score':inp('score')})
        binding=dict(academic_year=2027,offering_pk='SYNTHETIC-OFFERING',rule_version=rule['rule_version'])
        with self.assertRaises(ConversionError) as caught:ConversionRelease('SYNTHETIC-RELEASE',[rule],[binding,binding])
        self.assertEqual(caught.exception.code,'RULE_BINDING_AMBIGUOUS')
        binding['academic_year']=2026
        with self.assertRaises(ConversionError) as caught:ConversionRelease('SYNTHETIC-RELEASE',[rule],[binding])
        self.assertEqual(caught.exception.code,'BINDING_YEAR_MISMATCH')
    def test_disallowed_operator_in_inactive_branch_is_rejected(self):
        rule=invented_rule({}, {'score':{'op':'if','condition':{'op':'eq','left':const(1),'right':const(1)},
            'then':const(3),'else':{'op':'eval','value':'SYNTHETIC-NOT-EXECUTED'}}})
        with self.assertRaises(ConversionError) as caught:ConversionRule(rule)
        self.assertEqual(caught.exception.code,'UNSUPPORTED_OPERATOR')
    def test_rule_and_input_contents_are_unchanged_by_calculation(self):
        rule=invented_rule({'score':number_input()},{'score':inp('score')});seed=deepcopy(rule)
        profile=invented_profile({'score':10});before=deepcopy(profile)
        engine=ConversionRule(rule);result=engine.calculate(profile,research=True)
        self.assertEqual(rule,seed);self.assertEqual(engine.data,seed);self.assertEqual(profile,before)
        # Returned provenance must not be a writable alias of the adopted rule.
        result['source_refs'].append('SYNTHETIC-UNTRUSTED-RESULT-EDIT')
        result['non_csat_components'][0]['status']='SYNTHETIC-RESULT-EDIT'
        self.assertEqual(engine.data,seed)
    def test_synthetic_rule_cannot_be_used_as_a_production_rule(self):
        engine=ConversionRule(invented_rule({'score':number_input()},{'score':inp('score')}))
        with self.assertRaises(ConversionError) as caught:engine.calculate(invented_profile({'score':10}))
        self.assertEqual(caught.exception.code,'RULE_NOT_APPROVED')
    def test_band_boundaries_include_only_last_upper_bound(self):
        table=dict(academic_year=2027,version='SYNTHETIC-BANDS-v1',source_ref='SYNTHETIC',status='verified',kind='bands',
            rows=[dict(lower=0,upper=3,value=11),dict(lower=3,upper=6,value=29,include_upper=True)])
        rule=invented_rule({'score':number_input()}, {'score':{'op':'bands','table':'band','value':inp('score')}},tables={'band':table})
        for score,expected in [(0,11),(2,11),(3,29),(6,29)]:self.assertEqual(exact(self.calculate(rule,{'score':score})),expected)
        with self.assertRaises(ConversionError) as caught:self.calculate(rule,{'score':7})
        self.assertEqual(caught.exception.code,'LOOKUP_KEY_MISSING')
        table['rows'][1]['lower']=4
        with self.assertRaises(ConversionError) as caught:ConversionRule(rule)
        self.assertEqual(caught.exception.code,'INVALID_BANDS')
    def test_best_two_weighting_and_inquiry_average_have_hand_expected_values(self):
        args=[const(7),const(3),const(5)]
        rule=invented_rule({}, {'score':{'op':'rank_weighted','args':args,'weights':['0.6','0.4']}})
        self.assertEqual(exact(self.calculate(rule,{})),Fraction(31,5))
        rule['nodes']['score']={'op':'average','args':[const(7),const(4)]}
        self.assertEqual(exact(self.calculate(rule,{})),Fraction(11,2))
    def test_final_rounding_and_truncation_and_explicit_output_range(self):
        rule=invented_rule({}, {'score':{'op':'round','value':const('2.679'),'places':2,'mode':'truncate'}})
        self.assertEqual(exact(self.calculate(rule,{})),Fraction(267,100))
        rule['nodes']['score']['mode']='half_up';self.assertEqual(exact(self.calculate(rule,{})),Fraction(268,100))
        rule['output_range']={'min':'0','max':'2.67'}
        with self.assertRaises(ConversionError) as caught:self.calculate(rule,{})
        self.assertEqual(caught.exception.code,'OUTPUT_OUT_OF_RANGE')
    def test_cyclic_nodes_and_invalid_numeric_metadata_are_blocked(self):
        rule=invented_rule({}, {'score':{'op':'ref','node':'other'},'other':{'op':'ref','node':'score'}})
        with self.assertRaises(ConversionError) as caught:ConversionRule(rule)
        self.assertEqual(caught.exception.code,'CYCLIC_RULE')
        for maximum in ('NaN','Infinity',True,1.5,0):
            with self.subTest(maximum=maximum),self.assertRaises(ConversionError):
                ConversionRule(dict(invented_rule({}, {'score':const(1)}),official_max_score=maximum))


if __name__=='__main__':unittest.main()
