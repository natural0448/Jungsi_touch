"""시험별 성적 검산 CLI. 원본/결과 파일을 변경하지 않고 JSON을 stdout으로 출력."""
import argparse,json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
from jungsi_touch.exam_pack import ExamPack,ExamTotalModel
from jungsi_touch.reference_curve import inspect_gs_total
from jungsi_touch.percentile import PercentileError

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--pack',type=Path,required=True);p.add_argument('--scores',type=Path,required=True)
    p.add_argument('--total-model',type=Path)
    p.add_argument('--research-reference',type=Path,help='내부 검산용 원본 분위표. 공개 API 옵션으로 노출하지 않음.')
    args=p.parse_args()
    try:
        pack=ExamPack.from_json(args.pack.read_text(encoding='utf-8'))
        scores=json.loads(args.scores.read_text(encoding='utf-8'))
        model=ExamTotalModel.from_json(args.total_model.read_text(encoding='utf-8')) if args.total_model else None
        result=pack.analyze(scores,total_model=model)
        if args.research_reference:
            result['research_reference']=inspect_gs_total(json.loads(args.research_reference.read_text(encoding='utf-8')),
                result['total_standard_score'],pack.validation_summary()['total_examinees'])
        print(json.dumps(result,ensure_ascii=False,indent=2));return 0
    except (PercentileError,ValueError) as exc:
        print(json.dumps({'error':getattr(exc,'code','invalid_input'),'message':str(exc)},ensure_ascii=False),file=sys.stderr)
        return 2
if __name__=='__main__':
    sys.stdout.reconfigure(encoding='utf-8');sys.stderr.reconfigure(encoding='utf-8')
    raise SystemExit(main())
