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
        c["presentation_branch_example"]+"처럼 별도 feature/presentation-* 브랜치를 사용한다. "+
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
    intro=("\n\n프레젠테이션은 별도 작업자가 담당한다. 최신 origin/develop 커밋에서 feature/presentation-*를 생성하고 "+
        c["existing_application_feature"]+"와 브랜치를 공유하지 않는다. "+c["generated_files_rule"]+
        " [프레젠테이션 작업 인계](../../docs/current/프레젠테이션_작업인계.md)를 읽고 출발 커밋과 API 계약을 맞춘다.")
    api_handoff=("\n\n## 프레젠테이션 작업 인계\n\n화면 담당은 별도 작업자이며 feature/presentation-*에서 작업한다. "+
        "현재 개발팀은 서버 API와 애플리케이션·데이터/인프라를 담당한다. "+
        "[프레젠테이션 작업 인계](프레젠테이션_작업인계.md)에 담당·브랜치·연동 경계를 기록한다. "+
        (d["presentation_boundary"] if d else ""))
    handoff=("이 문서는 별도 프레젠테이션 작업자가 화면 개발을 시작할 때 사용할 담당·브랜치·API 경계다. "+
        "작업 기준은 develop의 확정 커밋과 같은 커밋의 service_spec.json·route_catalog.json이다.\n\n"+
        "## 작업 시작과 공유 계약\n\n"+c["start_rule"]+"\n\n"+
        "프레젠테이션 작업자는 "+c["presentation_branch_example"]+"와 같은 독립 브랜치를 생성한다. "+
        "시스템기획팀의 feature/planning-*와 현재 개발팀의 "+c["existing_application_feature"]+
        " 또는 feature/application-*/feature/data-*에 함께 커밋하지 않는다.\n\n"+
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
    files[spec["current_documents"]["planning"]]=doc("정시터치 현재 서비스 기획",
       "학생·학부모가 전체 성적 위치에서 출발해 유리한 대학·학과와 핵심 지원 학교를 찾는 상담 서비스다. 교사·입시담당자는 부 사용자다. 현재는 계산·권한·라우팅의 개발 기반이며 운영 서비스 완성을 의미하지 않는다.\n\n"+
       "## 화면과 회원 정책\n\n"+table(["페이지","화면","경로","회원","역할"],page_rows)+
       "\n\n1페이지의 실제 결과 조회 네 학년도는 자료 공개 범위에 따라 별도 확정한다. 2024~2027 성적 환산 비교와 결과 공개 연도를 혼동하지 않는다. 3페이지는 검색부터 상세까지 유료 전용이며 성적이 없어도 유료 검색을 허용한다. 개인 분석이 준비되지 않으면 이유와 함께 보류한다.\n\n"+
       "## 확정 요구사항\n\n"+requirement_text+"\n\n## 이번 버전의 변경\n\n"+changes+"\n\n## 준비 상태와 후속 구현\n\n"+pending+
       "\n\n현재 구현 기준은 [라우팅 명세](라우팅_명세.md), [3티어 개발구조](3티어_개발구조.md), [개발 브랜치 운영](개발_브랜치_운영.md)과 함께 읽는다."+collaboration["ownership"]+collaboration["drive"])
    operation_rows=[[o["id"],o["method"],o["path"],rights(o["member_tiers"]),"본인" if o["report_owner"] else "해당 없음","필요" if o["confirmed_score_profile"] else "불필요",o["response_scope"]] for o in spec["operations"]]
    session_contract=spec.get("session_contract")
    session_section=""
    if session_contract:
        session_section=("## 화면 표시용 본인 회원 등급\n\n"+
            session_contract["purpose"]+"\n\n작업: "+session_contract["operation"]+
            ". 응답 필드: "+", ".join(session_contract["response_fields"])+
            ". 회원 등급 값: "+", ".join(session_contract["member_tier_values"])+".\n\n"+
            "- 미인증: "+session_contract["unauthenticated"]+"\n"+
            "- 시각: "+session_contract["time_format"]+"\n"+
            "- 화면 규칙: "+session_contract["presentation_rule"]+
            "\n\n응답 제외: "+"; ".join(session_contract["excludes"])+".\n\n")
    technology=spec.get("technology")
    technology_text=("현재 DB 엔진·Supabase·웹 프레임워크·HTTP 서버 채택은 미정이며 연결 비밀값을 문서나 코드로 대신하지 않는다." if not technology else
        "기술 구성은 아래 표를 따른다. 상태가 proposed 인 항목은 기획팀 승인 전 제안이다. 연결 비밀값을 문서나 코드로 대신하지 않는다.\n\n"+
        table(["계층","선택","상태","비고"],[[t["layer"],t["choice"],t["status"],t["note"]] for t in technology]))
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
       "화면 URL과 서버 API 계약을 같은 요구사항에 연결한다. 아래 API는 연결 예정 계약이며 HTTP 핸들러가 등록된 상태가 아니다. 기존 성적 엔진과 권한 기반 모듈을 연결할 때 이 계약을 따른다.\n\n"+
       "## 화면 경로\n\n"+table(["페이지","화면","경로","회원","역할"],page_rows)+
       "\n\n루트 /는 /admissions/results로 연결한다. 비회원의 1페이지 접근은 미정이며 현재 권한 기반의 기본값은 인증 필요다. 로그인된 일반·유료 사용자의 1페이지 접근은 성적 입력을 요구하지 않는다.\n\n"+
       "## 서버 API 계약\n\n"+table(["작업 ID","메서드","경로","회원","리포트 소유권","성적 확인","응답 범위"],operation_rows)+
       "\n\n정적 경로 /offerings/search를 /offerings/{offering_id}보다 먼저 등록한다. report_id와 offering_id의 표기를 통일한다. 검색은 추천 목록과 조인해 대상을 줄이지 않는다.\n\n"+
       "## 권한과 응답 경계\n\n서버가 검증한 세션·현재 이용권으로 Actor를 만든다. 요청 본문의 회원등급·학생 ID를 신뢰하지 않는다. 미인증은 401, 일반가입자의 유료 요청은 403으로 차단하고 결과·건수·상세를 반환하지 않는다. 없는 리포트와 타인 소유 리포트는 같은 404로 처리한다. 본인 분석에 확인한 성적이 없으면 409와 보류 사유다.\n\n"+
       "권한 모듈은 HTTP 인증이나 응답 필드 제거 기능을 대신하지 않는다. 실제 핸들러에서 입력 검증, 운영 저장소 조회, 회원별 응답 객체, 분포·산식 승인 검사를 연결해야 한다. 학부모·상담자 위임은 아직 본인 권한으로 간주하지 않는다.\n\n"+
       session_section+overall_section+"## 함께 생성하는 계약\n\n화면은 apps/web/route_catalog.json을, 애플리케이션은 src/jungsi_touch/application/route_catalog.json을 사용한다. 두 파일과 이 문서는 공통 명세에서 생성하고 검사한다."+collaboration["api_handoff"])
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
       "3티어는 화면·업무 처리·저장소의 책임과 접근 경계를 나눈다. 현재 계산 모듈의 경로를 보존하고 새 권한·저장소 인터페이스를 계층에 배치한다. 서버 세 대를 요구하는 설계가 아니며 운영 기술과 배포 방식은 후속 결정이다.\n\n"+
       "## 계층과 의존 방향\n\n"+layers+
       "\n\n"+chr(96)*3+"mermaid\nflowchart LR\n  WEB[화면과 라우팅] --> API[인증된 서버와 업무 처리]\n  API --> ENGINE[성적 계산 엔진]\n  API --> PORT[저장소 인터페이스]\n  ADAPTER[비공개 저장소 어댑터] -.구현.-> PORT\n  ADAPTER --> DB[DB와 비공개 자료]\n"+chr(96)*3+
       "\n\n애플리케이션은 구체 DB 어댑터를 가져오지 않고 자신이 정의한 포트에 의존한다. 인프라가 포트를 구현한다. 프레젠테이션은 허용된 API 결과만 표시하며 Python 엔진·DB 비밀값·전체 환산표·곡선·모델을 포함하지 않는다.\n\n"+
       "## 커밋된 코드와 새 기반\n\n"+implementation+
       "\n\n기존 src/jungsi_touch 루트 계산 모듈은 애플리케이션의 엔진 라이브러리다. 경로를 옮겨 기존 사용자를 깨뜨리지 않는다. 새 application과 infrastructure를 통해 입출력·소유권·저장소를 연결한다. 메모리 어댑터는 합성 검산 전용으로 운영 연결을 의미하지 않는다.\n\n"+
       "## 데이터와 기술 결정\n\n실제 원자료·학생 성적·입결·환산표·곡선·모델과 .env 계열은 모든 브랜치에서 제외한다. database에는 DB 구조·마이그레이션 코드만 둘 수 있다. "+technology_text+"\n\n"+
       "## 구현 순서\n\n현재 계약과 권한 기반 검증 다음에 로그인·결제·운영 저장소를 연결한다. 이후 1페이지 공식 조회와 2페이지 입력·전체 누적, 3페이지 학과별 분석, 4페이지 추천·리포트와 실시간 집계를 순서대로 연결한다. 각 단계는 승인된 자료가 없는 값을 보류한다."+collaboration["ownership"]+collaboration["drive"])
    workflow=spec["workflow"]
    tools="\n".join("- "+p for p in workflow["shared_tools"])
    files[spec["current_documents"]["workflow"]]=doc("정시터치 개발 브랜치와 문서 운영",
       "main은 검증한 최종 코드와 그 코드에 일치하는 현재 문서를 보관한다. develop은 통합 개발, feature/*는 개별 작업에 사용한다. 과거 기획과 시안은 역사 자료로 표시해 보존하고 현재 개발 기준과 구분한다.\n\n"+
       "## 브랜치 흐름\n\n"+workflow["flow"]+"\n\n"+workflow["bootstrap_exception"]+
       "\n\n현재 기준의 출발 커밋은 "+spec["baseline_commit"]+"이다. 작업 시작 시 현재 브랜치·HEAD·변경 목록을 확인한다. 커밋하지 않은 다른 작업자의 코드나 로컬 전용 검수 결과를 구현의 확정 기준으로 취급하지 않는다.\n\n"+
       "## 한 변경에 포함할 내용\n\n요구사항과 페이지/API 경로를 공통 명세에 반영하고 해당 계층의 코드를 수정한다. 문서와 경로 카탈로그를 생성하고 검사·검산한 뒤 같은 커밋으로 올린다. 코드·공유 도구·워크플로·테스트 변경이 있으면 공통 명세와 현재 기획·라우팅 문서가 같은 변경 목록에 있어야 한다. 변경 메모에 실제 구현 범위를 기록한다. develop에서 검증한 PR만 main에 반영한다. main 반영 후에도 develop을 통합 개발 기준으로 유지한다.\n\n"+
       "## 문서 생성과 검사 명령\n\n"+
       chr(96)*3+"text\n"+workflow["generate_command"]+"\n# 검토한 이번 작업 파일만 경로를 명시하여 stage\ngit add -- <reviewed-work-item-paths>\n"+workflow["validate_command"]+"\n"+workflow["test_command"]+"\n"+chr(96)*3+
       "\n\n검산은 선택한 Git 인덱스 또는 커밋의 파일을 새 outputs 폴더에 복사해서 실행한다. 커밋하지 않은 코드와 제외된 실제 데이터 의존 테스트를 섞지 않는다. 기존 파일·검산 폴더를 정리하거나 삭제하지 않는다.\n\n"+
       "## 로컬 훅과 GitHub 검사\n\n공통 문서·경로 계약·훅·새 계층 코드의 줄바꿈은 .gitattributes에서 LF로 고정해 Windows와 CI의 바이트 검사를 일치시킨다. 각 체크아웃에서 git config --local core.hooksPath .githooks를 설정한다. Python 경로가 필요하면 git config --local jungsi.python으로 실행기를 지정한다. pre-commit은 스테이징된 문서·코드·데이터 제외와 합성 테스트를 검사하고 pre-push는 main 직접 푸시를 차단한다. GitHub Actions의 검사 이름은 project-consistency다.\n\n"+
       "GitHub는 현재 비공개 저장소 보호 조회에 HTTP 403과 요금제 업그레이드 요구를 반환했다. 따라서 원격 PR·검사 통과 강제 보호는 활성화되지 않았다. 로컬 훅은 각 체크아웃에 적용되며 서버의 강제 보호와 같지 않다. 보호 지원 요금제에서 main에 PR·검사 통과, 강제 푸시·브랜치 삭제 금지 규칙을 적용한다. 저장소 비공개 상태는 유지한다.\n\n"+
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
    if session_contract:
        frontend["session_contract"]=session_contract
        backend["session_contract"]=session_contract
    files["apps/web/route_catalog.json"]=json.dumps(frontend,ensure_ascii=False,indent=2)+"\n"
    files["src/jungsi_touch/application/route_catalog.json"]=json.dumps(backend,ensure_ascii=False,indent=2)+"\n"
    files["apps/web/README.md"]=doc("정시터치 프레젠테이션 개발 기준","현재 경로와 회원별 화면 접근 범위는 route_catalog.json을 따른다. [현재 기획](../../docs/current/서비스_기획.md)과 [라우팅 명세](../../docs/current/라우팅_명세.md)를 함께 갱신한다. 기존 가상 화면은 기획 이력이며 이 폴더의 실행 앱이 아니다. 실제 화면 앱·인증·API 연결은 후속 작업이다.\n\n화면은 서버가 허용한 결과만 표시하고 자체 대학 계산이나 DB 직접 조회를 구현하지 않는다. 브라우저의 회원등급 선택값을 운영 권한으로 사용하지 않는다."+collaboration["presentation_intro"])
    files["database/README.md"]=doc("정시터치 데이터 계층 개발 기준","이 폴더에는 실제 값이 없는 DB 구조·마이그레이션 코드만 추가할 수 있다. 운영 DB 채택과 스키마는 아직 확정하지 않았다. 원자료·성적·입결·환산표·곡선·모델·덤프·접속 비밀값은 여기에 복사하지 않는다.\n\n실제 데이터는 Git 제외 폴더 또는 비공개 DB·스토리지에 두고 애플리케이션 포트를 통해 접근한다. [3티어 개발구조](../docs/current/3티어_개발구조.md)를 따른다."+collaboration["drive"])
    if spec["current_documents"].get("presentation_handoff"):
        files[spec["current_documents"]["presentation_handoff"]]=doc("프레젠테이션 담당과 작업 인계",collaboration["handoff"])
    return {p:t.encode("utf-8") for p,t in files.items()}

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
    for row in pages+ops+spec["implementation"]:
        if not set(row["requirements"])<=requirements:errors.append("Unknown requirement reference")
    for row in pages:
        if not set(row["operations"])<=operation_ids:errors.append("Unknown page operation")
    if len(pages)>=4:
        if pages[0]["member_tiers"]!=["standard","paid"]:errors.append("Page1 member policy drift")
        if pages[2]["member_tiers"]!=["paid"] or pages[3]["member_tiers"]!=["paid"]:errors.append("Paid page policy drift")
        if pages[2]["score_required_to_browse"]:errors.append("Paid catalog must allow browsing without scores")
        if pages[3].get("desktop_columns")!=[2,1]:errors.append("Page4 two-to-one layout drift")
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
    session=spec.get("session_contract")
    if session:
        operation=next((o for o in ops if o["id"]==session["operation"]),None)
        if not operation or operation["member_tiers"]!=["standard","paid"] or operation["report_owner"] or operation["confirmed_score_profile"]:
            errors.append("Session operation policy drift")
        if session["member_tier_values"]!=["standard","paid"]:
            errors.append("Session tier values drift")
    contract=spec.get("overall_analysis_contract")
    if contract:
        operation=next((o for o in ops if o["id"]=="overall.analyze"),None)
        if not operation or operation["member_tiers"]!=["standard","paid"] or operation["report_owner"] or operation["confirmed_score_profile"]:
            errors.append("Overall analysis access policy drift")
        if operation and operation.get("application_service")!=contract["application_service"]:
            errors.append("Overall analysis service reference drift")
        if not contract["stateless"] or contract["http_handler_implemented"]:
            errors.append("Overall application boundary drift")
    if spec["workflow"]["release_branch"]!="main" or spec["workflow"]["integration_branch"]!="develop":
        errors.append("Branch policy drift")
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
