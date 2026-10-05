"""Generate current documents and validate the selected Git snapshot.
No file deletion. --write preserves prior generated content under ignored outputs.
"""
from __future__ import annotations
import argparse,ast,datetime,hashlib,json,re,subprocess,sys
from pathlib import Path,PurePosixPath

ROOT=Path(__file__).resolve().parents[1]
SPEC_PATH="docs/current/service_spec.json"
PRIVATE_DIRS={"resource","data","datas","outputs",".codex",".agents",".aws"}
PRIVATE_SUFFIXES={".xls",".xlsx",".xlsb",".xlsm",".csv",".tsv",".jsonl",".parquet",".feather",".sqlite",".sqlite3",".db",".dump",".pkl",".pickle",".joblib",".npy",".npz",".safetensors",".onnx",".pth",".pt"}
PRIVATE_NAMES={
"examples/equating/kaya_nursing_offering_map.json",
"docs/planning/2026-09-23-v0.1/04_기존_자료와_확인_범위.md",
"docs/planning/2026-09-23-v0.2/01_참고파일_분석.md",
"docs/planning/2026-09-23-v0.6/01_정시판_판별근거_재검토.md",
"docs/planning/2026-09-23-v0.6/02_통합누적_산출계약.md",
"docs/planning/2026-09-27_상담사례_2건_3페이지_공통흐름.md",
"docs/planning/2026-10-03-score-engine/입결_누적백분위_엔진준비.md",
"docs/planning/2026-10-03-score-engine/추가_환산참고자료_검토.md",
"docs/planning/2026-09-23-v0.3/handoff/.gitignore.example",
"tests/test_exam_pack.py","tests/test_year_equating.py",
"tests/test_university_conversion.py","tests/test_year_comparison.py",
"tests/test_admission_result_percentile.py"}
TOKEN_PATTERN=re.compile(rb"(?:-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[A-Z0-9]{16}|sb_secret_[A-Za-z0-9_]{20,})")

def git(*args,input=None):
    result=subprocess.run(["git",*args],cwd=ROOT,input=input,capture_output=True,check=True)
    return result.stdout

class GitSnapshot:
    def __init__(self,*,staged=False,revision=None):
        self.revision=revision
        self.staged=staged
        self.entries={}
        if staged:
            raw=git("ls-files","--stage","-z")
            for row in raw.split(b"\0"):
                if not row:continue
                info,name=row.split(b"\t",1);mode,oid,stage=info.decode().split()
                if stage!="0":raise ValueError("Resolve the index conflict before validation.")
                self.entries[name.decode("utf-8")]=(mode,oid)
        elif revision:
            self.revision=git("rev-parse","--verify",revision+"^{commit}").decode().strip()
            for row in git("ls-tree","-r","-z",self.revision).split(b"\0"):
                if not row:continue
                info,name=row.split(b"\t",1);mode,kind,oid=info.decode().split()
                if kind!="blob":raise ValueError("Submodules are outside the shared snapshot policy.")
                self.entries[name.decode("utf-8")]=(mode,oid)
        else:
            self.paths=sorted(set(p.decode("utf-8") for p in git("ls-files","--cached","--others","--exclude-standard","-z").split(b"\0") if p))
            self.data={p:(ROOT/p).read_bytes() for p in self.paths}
            return
        if any(mode not in {"100644","100755"} for mode,_ in self.entries.values()):
            raise ValueError("Only regular shared files are supported; symbolic links are not followed.")
        self.paths=sorted(self.entries)
        object_ids=list(dict.fromkeys(oid for _,oid in self.entries.values()))
        batch=git("cat-file","--batch",input=("\n".join(object_ids)+"\n").encode())
        offset=0;blobs={}
        for oid in object_ids:
            end=batch.index(b"\n",offset);header=batch[offset:end].decode().split()
            if len(header)!=3 or header[0]!=oid or header[1]!="blob":
                raise ValueError("Unexpected Git object while reading the snapshot.")
            size=int(header[2]);start=end+1
            blobs[oid]=batch[start:start+size];offset=start+size+1
        self.data={path:blobs[oid] for path,(_,oid) in self.entries.items()}
    def read(self,path):
        return self.data[path]
    def text(self,path):
        return self.read(path).decode("utf-8-sig")

def rights(tiers):
    return "일반·유료" if set(tiers)=={"standard","paid"} else "유료"

def table(headers,rows):
    def cell(v):return str(v).replace("|","/").replace("\n"," ")
    return "\n".join(["| "+" | ".join(headers)+" |","| "+" | ".join("---" for _ in headers)+" |"]+
                    ["| "+" | ".join(cell(v) for v in row)+" |" for row in rows])

def collaboration_sections(spec):
    """Render committed ownership and data-exchange decisions for each reader."""
    c=spec.get("collaboration")
    if not c:return dict(ownership="",drive="",handoff="",presentation_intro="",api_handoff="")
    matrix=table(["담당 영역","작업자","코드와 문서 위치","브랜치"],[
        [r["layer"],r["owner"],", ".join(r["roots"]),r["branch_pattern"]] for r in c["owners"]])
    ownership=("\n\n## 계층별 담당과 브랜치\n\n"+c["description"]+"\n\n"+matrix+
        "\n\n"+c["start_rule"]+"\n\n"+c["branch_rule"]+
        "\n\n현재 개발팀의 기존 브랜치는 "+c["existing_application_feature"]+"이다. 화면 작업자는 "+
        c["presentation_branch_example"]+"를 화면 담당의 상시 브랜치로 재사용한다. "+
        c["presentation_branch_status"]+"\n\n"+c["generated_files_rule"]+"\n\n"+c["handoff_rule"]+
        "\n\n"+c["verification_rule"])
    drive=""
    d=spec.get("data_exchange")
    if d:
        drive=("\n\n## Google Drive 폴더 API 연동\n\n"+d["status_text"]+"\n\n"+d["flow"]+
            "\n\n"+d["application_boundary"]+"\n\n"+d["presentation_boundary"]+
            "\n\n### 읽기와 쓰기\n\n"+d["read_policy"]+"\n\n"+d["write_policy"]+
            "\n\n"+d["configuration_policy"]+"\n\n"+d["unavailable_policy"]+
            "\n\n### 남은 설정\n\n"+"\n".join("- "+x for x in d["pending_settings"]))
    intro=("\n\n프레젠테이션은 별도 작업자가 담당한다. 최신 origin/develop의 기획 기준을 확인하고 담당 상시 브랜치 "+c["presentation_branch_example"]+"를 재사용한다. 서버 개발팀의 "+
        c["existing_application_feature"]+"와 브랜치를 공유하지 않는다. "+c["generated_files_rule"]+
        " [프레젠테이션 작업 인계](../../docs/current/프레젠테이션_작업인계.md)를 읽고 출발 커밋과 API 계약을 맞춘다.")
    api_handoff=("\n\n## 프레젠테이션 작업 인계\n\n화면 담당은 별도 작업자이며 "+c["presentation_branch_example"]+"를 상시 사용한다. "+
        "현재 개발팀은 서버 API와 애플리케이션·데이터/인프라를 담당한다. "+
        "[프레젠테이션 작업 인계](프레젠테이션_작업인계.md)에 담당·브랜치·연동 경계를 기록한다. "+
        (d["presentation_boundary"] if d else ""))
    handoff=("이 문서는 별도 프레젠테이션 작업자가 화면 개발을 시작할 때 사용할 담당·브랜치·API 경계다. "+
        "작업 기준은 develop의 확정 커밋과 같은 커밋의 service_spec.json·route_catalog.json이다.\n\n"+
        "## 작업 시작과 공유 계약\n\n"+c["start_rule"]+"\n\n"+
        "프레젠테이션 작업자는 "+c["presentation_branch_example"]+" 상시 브랜치를 재사용한다. 필요한 하위 작업은 명세에 등록한다. "+
        "시스템기획팀의 develop과 현재 서버 개발팀의 "+c["existing_application_feature"]+
        "에 화면 구현 커밋을 함께 작성하지 않는다. 담당 작업 브랜치를 재사용한다.\n\n"+
        "화면 경로와 회원 정책은 [서비스 기획](서비스_기획.md), 요청·응답과 권한 경계는 [라우팅 명세](라우팅_명세.md), "+
        "의존 방향은 [3티어 개발구조](3티어_개발구조.md), 통합 절차는 [개발 브랜치 운영](개발_브랜치_운영.md)을 따른다.\n\n"+
        "apps/web의 화면·입력·탐색·리포트 UI를 구현하고 서버가 허용한 결과를 표시한다. "+
        "로그인/결제 확인·소유권·계산은 서버가 담당하며 브라우저 회원등급 토글을 권한으로 사용하지 않는다.\n\n"+
        c["generated_files_rule"]+"\n\n"+c["handoff_rule"]+
        "\n\n## 연동 준비 상태와 확인 기준\n\n현재 develop의 HTTP 핸들러·운영 인증·저장 연결 상태를 먼저 확인한다. "+
        "연결 전 화면은 명시적인 합성 응답으로 작성하고 실제 계산·로그인·자료 연결 완료로 표시하지 않는다. "+
        "일반가입자는 1페이지와 전체 성적 리포트 범위, 유료가입자는 3·4페이지와 대학 분석 범위를 이용한다. "+
        "성적 또는 모델이 준비되지 않았으면 서버가 반환한 자료 대기 사유를 표시하고 임의 값을 만들지 않는다.\n\n"+
        "인계 시 출발·결과 커밋, 변경 화면과 API 작업 ID, 허용 응답·오류/보류 사유, 합성 응답 사용 여부와 실제 연동 상태를 함께 남긴다. "+
        c["verification_rule"]+"\n\n## 담당과 소유권\n\n"+c["description"]+"\n\n"+matrix+drive)
    return dict(ownership=ownership,drive=drive,handoff=handoff,presentation_intro=intro,api_handoff=api_handoff)


def branch_governance_text(spec):
    """Render the four permanent nodes and registered exceptional work branches."""
    w=spec['workflow'];g=w['branch_governance'];fence=chr(96)*3
    core=table(['브랜치','직접 담당','부모/PR 대상','관리 목적'],[
        [r['name'],r['owner'],r['parent'] or '최상위 배포 후보',r['scope']] for r in g['core_branches']])
    extras=table(['브랜치','분류/담당','부모와 PR 대상','현재 작업/근거'],[
        [r['name'],r['status']+'; '+r['owner'],r.get('pr_target') or '종료: 새 PR 금지',
         r.get('purpose',r.get('scope',''))+(' '+r['deletion_scope'] if r.get('deletion_scope') else '')+'; '+('PR #'+str(r['pull_request']) if r.get('pull_request') else ('병합 PR #'+str(r['merged_pull_request']) if r.get('merged_pull_request') else 'PR 등록 전'))+
         ('; 원격 ref: '+r['remote_ref_state'] if r.get('remote_ref_state') else '')] for r in g['additional_branches']])
    child=table(['필요 시 이름','부모/PR 대상','담당','생성 사유'],[
        [r['pattern'],r['parent'],r['owner'],r['purpose']] for r in g['child_templates']])
    gates=table(['최종 인수 항목','상태','확인할 증거'],[[r['id'],r['status'],r['evidence']] for r in g['release_gate']['checks']])
    return ('## 기본 4개 노드와 담당\n\n'+core+'\n\n'+
        fence+'mermaid\nflowchart TB\n  M[main: 완료한 배포 후보] --> D[develop: 기획 정본과 개발 통합]\n  D --> S[feature/application-pre-data-platform: 시스템·콘텐츠]\n  D --> P[feature/presentation-foundation: 화면]\n  S -.필요 시 등록.-> ST[feature/system-task/slug]\n  P -.필요 시 등록.-> PT[feature/presentation-task/slug]\n  D -.필요 시 등록.-> DT[공통 기획·출시 검토 작업]\n'+fence+
        '\n\n위 화살표는 출발/관리 관계다. 구현 PR은 하위 작업에서 부모로 올라간다. '+g['hierarchy_note']+
        '\n\n기획팀은 develop의 service_spec.json·생성 문서와 브랜치/검사 설정을 직접 갱신한다. 다른 팀은 develop의 자료를 가져가 자기 상시 브랜치에서 개발하고 PR로 통합한다. 3티어는 코드와 포트의 구분이며 각 티어/작업/에이전트마다 브랜치를 만들지 않는다.'+
        '\n\n## 현재 GitHub 브랜치와 열린 작업\n\n조사일 '+g['checked_date']+', 통합 기준 '+g['reference_commit']+'. 상시 '+str(len(g['core_branches']))+'개, 진행 임시 '+str(sum(r.get('status')=='active' for r in g['additional_branches']))+'개, 종료 이력 '+str(sum(r.get('status')!='active' for r in g['additional_branches']))+'개로 분류한다. 원격 ref 상태는 아래 등록부를 따른다. 관측 커밋은 당시 증거이며 작업 브랜치의 미래 HEAD를 고정하는 값이 아니다.\n\n'+extras+'\n\n'+g['remote_inventory']['note']+
        '\n\n열린 PR #5/#6의 변경은 develop의 현재 구현이 아니다. PR #7은 화면 부모에 통합됐고 #9는 종료됐으며 그 head가 화면 상시 HEAD에 포함되어 있다. 화면 코드는 PR #6으로 develop 통합/인수가 남아 있다. 종료 ref는 새 개발에서 제외하고 보존한다. 열린 PR 담당은 최신 develop과 충돌을 해결한 뒤 등록 부모에 통합한다.\n\n'+g['lifecycle_rule']+
        '\n\n## 필요한 하위 작업만 등록\n\n'+child+'\n\n'+g['registration_rule']+
        '\n\n각 노드에서 분리가 필요한 작업을 제안할 수 있다. main 배포 검토 작업도 develop의 release_task에서 정리해 develop으로 먼저 올리고, 최종 develop → main 경로를 유지한다. 임시 작업이 없으면 상시 브랜치 하나를 계속 사용한다.'+
        '\n\n## 작업 시작·동기화·PR\n\n'+g['sync_rule']+'\n\n'+g['merge_rule']+'\n\n'+g['review_rule']+
        '\n\n'+fence+'text\ngit status --short --branch\ngit fetch --no-prune origin\ngit rev-parse origin/develop\n# 담당 상시 브랜치에서 기획을 가져온다\ngit merge --no-edit origin/develop\n# 하위 작업 PR: base는 등록된 parent\n# 상시 시스템/화면 PR: base=develop\n# 전체 인수 완료 후 최종 PR: head=develop, base=main\n'+fence+
        '\n\nGitHub 병합은 merge commit만 허용하고 squash/rebase 병합과 병합 후 자동 브랜치 삭제를 끈다. 상시 브랜치의 이력이 이어지고 통합 뒤 다시 같은 브랜치에서 개발할 수 있다. 미커밋 변경이 있으면 먼저 보존·검토하고 강제 checkout/reset/clean 없이 진행한다.'+
        '\n\n## develop 직접 변경 범위와 적용 검사\n\n'+table(['검사 지점','검사/실제 한계'],list(g['enforcement'].items()))+
        '\n\n기획팀의 직접 허용 범위는 docs/·.github/·.githooks/와 아래 공통 관리 파일, 생성된 현재 문서/카탈로그/README다. 업무·화면 실행 코드·DB 마이그레이션·런타임 잠금은 담당 개발 PR로만 누적한다.\n\n'+
        '\n'.join('- '+v for v in g['planning_direct_paths'])+
        '\n\n기획팀은 현재 셸 세션에서만 아래처럼 역할을 선언한다. .env 파일을 만들거나 GitHub 인증정보를 기록하지 않는다. '+g['planning_team_declaration']+'.\n\n'+
        fence+'powershell\n$env:JUNGSI_TEAM = "planning"\npython -B scripts/check_branch_policy.py --staged\n'+fence+
        '\n\n## main 최종 반영과 라이브 적용\n\n현재 release_gate.state='+g['release_gate']['state']+'. '+g['release_gate']['meaning']+'\n\n'+gates+
        '\n\n최종 PR에는 배포 후보 develop SHA·문서/계약 버전·CI/통합 검증·실제 연결 검수·운영/복구 인계 근거를 담는다. 모든 체크가 passed이고 증거가 있을 때만 ready로 확정한다. main 병합 뒤 별도 승인한 배포를 실행한다. 기능 완료·합성 테스트 성공만으로 실제 데이터와 라이브 준비 완료를 표시하지 않는다.')


def repository_layout_text(spec):
    """Render the shared layout and private locations from the common specification."""
    layout=spec["repository_layout"]
    fence=chr(96)*3
    references="\n".join("- ["+description+"]("+path+")" for path,description in layout["reading_order"])
    tools="\n".join("- "+path for path in spec["workflow"]["shared_tools"])
    return ("현재 dev 작업 기준은 Git 브랜치 develop이다. 구조 확인일: "+layout["checked_date"]+
        ". 조사 출발 커밋: "+layout["reference_commit"]+".\n\n"+layout["scope"]+
        "\n\n## 공유하는 프로젝트 구조\n\n"+fence+"text\n"+layout["public_tree"]+"\n"+fence+
        "\n\napps/web에는 현재 develop의 README와 생성 경로 계약이 있다. 다른 브랜치의 화면 코드는 해당 PR의 통합 여부를 확인한다. 서버 코드의 합성 검증과 실제 Supabase/Drive 연결 상태는 [백엔드 운영 준비](백엔드_운영준비.md)를 따른다."+
        "\n\n## 폴더별 담당과 책임\n\n"+table(["위치","계층/구분","담당","역할","Git 범위"],layout["directories"])+
        "\n\n애플리케이션은 자신이 정의한 포트와 기존 계산 엔진을 사용한다. 인프라가 포트를 구현하며 프레젠테이션은 우리 서버의 허용 API 응답만 표시한다. data/는 비공개 실제 자료 위치이고 database/는 공유 가능한 DB 정의 위치다. FastAPI HTTP 진입점은 infrastructure/의 조립 어댑터다."+
        "\n\n## 로컬과 외부의 비공개 영역\n\n"+table(["위치","확인/공유 상태","역할"],layout["private_locations"])+
        "\n\n이 표는 자료 보관 위치와 제외 규칙을 설명한다. 원자료 파일명·학생 정보·발행 명부 내용·폴더 ID·접속값은 문서에 넣지 않는다. scripts/와 tests/는 공유 파일과 로컬 전용 파일이 함께 있을 수 있다. 공유 가능한 파일 여부는 루트 .gitignore와 Git 추적 목록으로 확인한다."+
        "\n\n## 서버 작업을 시작할 파일\n\n"+table(["파일","진입점/역할"],layout["entry_points"])+
        "\n\n## 기존 계산 엔진\n\n아래 파일은 src/jungsi_touch/ 루트에 있으며 애플리케이션 라이브러리로 재사용한다.\n\n"+table(["모듈","역할"],layout["engine_groups"])+
        "\n\n## 새 작업을 둘 위치\n\n"+table(["작업","위치","작성 기준"],layout["change_placement"])+
        "\n\n## 공유 실행 도구\n\n"+tools+
        "\n\n그 밖의 로컬 자료 작업 스크립트는 기본 Git 제외다. 허용 목록은 service_spec.json.workflow.shared_tools와 루트 .gitignore에서 함께 관리한다."+
        "\n\n## 함께 읽을 현재 문서\n\n"+references+
        "\n\n## develop에서 계속 관리하는 방법\n\n"+"\n\n".join(layout["maintenance_rules"])+
        "\n\n"+fence+"text\ngit branch --show-current\ngit rev-parse HEAD\npython -B scripts/check_project_consistency.py --write\n# 검토한 변경 파일만 경로를 지정해 stage\npython -B scripts/check_project_consistency.py --staged\npython -B scripts/run_committed_tests.py --staged\n"+fence)


def contract_body(contract):
    """Render source-owned contracts without losing nested field semantics."""
    labels={
        'requirements':'적용 요구사항', 'placement':'담당 계층과 구현 위치',
        'verification_status':'검증 상태', 'external_frontend_owner':'외부 프런트 담당',
        'current_team_scope':'우리 팀 담당 범위', 'dto_shapes':'관리·공개 응답의 허용 필드',
        'publication_context_contract':'공개 context 허용 필드와 결속 기준',
        'public_response_binding':'학생 분석과 발표본의 동일 근거 결합 조건',
        'comparison_contract':'판정 비교 지표·단위·방향·동점 기준',
        'exact_numeric_invariants':'정확한 판정과 표시 값의 분리',
        'historical_metric_preservation':'과거 공식 입결 근거 보존',
        'recommendation_reason_contract':'추천 이유의 종류와 공개 범위',
        'reason_code_groups':'외부 프런트가 소비할 이유 코드 종류',
        'candidate_partition_contract':'추천·범위 밖·미충족·보류의 구분',
        'database_readiness':'DB002 운영 검증 대기 조건',
        'api_consumption_rules':'DEV006 응답 소비 규칙',
        'acceptance':'인수검증 기준', 'remaining':'남은 작업', 'scope_excludes':'이번 범위에서 제외',
    }
    body='현재 상태: '+contract['code_status']+'\n\n'
    body+='[작업 항목](../../'+contract['work_item']+')\n\n'
    for name,value in contract.items():
        if name in {'format','version','code_status','work_item'}: continue
        body+='### '+labels.get(name,name)+'\n\n'
        if isinstance(value,(dict,list)) and not (isinstance(value,list) and all(isinstance(v,str) for v in value)):
            body+='```json\n'+json.dumps(value,ensure_ascii=False,indent=2)+'\n```\n\n'
        elif isinstance(value,list):body+='\n'.join('- '+str(item) for item in value)+'\n\n'
        else:body+=str(value)+'\n\n'
    return body


def generated_files(spec):
    digest=hashlib.sha256(json.dumps(spec,ensure_ascii=False,sort_keys=True,separators=(",",":")).encode()).hexdigest()
    def doc(title,body):
        return f"# {title}\n\n이 문서는 공통 명세 service_spec.json에서 생성한다. 현재 버전은 {spec['version']}이며 기획·라우팅·계층 문서를 같은 변경으로 갱신한다.\n\n{body}\n\n<!-- jungsi:generated spec_sha256={digest} -->\n"
    collaboration=collaboration_sections(spec)
    page_rows=[[p["number"],p["label"],p["path"],rights(p["member_tiers"]),p["purpose"]] for p in spec["pages"]]
    requirement_text="\n\n".join(f"### {r['id']} {r['title']}\n\n{r['description']}" for r in spec["requirements"])
    pending="\n".join("- "+text for text in spec["pending"])
    changes=table(["변경일","요구사항","변경과 구현 범위"],[[r["date"],", ".join(r["requirements"]),r["summary"]] for r in spec.get("change_notes",[])])
    files={}
    platform=spec.get('backend_platform_contract')
    runtime_intro=('FastAPI 12개 경로와 업무 서비스·Supabase/Drive 어댑터를 구현했다. 코드 합성 검증과 실제 운영 연결은 구분한다. [API DTO 계약](API_DTO_계약.md)과 [백엔드 운영 준비](백엔드_운영준비.md)를 함께 읽는다.' if platform else '아래 API는 연결 예정 계약이며 HTTP 핸들러가 등록된 상태가 아니다.')
    files[spec["current_documents"]["planning"]]=doc("정시터치 현재 서비스 기획",
       "학생·학부모가 전체 성적 위치에서 출발해 유리한 대학·학과와 핵심 지원 학교를 찾는 상담 서비스다. 교사·입시담당자는 부 사용자다. 현재는 계산·권한·라우팅의 개발 기반이며 운영 서비스 완성을 의미하지 않는다.\n\n"+
       "## 화면과 회원 정책\n\n"+table(["페이지","화면","경로","회원","역할"],page_rows)+
       "\n\n1페이지의 실제 결과 조회 네 학년도는 자료 공개 범위에 따라 별도 확정한다. 2024~2027 성적 환산 비교와 결과 공개 연도를 혼동하지 않는다. 3페이지는 검색부터 상세까지 유료 전용이며 성적이 없어도 유료 검색을 허용한다. 개인 분석이 준비되지 않으면 이유와 함께 보류한다.\n\n"+
       "## 확정 요구사항\n\n"+requirement_text+"\n\n## 이번 버전의 변경\n\n"+changes+"\n\n## 준비 상태와 후속 구현\n\n"+pending+
       "\n\n현재 구현 기준은 [라우팅 명세](라우팅_명세.md), [3티어 개발구조](3티어_개발구조.md), [개발 브랜치 운영](개발_브랜치_운영.md)과 함께 읽는다."+collaboration["ownership"]+collaboration["drive"])
    operation_rows=[[o["id"],o["method"],o["path"],rights(o["member_tiers"]),"본인" if o["report_owner"] else "해당 없음","필요" if o["confirmed_score_profile"] else "불필요",o["response_scope"]] for o in spec["operations"]]
    overall_contract=spec.get("overall_analysis_contract")
    overall_section=""
    if overall_contract:
        overall_section=("## 2페이지 전체 분석 애플리케이션 계약\n\n"+
            overall_contract["description"]+"\n\n서비스: "+overall_contract["application_service"]+
            "\n\n필수 입력: "+", ".join(overall_contract["required_inputs"])+
            ". 선택 입력: "+", ".join(overall_contract["optional_inputs"])+".\n\n"+
            "\n".join("- "+r for r in overall_contract["input_rules"])+
            "\n\n학생 응답: "+", ".join(overall_contract["response_fields"])+
            ". 과목 필드: "+", ".join(overall_contract["subject_fields"])+
            ". 누적 필드: "+", ".join(overall_contract["overall_fields"])+".\n\n"+
            overall_contract["number_format"]+". "+overall_contract["tie_policy"]+".\n\n"+
            "공급 포트: "+overall_contract["provider"]+".\n\n"+
            table(["누적 대기 코드","이유"],overall_contract["pending_reasons"])+"\n\n"+
            table(["오류 코드","HTTP 어댑터 상태","의미"],overall_contract["errors"])+
            "\n\n응답 제외: "+"; ".join(overall_contract["excludes"])+".\n\n"+
            overall_contract["integration"]+"\n\n")
    files[spec["current_documents"]["routing"]]=doc("정시터치 화면과 API 라우팅 명세",
       "화면 URL과 서버 API 계약을 같은 요구사항에 연결한다. "+runtime_intro+"\n\n"+
       "## 화면 경로\n\n"+table(["페이지","화면","경로","회원","역할"],page_rows)+
       "\n\n루트 /는 /admissions/results로 연결한다. 비회원의 1페이지 접근은 미정이며 현재 권한 기반의 기본값은 인증 필요다. 로그인된 일반·유료 사용자의 1페이지 접근은 성적 입력을 요구하지 않는다.\n\n"+
       "## 서버 API 계약\n\n"+table(["작업 ID","메서드","경로","회원","리포트 소유권","성적 확인","응답 범위"],operation_rows)+
       "\n\n정적 경로 /offerings/search를 /offerings/{offering_id}보다 먼저 등록한다. report_id와 offering_id의 표기를 통일한다. 검색은 추천 목록과 조인해 대상을 줄이지 않는다.\n\n"+
       "## 권한과 응답 경계\n\n서버가 검증한 세션·현재 이용권으로 Actor를 만든다. 요청 본문의 회원등급·학생 ID를 신뢰하지 않는다. 미인증은 401, 일반가입자의 유료 요청은 403으로 차단하고 결과·건수·상세를 반환하지 않는다. 없는 리포트와 타인 소유 리포트는 같은 404로 처리한다. 본인 분석에 확인한 성적이 없으면 409와 보류 사유다.\n\n"+
       ("FastAPI는 세션 검증 후 업무 서비스를 호출하고 회원별 DTO를 적용한다. DB 이용권·본인 소유권과 자료/모형 승인 검사를 연결했다. 실제 서버·자료 연결 증거는 운영 준비 상태에서 따로 확인한다. 학부모·상담자 위임은 아직 본인 권한으로 간주하지 않는다.\n\n" if platform else "권한 모듈은 HTTP 인증이나 응답 필드 제거 기능을 대신하지 않는다. 실제 핸들러에서 입력 검증, 운영 저장소 조회, 회원별 응답 객체, 분포·산식 승인 검사를 연결해야 한다. 학부모·상담자 위임은 아직 본인 권한으로 간주하지 않는다.\n\n")+
       overall_section+"## 함께 생성하는 계약\n\n화면은 apps/web/route_catalog.json을, 애플리케이션은 src/jungsi_touch/application/route_catalog.json을 사용한다. 두 파일과 이 문서는 공통 명세에서 생성하고 검사한다."+collaboration["api_handoff"])
    layers=table(["계층","코드 위치","책임","허용 의존"],[[l["label"],", ".join(l["roots"]),l["responsibility"],", ".join(l["allowed_dependencies"])] for l in spec["layers"]])
    implementation=table(["파일","계층","현재 상태","요구사항"],[[r["path"],r["layer"],{
"existing_math_foundation":"공통 계산 기반",
"access_policy_foundation_no_HTTP_authentication":"권한 기반 모듈; 실제 인증과 HTTP 연결 전",
"repository_interface":"저장소 인터페이스",
"overall_analysis_service_no_HTTP_or_persistence":"2페이지 분석 서비스; HTTP·영속저장 연결 전",
"synthetic_test_adapter_only":"합성 검산 전용 어댑터",
"generated_routing_contract_no_web_runtime":"라우팅 계약; 웹 실행 앱 연결 전"
}.get(r["status"],r["status"]),", ".join(r["requirements"])] for r in spec["implementation"]])
    files[spec["current_documents"]["architecture"]]=doc("정시터치 3티어 개발구조",
       "3티어는 화면·업무 처리·저장소의 책임과 접근 경계를 나눈다. 현재 계산 모듈의 경로를 보존하고 새 권한·저장소 인터페이스를 계층에 배치한다. 계층별 책임과 포트를 기준으로 구성하며 배포 환경과 실제 서버 연결 설정은 후속 구성이다.\n\n"+
       "## 계층과 의존 방향\n\n"+layers+
       "\n\n"+chr(96)*3+"mermaid\nflowchart LR\n  WEB[화면과 라우팅] --> API[인증된 서버와 업무 처리]\n  API --> ENGINE[성적 계산 엔진]\n  API --> PORT[저장소 인터페이스]\n  ADAPTER[비공개 저장소 어댑터] -.구현.-> PORT\n  ADAPTER --> DB[DB와 비공개 자료]\n"+chr(96)*3+
       "\n\n애플리케이션은 구체 DB 어댑터를 가져오지 않고 자신이 정의한 포트에 의존한다. 인프라가 포트를 구현한다. 프레젠테이션은 허용된 API 결과만 표시하며 Python 엔진·DB 비밀값·전체 환산표·곡선·모델을 포함하지 않는다.\n\n"+
       "## 커밋된 코드와 새 기반\n\n"+implementation+
       "\n\n기존 src/jungsi_touch 루트 계산 모듈은 애플리케이션의 엔진 라이브러리다. 경로를 옮겨 기존 사용자를 깨뜨리지 않는다. 새 application과 infrastructure를 통해 입출력·소유권·저장소를 연결한다. 메모리 어댑터는 합성 검산 전용으로 운영 연결을 의미하지 않는다.\n\n"+
       "## 데이터와 기술 결정\n\n실제 원자료·학생 성적·입결·환산표·곡선·모델과 .env 계열은 모든 브랜치에서 제외한다. database에는 DB 구조·마이그레이션 코드만 둘 수 있다. "+("FastAPI·Supabase PostgreSQL을 채택했다. UTC aware/timestamptz와 date를 구분하고 서버는 환경 설정만 읽는다. 실제 연결 설정·자료 승인·운영 배포는 대기다." if platform else "DB 엔진·웹 프레임워크·HTTP 서버 채택은 미정이다.")+"\n\n"+
       "## 구현과 운영 연결\n\n"+(runtime_intro if platform else "현재 계약과 권한 기반 다음에 실제 인증·저장·각 업무 서비스를 연결한다.")+" 각 단계는 승인된 자료가 없는 값을 사유와 함께 보류한다."+collaboration["ownership"]+collaboration["drive"])
    workflow=spec["workflow"]
    tools="\n".join("- "+p for p in workflow["shared_tools"])
    files[spec["current_documents"]["workflow"]]=doc("정시터치 개발 브랜치와 문서 운영",
       "main은 모든 작업 완료 후 최종 코드·문서·검증·인계를 정리하는 라이브 배포 전 후보다. develop은 시스템기획팀의 현재 문서 공유와 두 개발 담당의 PR 통합 환경이다. 시스템·콘텐츠와 프레젠테이션 개발은 각각 하나의 상시 브랜치를 사용한다. 과거 기획·시안은 이력으로 보존한다.\n\n"+
       "## 브랜치 흐름\n\n"+workflow["flow"]+"\n\n"+workflow["bootstrap_exception"]+
       "\n\n"+branch_governance_text(spec)+"\n\n현재 기준의 출발 커밋은 "+spec["baseline_commit"]+"이다. 작업 시작 시 현재 브랜치·HEAD·변경 목록을 확인한다. 커밋하지 않은 다른 작업자의 코드나 로컬 전용 검수 결과를 구현의 확정 기준으로 취급하지 않는다.\n\n"+
       "## 한 변경에 포함할 내용\n\n요구사항과 페이지/API 경로를 공통 명세에 반영하고 해당 계층의 코드를 수정한다. 문서와 경로 카탈로그를 생성하고 검사·검산한 뒤 같은 커밋으로 올린다. 코드·공유 도구·워크플로·테스트 변경이 있으면 공통 명세와 현재 기획·라우팅 문서가 같은 변경 목록에 있어야 한다. 변경 메모에 실제 구현 범위를 기록한다. develop에서 검증한 PR만 main에 반영한다. main 반영 후에도 develop을 통합 개발 기준으로 유지한다.\n\n"+
       "## 문서 생성과 검사 명령\n\n"+
       chr(96)*3+"text\n"+workflow["generate_command"]+"\n# 검토한 이번 작업 파일만 경로를 명시하여 stage\ngit add -- <reviewed-work-item-paths>\n"+workflow["validate_command"]+"\n"+workflow["test_command"]+"\n"+chr(96)*3+
       "\n\n검산은 선택한 Git 인덱스 또는 커밋의 파일을 새 outputs 폴더에 복사해서 실행한다. 커밋하지 않은 코드와 제외된 실제 데이터 의존 테스트를 섞지 않는다. 기존 파일·검산 폴더를 정리하거나 삭제하지 않는다.\n\n"+
       "## 로컬 훅과 GitHub 검사\n\n공통 문서·경로 계약·훅·새 계층 코드의 줄바꿈은 .gitattributes에서 LF로 고정해 Windows와 CI의 바이트 검사를 일치시킨다. 각 체크아웃에서 git config --local core.hooksPath .githooks를 설정한다. Python 경로가 필요하면 git config --local jungsi.python으로 실행기를 지정한다. pre-commit은 등록 브랜치·develop 직접 범위·파일 보존과 스테이징된 문서·코드·데이터 제외·합성 테스트를 검사한다. pre-push는 main 직접 푸시·ref 삭제·강제 갱신·develop 직접 범위를 차단한다. GitHub Actions의 검사 이름은 project-consistency다.\n\n"+
       "GitHub는 현재 비공개 저장소 보호 조회에 HTTP 403과 요금제 업그레이드 요구를 반환했다. 따라서 원격 PR·검사 통과 강제 보호는 활성화되지 않았다. 로컬 훅은 각 체크아웃에 적용되며 서버의 강제 보호와 같지 않다. 보호 지원 요금제에서 main에 PR·검사 통과, 강제 푸시·브랜치 삭제 금지 규칙을 적용한다. 저장소 비공개 상태는 유지한다.\n\n"+
       ("## 파일을 보존하는 CI 스냅샷\n\n"+table(['항목','실행 기준'],list(workflow['CI_snapshot_policy'].items()))+"\n\n" if workflow.get('CI_snapshot_policy') else '')+
       "## 공유 실행 도구\n\n"+tools+
       "\n\n실제 모집표·매핑·상담자료가 든 나머지 작업 도구와 원자료 검증 결과는 로컬 전용이다. 새 공통 도구를 공유하려면 명세의 공유 목록과 .gitignore를 함께 갱신한다.\n\n"+
       "## 공식 설정 근거\n\n[GitHub 브랜치 보호](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)와 [Python 자동 검사](https://docs.github.com/en/actions/tutorials/build-and-test-code/python)를 참고한다."+collaboration["ownership"])
    frontend=dict(format="jungsi.presentation-routes/v1",spec_version=spec["version"],source_sha256=digest,
        pages=[{k:p[k] for k in ["id","number","label","path","member_tiers","score_required_to_browse"]} for p in spec["pages"]],redirects=spec["redirects"],runtime_status="routing_contract_only")
    backend=dict(format="jungsi.application-routes/v1",spec_version=spec["version"],source_sha256=digest,
        pages=frontend["pages"],operations=spec["operations"],runtime_status="access_policy_foundation_no_HTTP_handlers")
    if overall_contract:
        frontend["overall_analysis_contract"]={key:overall_contract[key] for key in (
            "operation","format","required_inputs","optional_inputs","input_rules",
            "response_fields","exam_fields","subject_fields","overall_fields",
            "overall_statuses","number_format","tie_policy","pending_reasons","errors",
        )}
        backend["overall_analysis_contract"]=overall_contract
        backend["runtime_status"]="application_service_no_HTTP_handlers"
    if platform:
        frontend['operations']=[{key:row[key] for key in ('id','method','path','member_tiers','report_owner','confirmed_score_profile','requirements','response_scope','implementation_status','contract_ref','http_contract')} for row in spec['operations']]
        frontend['backend_contract']={key:platform[key] for key in ('format','code_status','live_server_status','live_data_status','authentication','writes','errors','dto_schemas','datetime')}
        backend['backend_platform_contract']=platform
        backend['runtime_status']='HTTP_workflows_implemented_live_configuration_pending'
    files["apps/web/route_catalog.json"]=json.dumps(frontend,ensure_ascii=False,indent=2)+"\n"
    files["src/jungsi_touch/application/route_catalog.json"]=json.dumps(backend,ensure_ascii=False,indent=2)+"\n"
    files["apps/web/README.md"]=doc("정시터치 프레젠테이션 개발 기준","현재 경로와 회원별 화면 접근 범위는 route_catalog.json을 따른다. [현재 기획](../../docs/current/서비스_기획.md)과 [라우팅 명세](../../docs/current/라우팅_명세.md)를 함께 갱신한다. 기존 가상 화면은 기획 이력이며 이 폴더의 실행 앱이 아니다. 실제 화면 앱·인증·API 연결은 후속 작업이다.\n\n화면은 서버가 허용한 결과만 표시하고 자체 대학 계산이나 DB 직접 조회를 구현하지 않는다. 브라우저의 회원등급 선택값을 운영 권한으로 사용하지 않는다."+collaboration["presentation_intro"])
    files["database/README.md"]=doc("정시터치 데이터 계층 개발 기준","이 폴더에는 실제 값이 없는 DB 구조·마이그레이션 코드만 추가할 수 있다. "+(platform['database'] if platform else "운영 DB 채택과 스키마는 미정이다.")+" 원자료·성적·입결·환산표·곡선·모델·덤프·접속 비밀값은 여기에 복사하지 않는다.\n\n실제 데이터는 Git 제외 폴더 또는 비공개 DB·스토리지에 두고 애플리케이션 포트를 통해 접근한다. [3티어 개발구조](../docs/current/3티어_개발구조.md)를 따른다."+collaboration["drive"])
    if spec["current_documents"].get("presentation_handoff"):
        files[spec["current_documents"]["presentation_handoff"]]=doc("프레젠테이션 담당과 작업 인계",collaboration["handoff"]+("\n\n## 연결할 서버 계약\n\n"+runtime_intro+" HTTP 응답은 UTC Z 시각을 표시 경계에서 Asia/Seoul로 변환하며 YYYY-MM-DD 날짜는 그대로 표시한다. Supabase 검증 access token과 쓰기 요청 Idempotency-Key, expected_version을 보내고 401/403/404/409 및 pending/null을 구분한다. GET print는 고정 revision 상담 DTO이며 인쇄/PDF 렌더링은 화면 담당이다." if platform else ''))
    if platform:
        gap_rows=[[r['operation'],r['before'],r['after'],r['storage'],r['verification'],r['external_settings'],r['live_data']] for r in platform['operation_gaps']]
        time_rows=[[key,value] for key,value in platform['datetime'].items()]
        runtime=platform['runtime']
        files[spec['current_documents']['backend_readiness']]=doc('백엔드 구현과 운영 준비',
            '자료 정리 전 구현 범위는 12개 HTTP/업무·서버 세션/이용권·저장/Drive 어댑터·추가 스키마·UTC 계약이다. code_status='+platform['code_status']+', live_server='+platform['live_server_status']+', live_data='+platform['live_data_status']+'. 실제 설정이 없는 운영 모드를 합성 인증/메모리 자료로 자동 대체하지 않는다.\n\n'+
            '출발 develop: '+platform['start_commit']+'; 공통 기획 기준: '+platform['planning_commit']+'. [작업 인수 기준](../work_items/DEV-002-pre-data-platform.json)을 따른다. PR/CI/통합 결과는 해당 GitHub 변경 증거로 확인한다.\n\n'+
            '## API별 전후 상태\n\n'+table(['API','시작 상태','구현 후','저장/자료','합성 검증','설정','실제 자료'],gap_rows)+'\n\n'+
            '## 실행과 설정\n\n'+table(['설정 이름','용도'],platform['configuration'])+'\n\n실제 값은 Git 제외 설정 또는 서버 환경변수에만 보관한다. .env 및 예시도 커밋하지 않으며 자동 .env 로더는 없다. 연결 값은 문서/HTTP/진단 stdout에 출력하지 않는다.\n\n'+
            '런타임 '+runtime['python']+'; 잠금 '+runtime['lock']+'.\n\n'+chr(96)*3+'text\n'+runtime['bootstrap']+'\n'+runtime['serve']+'\n'+runtime['probe']+'\n'+runtime['tests']+'\n'+chr(96)*3+'\n\n'+runtime['environment']+' SHA256 고정 공식 PyPI wheel을 새 목적지로 추출한다. 재실행에는 새로운 폴더를 지정한다. CI도 동일 lock을 사용한다. '+runtime.get('CI_checkout','')+'\n\n'+
            '## DB·헬스·실제 연결 확인\n\n'+platform['database']+'\n\n'+platform['health']+'\n\n읽기 전용 probe는 실제 설정이 있을 때 DB default/effective timezone·스키마/컬럼 형식과 가상 SQL literal instant/date 왕복만 검사한다. 실제 사용자 표 조회·수정·마이그레이션 적용은 하지 않는다. Auth는 별도 검수 토큰이 있을 때만 getUser를 호출한다. 실제 Drive 읽기/쓰기 검수는 현재 probe가 수행하지 않으므로 별도 승인 자료 실행 증거가 필요하다.\n\n'+
            '## UTC와 원본 날짜\n\n'+table(['계약','구현 기준'],time_rows)+'\n\n'+
            '## Drive 자료 계약\n\n'+table(['항목','계약'],[[k,', '.join(v) if isinstance(v,list) else v] for k,v in platform['drive_registry'].items()])+'\n\n'+
            '## 검증 범위와 남은 작업\n\n'+platform['verification']+'\n\n'+'\n'.join('- '+v for v in platform['remaining']))
        schemas=[]
        for name,schema in platform['dto_schemas'].items():
            schemas.append('### '+name+'\n\n'+('format: '+schema['format']+'\n\n' if schema.get('format') else '')+'필드: '+', '.join(schema['fields'])+'.'+('\n\n유료 추가 필드: '+', '.join(schema['paid_fields'])+'.' if schema.get('paid_fields') else '')+('\n\n'+table(['중첩 객체','필드'],[[k,', '.join(v)] for k,v in schema['nested'].items()]) if schema.get('nested') else '')+'\n\n'+'\n'.join('- '+v for v in schema['rules']))
        files[spec['current_documents']['api_dto']]=doc('HTTP API와 학생 DTO 계약',
            platform['authentication']+'\n\n'+platform['writes']+'\n\n권한은 body·query 검증/자료 조회/멱등 조회보다 먼저 검사한다. unknown field와 중복 query key는 거절한다. 숫자 점수/누적은 엔진의 소수 문자열이며 원자료/전체 분포/가중치/비밀값/로컬 출처 경로는 제공하지 않는다. 모든 응답은 Cache-Control: no-store다.\n\n'+
            '## 12개 요청과 응답\n\n'+table(['API','메서드/경로','본문','쿼리','응답 DTO','키 필수'],[[o['id'],o['method']+' '+o['path'],'; '.join(o['http_contract']['body']) or '없음',', '.join(o['http_contract']['query']) or '없음',o['http_contract']['response']+'; '+o['contract_ref'],o['http_contract']['idempotency_key_required']] for o in spec['operations']])+'\n\n모든 HTTP 업무 서비스는 PlatformService.execute이며 FastAPI create_app이 경로를 등록한다. 요청은 operations[].http_contract, 응답은 해당 contract_ref를 따른다. overall.analyze의 HTTP 응답은 persisted report이고 내부 overall 필드만 기존 OverallAnalysisService의 jungsi.overall-analysis/v1 엔진 DTO다. 두 객체를 루트 응답으로 혼동하지 않는다.\n\n'+
            '## 오류와 대기\n\n오류 객체는 {status:error,error:{code},request_id}이며 비밀값·예외 원문을 포함하지 않는다. 자료 대기는 200 응답의 status=pending/reason_code와 값 null로 구분한다. 전체 분석이 pending이어도 입력 총점·과목 결과는 보존한다.\n\n'+table(['오류 코드','HTTP','의미'],platform['errors'])+'\n\n대학 계산의 개별 자료 해시/버전/승인 불일치는 해당 assessment의 pending이다. 카탈로그 전체 형식/승인 실패와 공급 서비스 실패는 503이다.\n\n'+
            '## 응답 객체\n\n'+'\n\n'.join(schemas)+'\n\n## 시간 표시\n\n서버 instant는 UTC Z, 날짜는 YYYY-MM-DD다. 화면은 instant만 Asia/Seoul로 변환하고 date-only에 시각을 붙이지 않는다. 401은 재인증, 403은 현재 이용권, 409는 확인 성적/최신 revision·카탈로그/요청 키를 재확인한다. 재시도는 같은 본문·경로·키를 보존한다. UI/인쇄 렌더링은 별도 담당이다.')
    scoring=spec.get('university_scoring_contract')
    if scoring:
        public=scoring['public_result_contract']
        rules='\n\n'.join('## '+title+'\n\n'+'\n'.join('- '+row for row in scoring[key]) for title,key in [
            ('모집행과 규칙 결속','identity_rules'),('성적 입력','input_rules'),('실제·모평·보정 추정의 구분','score_basis_rules'),('계산 단계와 정확값','execution_rules'),('검증과 인수','acceptance_gates'),('실제 운영의 남은 자료','remaining')])
        files[spec['current_documents']['university_scoring']]=doc('대학별 수능 환산 엔진',
            '상태: '+scoring['code_status']+'. 작업 항목: [DEV-003](../work_items/DEV-003-university-scoring-engine.json). '+scoring['placement']+'\n\n'+
            '서비스: '+scoring['application_service']+'. API: '+scoring['api_path']+'. '+scoring['access']+'\n\n'+
            '## 참고 자료와 계산 범위\n\n'+scoring['reference_policy']+'\n\n'+scoring['calculation_scope']+'\n\n'+
            rules+'\n\n## 독립 자료 공급\n\n'+table(['항목','계약'],list(scoring['provider_contract'].items()))+'\n\n'+
            '## 공개 결과 DTO\n\n'+public['location']+'; 필드: '+', '.join(public['fields'])+'. 상태: '+', '.join(public['statuses'])+'.\n\n'+
            public['independence']+' '+public['compatibility']+'\n\n응답 제외: '+'; '.join(public['excluded'])+'.')
        receipt=scoring.get('execution_result')
        if receipt:
            marker='\n\n<!-- jungsi:generated'
            acceptance='\n\n## 기획팀 인수 결과\n\n'+table(['항목','증거'],[
                ['검토 커밋',receipt['reviewed_feature_commit']],
                ['develop 통합',receipt['integrated_develop_commit']],
                ['PR','[PR #10]('+receipt['pull_request']+')'],
                ['CI','[project-consistency]('+receipt['ci']['url']+'): '+receipt['ci']['conclusion']],
                ['합성 검증',str(receipt['ci']['synthetic_tests_passed'])+'개 통과; 추가 '+str(receipt['ci']['added_synthetic_tests'])+'개'],
                ['검토 범위',receipt['review_scope']],
                ['기존 근거 재사용',receipt['private_source_reuse']],
                ['통합문서 참고',receipt['reference_inspection']],
                ['실서버',receipt['live_server_status']],
                ['실제 자료',receipt['live_data_status']],
                ['운영 규칙',receipt['production_rule_status']]])
            path=spec['current_documents']['university_scoring']
            files[path]=files[path].replace(marker,acceptance+marker)
        for key in ('planning','routing','architecture','presentation_handoff','api_dto'):
            path=spec['current_documents'].get(key)
            if path in files:
                marker='\n\n<!-- jungsi:generated'
                section='\n\n## 대학별 수능 환산 연결\n\n[대학별 수능환산 엔진](대학별_수능환산_엔진.md)을 따른다. 구현 상태는 '+scoring['code_status']+'다. '+public['independence']+' 프레젠테이션은 독립 conversion 결과와 후속 지원 판단 상태를 표시하며 계산/조회표를 구현하지 않는다.'
                files[path]=files[path].replace(marker,section+marker)
        frontend['university_scoring_contract']={k:scoring[k] for k in ('format','code_status','operation','input_rules','score_basis_rules','public_result_contract')}
        backend['university_scoring_contract']=scoring
        files['apps/web/route_catalog.json']=json.dumps(frontend,ensure_ascii=False,indent=2)+'\n'
        files['src/jungsi_touch/application/route_catalog.json']=json.dumps(backend,ensure_ascii=False,indent=2)+'\n'
    percentile=spec.get('university_percentile_contract')
    if percentile:
        public=percentile['public_result_contract']
        rules='\n\n'.join('## '+title+'\n\n'+'\n'.join('- '+row for row in percentile[key]) for title,key in [
            ('계산과 독립 상태','calculation_rules'),('시험·규칙·모집행·모집단 결속','identity_rules'),
            ('화면 표시와 담당','presentation_rules'),('검증과 인수','acceptance_gates'),('실제 운영의 남은 자료','remaining')])
        files[spec['current_documents']['university_percentile']]=doc('대학별 환산 누백 계산',
            '상태: '+percentile['code_status']+'. 작업 항목: [DEV-004](../work_items/DEV-004-university-percentile.json). '+percentile['placement']+'\n\n'+
            '서비스: '+percentile['application_service']+'. API: '+percentile['api_path']+'. '+percentile['access']+'\n\n'+
            '## 누백의 정의\n\n'+percentile['definition']+'\n\n'+rules+'\n\n## 독립 자료 공급\n\n'+
            table(['항목','계약'],list(percentile['provider_contract'].items()))+'\n\n## 공개 결과 DTO\n\n'+
            public['location']+'; 필드: '+', '.join(public['fields'])+'. 상태: '+', '.join(public['statuses'])+'.\n\n'+
            public['independence']+' '+public['compatibility']+' '+public['data_kind']+'\n\n응답 제외: '+'; '.join(public['excluded'])+'.')
        receipt=percentile.get('execution_result')
        if receipt:
            path=spec['current_documents']['university_percentile']
            receipt_title='기획팀 인수 결과' if str(receipt.get('status','')).startswith('accepted_on_develop') else '구현·검증 결과'
            files[path]=files[path].replace('\n\n<!-- jungsi:generated','\n\n## '+receipt_title+'\n\n'+
                table(['항목','증거'],[(key,str(value)) for key,value in receipt.items()])+'\n\n<!-- jungsi:generated')
        for key in ('planning','routing','architecture','presentation_handoff','api_dto','backend_readiness'):
            path=spec['current_documents'].get(key)
            if path in files:
                section='\n\n## 대학별 누백 연결\n\n[대학별 누백 계산](대학별_누백_계산.md)을 따른다. 구현 상태는 '+percentile['code_status']+'다. '+public['independence']+' 프레젠테이션은 학교 환산 기준 상위 누백과 동점·자료 기준을 표시한다.'
                files[path]=files[path].replace('\n\n<!-- jungsi:generated',section+'\n\n<!-- jungsi:generated')
        frontend['university_percentile_contract']={key:percentile[key] for key in ('format','code_status','operation','definition','public_result_contract','presentation_rules')}
        backend['university_percentile_contract']=percentile
        files['apps/web/route_catalog.json']=json.dumps(frontend,ensure_ascii=False,indent=2)+'\n'
        files['src/jungsi_touch/application/route_catalog.json']=json.dumps(backend,ensure_ascii=False,indent=2)+'\n'
    estimated=spec.get('estimated_population_contract')
    if estimated:
        sections='\n\n'.join('## '+title+'\n\n'+'\n'.join('- '+row for row in estimated[key]) for title,key in [
            ('생성·보정 절차','workflow'),('출처와 모집단','source_and_population_rules'),
            ('검증과 승인','validation_rules'),('화면 연결','presentation_rules'),('인수 조건','acceptance_gates'),('남은 범위','remaining')])
        mapping=estimated['reported_score_mapping']
        files[spec['current_documents']['estimated_population']]=doc('자체 추정 공동분포와 대학 누백 생성',
            '상태: '+estimated['code_status']+'. 작업 항목: [DEV-005](../work_items/DEV-005-estimated-population.json). '+estimated['placement']+'\n\n'+
            '## 자체 추정의 기준\n\n'+estimated['definition']+'\n\n'+sections+'\n\n## 성적표 매핑\n\n'+mapping['formula']+'\n\n'+
            '['+mapping['source_scope']+']('+mapping['primary_source']+')\n\n'+'\n'.join('- '+row for row in mapping['rules'])+'\n\n'+
            '## 산출물 계약\n\n'+table(['산출물','계약'],list(estimated['output_contract'].items()))+'\n\n'+
            '## 팀별 담당\n\n'+table(['담당','작업'],list(estimated['ownership'].items()))+'\n\n## 비공개 자료와 보존\n\n'+estimated['private_storage'])
        receipt=estimated.get('execution_result')
        if receipt:
            path=spec['current_documents']['estimated_population']
            files[path]=files[path].replace('\n\n<!-- jungsi:generated','\n\n## 구현·인수 결과\n\n'+
                table(['항목','증거'],[(key,str(value)) for key,value in receipt.items()])+'\n\n<!-- jungsi:generated')
        for key in ('planning','routing','architecture','presentation_handoff','api_dto','backend_readiness'):
            path=spec['current_documents'].get(key)
            if path in files:
                section='\n\n## 자체 추정분포 연결\n\n[자체 추정분포 개발](자체_추정분포_개발.md)을 따른다. 상태는 '+estimated['code_status']+'다. '+estimated['definition']+' 전체 누백은 overall.status=estimated, 대학 누백은 percentile.data_kind=estimated_weights로 구분한다. 기존 API 권한·시험 결속·애플리케이션 소유 포트와 프레젠테이션 담당을 유지한다.'
                files[path]=files[path].replace('\n\n<!-- jungsi:generated',section+'\n\n<!-- jungsi:generated')
        frontend['estimated_population_contract']={key:estimated[key] for key in ('format','code_status','definition','presentation_rules')}
        backend['estimated_population_contract']=estimated
        files['apps/web/route_catalog.json']=json.dumps(frontend,ensure_ascii=False,indent=2)+'\n'
        files['src/jungsi_touch/application/route_catalog.json']=json.dumps(backend,ensure_ascii=False,indent=2)+'\n'
    if spec.get("repository_layout"):
        files[spec["current_documents"]["folder_structure"]]=doc("프로젝트 폴더 구조와 작업 위치",repository_layout_text(spec))
    # Shared analysis-connection/forecast contracts keep documents and routes atomic.
    for key,title in (("forecast_policy","학과별 예상 기준 산출과 관리"),("presentation_connection","성적 분석 화면과 실제 세션 연결")):
        contract=spec.get(key+"_contract")
        if not contract: continue
        body=contract_body(contract)
        files[spec["current_documents"][key]]=doc(title,body)
        for path in (spec["current_documents"]["planning"],spec["current_documents"]["routing"],spec["current_documents"]["architecture"]):
            files[path]+="\n## "+title+"\n\n"+body
        frontend[key+"_contract"]=contract
        backend[key+"_contract"]=contract
    if spec.get("management_pages"):
        frontend["management_pages"]=spec["management_pages"]
        backend["management_pages"]=spec["management_pages"]
        for path in (spec["current_documents"]["planning"],spec["current_documents"]["routing"]):
            files[path]+="\n## 관리 화면\n\n"+table(["화면","경로","서버 capability","설명"],[[r["label"],r["path"],", ".join(r["capabilities"]),r["purpose"]] for r in spec["management_pages"]])
    files["apps/web/route_catalog.json"]=json.dumps(frontend,ensure_ascii=False,indent=2)+"\n"
    files["src/jungsi_touch/application/route_catalog.json"]=json.dumps(backend,ensure_ascii=False,indent=2)+"\n"
    return {p:t.encode("utf-8") for p,t in files.items()}

def validate_forecast_contract(spec):
    """Check declared public boundaries without claiming engine/DB acceptance."""
    errors=[]
    forecast=spec.get('forecast_policy_contract')
    if not forecast or 'publication_context_contract' not in forecast:return errors
    connection=spec.get('presentation_connection_contract',{})
    schemas=spec.get('backend_platform_contract',{}).get('dto_schemas',{})
    if connection.get('current_team_scope') is None or connection.get('external_frontend_owner') is None:
        errors.append('External frontend ownership required')
    review=spec.get('contract_review',{})
    if review.get('candidate_only') and (review.get('verification_status')!='verification_pending' or review.get('frontend_source_modification_allowed') is not False):
        errors.append('Contract candidate status drift')
    for name in ('forecast_draft','forecast_list','forecast_public'):
        if connection.get('dto_shapes',{}).get(name)!=schemas.get(name):errors.append('Forecast DTO consumer contract drift: '+name)
    draft=schemas.get('forecast_draft',{})
    if 'base_result' not in draft.get('fields',[]):errors.append('Forecast original result required')
    for nested,field in (('validation','receipt_hash'),('approval','approval_hash')):
        if field not in draft.get('nested',{}).get(nested,[]):errors.append('Forecast receipt field missing: '+nested+'.'+field)
    if draft.get('nested',{}).get('audit_events')!=['action','actor','at']:errors.append('Forecast audit projection drift')
    projection=forecast['publication_context_contract']
    if connection.get('publication_context_contract')!=projection:errors.append('Forecast public context projection drift')
    required={'offering_id','academic_year','exam_id','source_pack_version','catalog_version','rule_id','rule_version','curve_version','analysis_version','score_scale_id','score_scope','bonus_treatment','population_id','comparison_metric','unit','direction','tie_policy'}
    if set(projection.get('fields',[]))!=required:errors.append('Forecast context bindings missing or undocumented')
    public=schemas.get('forecast_public',{})
    if public.get('nested',{}).get('context')!=projection.get('fields'):errors.append('Forecast public context field drift')
    if schemas.get('assessment',{}).get('nested',{}).get('decision_evidence.context')!=projection.get('fields'):errors.append('Assessment forecast context field drift')
    if not {'context','policy_version','input_version'}<=set(public.get('fields',[])):errors.append('Forecast published versions missing')
    if not {'context','policy_version','input_version'}<=set(schemas.get('assessment',{}).get('nested',{}).get('decision_evidence',[])):errors.append('Assessment forecast versions missing')
    denied=set(projection.get('private_fields_excluded',[]))
    if denied & set(public.get('fields',[])) or denied & set(projection.get('fields',[])):errors.append('Private forecast field in public projection')
    if connection.get('public_response_binding')!=forecast.get('public_response_binding') or forecast.get('public_response_binding',{}).get('same_context_projection') is not True:
        errors.append('Forecast response adoption binding drift')
    exact=forecast.get('exact_numeric_invariants',{})
    if exact.get('comparison_source')!='internal_exact_values' or exact.get('display_strings_are_comparison_inputs') is not False:
        errors.append('Forecast exact comparison invariant drift')
    comparison=forecast.get('comparison_contract',{})
    if comparison.get('comparison_metric_values')!=['converted_score','university_top_percent'] or comparison.get('total_overall_is_allowed_comparator') is not False:
        errors.append('Forecast comparison metric drift')
    for metric,direction,tie in [('converted_score','higher_is_better',None),('university_top_percent','lower_is_better','include_equal')]:
        policy=comparison.get(metric,{})
        if policy.get('direction')!=direction or 'tie_policy' not in policy or policy['tie_policy']!=tie:errors.append('Forecast comparison semantics drift: '+metric)
    groups=forecast.get('recommendation_reason_contract',{}).get('groups',{})
    if set(groups)!={'rule_application','support_assessment','conversion_advantage'} or connection.get('reason_code_groups')!=groups:
        errors.append('Forecast reason category drift')
    partition=forecast.get('candidate_partition_contract',{})
    for name,category in [('outside_offerings','outside'),('ineligible_offerings','ineligible'),('pending_offerings','pending')]:
        if partition.get(name,{}).get('category')!=category:errors.append('Forecast candidate partition drift: '+name)
    if not {'outside_offerings','ineligible_offerings','pending_offerings'}<=set(schemas.get('candidates',{}).get('fields',[])):errors.append('Candidate classification fields missing')
    readiness=forecast.get('database_readiness',{})
    if readiness.get('migration')!='database/migrations/002_forecast_policy.sql' or ((review.get('candidate_only') or forecast.get('verification_status')=='code_verified_live_NOT_RUN') and (readiness.get('status')!='NOT_RUN' or readiness.get('production_ready') is not False)):
        errors.append('Forecast DB readiness evidence drift')
    return errors


def validate_spec(spec):
    errors=[]
    if spec.get("format")!="jungsi.service-spec/v1":errors.append("Unsupported service specification")
    requirements={r["id"] for r in spec["requirements"]}
    pages=spec["pages"];ops=spec["operations"]
    if [p["number"] for p in pages]!=[1,2,3,4]:errors.append("Four ordered pages required")
    if len({p["path"] for p in pages})!=len(pages):errors.append("Duplicate page path")
    if len({o["id"] for o in ops})!=len(ops):errors.append("Duplicate operation ID")
    if len({(o["method"],o["path"]) for o in ops})!=len(ops):errors.append("Duplicate API method/path")
    operation_ids={o["id"] for o in ops}
    for row in pages+spec.get("management_pages",[])+ops+spec["implementation"]:
        if not set(row["requirements"])<=requirements:errors.append("Unknown requirement reference")
    for row in pages+spec.get("management_pages",[]):
        if not set(row["operations"])<=operation_ids:errors.append("Unknown page operation")
    if len(pages)>=4:
        if pages[0]["member_tiers"]!=["standard","paid"]:errors.append("Page1 member policy drift")
        if pages[2]["member_tiers"]!=["paid"] or pages[3]["member_tiers"]!=["paid"]:errors.append("Paid page policy drift")
        if pages[2]["score_required_to_browse"]:errors.append("Paid catalog must allow browsing without scores")
        if pages[3].get("desktop_columns")!=[2,1]:errors.append("Page4 two-to-one layout drift")
    management=spec.get("management_pages",[])
    if len({p["path"] for p in pages+management})!=len(pages+management): errors.append("Duplicate management page path")
    for row in management:
        if not row.get("capabilities") or not set(row["capabilities"])<={"editor","approver"}: errors.append("Management capability required")
    for row in ops:
        if row["id"].startswith("forecast.") and row["method"]=="POST" and not row["http_contract"]["idempotency_key_required"]:
            errors.append("Forecast writes require idempotency")
        if row["id"] in {"forecast.approve","forecast.publish"} and row.get("operator_capabilities")!=["approver"]:
            errors.append("Forecast approval capability drift")
        if row["id"]=="forecast.published.read" and row["member_tiers"]!=["paid"]: errors.append("Forecast public analysis is paid")
    for row in ops:
        if not row["member_tiers"] or not set(row["member_tiers"])<={"standard","paid"}:errors.append("Invalid member tiers")
        if row["confirmed_score_profile"] and not row["report_owner"]:errors.append("Confirmed analysis needs report ownership")
        if "{report_id}" in row["path"] and not row["report_owner"]:errors.append("Report path missing ownership check")
        if row["id"] in {"offerings.search","offering.read"} and (row["member_tiers"]!=["paid"] or row["report_owner"] or row["confirmed_score_profile"]):
            errors.append("Paid catalog search policy drift")
        if row["id"] in {"university.analyze","candidates.build","report.export","statistics.read","shortlist.update"} and row["member_tiers"]!=["paid"]:
            errors.append("Paid personal operation policy drift")
        unknown=set(re.findall(r"\{([^}]+)\}",row["path"]))-set(spec["routing_policy"]["template_placeholders"])
        if unknown:errors.append("Unregistered API parameter")
    contract=spec.get("overall_analysis_contract")
    if contract:
        operation=next((o for o in ops if o["id"]=="overall.analyze"),None)
        if not operation or operation["member_tiers"]!=["standard","paid"] or operation["report_owner"] or operation["confirmed_score_profile"]:
            errors.append("Overall analysis access policy drift")
        if operation and operation.get('engine_service',operation.get("application_service"))!=contract["application_service"]:
            errors.append("Overall analysis service reference drift")
        if not contract["stateless"] or contract['http_handler_implemented']!=bool(spec.get('backend_platform_contract',{}).get('http_implemented')):
            errors.append("Overall application boundary drift")
    platform=spec.get('backend_platform_contract')
    if platform:
        if {r['operation'] for r in platform['operation_gaps']}!=operation_ids:errors.append('Backend readiness operation drift')
        if len(platform['operation_gaps'])!=len(ops):errors.append('Duplicate backend readiness operation')
        if any('http_contract' not in o or 'implementation_status' not in o for o in ops):errors.append('Missing HTTP DTO contract')
        if platform['approved_stack']['HTTP']!='FastAPI' or platform['approved_stack']['database']!='Supabase PostgreSQL':errors.append('Approved backend stack drift')
        for operation in ops:
            schema=operation.get('http_contract',{}).get('response_schema')
            if schema not in platform['dto_schemas'] or operation.get('contract_ref')!='backend_platform_contract.dto_schemas.'+str(schema):errors.append('HTTP response schema reference drift')
            if operation.get('application_service')!='jungsi_touch.application.platform.PlatformService.execute':errors.append('HTTP application service reference drift')
    if spec["workflow"]["release_branch"]!="main" or spec["workflow"]["integration_branch"]!="develop":
        errors.append("Branch policy drift")
    from check_branch_policy import validate_governance
    errors.extend(validate_governance(spec))
    errors.extend(validate_forecast_contract(spec))
    return errors

def protected_path(path,shared_tools):
    p=PurePosixPath(path);parts=[v.lower() for v in p.parts];name=parts[-1]
    if any(v in PRIVATE_DIRS for v in parts[:-1]):return True
    if name==".env" or name.startswith(".env.") or ".env." in name or name.endswith(".env"):return True
    if name.startswith("data_active") and name.endswith(".json"):return True
    if p.suffix.lower() in PRIVATE_SUFFIXES or name.endswith((".db-wal",".db-shm",".sql.gz")):return True
    if path in PRIVATE_NAMES:return True
    if path.startswith("docs/implementation/"):return True
    if path.startswith("docs/") and (name=="검증_기록.json" or (name.startswith("verification") and name.endswith(".json")) or name=="design_verification.json"):return True
    if path.startswith("scripts/") and path not in shared_tools:return True
    return False

def validate_content(paths,read,spec):
    errors=validate_spec(spec)
    names=set(paths)
    for path,expected in generated_files(spec).items():
        if path not in names:errors.append("Missing generated file: "+path)
        elif read(path)!=expected:errors.append("Document or route drift: "+path)
    for path in paths:
        if protected_path(path,spec["workflow"]["shared_tools"]):errors.append("Private file tracked: "+path)
        content=read(path)
        if TOKEN_PATTERN.search(content):errors.append("Credential pattern in shared file: "+path)
        if path.startswith(("docs/planning/","docs/architecture/")) and path.endswith(".md"):
            if b"<!-- jungsi:historical -->" not in content:errors.append("Unmarked historical document: "+path)
        if path.startswith("apps/web/") and Path(path).suffix in {".js",".ts",".tsx",".jsx",".html"}:
            if re.search(rb"jungsi_touch|SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL|postgres(?:ql)?://",content):
                errors.append("Presentation boundary violation: "+path)
        if path.startswith("src/jungsi_touch/") and path.endswith(".py"):
            tree=ast.parse(content.decode("utf-8-sig"),filename=path)
            if not path.startswith("src/jungsi_touch/infrastructure/"):
                for node in ast.walk(tree):
                    imports=[a.name for a in node.names] if isinstance(node,ast.Import) else ([node.module or ""] if isinstance(node,ast.ImportFrom) else [])
                    if any(name.startswith(("jungsi_touch.infrastructure","infrastructure","apps.web","psycopg","asyncpg","sqlalchemy","supabase")) for name in imports):
                        errors.append("Application concrete infrastructure import: "+path)
    for row in spec["implementation"]:
        path=row["path"]
        if path not in names:errors.append("Implementation reference absent: "+path);continue
        if path.endswith(".py"):
            tree=ast.parse(read(path).decode("utf-8-sig"),filename=path)
            symbols={node.name for node in ast.walk(tree) if isinstance(node,(ast.ClassDef,ast.FunctionDef,ast.AsyncFunctionDef))}
            if not set(row["symbols"])<=symbols:errors.append("Implementation symbol absent: "+path)
    for path in spec["source_documents"]:
        if path not in names:errors.append("Committed source reference absent: "+path)
    if "README.md" not in names or b"<!-- jungsi:current -->" not in read("README.md"):
        errors.append("README missing current planning pointer")
    if "AGENTS.md" not in names or b"docs/current/service_spec.json" not in read("AGENTS.md"):
        errors.append("AGENTS missing current specification authority")
    return sorted(set(errors))

def validate_changed_paths(changed,spec):
    watched=("src/","apps/","database/",".github/workflows/",".githooks/","tests/")
    code_changed=any(p.startswith(watched) and not p.endswith(".md") for p in changed)
    code_changed=code_changed or bool(set(changed)&set(spec["workflow"]["shared_tools"]))
    required={SPEC_PATH,spec["current_documents"]["planning"],spec["current_documents"]["routing"]}
    if code_changed and not required<=set(changed):
        return ["Code changed without matching specification planning and routing in the same commit"]
    return []

def snapshot_changed_paths(snapshot):
    if snapshot.staged:
        raw=git("diff","--cached","--name-only","-z")
    elif snapshot.revision:
        raw=git("diff",snapshot.revision+"^",snapshot.revision,"--name-only","-z")
    else:
        return []
    return [p.decode("utf-8") for p in raw.split(bytes([0])) if p]

def write_generated(spec):
    timestamp=datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup=ROOT/"outputs/document_sync"/timestamp
    for name,content in generated_files(spec).items():
        target=ROOT/name
        if target.exists() and target.read_bytes()==content:continue
        if target.exists():
            previous=backup/name;previous.parent.mkdir(parents=True,exist_ok=True)
            with previous.open("xb") as file:file.write(target.read_bytes())
        target.parent.mkdir(parents=True,exist_ok=True)
        target.write_bytes(content)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    mode=parser.add_mutually_exclusive_group()
    mode.add_argument("--staged",action="store_true")
    mode.add_argument("--revision")
    mode.add_argument("--write",action="store_true")
    args=parser.parse_args()
    if args.write:
        spec=json.loads((ROOT/SPEC_PATH).read_text(encoding="utf-8"))
        errors=validate_spec(spec)
        if errors:raise ValueError("; ".join(errors))
        write_generated(spec)
        print("Generated current documents and route catalogs without deleting files.")
        return 0
    snapshot=GitSnapshot(staged=args.staged,revision=args.revision)
    spec=json.loads(snapshot.text(SPEC_PATH))
    errors=validate_content(snapshot.paths,snapshot.read,spec)
    errors.extend(validate_changed_paths(snapshot_changed_paths(snapshot),spec))
    commit=snapshot.revision or "HEAD"
    baseline_check=subprocess.run(["git","merge-base","--is-ancestor",spec["baseline_commit"],commit],cwd=ROOT,capture_output=True)
    if baseline_check.returncode!=0:errors.append("Development baseline is not an ancestor of the selected commit")
    report=dict(checked_files=len(snapshot.paths),pages=len(spec["pages"]),operations=len(spec["operations"]),requirements=len(spec["requirements"]),
                generated_files=len(generated_files(spec)),snapshot=snapshot.revision or ("index" if args.staged else "working_tree"),passed=not errors,errors=errors)
    print(json.dumps(report,ensure_ascii=False,indent=2))
    return 1 if errors else 0

if __name__=="__main__":
    try:raise SystemExit(main())
    except (ValueError,KeyError,OSError,subprocess.CalledProcessError) as error:
        print("Project consistency check failed: "+str(error),file=sys.stderr)
        raise SystemExit(1)
