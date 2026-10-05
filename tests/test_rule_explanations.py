import unittest
from jungsi_touch.application.rule_explanations import explain_rule

class RuleExplanationTests(unittest.TestCase):
    def test_only_reachable_approved_expression_is_explained(self):
        inputs=[dict(op='input',field=f) for f in ('inquiry1_standard_score','inquiry2_standard_score')]
        rule=dict(rule_version='SYNTHETIC-rule',output_node='out',nodes=dict(out=dict(op='rank_weighted',args=inputs,weights=['1']),unused=dict(op='input',field='english_grade')))
        reasons=explain_rule(rule);self.assertEqual([r['code'] for r in reasons],['best_inquiry_one']);self.assertNotIn('weights',str(reasons))
    def test_english_subtraction_is_not_just_any_english_input(self):
        rule=dict(rule_version='SYNTHETIC-rule',output_node='out',nodes=dict(out=dict(op='subtract',left=dict(op='const',value='100'),right=dict(op='lookup',table='SYNTHETIC-table',key=dict(op='input',field='english_grade')))))
        self.assertIn('english_deduction',[r['code'] for r in explain_rule(rule)])

    def test_inactive_conditional_method_is_not_explained(self):
        rank=dict(op='rank_weighted',args=[dict(op='input',field=f) for f in ('inquiry1_standard_score','inquiry2_standard_score')],weights=['1'])
        rule=dict(rule_version='SYNTHETIC-rule',output_node='out',nodes=dict(out=dict(op='if',condition=dict(op='eq',left=dict(op='input',field='math_choice'),right=dict(op='const',value='미적분')),then=rank,**{'else':dict(op='input',field='inquiry1_standard_score')})))
        self.assertEqual(explain_rule(rule,dict(math_choice='확률과통계')),())
        self.assertEqual(explain_rule(rule,dict(math_choice='미적분'))[0]['code'],'best_inquiry_one')
        self.assertEqual(explain_rule(rule),())
