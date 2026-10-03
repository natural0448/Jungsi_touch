"""동일 총점·다른 강점의 가상 성적을 비교한다. 실제 전국/대학 결과가 아니다."""
import argparse
from collections import Counter
from fractions import Fraction
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from jungsi_touch.profile_percentile import (
    ExamProfile, JointRecord, ProfilePercentileModel, SubjectDistribution,
    SubjectMark, make_research_weighted_rule,
)


def make_profile(k, m, i1, i2, *, year=2026):
    return ExamProfile(
        year,
        SubjectMark("korean", "demo-korean", k, "가상 국어 선택과목"),
        SubjectMark("math", "demo-math", m, "가상 수학 선택과목"),
        SubjectMark("inquiry", "demo-inquiry-a", i1),
        SubjectMark("inquiry", "demo-inquiry-b", i2),
        english_grade=2, korean_history_grade=1,
    )


def build_demo():
    # 행별 가중치는 동일한 네 성적 조합의 가상 인원 수다. 합계 100명.
    tuples = [
        (100,100,50,50,10), (110,110,55,55,15), (115,120,60,60,15),
        (125,115,60,60,10), (130,130,70,70,10), (115,145,70,70,5),
        (145,115,70,70,5), (140,135,70,70,5), (135,140,70,70,5),
        (145,145,75,75,5), (125,130,65,65,10), (130,125,65,65,5),
    ]
    records = tuple(JointRecord(f"synthetic-{i}",make_profile(k,m,a,b),n)
                    for i,(k,m,a,b,n) in enumerate(tuples))
    tables = []
    for slot in range(4):
        frequencies = Counter()
        for record in records:
            mark=record.profile.marks[slot]
            frequencies[mark.standard_score]+=int(record.weight)
        mark=records[0].profile.marks[slot]
        tables.append(SubjectDistribution(
            2026,mark.area,mark.subject_id,frequencies.items(),
            distribution_id=f"synthetic-2026-{mark.subject_id}-v1",
            population_label="성적 조합 시연용 가상 100명",expected_count=100,
            complete=True,status="synthetic",
        ))
    model=ProfilePercentileModel(2026,tables,model_id="synthetic-profile-v1",
                                records=records,expected_joint_weight=100,status="synthetic")
    third=Fraction(1,3)
    rules={
        "total_baseline":make_research_weighted_rule("synthetic-total-baseline-v1",2026,korean=third,math=third,inquiry=third,basis="standard_score"),
        "subject_position_balanced":make_research_weighted_rule("synthetic-midrank-balanced-v1",2026,korean=third,math=third,inquiry=third,basis="subject_midrank"),
        "math_emphasis":make_research_weighted_rule("synthetic-midrank-math-v1",2026,korean="0.2",math="0.5",inquiry="0.3",basis="subject_midrank"),
        "korean_emphasis":make_research_weighted_rule("synthetic-midrank-korean-v1",2026,korean="0.5",math="0.2",inquiry="0.3",basis="subject_midrank"),
    }
    students={"균형형":make_profile(130,130,70,70),
              "수학 강점형":make_profile(115,145,70,70),
              "국어 강점형":make_profile(145,115,70,70)}
    return model, rules, students, tables, records


def comparison():
    model,rules,students,_,_=build_demo()
    return {
        "synthetic":True,
        "notice":"모든 성적·분포·반영비율은 설명용 가상 자료. 실제 대학 환산이나 전국 누적이 아님.",
        "new_primary_metric_approved":False,
        "students":[{
            "name":name,"scores":[mark.standard_score for mark in profile.marks],
            "profile":model.describe(profile),
            "rule_results":{key:model.rank(profile,rule,require_approved=False) for key,rule in rules.items()},
        } for name,profile in students.items()],
    }


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output",type=Path,help="새 결과 JSON 저장; 기존 파일 덮어쓰기 없음")
    args=parser.parse_args()
    result=comparison()
    if args.output:
        with args.output.open("x",encoding="utf-8") as handle:
            json.dump(result,handle,ensure_ascii=False,indent=2)
            handle.write("\n")
    concise={"synthetic":True,"students":[{
        "name":s["name"],"scores":s["scores"],"total":s["profile"]["standard_total"],
        "top_percent_by_rule":{k:v["top_percent"] for k,v in s["rule_results"].items()},
    } for s in result["students"]]}
    print(json.dumps(concise,ensure_ascii=False,indent=2))
    return 0


if __name__=="__main__":
    if hasattr(sys.stdout,"reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(main())