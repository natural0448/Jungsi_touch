"""서버 분석 릴리스와 학생 입력을 연결하는 로컬 CLI. stdout만 출력한다.

이 CLI는 내부 작업용이다. 웹에서는 인증·활성 유료 권한 검사 후 호출해야
하며, --research/자료 경로/검증 상태를 브라우저 입력으로 받지 않는다.
"""
import argparse,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'src'))
from jungsi_touch.exam_pack import ExamTotalModel
from jungsi_touch.year_equating import BridgePolicy
from jungsi_touch.year_comparison import TargetDataset,compare_student,student_response
from jungsi_touch.university_conversion import ConversionRelease

def read(path):return json.loads(Path(path).read_text(encoding='utf-8-sig'))
def linked(path):
    # 릴리스 파일은 신뢰된 서버 설정. 경로는 작업 공간 기준이며 외부 URL을 실행하지 않는다.
    if path is None:return None
    p=(ROOT/path).resolve()
    if not p.is_relative_to(ROOT.resolve()):raise ValueError('릴리스 연결 경로가 프로젝트 밖입니다.')
    return p

def run(config,payload,profile_version,offering_by_year,research=False):
    if config.get('format')!='jungsi.analysis-release/v1':raise ValueError('분석 릴리스 형식을 확인하세요.')
    if set(config['targets'])!={'2024','2025','2026','2027'}:raise ValueError('4개년 목표 시험 설정이 필요합니다.')
    if config.get('runtime_status')!='internal_review_only':raise ValueError('이 CLI는 내부 검토 릴리스만 지원합니다.')
    source=read(linked(config['source_pack']))
    source_model=ExamTotalModel.from_json(linked(config['source_total_model']).read_text(encoding='utf-8')) if config['source_total_model'] else None
    raw=read(linked(config['university_rule_release']));release=ConversionRelease(raw['release_id'],raw['rules'],raw['bindings'])
    targets={}
    for year,row in config['targets'].items():
        if row.get('scorecard_table') is not None:raise ValueError('별도 성적표 대응표 어댑터 검수가 필요합니다.')
        target_data=read(linked(row['exam_pack'])) if row['exam_pack'] else None
        target_model=ExamTotalModel.from_json(linked(row['total_model']).read_text(encoding='utf-8')) if row['total_model'] else None
        targets[int(year)]=TargetDataset(int(year),row['target_exam_id'],BridgePolicy(**row['bridge_policy']),target_data,target_model)
    result=compare_student(profile_version=profile_version,payload=payload,source_data=source,
          source_model=source_model,targets=targets,rule_release=release,offering_by_year=offering_by_year,
          internal_research=research)
    result['analysis_release_id']=config['release_id']
    result['design_approval_status']=config['design_approval']['status']
    return result

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--release',type=Path,required=True)
    p.add_argument('--scores',type=Path,required=True);p.add_argument('--profile-version',required=True)
    p.add_argument('--offering-map',type=Path,required=True,help='학년도 문자열 -> 실제 모집행 PK JSON')
    p.add_argument('--research',action='store_true');p.add_argument('--student-view',action='store_true')
    args=p.parse_args()
    try:
        mapping={int(k):str(v) for k,v in read(args.offering_map).items()}
        result=run(read(args.release),read(args.scores),args.profile_version,mapping,args.research)
        print(json.dumps(student_response(result) if args.student_view else result,ensure_ascii=False,indent=2));return 0
    except (ValueError,OSError,KeyError,TypeError) as exc:
        print(json.dumps({'error':getattr(exc,'code','INVALID_INPUT'),'message':str(exc)},ensure_ascii=False),file=sys.stderr);return 2
if __name__=='__main__':
    sys.stdout.reconfigure(encoding='utf-8');sys.stderr.reconfigure(encoding='utf-8');raise SystemExit(main())
