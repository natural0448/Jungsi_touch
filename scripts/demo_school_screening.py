"""가상 자료로 전체 누적/평균등급 1차 후보를 별도 실행. 파일 변경·삭제 없음."""
from pathlib import Path
import json
import sys
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from jungsi_touch.percentile import StandardScores, load_distribution_json
from jungsi_touch.school_screening import ComparisonBasis, SchoolBand, ScreeningScore, recommend_schools


def run_example(path=None):
    source = Path(path) if path else ROOT / "examples/school_screening/scenario.synthetic.json"
    data = json.loads(source.read_text(encoding="utf-8"))
    if data['data_kind'] != 'synthetic' or data['production_allowed'] is not False:
        raise ValueError("이 실행 도구는 명시된 가상 예제 전용입니다.")
    distribution = load_distribution_json(json.dumps(data['distribution'], ensure_ascii=False))
    overall = ScreeningScore.from_overall(distribution.calculate(StandardScores(**data['standard_scores']), require_approved=False))
    grade = ScreeningScore.from_grades(**data['grade_scores'])
    def rows(records):
        return [SchoolBand(**{**row, 'basis': ComparisonBasis(**row['basis'])}) for row in records]
    output = {
        'demo_only': True,
        'overall': recommend_schools(overall,rows(data['overall_bands']),require_approved=False,**data['overall_search_policy']),
        'grade_reference': recommend_schools(grade,rows(data['grade_bands']),require_approved=False,**data['grade_search_policy'])}
    expected=data['expected']
    assert output['overall']['student_value'] == expected['overall_top_percent']
    assert [s['school_key'] for s in output['overall']['schools']] == expected['overall_school_keys']
    assert output['grade_reference']['student_value'] == expected['mean_grade']
    assert [s['school_key'] for s in output['grade_reference']['schools']] == expected['grade_school_keys']
    return output


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    print(json.dumps(run_example(sys.argv[1] if len(sys.argv)>1 else None), ensure_ascii=False, indent=2))
