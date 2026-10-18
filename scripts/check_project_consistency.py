"""Generate current documents and validate the selected Git snapshot.
No file deletion. --write preserves prior generated content under ignored outputs.
"""
from __future__ import annotations
import argparse,ast,datetime,hashlib,json,re,subprocess,sys,posixpath
from pathlib import Path,PurePosixPath
from audit_documentation_sync import AGENT_MARKER,generated_sync_files,live_execution_progress_rows,validate_catalog,validate_sync_policy

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
        '\n\n## 브랜치 등록부와 최신 통합 관측\n\n정책 등록일 '+g['checked_date']+', 등록 기준 '+g['reference_commit']+'. 등록부의 상시 '+str(len(g['core_branches']))+'개, 진행 임시 '+str(sum(r.get('status')=='active' for r in g['additional_branches']))+'개, 종료 이력 '+str(sum(r.get('status')!='active' for r in g['additional_branches']))+'개로 분류한다. 현재 원격 전체 ref 재조회 결과와 구분한다. 관측 커밋은 당시 증거이며 작업 브랜치의 미래 HEAD를 고정하는 값이 아니다.\n\n최신 통합 관측일 '+g['remote_inventory']['latest_observation']['date']+', develop '+g['remote_inventory']['latest_observation']['develop']+'. '+g['remote_inventory']['latest_observation']['source']+'\n\n'+extras+'\n\n'+g['remote_inventory']['note']+
        '\n\nPR #5의 중복 제안은 종료됐고 head/ref는 보존한다. 정식 session.read 계약과 동적 경로 제목 검사는 현행 공통 도구로 계승했다. '+spec['collaboration']['presentation_branch_status']+' 종료 ref는 새 개발에서 제외하고 보존한다. 후속 PR 담당은 최신 develop과 충돌을 해결한 뒤 등록 부모에 통합한다.\n\n'+g['lifecycle_rule']+
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


def deletion_scope_text(spec):
    policy=spec['workflow']['branch_governance'].get('file_deletion_policy')
    if not policy:return ''
    record=policy['record']
    return ('\n\n## DEV006⑦ 정확한 파일 삭제 승인 검사\n\n기본값은 deny다. develop947 이후 등록·공통 검사는 시스템기획팀, 실제 삭제와 화면 검증은 외부 화면 개발팀의 범위다. 서비스 개발팀은 서비스 계층만 담당한다. 삭제 승인 등록 당시의 역사 관측 상태: '+policy['execution_state']+'. 이 관측을 현재 PR 통합 상태로 취급하지 않는다. 별도 develop 선행 등록 전에는 후보가 스스로 승인할 수 없다.\n\n'+
        table(['정확한 경로','mode','고정 Git blob','원본 바이트 SHA256'],[[r['path'],r['mode'],r['blob'],r['sha256']] for r in record['files']])+'\n\n출발 브랜치: '+record['origin_branch']+'; 출발 커밋: '+record['source_commit']+'; 사용자 메시지: '+record['user_evidence']['message_id']+'; 요청서 SHA256: '+record['source_request_sha256']+'. 원본과 이전 버전은 보존한다. 최초 삭제와 승인된 삭제의 부모 병합 승계를 구분하고 다른 경로·수정/복원 후 재사용·병렬 삭제 origin의 재소비·과거 소급·숨긴 sideparent·ref 삭제·force를 거절한다. 동일한 승인 삭제 origin을 develop/main으로 운반하는 정상 병합과 새로운 삭제 사건은 구분한다.')


def common_tools_acceptance_text(spec):
    receipt=spec.get('contract_review',{}).get('common_tools_acceptance')
    if not receipt:return ''
    checks=receipt['normal_commit_push_hooks'];ci=receipt['exact_HEAD_CI']
    inventory=spec['workflow']['branch_governance']['remote_inventory']
    front=inventory.get('historical_observation_before_PR6_merge',inventory['latest_observation'])
    deletion=spec['workflow']['branch_governance'].get('file_deletion_policy',{})
    return ('\n\n## 공통 도구의 확인된 이전 인수 기준\n\n'+
        table(['범위','확인한 증거'],[
            ['공통 Git/CI 검사·명세·생성 문서',receipt['commit']+'; tree '+receipt['tree']],
            ['정상 commit/push 훅',str(checks['tests_run'])+'건 PASS; 실패 '+str(checks['failures'])+'·오류 '+str(checks['errors'])+'·건너뜀 '+str(checks['skipped'])],
            ['정확한 HEAD GitHub CI','[project-consistency]('+ci['url']+'): '+ci['conclusion']],
            ['서비스·DB 역사 기준',receipt['service_DB_baseline']],
            ['당시 외부 프런트 관측',front['frontend']+'; '+front['sameRelease_observation']],
            ['승인 등록 당시 외부 삭제 관측',deletion.get('execution_state','NOT_RUN')+'; 이후 develop 통합과 실제 브라우저 인수는 각각의 정확한 증거로 구분한다.'],
            ['운영/외부 인수',receipt['frontend_acceptance']+'; DB .env 추후; main '+receipt['main_release_state']]
        ])+'\n\n'+receipt['publication_rule']+' '+receipt['scope']+
        ' 이전 e12/676 버전값 보완 pending은 역사이며 최신 소스 관측과 실제 프런트 인수 대기를 구분한다. 최소 profile 조건 읽기와 실제 로그인 JWT NOT_RUN, 실제 자료·모형 운영 미승인 상태를 유지한다.')


def local_verification_text(spec):
    """Render local preparation from public metadata; never source private values."""
    contract=spec['local_verification_contract']
    paths=contract['implementation_paths'];fence=chr(96)*3
    source=contract['source_request']
    acceptance=contract.get('implementation_acceptance',{})
    integration=acceptance.get('develop_integration',{})
    if integration.get('status')=='merged_verified':
        git_heading='## 확인한 로컬 검수와 Git 통합 기록'
        hooks=acceptance.get('normal_commit_push_hooks',{})
        ci=integration.get('exact_merge_CI',{})
        git_state=('확인된 이전 구현 '+acceptance.get('implementation_commit','')+
            '; 정상 훅 '+str(hooks.get('pre_commit',{}).get('tests_run','pending'))+
            '/'+str(hooks.get('pre_push',{}).get('tests_run','pending'))+
            '건; [PR14]('+integration.get('pull_request','')+') merged; develop '+integration.get('merge_commit','')+
            '; [정확 병합 CI]('+ci.get('url','')+'): '+ci.get('conclusion','pending')+
            '. 현재 메타데이터 커밋의 미래 CI/운영 인수는 포함하지 않는다.')
    else:
        git_heading='## 확인한 로컬 검수와 Git 인수 대기'
        git_state='같은 커밋·전체 훅·CI·develop 통합 대기'

    rows=[
        ['운영 서버','configured_app/ServerSettings와 운영 /health/ready 의미는 그대로다.'],
        ['로컬 조립',contract['composition']['rule']],
        ['접근 범위',contract['network']['rule']],
        ['저장과 DB',contract['storage']['rule']],
        ['로컬 상태',contract['health']['rule']]
    ]
    body=('현재 상태: '+contract['code_status']+'; '+contract['verification_status']+'.\n\n'+
        contract['purpose']+'\n\n확인한 출발 develop: '+source['baseline_develop']+
        '. 요청 2판 SHA256: '+source['sha256']+'. 이후 후보의 미래 SHA/미실행 검증 완료는 기록하지 않는다.\n\n'+
        '## 운영과 별도인 로컬 서버\n\n'+table(['범위','계약'],rows)+
        '\n\n## 시험 사용자와 독립 승인\n\n일반·유료·편집자·승인자는 서로 다른 네 subject다. 회원 종류와 직원 capability는 별개다.\n\n'+
        contract['local_auth']['token_distribution']+'\n\n'+contract['local_auth']['rule']+'\n\n'+
        contract['independent_approval']['rule']+
        '\n\n소유권·active=true 이용권 UTC 기간·허용 학교·만료·미등록 token 거부를 유지한다. 실제 학교 허용 목록이 없으면 빈 범위다. SYNTHETIC 회귀는 실제 학교 발행 양성 검수의 증거가 아니다.\n\n'+
        '## 자료 발행 권한과 신뢰 기준\n\n'+contract['data_authority']['DATA_ACTIVE_CSV_or_exam_inventory']+'\n\n'+
        contract['data_authority']['registry_selection']+'\n\n'+contract['data_authority']['pending_rule']+'\n\n'+
        contract['data_authority']['kind_scope_rule']+'\n\n참고 kind 예시: '+', '.join(contract['data_authority']['reference_kind_examples'])+'\n\n'+contract['data_authority']['current_data_preparation']+
        '\n\n## Drive와 로컬 파일의 출처\n\n'+contract['source_provenance']['rule']+'\n\n'+
        table(['출처','필요한 고정 근거'],[
            ['drive_download',', '.join(contract['source_provenance']['drive_required'])],
            ['local_filesystem',', '.join(contract['source_provenance']['local_required'])]
        ])+'\n\n'+contract['local_filesystem_selection']['provider_reuse']+'\n\n'+
        contract['local_filesystem_selection']['rule']+
        '\n\n로컬 선택명부 형식은 jungsi.local-selection/v1이며 transport=local_filesystem이다. 항목은 '+
        ', '.join(contract['local_filesystem_selection']['entry_fields'])+
        '다. 별도 승인 문서 jungsi.local-data-approval/v1은 status=approved, scope=local_verification과 local_artifact_id/local_version/sha256/payload_version의 정확한 조합에 결속한다. 이 승인은 운영 production 승인이나 모형 adopt/register가 아니다. path·영수증·승인 명부의 실제 값은 모두 비공개다.\n\n'+
        '## 수신 PC에서 DPAPI 보호\n\n'+contract['encryption']['rule']+'\n\n'+
        contract['encryption']['memory_limit']+'\n\n'+contract['encryption']['alternate_AES_GCM']+
        '\n\n[Microsoft DPAPI 설명]('+contract['encryption']['primary_source']+')에 따른 기본 사용자 범위를 사용한다. 암호 해제 성공만으로 자료를 approved로 취급하지 않는다.\n\n'+
        '## 계산 성공과 보류\n\n'+contract['score_results']['rule']+'\n\n'+contract['score_results']['reference_cases']+
        '\n\n## 외부 화면의 실제 연결\n\n'+contract['frontend_connection']['rule']+'\n\n'+
        contract['frontend_connection']['Supabase_configuration']+
        '\n\nAPI 22개·DTO nullable·권한·Idempotency·보류 코드는 불변이다. 발표 근거는 유효한 release/policy/input 세 버전과 공개 context17필드의 정확한 동일성으로 결합한다. PR6 소스/CI 관측은 실제 localhost Caller·브라우저 인수가 아니다.\n\n'+
        '## 구현 경로와 실행 형식\n\n'+paths['rule']+'\n\n'+
        table(['코드 위치','검수 범위'],[[x,'서비스 개발팀; 고정 소스의 raw/staged SHA 확인'] for x in paths['service_modules']]+
              [[paths['test'],'서비스 합성/어댑터 회귀'],[str(paths['CLI_module']),'CLI help 네 개 exit0; 개별 명령 직접 실행과 구분']])+
        '\n\nbackend-runtime.lock.json의 기존 고정 runtime/site와 해당 src를 PYTHONPATH로 사용하며 PYTHONDONTWRITEBYTECODE=1, Python -B를 유지한다. DPAPI 보호·복호화는 받는 Windows PC/사용자에서 수행한다. 아래는 help로 대조한 실행 형식이며 개별 명령 직접 실행 기록은 아니다. PRIVATE/TRUSTED/NEW/SEALED는 설명용 자리표시자이고 실제 비공개 값으로만 설정한다. 기존 폴더를 덮어쓰거나 비우지 않는다.\n\n'+
        fence+'text\n'+paths.get('issue_sessions_candidate','발급 명령 미확정')+'\n'+paths.get('prepare_local_candidate','명령 미확정')+'\n'+paths.get('serve_candidate','명령 미확정')+
        '\n'+paths.get('hold_serve_candidate','HOLD 명령 미확정')+'\n'+fence+'\n\n'+paths.get('interactive_token_command_policy','')+'\n\n시험/학교 범위 옵션 후보: '+', '.join(paths.get('serve_optional_scope_candidate',[]))+
        '. 승인 row가 없거나 pending이면 payload를 읽거나 숫자를 채우지 않고 HOLD한다.\n\n'+
        '## 담당과 인수 순서\n\n'+table(['담당','작업'],list(contract['ownership'].items()))+
        '\n\n'+contract['private_git_boundary']['rule']+'\n\n'+
        '1. 데이터팀의 승인 범위·명부/선택명부·신뢰 SHA·독립 출처 영수증을 먼저 확인한다.\n'+
        '2. 받는 PC에서 새 DPAPI 캐시에 보호하고, 재읽기의 버전·출처·SHA 거부를 검증한다.\n'+
        '3. 별도 loopback 서버와 네 시험 subject를 준비하며 메모리 소실/운영 NOT_RUN을 확인한다.\n'+
        '4. 외부 화면 담당이 서버 전용 Caller를 연결하고 승인된 기대값·보류 사유로 화면을 검수한다.\n'+
        '5. 정확한 소스·명령·검수 범위·영수증을 남기고 운영 DB/인증/배포 완료와 구분한다.\n\n'+
        git_heading+'\n\n'+table(['범위','상태'],[
            ['고정 서비스 후보',contract.get('implementation_acceptance',{}).get('status','pending')],
            ['서비스 집중 검사',str(contract.get('implementation_acceptance',{}).get('focused_tests',{}).get('count','pending'))+'건; 고정 영수증을 읽기 인수, 공통 writer 재실행 아님'],
            ['native 로컬 검수','같은 받는 PC/사용자 DPAPI·loopback HTTP·승인0/pending 명부 HOLD PASS'],
            ['CLI 도움말','기존 고정 runtime에서 네 개 exit0; token/prepare/serve 실행과 구분'],
            ['Git 인수',git_state],
            ['운영/외부 인수','실제 승인 숫자/DB/Supabase/Drive 다운로드/외부 수신 PC·브라우저 NOT_RUN/HOLD']
        ])+'\n\n## 집중 검증과 남은 작업\n\n'+'\n'.join('- '+x for x in contract['acceptance'])+
        '\n\n'+'\n'.join('- '+x for x in contract['remaining']))
    return body


def validate_local_verification_contract(spec):
    """Reject contract drift rather than making production or private approvals."""
    contract=spec.get('local_verification_contract')
    registered=spec.get('current_documents',{}).get('local_verification')
    requested=any(r.get('id')=='REQ-23' for r in spec.get('requirements',[]))
    if not isinstance(contract,dict):
        return ['Local verification contract required'] if registered or requested else []
    errors=[]
    if contract.get('format')!='jungsi.local-verification-contract/v1' or registered!='docs/current/로컬_검증_연결.md':
        errors.append('Local verification source or document registration drift')
    if not requested or not set(contract.get('requirements',[]))<={r['id'] for r in spec['requirements']}:
        errors.append('Local verification requirement reference drift')
    def field(path):
        value=contract
        for name in path.split('.'):
            if not isinstance(value,dict) or name not in value:return None
            value=value[name]
        return value
    positive=(
        'composition.production_configured_app_unchanged','composition.production_settings_selection_unchanged',
        'composition.local_factory_separate','composition.inject_existing_create_app',
        'composition.existing_application_ports_unchanged','network.loopback_only','network.peer_loopback_required',
        'network.Host_port_exact','local_auth.session_issue_required','storage.restart_loses_state',
        'local_auth.server_allowlist_only','local_auth.server_verified_subject_and_expiry',
        'local_auth.distinct_subjects_required','independent_approval.existing_policy_unchanged',
        'independent_approval.distinct_editor_and_approver_subjects',
        'data_authority.private_approved_registry_required','data_authority.drive_requires_trusted_registry_sha256',
        'data_authority.local_requires_trusted_selection_sha256','data_authority.explicit_engine_approved_requires_exact_true',
        'source_provenance.source_kind_explicit','source_provenance.receipt_binding_required',
        'source_provenance.trusted_receipt_sha256_required','source_provenance.every_read_revalidation',
        'source_provenance.offline_snapshot_not_live_drive','local_filesystem_selection.trusted_selection_sha256_required',
        'local_filesystem_selection.private_path_and_values','encryption.recipient_encrypts_on_recipient_PC',
        'encryption.decrypt_in_RAM_only','encryption.no_payload_key_in_logs_or_receipts',
        'encryption.authenticated_metadata_binding','health.production_health_semantics_unchanged',
        'score_results.preserve_successful_total','api_boundary.operation_and_DTO_unchanged',
        'api_boundary.nullable_unchanged'
    )
    negative=(
        'composition.production_can_select_local_adapter','composition.operational_SQL_or_Drive_result_writes',
        'composition.adopt_or_register_estimated_model','network.allow_wildcard_host','network.access_log',
        'network.public_or_operational_deployment_allowed','network.forwarded_headers_allowed',
        'network.proxy_headers','storage.DB_verified','storage.persistence_claim_allowed',
        'local_auth.production_authentication','local_auth.client_role_or_paid_fields_authoritative',
        'local_auth.production_entry_accepts_local_tokens','local_auth.staff_is_paid',
        'data_authority.source_completion_is_engine_approval','data_authority.automatic_status_promotion',
        'data_authority.latest_modified_time_adoption','source_provenance.fabricate_drive_metadata_for_filesystem',
        'local_filesystem_selection.fake_Google_file_id_or_drive_version_or_parents',
        'local_filesystem_selection.approval_scope_is_production_approval','encryption.CRYPTPROTECT_LOCAL_MACHINE',
        'encryption.encryption_key_sharing','encryption.new_plaintext_disk_write',
        'encryption.delete_existing_plaintext_originals','encryption.decrypt_success_is_approval',
        'health.production_ready','health.local_ready_is_production_ready',
        'score_results.invent_numeric_expected_result','frontend_connection.SSRSupabase_cookie_to_local_Caller_automatic',
        'frontend_connection.frontend_test_token_client_exposure_allowed',
        'private_git_boundary.real_payloads_env_and_registry_in_git','private_git_boundary.force_add_or_reinclude_private_paths'
    )
    for path in positive:
        if field(path) is not True:errors.append('Local verification invariant drift: '+path)
    for path in negative:
        if field(path) is not False:errors.append('Local verification invariant drift: '+path)
    exact={
        'composition.repositories':['LocalMemoryRepository','MemoryForecastRepository'],
        'network.bind_host':'127.0.0.1','network.request_host_policy':'loopback_IP_or_localhost',
        'network.CORS':'exact_loopback_frontend_origins_only',
        'local_auth.provider_class':'LocalSessions','local_auth.maximum_TTL_hours':8,
        'local_auth.session_format':'jungsi.local-sessions/v1',
        'storage.kind':'memory','storage.DB002':'NOT_RUN','storage.migration':'NOT_APPLIED',
        'local_auth.profiles':['standard','paid','editor','approver'],
        'local_auth.operator_university_allowlist_default':'empty','local_auth.synthetic_scope_only':'SYNTHETIC',
        'independent_approval.self_approval_expected_HTTP':403,
        'independent_approval.self_approval_reason':'forecast_independent_approver_required',
        'local_filesystem_selection.format':'jungsi.local-selection/v1',
        'local_filesystem_selection.transport':'local_filesystem',
        'local_filesystem_selection.approval_format':'jungsi.local-data-approval/v1',
        'local_filesystem_selection.approval_fields.status':'approved',
        'local_filesystem_selection.approval_fields.scope':'local_verification',
        'local_filesystem_selection.approval_fields.artifacts':['local_artifact_id','local_version','sha256','payload_version'],
        'source_provenance.source_kinds':['drive_download','local_filesystem'],
        'encryption.method':'Windows_DPAPI','encryption.scope':'current_user',
        'health.local_factory_intercepts_only':'/health/ready','health.mode':'local_verification',
        'health.storage':'memory_ephemeral_lost_on_restart','health.real_DB002':'NOT_RUN','health.real_Supabase':'NOT_RUN',
        'score_results.missing_approved_curve':'HOLD','score_results.unapproved_percentile_or_support':'null_or_pending',
        'api_boundary.operation_count':22,'api_boundary.public_context_fields':17,
        'api_boundary.required_identity_versions':['release_version','policy_version','input_version']
    }
    for path,expected in exact.items():
        value=field(path)
        if type(value) is not type(expected) or value!=expected:
            errors.append('Local verification invariant drift: '+path)
    acceptance=contract.get('implementation_acceptance')
    if acceptance is not None:
        if not isinstance(acceptance,dict):
            errors.append('Local implementation acceptance must be an explicit record')
        else:
            for name in ('production_ready','actual_model_operating_registration'):
                if acceptance.get(name) is not False:
                    errors.append('Local verification invariant drift: implementation_acceptance.'+name)
    if {o['id'] for o in spec['operations'] if o['id'] in LEGACY_API_IDS}!=LEGACY_API_IDS or (not spec.get('score_input_policy_contract') and len(spec['operations'])!=22):errors.append('Local verification 22 API boundary drift')
    fields={
        'source_provenance.drive_required':{'registry_sha256','file_id','parents','input_folder','drive_version','plaintext_sha256','plaintext_bytes','downloaded_at','reviewer','source_receipt_sha256'},
        'source_provenance.local_required':{'selection_sha256','local_artifact_id','local_version','payload_version','plaintext_sha256','plaintext_bytes','captured_at','reviewer','source_receipt_sha256'},
        'local_filesystem_selection.entry_fields':{'kind','key','local_artifact_id','local_version','sha256','bytes','payload_version','status','source_timezone','path','engine_approved (optional exact bool)','approval_evidence','approval_evidence_sha256'},
        'health.required_local_fields':{'mode','local_ready','storage','production_ready','database','auth','real_data'}
    }
    for path,required in fields.items():
        value=field(path)
        if not isinstance(value,list) or any(not isinstance(x,str) for x in value) or len(value)!=len(set(value)) or set(value)!=required:
            errors.append('Local verification receipt or diagnostic fields drift: '+path)
    return errors


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


def supabase_operations_summary(spec,link='Supabase_운영_인수인계.md'):
    c=spec.get('supabase_operations_handoff_contract')
    if not c:
        p=spec.get('backend_platform_contract',{})
        return '\n\n## 서비스 통합과 운영 상태\n\n'+str(p.get('code_status','pending'))+'; 운영서버 '+str(p.get('live_server_status','NOT_RUN'))+'; 실제자료 '+str(p.get('live_data_status','NOT_RUN'))+'.'
    reply=c.get('reply_contract')
    reply_link=str(PurePosixPath(link).parent/PurePosixPath(reply['document']).name) if reply else ''
    followup_link=str(PurePosixPath(link).parent/PurePosixPath(reply['followup']['document']).name) if reply and reply.get('followup') else ''
    reply_summary=('\n\n[화면팀 최종 회신 요청]('+reply_link+')의 RF-01~06과 로컬 요청 ①~⑥를 함께 인수한다. 문서 전달 준비 완료는 담당자 회신·실제 연결·운영 검수 완료를 뜻하지 않는다.') if reply else ''
    if followup_link:reply_summary+='\n\n[화면팀 후속 작업 지시]('+followup_link+')의 FE-01~05는 로컬 검수 보고 이후 발견한 결함·증거 보완·승인 자료 대조·후속 PR 통합을 담당한다.'
    return '\n\n## Supabase 운영 인수 상태\n\n'+c['summary']+'\n\n[Supabase 운영 인수인계]('+link+')를 따른다. revision '+c['revision']+'; HTTP 관측 시각 '+c['checked_at']+'.'+reply_summary+'\n\n'+c['history']['summary']


FRONTEND_REPLY_DOCUMENT='docs/current/화면팀_회신요청_최종.md'
FRONTEND_REPLY_IDS={'RF-01','RF-02','RF-03','RF-04','RF-05','RF-06'}
FRONTEND_REPLY_STATUS={'reply_pending','implementation_pending','supplied_boundary_implementation_pending'}
FRONTEND_FOLLOWUP_DOCUMENT='docs/current/화면팀_후속작업_지시.md'
FRONTEND_FOLLOWUP_IDS={'FE-01','FE-02','FE-03','FE-04','FE-05'}
FRONTEND_FOLLOWUP_STATUS={'implementation_pending','evidence_pending','inputs_pending','integration_pending'}


def frontend_reply_text(spec):
    c=spec['supabase_operations_handoff_contract'];r=c['reply_contract']
    def bullets(values):return '\n'.join('- '+v for v in values)
    def details(row,label):
        return ('### '+label+' '+row['title']+'\n\n상태: '+row['status']+'\n\n'+
                ('담당: '+', '.join(row['owners'])+'\n\n' if 'owners' in row else '')+
                ('요청 원문 요지: '+row['request_summary']+'\n\n' if 'request_summary' in row else '')+
                ('회신 요청:\n\n'+bullets(row['requested_reply'])+'\n\n' if 'requested_reply' in row else '')+
                '담당자 답변과 제공 범위:\n\n'+bullets(row['our_answer'])+'\n\n'+
                '선행 조건:\n\n'+bullets(row['dependencies'])+'\n\n완료 증거:\n\n'+bullets(row['completion_evidence'])+
                ('\n\n관련 operation: '+', '.join(row['route_refs'])+'\n\n비공개 전달 경계: '+row['secret_boundary'] if 'route_refs' in row else ''))
    head=(r['summary']+'\n\n회신 계약 '+r['format']+'; revision '+r['revision']+'; 작성 시각 '+r['prepared_at']+
          '; 작업 출발 develop '+r['basis_commit']+'.\n\n'+r['finalized_meaning']+'\n\n'+r['scope'])
    items='## 화면팀에 요청하는 회신\n\n'+table(['ID','업무','담당','상태'],[[v['id'],v['title'],', '.join(v['owners']),v['status']] for v in r['items']])
    local='## 로컬 연결 요청 2판에 대한 직접 답변\n\n'+'\n\n'.join(details(v,'①②③④⑤⑥'[v['number']-1]) for v in r['local_request_answers'])
    boundary='## 인수 경계와 미확정 사항\n\n'+r['handoff_boundary']+'\n\n'+bullets(r['unresolved'])+'\n\n'+r['preservation']
    return '\n\n'.join([head,items,'\n\n'.join(details(v,v['id']) for v in r['items']),local,boundary,'## 새 로컬 검수 보고의 후속 작업\n\n[화면팀 후속 작업 지시](화면팀_후속작업_지시.md)의 FE-01~05와 구체 SUP 회신을 함께 전달한다.',supabase_actual_update_text(c),supabase_second_actual_update_text(c)])


def frontend_followup_text(spec):
    f=spec['supabase_operations_handoff_contract']['reply_contract']['followup']
    head=(f['summary']+'\n\n계약 '+f['format']+'; 작성 시각 '+f['prepared_at']+'; 기획 출발 기준 develop '+f['basis_commit']+'; 후속 관측 parent 기준 '+f.get('current_review_basis_commit',f['basis_commit'])+'.')
    boundary='## 확인한 범위와 남은 검수\n\n'+'\n'.join('- '+v for v in f['local_review_boundary'])
    reply='## SUP-01·02 결정통지에 대한 구체 회신\n\n'+table(['항목','담당자 회신과 적용 조건'],f['sup_reply'])
    overview='## 화면팀 후속 업무\n\n'+table(['ID/우선순위','업무','담당','상태'],[[v['id']+' '+v['priority'],v['title'],v['owner'],v['status']]for v in f['tasks']])
    detail='\n\n'.join('### '+v['id']+' '+v['title']+'\n\n담당: '+v['owner']+'; 상태: '+v['status']+'\n\n선행 조건: '+('; '.join(v['depends_on'])or '없음')+'\n\n업무:\n\n'+'\n'.join('- '+x for x in v['work'])+'\n\n완료 증거:\n\n'+'\n'.join('- '+x for x in v['completion'])+'\n\n관련 operation: '+', '.join(v['route_refs'])for v in f['tasks'])
    unresolved='## 수령·승인 대기와 보존\n\n'+'\n'.join('- '+v for v in f['unresolved'])+'\n\n'+f['preservation']+'\n\n[최종 회신 요청](화면팀_회신요청_최종.md), [Supabase 운영 인수인계](Supabase_운영_인수인계.md), [필수 외부접근 보호 기준](외부접근_데이터보호_개발기준.md)을 함께 따른다.'
    residual='## 추가 정적 검토 후속\n\n'+table(['ID/우선순위','담당/상태','요청','증거경계'],[[v['id']+' '+v['priority'],v['owner']+' / '+v['status'],v['work'],v['evidence_boundary']]for v in f.get('residual_followups',[])]) if f.get('residual_followups')else ''
    return '\n\n'.join(v for v in [head,boundary,reply,overview,detail,residual,unresolved]if v)


def validate_frontend_reply_contract(spec):
    c=spec.get('supabase_operations_handoff_contract')
    if not c:return []
    errors=[];r=c.get('reply_contract')
    if not isinstance(r,dict):return ['Frontend reply contract missing']
    if r.get('format')!='jungsi.frontend-reply/v1' or r.get('document')!=FRONTEND_REPLY_DOCUMENT or spec.get('current_documents',{}).get('frontend_reply')!=FRONTEND_REPLY_DOCUMENT:
        errors.append('Frontend reply source registration drift')
    if r.get('revision')!=c.get('revision') or r.get('finalized') is not True or r.get('document_status')!='finalized_for_delivery_replies_and_runtime_pending':
        errors.append('Frontend reply delivery state drift')
    for field in ('finalized_meaning','prepared_at','scope','summary','handoff_boundary','preservation'):
        if not isinstance(r.get(field),str) or not r[field].strip():errors.append('Frontend reply field missing: '+field)
    if not isinstance(r.get('basis_commit'),str) or not re.fullmatch('[0-9a-f]{40}',r['basis_commit']):errors.append('Frontend reply basis commit invalid')
    def strings(value):return isinstance(value,list) and bool(value) and all(isinstance(v,str) and v.strip() for v in value)
    if not strings(r.get('unresolved')):errors.append('Frontend reply unresolved inputs missing')
    items=r.get('items')
    if not isinstance(items,list) or len(items)!=6 or not all(isinstance(v,dict) and isinstance(v.get('id'),str) for v in items) or {v['id'] for v in items}!=FRONTEND_REPLY_IDS:
        errors.append('Frontend reply six work items incomplete')
    else:
        operation_ids={v['id'] for v in spec['operations']}
        for row in items:
            key=row['id']
            if not isinstance(row.get('title'),str) or not row['title'].strip():errors.append('Frontend reply title missing: '+key)
            for field in ('owners','requested_reply','our_answer','dependencies','completion_evidence'):
                if not strings(row.get(field)):errors.append('Frontend reply work item incomplete: '+key+'/'+field)
            if row.get('status') not in FRONTEND_REPLY_STATUS:errors.append('Frontend reply work item status drift: '+key)
            refs=row.get('route_refs')
            if not strings(refs) or len(refs)!=len(set(refs)) or not set(refs)<=operation_ids:errors.append('Frontend reply operation reference drift: '+key)
            if not isinstance(row.get('secret_boundary'),str) or not row['secret_boundary'].strip():errors.append('Frontend reply secret boundary missing: '+key)
    local=r.get('local_request_answers')
    if not isinstance(local,list) or len(local)!=6 or not all(isinstance(v,dict) and type(v.get('number')) is int for v in local) or {v['number'] for v in local}!={1,2,3,4,5,6}:
        errors.append('Frontend reply six local answers incomplete')
    else:
        for row in local:
            key=str(row['number'])
            if type(row['number']) is not int:errors.append('Frontend reply local number invalid: '+key)
            for field in ('title','request_summary'):
                if not isinstance(row.get(field),str) or not row[field].strip():errors.append('Frontend reply local field missing: '+key+'/'+field)
            for field in ('our_answer','dependencies','completion_evidence'):
                if not strings(row.get(field)):errors.append('Frontend reply local answer incomplete: '+key+'/'+field)
            if row.get('status') not in FRONTEND_REPLY_STATUS:errors.append('Frontend reply local status drift: '+key)
    if c.get('production_ready') is not False:errors.append('Frontend reply pending work cannot certify production readiness')
    a=c.get('architecture',{})
    if a.get('authority_target')!='public.jeongsi_passes' or a.get('single_authority')!='public.jeongsi_passes' or a.get('decision_status')!='confirmed_target_runtime_transition_pending':errors.append('Frontend reply adopted authority target drift')
    if a.get('selection')!='separate_Jungsi_FastAPI_deployment' or a.get('deployment_status')!='NOT_RUN':errors.append('Frontend reply deployment decision boundary drift')
    adapter=a.get('current_entitlement_adapter',{})
    if adapter.get('table')!='jungsi_backend.entitlements' or adapter.get('session_format')!='jungsi.session/v1' or adapter.get('status')!='unchanged_target_transition_NOT_RUN':errors.append('Frontend reply current adapter boundary drift')
    errors.extend(validate_frontend_followup_contract(spec))
    return errors


def validate_frontend_followup_contract(spec):
    r=spec.get('supabase_operations_handoff_contract',{}).get('reply_contract',{})
    f=r.get('followup')
    if not isinstance(f,dict):return ['Frontend followup contract missing']
    errors=[]
    if f.get('format')!='jungsi.frontend-followup/v1' or f.get('document')!=FRONTEND_FOLLOWUP_DOCUMENT or spec.get('current_documents',{}).get('frontend_followup')!=FRONTEND_FOLLOWUP_DOCUMENT:
        errors.append('Frontend followup source registration drift')
    if f.get('basis_commit')!=r.get('basis_commit') or not isinstance(f.get('basis_commit'),str) or not re.fullmatch('[0-9a-f]{40}',f['basis_commit']):errors.append('Frontend followup basis commit drift')
    def strings(value):return isinstance(value,list) and bool(value) and all(isinstance(v,str) and v.strip()for v in value)
    for field in ('prepared_at','summary','preservation'):
        if not isinstance(f.get(field),str) or not f[field].strip():errors.append('Frontend followup field missing: '+field)
    for field in ('local_review_boundary','unresolved'):
        if not strings(f.get(field)):errors.append('Frontend followup evidence boundary missing: '+field)
    reply=f.get('sup_reply')
    if not isinstance(reply,list) or not reply or not all(strings(v) and len(v)==2 for v in reply):errors.append('Frontend followup concrete SUP reply missing')
    tasks=f.get('tasks')
    if not isinstance(tasks,list) or len(tasks)!=5 or not all(isinstance(v,dict) and isinstance(v.get('id'),str)for v in tasks) or {v['id']for v in tasks}!=FRONTEND_FOLLOWUP_IDS:
        errors.append('Frontend followup five tasks incomplete')
    else:
        operation_ids={v['id']for v in spec['operations']}
        for row in tasks:
            key=row['id']
            for field in ('title','owner','priority'):
                if not isinstance(row.get(field),str) or not row[field].strip():errors.append('Frontend followup work field missing: '+key+'/'+field)
            for field in ('work','completion'):
                if not strings(row.get(field)):errors.append('Frontend followup work item incomplete: '+key+'/'+field)
            dependencies=row.get('depends_on')
            if not isinstance(dependencies,list) or not all(isinstance(v,str) and v.strip()for v in dependencies):errors.append('Frontend followup dependency drift: '+key)
            if row.get('status') not in FRONTEND_FOLLOWUP_STATUS:errors.append('Frontend followup work status drift: '+key)
            refs=row.get('route_refs')
            if not strings(refs) or len(refs)!=len(set(refs)) or not set(refs)<=operation_ids:errors.append('Frontend followup operation reference drift: '+key)
    return errors

def supabase_access_recheck_text(contract):
    recheck = contract.get('access_recheck')
    if not recheck:
        return ''
    return '\n\n'.join([
        '## 최신 HTTP 접근 재점검과 .env 경계',
        '증거 ID ' + recheck['evidence_id'] + '; ' + recheck['started_at'] + ' ~ ' + recheck['checked_at'] + '. ' + recheck['source'] + ' ' + recheck['scope'],
        '### 설정 파일·키 없는 조회\n\n' + table(['시각 UTC', '요청', 'HTTP', '확인 범위'], recheck['without_settings_HTTP']),
        '### 기존 비공개 보관 키를 사용한 조회\n\n' + recheck['settings_source'] + '\n\n' + table(['시각 UTC', '요청', 'HTTP', '확인 범위'], recheck['existing_keys_HTTP']),
        recheck['zero_row_boundary'],
        '### 설정 보관과 실행 환경\n\n기존 비공개 파일 확인 설정 이름: ' + ', '.join(recheck['settings_present_names']) + '.\n\n이번 프로세스·해당 PC User/Machine 환경변수 미주입 이름: ' + ', '.join(recheck['environment_missing_names']) + '.\n\n' + recheck['settings_boundary'] + '\n\n' + recheck['configuration_boundary'],
        '### 미검증 범위와 운영 상태\n\n' + table(['항목', '상태', '이유'], recheck['verification_boundaries']) + '\n\n실제 레코드 취득 ' + str(recheck['records_fetched']) + '건; 운영 쓰기 ' + str(recheck['operational_writes']) + '건; 새 .env 생성 ' + str(recheck['new_env_files']) + '건. production_ready=false를 유지한다.',
        '### 다음 담당자의 작업\n\n' + table(['담당', '작업과 경계'], recheck['developer_actions']),
    ])


def supabase_actual_update_text(contract):
    stage=contract.get('storage_staging')
    if not stage:
        return ''
    intake=contract['source_DDL_intake'];cr=contract['service_transition_contract'];scope=contract['actual_update_scope']
    objects=stage['objects'];access=stage['public_route_access']
    states=[
        ['Storage 관측',stage['status'],stage['observed_at']+'; 증거 '+stage['evidence_id']],
        ['신규 private/기존 보존',str(stage['bucket']['public'])+' / '+str(stage['bucket']['existing_preserved']),'bucket 생성·재조회. 실제 식별자/경로는 private 영수증'],
        ['객체 적재/해시 재수신',str(objects['verified_count'])+'건',objects['status']+'; 원본 보존 '+str(objects['all_local_files_preserved'])],
        ['public 경로 거절',str(access['probe_count'])+'건 / HTTP '+str(access['HTTP_status']),access['scope']],
        ['인증 사용자 raw RLS/signed URL',access['actual_authenticated_raw_RLS']+' / '+access['signed_URL_authorization'],'public 경로 거절과 별도 검수'],
        ['Storage 당시 SQL/001/002',stage['database']['SQL_connection']+' / '+stage['database']['migration001']+' / '+stage['database']['migration002'],'Storage 관측 시점의 역사. 최신 actual DB 단계는 아래 별도 절'],
        ['engine/production',str(stage['engine']['engine_approved'])+' / '+str(stage['engine']['production_allowed']),'저장본 채택·숫자·운영 승인 미실행'],
    ]
    sample=stage.get('independent_sample_review')
    if sample:
        states.append(['독립 sample 검수',str(sample['sample_objects'])+'객체 / '+str(sample['denial_checks'])+'거절',sample['evidence_id']+'; '+sample['scope']])
    source=intake['status']+'; '+intake['received_at']+'; source commit '+intake['source_commit']+'. '+str(intake['received_schema_files'])+' source 파일 수령 / '+str(intake['scanned_schema_files'])+' SQL 파일 검토. '+intake['boundary']
    requests=contract['reply_contract']['ddl_input_requests']
    entries=table(['입력','현재 수신/검수 상태','받은 범위','남은 범위'],[[v['id'],v['status'],v.get('received_scope','원본 미수신'),v.get('remaining','현재 효과 검수 대기')]for v in requests])
    relay=cr['entitlement_injection'];provider=cr['storage_provider']
    implementation=cr['id']+'; '+cr['status']+'. '+cr['preservation']
    db=contract['database_preflight'];apply=contract['database_application']
    db_text='### 이전001·002 관측:003적용전의역사\n\n'+table(['관측','상태','범위'],[
        ['읽기 preflight',db['status'],db['observed_at']+'; '+db['evidence_id']+'; TLS 양계정/least role/master9컬럼·2 SELECT policy/당시schema0'],
        ['001·002 적용',apply['status'],apply['committed_at']+'; '+apply['evidence_id']+'; 신규13 RLS tables/owner·schema_versions'],
        ['독립 원장검수',apply['independent_review_status'],'개발 적용 영수증 이후 별도 검수; runtime app정책 '+str(apply['private_app_policy_count'])+'건'],
        ['runtime003/실업무',apply['runtime003_status']+' / '+apply['runtime_CRUD_privilege_acceptance'],'Auth/paid/defaultfactory/운영승인 미인수']])+'\n\n'+db['boundary']+'\n\n'+apply['boundary']
    reader=cr['reader_contract_update']
    db_text+='\n\n'+reader['id']+'; '+reader['status']+'. runtime current_user='+reader['runtime_current_user']+'; migration owner runtime 거절; 기존 master9컬럼 SELECT 임의 REVOKE 금지. '+reader['boundary']
    return '\n\n'.join([
        '## 실제 Supabase Storage 업데이트와 DB·운영 경계',
        scope['boundary']+'\n\n'+table(['항목','상태','증거 범위'],states),
        '### 최소 승인 자료 인입 규정\n\n'+contract['runtime_ingestion_policy']['mode']+'; '+contract['runtime_ingestion_policy']['dependency_boundary']+'\n\n'+contract['runtime_ingestion_policy']['missing_behavior']+'\n\n'+contract['runtime_ingestion_policy']['boundary']+'\n\nRuntime 필수로 추정하지 않는 자료: '+', '.join(contract['runtime_ingestion_policy']['runtime_nonrequirements']),
        '\n'.join('- '+v for v in stage['boundaries']),
        '### 소유자 source DDL 부분수신',
        source+'\n\n'+'\n'.join('- '+v for v in intake['source_definition_facts']),
        db_text,
        'OpenAPI metadata HTTP '+str(intake['metadata_probe']['HTTP'])+', '+str(intake['metadata_probe']['master_column_count'])+'컬럼; '+intake['metadata_probe']['scope'],
        entries,
        '### 채택한 서비스 구현 준비와 남은 인수',
        implementation,
        relay['scope']+'\n\n'+'\n'.join('- '+v for v in relay['preflight']),
        provider['scope']+'\n\n공급 명부 '+provider['registry_format']+' / '+provider['transport']+'; 필드 '+', '.join(provider['entry_fields'])+'; '+provider['registry_status']+'. '+provider['credentials'],
        '\n'.join('- '+v for v in provider['checks']),
        'codepath '+cr['code_path_status']+'; 합성 '+cr['synthetic_verification']+'; 실제Auth/DB/Storage권한 '+cr['actual_auth_DB_Storage_privilege_verification']+'. 구현 준비 채택은 현재 default 전환/운영 PASS가 아니다.',
        cr.get('code_paths_boundary','')+'\n\n'+('이번 feature 스냅샷의 명시 준비 구현 경로: '+', '.join(cr.get('implementation_code_paths',[])) if cr.get('implementation_mode')=='explicit_prepared_default_unchanged' else '후속 PR 후보 경로: '+', '.join(cr.get('pending_pr_paths',[]))),
        '### 신규 DB role 발급 요청과 실제 권한 대기',
        table(['항목','보고된 목표/남은 검수'],[[k,v]for k,v in contract.get('database_role_target',{}).items()if isinstance(v,(str,bool))]),
        contract.get('database_role_target',{}).get('boundary',''),
        '### private 연결설정 수령과 실제 preflight 경계',
        contract.get('credentials_intake',{}).get('status','')+'; 증거 '+contract.get('credentials_intake',{}).get('evidence_id','')+'; '+contract.get('credentials_intake',{}).get('boundary',''),
    ])


def validate_supabase_actual_update_contract(spec):
    version=spec.get('version','')
    try:
        adopted=tuple(int(v)for v in version.split('.')) >= (1,8,4)
    except (ValueError,AttributeError):
        adopted=False
    if not adopted:
        return []
    c=spec.get('supabase_operations_handoff_contract',{})
    stage=c.get('storage_staging');scope=c.get('actual_update_scope');intake=c.get('source_DDL_intake');cr=c.get('service_transition_contract')
    if not all(isinstance(v,dict)for v in (stage,scope,intake,cr)):
        return ['Supabase actual update contract missing']
    errors=[]
    if stage.get('format')!='jungsi.supabase-storage-staging/v1' or stage.get('production_ready')is not False:
        errors.append('Supabase storage staging cannot certify production')
    if stage.get('bucket',{}).get('public')is not False or stage.get('bucket',{}).get('existing_preserved')is not True:
        errors.append('Supabase private staging preservation drift')
    objects=stage.get('objects',{});count=objects.get('verified_count')
    if type(count)is not int or count<1 or not all(objects.get(k)is True for k in ('all_readback_sha256_match','all_originals_rehashed_equal','all_local_files_preserved')):
        errors.append('Supabase object staging verification drift')
    if any(type(objects.get(k))is not int or objects[k]!=0 for k in ('overwrite_operations','delete_operations')):
        errors.append('Supabase staging does not permit overwrite or deletion')
    access=stage.get('public_route_access',{})
    if access.get('actual_authenticated_raw_RLS')!='NOT_RUN' or access.get('signed_URL_authorization')!='NOT_RUN' or access.get('all_denied')is not True:
        errors.append('Supabase public-route observation cannot certify authenticated Storage RLS')
    if stage.get('database',{}).get('SQL_connection')!='NOT_RUN' or stage.get('database',{}).get('SQL_executed')is not False:
        errors.append('Supabase Storage writes cannot certify SQL connection')
    if not all(stage.get('engine',{}).get(k)is False for k in ('adoption_performed','engine_approved','production_allowed')):
        errors.append('Supabase staging is not engine approval')
    if not all(scope.get(k)is False for k in ('master_write_authorized','arbitrary_schema_or_policy_changes_authorized','deletion_authorized','overwrite_authorized','engine_adoption_performed','deployment_performed','production_ready')):
        errors.append('Supabase actual update scope cannot expand unperformed authority')
    if not re.fullmatch('[0-9a-f]{40}',intake.get('source_commit','')) or not all(intake.get(k)is False for k in ('production_ddl_observed','migration_history_observed','role_grants_observed','SQL_executed')):
        errors.append('Supabase source DDL intake is not production effect')
    entries=c.get('reply_contract',{}).get('ddl_input_requests',[])
    required={'IN-DB-01A','IN-DB-01B','IN-DB-02A','IN-DB-02B','IN-DB-03A','IN-DB-03B','IN-DB-04A','IN-DB-04B','IN-DB-05A','IN-DB-05B'}
    if len(entries)!=10 or {v.get('id')for v in entries if isinstance(v,dict)}!=required or any(not v.get('remaining')for v in entries):
        errors.append('Supabase partial intake must preserve all ten remaining input mappings')
    if cr.get('id')!='CR-SERVICE-SUP03' or cr.get('status')!='adopted_for_service_implementation_verification_pending' or cr.get('production_ready')is not False or cr.get('default_operating_factory_transition')!='NOT_RUN':
        errors.append('Supabase implementation preparation cannot certify default runtime')
    provider=cr.get('storage_provider',{})
    if provider.get('current_factory_storage_selected')is not False or provider.get('independent_registry_SHA_binding_required')is not True or provider.get('maximum_artifact_bytes')!=33554432:
        errors.append('Supabase explicit Storage provider boundary drift')
    archive=provider.get('archive_only_policy',{})
    if archive.get('required')is not True or archive.get('allowed_value')is not False or archive.get('exact_bool_required')is not True or archive.get('missing_null_number_string_rejected')is not True or archive.get('location')!='registry_entry' or 'archive_only'not in provider.get('entry_fields',[]):
        errors.append('Supabase Storage requires explicit exact-bool archive_only false')
    allowed_intake_status={'original_input_pending_NOT_REVIEWED','source_original_received_production_effect_NOT_RUN','partial_source_received_production_effect_NOT_RUN','target_SQL_candidate_pending_NOT_REVIEWED','partial_source_policy_received_backend_role_effect_NOT_RUN','repository_migrations_present_live_owner_policy_history_pending','update_purpose_confirmed_execution_plan_and_evidence_pending','credentials_received_connection_preflight_pending','source_original_and_live_catalog_received_history_partial','live_catalog_partial_history_pending','live_role_master_privileges_verified_original_SQL_pending','live_two_master_SELECT_policies_verified_reader_pending','001002_applied_development_receipt_independent_review_pending','runtime_RLS003_candidate_pending_NOT_APPLIED','actual_TLS_connections_and_role_preflight_PASS_runtime_pending'}
    if any(v.get('status')not in allowed_intake_status for v in entries):
        errors.append('Supabase partial source intake cannot claim live completion')
    roles=c.get('database_role_target',{})
    if roles.get('runtime_DELETE_allowed')is not False or roles.get('runtime_TRUNCATE_allowed')is not False or roles.get('owner_runtime_reuse_allowed')is not False or roles.get('owner_has_schema_management_authority')is not True or roles.get('owner_is_migration_only')is not True:
        errors.append('Supabase runtime least role cannot deny inherent owner authority')
    if roles.get('actual_role_exists_verified')is not True or roles.get('actual_effective_privileges_verified')is not True or not roles.get('actual_privilege_scope'):
        errors.append('Supabase actual role verification needs scoped preflight evidence')
    refs=cr.get('route_refs',[]);operations={v['id']for v in spec['operations']}
    if not refs or len(refs)!=len(set(refs)) or not set(refs)<=operations:
        errors.append('Supabase transition operation reference drift')
    if cr.get('current_authority')!='jungsi_backend.entitlements' or cr.get('target_authority')!='public.jeongsi_passes':
        errors.append('Supabase target must preserve current default authority')
    credentials=c.get('credentials_intake',{})
    if credentials.get('status')!=('actual_connection_runtime003_metadata_verified_live_pending'if tuple(int(v)for v in version.split('.'))>=(1,8,5)else 'credentials_received_connection_preflight_PASS_private_migration_review_pending') or credentials.get('private_values_read_by_planning')is not False or credentials.get('actual_DB_connection_verified')is not True or credentials.get('effective_role_policy_verified')is not True or not credentials.get('effective_verification_scope'):
        errors.append('Supabase private configuration intake needs scoped actual connection evidence')
    db=c.get('database_preflight',{});apply=c.get('database_application',{})
    if db.get('format')!='jungsi.database-preflight-observation/v1' or db.get('status')!='PASS_READONLY_CONNECTION_ROLE_MASTER_SCHEMA_ABSENCE' or db.get('read_only')is not True or type(db.get('sql_writes'))is not int or db.get('sql_writes')!=0 or db.get('private_schema_present_at_preflight')is not False or db.get('private_table_count_at_preflight')!=0:
        errors.append('Supabase readonly preflight observation scope drift')
    if any(db.get('connections',{}).get(k,{}).get('TLS')is not True for k in ('app','owner')) or any(db.get('roles',{}).get(k)is not False for k in ('superuser','BYPASSRLS','app_database_CREATE')) or db.get('roles',{}).get('owner_database_CREATE')is not True or db.get('roles',{}).get('memberships')!=[]:
        errors.append('Supabase preflight least role or TLS drift')
    master=db.get('master',{})
    if master.get('column_count')!=9 or master.get('select_policy_count')!=2 or any(master.get(k)is not True for k in ('app_SELECT','owner_SELECT')) or any(master.get(k)is not False for k in ('app_INSERT_UPDATE_DELETE_TRUNCATE','owner_INSERT_UPDATE_DELETE_TRUNCATE')):
        errors.append('Supabase master scoped readonly privilege drift')
    reader=cr.get('reader_contract_update',{})
    policy_names={'jeongsi_passes: select own or admin','jeongsi_passes: jungsi backend read'}
    policies=master.get('select_policies',[])
    if len(policies)!=2 or {v.get('name')for v in policies}!=policy_names or reader.get('SELECT_policies')!=policies or reader.get('id')!='CR-SERVICE-SUP04-20261006-01' or reader.get('runtime_current_user')!='jungsi_backend_app' or reader.get('migration_owner_runtime_rejected')is not True or reader.get('public_nine_column_SELECT_arbitrary_REVOKE_allowed')is not False:
        errors.append('Supabase actual two SELECT policies and app-only reader drift')
    expected_policies={
        'jeongsi_passes: select own or admin':dict(name='jeongsi_passes: select own or admin',roles=['public'],command='SELECT',qual='((auth.uid() = user_id) OR is_admin())',permissive='PERMISSIVE'),
        'jeongsi_passes: jungsi backend read':dict(name='jeongsi_passes: jungsi backend read',roles=['jungsi_backend_app','jungsi_backend_owner'],command='SELECT',qual='true',permissive='PERMISSIVE')}
    if {v.get('name'):v for v in policies}!=expected_policies or reader.get('master_RLS_user_isolation_certified')is not False or not reader.get('SQL_verified_subject_filter_required') or reader.get('unknown_added_or_changed_SELECT_policy_rejected')is not True:
        errors.append('Supabase broad backend SELECT requires exact policies and verified-subject SQL filter')
    if apply.get('format')!='jungsi.private-schema-application-observation/v1' or apply.get('status')!='actual_applied_verified_by_development_receipt_independent_review_pending' or apply.get('independent_review_status')!='pending' or apply.get('independent_review_passed')is not False or apply.get('migration_history')!=['001_pre_data_platform','002_forecast_policy'] or apply.get('private_table_count')!=13 or apply.get('all_private_tables_RLS_enabled')is not True or apply.get('private_app_policy_count')!=0:
        errors.append('Supabase migration receipt cannot certify independent runtime acceptance')
    if any(apply.get(k)is not False for k in ('public_master_changed','profiles_changed','existing_owner_or_role_changed','DELETE_DROP_TRUNCATE_executed','production_ready')) or apply.get('runtime003_status')!='NOT_APPLIED' or apply.get('runtime_CRUD_privilege_acceptance')!='NOT_RUN' or apply.get('live_authenticated_operations')!='NOT_RUN':
        errors.append('Supabase private schema receipt does not permit master mutation or runtime readiness')
    if any(scope.get(k)is not True for k in ('database_SQL_executed','database_SQL_reads_executed','database_SQL_writes_executed')) or scope.get('database_execution_status')!=('001002003_applied_fresh_metadata_synthetic_ports_verified_live_pending'if tuple(int(v)for v in version.split('.'))>=(1,8,5)else '001002_applied_development_receipt_independent_review_pending') or any(scope.get(k)!='actual_applied_verified_by_development_receipt' for k in ('migration001','migration002')):
        errors.append('Supabase actual SQL receipt state drift')
    minimal=c.get('runtime_ingestion_policy',{})
    if minimal.get('format')!='jungsi.minimal-runtime-ingestion/v1' or minimal.get('mode')!='minimal_explicit_approved_allowlist' or minimal.get('selection')!='requested_operation_required_dependencies_only' or minimal.get('explicit_approved_entries_only')is not True or minimal.get('archive49_preserved')is not True:
        errors.append('Supabase runtime ingestion must use minimum explicit approved dependencies')
    if any(minimal.get(k)is not False for k in ('bulk_scan_or_all_owned_data_autoimport_allowed','archive_uploads_auto_adopted','deletion_performed','production_ready')) or minimal.get('runtime_implementation_status')!='pending' or not minimal.get('missing_behavior'):
        errors.append('Supabase staged archives cannot become bulk runtime data or approval')
    return errors


def supabase_second_actual_update_text(contract):
    runtime=contract.get('database_runtime_application')
    if not runtime:return ''
    synthetic=contract['synthetic_persistence_verification'];port=contract['explicit_port_metadata_verification']
    minimum=contract['minimum_exam_stage'];accuracy=contract['subject_accuracy_review'];factory=contract['service_transition_contract']['factory_transition_review']
    return '\n\n'.join([
        '## 2차 실제 관측:003·명시port·최소시험팩·화면통합',
        table(['관측','상태','검수범위'],[
            ['정확003 적용/fresh권한',runtime['status'],runtime['evidence_id']+'; 정책24/SELECT13·INSERT9·columnUPDATE6'],
            ['합성 새process영속성',synthetic['status'],synthetic['evidence_id']+'; 합성'+str(synthetic['preserved_rows'])+'건'],
            ['명시port메타',port['status'],port['evidence_id']+'; health'+str(port['health_ready_HTTP'])+' / '+port['health_ready_status']],
            ['최소시험팩',minimum['status'],minimum['evidence_id']+'; '+str(minimum['payload_count'])+'건/'+str(minimum['payload_bytes'])+'B·'+minimum['entry_status']+'/승인0'],
            ['수학 부분QA',accuracy['status'],accuracy['evidence_id']+'; 수학한구간/9경계만·wholeexam/CDF승인0'],
            ['기본경로 결정',factory['status'],factory['human_answer']+'; candidate7PASS는review-only/source변경0']]),
        runtime['boundary'],synthetic['boundary'],port['boundary'],minimum['boundary'],accuracy['boundary'],accuracy.get('observation_scope',''),factory['boundary'],
        ('데이터팀 후속: '+contract['targeted_data_followup']['status']+'. '+contract['targeted_data_followup']['boundary']) if contract.get('targeted_data_followup') else '',
        '운영서버는 app DATABASE_URL만, owner URL은이관작업전용private로분리한다. 외부화면은공개Supabase설정/APIorigin만받는다. 비공개env값/path/hash/ACL identity를기록하지않는다.',
        '현재legacy/defaultfactory/API22/session3/page4·최소allowlist를유지한다. 실제사용자JWT/유료rows·자료활성화·livehost·브라우저와세securitygate/운영은NOT_RUN/NOT_READY다.'
    ])


def validate_supabase_second_actual_update_contract(spec):
    try:adopted=tuple(int(v)for v in spec.get('version','').split('.'))>=(1,8,5)
    except (ValueError,AttributeError):adopted=False
    if not adopted:return []
    c=spec.get('supabase_operations_handoff_contract',{});errors=[]
    runtime=c.get('database_runtime_application',{});synthetic=c.get('synthetic_persistence_verification',{})
    port=c.get('explicit_port_metadata_verification',{});minimum=c.get('minimum_exam_stage',{});accuracy=c.get('subject_accuracy_review',{})
    if runtime.get('format')!='jungsi.private-runtime-application-observation/v1' or runtime.get('status')!='APPLIED_AND_FRESH_METADATA_VERIFIED' or runtime.get('policies')!=24 or runtime.get('select_tables')!=13 or runtime.get('insert_tables')!=9 or runtime.get('update_columns')!=6 or runtime.get('artifact_releases_access')!='SELECT_only':
        errors.append('Supabase exact003 fresh metadata scope drift')
    if any(runtime.get(k)is not False for k in ('table_wide_UPDATE','runtime_DELETE_TRUNCATE','anon_authenticated_private_access','future_default_grants','public_source_changed','DELETE_DROP_TRUNCATE_executed','production_ready')) or runtime.get('business_data_imported')!=0 or runtime.get('live_user_JWT_validation')!='NOT_RUN':
        errors.append('Supabase metadata permission proof cannot expand authority or live readiness')
    if synthetic.get('synthetic_only')is not True or synthetic.get('separate_process')is not True or synthetic.get('preserved_rows')!=10 or synthetic.get('real_business_data_imported')!=0 or synthetic.get('public_auth_or_master_rows_read_or_changed')!=0 or synthetic.get('operating_API_Auth_acceptance')!='NOT_RUN':
        errors.append('Supabase synthetic persistence is not actual user or operational acceptance')
    if port.get('scope')!='ASGI_TestClient_actual_DB_metadata_only' or port.get('health_ready_HTTP')!=503 or port.get('real_entitlement_rows_read')is not False or port.get('real_user_JWT_verified')is not False or port.get('default_factory_transition')is not False or port.get('data_approval_changed')is not False or port.get('production_ready')is not False:
        errors.append('Supabase explicit metadata port cannot certify default factory Auth or data')
    if minimum.get('payload_count')!=1 or minimum.get('payload_bytes')!=328915 or minimum.get('entry_status')!='staged' or minimum.get('approved_entries')!=0 or minimum.get('registry_binding')!='candidate_not_runtime_selected' or minimum.get('provider_denial')!='artifact_not_approved' or minimum.get('provider_network_calls')!=0 or minimum.get('archive_only')is not False or any(minimum.get(k)is not False for k in ('engine_approved','production_allowed','actual_data_adopted','active_config_changed','production_ready')):
        errors.append('Supabase minimum staged exam must stay unapproved and unbound')
    if accuracy.get('boundary_checks_passed')!=9 or any(accuracy.get(k)is not False for k in ('whole_exam_approved','total_CDF_approved','runtime_registry_changed','official_scorecard_integer_percentile_certified','normative_rounding_primary_source_verified','operational_engine_run','production_ready')) or accuracy.get('actual_UI_source_mode')!='NOT_RUN':
        errors.append('Scoped mathematics review cannot certify entire exam CDF integer percentile or UI')
    cr=c.get('service_transition_contract',{});factory=cr.get('factory_transition_review',{})
    if factory.get('status')!='user_selected_explicit_preparation_only' or factory.get('human_answer')!='기본 경로는 유지하고 명시 연결만 준비' or any(factory.get(k)is not False for k in ('default_factory_change_allowed','default_factory_applied','future_automatic_transition_allowed','candidate_source_applied')) or factory.get('current_factory_authority')!='jungsi_backend.entitlements' or factory.get('human_question_resolved')is not True or cr.get('default_operating_factory_transition')!='NOT_RUN':
        errors.append('Human explicit-only decision forbids default factory transition')
    prepared_version=tuple(int(v)for v in spec.get('version','0').split('.'))>=(1,8,6)
    expected_prepared_paths={
        'src/jungsi_touch/infrastructure/http_api.py','src/jungsi_touch/infrastructure/postgres_entitlements.py',
        'src/jungsi_touch/infrastructure/supabase_storage.py','tests/test_http_entitlement_injection.py',
        'tests/test_postgres_entitlements.py','tests/test_supabase_storage.py',
        'database/migrations/003_runtime_role_access.sql'}
    paths=cr.get('implementation_code_paths',[])
    if prepared_version:
        if cr.get('implementation_mode')!='explicit_prepared_default_unchanged' or cr.get('code_path_status')!='explicit_prepared_snapshot_PR_integration_pending' or not isinstance(paths,list) or len(paths)!=7 or set(paths)!=expected_prepared_paths or set(cr.get('pending_pr_paths',[]))!=expected_prepared_paths:
            errors.append('Explicit prepared mode must bind the exact seven feature snapshot paths with default unchanged')
    elif paths!=[]:
        errors.append('Unprepared historical contract cannot activate implementation paths')
    if cr.get('pending_pr_paths',[]).count('database/migrations/003_runtime_role_access.sql')!=1 or cr.get('full_snapshot_verification',{}).get('previous_PASS_claimed')is not False:
        errors.append('Service preparation paths and focused results cannot certify full snapshot integration')
    fo=c.get('frontend_followup_observation',{})
    if fo.get('merge_commit')!='3d90bc461c57102fc9ee8868cec7edac498470d4' or fo.get('head_commit')!='ef7b7c08ae0c3db5ea02c7af685a99f6064219df' or fo.get('exact_head_CI_success_count')!=2 or fo.get('source_deletions')!=0 or fo.get('branch_preserved')is not True:
        errors.append('PR15 source integration observation drift')
    residual=c.get('reply_contract',{}).get('followup',{}).get('residual_followups',[])
    if not {'FE-01R','FE-ORIGIN','FE-SOURCE-01'}<={v.get('id')for v in residual if isinstance(v,dict)}:
        errors.append('PR15 integration must retain operational origin date and source followups')
    return errors


def supabase_current_followup_text(contract):
    v=contract.get('current_followup')
    if not v:return ''
    p=v['phase1'];d=v['database_readonly'];t=v['selected_storage'];m=v['minimum_metadata_registration'];f=v['external_frontend'];phase=v['phase2'];child=v['September_application_children'];source=v['source_availability'];plan=v['data_definition_followup']['implementation_plan']
    return '\n\n'.join([
        '## 현재 통합과 source 등록·모형 채택의 경계',
        'FROZEN 문서 준비 시각 '+v['prepared_at']+'; '+v['status']+'. 이전 준비/관측·실패 기록은 보존하며 이번 정본반영/새 훅/CI는 NOT_RUN이다.',
        table(['항목','현재 상태','인수 범위와 남은 작업'],[
            ['공통 phase1',p['status'],p['commit']+'; 정상commit/prepush/정확CI 각각'+str(p['precommit_tests'])+'PASS'],
            ['서비스 phase2',phase['status'],phase['final_HEAD']+'; 정상precommit/prepush/HEAD pushCI/PR시험CI/developCI각'+str(phase['normal_precommit_tests'])+'PASS·실패/오류/skip0'],
            ['전용 app TLS 읽기',d['status'],str(d['checks_passed'])+'건; RLS '+str(d['tables_RLS_enabled'])+'table/'+str(d['policy_count'])+'policy metadata'],
            ['전용 schema REST',str(d['private_REST_metadata']['HTTP'])+'/'+d['private_REST_metadata']['code'],d['private_REST_metadata']['meaning']],
            ['선별 Storage',t['status'],str(t['verified_object_count'])+'객체 fullSHA 독립검수·noJWT '+str(t['no_JWT_denied_requests'])+'거절·승인/활성화false'],
            ['source 메타 draft',m['status'],str(m['registered_metadata_items'])+'개 fresh app 독립readback·owner일회등록·publishednull'],
            ['최종 source별 메타집계',v['source_specific_final_summary']['status'],'등록/정책34·기존GET/DB결속32 PASS·새GET0; 실JWT/엔진검수가아님'],
            ['모평적용 child',child['status'],str(child['child_count'])+'개 원source SHA/모평applicationContext분리·원AST수치불변'],
            ['공식 입결 source',source['official_history']['status'],str(source['admission_results_source_count'])+'개 최소선별native58/RAM39 PASS·DBdraft등록'+str(source['admission_results_DB_registered_count'])+'·전국완료false'],
            ['Storage RLS metadata',v['storage_RLS_metadata_review']['status'],'현재보호bucket 클라이언트허용조건없음·실제JWT HTTP/SEC운영NOT_RUN'],
            ['공식학교 catalog',source['official_school_catalog'],'최종자료팀영수증대기'],
            ['v2 서비스 구현',plan['status'],str(plan['candidate_path_count'])+'경로후보·code0·nativev1유지·호환/품질/newscopeFE작업미완료'],
            ['외부 화면',f['status'],'실제JWT/22API/4page/배포·보안gate별도']]),
        phase['boundary'],d['boundary'],t['boundary'],m['boundary'],child['boundary'],source['boundary'],v['storage_RLS_metadata_review']['boundary'],v['source_reading_followup']['boundary'],v['census_snapshot_preservation']['boundary'],v['data_definition_followup']['boundary'],v['default_membership']['boundary'],f['boundary'],v['source_specific_final_summary']['boundary'],v['final_document_validation']['boundary'],v['private_boundary']
    ])

def supabase_operations_handoff_text(spec):
    c=spec['supabase_operations_handoff_contract'];r=c['current_review'];a=c['architecture']
    head=c['decision']+'\n\nrevision '+c['revision']+'; '+c['checked_at']+' 읽기 snapshot; 문서 '+c['document_status']+'. '+c['scope']
    architecture='## 확정된 구성과 현재 실행 상태\n\n'+table(['계층','책임'],a['tiers'])+'\n\n배포 방식은 '+a['selection']+'로 확정했다. 실제 운영 배포 상태는 '+a['deployment_status']+'이며 실행 환경과 운영 주소 인수는 별도 작업이다. '+a['boundary']+'\n\n유료 이용권 단일 기준의 확정 목표는 '+a['authority_target']+'다. 현재 실행 어댑터는 '+a['current_entitlement_adapter']['table']+'를 조회하며, '+a['current_entitlement_adapter']['status']+' 상태다. 기존 session v1과 그 실행 규칙을 보존하고, 원본 DDL을 확인한 별도 어댑터 변경·검증 후에만 목표 기준으로 전환한다.\n\n'+table(['목표 이용권 계약','상태 또는 근거'],[[key,str(value)] for key,value in a['target_entitlement_contract'].items()])
    current='## 이전 통합 snapshot의 최소 조회와 실제 검수\n\n'+r['scope']+'\n\n'+table(['항목','HTTP','확인 범위'],r['readonly_HTTP'])+'\n\n'+r['PGRST106_meaning']+'\n\n당시 확인한 설정 이름: '+', '.join(r['present_names'])+'. 해당 관측에서 확보하지 못한 설정: '+', '.join(r['missing_in_reviewed_scope'])+'. '+r['site_admin']+' '+r['local_reference']+'\n\n해당 시점의 지정 범위에서 승인 자료 0건과 로컬 후보 1건의 engine_approved=false를 확인했다. 새 자료나 전체 저장소의 현재 승인 현황으로 확대하지 않는다. 미승인 자료·합성 모형의 production_allowed=false를 표시 목적으로 true로 바꾸지 않는 정책과 구분한다. 후보에서 production_allowed 필드를 읽었다는 주장이 아니다.\n\n해당 관측의 외부 화면 PR6 head는 '+r['frontend']['head']+', base는 '+r['frontend']['base']+'였다. 당시 PR 상태는 open/unmerged이며 실제 브라우저 검수는 NOT_RUN이다. 그 HEAD의 CI 상태는 '+r['frontend']['latest_HEAD_CI']+'로 기록했다. 최신 통합 SHA와 회신 인수는 화면팀 최종 회신 요청에서 별도로 확인한다.'
    facts='## 현재 코드와 설정 경계\n\n'+table(['항목','현재 구현과 미실행 경계'],list(c['existing_code_facts'].items()))+'\n\n현재 프로젝트의 URL·publishable 설정을 확인했으므로 새 프로젝트 생성이 필수라고 볼 근거는 없다. .env 예시도 Git에서 제외한다. 파일 보관과 서버 프로세스의 환경변수 주입은 별도 작업이다.'
    settings='## 공개·서버·검수 설정\n\n'+table(['설정 이름','사용 범위','용도와 현재 상태','runtime 분류'],c['environment'])+'\n\nSUPABASE_SECRET_KEY와 SUPABASE_JWKS_URL은 현재 ServerSettings의 필수 설정이 아니며 자동으로 사용되지 않는다. 프런트 NEXT_PUBLIC_SUPABASE_ANON_KEY는 publishable 참조 값을 보관하는 기존 호환 이름이다. secret key나 사용자 JWT를 뜻하지 않는다. 운영 환경의 변수 이름과 설정 채택은 외부 화면 담당자가 확인해야 한다.'
    overview='## 담당별 인계 작업\n\n'+table(['ID/우선순위','담당/계층','입력','선행','현재상태'],[[t['id']+' '+t['priority'],t['owner']+' / '+t['layer'],'; '.join(t['inputs']),', '.join(t['depends_on']) or '없음',t['status']] for t in c['tasks']])
    detail='\n\n'.join('### '+t['id']+' '+t['priority']+' — '+t['owner']+'\n\n업무:\n\n'+'\n'.join('- '+v for v in t['work'])+'\n\n완료조건:\n\n'+'\n'.join('- '+v for v in t['completion']) for t in c['tasks'])
    order='## 실행 순서와 의존관계\n\n'+table(['단계','작업','실행경계'],c['execution_order'])+'\n\n각depends_on을먼저충족한다. env/원문QA/안전한HOLD준비와실자료·운영인수를구분한다.'
    gate='## 운영 인수 완료 조건\n\n'+table(['gate','담당','현재상태','완료증거'],c['acceptance_gates'])+'\n\n실DB의 preflight/001002 개발 적용영수증과 독립·runtime 인수를 구분한다. Bearer로그인/유료·staff/실approved자료/22API/외부4페이지는NOT_RUN/HOLD다. production_ready=false/NOT_READY·mainnot_ready를각증거인수전유지한다. 이번문서작성은DB쓰기/migration/모형등록/main/배포승인이아니다. reset/drop/delete금지.'
    history='## 이전 코드 인수와 이번 후보\n\n'+c['history']['summary']+'\n\n확인된이전baseline '+c['history']['baseline']+', tree '+c['history']['tree']+'; normalhooks '+str(c['history']['previous_normal_hooks'])+'건. [이전정확CI]('+c['history']['CI']+').'
    reply='## 화면팀 최종 회신 인수\n\n[화면팀 회신 요청](화면팀_회신요청_최종.md)의 RF-01~06 및 원래 로컬 요청 ①~⑥를 함께 확인한다. 전달 문서 완성과 실제 회신·연결·보안 검수는 별도 상태다.'
    references='## 공식 primary 참고\n\n'+'\n\n'.join(v[2]+' ['+v[0]+']('+v[1]+').' for v in c['references'])+'\n\n별도 FastAPI와 이용권 단일 기준은 확정 목표다. 실제 SQL구조·메타draft/코드통합 검수는 현재 관측으로 구분하며 기본어댑터 전환·운영 배포·실JWT/전체API/화면 인수는 미실행이다. 제공자 무료 plan 가격·제한 수치를 단정하지 않는다. 공개 문서에 실제 project URL/id/key/JWT/개인식별/자료 hash/비공개 PC 경로를 넣지 않는다.'
    return '\n\n'.join(part for part in [head,architecture,current,supabase_access_recheck_text(c),supabase_actual_update_text(c),supabase_second_actual_update_text(c),supabase_current_followup_text(c),facts,settings,overview,detail,reply,order,gate,history,references] if part)

def supabase_operations_route_metadata(spec):
    c=spec['supabase_operations_handoff_contract']
    result=dict(format=c['format'],revision=c['revision'],checked_at=c['checked_at'],status=c['status'],production_ready=c['production_ready'],document=spec['current_documents']['supabase_operations_handoff'],deployment_selection=c['architecture']['selection'],entitlement_target=c['architecture']['authority_target'],entitlement_adapter_status=c['architecture']['current_entitlement_adapter']['status'],frontend_reply_document=c['reply_contract']['document'],frontend_reply_status=c['reply_contract']['document_status'],gates=[dict(id=v[0],status=v[2]) for v in c['acceptance_gates']])
    if c.get('storage_staging'):
        v=c['storage_staging'];cr=c['service_transition_contract']
        result['storage_staging']=dict(format=v['format'],status=v['status'],observed_at=v['observed_at'],evidence_id=v['evidence_id'],private_bucket=v['bucket']['public']is False,verified_objects=v['objects']['verified_count'],authenticated_raw_RLS=v['public_route_access']['actual_authenticated_raw_RLS'],engine_approved=v['engine']['engine_approved'],production_ready=v['production_ready'])
        result['service_transition']=dict(id=cr['id'],status=cr['status'],default_transition=cr['default_operating_factory_transition'],production_ready=cr['production_ready'])
        result['runtime_ingestion_policy']=dict(mode=c['runtime_ingestion_policy']['mode'],selection=c['runtime_ingestion_policy']['selection'],bulk_autoimport=False,archive_auto_adopted=False,production_ready=False)
        d=c['database_preflight'];a=c['database_application']
        result['database_preflight']=dict(status=d['status'],observed_at=d['observed_at'],evidence_id=d['evidence_id'],read_only=d['read_only'])
        result['database_application']=dict(status=a['status'],committed_at=a['committed_at'],evidence_id=a['evidence_id'],independent_review=a['independent_review_status'],runtime003=a['runtime003_status'],observation_scope=a.get('observation_scope','001/002 apply observation before runtime003; latest runtime003 is separate'),production_ready=a['production_ready'])
    if c.get('database_runtime_application'):
        v=c['database_runtime_application'];p=c['explicit_port_metadata_verification'];e=c['minimum_exam_stage'];f=c['service_transition_contract']['factory_transition_review']
        result['runtime003']=dict(status=v['status'],policies=v['policies'],scope='metadata_only',production_ready=False)
        result['explicit_port']=dict(status=p['status'],health_HTTP=p['health_ready_HTTP'],real_user_JWT=False,default_factory_transition=False)
        result['minimum_exam_stage']=dict(status=e['status'],payloads=e['payload_count'],approved_entries=e['approved_entries'],engine_approved=False,production_allowed=False)
        result['factory_decision']=dict(id=f['id'],status=f['status'],default_change_allowed=False)
    if c.get('current_followup'):
        v=c['current_followup'];p=v['phase1'];d=v['database_readonly'];t=v['selected_storage'];m=v['minimum_metadata_registration'];phase=v['phase2'];child=v['September_application_children'];source=v['source_availability'];plan=v['data_definition_followup']['implementation_plan']
        result['current_followup']=dict(format=v['format'],status=v['status'],prepared_at=v['prepared_at'],basis_commit=v['basis_commit'],
            phase1=dict(status=p['status'],commit=p['commit'],precommit_tests=p['precommit_tests'],prepush_tests=p['prepush_tests'],exact_CI_tests=p['exact_head_CI_tests']),
            phase2=dict(status=phase['status'],HEAD=phase['final_HEAD'],normal_precommit_tests=phase['normal_precommit_tests'],normal_prepush_tests=phase['normal_prepush_tests'],head_push_CI_tests=phase['exact_head_push_CI_tests'],PR_merge_test_CI_tests=phase['PR_merge_test_CI_tests'],final_develop_CI_tests=phase['final_develop_CI_tests'],integration_complete=True,operational_acceptance=False),
            readonly_metadata=dict(status=d['status'],checks=d['checks_passed'],RLS_tables=d['tables_RLS_enabled'],policies=d['policy_count'],private_REST_HTTP=406,private_REST_code='PGRST106',real_JWT=False),
            selected_storage=dict(status=t['status'],verified_objects=t['verified_object_count'],no_JWT_denials=t['no_JWT_denied_requests'],engine_approved=False,production_allowed=False,runtime_adopted=False),
            metadata_draft=dict(status=m['status'],registered_items=m['registered_metadata_items'],registration_complete=m['registration_complete'],independent_review=m['independent_review'],review_status=m['review_status'],published_release=None,engine_approved=False,production_allowed=False,runtime_adopted=False),
            September_children=dict(status=child['status'],children=child['child_count'],original_sources_preserved=True,source_and_application_contexts_bound=True,runtime_adopted=False),
            source_availability=dict(official_school_catalog=source['official_school_catalog'],admission_results_sources=source['admission_results_source_count'],admission_results_DB_registered=source['admission_results_DB_registered_count'],admission_semantics=source['official_history']['status'],selected_universities=source['official_history']['selected_university_count'],school_years=source['official_history']['school_year_pair_count'],selected_metrics=source['official_history']['selected_metric_count'],selected_offerings=source['official_history']['selected_offering_count'],native_checks=source['official_history']['independent_native_checks'],frozen_RAM_checks=source['official_history']['frozen_RAM_checks'],nationwide_QA_complete=False),
            Storage_RLS_metadata=dict(status=v['storage_RLS_metadata_review']['status'],objects_RLS=True,buckets_RLS=True,current_bucket_client_SELECT_allowed=False,actual_authenticated_JWT_HTTP='NOT_RUN',SEC_operational_gate=False),
            model_implementation_plan=dict(status=plan['status'],candidate_paths=plan['candidate_path_count'],code_changes=0,native_v1_preserved=True),
            default_factory_transition=False,external_frontend_status=v['external_frontend']['status'],source_specific_summary=dict(status=v['source_specific_final_summary']['status'],registration_policy_conditions=34,existing_GET_DB_binding_conditions=32,new_Cloud_GET=0,actual_student_calculation=False,actual_JWT=False,runtime_adopted=False),this_document_canonical_application='NOT_RUN',this_document_hooks_CI='NOT_RUN',production_ready=False)
        if 'service_transition'in result:result['service_transition']['observation_scope']='1.8.8 prepared feature snapshot; current integrated phase2 is current_followup.phase2'
    return result


SECURITY_DOCUMENT="docs/current/외부접근_데이터보호_개발기준.md"
LEGACY_API_IDS={"history.search","recruitment.read","score-profile.create","overall.analyze","report.read","offerings.search","offering.read","university.analyze","candidates.build","shortlist.update","report.export","statistics.read","session.read","forecast.capabilities","forecast.list","forecast.create","forecast.read","forecast.adjust","forecast.validate","forecast.approve","forecast.publish","forecast.published.read"}
SCORE_POLICY_ROUTES={"score-input.status.read":("GET","/api/v1/me/score-input-status",["standard","paid"]),"score-input.correction.grant":("POST","/api/v1/management/score-input-corrections",["paid"]),"report.sample.read":("GET","/api/v1/report-sample",["standard","paid"])}
REQ27_BASELINE_SOURCE_MANIFEST_SHA256='3eb6dd06220eed171ade8b9bdc24c8059e9aeb62ab00befedb1076c34ef54b47'
def policy_baseline_source_matches(spec,path,digest,indexed):
    if digest==indexed.get(path):return True
    c=spec.get("score_input_policy_contract")
    if not isinstance(c,dict) or c.get("baseline_commit")!="63337281332fcfb441f7b6c9638035061cee0636":return False
    prior=c.get("prior_source_bindings",{})
    if not isinstance(prior,dict) or hashlib.sha256(json.dumps(prior,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()!=REQ27_BASELINE_SOURCE_MANIFEST_SHA256:return False
    return prior.get(path)==digest and c.get("current_source_bindings",{}).get(path)==indexed.get(path)
def validate_score_input_policy(spec):
    c=spec.get("score_input_policy_contract");errors=[]
    required=tuple(int(x) for x in spec.get("version","0.0.0").split("."))>=(1,9,73)
    if c is None:return ["REQ-27 policy contract missing"] if required else []
    if not isinstance(c,dict):return ["REQ-27 policy contract invalid"]
    rows=spec.get("operations",[]);by_id={o.get("id"):o for o in rows}
    if (set(c.get("legacy_operation_ids",[]))!=LEGACY_API_IDS or len(c.get("legacy_operation_ids",[]))!=22 or
        set(c.get("extension_operation_ids",[]))!=set(SCORE_POLICY_ROUTES) or len(c.get("extension_operation_ids",[]))!=3 or
        set(by_id)!=LEGACY_API_IDS|set(SCORE_POLICY_ROUTES) or len(rows)!=25 or c.get("operation_count")!=25):errors.append("REQ-27 exact legacy22 plus extension3 scope drift")
    if c.get("format")!="jungsi.score-input-policy-contract/v1" or c.get("requirement")!="REQ-27" or c.get("public_session_fields")!=["format","member_tier","entitlement_expires_at"]:errors.append("REQ-27 version/session boundary drift")
    for key in ("activation_status","actual_new_policy_requests"):
        if c.get(key)!="NOT_RUN":errors.append("REQ-27 unverified operational promotion: "+key)
    migration=c.get("actual_migration_status")
    if migration not in {"NOT_RUN","APPLIED_EMPTY_SCHEMA_NOT_ACTIVATED"}:errors.append("REQ-27 migration state invalid")
    if migration=="APPLIED_EMPTY_SCHEMA_NOT_ACTIVATED":
        evidence=c.get("migration_evidence",{})
        if (evidence.get("sql_sha256")!="448c4d7a9463054219c54fb0e524bc6a0d55831f25c0cab99abab5bd893ecd55" or evidence.get("sql_path")!="database/migrations/006_score_input_policy.prepared.sql" or not re.fullmatch(r"[a-f0-9]{64}",str(evidence.get("native_receipt_sha256",""))) or evidence.get("new_tables")!=7 or evidence.get("new_table_rows")!=0 or evidence.get("app_select_tables")!=7 or evidence.get("app_insert_tables")!=5 or evidence.get("new_rls_policies")!=12 or evidence.get("schema_version")!="006_score_input_policy" or any(evidence.get(key)is not True for key in ("ACL_RLS_FK_verified","empty_ledgers_verified","005_retained")) or any(type(evidence.get(key))is not int or evidence.get(key)!=0 for key in ("student_data_DML","admission_data_DML","rollout_rows","new_policy_requests")) or evidence.get("activation")!="NOT_RUN" or evidence.get("public_RPC_006a")!="NOT_RUN"):errors.append("REQ-27 applied empty schema requires exact SQL/native evidence and no activation")
    native=c.get("native_SQL_preparation_evidence",{}).get("guard")
    if native is not None:
        if (not isinstance(native,dict) or native.get("status")!="PASS_BOUNDED_READONLY_EMPTY_ROLLOUT" or native.get("receipt_sha256")!="0eca093fd02e40f6878b321ed99275684d7bbf790ba437c2bc220d554894b677" or native.get("source_sha256")!=c.get("current_source_bindings",{}).get(native.get("source_path")) or native.get("expected_http_status")!=503 or native.get("expected_code")!="score_input_transition_pending" or native.get("writes")!=0 or native.get("authenticated_API_verified")is not False or native.get("rollout_approved")is not False):errors.append("REQ-27 native empty guard evidence boundary drift")
    for oid,(method,path,tiers) in SCORE_POLICY_ROUTES.items():
        row=by_id.get(oid,{})
        if row.get("method")!=method or row.get("path")!=path or row.get("member_tiers")!=tiers or row.get("report_owner")is not False or row.get("confirmed_score_profile")is not False or "REQ-27" not in row.get("requirements",[]):errors.append("REQ-27 route policy drift: "+oid)
    for oid in ("score-profile.create","overall.analyze"):
        if by_id.get(oid,{}).get("member_tiers")!=["paid"]:errors.append("REQ-27 personal score input must be paid")
    export=by_id.get("report.export",{})
    if export.get("member_tiers")!=["standard","paid"] or export.get("confirmed_score_profile")is not False:errors.append("REQ-27 expired own export retention drift")
    rights=c.get("input_rights",{})
    if (type(rights.get("initial_attempts"))is not int or rights.get("initial_attempts")!=1 or type(rights.get("correction_grants"))is not int or rights.get("correction_grants")!=1 or rights.get("semantic_rejection_consumes")is not True or rights.get("structural_auth_rate_and_known_precommit_failure_consumes")is not False):errors.append("REQ-27 one-plus-one debit boundary drift")
    daily=c.get("daily_limits",{})
    if any(daily.get(k)!="replaced_by_stage_rights" for k in ("distinct_scores","calculation_cost")) or set(daily.get("preserved",[]))!={"request_window","concurrent_jobs","per_request_calculation_units","per_request_runtime","result_volume","storage_fail_closed"} or daily.get("private_policy_required")is not True:errors.append("REQ-27 daily replacement/physical protection drift")
    if set(c.get("delivery",{}).get("producer_operations",[]))!={"overall.analyze","university.analyze","candidates.build"}:errors.append("REQ-27 financial producer scope drift")
    if any(c.get("preservation",{}).get(k)is not False for k in ("existing_files_deleted","existing_passes_modified","original_P2_replayed","003_approval_extends_to_006")):errors.append("REQ-27 preservation boundary drift")
    if set(c.get("runtime_matrix",{}))!={"native_edge","python_fastapi"}:errors.append("REQ-27 runtime-specific status missing")
    prior=c.get("prior_source_bindings",{});current=c.get("current_source_bindings",{})
    indexed_sources={p:v.get("declarations",{}).get("source_sha256") for p,v in spec.get("edge_harness",{}).get("files",{}).items()}
    if not isinstance(prior,dict) or c.get("baseline_commit")!="63337281332fcfb441f7b6c9638035061cee0636" or hashlib.sha256(json.dumps(prior,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()!=REQ27_BASELINE_SOURCE_MANIFEST_SHA256 or c.get("prior_source_manifest_sha256")!=REQ27_BASELINE_SOURCE_MANIFEST_SHA256 or current!=indexed_sources:errors.append("REQ-27 prior snapshot/current candidate source separation drift")
    verification=c.get("verification",{});bindings=c.get("current_descendant_source_bindings",{})
    expected_paths={"supabase/functions/_shared/jungsi/application/usage_service.ts","tests/edge/test_runtime_budget.ts","tests/edge/test_usage_service.ts"}
    indexed={p:v.get("declarations",{}).get("source_sha256") for p,v in spec.get("edge_harness",{}).get("files",{}).items()}
    if (verification.get("baseline_edge_unit_count")!=590 or verification.get("new_policy_test_path")!="tests/edge/test_score_input_policy.ts" or verification.get("new_policy_test_count")!=31 or spec.get("edge_harness",{}).get("unit_count")!=(656 if spec.get("catalog_payload_scope_contract") else 644 if spec.get("service_performance_contract") else 624) or verification.get("extension_route_case_count")!=3 or set(bindings)!=expected_paths or any(not re.fullmatch(r"[a-f0-9]{64}",str(value)) or value!=indexed.get(path) for path,value in bindings.items())):errors.append("REQ-27 current descendant source/test registration drift")
    extension=c.get("extension_implementation_bindings",{});evidence=c.get("extension_runtime_test_bindings",{})
    expected_service="supabase/functions/_shared/jungsi/application/score_input_service.ts"
    expected_evidence={"supabase/functions/_shared/jungsi/application/api_dispatch.ts","supabase/functions/_shared/jungsi/infrastructure/api_http.ts","supabase/functions/_shared/jungsi/infrastructure/runtime_composition.ts","tests/edge/test_score_input_policy.ts","tests/edge/public_api_contract_fixture.ts","tests/edge/synthetic_api_contract.ts"}
    if (not isinstance(extension,dict) or set(extension)!=set(SCORE_POLICY_ROUTES) or any(not isinstance(binding,dict) or set(binding)!={"path","source_sha256","symbol"} or binding.get("path")!=expected_service or binding.get("symbol")!="ScoreInputService.execute" or not re.fullmatch(r"[a-f0-9]{64}",str(binding.get("source_sha256",""))) or binding.get("source_sha256")!=indexed.get(expected_service) for binding in extension.values()) or not isinstance(evidence,dict) or set(evidence)!=expected_evidence or any(not re.fullmatch(r"[a-f0-9]{64}",str(value)) or value!=indexed.get(path) for path,value in evidence.items())):errors.append("REQ-27 extension implementation/runtime/test source binding drift")
    return errors

def validate_service_performance(spec):
    c=spec.get("service_performance_contract");errors=[]
    required=tuple(int(x) for x in spec.get("version","0.0.0").split("."))>=(1,9,74)
    if c is None:return ["Service performance contract missing"] if required else []
    cache=c.get("cache",{});proof=c.get("verification",{});batch=c.get("batch_cr",{});activation=c.get("activation",{})
    if (c.get("format")!="jungsi.service-performance/v1" or c.get("status")!="SOURCE_CANDIDATE_NOT_DEPLOYED" or c.get("production_ready")is not False or cache.get("scope")!="completed_SHA_verified_immutable_artifact_payloads_only" or
        (cache.get("max_entries"),cache.get("max_source_bytes"),cache.get("max_age_ms"))!=(16,4194304,60000) or cache.get("logical_charge_on_hit")is not True or cache.get("cross_request_queue")is not False or
        set(cache.get("fresh_checks",[]))!={"binding","expiry","head","registry_selection_approval","bucket_privacy_and_cap","relay_JWT","current_tier","ownership","shared_atomic_usage"} or
        set(cache.get("excluded",[]))!={"head","registry_selection_decisions","usage_policy","user_responses","authorization","reservations","pending_promises"}):errors.append("Service performance cache trust/budget boundary drift")
    if (proof.get("baseline_edge_tests")!=624 or proof.get("added_edge_tests")!=20 or proof.get("current_edge_tests")!=(656 if spec.get("catalog_payload_scope_contract") else 644) or spec.get("edge_harness",{}).get("unit_count")!=(656 if spec.get("catalog_payload_scope_contract") else 644) or
        set(proof.get("test_paths",[]))!={"tests/edge/test_supabase_artifacts.ts","tests/edge/test_runtime_controls.ts","tests/edge/test_runtime_context.ts"} or proof.get("live_auth_DB_Storage")!="NOT_RUN" or proof.get("deployment")!="NOT_RUN"):errors.append("Service performance additive test/evidence drift")
    if (batch.get("status")!="PROPOSED_NOT_IMPLEMENTED" or batch.get("registered_operation_count")!=25 or len(spec.get("operations",[]))!=25 or c.get("retry",{}).get("server_wait")!="NOT_IMPLEMENTED_NO_SOCKET_OR_TRANSACTION_QUEUE" or
        activation.get("006_sql_changed")is not False or activation.get("deploy")!="NOT_RUN" or activation.get("candidate_includes_REQ27")is not True):errors.append("Service performance proposed API/activation boundary drift")
    return errors

def validate_catalog_payload_scope(spec):
    c=spec.get("catalog_payload_scope_contract");errors=[]
    required=tuple(int(x) for x in spec.get("version","0.0.0").split("."))>=(1,9,75)
    if c is None:return ["Catalog payload scope contract missing"] if required else []
    if (c.get("format")!="jungsi.catalog-payload-scope/v1" or c.get("status")!="SOURCE_CANDIDATE_NOT_DEPLOYED" or set(c.get("operations",[]))!={"history.search","recruitment.read","offerings.search","offering.read"} or
        c.get("all_selected_reference_metadata")is not True or c.get("health_ready")!="all" or c.get("payload_mode")!="catalog_only" or c.get("new_API_or_scope_approval")is not False or c.get("rollout_or_deployment")is not False or c.get("source032_drop_in_accepted")is not False or
        set(c.get("current_checks",[]))!={"binding","expiry","head","registry_selection_scope_and_approval","all_reference_shape_and_limits","fresh_private_bucket_and_maximum_selected_bytes","relay_JWT","current_tier","ownership","shared_atomic_usage","logical_charge_on_cache_hit"}):errors.append("Catalog payload trust/operation boundary drift")
    v=c.get("verification",{});parent=spec.get("service_performance_contract",{}).get("parent_cache_candidate",{})
    if (v.get("parent_edge_tests")!=644 or v.get("added_edge_tests")!=12 or v.get("current_edge_tests")!=656 or spec.get("edge_harness",{}).get("unit_count")!=656 or v.get("live_latency")!="NOT_RUN" or v.get("deployment")!="NOT_RUN" or
        parent.get("commit")!="7d53ddad081115c97a23faa7f1a4784866612410" or parent.get("Edge")!=644 or parent.get("preserved")is not True):errors.append("Catalog payload additive parent/test evidence drift")
    return errors

SECURITY_REQUIREMENTS={"REQ-24","REQ-25","REQ-26"}
SECURITY_GATES={
    "security_response_artifacts":{"SEC-QA-01","SEC-QA-02"},
    "security_direct_authorization":{"SEC-QA-03","SEC-QA-04"},
    "security_harvest_controls":{"SEC-QA-05","SEC-QA-06","SEC-QA-07"},
}
SECURITY_CASES={
    "SEC-QA-01":("SEC-01","synthetic_HTTP"),
    "SEC-QA-02":("SEC-02","browser_artifacts"),
    "SEC-QA-03":("SEC-03","synthetic_HTTP"),
    "SEC-QA-04":("SEC-04","operational_auth_db"),
    "SEC-QA-05":("SEC-05","synthetic_HTTP"),
    "SEC-QA-06":("SEC-06","operational_auth_db"),
    "SEC-QA-07":("SEC-07","synthetic_HTTP"),
    "SEC-QA-08":("SEC-08","contract_harness"),
}
SECURITY_INVARIANTS={
    "recursive_role_based_response_allowlist","browser_artifact_inspection_required",
    "verified_server_relay_required","application_user_authorization_required",
    "free_overall_is_throttled","paid_candidates_is_throttled",
    "quota_shared_atomic_before_compute","quota_stable_across_identifier_rotation",
    "quota_survives_restart_and_multiple_workers","counter_failure_is_not_unlimited",
    "same_score_catalog_browse_scope_preserved","successful_score_pending_judgment_preserved",
    "role_specific_management_receipts_preserved","idempotent_replay_still_rate_limited",
    "private_data_and_secrets_stay_server_only","runtime_acceptance_is_separate",
}
SECURITY_ANALYSIS={"score-profile.create","overall.analyze","university.analyze","candidates.build"}
SECURITY_READS={"history.search","recruitment.read","report.read","offerings.search",
                "offering.read","report.export","statistics.read","forecast.published.read","shortlist.update"}
SECURITY_ERRORS={"rate_limit_exceeded":(429,True),"analysis_quota_exceeded":(429,True),
                 "security_policy_unavailable":(503,False),"operation_scope_not_approved":(503,False)}
SECURITY_ERROR_FIELDS={"code","http","retry_after_required","status"}
SECURITY_BOUNDARY_IDS={
    "forbidden":{"private_source_and_model","unapproved_internal_detail","private_reference_and_download","credential_and_token"},
    "preserve":{"student_result_and_rationale","authorized_management_receipts","independent_score_and_judgment_state"},
}
SECURITY_CONTROL_OWNERS={
    "SEC-01":"application","SEC-02":"presentation","SEC-03":"infrastructure",
    "SEC-04":"application","SEC-05":"application","SEC-06":"data",
    "SEC-07":"application","SEC-08":"planning",
}
SECURITY_CACHE_BINDING={"verified_subject_id","normalized_scores","exam_id","source_pack_version",
                        "calculation_version","rule_version","curve_version","catalog_version",
                        "analysis_version","policy_version","offering_id","report_revision"}


def security_catalog_contract(spec):
    """Only safe development metadata; never copy internal quota/storage values."""
    c=spec["security_contract"]
    return {key:c[key] for key in ("format","revision","required","document","requirements",
                                   "implementation_status","production_ready")} | {
        "contract_ref":"security_contract",
        "gateway_mode":c["gateway_policy"]["mode"],
        "runtime_enforcement_status":("implemented" if c["implementation_status"]=="implemented" else "pending_runtime_implementation"),
        "controls":[{key:row[key] for key in ("id","title","owner_layer","implementation_status")}
                    for row in c["controls"]],
        "planned_errors":[{key:row[key] for key in ("code","http","retry_after_required","status")}
                          for row in c["planned_errors"] if row.get("code") in SECURITY_ERRORS],
    }


def security_reference(spec,link):
    c=spec["security_contract"]
    return ("\n\n## 외부 접근 데이터 보호: 개발 시작 전 필수\n\n"+
            f"[외부접근 데이터보호 개발기준]({link})을 작업 전에 반드시 읽는다. "+
            f"정본은 service_spec.json의 security_contract와 workflow.development_harness이며 "+
            f"보안 revision은 {c['revision']}이다. REQ-24~26 / SEC-01~08은 화면·API·DB 개발의 공통 기준이다. "+
            "공개 응답의 재귀 허용목록, 서버 중계와 사용자 권한, 공유 누적 사용량 통제를 함께 구현한다. "+
            "기획·라우팅·route_catalog와 AGENTS 필수 참조는 동일 Git 스냅샷에서 하네스가 검사한다. "+
            "현재 운영 인수는 production_ready=false이고 3개 보안 release gate는 pending이다. "+
            "문서/계약 검사 통과는 런타임 차단 구현·브라우저·운영 DB 검수 완료와 구분한다.")


def security_operation_rights(operation):
    result=rights(operation["member_tiers"])
    capabilities=operation.get("operator_capabilities",[])
    if capabilities:
        result+="; 관리 "+"/".join(capabilities)+" + 허용 학교 scope"
        if operation["id"] in {"forecast.approve","forecast.publish"}:
            result+="; 독립 approver·자기승인 거절"
    if operation.get("report_owner"):result+="; 본인 소유 리포트/성적표"
    if operation.get("confirmed_score_profile"):result+="; 확인 성적표 필수"
    return result


def security_document_body(spec):
    c=spec["security_contract"]; h=spec["workflow"]["development_harness"];q=c["quota_policy"]
    ticks=chr(96)
    intro=(f"필수 개발 기준 · 보안 revision {ticks}{c['revision']}{ticks} · "+
           f"기획 출발 commit {ticks}{c['basis_commit']}{ticks}\n\n"+
           c["scope"]+"\n\n"+
           "**작업 전에 이 문서와 공통 명세를 읽고, 영향 operation·SEC ID·담당 브랜치를 PR에 기록한다.** "+
           "이 문서는 전체 보안 통제의 개발·인수 기준이다. 명시 보안 구성의 코드·합성 검수 결과는 DEV-008 절에서 확인한다. 전체 운영 인수는 미완료다. "+
           f"전체 구현 상태 {c['implementation_status']} / production_ready={str(c['production_ready']).lower()}. "+
           "기존 인증·소유권·이용권 코드가 존재해도 아래 추가 통제를 구현·검수하기 전 완료로 처리하지 않는다.\n\n")
    risks=table(["외부 반출 경로","필수 대응","인수 기준"],[
        ["화면 전달물에서 내부 자료를 얻음","SEC-01·02: 역할별 필드 허용목록과 브라우저 전달물 검사",
         "정상/pending/오류/재응답/인쇄·JS/HTML/RSC 등에 전체 곡선·환산표·비밀이 없음"],
        ["화면을 거치지 않고 API 직접 호출","SEC-03·04: 서버 중계 신원과 실제 사용자 권한을 각각 확인",
         "서버 신원 누락·타인·무료 유료기능·만료·scope 밖 결과 거절"],
        ["정상 계정으로 점수·결과를 반복 수집","SEC-05·06·07: 원자적 공유 예산과 계산/반환량·탐지",
         ("무료 견본·본인 저장본 조회·유료 개인 분석에 적용; ID/JWT/worker/재시작 교체로 예산 초기화 불가" if spec.get("score_input_policy_contract") else "무료 누백까지 적용; ID/JWT/worker/재시작 교체로 예산 초기화 불가")],
    ])
    flow=(ticks*3+"mermaid\nflowchart LR\n"+
          '    U["학생·학부모 브라우저<br/>허용 결과만 수신"] --> P["프레젠테이션 서버<br/>세션·CSRF·중계"]\n'+
          '    P -->|"서버 전용 신원 + 실제 사용자"| A["애플리케이션 API<br/>권한·DTO·사용량·계산"]\n'+
          '    A -->|"저장소 포트"| D["비공개 데이터 계층<br/>자료·모델·공유 사용량"]\n'+
          ticks*3+"\n\n")
    controls=table(["통제","담당 계층","기존 담당 브랜치","구현 상태","운영 검수"],
        [[r["id"]+" "+r["title"],r["owner_layer"],r["branch"],r["implementation_status"],
          r["operational_verification"]] for r in c["controls"]])
    detailed="\n\n".join("### "+r["id"]+" "+r["title"]+"\n\n"+r["rule"]+"\n\n인수: "+r["acceptance"] for r in c["controls"])
    ops=table(["operation","경로","회원/관리 조건","필수 통제","현재 적용 상태"],
        [[o["id"],o["method"]+" "+o["path"],security_operation_rights(o),
          ", ".join(o["security_policy"]["control_ids"]),o["security_policy"]["enforcement_status"]]
         for o in spec["operations"]])
    quota=(q["cost_rule"]+"\n\n"+q["counter_rule"]+"\n\n"+q["normal_use_rule"]+"\n\n"+
           "예산 키: "+", ".join(q["identity"])+". 직접 성적 입력과 본인 성적표 ID 경로 모두 같은 예산에 결속한다.\n\n"+
           "교체해도 초기화 금지: "+", ".join(q["rotation_does_not_reset"])+".\n\n"+
           "결과 재사용의 결속: "+", ".join(q["cache_binding"])+".\n\n"+
           q["number_rule"]+" 현재 숫자는 모두 null이며 미승인이다. "+
           "운영 설정 승인·검증 전 무제한 기본값을 넣거나 이 정책이 적용됐다고 표시하지 않는다.\n\n"+
           "무료 전체 누백 제공, 유료 전체 대학·학과 검색, 성공한 점수·누백과 판단 보류의 독립 표시를 유지한다. "+
           "학교 목록을 임의 축소해 보안 통제로 대체하지 않는다.")
    errors=table(["계획 코드","HTTP","Retry-After","구현 상태"],
         [[r["code"],r["http"],str(r["retry_after_required"]).lower(),r["status"]] for r in c["planned_errors"]])
    qa=table(["사례","통제","증거 범위","통과 기준"],
         [[r["id"],r["control"],r["scope"],r["expected"]] for r in c["acceptance_cases"]])
    refs="\n".join("- ["+PurePosixPath(p).name+"]("+PurePosixPath(p).name+")" if p.startswith("docs/current/")
                  else "- ["+p+"](../../"+p+")" for p in h["required_documents"])
    sources="\n".join("- ["+r["title"]+"]("+r["url"]+")" for r in c["sources"])
    return (intro+"## 세 가지 위협과 결과\n\n"+risks+
            "\n\n## 3티어 구현 경계와 연결 변경\n\n"+flow+c["transport_transition"]+"\n\n"+
            c["gateway_policy"]["failure_policy"]+"\n\n"+c["gateway_policy"]["presentation_rule"]+"\n\n"+
            c["gateway_policy"]["deployment_rule"]+
            "\n\n## 담당자별 구현과 인수\n\n"+controls+
            "\n\nSEC-03은 두 기존 담당자가 함께 인수한다. 표의 infrastructure는 분석 API 측 책임이다.\n\n"+
            table(["중계 참여 계층","담당 브랜치","책임"],[[r["owner_layer"],r["branch"],r["responsibility"]]
                  for r in c["gateway_policy"]["owner_roles"]])+"\n\n"+detailed+
            "\n\n## 모든 API의 보안 연결\n\n"+ops+
            "\n\n## 응답과 브라우저의 전달 범위\n\n"+
            "기존 operations[].contract_ref의 공개·관리 역할별 DTO가 허용목록의 원본이다. "+
            "중첩 객체/배열도 명시적으로 선택하고 저장 객체를 그대로 직렬화하지 않는다.\n\n"+
            "\n".join("- 전달 금지 ["+v["id"]+"]: "+v["description"] for v in c["response_boundary"]["forbidden"])+"\n\n"+
            "\n".join("- 보존 ["+v["id"]+"]: "+v["description"] for v in c["response_boundary"]["preserve"])+
            "\n\n## 누적 예산과 정상 이용의 보존\n\n"+quota+
            "\n\n## 실패 응답과 안전한 기록\n\n"+errors+"\n\n"+c["error_rule"]+
            "\n\n## 하네스 필수 참조와 검사\n\n"+h["start_rule"]+"\n\n"+h["report_rule"]+
            "\n\n선독 문서:\n\n"+refs+
            "\n\n기획 변경은 공통 명세와 생성 도구를 수정하고 문서·라우팅·두 catalog를 함께 생성한다. "+
            "정상 pre-commit/pre-push와 GitHub 정확 커밋 CI가 필수 계약/AGENTS 참조/operation 연결/역할·예산 "+
            "불변 조건/발행 gate와 같은 스냅샷의 생성 결과를 검사한다. "+
            "필수 항목 제거·문서 단독 편집·우회 설정·근거 없는 ready/passed는 실패한다. "+
            "개발자가 실제로 읽었는지는 기계가 증명할 수 없어 PR의 revision·영향/무영향 설명으로 남긴다. "+
            "파일 보존·비공개 데이터 제외·담당 브랜치와 기존 테스트를 유지한다."+
            "\n\n## 회귀·브라우저·운영 인수와 발행 gate\n\n"+qa+"\n\n"+
            c["evidence_rule"]+"\n\n증거 필드: "+", ".join(c["evidence_fields"])+
            ". case_id별 통과 증거의 구현 commit와 보안 revision이 일치해야 한다. "+
            "계약 회귀의 합성 PASS는 실제 JWT/이용권/DB/배포·브라우저를 대체하지 않는다. "+
            "현재 acceptance_evidence는 비어 있고 운영 실행은 NOT_RUN이다.\n\n"+
            "필수 보안 발행 gate: "+", ".join(c["mandatory_release_gates"])+
            ". 하나라도 누락·pending/failed면 main 준비 완료로 올리지 않는다."+
            "\n\n## 보호 범위의 한계\n\n"+c["limitation"]+
            "\n\n## 공식 기술 근거\n\n"+sources+secured_preparation_document(spec))


def secured_preparation_document(spec):
    c=spec.get("secured_backend_preparation_contract")
    if not c:return ""
    r=c["relay"]; h=c["health"]; v=c["verification"]
    registry=c["response_projection"].get("static_schema_registry")
    registry_note=(" 정적 registry "+registry["path"]+" ("+registry["format"]+")를 JSON으로 읽어 API별 역할 필드, 참조·순환·타입·required/optional·중복 key를 검사한다.") if registry else ""
    return ("\n\n## DEV-008 명시 보안 앱 구성\n\n"+c["scope"]+"\n\n"+
        f"계약 {c['revision']} · 정책 {c['policy_revision']} · 코드 {c['code_status']} · 운영 준비 false. "+
        "기존 create_app/configured_app·이용권·Drive·local·22 API/session v1을 유지한다. "+
        "create_secured_app(*, security, ...)를 명시 선택하며 운영 자동전환을 하지 않는다.\n\n"+
        "중계 헤더 "+r["header"]+"는 서버 전용 "+r["environment_name"]+"/명시 설정 객체에서 공급한다. "+
        "relay → 사용자 Bearer → 현재 이용권/소유권 → 입력/자료 순서다. 중계만으로 사용자 권한이 생기지 않는다. "+
        "누락/잘못된 설정은 503 security_policy_unavailable, 누락/불일치/중복/잘못된 헤더는 403 relay_authentication_failed다. "+
        "raw header의 대소문자·중복, ASCII/공백/쉼표/Unicode/크기와 정확 길이를 검사하고 bytes compare_digest를 쓴다.\n\n"+
        "22 operation의 contract_ref와 standard/paid typed root를 연결한다. 객체·배열·ID map의 값까지 재귀 투영하고 "+
        "추가 필드는 응답에서만 제거한다. 구조·필수값 오류는 비밀 없는 503이다. 자유 Any/무제한 객체는 금지한다. "+
        "정상 점수·누백·판단 보류·공식 출처/버전·권한 있는 관리 영수증을 보존한다."+registry_note+"\n\n"+
        h["public_path"]+"는 공개 최소 liveness다. "+h["relay_protected_path"]+"는 relay만 확인하고 "+
        ", ".join(h["ready_public_fields"])+"만 반환한다. production_ready=false이며 비공개 환경·DB role/경로를 전달하지 않는다.\n\n"+
        "검수 상태 "+v["status"]+". 합성 인수: "+"; ".join(v["cases"])+".\n\n"+secured_preparation_evidence(c)+
        "남은 인수: "+"; ".join(c["remaining"])+". 전체 SEC-01~08/3 보안 gate와 실운영 준비는 미완료로 유지한다.")


def secured_preparation_evidence(contract):
    v=contract['verification']; integration=contract.get('develop_integration')
    if not integration:return ''
    ci=v.get('CI') or {}
    checks='; '.join('['+name+']('+row['url']+') '+row['conclusion'] for name,row in ci.items())
    return ('기획 인수 '+integration['accepted_on']+' · ['+integration['pull_request'].rsplit('/',1)[-1]+'번 PR]('+integration['pull_request']+') · '+integration['status']+'.\n\n'+
            '구현 HEAD '+integration['implementation_head']+' · develop 병합 '+integration['integrated_develop_commit']+'.\n\n'+
            '보안 HTTP '+str(v['synthetic_test_count'])+'개 · 고정 스냅샷 전체 '+str(v['full_snapshot_test_count'])+'개 · 독립 합성 '+str(v['independent_synthetic_test_count'])+'개 PASS. '+v['implementation_continuity']+'\n\n'+
            'GitHub CI: '+checks+'. 실제 Auth·DB·BFF·브라우저·배포는 '+v['actual_Auth_DB_BFF_browser_deployment']+'이다.\n\n')


def runtime_connection_document(spec):
    c=spec['runtime_connection_preparation_contract']; q=c['runtime_selection']; r=c['readiness']; d=c['deployment']
    return (c['scope']+'\n\n계약 '+c['revision']+' · 코드 '+c['code_status']+' · 운영 준비 false. 출발 develop '+c['basis_commit']+'.\n\n'+
            ('현재 운영 플랫폼은 Google Drive·Supabase로 한정한다. 아래 Python factory·파일 경로·합성 인수는 보존된 로컬 참조 구현이며 Edge 배포 완료를 뜻하지 않는다. [Supabase 전용 배포 후속작업](Supabase_배포_화면_후속작업.md)을 함께 따른다.\n\n' if spec.get('supabase_deployment_contract') else '')+
            '## 원자료 등록과 실행 발행본\n\n'+c['source_lineage']['rule']+'\n\n'+
            '최신 비공개 정본 포인터: '+', '.join(c['source_lineage']['canonical_private_pointers'])+'. 포인터·해시·실제 release/검수 기록은 비공개이며 여기에는 실제 원자료나 수치를 복사하지 않는다.\n\n'+
            table(['단계','담당','완료 조건'],[[x['stage'],x['owner'],x['completion']] for x in c['workflow']])+'\n\n'+
            '## 명시 서버 구성과 공급자별 상태 확인\n\n'+c['composition']['factory']+'를 명시 선택하고 DEV-008 security 구성을 연결한다. 기존 create_app/configured_app·이용권·session v1·Drive·local 경로를 유지한다.\n\n'+
            '필수 구성: '+', '.join(r['required_server_components'])+'. Supabase 명시 구성의 health에서 Drive token/input/output/registry를 추가 필수로 판단하지 않는다. DB 검증과 명시 선택한 native 실행 자료의 읽기·디코딩·버전/해시 검수가 필요하다.\n\n'+
            '환경 진입점 '+c['composition'].get('environment_factory','configured_supabase_app')+' · 읽기 전 설정 이름 검사 '+chr(96)+c['composition'].get('configuration_check_command','')+chr(96)+'. 설정 이름 검사는 파일/DB/Auth/Storage를 읽지 않는다.\n\n'+
            '서버 실행 진입점 '+chr(96)+c['composition'].get('server_factory_command','')+chr(96)+'. 주소/TLS/worker/비밀 명부 mount는 배포 대상에서 확정한다. 이 문서는 배포 실행 증거가 아니다.\n\n'+
            '비공개 환경변수 이름: '+', '.join(r.get('private_environment_names',[]))+'. 값은 별도 서버 비밀 설정으로 공급하며 환경 예시 파일·클라이언트 코드에 넣지 않는다.\n\n'+
            r['path']+'는 relay를 확인하며 '+', '.join(r['ready_public_fields'])+'만 반환한다. production_ready=false이고 draft/false 승인·누락·잘못된 형식/해시/버전에 안전한503을 반환한다. '+r['diagnostics']+'\n\n'+
            '## 최소 실행 자료 선택과 검수\n\n명부 형식 '+q['registry_format']+' · 종류 '+', '.join(q['supported_kinds'])+'. 요청 기능이 필요한 kind/key만 명시 선택한다. 승인 status·engine_approved·production_allowed·archive_only=false와 native decoder·크기/해시/버전 결속을 함께 확인한다.\n\n'+
            '선택 명부 '+q.get('selection_format','')+' · '+q.get('selection_shape','')+'. 빈 선택·중복·알 수 없는 kind와 보호 위치 밖 명부는 거절한다.\n\n'+
            q.get('cross_binding_rule','')+'\n\n'+
            '원자료/CSV 저장 검수와 실행 산술 검수, 형식 검수와 모형 정확도, native 승인과 예상 기준선 forecast 승인은 각각의 근거로 판단한다. forecast는 기존 독립 editor/approver·revision/입력/정책/context 조건을 유지한다.\n\n'+
            '## 배포와 화면 담당 인계\n\n별도 Python FastAPI 서버 · 배포 대상 '+d['hosting_target_status']+' · 실제 배포 '+d['actual_deployment']+' · 화면 '+d['frontend_owner_branch']+'. 서버 UTC, 원자료/화면 Asia/Seoul이며 runtime에는 app role만 사용한다. 서버 비밀과 원자료는 브라우저에 전달하지 않는다.\n\n'+
            '외부 화면 담당은 확정 API 주소와 공개 Auth 설정, 서버 전용 relay·세션/CSRF 계약 및 같은 native 버전의 기대값을 수령해 실제1~4페이지를 검수한다. API22/DTO·회원·소유권·성공 점수와 판단 pending 조건을 유지한다.\n\n'+
            '## 검수 상태와 남은 입력\n\n검수 '+c['verification']['status']+' · 실제 원자료→native 발행/Auth/DB/BFF/브라우저/배포 '+c['verification']['actual_source_native_publication_Auth_DB_BFF_browser_deployment']+'.\n\n'+
            '확인한 구현 '+str(c['verification'].get('implementation_commit'))+' · 합성 '+str(c['verification'].get('synthetic_test_count',0))+' · 독립 합성 '+str(c['verification'].get('independent_synthetic_case_count',0))+' · 정상 훅 '+str(c['verification'].get('normal_commit_push_snapshot_test_count',0))+' · CI '+str((c['verification'].get('CI') or {}).get('url','미실행'))+'. 세부 private probe 영수증은 공개 health에 포함하지 않는다.\n\n'+
            'develop 인수 '+str((c['verification'].get('integration') or {}).get('develop_merge_commit','통합 대기'))+' · 통합 훅 '+str((c['verification'].get('integration') or {}).get('normal_commit_push_snapshot_test_count',0))+' · '+str((c['verification'].get('integration') or {}).get('PR','PR 대기'))+' · 병합 CI '+str(((c['verification'].get('integration') or {}).get('merge_CI') or {}).get('url','미실행'))+'. 코드 인수와 실제 운영 인수는 각각의 증거로 판단한다.\n\n'+
            '\n'.join('- '+x for x in c['remaining'])+'\n\n[작업 항목](../work_items/DEV-009-runtime-connection-preparation.json) · [Supabase 운영 인계](Supabase_운영_인수인계.md) · [필수 보안 기준](외부접근_데이터보호_개발기준.md)')


def validate_runtime_connection_preparation(spec):
    c=spec.get('runtime_connection_preparation_contract')
    try: required=tuple(int(x) for x in spec.get('version','0.0.0').split('.')) >= (1,9,4)
    except (ValueError,TypeError): required=False
    if c is None:return ['DEV-009 required runtime connection contract missing'] if required else []
    if not isinstance(c,dict):return ['DEV-009 runtime connection contract invalid']
    errors=[]; comp=c.get('composition',{}); lineage=c.get('source_lineage',{}); q=c.get('runtime_selection',{}); r=c.get('readiness',{}); d=c.get('deployment',{}); v=c.get('verification',{}); preserve=c.get('preservation',{})
    if (c.get('format')!='jungsi.runtime-connection-preparation/v1' or c.get('id')!='DEV-009' or c.get('branch')!='feature/application-pre-data-platform' or
        spec.get('current_documents',{}).get('runtime_connection_preparation')!='docs/current/Supabase_실행자료_연결.md' or
        not {'REQ-12','REQ-14','REQ-15','REQ-16','REQ-17','REQ-20','REQ-23','REQ-24','REQ-25','REQ-26'}<=set(c.get('requirements',[]))):
        errors.append('DEV-009 owner or source registration drift')
    if (comp.get('factory')!='create_supabase_secured_app' or comp.get('environment_factory')!='configured_supabase_app' or comp.get('explicit_selection_required')is not True or comp.get('security_contract_ref')!='secured_backend_preparation_contract' or
        comp.get('default_factories_unchanged')is not False or comp.get('legacy_factories')!=['create_app','configured_app'] or comp.get('current_entitlement_authority')!='public.jeongsi_passes' or comp.get('opening_change_ref')!='opening_security_operations_contract' or
        comp.get('session_format')!='jungsi.session/v1' or comp.get('existing_API_count')!=(len(LEGACY_API_IDS) if spec.get('score_input_policy_contract') else len(spec.get('operations',[]))) or comp.get('API_or_DTO_additions')is not False or comp.get('local_verification_unchanged')is not True):
        errors.append('DEV-009 explicit composition preservation drift')
    if (lineage.get('canonical_private_pointers')!=['DATA_ACTIVE_SUPABASE_v1.json','DATA_ACTIVE_CSV_v1.json'] or lineage.get('source_snapshots_preserved')is not True or
        any(lineage.get(k)is not False for k in ('historical_source_only_records_are_canonical','source_validation_is_engine_approval','source_or_archive_auto_adoption','actual_source_data_in_Git'))):
        errors.append('DEV-009 source registration cannot promote native runtime')
    if (q.get('registry_format')!='jungsi.data-registry/v1' or q.get('selection_format')!='jungsi.runtime-selection/v1' or any(q.get(k)is not True for k in ('private_registry_required','required_dependencies_only','native_decoder_required','engine_approved_required','production_allowed_required','reference_size_hash_version_binding_required','native_versions_separate_from_source','selected_native_cross_bindings_required')) or
        any(q.get(k)is not False for k in ('implicit_all_artifacts_selection','archive_only_required','source_files_overwritten')) or q.get('status_required')!='approved' or
        set(q.get('supported_kinds',[]))!={'exam_pack','total_model','catalog','conversion','percentile','estimate_receipt','analysis','forecast_inputs','forecast_policy','forecast_context'}):
        errors.append('DEV-009 native selection approval or integrity drift')
    if (r.get('path')!='/health/ready' or r.get('relay_required')is not True or r.get('user_Bearer_required')is not False or r.get('data_source')!='explicit_supabase_storage' or
        r.get('legacy_Drive_requirements_apply')is not False or r.get('selected_native_probe_required')is not True or r.get('draft_or_false_approval_or_bad_integrity_is_ready')is not False or
        r.get('database_verified_required')is not True or r.get('ready_public_fields')!=['status','server_timezone','production_ready','security_boundary'] or r.get('production_ready')is not False or
        set(r.get('required_server_components',[]))!={'Supabase_Auth_settings','app_role_PostgreSQL','private_Storage_scope','private_runtime_registry','explicit_required_native_selection','relay_security'} or
        set(r.get('private_environment_names',[]))!={'SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','DATABASE_URL','SUPABASE_SECRET_KEY','JUNGSI_SUPABASE_STORAGE_BUCKET','JUNGSI_SUPABASE_STORAGE_PREFIX','JUNGSI_SUPABASE_RUNTIME_REGISTRY','JUNGSI_SUPABASE_RUNTIME_SELECTION','JUNGSI_RELAY_TOKEN'}):
        errors.append('DEV-009 provider readiness or public boundary drift')
    if (d.get('architecture')!=('supabase_edge_functions' if spec.get('supabase_deployment_contract') else 'separate_Python_FastAPI_backend') or d.get('frontend_owner_branch')!='feature/presentation-foundation' or d.get('server_timezone')!='UTC' or d.get('source_display_timezone')!='Asia/Seoul' or
        d.get('app_role_only')is not True or d.get('migration_owner_as_runtime_allowed')is not False or d.get('private_credentials_in_client_allowed')is not False or d.get('actual_deployment')!='NOT_RUN' or d.get('BFF_browser_actual_acceptance')!='NOT_RUN'):
        errors.append('DEV-009 deployment preparation cannot certify live acceptance')
    if (c.get('production_ready')is not False or any(preserve.get(k)is not False for k in ('default_factory_change_allowed','source_only_automatic_publication_allowed','production_ready_promotion_allowed')) or
        v.get('actual_source_native_publication_Auth_DB_BFF_browser_deployment')!='NOT_RUN'):
        errors.append('DEV-009 preparation cannot promote production or source data')
    if c.get('code_status')not in {'planned','implemented_synthetic_verified_integration_pending','accepted_on_develop_scoped_synthetic_verified'}:
        errors.append('DEV-009 scoped code state drift')
    if c.get('code_status')!='planned' and (not re.fullmatch(r'[0-9a-f]{40}',str(v.get('implementation_commit',''))) or type(v.get('synthetic_test_count'))is not int or v.get('synthetic_test_count',0)<=0 or v.get('status')!='PASS_SCOPED_SYNTHETIC_HTTP'):
        errors.append('DEV-009 implementation completion lacks fixed synthetic evidence')
    if c.get('code_status')!='planned':
        row=next((x for x in spec.get('implementation',[]) if x.get('path')=='src/jungsi_touch/infrastructure/supabase_runtime.py'),None)
        if row is None or not {'RuntimeArtifactSelection','SupabaseRuntimeReadiness','create_supabase_secured_app','configured_supabase_app','configuration_status'}<=set(row.get('symbols',[])):
            errors.append('DEV-009 runtime implementation or entrypoint registration drift')
        ci=v.get('CI')
        if not isinstance(ci,dict) or ci.get('headSha')!=v.get('implementation_commit') or ci.get('conclusion')!='success':
            errors.append('DEV-009 CI evidence does not bind verified implementation')
    return errors



def live_execution_document(spec):
    """Render current runtime work from operation IDs, without duplicating routes."""
    c=spec.get('supabase_deployment_contract',{}).get('live_execution')
    if not c:return ''
    positions=c.get('position_graph')
    position_text=('\n\n### 위치 그래프의 기준\n\n'+table(['표시 기준','산식','적용 범위'],positions['formula_rows'])+'\n\n'+
        '\n\n'.join(positions[k]for k in ('comparison_rule','synthetic_rule','live_rule','frontend_handoff')))if positions else ''
    assembly=c.get('runtime_assembly')
    assembly_text=''
    if assembly:
        assembly_text=('\n\n### 서버 런타임 조립과 입력 계약\n\n'+assembly['status_text']+'\n\n'+
            table(['소스 진입점','경로','SHA-256'],[[k,v['path'],v['source_sha256']]for k,v in assembly['bindings'].items()])+'\n\n'+
            table(['서버 설정 이름','허용된 기존 이름','현재 상태','입력의 의미'],[[v['name'],assembly['environment_aliases'].get(v['name'],'없음'),v['status'],v['meaning']]for v in assembly['environment']])+'\n\n'+
            '\n\n'.join(assembly[k]for k in ('environment_alias_rule','scope_rule','precision_rule','request_order_rule','missing_settings_rule','control_source_rule','reuse_rule','verification_rule'))+'\n\n'+
            table(['실제 연결에 필요한 항목','대기 조건'],assembly['waiting']))
    preparation=c.get('preconnection_preparation')
    preparation_text=''
    if preparation:
        preparation_text=('\n\n### API 연결 전 선행 준비\n\n'+
            table(['작업','담당','준비 상태','완료 조건'],[[p['id']+' '+p['title'],p['owner'],p['state'],p['completion']]for p in preparation['packages']])+'\n\n'+
            preparation['reuse_rule']+'\n\n'+preparation['execution_rule']+'\n\n'+
            '인수 영수증 필드: '+', '.join(preparation['evidence_fields'])+'. 아래 표는 준비 조건이며 실제 native/deployment 증거가 아니다.\n\n'+
            table(['operation / 계약 경로','실행 전 필요한 조건','인수 시 기대 결과'],[
                [o['id']+' / '+o['method']+' '+o['path'],preparation['cases'][o['id']]['prerequisites'],preparation['cases'][o['id']]['expected']]
                for o in spec['operations'] if o['id'] in preparation['cases']]))
    intake=c.get('bff_reply_intake')
    intake_text=''
    if intake:
        transport=intake['transport']
        intake_text=('\n\n### 최초 화면 BFF 회신과 등록 이력\n\n'+intake['intake_rule']+'\n\n'+
            table(['소스/외부 보고','참조'],[
                ['화면 소스',intake['frontend_source_commit']],
                ['화면팀 보고 Worker / 배포 시각',intake['reported_worker_version']+' / '+intake['reported_deployed_at_UTC']],
                ['실제 Worker 독립 관측',intake['worker_deployment_independently_observed']],
                ['최초 회신 당시 모드 / 새 API 호출',intake['reported_state']['mode']+' / '+str(intake['reported_state']['new_API_calls'])],
                ['Owner 설정 등록',intake['registration']['status']]])+'\n\n'+
            table(['연결 항목','소스에서 대조한 계약'],[
                ['정상 진입 / API base',transport['normal_entry_path']+' / '+transport['api_base_setting']+' 끝은 '+transport['api_base_ends_with']],
                ['경로 접미 / ingress 제거',transport['caller_appends']+' / '+transport['ingress_removes_only']],
                ['사용자 / 서버 헤더',transport['user_header']+': '+transport['user_scheme']+' / '+transport['relay_header']],
                ['캐시 / 쓰기 멱등',transport['fetch_cache']+' / '+transport['write_header']]])+'\n\n'+
            table(['남은 인수','담당','상태','필요 증거'],[[g['id'],g['owner'],g['status'],g['expected']]for g in intake['acceptance_gates']])+'\n\n'+
            intake['registration']['private_delivery_rule']+'\n\n'+intake['verification_rule']+'\n\n'+intake['reuse_rule'])
    post=c.get('post_registration_acceptance')
    post_text=''
    if post:
        owner=post['owner_registration'];ready=post['readiness'];boundary=post['boundary_checks']
        post_text=('\n\n### 설정 등록 직후 준비 검수 이력\n\n'+post['interpretation_rule']+'\n\n'+
            table(['확인 범위','현재 결과','증거 경계'],[
                ['새5설정',str(owner['matched_setting_count'])+'/5 digest 일치 / '+owner['reported_at_UTC'],'Owner 보고와 승인파일 대조; Dashboard 독립재측정 NOT_RUN'],
                ['같은 함수 readiness',str(ready['http'])+' '+ready['status']+' / '+ready['at_KST'],ready['cache_control']+'; health 준비검수이며 업무 인수 아님'],
                ['잘못된 relay',str(boundary['wrong_relay_http'])+' '+boundary['wrong_relay_code'],boundary['at_KST']+' / no-store'],
                ['실사용자 Bearer 누락',str(boundary['missing_user_Bearer_http'])+' '+boundary['missing_user_Bearer_code'],'실사용자 getUser/본인profiles/aal2 인수 아님'],
                ['등록 직후 실사용자 / Worker등록 / BFF브라우저',post['real_user_acceptance']+' / '+post['Worker_relay_registration']+' / '+post['BFF_live_browser'],'정상로그인 같은BFF 통로로 다음 검수'],
                ['업무native / 배포인수',str(post['business_native_accepted'])+'/22 / '+str(post['business_deployment_accepted'])+'/22','지속성능·운영3gate·일반공개 미완료']])+'\n\n'+post['next_rule']+'\n\n'+post['scope_rule'])
    current=c.get('post_live_receipt')
    current_text=''
    if current:
        current_text=('\n\n### 최초 화면팀 실연결 회신 이력과 남은 검수\n\n'+current['interpretation_rule']+'\n\n'+
            table(['항목','화면팀 보고 / 검수 경계'],[
                ['회신 당시 화면 / Worker / 모드',current['frontend_source_commit']+' / '+current['worker_version']+' / '+current['mode']],
                ['Worker relay 등록 / 실제 Bearer 세션',current['Worker_relay_registration']+' / '+current['real_Bearer_session']],
                ['aal1 / aal2 세션',current['session_observation']],
                ['P1 / P3 검색',current['search_observation']],
                ['P2 저장·분석·재조회',current['P2_save_analysis_reread']],
                ['P4 관측',current['P4_observation']],
                ['소유권 / CSRF / 만료갱신',current['ownership']+' / '+current['CSRF']+' / '+current['expiry_refresh']],
                ['업무 native / 배포 인수',str(current['business_native_accepted'])+'/22 / '+str(current['business_deployment_accepted'])+'/22'],
                ['서비스 오류 분류',current['scope_error_rule']]])+'\n\n'+current['next_rule'])
    deployment=c.get('actual_editor_deployment')
    deployment_text=''
    if deployment:
        source=deployment['source'];bundle=source['bundle']
        deployment_text=('\n\n### 이전 함수 소스 배포 이력과 당시 업무 인수\n\n'+deployment['scope']+'\n\n'+
            table(['확인 범위','결과'],[
                ['소스 후보 / develop / tree',source['candidate_commit']+' / '+source['accepted_develop_merge']+' / '+source['tree']],
                ['고정 번들',str(bundle['bytes'])+' bytes / SHA-256 '+bundle['sha256']],
                ['배포 관측 시각',deployment['observed_at_UTC']],
                ['editor 입력·reload 재조회',deployment['status']],
                ['기존 함수 / verify_jwt', '기존 함수 유지 / true 유지'],
                ['배포 영수증 SHA-256',deployment['receipt_sha256']],
                ['새 버전 health / 같은 BFF 안전 오류 관측',deployment['new_version_health']+' / '+deployment['same_BFF_actual_JWT']],
                ['P2 / 소유권 / CSRF / 만료갱신', 'NOT_RUN / NOT_RUN / NOT_RUN / NOT_RUN'],
                ['업무 native / 배포 인수','0/22 / 0/22']])+'\n\n'+deployment['preservation_rule'])
        for key in ('native_readiness','same_BFF_error_observation'):
            observation=deployment.get(key)
            if observation:
                deployment_text+='\n\n'+observation['scope']+' 영수증 SHA-256 '+observation['receipt_sha256']+'.'
    attempt=c.get('current_P2_attempt')
    reply=c.get('frontend_P2_reply')
    if reply:
        worker=reply['reported_worker_deployment'];logging=reply['safe_observation_followup']
        deployment_text+=('\n\n### 이전 화면팀 P2 저장 검수 회신 이력\n\n'+reply['interpretation_rule']+'\n\n'+
            table(['확인 범위','보고와 남은 확인'],[
                ['회신 원문',str(reply['reply_bytes'])+' bytes / SHA-256 '+reply['reply_receipt_sha256']],
                ['이전 Root 시도',reply['earlier_root_attempt']['scope']],
                ['외부 Worker 배포 보고',worker['worker_version']+' / '+worker['deployed_at_UTC']+' / 당시 source SHA 미제공·미푸시'],
                ['공개 저장소 화면 소스',worker['last_pushed_source_commit']+'; 당시 새 Worker와 소스 결속 미확인'],
                ['화면팀 별도 시도',reply['separate_frontend_attempt']['scope']],
                ['오류 표시·관측 수정',logging['status']+' / 당시 source SHA 미제공; 당시 배포·재검수 미완료'],
                ['서버 전용 안전 관측',', '.join(logging['server_only_fields'])],
                ['사용자 화면',', '.join(logging['user_visible_fields'])]])+'\n\n'+
            reply['partial_success_rule']+'\n\n'+reply['storage_response_boundary']+'\n\n'+logging['rule'])
        admin=reply.get('admin_UI_observation')
        if admin:
            deployment_text+='\n\n'+admin['scope']+' 영수증 SHA-256 '+admin['receipt_sha256']+'.'
        backend=c.get('backend_safe_observation_plan')
        if backend:
            observer_history=bool(c.get('deployment_history'))and deployed_observer_contract_pinned(spec)
            heading='이전 ed978 설치 당시 요청별 안전 관측 계약'if observer_history else '서비스 요청별 안전 관측 개선 계약'
            deployment_text+=('\n\n### '+heading+'\n\n'+('당시 기록 원문: 'if observer_history else '')+backend['rule']+'\n\n'+
                table(['항목','계획 계약과 인수 경계'],[
                    ['담당',backend['branch']],
                    ['서버 전용 허용 필드',', '.join(backend['server_only_fields'])],
                    ['구현 / 검증 / 배포',backend['implementation']+' / '+backend['verification']+' / '+backend['deployment']],
                    ['소스 결속',('설치 당시 관측 계약·소스4개·테스트2개 고정; 새 수정 후보는 아래 현재 해시로 별도 검증'if deployed_observer_contract_pinned(spec)else('현재 색인·선언 해시와 소스4개·테스트2개 결속; 후보 '+backend['implementation_candidate_commit']))if backend.get('implementation_candidate_commit')else('현재 색인·선언 해시와 소스4개·테스트2개 결속; 자신의 커밋 SHA는 후속 패키지에서 고정'if backend.get('source_bindings')else '후보 SHA 미제공; 정본 완료 소스 아님')]]))
            proof=backend.get('synthetic_verification')
            if proof:
                deployment_text+='\n\n'+table(['합성 후보 검증','범위와 결과'],[
                    ['집중 검사',str(proof['focused_passed'])+' PASS / '+str(proof['focused_failed'])+' FAIL; 신규 '+str(proof['new_tests'])+'개'],
                    ['전체 스냅샷 검사',str(proof['full_suite_expected'])+('개는 설치 당시 소스 검수 이력; 새 후보의 전체 검사는 아래 별도 요구'if deployed_observer_contract_pinned(spec)else '개 실행을 정상 훅·정확 SHA CI에서 별도로 요구')],
                    ['집중 로그 SHA-256',proof['focused_log_sha256']],
                    ['소스 배포 / 실제 업무·배포 인수',backend['deployment']+' / 0/22 · 0/22; 합성 검수와 실제 인수 분리']])
                deployment_text+='\n\n'+table((['설치 당시 파일','고정 SHA-256']if deployed_observer_contract_pinned(spec)else ['후보 파일','현재 소스 SHA-256']),[[p,h]for p,h in {**backend['source_bindings'],**backend['test_bindings']}.items()])
    installations=c.get('deployment_history',{})
    if installations:
        deployment_text+='\n\n### 보존된 후속 설치원장\n\n'+table(['증거 ID','설치 소스 / bundle SHA-256','당시 상태 / 준비 / visible event 수','배포 영수증 SHA-256'],[[key,row['source']['candidate_commit']+' / '+row['source']['bundle']['sha256'],row['status']+' / '+row['new_version_health']+' / '+str((row.get('safe_observer_acceptance')or{}).get('visible_event_count','미검수')),row['receipt_sha256']]for key,row in installations.items()])
    latest=c.get('current_deployment')
    if latest:
        source=latest['source'];bundle=source['bundle']
        deployment_text+=('\n\n### 현재 실제 설치와 후속 준비상태\n\n'+latest['scope']+'\n\n'+
            table(['확인 범위','현재 설치 영수증'],[
                ['소스 후보 / develop / tree',source['candidate_commit']+' / '+source['accepted_develop_merge']+' / '+source['tree']],
                ['번들 / source manifest',str(bundle['bytes'])+' bytes / '+bundle['sha256']+' / '+str(source['source_files_count'])+'개'],
                ['배포 영수증 SHA-256',latest['receipt_sha256']],
                ['전체 reload / legacy JWT','일치 / ON'],
                ['새 배포 준비상태',latest['new_version_health']],
                ['업무 native / 배포 인수','0/22 / 0/22']]))
        readiness=latest.get('native_readiness')
        if readiness:deployment_text+='\n\n'+readiness['scope']+' 영수증 SHA-256 '+readiness['receipt_sha256']+'.'
        observer=latest.get('safe_observer_acceptance')
        if observer:
            deployment_text+='\n\n'+observer['scope']+' 영수증 SHA-256 '+observer['receipt_sha256']+'.\n\n'+table(['관측 범위','상태'],[
                ['visible event 형식',str(observer['visible_event_count'])+'개 / 허용5필드·32HEX 형식 확인'],
                ['전체 로그 비노출 / 특정 BFF actor / 업무 성공','미증명 / 미증명 / 미증명']])
    source_proof=c.get('current_source_verification')
    if source_proof:
        checks=source_proof['verified_source_test_counts']
        deployment_text+='\n\n### 현재 설치 소스의 검수와 공통기획의 후속 검사\n\n'+source_proof['rule']+'\n\n'+table(['source spec1.9.70 검수','범위'],[
            ['source / merge',source_proof['candidate_commit']+' / '+source_proof['accepted_develop_merge']],
            ['정상 소스 검사',str(checks['python'])+' Python / '+str(checks['deno'])+' Deno / '+str(checks['oracle'])+' oracle / 불일치 '+str(checks['oracle_mismatches'])],
            ['업무 native / 배포 인수','0/22 / 0/22']])
        deployment_text+='\n\n'+table(['정확 source CI','검증 commit','결과'],[[str(row['databaseId']),row['headSha'],row['conclusion']]for row in source_proof['ci_runs']])
    fix=c.get('admin_session_identity_fix')
    if fix:
        proof=fix['synthetic_verification']
        installed=fix.get('deployment')=='SOURCE_DEPLOYED_REMOTE_EDITOR_VERIFIED'
        label='관리자 세션의 예산 연결 수정 · 소스 설치와 업무 인수 분리'if installed else '관리자 세션의 예산 연결 수정 후보 · 미배포'
        deployment_text+='\n\n### '+label+'\n\n'+('합성 준비 당시 계약: 'if installed else '')+fix['rule']+'\n\n'+table(['확인 범위','현재 후보'],[
            ['출발 커밋 / 준비 당시 검증',fix['basis_commit']+' / '+fix['basis_verification']],
            ['구현 / 합성 / 실제 배포',fix['implementation']+' / '+fix['verification']+' / '+fix['deployment']],
            ['수정 전 / 후 집중 회귀',str(proof['before_passed'])+' PASS / '+str(proof['before_failed'])+' FAIL → '+str(proof['focused_passed'])+' PASS / '+str(proof['focused_failed'])+' FAIL'],
            ['신규 / 전체 스냅샷 검사',str(proof['new_tests'])+'개 추가 / '+str(proof['full_suite_expected'])+'개 정상 훅·정확 SHA CI 필수'],
            ['배포 관측 이력 고정 SHA-256',fix['deployed_observer_contract_sha256']],
            ['합성 준비 당시 실제 요청·DB 조회 / 전체 업무 인수','0 / 0; 현재 실행은 아래 별도 관측 / 0/22 · 0/22']])
        deployment_text+='\n\n'+table(['새 후보 파일','현재 소스 SHA-256'],[[p,h]for p,h in {**fix['source_bindings'],**fix['test_bindings']}.items()])
    history=c.get('P2_attempt_history',{})
    if history:
        deployment_text+='\n\n### 보존된 P2 시도 이력\n\n'+table(['증거 ID','당시 상태','멱등키 문맥','영수증 SHA-256'],[[key,row['status'],row['idempotency_context_status'],row['receipt_sha256']]for key,row in history.items()])
    if attempt and attempt.get('format')in {'jungsi.p2-runtime-attempt/v1','jungsi.p2-runtime-attempt/v2'}:
        deployment_text+=('\n\n### 현재 P2 실제 단일 제출과 제한된 후속 관측\n\n'+attempt['scope']+'\n\n'+
            table(['확인 범위','현재 결과'],[
                ['실행 / 재시도',str(attempt['submit_count'])+'회 / '+str(attempt['retry_count'])+'회'],
                ['실제 상태 / 멱등키 문맥',attempt['status']+' / '+attempt['idempotency_context_status']],
                ['UI HTTP / code / 요청ID','미확정 / 미확정 / 미노출'],
                ['전체 DB쓰기','미확정; 아래 범위 snapshot과 구분'],
                ['실제 시도 영수증 SHA-256',attempt['receipt_sha256']]])+'\n\n'+
            table(['단계','정확 응답 관측/실행 상태','해당 단계 HTTP / code'],[[name,row['status'],str(row['HTTP_status'])+' / '+str(row['safe_error_code'])]for name,row in attempt['steps'].items()]))
        if attempt.get('format')=='jungsi.p2-runtime-attempt/v2':
            deployment_text+='\n\n'+table(['한정 기능 관측','UI 표시 상태','증거 ID'],[[key,row['status'],str(row['evidence_id'])]for key,row in attempt['functional_observations'].items()])
            deployment_text+='\n\n보고서 reload '+str(attempt['report_reload_count'])+'회; 폼 재제출과 별개다. UI 표시 성공·owner/case 집계·보고서 재조회는 정확 POST 응답/분석 완료·전체22업무/보안3gate 인수를 대신하지 않는다. HTTP201 또는 pending 리포트 생성만으로 계산 완료를 주장하지 않는다.'
            if attempt.get('analysis_result_scope'):
                deployment_text+='\n\n저장 프로필·과목별 결과의 한정 기능 관측이다. 전체 누백·조합분포는 미발행 pending이며 전체 위치 계산 완료는 미확정이다.'
            subject=attempt.get('subject_display_verification')
            if subject:
                deployment_text+='\n\n과목 표시 독립 검산 '+str(subject['confirmed_point_count'])+'개 일치; 실제 등급·상위% 숫자는 공개하지 않는다. 영수증 SHA-256 '+subject['receipt_sha256']+'. 전체 누백·조합 계산/특정 BFF actor 결속을 증명하지 않는다.'
        if attempt['scoped_safe_logs']:
            deployment_text+='\n\n'+table(['시각','operation / stage','로그 HTTP / code','귀속 범위'],[[row['observed_at_UTC'],row['operation_id']+' / '+row['stage'],str(row['HTTP_status'])+' / '+('없음'if row['safe_error_code']is None else row['safe_error_code']),row['correlation_scope']+'; UI·actor·BFF 요청 결속 미증명']for row in attempt['scoped_safe_logs']])
        if attempt['scoped_readonly_observations']:
            deployment_text+='\n\n'+table(['조회 시각','profile / profile성공 / overall성공 / report','증거 범위','영수증 SHA-256'],[[row['observed_at_UTC'],' / '.join(str(row['counts'][k])for k in ('profiles','profile_success_requests','overall_success_requests','reports')),row['scope']+'; 전체 DB쓰기0·browser subject 결속 미증명',row['receipt_sha256']]for row in attempt['scoped_readonly_observations']])
        deployment_text+='\n\n'+attempt['preservation_rule']
    elif attempt:
        deployment_text+=('\n\n### 현재 P2 단일 제출의 실패 관측\n\n'+attempt['scope']+'\n\n'+
            table(['확인 범위','현재 관측'],[
                ['실행 / 재시도',str(attempt['submit_count'])+'회 / '+str(attempt['retry_count'])+'회'],
                ['실제 상태',attempt['status']],
                ['멱등키 문맥',attempt['idempotency_context_status']],
                ['제출 후 새로고침 / 정확 키 제한 DB조회','0회 / 0회'],
                ['HTTP / 안전 오류 코드 / profile·report 생성 / DB쓰기','미확정 / 미확정 / 미확정 / 미확정'],
                ['시험·pack 실제 제출 일치',attempt['exam_pack_match']],
                ['분석 / 재조회 결과',attempt['step_2_analyze']+' / '+attempt['step_3_reread']],
                ['분석 / 재조회 성공 인수',attempt.get('step_2_success_acceptance','NOT_RUN')+' / '+attempt.get('step_3_success_acceptance','NOT_RUN')],
                ['실패 영수증 SHA-256',attempt['receipt_sha256']]])+'\n\n'+attempt['preservation_rule'])
    rows=[]
    for o in spec['operations']:
        if o['id'] not in c['operations']:continue  # REQ-27 extension evidence is a separately validated matrix.
        state=c['operations'][o['id']]
        rows.append([o['id'],o['method']+' '+o['path'],state['code'],state['native'],state['deployment']])
    return ('\n\n## 실제 인증·22 API·배포 진행\n\n'+c['scope']+'\n\n'+c['reuse']['scope']+'\n\n'+
            table(['검수 단계','상태'],[[v['label'],v['status']]for v in c['stages'].values()])+'\n\n'+
            table(['operation','계약 경로','Edge 코드','실 연결 검수','배포 인수'],rows)+'\n\n'+
            c['owner_totp_rule']+'\n\n'+c['quota_rule']+'\n\n'+c['rule']+assembly_text+position_text+preparation_text+intake_text+post_text+current_text+deployment_text+frontend_bff_followup_document(spec))


def live_P2_attempt(c, evidence_id):
    """Resolve one immutable attempt without reinterpreting an older report."""
    if not isinstance(evidence_id,str):return {}
    current=c.get('current_P2_attempt');history=c.get('P2_attempt_history',{})
    found=[]
    if isinstance(current,dict)and current.get('evidence_id')==evidence_id:found.append(current)
    if isinstance(history,dict)and isinstance(history.get(evidence_id),dict):found.append(history[evidence_id])
    return found[0]if len(found)==1 else {}


def validate_P2_attempt_records(c, registry):
    """Preserve both failed attempts and bind later observations to their deployment."""
    error='DEV-010 P2 attempt history or source deployment binding drift'
    legacy_error='DEV-010 current P2 failed attempt requires receipt and preserves unconfirmed stages'
    history=c.get('P2_attempt_history');current=c.get('current_P2_attempt')
    if not isinstance(history,dict)or not isinstance(current,dict):return [error,legacy_error]
    rows=list(history.items())+[(current.get('evidence_id'),current)]
    ids=[key for key,row in rows]
    if (any(not isinstance(key,str)or not isinstance(row,dict)or row.get('evidence_id')!=key for key,row in rows)or
        len(set(ids))!=len(ids)):return [error,legacy_error]
    reply=c.get('frontend_P2_reply',{});reply=reply if isinstance(reply,dict)else {}
    earlier=reply.get('earlier_root_attempt',{});earlier=earlier if isinstance(earlier,dict)else {}
    root_id=earlier.get('evidence_id');external_id=reply.get('current_P2_attempt_evidence_id')
    if root_id not in ids or external_id not in ids:return [error,legacy_error]
    by_id=dict(rows);terminal=root_id+'-V1-HISTORICAL'
    pinned=by_id.get(ED978_P2_ID)
    if not isinstance(pinned,dict)or canonical_public_record_sha256(pinned)!=ED978_P2_SHA256:return [error,legacy_error]
    if any(not isinstance(by_id.get(key),dict)or canonical_public_record_sha256(by_id[key])!=digest for key,digest in LEGACY_P2_SHA256.items()):return [error,legacy_error]
    for start in ids:
        seen=set();cursor=start
        while isinstance(cursor,str)and cursor in by_id:
            if cursor in seen:return [error,legacy_error]
            seen.add(cursor);cursor=by_id[cursor].get('previous_receipt_evidence_id')
        if cursor!=terminal or cursor not in registry:return [error,legacy_error]
    errors=[]
    for key,row in rows:
        deployment=live_deployment(c,receipt_sha256=row.get('source_deployment_receipt_sha256'))
        source=deployment.get('source',{});source=source if isinstance(source,dict)else {}
        evidence=registry.get(key,{});evidence=evidence if isinstance(evidence,dict)else {}
        previous=row.get('previous_receipt_evidence_id')
        valid=(deployment and evidence.get('candidate_commit')==source.get('candidate_commit') and
            isinstance(row.get('receipt_sha256'),str)and re.fullmatch(r'[0-9a-f]{64}',row['receipt_sha256'])and
            evidence.get('receipt_sha256')==row['receipt_sha256']and evidence.get('operations')==[]and
            evidence.get('does_not_imply_operation_acceptance')is True and
            type(row.get('submit_count'))is int and row['submit_count']==1 and
            type(row.get('retry_count'))is int and row['retry_count']==0 and (row.get('reload_after_submit')is False or row.get('format')=='jungsi.p2-runtime-attempt/v2')and
            row.get('same_form_idempotency_key','missing')is None and
            type(row.get('business_native_accepted'))is int and row['business_native_accepted']==0 and
            type(row.get('business_deployment_accepted'))is int and row['business_deployment_accepted']==0 and
            row.get('production_ready')is False and isinstance(previous,str)and previous in registry and
            all(isinstance(row.get(k),str)and row[k].strip()for k in ('scope','preservation_rule')))
        if key in {root_id,external_id}:
            external=key==external_id
            valid=valid and (evidence.get('kind')=='bff_browser'and row.get('status')=='ACTUAL_UI_SAVE_ATTEMPT_FAILED_UNDETAILED'and
                all(k in row and row[k]is None for k in ('HTTP_status','safe_error_code','profile_created','report_created','DB_writes_independently_observed'))and
                row.get('exam_pack_match')=='NOT_INDEPENDENTLY_CONFIRMED'and row.get('memory_validation_is_actual_request_result')is False and
                row.get('idempotency_context_status')==('NOT_COLLECTED_BY_FRONTEND'if external else 'BROWSER_VALUE_REDACTED_NOT_CAPTURED')and
                row.get('step_2_analyze')=='SUCCESS_NOT_CONFIRMED'and row.get('step_3_reread')==('SUCCESS_NOT_CONFIRMED'if external else 'NOT_RUN')and
                type(row.get('exact_key_DB_readback_count'))is int and row['exact_key_DB_readback_count']==0)
            if external:
                valid=valid and (row.get('observation_basis')=='EXTERNAL_FRONTEND_REPORT'and previous==root_id and
                    all(row.get(k)=='NOT_RUN'for k in ('step_2_success_acceptance','step_3_success_acceptance')))
            else:
                valid=valid and (row.get('idempotency_capture_claim_corrected')is True and row.get('same_placeholder_comparison_is_not_key_evidence')is True)
        else:
            valid=valid and (row.get('format')in {'jungsi.p2-runtime-attempt/v1','jungsi.p2-runtime-attempt/v2'}and row.get('observation_basis')=='RUNTIME_FOLLOWUP'and
                row.get('status')=='ACTUAL_STEPS_OBSERVED'and row.get('source_deployment_evidence_id')==deployment.get('evidence_id')and
                evidence.get('kind')in {'bff_browser','native_api'}and
                evidence.get('source_deployment_receipt_sha256')==deployment.get('receipt_sha256')and
                row.get('idempotency_context_status')in {'NOT_COLLECTED','PRIVATE_REFERENCE_ONLY'}and
                row.get('DB_writes_independently_observed','missing')is None and
                all(row.get(k,'missing')is None for k in ('UI_HTTP_status','UI_safe_error_code','UI_request_id')))
            allowed={'format','status','observation_basis','evidence_id','receipt_sha256','source_deployment_evidence_id','source_deployment_receipt_sha256','submit_count','retry_count','reload_after_submit','same_form_idempotency_key','idempotency_context_status','DB_writes_independently_observed','UI_HTTP_status','UI_safe_error_code','UI_request_id','business_native_accepted','business_deployment_accepted','production_ready','scope','preservation_rule','previous_receipt_evidence_id','steps','scoped_safe_logs','scoped_readonly_observations','submitted_at_UTC','result_observed_at_UTC'}
            v2=row.get('format')=='jungsi.p2-runtime-attempt/v2'
            if v2:allowed|={'functional_observations','report_reload_count','analysis_result_scope','overall_percentile_computed','combination_percentiles_computed','subject_display_verification'}
            required=allowed-({'analysis_result_scope','overall_percentile_computed','combination_percentiles_computed','subject_display_verification'}if v2 else set())
            if not required<=set(row)or not set(row)<=allowed:valid=False
            if v2 and validate_P2_functional_observations(row,registry,source,deployment):valid=False
            steps=row.get('steps',{});expected={'profile_create':('score-profile.create',201),'overall_analyze':('overall.analyze',201),'report_read':('report.read',200)}
            if not isinstance(steps,dict)or set(steps)!=set(expected):valid=False
            else:
                for name,(operation,success_http)in expected.items():
                    step=steps[name]
                    if not isinstance(step,dict)or set(step)!={'operation_id','status','HTTP_status','safe_error_code','evidence_id'}or step.get('operation_id')!=operation:valid=False;continue
                    state=step.get('status');http=step.get('HTTP_status');code=step.get('safe_error_code')
                    if state in {'NOT_RUN','UNCONFIRMED'}:
                        if any(step.get(k,'missing')is not None for k in ('HTTP_status','safe_error_code','evidence_id')):valid=False
                    elif state in {'OBSERVED_SUCCESS','OBSERVED_FAILURE'}:
                        ref=step.get('evidence_id');proof=registry.get(ref,{})if isinstance(ref,str)else {}
                        if (not isinstance(proof,dict)or proof.get('candidate_commit')!=source.get('candidate_commit')or
                            proof.get('source_deployment_receipt_sha256')!=deployment.get('receipt_sha256')or
                            proof.get('attempt_evidence_id')!=key or proof.get('operation_id')!=operation or
                            proof.get('observation_scope')!='EXACT_ATTEMPT_OPERATION_RESPONSE'or proof.get('exact_request_binding_verified')is not True or
                            proof.get('kind')not in {'bff_browser','native_api'}or proof.get('operations')!=[]or proof.get('does_not_imply_operation_acceptance')is not True or
                            not isinstance(proof.get('receipt_sha256'),str)or not re.fullmatch(r'[0-9a-f]{64}',proof['receipt_sha256'])or
                            type(http)is not int or (state=='OBSERVED_SUCCESS'and(http!=success_http or code is not None))or
                            (state=='OBSERVED_FAILURE'and(not 400<=http<=599 or not isinstance(code,str)or not re.fullmatch(r'[a-z][a-z0-9_]{0,63}',code)))):valid=False
                    else:valid=False
            logs=row.get('scoped_safe_logs')
            if not isinstance(logs,list):valid=False
            else:
                for log in logs:
                    if not isinstance(log,dict):valid=False;continue
                    ref=log.get('evidence_id');proof=registry.get(ref,{})if isinstance(ref,str)else {}
                    if (set(log)!={'evidence_id','operation_id','stage','HTTP_status','safe_error_code','observed_at_UTC','correlation_scope','actor_binding_proven','BFF_request_id_binding_proven','UI_status_binding_proven'}or
                        not isinstance(proof,dict)or proof.get('candidate_commit')!=source.get('candidate_commit')or proof.get('source_deployment_receipt_sha256')!=deployment.get('receipt_sha256')or
                        proof.get('operations')!=[]or proof.get('does_not_imply_operation_acceptance')is not True or
                        not isinstance(proof.get('receipt_sha256'),str)or not re.fullmatch(r'[0-9a-f]{64}',proof['receipt_sha256'])or
                        log.get('operation_id')not in {v[0]for v in expected.values()}or not isinstance(log.get('stage'),str)or not re.fullmatch(r'[a-z][a-z0-9_]{0,63}',log['stage'])or
                        type(log.get('HTTP_status'))is not int or not 100<=log['HTTP_status']<=599 or not((v2 and log['HTTP_status']==201 and log.get('stage')=='complete'and log.get('safe_error_code')is None)or(not(v2 and log['HTTP_status']==201)and isinstance(log.get('safe_error_code'),str)and re.fullmatch(r'[a-z][a-z0-9_]{0,63}',log['safe_error_code'])))or
                        log.get('correlation_scope')!='TIME_AND_OPERATION_ONLY'or any(log.get(k)is not False for k in ('actor_binding_proven','BFF_request_id_binding_proven','UI_status_binding_proven'))):valid=False
            snapshots=row.get('scoped_readonly_observations')
            if not isinstance(snapshots,list):valid=False
            else:
                for snapshot in snapshots:
                    if not isinstance(snapshot,dict):valid=False;continue
                    ref=snapshot.get('evidence_id');proof=registry.get(ref,{})if isinstance(ref,str)else {}
                    counts=snapshot.get('counts')
                    if (set(snapshot)!={'evidence_id','receipt_sha256','receipt_bytes','observed_at_UTC','owner_exact_match_count','counts','scope','all_database_writes_zero_proven','browser_Bearer_subject_binding_proven'}or
                        not isinstance(proof,dict)or proof.get('kind')!='sql'or proof.get('candidate_commit')!=source.get('candidate_commit')or
                        proof.get('source_deployment_receipt_sha256')!=deployment.get('receipt_sha256')or proof.get('receipt_sha256')!=snapshot.get('receipt_sha256')or proof.get('operations')!=[]or proof.get('does_not_imply_operation_acceptance')is not True or
                        not isinstance(snapshot.get('receipt_sha256'),str)or not re.fullmatch(r'[0-9a-f]{64}',snapshot['receipt_sha256'])or
                        type(snapshot.get('receipt_bytes'))is not int or snapshot['receipt_bytes']<=0 or type(snapshot.get('owner_exact_match_count'))is not int or snapshot['owner_exact_match_count']!=1 or
                        not isinstance(counts,dict)or set(counts)!={'profiles','profile_success_requests','overall_success_requests','reports'}or any(type(v)is not int or v<0 for v in counts.values())or
                        snapshot.get('scope')!='OWNER_CASE_SNAPSHOT_ONLY'or snapshot.get('all_database_writes_zero_proven')is not False or snapshot.get('browser_Bearer_subject_binding_proven')is not False):valid=False
        if not valid:errors.append(error)
        if not valid and row is current:errors.append(legacy_error)
    return errors


def validate_P2_functional_observations(row,registry,source,deployment):
    """UI function observations never mint exact HTTP or whole-operation acceptance."""
    error='DEV-010 P2 functional observations require scoped attempt evidence and separate reload'
    observations=row.get('functional_observations')
    if (not isinstance(observations,dict)or set(observations)!={'save_analysis_ui','report_reload_ui'}or
        type(row.get('report_reload_count'))is not int or row['report_reload_count']not in (0,1)or
        type(row.get('reload_after_submit'))is not bool or row['reload_after_submit']!=(row['report_reload_count']==1)or
        source.get('candidate_commit')!=ADMIN_FIX_SOURCE_COMMIT):return [error]
    for name,observation in observations.items():
        if not isinstance(observation,dict)or set(observation)!={'status','evidence_id'}:return [error]
        state=observation.get('status');ref=observation.get('evidence_id')
        if state in {'NOT_RUN','UNCONFIRMED'}:
            if ref is not None:return [error]
        elif state in {'OBSERVED_SUCCESS','OBSERVED_FAILURE'}:
            proof=registry.get(ref,{})if isinstance(ref,str)else {};proof=proof if isinstance(proof,dict)else {}
            allowed_proof={'kind','candidate_commit','receipt_sha256','source_deployment_receipt_sha256','attempt_evidence_id','functional_id','observation_scope','operations','does_not_imply_operation_acceptance','exact_request_binding_verified','scope'}
            if (not set(proof)<=allowed_proof or proof.get('kind')!='bff_browser'or proof.get('candidate_commit')!=source.get('candidate_commit')or
                proof.get('attempt_evidence_id')!=row.get('evidence_id')or proof.get('functional_id')!=name or
                proof.get('source_deployment_receipt_sha256')!=deployment.get('receipt_sha256')or
                proof.get('observation_scope')!='SINGLE_OWNER_CASE_UI'or proof.get('operations')!=[]or proof.get('does_not_imply_operation_acceptance')is not True or
                not isinstance(proof.get('receipt_sha256'),str)or not re.fullmatch(r'[0-9a-f]{64}',proof['receipt_sha256'])or
                proof.get('exact_request_binding_verified')is not False):return [error]
        else:return [error]
    pending_keys={'analysis_result_scope','overall_percentile_computed','combination_percentiles_computed'}
    present=pending_keys&set(row)
    if present and(present!=pending_keys or row.get('analysis_result_scope')!='SAVED_PROFILE_AND_SUBJECT_RESULTS_WITH_OVERALL_DISTRIBUTION_PENDING'or row.get('overall_percentile_computed')is not False or row.get('combination_percentiles_computed')is not False):return [error]
    subject=row.get('subject_display_verification')
    if subject is not None:
        if not isinstance(subject,dict)or set(subject)!={'evidence_id','receipt_bytes','receipt_sha256','confirmed_point_count','actual_values_published','whole_or_combination_percentile_accepted','JWT_subject_or_BFF_authority_independently_proven'}:return [error]
        ref=subject.get('evidence_id');proof=registry.get(ref,{})if isinstance(ref,str)else {};proof=proof if isinstance(proof,dict)else {}
        if (type(subject.get('receipt_bytes'))is not int or subject['receipt_bytes']<=0 or not isinstance(subject.get('receipt_sha256'),str)or not re.fullmatch(r'[0-9a-f]{64}',subject['receipt_sha256'])or
            type(subject.get('confirmed_point_count'))is not int or subject['confirmed_point_count']!=4 or any(subject.get(k)is not False for k in ('actual_values_published','whole_or_combination_percentile_accepted','JWT_subject_or_BFF_authority_independently_proven'))or
            proof.get('kind')!='bff_browser'or proof.get('candidate_commit')!=source.get('candidate_commit')or proof.get('attempt_evidence_id')!=row.get('evidence_id')or
            proof.get('source_deployment_receipt_sha256')!=deployment.get('receipt_sha256')or proof.get('receipt_sha256')!=subject['receipt_sha256']or
            proof.get('observation_scope')!='APPROVED_FOUR_POINT_SUBJECT_DISPLAY_ONLY'or proof.get('operations')!=[]or proof.get('does_not_imply_operation_acceptance')is not True or proof.get('exact_request_binding_verified')is not False):return [error]
    reread=observations['report_reload_ui']
    if row['report_reload_count']==0 and reread.get('status')!='NOT_RUN':return [error]
    if row['report_reload_count']==1 and reread.get('status')not in {'OBSERVED_SUCCESS','OBSERVED_FAILURE'}:return [error]
    return []


def validate_frontend_p2_reply(c, registry):
    """Keep an external failed submission and undeployed diagnostics below acceptance."""
    reply=c.get('frontend_P2_reply');errors=[]
    if not isinstance(reply,dict):return ['DEV-010 frontend P2 reply requires scoped evidence and preserved history']
    evidence=registry.get(reply.get('evidence_id'),{})
    history=c.get('P2_attempt_history',{});earlier=reply.get('earlier_root_attempt',{})
    earlier=earlier if isinstance(earlier,dict)else {}
    previous=history.get(earlier.get('evidence_id'),{})if isinstance(history,dict)else {}
    historical_evidence=registry.get(earlier.get('evidence_id'),{})
    historical_evidence=historical_evidence if isinstance(historical_evidence,dict)else {}
    deployment=c.get('actual_editor_deployment',{})
    deployment=deployment if isinstance(deployment,dict)else {}
    attempt=live_P2_attempt(c,reply.get('current_P2_attempt_evidence_id'))
    if (reply.get('format')!='jungsi.external-frontend-p2-reply/v1' or
        reply.get('status')!='EXTERNAL_REPORTED_FAILED_SUBMISSION_UNRESOLVED' or
        type(reply.get('reply_bytes'))is not int or reply['reply_bytes']<=0 or
        not re.fullmatch(r'[0-9a-f]{64}',str(reply.get('reply_receipt_sha256',''))) or
        not isinstance(evidence,dict)or evidence.get('kind')!='bff_browser' or evidence.get('receipt_sha256')!=reply.get('reply_receipt_sha256') or
        evidence.get('operations')!=[] or evidence.get('does_not_imply_operation_acceptance')is not True or
        not isinstance(previous,dict)or previous.get('evidence_id')!=earlier.get('evidence_id') or
        previous.get('receipt_sha256')!=historical_evidence.get('receipt_sha256') or
        previous.get('same_form_idempotency_key','missing')is not None or
        previous.get('idempotency_capture_claim_corrected')is not True or previous.get('same_placeholder_comparison_is_not_key_evidence')is not True or
        not isinstance(attempt,dict)or attempt.get('evidence_id')!=reply.get('current_P2_attempt_evidence_id') or attempt.get('observation_basis')!='EXTERNAL_FRONTEND_REPORT' or
        attempt.get('previous_receipt_evidence_id')!=earlier.get('evidence_id') or
        deployment.get('historical_P2_attempt_evidence_id')!=earlier.get('evidence_id') or
        reply.get('independently_replayed')is not False or reply.get('detailed_synthetic_scores_published')is not False):
        errors.append('DEV-010 frontend P2 reply requires scoped evidence and preserved history')
    if (not isinstance(previous,dict)or previous.get('status')!='ACTUAL_UI_SAVE_ATTEMPT_FAILED_UNDETAILED' or
        any(k not in previous or previous[k]is not None for k in ('HTTP_status','safe_error_code','profile_created','report_created','DB_writes_independently_observed')) or
        any(type(previous.get(k))is not int or previous[k]!=v for k,v in [('submit_count',1),('retry_count',0),('exact_key_DB_readback_count',0),('business_native_accepted',0),('business_deployment_accepted',0)]) or
        previous.get('reload_after_submit')is not False or previous.get('production_ready')is not False or
        previous.get('memory_validation_is_actual_request_result')is not False or
        previous.get('exam_pack_match')!='NOT_INDEPENDENTLY_CONFIRMED' or
        previous.get('idempotency_context_status')!='BROWSER_VALUE_REDACTED_NOT_CAPTURED' or
        previous.get('step_2_analyze')!='SUCCESS_NOT_CONFIRMED' or previous.get('step_3_reread')!='NOT_RUN'):
        errors.append('DEV-010 historical P2 attempt must preserve unknown result and no-retry boundaries')
    worker=reply.get('reported_worker_deployment',{});separate=reply.get('separate_frontend_attempt',{})
    if (not isinstance(worker,dict)or worker.get('source_commit','missing')is not None or
        worker.get('source_pushed')is not False or worker.get('independent_source_binding_verified')is not False or
        not re.fullmatch(r'[0-9a-f]{40}',str(worker.get('last_pushed_source_commit',''))) or
        not re.fullmatch(r'[0-9a-f-]{36}',str(worker.get('worker_version',''))) or
        worker.get('public_exam_settings')!='EXTERNAL_REPORTED_APPLIED' or worker.get('request_time_getter_fix')!='EXTERNAL_REPORTED_DEPLOYED' or
        not isinstance(earlier,dict)or earlier.get('reported_failure_stage')!='score-profile.create' or
        earlier.get('HTTP_status','missing')is not None or earlier.get('DB_writes_independently_observed','missing')is not None or
        not isinstance(separate,dict)or separate.get('same_fixture_as_root_attempt')is not False or
        separate.get('HTTP_status','missing')is not None or separate.get('stage','missing')is not None or
        separate.get('safe_error_code','missing')is not None or separate.get('request_id','missing')is not None or
        separate.get('idempotency_key','missing')is not None or separate.get('DB_writes_independently_observed','missing')is not None or
        separate.get('partial_profile_possible')is not True or separate.get('overall_success')!='NOT_RUN' or separate.get('report_success')!='NOT_RUN' or
        any(type(separate.get(k))is not int or separate[k]!=v for k,v in [('submit_count',1),('retry_count',0),('reload_count',0)])):
        errors.append('DEV-010 external P2 report cannot certify source HTTP stage or zero writes')
    observation=reply.get('safe_observation_followup',{})
    if (not isinstance(observation,dict)or observation.get('status')!='PENDING_DEPLOYMENT_AND_SOURCE_SHA' or
        observation.get('source_commit','missing')is not None or observation.get('deployed')is not False or
        observation.get('server_only_fields')!=['stage','path','status','code','request_id'] or
        observation.get('user_visible_fields')!=['stage','safe_error_code'] or
        observation.get('forbidden_fields')!=['body','token','cookie','query','keys','stack'] or
        reply.get('operation_scope_expanded')is not False or reply.get('data_or_budget_approval_changed')is not False or
        reply.get('production_ready')is not False):
        errors.append('DEV-010 pending P2 diagnostics must keep safe observation and approval boundaries')
    if any(not isinstance(reply.get(k),str)or not reply[k].strip()for k in ('interpretation_rule','partial_success_rule','storage_response_boundary')):
        errors.append('DEV-010 frontend P2 interpretation boundary missing')
    admin=reply.get('admin_UI_observation')
    if admin is not None:
        admin_evidence=registry.get(admin.get('evidence_id'),{})if isinstance(admin,dict)else {}
        if (not isinstance(admin,dict)or not isinstance(admin_evidence,dict)or
            not re.fullmatch(r'[0-9a-f]{64}',str(admin.get('receipt_sha256',''))) or admin_evidence.get('receipt_sha256')!=admin.get('receipt_sha256') or
            admin_evidence.get('operations')!=[] or admin_evidence.get('does_not_imply_operation_acceptance')is not True or
            admin.get('independent_API_JWT_trace')is not False or admin.get('independent_aal2_trace')is not False or
            admin.get('earlier_standard_headline_contradicted')is not False):
            errors.append('DEV-010 administrator UI observation cannot certify API JWT or aal2')
    return errors


ADMIN_FIX_SOURCE_COMMIT='032a5647bc0b56e091eda279506aa534d559ea2f'
ADMIN_FIX_BUNDLE={'bytes':1454143,'sha256':'e69d1d7482c855587d1e7461ced32bb26dd46593e0ab08a78db6e7b0063d7528'}
ED978_DEPLOYMENT_ID='OPS-SAFE-OBSERVER-DEPLOYED-20261016'
ED978_DEPLOYMENT_SHA256='7e639c6698c6cb9444bf36a763b4abe28d415bae8d5cdc8dd637d0ae64bb106c'
ED978_P2_ID='OPS-P2-OBSERVER-ATTEMPT-20261016'
ED978_P2_SHA256='e11bfa4a3c81d7e90649923e09efe3794af990a6eccfd7fb9e05606c070934ab'
CB500_DEPLOYMENT_SHA256='c635d4dce970042d3bdf02a0527c1cd1494e71c13623d88062057df642b6da06'
LEGACY_P2_SHA256={'OPS-P2-ACTUAL-FAILURE-20261016':'850fd53b129be3f4177cdf53539fcb80af9ddfa5d651c1fd3c6e0e76c16865fe','OPS-P2-FRONTEND-FAILURE-20261016':'3d60663207104b1c5c3180a88990130e7d8557b529d585a0609ed09cb301e387'}
ADMIN_FIX_PREPARATION_SHA256='2e3d0a718c4e54de423103b1d90ad6784f4bdb34d4db6c535457060682ffe640'


def canonical_public_record_sha256(value):
    return hashlib.sha256(json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()


BFF_FOLLOWUP_SOURCE_COMMIT='44bd51231f84b1fa76a77fcc9aba00182e4e6882'
BFF_FOLLOWUP_PLANNING_BASIS='937b7dd8a073ed34c3fe0586c27b307d40b8cbde'
BFF_FOLLOWUP_API_DEPLOYMENT_SHA256='212e3ea927f2d8313e968b60796a9d67e71b2b945b295c4848a02f7586764269'
BFF_FOLLOWUP_API_P2_SHA256='ed628acf22cdcd5b3846ec10b76ba2c1630415c2605c91b827f0a7667d1b1343'


def frontend_bff_followup_shape():
    """공개 메타데이터만 허용하며 외부 보고·소스 검증·실패 대조의 범위를 분리한다."""
    def receipt(size,digest):return {'bytes':size,'sha256':digest}
    return {
        'format':'jungsi.current-bff-deployment/v1',
        'status':'OWNER_REPORTED_SOURCE_VERIFIED_CONDITIONAL',
        'basis_commit':BFF_FOLLOWUP_PLANNING_BASIS,
        'supersedes_missing_final_SHA_current_state':True,
        'owner_report':{
            'receipt':receipt(3988,'4446b76a29e862a47eded4bfc660314544ce5aadc07485f5b935a70b8c5209da'),
            'source_commit':BFF_FOLLOWUP_SOURCE_COMMIT,
            'worker_version':'49fcffd9-5aeb-4629-9bcc-d02148bf097b',
            'deployed_at_UTC':'2026-10-16T07:09:11Z',
            'deployment_source_mapping':'OWNER_REPORTED_ONLY',
            'reported_POST_count':0,'raw_settings_values_published':False,'scope':str},
        'git_source_verification':{
            'status':'INDEPENDENTLY_GIT_VERIFIED_SOURCE_ONLY_WITH_FOLLOWUPS',
            'source_commit':BFF_FOLLOWUP_SOURCE_COMMIT,
            'parent_commit':'59f01ad774917c57d0664b37698e9748104dc7c4',
            'tree':'ba309cb4dec640d06166052bf53acf413b090e3c',
            'frontend_source_spec_version':'1.9.62',
            'source_review_receipt':receipt(5320,'56b4f57a5d33f784112dc87a78851360a4c35d7d8f5c2400489dc6885197f3e1'),
            'CI':{'run_id':38866270866,'job_id':116859715461,'event':'push','head_commit':BFF_FOLLOWUP_SOURCE_COMMIT,'conclusion':'success','job_conclusion':'success','scope':'SOURCE_ONLY','local_hook_independently_verified':False},
            'changed_files':{'total':35,'runtime':4,'configuration':1,'documentation_catalog':30,'tests':0},
            'worker_bytes_independently_verified':False,
            'planning_sync_pending':True,
            'required_develop_sync':{'spec_version':'1.9.72','integration_status':'NOT_RUN','runtime_blob_and_patch_check_required':True,'normal_test_build_deploy_required':True},
            'lineage':{'verification':'INDEPENDENTLY_GIT_VERIFIED','receipt':receipt(989,'12c26c3b75410aa45063519c102a1544182c026cbd4a1475a75f39b23199bddd'),'planning_commit':BFF_FOLLOWUP_PLANNING_BASIS,'planning_spec_version':'1.9.71','merge_base':'542b84661d86dfa2778dadd52ee5c4a499a03e64','planning_is_frontend_ancestor':False,'frontend_is_planning_ancestor':False,'current_planning_synchronized_into_frontend':False},
            'scope':str},
        'search_failure_correlations':{
            'status':'EXACT_FAILED_RESPONSE_ID_MATCH_VERIFIED',
            'receipt':receipt(5102,'30b7370d0ba9652dfaf1e7e9ebdd39c6c0b0f589ec1b78fcce6c201dee7e7eb2'),
            'independent_review_receipt':receipt(1115,'b061f21512da61cdccd64ceaf1dc0717464e7090b3dc6c7cb935ddc4898d593e'),
            'acceptance_matrix_receipt':receipt(19009,'2c50ca6c2b5df72392ab6a44a5f8ed151423bf88d8d869fd39176a456fe37ad7'),
            'frontend_source_commit':BFF_FOLLOWUP_SOURCE_COMMIT,'API_source_commit':ADMIN_FIX_SOURCE_COMMIT,
            'compared_count':2,'matched_count':2,
            'rows':[
                {'page':'PAGE-01','operation':'history.search','method':'GET','stage':'budget_initialize','HTTP_status':503,'safe_code':'operation_scope_not_approved','event_at_UTC':'2026-10-16T07:09:38Z','exact_failed_response_id_match':True},
                {'page':'PAGE-03','operation':'offerings.search','method':'GET','stage':'budget_initialize','HTTP_status':503,'safe_code':'operation_scope_not_approved','event_at_UTC':'2026-10-16T07:09:44Z','exact_failed_response_id_match':True}],
            'raw_request_ids_published':False,'JWT_subject_binding_proven':False,'actor_binding_proven':False,'P2_operation_exact_proven':False,'native_acceptance_implied':False,'scope':str},
        'root_readonly_UI_observation':{
            'receipt':receipt(5102,'30b7370d0ba9652dfaf1e7e9ebdd39c6c0b0f589ec1b78fcce6c201dee7e7eb2'),
            'pages':['PAGE-01','PAGE-03'],'new_notice_observed':True,'administrator_headline_observed':True,
            'GET_count':2,'POST_count':0,'request_ids_captured':False,
            'same_requests_as_correlated_receipt_proven':False,'JWT_subject_binding_proven':False,'actor_binding_proven':False,'P2_operation_exact_proven':False,'scope':str},
        'followup_contract':{
            'status':'PREPARED_NOT_DEPLOYED','findings':['FE-LOG-01','FE-P2-01'],
            'published_candidate_commit':None,'verification':'NOT_RUN_FINAL_INTEGRATED_SOURCE','deployment':'NOT_RUN',
            'planned_runtime_guards':['NATIVE_FINITE_HTTP_STATUS','BOUNDED_PUBLIC_CODE_SYNTAX','REQUEST_ID_32_LOWER_HEX','CONSTANT_ROUTE_TEMPLATE_INCLUDING_GENERIC_ERROR','LOGGER_FAILURE_ISOLATION','SAVED_PROFILE_STATE_AND_THROWN_OVERALL_FAILURE','NO_AUTOMATIC_RETRY_OR_NEW_KEY'],
            'scope':str},
        'business_native_accepted':0,'business_deployment_accepted':0,'production_ready':False,
        'operation_scope_expanded':False,'purpose_or_budget_changed':False,'key_or_role_changed':False,
        'preservation_rule':str}


def public_metadata_matches_shape(value,shape):
    """모든 계층의 추가 키를 거절하고 bool을 정수와 구분한다."""
    if shape is str:return isinstance(value,str)and bool(value.strip())
    if isinstance(shape,dict):return isinstance(value,dict)and set(value)==set(shape)and all(public_metadata_matches_shape(value[key],expected)for key,expected in shape.items())
    if isinstance(shape,list):return isinstance(value,list)and len(value)==len(shape)and all(public_metadata_matches_shape(item,expected)for item,expected in zip(value,shape))
    return type(value)is type(shape)and value==shape


def validate_frontend_bff_followup(spec):
    """현재 화면의 제한된 근거를 API·과거 P2·인증 성공으로 승격하지 않는다."""
    if tuple(int(v)for v in spec['version'].split('.'))<(1,9,72):return []
    c=spec['supabase_deployment_contract']['live_execution']
    errors=[]
    if not public_metadata_matches_shape(c.get('current_BFF_deployment'),frontend_bff_followup_shape()):
        errors.append('DEV-010 current BFF metadata or limited correlation scope drift')
    if canonical_public_record_sha256(c.get('current_deployment'))!=BFF_FOLLOWUP_API_DEPLOYMENT_SHA256 or canonical_public_record_sha256(c.get('current_P2_attempt'))!=BFF_FOLLOWUP_API_P2_SHA256:
        errors.append('DEV-010 frontend followup must preserve installed API and P2 observations')
    return errors


def frontend_bff_followup_document(spec):
    """현재 화면 보고와 독립 대조 및 미배포 보완을 구분해 표시한다."""
    c=spec['supabase_deployment_contract']['live_execution'];current=c.get('current_BFF_deployment')
    if not current:return ''
    owner=current['owner_report'];git=current['git_source_verification'];correlation=current['search_failure_correlations'];ui=current['root_readonly_UI_observation'];followup=current['followup_contract']
    return ('\n\n### 현재 화면 BFF 배포 보고와 독립 소스 확인\n\n'+owner['scope']+'\n\n'+table(['확인 범위','상태'],[
        ['화면 소스 / 부모',git['source_commit']+' / '+git['parent_commit']],
        ['소유자 보고 Worker / UTC',owner['worker_version']+' / '+owner['deployed_at_UTC']],
        ['정확 소스 CI',str(git['CI']['run_id'])+' / '+git['CI']['conclusion']+'; Worker 바이트 결속은 미확인'],
        ['화면 소스의 기획 버전',git['frontend_source_spec_version']+'; 최신 develop '+git['required_develop_sync']['spec_version']+' 통합 대기'],
        ['독립 Git 계보',git['lineage']['verification']+'; 양방향 ancestor 없음'],
        ['소스 보완',followup['status']+' / 검증 '+followup['verification']+' / 배포 '+followup['deployment']],
        ['실제 API 소스',ADMIN_FIX_SOURCE_COMMIT+' / spec1.9.70 유지'],
        ['업무 native / 배포 인수','0/22 / 0/22; production_ready=false']])+'\n\n'+git['scope']+'\n\n### 검색 실패 응답 2건만의 정확 대조\n\n'+correlation['scope']+'\n\n'+table(['화면 / operation','단계 / HTTP / 안전코드','UTC'],[[row['page']+' / '+row['operation'],row['stage']+' / '+str(row['HTTP_status'])+' / '+row['safe_code'],row['event_at_UTC']]for row in correlation['rows']])+'\n\n'+ui['scope']+' GET '+str(ui['GET_count'])+' / POST '+str(ui['POST_count'])+' .\n\n'+followup['scope']+'\n\n'+current['preservation_rule'])


def live_deployment(c,evidence_id=None,receipt_sha256=None):
    """Resolve exactly one installation; never reinterpret a historical P2 by current source."""
    if (evidence_id is None and receipt_sha256 is None)or(evidence_id is not None and not isinstance(evidence_id,str))or(receipt_sha256 is not None and not isinstance(receipt_sha256,str)):return {}
    history=c.get('deployment_history',{})
    if not isinstance(history,dict):return {}
    rows=[c.get('actual_editor_deployment'),c.get('current_deployment'),*history.values()]
    found=[row for row in rows if isinstance(row,dict)and(evidence_id is None or row.get('evidence_id')==evidence_id)and(receipt_sha256 is None or row.get('receipt_sha256')==receipt_sha256)]
    return found[0]if len(found)==1 else {}


def validate_deployment_history(spec):
    """Pin the ed978 installation and failure before replacing the current pointers."""
    c=spec['supabase_deployment_contract']['live_execution'];history=c.get('deployment_history')
    required=tuple(int(v)for v in spec['version'].split('.'))>=(1,9,71)
    if history is None:return ['DEV-010 deployment history requires preserved ed978 installation and P2 failure']if required else []
    error='DEV-010 deployment history requires preserved ed978 installation and P2 failure'
    if not isinstance(history,dict)or set(history)!={ED978_DEPLOYMENT_ID}:return [error]
    legacy_install=c.get('actual_editor_deployment')
    if not isinstance(legacy_install,dict)or canonical_public_record_sha256(legacy_install)!=CB500_DEPLOYMENT_SHA256:return [error]
    for key,digest in LEGACY_P2_SHA256.items():
        row=live_P2_attempt(c,key)
        if not row or canonical_public_record_sha256(row)!=digest:return [error]
    preserved=history.get(ED978_DEPLOYMENT_ID)
    if not isinstance(preserved,dict)or canonical_public_record_sha256(preserved)!=ED978_DEPLOYMENT_SHA256:return [error]
    all_rows=[c.get('actual_editor_deployment'),c.get('current_deployment'),*history.values()]
    ids=[v.get('evidence_id')for v in all_rows if isinstance(v,dict)]
    shas=[v.get('receipt_sha256')for v in all_rows if isinstance(v,dict)]
    if len(ids)!=len(all_rows)or any(not isinstance(v,str)for v in ids+shas)or len(set(ids))!=len(ids)or len(set(shas))!=len(shas):return [error]
    old_attempt=live_P2_attempt(c,ED978_P2_ID)
    if not old_attempt or canonical_public_record_sha256(old_attempt)!=ED978_P2_SHA256:return [error]
    old_history=c.get('P2_attempt_history',{})
    if not isinstance(old_history,dict):return [error]
    local_history={key:value for key,value in old_history.items()if key!=ED978_P2_ID}
    local_c=dict(c,current_deployment=preserved,current_P2_attempt=old_attempt,P2_attempt_history=local_history)
    local_spec=dict(spec,supabase_deployment_contract=dict(spec['supabase_deployment_contract'],live_execution=local_c))
    if _validate_observer_deployment(local_spec):return [error]
    return []


def validate_admin_fix_deployment(spec):
    """Accept only an actual receipt for source032, keeping business acceptance at zero."""
    c=spec['supabase_deployment_contract']['live_execution'];d=c.get('current_deployment')
    error='DEV-010 current deployment requires exact receipt source and remote bundle without business promotion'
    if not isinstance(d,dict):return [error]
    source=d.get('source');source=source if isinstance(source,dict)else {}
    registry=c.get('evidence',{});registry=registry if isinstance(registry,dict)else {}
    ref=d.get('evidence_id');entry=registry.get(ref,{})if isinstance(ref,str)else {};entry=entry if isinstance(entry,dict)else {}
    previous=live_deployment(c,evidence_id=ED978_DEPLOYMENT_ID)
    fix=c.get('admin_session_identity_fix',{});fix=fix if isinstance(fix,dict)else {}
    plan=c.get('backend_safe_observation_plan',{});plan=plan if isinstance(plan,dict)else {}
    indexed={v['path']:v['source_sha256']for v in spec['workflow']['documentation_sync']['code_index']['edge_sources']['files']}
    bindings=source.get('runtime_source_bindings')
    plan_bindings=plan.get('source_bindings');fix_bindings=fix.get('source_bindings')
    if not isinstance(plan_bindings,dict)or not isinstance(fix_bindings,dict):return [error]
    expected_bindings={**plan_bindings,**fix_bindings}
    allowed_deployment={'format','status','evidence_id','receipt_bytes','receipt_sha256','source','previous_deployment_evidence_id','previous_bundle','remote_readback','observed_at_UTC','editor_reload_verified','verify_jwt_remained_true','same_existing_project_and_function','auth_or_secret_or_policy_changes','operation_scope_expanded','data_or_budget_approval_changed','business_native_accepted','business_deployment_accepted','production_ready','new_version_health','current_P2_attempt_evidence_id','scope','native_readiness','safe_observer_acceptance'}
    source_fields={'candidate_commit','accepted_develop_merge','tree','spec_version','source_files_count','source_manifest','deployment_package','bundle','runtime_source_bindings'}
    if (not set(d)<=allowed_deployment or set(source)!=source_fields or not isinstance(d.get('scope'),str)or not d['scope'].strip()or d.get('format')!='jungsi.current-source-deployment/v1'or d.get('status')!='SOURCE_DEPLOYED_REMOTE_EDITOR_VERIFIED'or
        source.get('candidate_commit')!=ADMIN_FIX_SOURCE_COMMIT or source.get('spec_version')!='1.9.70'or
        any(not isinstance(source.get(k),str)or not re.fullmatch(r'[0-9a-f]{40}',source[k])for k in ('accepted_develop_merge','tree'))or
        type(source.get('source_files_count'))is not int or source['source_files_count']!=64 or
        source.get('bundle')!=ADMIN_FIX_BUNDLE or type(source.get('bundle',{}).get('bytes'))is not int or
        type(d.get('receipt_bytes'))is not int or d['receipt_bytes']<=0 or not isinstance(d.get('receipt_sha256'),str)or not re.fullmatch(r'[0-9a-f]{64}',d['receipt_sha256'])or
        entry.get('kind')!='edge_deployment'or entry.get('candidate_commit')!=ADMIN_FIX_SOURCE_COMMIT or not isinstance(entry.get('source'),dict)or canonical_public_record_sha256(entry['source'])!=canonical_public_record_sha256(source)or entry.get('receipt_sha256')!=d['receipt_sha256']or
        entry.get('operations')!=[]or entry.get('does_not_imply_operation_acceptance')is not True or
        not previous or d.get('previous_deployment_evidence_id')!=ED978_DEPLOYMENT_ID or not isinstance(d.get('previous_bundle'),dict)or canonical_public_record_sha256(d['previous_bundle'])!=canonical_public_record_sha256(previous.get('source',{}).get('bundle'))or
        d.get('remote_readback')!=ADMIN_FIX_BUNDLE or type(d.get('remote_readback',{}).get('bytes'))is not int or
        any(d.get(k)is not True for k in ('editor_reload_verified','verify_jwt_remained_true','same_existing_project_and_function'))or
        any(d.get(k)is not False for k in ('auth_or_secret_or_policy_changes','operation_scope_expanded','data_or_budget_approval_changed','production_ready'))or
        any(type(d.get(k))is not int or d[k]!=0 for k in ('business_native_accepted','business_deployment_accepted'))or
        not isinstance(bindings,dict)or set(expected_bindings)!={*plan.get('source_bindings',{}),'supabase/functions/_shared/jungsi/application/usage_service.ts'}or bindings!=expected_bindings or
        any(not isinstance(h,str)or not re.fullmatch(r'[0-9a-f]{64}',h)or not policy_baseline_source_matches(spec,path,h,indexed) for path,h in bindings.items())or
        fix.get('implementation_candidate_commit')!=ADMIN_FIX_SOURCE_COMMIT or fix.get('deployment')!='SOURCE_DEPLOYED_REMOTE_EDITOR_VERIFIED'or fix.get('actual_deployment_evidence_id')!=ref or
        not isinstance(d.get('observed_at_UTC'),str)or not d['observed_at_UTC'].strip()):return [error]
    for key in ('source_manifest','deployment_package'):
        meta=source.get(key)
        expected_meta={'bytes','sha256','source_files_count'}if key=='source_manifest'else {'bytes','sha256'}
        if not isinstance(meta,dict)or set(meta)!=expected_meta or type(meta.get('bytes'))is not int or meta['bytes']<=0 or not isinstance(meta.get('sha256'),str)or not re.fullmatch(r'[0-9a-f]{64}',meta['sha256']):return [error]
    manifest=source['source_manifest']
    if type(manifest.get('source_files_count'))is not int or manifest['source_files_count']!=64:return [error]
    if ref not in c.get('stages',{}).get('edge_deployment',{}).get('evidence_ids',[]):return [error]
    health=d.get('new_version_health');probe=d.get('native_readiness')
    if health=='NOT_RUN':
        if probe is not None:return [error]
    elif health in {'NATIVE_READINESS_AND_BOUNDARY_PASS','OBSERVED_PARTIAL'}:
        probe_fields={'evidence_id','receipt_bytes','receipt_sha256','source_deployment_receipt_sha256','bundle_sha256','cases','cache_control','actual_user_Bearer_used','DB_student_or_budget_writes_by_probe','scope'}
        if not isinstance(probe,dict)or set(probe)!=probe_fields or not isinstance(probe.get('scope'),str)or not probe['scope'].strip():return [error]
        probe_ref=probe.get('evidence_id');proof=registry.get(probe_ref,{})if isinstance(probe_ref,str)else {};proof=proof if isinstance(proof,dict)else {}
        if (proof.get('kind')!='edge_deployment'or proof.get('candidate_commit')!=ADMIN_FIX_SOURCE_COMMIT or proof.get('receipt_sha256')!=probe.get('receipt_sha256')or
            proof.get('source_deployment_receipt_sha256')!=d['receipt_sha256']or proof.get('operations')!=[]or proof.get('does_not_imply_operation_acceptance')is not True or
            not isinstance(probe.get('receipt_sha256'),str)or not re.fullmatch(r'[0-9a-f]{64}',probe['receipt_sha256'])or
            type(probe.get('receipt_bytes'))is not int or probe['receipt_bytes']<=0 or probe.get('source_deployment_receipt_sha256')!=d['receipt_sha256']or probe.get('bundle_sha256')!=ADMIN_FIX_BUNDLE['sha256']or
            probe.get('actual_user_Bearer_used')is not False or probe.get('cache_control')!='no-store'or type(probe.get('DB_student_or_budget_writes_by_probe'))is not int or probe['DB_student_or_budget_writes_by_probe']!=0):return [error]
        expected={'alive':{'http':200,'code':None},'normal_relay_ready':{'http':200,'code':None},'wrong_relay':{'http':403,'code':'relay_authentication_failed'},'missing_relay':{'http':403,'code':'relay_authentication_failed'},'missing_user_Bearer':{'http':401,'code':'authentication_required'}}
        cases=probe.get('cases')
        if not isinstance(cases,dict)or not cases or not set(cases)<=set(expected):return [error]
        for case in cases.values():
            if not isinstance(case,dict)or set(case)!={'http','code'}or type(case.get('http'))is not int or not 100<=case['http']<=599 or(case.get('code')is not None and(not isinstance(case['code'],str)or not re.fullmatch(r'[a-z][a-z0-9_]{0,63}',case['code']))):return [error]
        if health=='NATIVE_READINESS_AND_BOUNDARY_PASS'and cases!=expected:return [error]
    else:return [error]
    observer=d.get('safe_observer_acceptance')
    if observer is not None:
        observer_fields={'evidence_id','receipt_bytes','receipt_sha256','source_deployment_receipt_sha256','bundle_sha256','visible_event_count','exact_fields','request_id_syntax','all_checked_event_keys_match','all_checked_request_ids_match','forbidden_fields_in_checked_events','whole_log_nonexposure_proven','specific_BFF_actor_binding_proven','business_success_proven','safe_summary','scope'}
        if not isinstance(observer,dict)or set(observer)!=observer_fields or not isinstance(observer.get('scope'),str)or not observer['scope'].strip():return [error]
        observer_ref=observer.get('evidence_id');proof=registry.get(observer_ref,{})if isinstance(observer_ref,str)else {};proof=proof if isinstance(proof,dict)else {}
        if (proof.get('kind')!='native_api'or proof.get('candidate_commit')!=ADMIN_FIX_SOURCE_COMMIT or proof.get('receipt_sha256')!=observer.get('receipt_sha256')or
            proof.get('source_deployment_receipt_sha256')!=d['receipt_sha256']or proof.get('operations')!=[]or proof.get('does_not_imply_operation_acceptance')is not True or
            not isinstance(observer.get('receipt_sha256'),str)or not re.fullmatch(r'[0-9a-f]{64}',observer['receipt_sha256'])or type(observer.get('receipt_bytes'))is not int or observer['receipt_bytes']<=0 or
            observer.get('source_deployment_receipt_sha256')!=d['receipt_sha256']or observer.get('bundle_sha256')!=ADMIN_FIX_BUNDLE['sha256']or
            observer.get('exact_fields')!=['operation','stage','status','code','request_id']or observer.get('request_id_syntax')!='32_HEX'or
            observer.get('all_checked_event_keys_match')is not True or observer.get('all_checked_request_ids_match')is not True or
            any(observer.get(k)is not False for k in ('forbidden_fields_in_checked_events','whole_log_nonexposure_proven','specific_BFF_actor_binding_proven','business_success_proven'))or
            type(observer.get('visible_event_count'))is not int or observer['visible_event_count']<=0):return [error]
        summaries=observer.get('safe_summary');total=0
        if not isinstance(summaries,list)or not summaries:return [error]
        for event in summaries:
            if (not isinstance(event,dict)or set(event)!={'operation','stage','status','code','count'}or type(event.get('count'))is not int or event['count']<=0 or
                type(event.get('status'))is not int or not 100<=event['status']<=599 or any(not isinstance(event.get(k),str)or not re.fullmatch(r'[a-z][a-z0-9_.-]{0,63}',event[k])for k in ('operation','stage'))or not((event['status']==201 and event.get('stage')=='complete'and event.get('code')is None)or(400<=event['status']<=599 and isinstance(event.get('code'),str)and re.fullmatch(r'[a-z][a-z0-9_]{0,63}',event['code'])))):return [error]
            total+=event['count']
        if total!=observer['visible_event_count']:return [error]
    active=c.get('current_P2_attempt');active=active if isinstance(active,dict)else {}
    pointer=d.get('current_P2_attempt_evidence_id')
    if active.get('source_deployment_receipt_sha256')==d['receipt_sha256']and pointer!=active.get('evidence_id'):return [error]
    if pointer is not None:
        row=live_P2_attempt(c,pointer)
        if not row or row.get('source_deployment_receipt_sha256')!=d['receipt_sha256']or active.get('evidence_id')!=pointer:return [error]
    return []


def validate_current_source_verification(spec):
    """Preserve source032 CI counts independently from later planning/native acceptance."""
    c=spec['supabase_deployment_contract']['live_execution'];proof=c.get('current_source_verification')
    error='DEV-010 deployed source CI evidence requires exact source-only metadata and native counts'
    fields={'format','candidate_commit','accepted_develop_merge','tree','spec_version','verified_source_test_counts','ci_runs','merge_CI_receipt','handoff_receipt','source_only','business_native_accepted','business_deployment_accepted','production_ready','rule'}
    if not isinstance(proof,dict)or set(proof)!=fields:return [error]
    d=c.get('current_deployment',{});source=d.get('source',{})if isinstance(d,dict)else {};source=source if isinstance(source,dict)else {}
    if (proof.get('format')!='jungsi.current-deployed-source-verification/v1'or proof.get('candidate_commit')!=ADMIN_FIX_SOURCE_COMMIT or
        any(proof.get(k)!=source.get(k)for k in ('candidate_commit','accepted_develop_merge','tree','spec_version'))or
        proof.get('accepted_develop_merge')!='0024d665c48d73d79a3e2b496d4fa1f75f2415e8'or proof.get('tree')!='442923a60630cbb935a12b090ddc400c3e843b43'or proof.get('spec_version')!='1.9.70'or
        proof.get('source_only')is not True or proof.get('production_ready')is not False or
        any(type(proof.get(k))is not int or proof[k]!=0 for k in ('business_native_accepted','business_deployment_accepted'))):return [error]
    counts=proof.get('verified_source_test_counts');expected={'python':1065,'deno':590,'oracle':993,'oracle_mismatches':0}
    if not isinstance(counts,dict)or set(counts)!=set(expected)or any(type(counts.get(k))is not int or counts[k]!=v for k,v in expected.items()):return [error]
    runs=proof.get('ci_runs');heads={38852634961:ADMIN_FIX_SOURCE_COMMIT,38852775063:ADMIN_FIX_SOURCE_COMMIT,38853300254:proof['accepted_develop_merge']}
    if not isinstance(runs,list)or len(runs)!=3:return [error]
    seen=set()
    for run in runs:
        if not isinstance(run,dict):return [error]
        run_id=run.get('databaseId')
        if (type(run_id)is not int or run_id not in heads or run_id in seen or run.get('headSha')!=heads[run_id]or run.get('conclusion')!='success'or
            run.get('url')!='https://github.com/natural0448/Jungsi_touch/actions/runs/'+str(run_id)or
            not isinstance(run.get('log_sha256'),str)or not re.fullmatch(r'[0-9a-f]{64}',run['log_sha256'])or
            canonical_public_record_sha256(run.get('verified_source_test_counts'))!=canonical_public_record_sha256(expected)):return [error]
        seen.add(run_id)
    for key in ('merge_CI_receipt','handoff_receipt'):
        meta=proof.get(key)
        if not isinstance(meta,dict)or set(meta)!={'bytes','sha256'}or type(meta.get('bytes'))is not int or meta['bytes']<=0 or not isinstance(meta.get('sha256'),str)or not re.fullmatch(r'[0-9a-f]{64}',meta['sha256']):return [error]
    if not isinstance(proof.get('rule'),str)or not proof['rule'].strip():return [error]
    return []


def validate_current_deployment(spec):
    c=spec['supabase_deployment_contract']['live_execution'];current=c.get('current_deployment')
    source=current.get('source',{})if isinstance(current,dict)else {}
    if isinstance(source,dict)and source.get('candidate_commit')==ADMIN_FIX_SOURCE_COMMIT:
        history_errors=validate_deployment_history(spec)
        return history_errors if history_errors else validate_admin_fix_deployment(spec)
    if tuple(int(v)for v in spec['version'].split('.'))>=(1,9,71):
        return ['DEV-010 current deployment requires exact receipt source and remote bundle without business promotion']
    return _validate_observer_deployment(spec)


def _validate_observer_deployment(spec):
    """Keep the current source installation separate from older installations and business acceptance."""
    c=spec['supabase_deployment_contract']['live_execution'];d=c.get('current_deployment')
    error='DEV-010 current deployment requires exact receipt source and remote bundle without business promotion'
    if not isinstance(d,dict):return [error]
    old=c.get('actual_editor_deployment',{});registry=c.get('evidence',{})
    old_source=old.get('source',{})if isinstance(old,dict)else {};old_source=old_source if isinstance(old_source,dict)else {}
    source=d.get('source',{});source=source if isinstance(source,dict)else {}
    bundle=source.get('bundle',{});bundle=bundle if isinstance(bundle,dict)else {}
    ref=d.get('evidence_id');entry=registry.get(ref,{})if isinstance(ref,str)and isinstance(registry,dict)else {}
    entry=entry if isinstance(entry,dict)else {}
    indexed={v['path']:v['source_sha256']for v in spec['workflow']['documentation_sync']['code_index']['edge_sources']['files']}
    plan=c.get('backend_safe_observation_plan',{});plan=plan if isinstance(plan,dict)else {}
    bindings=source.get('runtime_source_bindings')
    if (d.get('format')!='jungsi.current-source-deployment/v1' or d.get('status')!='SOURCE_DEPLOYED_REMOTE_EDITOR_VERIFIED' or
        any(not isinstance(source.get(k),str)or not re.fullmatch(r'[0-9a-f]{40}',source[k])for k in ('candidate_commit','accepted_develop_merge','tree'))or
        source.get('spec_version')!='1.9.68' or type(source.get('source_files_count'))is not int or source['source_files_count']<=0 or
        type(bundle.get('bytes'))is not int or bundle['bytes']<=0 or not isinstance(bundle.get('sha256'),str)or not re.fullmatch(r'[0-9a-f]{64}',bundle['sha256'])or
        type(d.get('receipt_bytes'))is not int or d['receipt_bytes']<=0 or not isinstance(d.get('receipt_sha256'),str)or not re.fullmatch(r'[0-9a-f]{64}',d['receipt_sha256'])or
        entry.get('kind')!='edge_deployment' or entry.get('candidate_commit')!=source.get('candidate_commit')or entry.get('source')!=source or
        entry.get('receipt_sha256')!=d.get('receipt_sha256')or entry.get('operations')!=[]or entry.get('does_not_imply_operation_acceptance')is not True or
        not isinstance(old,dict)or d.get('previous_deployment_evidence_id')!=old.get('evidence_id')or d.get('previous_bundle')!=old_source.get('bundle')or
        d.get('remote_readback')!=bundle or any(d.get(k)is not True for k in ('editor_reload_verified','verify_jwt_remained_true','same_existing_project_and_function'))or
        any(d.get(k)is not False for k in ('auth_or_secret_or_policy_changes','operation_scope_expanded','data_or_budget_approval_changed','production_ready'))or
        any(type(d.get(k))is not int or d[k]!=0 for k in ('business_native_accepted','business_deployment_accepted'))or
        not isinstance(bindings,dict)or bindings!=plan.get('source_bindings')or any(not isinstance(h,str)or not policy_baseline_source_matches(spec,p,h,indexed) for p,h in bindings.items())or
        plan.get('status')!='SOURCE_DEPLOYED_RUNTIME_ACCEPTANCE_PENDING'or plan.get('deployment_evidence_id')!=ref or plan.get('implementation_candidate_commit')!=source.get('candidate_commit')or
        not isinstance(d.get('observed_at_UTC'),str)or not d['observed_at_UTC'].strip()):return [error]
    for key in ('source_manifest','deployment_package'):
        meta=source.get(key,{})
        if (not isinstance(meta,dict)or type(meta.get('bytes'))is not int or meta['bytes']<=0 or
            not isinstance(meta.get('sha256'),str)or not re.fullmatch(r'[0-9a-f]{64}',meta['sha256'])):return [error]
    if source['source_manifest'].get('source_files_count')!=source['source_files_count']or type(source['source_manifest'].get('source_files_count'))is not int:return [error]
    if ref not in c.get('stages',{}).get('edge_deployment',{}).get('evidence_ids',[]):return [error]
    health=d.get('new_version_health')
    probe=d.get('native_readiness')
    if health=='NOT_RUN':
        if probe is not None:return [error]
    elif health in {'NATIVE_READINESS_AND_BOUNDARY_PASS','OBSERVED_PARTIAL'}:
        if not isinstance(probe,dict):return [error]
        probe_ref=probe.get('evidence_id');proof=registry.get(probe_ref,{})if isinstance(probe_ref,str)else {}
        if (not isinstance(proof,dict)or proof.get('kind')!='edge_deployment' or proof.get('candidate_commit')!=source['candidate_commit']or
            proof.get('receipt_sha256')!=probe.get('receipt_sha256')or proof.get('operations')!=[]or proof.get('does_not_imply_operation_acceptance')is not True or
            proof.get('source_deployment_receipt_sha256')!=d['receipt_sha256']or
            not isinstance(probe.get('receipt_sha256'),str)or not re.fullmatch(r'[0-9a-f]{64}',probe['receipt_sha256'])or
            probe.get('source_deployment_receipt_sha256')!=d['receipt_sha256']or probe.get('bundle_sha256')!=bundle['sha256']or
            probe.get('actual_user_Bearer_used')is not False or probe.get('cache_control')!='no-store'or
            type(probe.get('DB_student_or_budget_writes_by_probe'))is not int or probe['DB_student_or_budget_writes_by_probe']!=0):return [error]
        expected={'alive':{'http':200,'code':None},'normal_relay_ready':{'http':200,'code':None},'wrong_relay':{'http':403,'code':'relay_authentication_failed'},'missing_relay':{'http':403,'code':'relay_authentication_failed'},'missing_user_Bearer':{'http':401,'code':'authentication_required'}}
        cases=probe.get('cases')
        if not isinstance(cases,dict)or not cases or not set(cases)<=set(expected):return [error]
        for case in cases.values():
            if (not isinstance(case,dict)or set(case)!={'http','code'}or type(case.get('http'))is not int or not 100<=case['http']<=599 or
                (case.get('code')is not None and(not isinstance(case['code'],str)or not re.fullmatch(r'[a-z][a-z0-9_]{0,63}',case['code'])))):return [error]
        if health=='NATIVE_READINESS_AND_BOUNDARY_PASS'and cases!=expected:return [error]
    else:return [error]
    observer=d.get('safe_observer_acceptance')
    if observer is not None:
        if not isinstance(observer,dict):return [error]
        observer_ref=observer.get('evidence_id');proof=registry.get(observer_ref,{})if isinstance(observer_ref,str)else {}
        if (not isinstance(proof,dict)or proof.get('kind')!='native_api'or proof.get('candidate_commit')!=source['candidate_commit']or
            proof.get('source_deployment_receipt_sha256')!=d['receipt_sha256']or proof.get('receipt_sha256')!=observer.get('receipt_sha256')or
            proof.get('operations')!=[]or proof.get('does_not_imply_operation_acceptance')is not True or
            type(observer.get('receipt_bytes'))is not int or observer['receipt_bytes']<=0 or not isinstance(observer.get('receipt_sha256'),str)or not re.fullmatch(r'[0-9a-f]{64}',observer['receipt_sha256'])or
            observer.get('source_deployment_receipt_sha256')!=d['receipt_sha256']or observer.get('bundle_sha256')!=bundle['sha256']or
            observer.get('exact_fields')!=['operation','stage','status','code','request_id']or observer.get('request_id_syntax')!='32_HEX'or
            observer.get('all_checked_event_keys_match')is not True or observer.get('all_checked_request_ids_match')is not True or
            any(observer.get(k)is not False for k in ('forbidden_fields_in_checked_events','whole_log_nonexposure_proven','specific_BFF_actor_binding_proven','business_success_proven'))or
            type(observer.get('visible_event_count'))is not int or observer['visible_event_count']<=0):return [error]
        summaries=observer.get('safe_summary')
        if not isinstance(summaries,list)or not summaries:return [error]
        total=0
        for event in summaries:
            if (not isinstance(event,dict)or set(event)!={'operation','stage','status','code','count'}or
                type(event.get('count'))is not int or event['count']<=0 or type(event.get('status'))is not int or not 100<=event['status']<=599 or
                any(not isinstance(event.get(k),str)or not re.fullmatch(r'[a-z][a-z0-9_.-]{0,63}',event[k])for k in ('operation','stage','code'))):return [error]
            total+=event['count']
        if total!=observer['visible_event_count']:return [error]
        if plan.get('native_verification')!='SCOPED_EVENT_SHAPE_OBSERVED'or plan.get('native_observation_evidence_id')!=observer_ref:return [error]
    pointer=d.get('current_P2_attempt_evidence_id')
    active=c.get('current_P2_attempt',{});active=active if isinstance(active,dict)else {}
    if active.get('source_deployment_receipt_sha256')==d['receipt_sha256']and pointer!=active.get('evidence_id'):return [error]
    if pointer is not None:
        row=live_P2_attempt(c,pointer)
        if row.get('source_deployment_receipt_sha256')!=d['receipt_sha256']or c.get('current_P2_attempt',{}).get('evidence_id')!=pointer:return [error]
    return []


DEPLOYED_OBSERVER_1_9_69_SHA256='dd2c9334439a9f5757fa9d1febf42d58050a4b3154ac8271711feac8eb83a551'


def deployed_observer_contract_pinned(spec):
    """Keep the already-deployed observation contract byte-bound while new tests evolve."""
    live=spec['supabase_deployment_contract']['live_execution']
    fix=live.get('admin_session_identity_fix')
    backend=live.get('backend_safe_observation_plan')
    return (isinstance(fix,dict)and isinstance(backend,dict)and
        fix.get('deployed_observer_contract_sha256')==DEPLOYED_OBSERVER_1_9_69_SHA256 and
        hashlib.sha256(json.dumps(backend,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()==DEPLOYED_OBSERVER_1_9_69_SHA256)


def validate_admin_session_identity_fix(spec):
    """Bind the immutable-session fix to current source without promoting installed history."""
    live=spec['supabase_deployment_contract']['live_execution'];fix=live.get('admin_session_identity_fix')
    error='DEV-010 admin session identity fix requires immutable provenance current hashes and undeployed acceptance'
    if not isinstance(fix,dict):return [error]
    if fix.get('status')=='SOURCE_DEPLOYED_FUNCTIONAL_FOLLOWUP_PENDING':
        prepared=fix.get('historical_preparation')
        if not isinstance(prepared,dict)or canonical_public_record_sha256(prepared)!=ADMIN_FIX_PREPARATION_SHA256:return [error]
        expected=dict(prepared,status='SOURCE_DEPLOYED_FUNCTIONAL_FOLLOWUP_PENDING',implementation_candidate_commit=ADMIN_FIX_SOURCE_COMMIT,deployment='SOURCE_DEPLOYED_REMOTE_EDITOR_VERIFIED')
        actual={key:value for key,value in fix.items()if key not in {'historical_preparation','actual_deployment_evidence_id'}}
        deployed=live_deployment(live,evidence_id=fix.get('actual_deployment_evidence_id'))
        deployed_source=deployed.get('source',{});deployed_source=deployed_source if isinstance(deployed_source,dict)else {}
        if (canonical_public_record_sha256(actual)!=canonical_public_record_sha256(expected)or not deployed or deployed_source.get('candidate_commit')!=ADMIN_FIX_SOURCE_COMMIT or
            live.get('current_deployment')!=deployed):return [error]
        fix=prepared
    if (fix.get('format')!='jungsi.admin-session-identity-fix/v1' or
        fix.get('status')!='SOURCE_IMPLEMENTED_SYNTHETIC_FOCUSED_PASS_DEPLOYMENT_PENDING' or
        fix.get('branch')!='feature/application-pre-data-platform' or
        fix.get('basis_commit')!='7112f2c633c658f00494b44d6b430dd7e4aba5c1' or
        fix.get('basis_verification')!='LOCAL_VERIFIED_COMMIT_ORIGIN_CI_PENDING_AT_PREPARATION' or
        fix.get('implementation_candidate_commit','missing')is not None or
        fix.get('implementation')!='SOURCE_IMPLEMENTED' or fix.get('verification')!='SYNTHETIC_FOCUSED_PASS' or
        any(fix.get(k)!='NOT_RUN'for k in ('deployment','native_verification'))or
        fix.get('owner_layer')!='application' or fix.get('requirements')!=['REQ-24','REQ-25','REQ-26'] or
        fix.get('operation_scope')!='EXISTING_BUDGET_OPERATIONS_ONLY' or
        not deployed_observer_contract_pinned(spec) or
        any(fix.get(k)is not True for k in ('both_frozen_required','immutable_snapshot_identity_preserved','mutable_session_copy_defense_preserved','body_query_params_copy_preserved','forged_admin_refused','expiry_and_role_guards_preserved','normal_snapshot_hooks_exact_CI_required'))or
        any(fix.get(k)is not False for k in ('weakset_mutated','serialized_admin_origin_trusted','auth_or_expiry_relaxed','policy_or_scope_changed','actual_failed_request_fully_attributed','production_ready'))or
        any(type(fix.get(k))is not int or fix[k]!=0 for k in ('actual_HTTP_requests','direct_DB_queries','business_native_accepted','business_deployment_accepted'))):return [error]
    indexed={v['path']:v['source_sha256']for v in spec['workflow']['documentation_sync']['code_index']['edge_sources']['files']}
    indexed.update({p:v['declarations']['source_sha256']for p,v in spec['edge_harness']['files'].items()})
    for key,paths in (('source_bindings',{'supabase/functions/_shared/jungsi/application/usage_service.ts'}),('test_bindings',{'tests/edge/test_usage_service.ts','tests/edge/test_runtime_budget.ts'})):
        bindings=fix.get(key)
        if (not isinstance(bindings,dict)or set(bindings)!=paths or any(not isinstance(h,str)or not re.fullmatch(r'[0-9a-f]{64}',h)or not policy_baseline_source_matches(spec,p,h,indexed)for p,h in bindings.items())):return [error]
    proof=fix.get('synthetic_verification')
    if not isinstance(proof,dict):return [error]
    for key,expected in (('new_tests',6),('before_passed',27),('before_failed',4),('focused_passed',108),('focused_failed',0),('full_suite_expected',590)):
        if type(proof.get(key))is not int or proof[key]!=expected:return [error]
    if (proof['full_suite_expected']!=(spec['score_input_policy_contract']['verification']['baseline_edge_unit_count'] if spec.get('score_input_policy_contract') else spec['edge_harness']['unit_count'])or proof.get('scope')!='LOCAL_SYNTHETIC_SESSION_AND_BUDGET_ONLY'or
        proof.get('full_snapshot_gate_required')is not True or proof.get('deployment_or_real_user_evidence')is not False):return [error]
    for key in ('before_log_sha256','focused_log_sha256'):
        if not isinstance(proof.get(key),str)or not re.fullmatch(r'[0-9a-f]{64}',proof[key]):return [error]
    if not isinstance(fix.get('rule'),str)or not fix['rule'].strip():return [error]
    return []


def validate_backend_safe_observation_plan(spec):
    """Bind diagnostics to registered source while retaining undeployed acceptance."""
    backend=spec['supabase_deployment_contract']['live_execution'].get('backend_safe_observation_plan')
    error='DEV-010 backend safe observation requires source-bound scoped evidence without deployment acceptance'
    if not isinstance(backend,dict):return [error]
    if (backend.get('format')!='jungsi.request-safe-observation-plan/v1' or
        backend.get('branch')!='feature/application-pre-data-platform' or
        backend.get('operation_scope')!='existing_22_registered_operations' or
        any(backend.get(k)is not True for k in ('constant_stage_labels','normalized_template_path_only','safe_request_id_only','request_local_context','existing_error_DTO_preserved')) or
        any(backend.get(k)is not False for k in ('shared_mutable_diagnostic_context','security_or_budget_relaxed','operation_scope_expanded'))):return [error]
    forbidden=['subject','account','scores','body','token','keys','cookie','query','stack']
    allowed_native=('NOT_RUN','SCOPED_EVENT_SHAPE_OBSERVED')if backend.get('status')=='SOURCE_DEPLOYED_RUNTIME_ACCEPTANCE_PENDING'else ('NOT_RUN',)
    if (('native_verification'in backend and backend['native_verification']not in allowed_native)or
        ('production_ready'in backend and backend['production_ready']is not False)or
        any(k in backend and(type(backend[k])is not int or backend[k]!=0)for k in ('business_native_accepted','business_deployment_accepted'))):return [error]
    if backend.get('status')=='CONTRACT_PREPARED_IMPLEMENTATION_PENDING':
        return []if (backend.get('implementation_candidate_commit','missing')is None and all(backend.get(k)=='NOT_RUN'for k in ('implementation','verification','deployment')) and
            backend.get('server_only_fields')==['operation','stage','path','status','code','request_id'] and
            backend.get('forbidden_fields')==forbidden)else [error]
    paths={'supabase/functions/_shared/jungsi/infrastructure/'+n+'.ts'for n in ('api_http','runtime_budget','runtime_composition')}
    paths.add('supabase/functions/jungsi-api/index.ts')
    tests={'tests/edge/test_runtime_composition.ts','tests/edge/test_runtime_budget.ts'}
    indexed={v['path']:v['source_sha256']for v in spec['workflow']['documentation_sync']['code_index']['edge_sources']['files']}
    indexed.update({p:v['declarations']['source_sha256']for p,v in spec['edge_harness']['files'].items()})
    pinned_history=deployed_observer_contract_pinned(spec)
    fix_present=isinstance(spec['supabase_deployment_contract']['live_execution'].get('admin_session_identity_fix'),dict)
    if fix_present and backend.get('status')=='SOURCE_DEPLOYED_RUNTIME_ACCEPTANCE_PENDING'and not pinned_history:return [error]
    for key,expected in (('source_bindings',paths),('test_bindings',tests)):
        bindings=backend.get(key)
        if (not isinstance(bindings,dict)or set(bindings)!=expected or
            any(not isinstance(value,str)or not re.fullmatch(r'[0-9a-f]{64}',value)or (not(key=='test_bindings'and pinned_history)and not policy_baseline_source_matches(spec,path,value,indexed))for path,value in bindings.items())):return [error]
    proof=backend.get('synthetic_verification',{})
    deployed=backend.get('status')=='SOURCE_DEPLOYED_RUNTIME_ACCEPTANCE_PENDING'
    current=spec['supabase_deployment_contract']['live_execution'].get('current_deployment',{})
    current=current if isinstance(current,dict)else {}
    live=spec['supabase_deployment_contract']['live_execution']
    if pinned_history and live.get('deployment_history')is not None:
        current=live_deployment(live,evidence_id=backend.get('deployment_evidence_id'))
    current_source=current.get('source',{});current_source=current_source if isinstance(current_source,dict)else {}
    observer=current.get('safe_observer_acceptance',{});observer=observer if isinstance(observer,dict)else {}
    if (backend.get('status')not in {'SOURCE_IMPLEMENTED_SYNTHETIC_VERIFIED_DEPLOYMENT_PENDING','SOURCE_DEPLOYED_RUNTIME_ACCEPTANCE_PENDING'} or
        (deployed and(backend.get('implementation_candidate_commit')!=current_source.get('candidate_commit')or backend.get('deployment_evidence_id')!=current.get('evidence_id')or backend.get('deployment')!='SOURCE_DEPLOYED_REMOTE_EDITOR_VERIFIED'))or
        (not deployed and(backend.get('implementation_candidate_commit','missing')is not None or backend.get('deployment')!='NOT_RUN'))or
        backend.get('implementation')!='SOURCE_IMPLEMENTED' or backend.get('verification')!='SYNTHETIC_FOCUSED_PASS' or
        backend.get('server_only_fields')!=['operation','stage','status','code','request_id'] or
        backend.get('forbidden_fields')!=forbidden+['path','headers','owner','raw_exception'] or
        backend.get('event_policy')!='ERRORS_AND_CREATED_WRITES_ONLY' or
        any(backend.get(k)is not True for k in ('observer_failure_preserves_response','observer_failure_does_not_rerun_work','successful_GET_body_unread','created_response_body_unread','installed_source_history_preserved')) or
        backend.get('native_verification')not in allowed_native or
        (backend.get('native_verification')=='SCOPED_EVENT_SHAPE_OBSERVED'and(not observer or backend.get('native_observation_evidence_id')!=observer.get('evidence_id')))or
        backend.get('production_ready')is not False or
        any(type(backend.get(k))is not int or backend[k]!=0 for k in ('business_native_accepted','business_deployment_accepted')) or
        not isinstance(proof,dict)or proof.get('scope')!='LOCAL_SYNTHETIC_FOCUSED_ONLY' or
        type(proof.get('new_tests'))is not int or proof['new_tests']!=16 or
        type(proof.get('focused_passed'))is not int or proof['focused_passed']!=41 or
        type(proof.get('focused_failed'))is not int or proof['focused_failed']!=0 or
        type(proof.get('full_suite_expected'))is not int or proof.get('full_suite_expected')!=(584 if pinned_history else spec['edge_harness']['unit_count']) or
        not isinstance(proof.get('focused_log_sha256'),str)or not re.fullmatch(r'[0-9a-f]{64}',proof['focused_log_sha256']) or
        proof.get('full_snapshot_gate_required')is not True or
        proof.get('deployment_or_real_user_evidence')is not False):return [error]
    return []


def validate_live_execution(spec):
    """Reject route drift or operating PASS without scoped, hash-bound evidence."""
    c=spec.get('supabase_deployment_contract',{}).get('live_execution')
    if c is None:
        return ['DEV-010 live execution missing'] if tuple(int(v)for v in spec['version'].split('.')) >= (1,9,49) else []
    if not isinstance(c,dict):return ['DEV-010 live execution invalid']
    errors=[]
    if (c.get('format')!='jungsi.supabase-live-execution/v1' or c.get('branch')!='feature/application-pre-data-platform' or
        not re.fullmatch(r'[0-9a-f]{40}',str(c.get('basis_commit',''))) or c.get('status')not in {'IN_PROGRESS','VERIFIED'}):
        errors.append('DEV-010 live execution basis drift')
    states=c.get('operations',{});ids=LEGACY_API_IDS if spec.get('score_input_policy_contract') else {o['id']for o in spec['operations']}
    if not isinstance(states,dict) or set(states)!=ids:return errors+['DEV-010 live operation coverage drift']
    stages=c.get('stages',{});kinds={'auth_connection':'auth','jwt_negative_checks':'jwt','owner_totp_verification':'totp','api_22_port':'native_api','native_business_transactions':'sql','existing_plan_and_quotas':'billing','edge_deployment':'edge_deployment','bff_browser_acceptance':'bff_browser','security_gates':'security'}
    if not isinstance(stages,dict)or set(stages)!=set(kinds):return errors+['DEV-010 live stage coverage drift']
    registry=c.get('evidence',{})
    if not isinstance(registry,dict):return errors+['DEV-010 live evidence registry invalid']
    indexed={v['path']:v['source_sha256']for v in spec['workflow']['documentation_sync']['code_index']['edge_sources']['files']}
    indexed.update({p:v['declarations']['source_sha256']for p,v in spec['edge_harness']['files'].items()})
    post_scope=c.get('post_registration_acceptance')
    post_scope=post_scope if isinstance(post_scope,dict)else {}
    post_owner=post_scope.get('owner_registration')
    post_owner=post_owner if isinstance(post_owner,dict)else {}
    assembly=c.get('runtime_assembly')
    if assembly is None:
        if tuple(int(v)for v in spec['version'].split('.')) >= (1,9,57):
            errors.append('DEV-010 runtime assembly missing')
    elif not isinstance(assembly,dict):
        errors.append('DEV-010 runtime assembly invalid')
    else:
        operations=assembly.get('operation_ids')
        if (assembly.get('format')!='jungsi.edge-runtime-assembly/v1' or
            assembly.get('status')!='SOURCE_ASSEMBLED' or
            not isinstance(operations,list) or len(operations)!=len(ids) or set(operations)!=ids):
            errors.append('DEV-010 runtime assembly scope drift')
        bindings=assembly.get('bindings')
        expected={'native_entry':'supabase/functions/jungsi-api/index.ts',
            'composition':'supabase/functions/_shared/jungsi/infrastructure/runtime_composition.ts'}
        if not isinstance(bindings,dict) or set(bindings)!=set(expected):
            errors.append('DEV-010 runtime assembly bindings invalid')
        else:
            for key,path in expected.items():
                binding=bindings[key]
                if (not isinstance(binding,dict) or binding.get('path')!=path or
                    not isinstance(indexed.get(path),str) or not policy_baseline_source_matches(spec,path,binding.get('source_sha256'),indexed)):
                    errors.append('DEV-010 runtime assembly source binding drift: '+key)
        environment=assembly.get('environment')
        expected_environment={'SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','DATABASE_URL',
            'JUNGSI_DATABASE_CA','JUNGSI_RELAY_TOKEN','SUPABASE_SECRET_KEY',
            'JUNGSI_SUPABASE_STORAGE_BUCKET','JUNGSI_SUPABASE_STORAGE_PREFIX',
            'JUNGSI_API_BINDING_JSON','JUNGSI_API_BINDING_SHA256','JUNGSI_API_BINDING_MAX_BYTES'}
        if (not isinstance(environment,list) or len(environment)!=len(expected_environment) or
            any(not isinstance(v,dict) or set(v)!={'name','status','meaning'} for v in environment) or
            {v['name']for v in environment}!=expected_environment):
            errors.append('DEV-010 runtime environment contract drift')
        expected_aliases={'DATABASE_URL':'JUNGSI_DISPLAY_DATABASE_URL',
            'JUNGSI_DATABASE_CA':'JUNGSI_DISPLAY_DATABASE_CA',
            'SUPABASE_PUBLISHABLE_KEY':'JUNGSI_DISPLAY_PUBLISHABLE_KEY',
            'SUPABASE_SECRET_KEY':'JUNGSI_DISPLAY_STORAGE_SECRET'}
        if assembly.get('environment_aliases')!=expected_aliases:
            errors.append('DEV-010 runtime environment aliases drift')
        for key in ('status_text','environment_alias_rule','scope_rule','precision_rule','request_order_rule',
            'missing_settings_rule','control_source_rule','reuse_rule','verification_rule'):
            if not isinstance(assembly.get(key),str) or not assembly[key].strip():
                errors.append('DEV-010 runtime assembly rule missing: '+key)
        waiting=assembly.get('waiting')
        if (not isinstance(waiting,list) or not waiting or
            any(not isinstance(v,list) or len(v)!=2 or any(not isinstance(x,str) or not x.strip()for x in v)for v in waiting)):
            errors.append('DEV-010 runtime assembly waiting conditions missing')
    preparation=c.get('preconnection_preparation')
    if preparation is None:
        if tuple(int(v)for v in spec['version'].split('.')) >= (1,9,61):
            errors.append('DEV-010 preconnection preparation missing')
    elif not isinstance(preparation,dict):
        errors.append('DEV-010 preconnection preparation invalid')
    else:
        if (preparation.get('format')!='jungsi.preconnection-preparation/v1' or
            not re.fullmatch(r'[0-9a-f]{40}',str(preparation.get('basis_commit',''))) or
            preparation.get('status')not in {'IN_PROGRESS','PREPARED'} or
            preparation.get('source_registration_is_execution_approval')is not False or
            preparation.get('prepared_cases_are_execution_evidence')is not False):
            errors.append('DEV-010 preparation cannot promote approval or live acceptance')
        packages=preparation.get('packages')
        if (not isinstance(packages,list) or len(packages)!=4 or
            any(not isinstance(p,dict)for p in packages) or
            {p.get('id')for p in packages}!={'PRE-01','PRE-02','PRE-03','PRE-04'} or
            any(p.get('state')not in {'IN_PROGRESS','PREPARED'} or
                not isinstance(p.get('operation_ids'),list) or not p['operation_ids'] or
                len(p['operation_ids'])!=len(set(p['operation_ids'])) or not set(p['operation_ids'])<=ids
                for p in packages)):
            errors.append('DEV-010 preparation package coverage drift')
        elif set(next(p for p in packages if p['id']=='PRE-04')['operation_ids'])!=ids:
            errors.append('DEV-010 preparation acceptance package omits operations')
        cases=preparation.get('cases')
        if (not isinstance(cases,dict) or set(cases)!=ids or
            any(not isinstance(v,dict)or set(v)!={'prerequisites','expected'} or
                any(not isinstance(x,str)or not x.strip()for x in v.values())for v in cases.values())):
            errors.append('DEV-010 preparation acceptance cases drift')
        fields=preparation.get('evidence_fields')
        if (not isinstance(fields,list)or len(fields)!=len(set(fields))or
            not {'case_id','operation_id','candidate_commit','deployed_commit','BFF_commit',
                 'artifact_snapshot_sha256','policy_revision','expected','observed','result','receipt_sha256'}<=set(fields)):
            errors.append('DEV-010 preparation evidence binding missing')
        for key in ('reuse_rule','execution_rule'):
            if not isinstance(preparation.get(key),str)or not preparation[key].strip():
                errors.append('DEV-010 preparation rule missing: '+key)
    intake=c.get('bff_reply_intake')
    if intake is None:
        if tuple(int(v)for v in spec['version'].split('.')) >= (1,9,63):
            errors.append('DEV-010 BFF reply intake missing')
    elif not isinstance(intake,dict):
        errors.append('DEV-010 BFF reply intake invalid')
    else:
        if (intake.get('format')!='jungsi.bff-reply-intake/v1' or
            intake.get('status')!=('READINESS_VERIFIED_USER_BFF_PENDING'if post_scope else'SOURCE_REVIEWED_REGISTRATION_PENDING') or
            not re.fullmatch(r'[0-9a-f]{40}',str(intake.get('basis_commit',''))) or
            not re.fullmatch(r'[0-9a-f]{40}',str(intake.get('frontend_source_commit',''))) or
            not re.fullmatch(r'[0-9a-f]{64}',str(intake.get('reply_receipt_sha256',''))) or
            type(intake.get('reply_bytes'))is not int or intake['reply_bytes']<=0 or
            intake.get('source_review_is_operating_acceptance')is not False or
            intake.get('private_setting_values_or_download_links_in_public_contract')is not False or
            intake.get('production_ready')is not False or
            intake.get('worker_deployment_independently_observed')!='NOT_RUN'):
            errors.append('DEV-010 BFF reply cannot certify live acceptance')
        expected_transport={'normal_entry_path': '/jeongsi', 'api_base_setting': 'JUNGSI_API_URL', 'api_base_ends_with': '/functions/v1/jungsi-api', 'caller_appends': '/api/v1', 'ingress_removes_only': '/jungsi-api', 'user_header': 'Authorization', 'user_scheme': 'Bearer', 'same_verified_Bearer_required': True, 'relay_header': 'X-Jungsi-Relay-Token', 'relay_setting': 'JUNGSI_RELAY_TOKEN', 'relay_server_only': True, 'fetch_cache': 'no-store', 'write_header': 'Idempotency-Key', 'fallback_to_synthetic_allowed': False}
        actual_transport=intake.get('transport')
        if (actual_transport!=expected_transport or not isinstance(actual_transport,dict) or
            any(type(actual_transport[k])is not type(v)for k,v in expected_transport.items())):
            errors.append('DEV-010 BFF source transport contract drift')
        registration=intake.get('registration')
        if (not isinstance(registration,dict) or
            set(registration)!={'status','settings_registered','receipt_sha256','pending_names','owner','private_delivery_rule'} or
            (post_scope and(
                registration.get('status')!='OWNER_REPORTED_REGISTERED' or registration.get('settings_registered')is not True or
                registration.get('receipt_sha256')!=post_owner.get('receipt_sha256') or
                not re.fullmatch(r'[0-9a-f]{64}',str(registration.get('receipt_sha256',''))) or registration.get('pending_names')!=[])) or
            (not post_scope and(
                registration.get('status')!='PENDING_OWNER_RECEIPT' or registration.get('settings_registered')is not False or
                registration.get('receipt_sha256')is not None or
                registration.get('pending_names')!=['JUNGSI_SUPABASE_STORAGE_BUCKET', 'JUNGSI_SUPABASE_STORAGE_PREFIX', 'JUNGSI_API_BINDING_JSON', 'JUNGSI_API_BINDING_SHA256', 'JUNGSI_API_BINDING_MAX_BYTES']))):
            errors.append('DEV-010 BFF registration needs owner receipt')
        reported=intake.get('reported_state',{})
        if (not isinstance(reported,dict) or reported.get('mode')!='synthetic' or
            any(type(reported.get(k))is not int or reported[k]!=0 for k in ('new_API_calls','native_API_accepted','deployment_API_accepted')) or
            reported.get('live_browser')!='NOT_RUN'):
            errors.append('DEV-010 BFF synthetic reply is not native evidence')
        review=intake.get('source_review',{})
        service=review.get('service',{})if isinstance(review,dict)else {}
        if (not isinstance(service,dict) or set(service)!={'supabase/functions/_shared/jungsi/infrastructure/supabase_api_ingress.ts', 'supabase/functions/_shared/jungsi/infrastructure/auth_relay.ts'} or
            any(not policy_baseline_source_matches(spec,p,service[p],indexed)for p in service)):
            errors.append('DEV-010 BFF service source binding drift')
        gates=intake.get('acceptance_gates')
        expected_gates={'OWNER_REGISTRATION','EDGE_READY_AUTH','API22_SCOPED','BFF_LIVE_BROWSER','SECURITY_3_GATES'}
        if (not isinstance(gates,list) or len(gates)!=len(expected_gates) or
            any(not isinstance(g,dict)or set(g)!={'id','owner','status','expected'}for g in gates) or
            {g.get('id')for g in gates}!=expected_gates or
            any(g.get('status')!=({'OWNER_REGISTRATION':'OWNER_REPORTED_MATCHED','EDGE_READY_AUTH':'IN_PROGRESS'}.get(g.get('id'),'NOT_RUN')if post_scope else'NOT_RUN')or any(not isinstance(g.get(k),str)or not g[k].strip()for k in ('owner','expected'))for g in gates)):
            errors.append('DEV-010 BFF remaining acceptance gates drift')
    post=c.get('post_registration_acceptance')
    if post is None:
        if tuple(int(v)for v in spec['version'].split('.')) >= (1,9,64):
            errors.append('DEV-010 post-registration acceptance missing')
    elif not isinstance(post,dict):
        errors.append('DEV-010 post-registration acceptance invalid')
    else:
        owner=post.get('owner_registration',{});ready=post.get('readiness',{});boundary=post.get('boundary_checks',{})
        owner_entry=registry.get('OPS-OWNER-SETTINGS-REGISTERED-20261015',{})
        ready_entry=registry.get('OPS-POSTREG-READINESS-20261015',{})
        boundary_entry=registry.get('OPS-POSTREG-BOUNDARIES-20261015',{})
        if (post.get('format')!='jungsi.post-registration-acceptance/v1' or
            post.get('status')!='READINESS_PASS_PENDING_LIMITED_BFF_LIVE_USER_ACCEPTANCE' or
            not isinstance(owner,dict) or
            not re.fullmatch(r'[0-9a-f]{64}',str(owner.get('receipt_sha256',''))) or
            type(owner.get('matched_setting_count'))is not int or owner['matched_setting_count']!=5 or
            owner.get('verification')!='OWNER_REPORT_AND_APPROVED_LOCAL_DIGEST_MATCH' or
            owner.get('independent_Dashboard_reread')is not False or
            not isinstance(owner_entry,dict) or owner_entry.get('receipt_sha256')!=owner.get('receipt_sha256') or
            owner_entry.get('operations')!=[] or owner_entry.get('does_not_imply_operation_acceptance')is not True):
            errors.append('DEV-010 owner report evidence scope drift')
        if (not isinstance(ready,dict) or type(ready.get('http'))is not int or ready['http']!=200 or
            ready.get('status')!='ready' or ready.get('cache_control')!='no-store' or
            ready.get('public_fields')!=['status','server_timezone'] or
            not re.fullmatch(r'[0-9a-f]{64}',str(ready.get('receipt_sha256',''))) or
            ready.get('scope')!='ACTUAL_NATIVE_PREPARATION_NOT_USER_BUSINESS_ACCEPTANCE' or
            not isinstance(ready_entry,dict) or ready_entry.get('receipt_sha256')!=ready.get('receipt_sha256') or
            ready_entry.get('operations')!=[] or ready_entry.get('does_not_imply_operation_acceptance')is not True):
            errors.append('DEV-010 readiness requires scoped real response evidence')
        if (not isinstance(boundary,dict) or
            boundary.get('wrong_relay_http')!=403 or boundary.get('wrong_relay_code')!='relay_authentication_failed' or
            boundary.get('missing_user_Bearer_http')!=401 or boundary.get('missing_user_Bearer_code')!='authentication_required' or
            boundary.get('real_user_Bearer')is not False or boundary.get('cache_control')!='no-store' or
            not re.fullmatch(r'[0-9a-f]{64}',str(boundary.get('receipt_sha256',''))) or
            not isinstance(boundary_entry,dict) or boundary_entry.get('receipt_sha256')!=boundary.get('receipt_sha256') or
            boundary_entry.get('operations')!=[] or boundary_entry.get('does_not_imply_operation_acceptance')is not True):
            errors.append('DEV-010 post-registration denial evidence drift')
        if (any(post.get(k)!='NOT_RUN'for k in ('real_user_acceptance','Worker_relay_registration','BFF_live_browser')) or
            any(type(post.get(k))is not int or post[k]!=0 for k in ('business_native_accepted','business_deployment_accepted')) or
            any(post.get(k)is not False for k in ('performance_acceptance','production_ready','new_data_or_authority_approval'))):
            errors.append('DEV-010 readiness cannot promote user business or performance acceptance')
        expected_sequence=['WORKER_OWNER_REGISTER_VERIFIED_RELAY','FRONTEND_PREVIEW_GATE_LIVE_DEPLOY','OWNER_NORMAL_LOGIN_OTP_SAME_BFF_USER_CHECK','APPROVED_SUBJECT_ONLY_PAGE_CASES','SEPARATELY_APPROVED_CATALOG_CONVERSION_CURVES_CANDIDATES_AND_SECURITY']
        if (post.get('next_sequence')!=expected_sequence or post.get('preview_gate_preserved')is not True or
            post.get('selected_runtime_operations')!=['session.read','score-profile.create','overall.analyze','report.read','report.export']):
            errors.append('DEV-010 limited BFF sequence or approved scope drift')
        source=post.get('source_graph',{});relay=post.get('relay_match',{})
        if (not isinstance(source,dict)or source.get('fresh_remote_bundle_download')is not False or
            source.get('per_call_internal_trace_exported')is not False or
            source.get('verification')!='HTTP200_PLUS_PINNED_IMPLEMENTATION_PATH' or
            not isinstance(relay,dict)or relay.get('Dashboard_digest_reread')is not False or relay.get('raw_value_published')is not False):
            errors.append('DEV-010 source graph or relay evidence scope drift')
    current=c.get('post_live_receipt')
    if current is None:
        if tuple(int(v)for v in spec['version'].split('.')) >= (1,9,65):
            errors.append('DEV-010 current BFF live receipt missing')
    elif not isinstance(current,dict):
        errors.append('DEV-010 current BFF live receipt invalid')
    else:
        evidence=registry.get('OPS-BFF-LIVE-EXTERNAL-20261016',{})
        if (current.get('format')!='jungsi.external-bff-live-receipt/v1' or
            current.get('status')!='EXTERNAL_REPORTED_FUNCTIONAL_PASS_PARTIAL' or current.get('mode')!='live' or
            current.get('Worker_relay_registration')!='EXTERNAL_REPORTED_FUNCTIONAL_PASS' or
            current.get('real_Bearer_session')!='EXTERNAL_REPORTED_FUNCTIONAL_PASS' or
            not re.fullmatch(r'[0-9a-f]{40}',str(current.get('frontend_source_commit',''))) or
            type(current.get('reply_bytes'))is not int or current['reply_bytes']<=0 or
            not re.fullmatch(r'[0-9a-f]{64}',str(current.get('reply_receipt_sha256',''))) or
            not isinstance(evidence,dict) or evidence.get('receipt_sha256')!=current.get('reply_receipt_sha256') or
            evidence.get('operations')!=[] or evidence.get('does_not_imply_operation_acceptance')is not True):
            errors.append('DEV-010 current BFF functional report needs scoped external evidence')
        if (any(current.get(k)!='NOT_RUN'for k in ('P2_save_analysis_reread','ownership','CSRF','expiry_refresh')) or
            any(type(current.get(k))is not int or current[k]!=0 for k in ('business_native_accepted','business_deployment_accepted')) or
            any(current.get(k)is not False for k in ('independently_observed_browser','production_ready','search_scope_approved'))):
            errors.append('DEV-010 partial BFF report cannot promote unrun business or approval')
        if (current.get('selected_runtime_operations')!=['session.read','score-profile.create','overall.analyze','report.read','report.export'] or
            current.get('search_error')!={'http':503,'reported_code':'security_policy_unavailable','source_candidate_code':'operation_scope_not_approved'} or
            current.get('scope_error_contract')!={'valid_binding_excluded_operation':{'http':503,'code':'operation_scope_not_approved'},'invalid_binding_or_policy':{'http':503,'code':'security_policy_unavailable'},'success_or_quota_bypass':False}):
            errors.append('DEV-010 operation scope classification cannot expand approval or bypass policy')
        for key in ('interpretation_rule','session_observation','search_observation','P4_observation','scope_error_rule','next_rule'):
            if not isinstance(current.get(key),str) or not current[key].strip():
                errors.append('DEV-010 current BFF report boundary missing: '+key)
    deployment=c.get('actual_editor_deployment')
    if deployment is None:
        if tuple(int(v)for v in spec['version'].split('.')) >= (1,9,66) or (isinstance(current,dict)and current.get('source_fix_deployed')is not False):
            errors.append('DEV-010 actual editor deployment requires receipt-bound evidence')
    elif not isinstance(deployment,dict):
        errors.append('DEV-010 actual editor deployment requires receipt-bound evidence')
    else:
        source=deployment.get('source',{});bundle=source.get('bundle',{})if isinstance(source,dict)else {}
        source_binding=source if isinstance(source,dict)else {}
        bundle_binding=bundle if isinstance(bundle,dict)else {}
        evidence_id=deployment.get('evidence_id')
        entry=registry.get(evidence_id,{})if isinstance(evidence_id,str)else {}
        edge_stage=stages.get('edge_deployment')
        edge_stage=edge_stage if isinstance(edge_stage,dict)else {}
        editor=deployment.get('editor_receipt',{});readback=deployment.get('remote_readback',{})
        if (deployment.get('format')!='jungsi.actual-editor-deployment-acceptance/v1' or
            deployment.get('status')!='SOURCE_DEPLOYED_REMOTE_EDITOR_VERIFIED' or
            not isinstance(source,dict) or
            any(not re.fullmatch(r'[0-9a-f]{40}',str(source.get(k,'')))for k in ('candidate_commit','accepted_develop_merge','tree')) or
            source.get('spec_version')!='1.9.65' or type(source.get('source_files_count'))is not int or source['source_files_count']!=64 or
            not isinstance(bundle,dict) or type(bundle.get('bytes'))is not int or bundle.get('bytes',0)<=0 or
            not re.fullmatch(r'[0-9a-f]{64}',str(bundle.get('sha256',''))) or
            not re.fullmatch(r'[0-9a-f]{64}',str(deployment.get('receipt_sha256',''))) or
            not isinstance(entry,dict) or entry.get('kind')!='edge_deployment' or
            entry.get('candidate_commit')!=source.get('candidate_commit') or entry.get('source')!=source or
            entry.get('receipt_sha256')!=deployment.get('receipt_sha256') or
            entry.get('operations')!=[] or entry.get('does_not_imply_operation_acceptance')is not True or
            not isinstance(editor,dict) or type(editor.get('bytes'))is not int or editor.get('bytes',0)<=0 or
            not re.fullmatch(r'[0-9a-f]{64}',str(editor.get('sha256',''))) or entry.get('editor_receipt')!=editor or
            not isinstance(readback,dict) or readback!=bundle or
            any(deployment.get(k)is not True for k in ('editor_copyback_match','remote_reload_match','verify_jwt_remained_true','same_existing_project_and_function')) or
            type(deployment.get('deployment_count_observed'))is not int or deployment.get('deployment_count_observed',0)<=0 or
            any(not isinstance(deployment.get(k),str)or not deployment[k].strip()for k in ('observed_at_UTC','scope','preservation_rule'))):
            errors.append('DEV-010 actual editor deployment requires receipt-bound evidence')
        bindings=source.get('runtime_source_bindings',{})if isinstance(source,dict)else {}
        if (not isinstance(bindings,dict) or set(bindings)!={'supabase/functions/_shared/jungsi/infrastructure/auth_relay.ts','supabase/functions/_shared/jungsi/infrastructure/runtime_context.ts'} or
            any(not isinstance(v,str)or not policy_baseline_source_matches(spec,p,v,indexed) for p,v in bindings.items())):
            errors.append('DEV-010 actual editor deployment source binding drift')
        if (not isinstance(current,dict) or current.get('source_fix_deployed')is not True or
            current.get('source_fix_deployment_evidence_id')!=deployment.get('evidence_id') or
            current.get('historical_source_fix_deployed_before_editor_update')is not False):
            errors.append('DEV-010 deployed source status lacks its actual editor evidence')
        health_status=deployment.get('new_version_health');bff_status=deployment.get('same_BFF_actual_JWT')
        for field,kind,status_key,accepted_status in [('native_readiness','edge_deployment','new_version_health','NATIVE_READINESS_AND_BOUNDARY_PASS'),('same_BFF_error_observation','bff_browser','same_BFF_actual_JWT','SAFE_ERROR_CODE_VISIBLE_PARTIAL')]:
            observation=deployment.get(field)
            if deployment.get(status_key)==accepted_status:
                evidence=registry.get(observation.get('evidence_id'),{})if isinstance(observation,dict)and isinstance(observation.get('evidence_id'),str)else {}
                evidence=evidence if isinstance(evidence,dict)else {}
                if (not isinstance(observation,dict) or evidence.get('kind')!=kind or evidence.get('candidate_commit')!=source_binding.get('candidate_commit') or
                    not re.fullmatch(r'[0-9a-f]{64}',str(observation.get('receipt_sha256',''))) or evidence.get('receipt_sha256')!=observation.get('receipt_sha256') or
                    evidence.get('operations')!=[] or evidence.get('does_not_imply_operation_acceptance')is not True or
                    observation.get('source_deployment_receipt_sha256')!=deployment.get('receipt_sha256') or evidence.get('source_deployment_receipt_sha256')!=deployment.get('receipt_sha256') or
                    observation.get('bundle_sha256')!=bundle_binding.get('sha256') or
                    not isinstance(observation.get('scope'),str)or not observation['scope'].strip()):
                    errors.append('DEV-010 deployed follow-up requires scoped receipt-bound evidence: '+field)
            elif observation is not None:
                errors.append('DEV-010 deployed follow-up status lacks its scoped receipt: '+field)
        readiness=deployment.get('native_readiness')
        if health_status=='NATIVE_READINESS_AND_BOUNDARY_PASS' and isinstance(readiness,dict):
            expected={'alive':{'http':200,'code':None},'normal_relay_ready':{'http':200,'code':None},'wrong_relay':{'http':403,'code':'relay_authentication_failed'},'missing_relay':{'http':403,'code':'relay_authentication_failed'},'missing_user_Bearer':{'http':401,'code':'authentication_required'}}
            if (readiness.get('cases')!=expected or readiness.get('cache_control')!='no-store' or
                readiness.get('actual_user_Bearer_used')is not False or type(readiness.get('DB_student_or_budget_writes_by_probe'))is not int or readiness['DB_student_or_budget_writes_by_probe']!=0):
                errors.append('DEV-010 readiness preparation cannot imply real-user or student-write acceptance')
        bff=deployment.get('same_BFF_error_observation')
        if bff_status=='SAFE_ERROR_CODE_VISIBLE_PARTIAL' and isinstance(bff,dict):
            if (bff.get('observed_error_code')!='operation_scope_not_approved' or bff.get('normal_existing_browser_session')is not True or
                bff.get('HTTP_status_independently_captured')is not False or bff.get('independent_aal2_admin_verification')is not False or bff.get('observed_headline')!='일반 회원'):
                errors.append('DEV-010 BFF safe error observation cannot certify HTTP status or administrator aal2')
        attempt=live_P2_attempt(c,deployment.get('current_P2_attempt_evidence_id'))
        if (not attempt or attempt.get('source_deployment_receipt_sha256')!=deployment.get('receipt_sha256')):
            errors.append('DEV-010 current P2 failed attempt requires receipt and preserves unconfirmed stages')
        if (health_status not in {'NOT_RUN_PENDING_SEPARATE_NATIVE_RECEIPT','NATIVE_READINESS_AND_BOUNDARY_PASS'} or bff_status not in {'NOT_RUN','SAFE_ERROR_CODE_VISIBLE_PARTIAL'} or
            any(deployment.get(k)!='NOT_RUN'for k in ('P2_save_analysis_reread','ownership','CSRF','expiry_refresh','security_3_gates')) or
            any(type(deployment.get(k))is not int or deployment[k]!=0 for k in ('business_native_accepted','business_deployment_accepted')) or
            any(deployment.get(k)is not False for k in ('production_ready','operation_scope_expanded','data_or_budget_approval_changed','secrets_or_other_function_changes')) or
            any(row.get(k)!='NOT_RUN'for row in states.values()if isinstance(row,dict)for k in ('native','deployment')) or
            edge_stage.get('status')!='IN_PROGRESS' or not isinstance(edge_stage.get('evidence_ids'),list)or evidence_id not in edge_stage['evidence_ids']):
            errors.append('DEV-010 editor source update cannot certify unrun business or security acceptance')
    if tuple(int(v)for v in spec['version'].split('.')) >= (1,9,67) or c.get('frontend_P2_reply')is not None:
        errors.extend(validate_frontend_p2_reply(c,registry))
        errors.extend(validate_backend_safe_observation_plan(spec))
        errors.extend(validate_P2_attempt_records(c,registry))
    if tuple(int(v)for v in spec['version'].split('.')) >= (1,9,69) or c.get('current_deployment')is not None:
        errors.extend(validate_current_deployment(spec))
    if tuple(int(v)for v in spec['version'].split('.')) >= (1,9,71) or c.get('deployment_history')is not None:
        errors.extend(validate_deployment_history(spec))
    if tuple(int(v)for v in spec['version'].split('.')) >= (1,9,71):
        errors.extend(validate_current_source_verification(spec))
    errors.extend(validate_frontend_bff_followup(spec))
    if tuple(int(v)for v in spec['version'].split('.')) >= (1,9,70) or c.get('admin_session_identity_fix')is not None:
        errors.extend(validate_admin_session_identity_fix(spec))
    for key,row in registry.items():
        if (not isinstance(row,dict) or row.get('kind')not in set(kinds.values()) or
            not re.fullmatch(r'[0-9a-f]{40}',str(row.get('candidate_commit',''))) or
            not re.fullmatch(r'[0-9a-f]{64}',str(row.get('receipt_sha256',''))) or
            not isinstance(row.get('operations'),list) or not set(row['operations'])<=ids):
            errors.append('DEV-010 live evidence invalid: '+str(key))
    for operation,row in states.items():
        if not isinstance(row,dict):errors.append('DEV-010 live operation state invalid: '+operation);continue
        if row.get('code')not in {'NOT_PORTED','FOUNDATION_ONLY','PORTED'} or any(row.get(k)not in {'NOT_RUN','PASS'}for k in ('native','deployment')):
            errors.append('DEV-010 live operation state invalid: '+operation);continue
        binding=row.get('binding');evidence_ids=row.get('evidence_ids',[])
        if row['code']=='PORTED' and (not isinstance(binding,dict)or not isinstance(binding.get('path'),str)or not policy_baseline_source_matches(spec,binding.get('path'),binding.get('source_sha256'),indexed)or binding.get('path')not in indexed):
            errors.append('DEV-010 live implementation binding invalid: '+operation)
        if not isinstance(evidence_ids,list)or any(not isinstance(e,str)or e not in registry for e in evidence_ids):
            errors.append('DEV-010 live evidence reference invalid: '+operation);continue
        for status,kind in [('native','native_api'),('deployment','edge_deployment')]:
            if row[status]=='PASS' and (row['code']!='PORTED' or (status=='deployment'and row['native']!='PASS') or
                not any(isinstance(registry[e],dict)and registry[e].get('kind')==kind and isinstance(registry[e].get('operations'),list)and operation in registry[e]['operations']for e in evidence_ids)):
                errors.append('DEV-010 live operating evidence missing: '+operation+'.'+status)
    for key,row in stages.items():
        if (not isinstance(row,dict)or row.get('evidence_kind')!=kinds[key]or row.get('status')not in {'NOT_RUN','IN_PROGRESS','PENDING_OWNER','VERIFIED'}):
            errors.append('DEV-010 live stage invalid: '+key);continue
        refs=row.get('evidence_ids',[])
        if not isinstance(refs,list)or any(not isinstance(e,str)or e not in registry for e in refs):errors.append('DEV-010 live stage evidence invalid: '+key);continue
        if row['status']=='VERIFIED'and not any(isinstance(registry[e],dict)and registry[e].get('kind')==kinds[key]for e in refs):
            errors.append('DEV-010 live stage evidence missing: '+key)
    for stage,field in [('api_22_port','native'),('edge_deployment','deployment')]:
        if stages[stage].get('status')=='VERIFIED'and any(not isinstance(v,dict)or v.get('code')!='PORTED'or v.get(field)!='PASS'for v in states.values()):
            errors.append('DEV-010 live stage has unfinished operations: '+stage)
    if c.get('status')=='VERIFIED'and (any(not isinstance(v,dict)or v.get('status')!='VERIFIED'for v in stages.values())or any(not isinstance(v,dict)or v.get('code')!='PORTED'or v.get('native')!='PASS'or v.get('deployment')!='PASS'for v in states.values())):
        errors.append('DEV-010 live completion has unfinished acceptance')
    return errors


def supabase_deployment_document(spec):
    c=spec['supabase_deployment_contract']; p=c['platform_policy']; a=c['architecture']; s=c['security']; f=c['frontend']; v=c['verification']
    limits=c['platform_limits']
    runtime_text='현재 플랫폼 상한은 메모리256MiB, 요청 active CPU2초, Free worker wall clock150초다. 플랫폼 상한은 내부 운영 한도를 뜻하지 않는다.'
    if 'paid_worker_wall_clock_seconds' in limits and 'request_idle_timeout_seconds' in limits:
        runtime_text=(f"현재 플랫폼 상한은 메모리{limits['memory_MiB']}MiB, 요청 active CPU{limits['active_CPU_seconds_per_request']}초, Free worker wall clock{limits['free_worker_wall_clock_seconds']}초, 유료 worker wall clock{limits['paid_worker_wall_clock_seconds']}초, 요청 idle timeout{limits['request_idle_timeout_seconds']}초다. "+limits['runtime_lifetime_rule'])
    comparison=f.get('comparison_review')
    comparison_text=('\n\n## 화면 제공 방식 비교 회신의 검토\n\n'+comparison['decision']+'\n\n'+
        table(['항목','확인·정정 기준'],comparison['facts'])+'\n\n실제 호환성/브라우저/비용 '+comparison['actual_compatibility_browser_and_billing']+'. 비교 수신은 배포·화면교체 승인이 아니다.\n\n'+
        '\n'.join('- ['+x['title']+']('+x['url']+')' for x in comparison['official_sources'])) if comparison else ''
    return (c['scope']+'\n\n계약 '+c['revision']+' · 코드 '+c['code_status']+' · 전체 운영 인수 미완료 · production_ready=false. 현재 부분 배포·검수는 live_execution 원장을 따른다. 출발 develop '+c['basis_commit']+'.\n\n'+
            '## 현재 소스·실제 연결·배포 상태\n\n'+table(['담당/범위','단일 정본','현재 상태','해석과 다음 조건'],live_execution_progress_rows(spec))+'\n\n'+
            '## 플랫폼과 비용 범위\n\n'+p['rule']+'\n\n허용 플랫폼: '+', '.join(p['allowed'])+' · 기존 요금제/Spend Cap 검수 '+p['usage_and_spend_cap_verification']+'. 추가 비용 없이 사용할 수 있는 범위를 먼저 확인한다.\n\n'+
            '## 3티어와 기존 Python 구현\n\n'+table(['계층/기준','구성'],[['프레젠테이션',a['presentation']],['애플리케이션',a['application']],['데이터',a['data']],['기존 검산',a['python_reference']]])+'\n\n'+a['rule']+'\n\n서버 UTC · 원자료/화면 Asia/Seoul. '+limits['cost_rule']+' '+runtime_text+'\n\n'+
            '## 수치와 응답의 호환 검산\n\n'+c['numerical_compatibility']['rule']+'\n\n'+
            '## 서버 계약과 자료 발행\n\n'+s['rule']+'\n\n정확 헤더 '+chr(96)+s['relay_header']+chr(96)+' · 서버 전용 '+chr(96)+s['relay_environment_name']+chr(96)+' · 실제 사용자 Authorization Bearer. relay만으로 사용자 권한이 생기지 않는다. '+s['health_live_path']+'는 최소 공개 생존 확인, '+s['health_ready_path']+'는 relay 보호 검수다.\n\n'+
            c['native_publication']['rule']+'\n\nEdge에서 사용할 private Storage 명부/환경 이름은 서버 담당의 구현 계약과 후보 증거로 확정한다. Python의 로컬 파일 경로·factory 실행 명령을 Edge 배포 명령으로 사용하지 않는다.\n\n'+
            '## 담당별 후속 단계\n\n'+table(['단계','담당','상태','산출물'],[[x['id'],x['owner'],x['status'],x['deliverable']] for x in c['phases']])+'\n\n'+
            '## 화면 담당에게 전달할 작업\n\n화면 제공 범위 '+f['hosting_status']+' · Drive Apps Script 후보 '+f['candidate_permission']+'. 기존 외부 preview와 파일은 이력으로 보존한다. 새 플랫폼으로 채택하지 않는다.\n\n'+'\n'.join('- '+x for x in f['handoff'])+'\n\n'+
            comparison_text+'\n\n## 초기 준비 검증 이력\n\n당시 Edge 구현 '+v['status']+' · 당시 실제 Auth/DB/Storage/Edge/BFF/브라우저/배포 '+v['actual_Auth_DB_Storage_Edge_BFF_browser_deployment']+' · 당시 실제 비용/요금제 '+v['actual_billing_and_quota_verification']+'. 현재 부분 배포·검수는 live_execution 원장을 따른다. 기존 Python 합성 인수는 Edge 포팅/실운영 인수를 대신하지 않는다.\n\n'+
            live_execution_document(spec)+'\n\n## 공식 기술 근거\n\n'+'\n'.join('- ['+x['title']+']('+x['url']+')' for x in c['official_sources'])+'\n\n[DEV-010 작업 항목](../work_items/DEV-010-supabase-platform-deployment.json) · [기존 실행 자료 계약](Supabase_실행자료_연결.md)')


def validate_supabase_deployment_contract(spec):
    c=spec.get('supabase_deployment_contract')
    try: required=tuple(int(x) for x in spec.get('version','0.0.0').split('.')) >= (1,9,8)
    except (ValueError,TypeError): required=False
    if c is None:return ['DEV-010 required platform contract missing'] if required else []
    if not isinstance(c,dict):return ['DEV-010 platform contract invalid']
    errors=[]; p=c.get('platform_policy',{}); a=c.get('architecture',{}); s=c.get('security',{}); n=c.get('native_publication',{}); v=c.get('verification',{}); preserve=c.get('preservation',{})
    if (c.get('format')!='jungsi.supabase-deployment/v1' or c.get('id')!='DEV-010' or c.get('branch')!='feature/application-pre-data-platform' or spec.get('current_documents',{}).get('supabase_deployment')!='docs/current/Supabase_배포_화면_후속작업.md'):
        errors.append('DEV-010 owner or document registration drift')
    if (p.get('allowed')!=['google_drive','supabase'] or p.get('existing_plan_only')is not True or any(p.get(k)is not False for k in ('external_hosting_allowed','additional_billable_service_allowed','plan_upgrade_allowed','paid_add_on_allowed','automatic_overage_opt_in_allowed'))):
        errors.append('DEV-010 platform or additional-cost constraint drift')
    d=spec.get('runtime_connection_preparation_contract',{}).get('deployment',{})
    if (a.get('runtime')!='supabase_edge_typescript_deno' or a.get('python_hosted_unchanged')is not False or a.get('engine_in_browser_allowed')is not False or a.get('API_count')!=len(spec.get('operations',[])) or a.get('API_DTO_session_changes')is not bool(spec.get('score_input_policy_contract')) or a.get('server_timezone')!='UTC' or a.get('source_display_timezone')!='Asia/Seoul' or d.get('architecture')!='supabase_edge_functions' or d.get('hosting_contract_ref')!='supabase_deployment_contract' or d.get('python_reference_only')is not True):
        errors.append('DEV-010 Edge and Python reference boundary drift')
    if (s.get('contract_ref')!='security_contract' or s.get('revision')!=spec.get('security_contract',{}).get('revision') or s.get('relay_header')!='X-Jungsi-Relay-Token' or s.get('relay_environment_name')!='JUNGSI_RELAY_TOKEN' or any(s.get(k)is not True for k in ('relay_server_only','user_Bearer_required','user_authorization_in_application_required','shared_atomic_quota_required','health_ready_relay_required')) or any(s.get(k)is not False for k in ('direct_browser_analysis_allowed','secrets_in_browser_allowed')) or s.get('health_live_path')!='/health/live' or s.get('health_ready_path')!='/health/ready' or s.get('current_entitlement_authority')!='public.jeongsi_passes'):
        errors.append('DEV-010 relay or application authorization drift')
    if (n.get('registry_format')!='jungsi.data-registry/v1' or n.get('selection_format')!='jungsi.runtime-selection/v1' or n.get('required_dependencies_only')is not True or n.get('source_snapshots_preserved')is not True or any(n.get(k)is not False for k in ('source_state_only_promotion_allowed','historical_source_count_trigger_allowed','actual_data_in_Git'))):
        errors.append('DEV-010 native publication or historical trigger drift')
    if (c.get('production_ready')is not False or preserve.get('legacy_factory_change_allowed')is not True or preserve.get('opening_change_ref')!='opening_security_operations_contract' or any(preserve.get(k)is not False for k in ('source_flag_only_promotion_allowed','production_ready_promotion_allowed')) or v.get('actual_Auth_DB_Storage_Edge_BFF_browser_deployment')!='NOT_RUN' or v.get('actual_billing_and_quota_verification')!='NOT_RUN' or p.get('usage_and_spend_cap_verification')!='NOT_RUN'):
        errors.append('DEV-010 preparation cannot certify operating or billing acceptance')
    precision=c.get('numerical_compatibility',{})
    if (any(precision.get(k)is not True for k in ('exact_rational_and_decimal_preserved','explicit_rule_rounding_preserved','canonical_integer_JSON_keys_preserved','independent_python_edge_comparison_required')) or precision.get('Number_or_Math_round_equivalence_assumed')is not False or precision.get('heavy_model_generation_in_request_allowed')is not False):
        errors.append('DEV-010 precision or heavy-compute compatibility drift')
    if c.get('code_status')not in {'planned','implemented_scoped_synthetic_verified_integration_pending','accepted_on_develop_scoped_synthetic_verified'}:
        errors.append('DEV-010 scoped code state drift')
    if c.get('code_status')!='planned':
        ci=v.get('CI')
        if (not re.fullmatch(r'[0-9a-f]{40}',str(v.get('implementation_commit',''))) or type(v.get('synthetic_test_count'))is not int or v.get('synthetic_test_count',0)<=0 or v.get('status')!='PASS_SCOPED_SYNTHETIC' or not isinstance(ci,dict) or ci.get('headSha')!=v.get('implementation_commit') or ci.get('conclusion')!='success'):
            errors.append('DEV-010 implementation completion lacks fixed scoped evidence')
    return errors


def validate_secured_preparation(spec):
    c=spec.get("secured_backend_preparation_contract")
    try:required=tuple(int(x) for x in spec.get("version","0.0.0").split(".")) >= (1,9,0)
    except (TypeError,ValueError):required=False
    if c is None:return ["DEV-008 required secure preparation contract missing"] if required else []
    if not isinstance(c,dict):return ["DEV-008 secure preparation contract invalid"]
    errors=[]; p=c.get("composition",{}); r=c.get("relay",{}); h=c.get("health",{}); x=c.get("response_projection",{})
    if (c.get("format")!="jungsi.secured-backend-preparation/v1" or c.get("id")!="DEV-008" or
        c.get("policy_revision")!=spec.get("security_contract",{}).get("revision") or
        c.get("branch")!="feature/application-pre-data-platform" or c.get("requirements")!=["REQ-24","REQ-25","REQ-26"]):
        errors.append("DEV-008 policy/owner binding drift")
    if (p.get("factory")!="create_secured_app" or p.get("required_keyword")!="security" or
        p.get("legacy_factories")!=["create_app","configured_app"] or p.get("default_factories_unchanged") is not False or p.get("default_entitlement_authority")!="public.jeongsi_passes" or p.get("opening_change_ref")!="opening_security_operations_contract" or
        p.get("automatic_storage_or_entitlement_transition") is not False or p.get("local_verification_unchanged") is not True or
        p.get("existing_API_count")!=22 or p.get("API_or_DTO_additions") is not False or p.get("session_format")!="jungsi.session/v1"):
        errors.append("DEV-008 default composition preservation drift")
    if (r.get("header")!="X-Jungsi-Relay-Token" or r.get("environment_name")!="JUNGSI_RELAY_TOKEN" or
        r.get("server_only") is not True or r.get("secret_repr_allowed") is not False or r.get("browser_secret_allowed") is not False or
        r.get("duplicate_raw_headers_rejected") is not True or r.get("user_authentication_required_after_relay") is not True or
        r.get("relay_alone_grants_user_access") is not False or
        r.get("order")!=["relay_identity","verified_user_Bearer","current_entitlement_and_owner_scope","input_and_data_access"] or
        r.get("configuration_error")!={"http":503,"code":"security_policy_unavailable"} or
        r.get("authentication_error")!={"http":403,"code":"relay_authentication_failed"}):
        errors.append("DEV-008 relay identity/privacy drift")
    ids=[o["id"] for o in spec["operations"]]
    if sorted(c.get("protected_operations",[]))!=sorted(ids):errors.append("DEV-008 operation coverage drift")
    if (h.get("public_path")!="/health/live" or h.get("relay_protected_path")!="/health/ready" or
        h.get("ready_requires_user_Bearer") is not False or h.get("ready_production_ready") is not False or
        h.get("ready_public_fields")!=["status","server_timezone","production_ready","security_boundary"] or
        h.get("detailed_environment_DB_role_private_location_exposed") is not False):
        errors.append("DEV-008 safe health boundary drift")
    if (x.get("ownership")!="application" or x.get("role_roots")!=["standard","paid"] or
        any(x.get(k)is not True for k in ("operation_binding_required","all_registered_operations_required","nested_objects_and_arrays","dynamic_ID_map_values_typed")) or
        x.get("free_form_Any_allowed") is not False or x.get("untyped_additional_properties_allowed") is not False or
        set(x.get("covers",[]))!={"success","pending","error","persisted_report","idempotent_replay","print_dto","published_forecast"}):
        errors.append("DEV-008 recursive response boundary drift")
    registry=x.get("static_schema_registry")
    try:registry_required=tuple(int(y) for y in spec.get("version","0.0.0").split(".")) >= (1,9,1)
    except (TypeError,ValueError):registry_required=False
    if registry_required or registry is not None:
        if not isinstance(registry,dict) or registry.get("path")!="src/jungsi_touch/application/public_response_schemas.json" or registry.get("format")!="jungsi.public-response-schemas/v1" or registry.get("auxiliary_roots")!=["error","readiness"]:
            errors.append("DEV-008 static schema registry source drift")
    preserve=c.get("preservation",{})
    if (c.get("production_ready") is not False or any(preserve.get(k)is not False for k in
        ("default_factory_change_allowed","data_promotion_allowed","actual_DB_write_deployment_allowed","main_ready_allowed"))):
        errors.append("DEV-008 scoped preparation cannot promote production")
    states={"planned","implemented_synthetic_verified_integration_pending","accepted_on_develop_scoped_synthetic_verified"}
    v=c.get("verification",{})
    if c.get("code_status") not in states or v.get("actual_Auth_DB_BFF_browser_deployment")!="NOT_RUN":
        errors.append("DEV-008 scoped verification state drift")
    if c.get("code_status")!="planned" and (not re.fullmatch(r"[0-9a-f]{40}",str(v.get("implementation_commit",""))) or
        type(v.get("synthetic_test_count"))is not int or v.get("synthetic_test_count",0)<=0 or
        v.get("status")!="PASS_SCOPED_SYNTHETIC_HTTP"):
        errors.append("DEV-008 implementation completion lacks fixed synthetic evidence")
    return errors


def validate_security_contract(spec):
    """Required planning invariants, not a claim that runtime security is enforced."""
    errors=[]
    c=spec.get("security_contract")
    if not isinstance(c,dict):
        return ["Required external security contract absent"]
    if c.get("format")!="jungsi.external-access-security/v1" or c.get("required") is not True:
        errors.append("Required external security contract drift")
    if c.get("document")!=SECURITY_DOCUMENT or spec.get("current_documents",{}).get("external_security")!=SECURITY_DOCUMENT:
        errors.append("Mandatory security document registration drift")
    if not isinstance(c.get("revision"),str) or not c["revision"].strip():
        errors.append("Security revision absent")
    if not SECURITY_REQUIREMENTS<=set(c.get("requirements",[])) or not SECURITY_REQUIREMENTS<={
        r["id"] for r in spec.get("requirements",[])}:
        errors.append("Mandatory security requirements absent")
    invariants=c.get("invariants",{})
    if not isinstance(invariants,dict) or any(invariants.get(k) is not True for k in SECURITY_INVARIANTS):
        errors.append("Security invariant missing or weakened")
    h=spec.get("workflow",{}).get("development_harness",{})
    required={"AGENTS.md",SPEC_PATH,SECURITY_DOCUMENT}|{
        spec.get("current_documents",{}).get(k,"") for k in
        ("planning","routing","architecture","workflow","api_dto","presentation_handoff")}
    if (not isinstance(h,dict) or h.get("format")!="jungsi.development-harness/v1" or
        h.get("security_required") is not True or h.get("invariants_required") is not True or
        h.get("security_document")!=SECURITY_DOCUMENT or
        not required<=set(h.get("required_documents",[])) or
        any(not isinstance(h.get(k),str) or not h[k].strip() for k in ("start_rule","report_rule"))):
        errors.append("Mandatory security harness registration drift")
    if (spec.get("routing_policy",{}).get("security_contract_ref")!="security_contract" or
        any(spec.get(k,{}).get("security_contract_ref")!="security_contract" for k in
            ("backend_platform_contract","presentation_connection_contract","supabase_operations_handoff_contract"))):
        errors.append("Security routing or handoff reference drift")
    controls=c.get("controls",[])
    control_map={r.get("id"):r for r in controls if isinstance(r,dict)} if isinstance(controls,list) else {}
    if (set(control_map)!=set(SECURITY_CONTROL_OWNERS) or len(controls)!=len(SECURITY_CONTROL_OWNERS)):
        errors.append("Mandatory security controls missing or duplicated")
    states={"pending","in_progress","implemented"}
    for key,owner in SECURITY_CONTROL_OWNERS.items():
        r=control_map.get(key,{})
        branch=("develop" if owner=="planning" else "feature/presentation-foundation"
                if owner=="presentation" else "feature/application-pre-data-platform")
        if (r.get("owner_layer")!=owner or r.get("branch")!=branch or
            r.get("implementation_status") not in states or
            r.get("operational_verification") not in {"NOT_RUN","passed","failed"} or
            any(not isinstance(r.get(k),str) or not r[k].strip() for k in ("rule","acceptance"))):
            errors.append("Security control owner or acceptance drift: "+key)
    for o in spec.get("operations",[]):
        p=o.get("security_policy",{}); ids=set(p.get("control_ids",[]))
        needed={"SEC-01","SEC-03","SEC-04","SEC-07","SEC-08"}
        if o["id"] in SECURITY_ANALYSIS|SECURITY_READS:needed|={"SEC-05","SEC-06"}
        if (p.get("contract_ref")!="security_contract" or not needed<=ids or
            not ids<=set(SECURITY_CONTROL_OWNERS) or
            p.get("enforcement_status") not in {"pending_runtime_implementation","implemented"} or
            not SECURITY_REQUIREMENTS<=set(o.get("requirements",[]))):
            errors.append("Operation security policy drift: "+o["id"])
    for p in spec.get("pages",[])+spec.get("management_pages",[]):
        if not SECURITY_REQUIREMENTS<=set(p.get("requirements",[])):
            errors.append("Page security requirements absent: "+p.get("id",p.get("path","unknown")))
    boundary=c.get("response_boundary",{})
    if (boundary.get("public_schema_source")!="operations[].contract_ref" or
        not {"success","pending","error","idempotent_replay","persisted_report","print_dto",
             "published_forecast","browser_artifacts"}<=set(boundary.get("covers",[])) or
        not isinstance(boundary.get("forbidden"),list) or not isinstance(boundary.get("preserve"),list)):
        errors.append("Recursive response boundary drift")
    for category,ids in SECURITY_BOUNDARY_IDS.items():
        rows=boundary.get(category,[])
        rows=rows if isinstance(rows,list) else []
        keys=[r.get("id") for r in rows if isinstance(r,dict)]
        if (set(keys)!=ids or len(keys)!=len(ids) or len(rows)!=len(keys) or any(
            set(r)!={"id","description"} or not isinstance(r.get("description"),str) or
            not r.get("description","").strip() for r in rows if isinstance(r,dict))):
            errors.append("Mandatory response boundary category drift: "+category)
    gateway=c.get("gateway_policy",{})
    if (gateway.get("mode")!="server_authenticated_relay" or
        gateway.get("server_identity_required") is not True or
        gateway.get("user_authorization_in_application_required") is not True or
        gateway.get("direct_browser_analysis_allowed") is not False or
        gateway.get("credentials_in_browser_allowed") is not False):
        errors.append("Authenticated relay security drift")
    owner_roles=gateway.get("owner_roles",[])
    owner_map={r.get("owner_layer"):r for r in owner_roles if isinstance(r,dict)}
    if len(owner_roles)!=2 or set(owner_map)!={"presentation","infrastructure"} or any(
        owner_map.get(layer,{}).get("branch")!=branch or
        not isinstance(owner_map.get(layer,{}).get("responsibility"),str) or
        not owner_map.get(layer,{}).get("responsibility","").strip()
        for layer,branch in (("presentation","feature/presentation-foundation"),
                            ("infrastructure","feature/application-pre-data-platform"))):
        errors.append("Relay owner split drift")
    if gateway.get("implementation_status") not in states:
        errors.append("Relay implementation state drift")
    q=c.get("quota_policy",{})
    if not SECURITY_ANALYSIS<=set(q.get("analysis_operations",[])) or not SECURITY_READS<=set(q.get("read_operations",[])):
        errors.append("Free or paid security quota coverage drift")
    if set(q.get("input_paths",[]))!={"direct_scores","owned_profile_id"}:
        errors.append("Security quota input path bypass")
    if q.get("identity")!=["verified_subject_id","exam_id","policy_version","period"]:
        errors.append("Security quota identity drift")
    if (q.get("storage")!="application_port_private_shared_store" or
        not {"JWT","request_key","profile_id","report_id","search_term","cursor","worker","server_restart"}<=
            set(q.get("rotation_does_not_reset",[]))):
        errors.append("Shared quota persistence or rotation drift")
    if not SECURITY_CACHE_BINDING<=set(q.get("cache_binding",[])):
        errors.append("Security cache identity or version binding drift")
    if (q.get("policy_values_status") not in {"pending_approved_operational_values","approved_private_runtime_configuration"} or
        q.get("limits")!={k:None for k in ("request_window","distinct_scores","calculation_cost","concurrent_jobs","result_volume")}):
        errors.append("Operational quota values must stay private and unset in Git")
    error_rows=c.get("planned_errors",[])
    planned={r.get("code"):r for r in error_rows if isinstance(r,dict)}
    if len(error_rows)!=len(SECURITY_ERRORS) or set(planned)!=set(SECURITY_ERRORS):
        errors.append("Security planned errors missing unknown or duplicated")
    for code,(http,retry) in SECURITY_ERRORS.items():
        row=planned.get(code,{})
        if (set(row)!=SECURITY_ERROR_FIELDS or row.get("http")!=http or
            row.get("retry_after_required") is not retry or
            row.get("status") not in {"planned_not_implemented","in_progress","implemented"}):
            errors.append("Security planned error contract drift: "+code)
    cases=c.get("acceptance_cases",[])
    cases_map={r.get("id"):r for r in cases if isinstance(r,dict)} if isinstance(cases,list) else {}
    if len(cases)!=len(SECURITY_CASES) or set(cases_map)!=set(SECURITY_CASES) or any(
            cases_map.get(k,{}).get("control")!=v[0] or cases_map.get(k,{}).get("scope")!=v[1]
            for k,v in SECURITY_CASES.items()) or any(
            not isinstance(r.get("expected"),str) or not r.get("expected","").strip() for r in cases if isinstance(r,dict)):
        errors.append("Mandatory security acceptance cases drift")
    gates=spec.get("workflow",{}).get("branch_governance",{}).get("release_gate",{})
    checks=gates.get("checks",[])
    check_map={r.get("id"):r for r in checks if isinstance(r,dict)}
    if (set(c.get("mandatory_release_gates",[]))!=set(SECURITY_GATES) or
        not set(SECURITY_GATES)<=set(check_map) or any(
            sum(1 for r in checks if r.get("id")==k)!=1 for k in SECURITY_GATES)):
        errors.append("Mandatory security release gate absent or duplicated")
    evidence=c.get("acceptance_evidence",[])
    passed=set(); evidence_commits=set(); seen_cases=set()
    expected_fields={"case_id","control","scope","result","implementation_commit","policy_revision","evidence_ref"}
    if set(c.get("evidence_fields",[]))!=expected_fields:
        errors.append("Security evidence schema drift")
    if not isinstance(evidence,list):
        errors.append("Security evidence must be a list");evidence=[]
    for row in evidence:
        if not isinstance(row,dict):
            errors.append("Security evidence invalid");continue
        if row.get("case_id") in seen_cases:
            errors.append("Security evidence duplicated or conflicting")
        seen_cases.add(row.get("case_id"))
        case=SECURITY_CASES.get(row.get("case_id"))
        commit=row.get("implementation_commit")
        valid=(expected_fields<=set(row) and case is not None and row.get("control")==case[0] and
               row.get("scope")==case[1] and row.get("policy_revision")==c.get("revision") and
               isinstance(commit,str) and re.fullmatch(r"[0-9a-f]{40}",commit) is not None and
               isinstance(row.get("evidence_ref"),str) and bool(row["evidence_ref"].strip()) and
               row.get("result") in {"passed","failed","NOT_RUN"})
        if not valid:errors.append("Security evidence incomplete or mismatched");continue
        if row["result"]=="passed":
            passed.add(row["case_id"]);evidence_commits.add(commit)
    for case_id in passed:
        control,scope=SECURITY_CASES[case_id]
        verification=control_map.get(control,{}).get("operational_verification")
        if verification=="failed" or (scope in {"browser_artifacts","operational_auth_db"} and verification!="passed"):
            errors.append("Security evidence contradicts verification state: "+control)
    implementation_commit=c.get("implementation_commit")
    if passed and (len(evidence_commits)!=1 or evidence_commits!={implementation_commit}):
        errors.append("Security evidence implementation snapshot drift")
    for key,r in control_map.items():
        completed=r.get("implementation_status")=="implemented" or r.get("operational_verification")=="passed"
        if completed and not {k for k,v in SECURITY_CASES.items() if v[0]==key}<=passed:
            errors.append("Security control completion lacks scoped evidence: "+key)
    for key,required_cases in SECURITY_GATES.items():
        if check_map.get(key,{}).get("status")=="passed" and (
            not required_cases<=passed or any(control_map.get(SECURITY_CASES[k][0],{}).get(
                "implementation_status")!="implemented" for k in required_cases)):
            errors.append("Security release gate lacks implemented scoped evidence: "+key)
    complete=c.get("implementation_status")=="implemented"
    if c.get("implementation_status") not in states or (complete and (
        not set(SECURITY_CASES)<=passed or any(r.get("implementation_status")!="implemented" for r in control_map.values()))):
        errors.append("Security implementation readiness lacks evidence")
    if complete and (
        gateway.get("implementation_status")!="implemented" or
        any(o.get("security_policy",{}).get("enforcement_status")!="implemented" for o in spec.get("operations",[])) or
        any(row.get("status")!="implemented" for row in planned.values()) or
        spec.get("routing_policy",{}).get("security_enforcement_status")!="implemented" or
        any(spec.get(key,{}).get("security_transition_status")!="implemented" for key in
            ("backend_platform_contract","presentation_connection_contract","supabase_operations_handoff_contract"))):
        errors.append("Completed security runtime state drift")
    for o in spec.get("operations",[]):
        if o.get("security_policy",{}).get("enforcement_status")=="implemented" and not complete:
            errors.append("Operation security enforcement lacks implementation evidence: "+o["id"])
    if c.get("status") not in {"required_for_development_runtime_NOT_RUN","runtime_implemented_verification_pending","accepted"} or (
        c.get("status")=="accepted" and (not complete or not set(SECURITY_CASES)<=passed)):
        errors.append("Security acceptance status lacks evidence")
    if type(c.get("production_ready")) is not bool:
        errors.append("Security production readiness must be boolean")
    if c.get("production_ready") is True or gates.get("state")=="ready":
        if (not complete or q.get("policy_values_status")!="approved_private_runtime_configuration" or
            not set(SECURITY_CASES)<=passed or any(check_map.get(k,{}).get("status")!="passed" for k in SECURITY_GATES) or
            any(r.get("operational_verification")!="passed" for r in control_map.values())):
            errors.append("Security production readiness lacks all required acceptance")
    return sorted(set(errors))



def validate_opening_security_operations(spec):
    """Require the adopted authority and management gates without changing old receipts."""
    c=spec.get('opening_security_operations_contract')
    if not isinstance(c,dict):return ['Opening security contract missing']
    errors=[]
    if c.get('format')!='jungsi.opening-security-operations/v1' or c.get('document')!=spec.get('current_documents',{}).get('opening_security_operations') or c.get('production_ready')is not False:
        errors.append('Opening security registration or readiness drift')
    decision=c.get('user_decisions',{}); e=c.get('entitlement',{}); m=c.get('management',{}); q=c.get('queries',{}); cap=c.get('capacity',{})
    if c.get('status')=='accepted_on_develop_scoped_operating_NOT_RUN':
        evidence=c.get('verification',{});head=evidence.get('implementation_commit');ci=evidence.get('CI',[])
        if (not re.fullmatch(r'[0-9a-f]{40}',str(head)) or not re.fullmatch(r'[0-9a-f]{40}',str(evidence.get('integration_commit'))) or
            evidence.get('pull_request')!='https://github.com/natural0448/Jungsi_touch/pull/31' or
            type(evidence.get('commit_snapshot_tests'))is not int or evidence.get('commit_snapshot_tests',0)<923 or
            type(evidence.get('push_snapshot_tests'))is not int or evidence.get('push_snapshot_tests',0)<923 or
            not isinstance(ci,list) or len(ci)!=2 or any(not isinstance(r,dict)or r.get('headSha')!=head or r.get('conclusion')!='success'for r in ci) or
            any(evidence.get(k)!='NOT_RUN' for k in ('real_JWT_active_aal2_management','Edge_redeployment','browser_paid_after_grant_or_revoke','production_publication','actual_user_paid_management_browser'))):
            errors.append('Opening develop acceptance lacks exact scoped evidence')

    if (decision.get('paid_authority')!='public.jeongsi_passes' or decision.get('default_Postgres_composition_transition_authorized')is not True or decision.get('admin_paid_override')is not True or decision.get('admin_paid_override_status')!='confirmed_active_admin_aal2' or
        e.get('table')!='public.jeongsi_passes' or e.get('activation')!='revoked_at IS NULL AND starts_at <= now AND now < ends_at' or e.get('multiple_active_rows')!='MAX(ends_at)' or e.get('time_basis')!='UTC' or
        e.get('session_format')!='jungsi.session/v1' or e.get('session_fields')!=['format','member_tier','entitlement_expires_at'] or e.get('failure')!={'http':503,'code_policy':'existing_safe_entitlement_codes_without_SQL_details','fallback':False} or
        e.get('metadata_and_entitlement_data_queries_per_request')!=1 or type(e.get('metadata_and_entitlement_data_queries_per_request'))is not int or
        any(e.get(k)is not False for k in ('legacy_table_fallback_allowed','cross_request_entitlement_cache_allowed','adapter_writes_allowed','automatic_entitlement_grant_allowed')) or
        any(e.get(k)is not True for k in ('request_local_member_and_expiry_snapshot','transaction_configuration_queries_separate','explicit_dependency_injection_preserved','synthetic_memory_composition_preserved'))):
        errors.append('Opening paid authority or failure boundary drift')
    expected_admin_access_exception = {'role': 'admin', 'account_status': 'active', 'verified_aal': 'aal2', 'trusted_identity': 'exact_Bearer_verified_by_Supabase_Auth_getUser', 'trusted_profile': 'own_profiles_role_status_via_same_verified_Bearer_and_publishable_key_RLS', 'own_profile_select': ['role', 'status'], 'own_profile_queries_per_request': 1, 'same_subject_and_bearer_required': True, 'internal_origin_required': True, 'internal_origin': 'verified_own_profile_active_admin_aal2', 'request_local_origin_identity_required': True, 'member_tier': 'paid', 'entitlement_expires_at': None, 'real_active_pass_priority': True, 'real_expiry_preserved': True, 'ordinary_paid_null_expiry': '503_entitlement_unavailable', 'next_request_profile_reevaluation_required': True, 'client_roles_or_user_metadata_trusted': False, 'editor_or_approver_is_admin': False, 'ownership_school_review_approval_scope_override': False, 'pass_mutation_allowed': False, 'fake_expiry_allowed': False, 'profile_failure_breaks_ordinary_paid': False, 'cross_request_admin_cache_allowed': False, 'extra_profile_N_plus_one_allowed': False, 'pass_failure_fallback_allowed': False, 'frontend_request_id': 'FE-ADMIN-ACCESS-01', 'frontend_owner': 'external_frontend_team'}
    exception=e.get('admin_access_exception')
    if (type(exception)is not dict or set(exception)!=set(expected_admin_access_exception) or
        any(type(exception[k])is not type(value) or exception[k]!=value for k,value in expected_admin_access_exception.items())):
        errors.append('Opening administrator exception identity, expiry or scope drift')
    operations=['forecast.capabilities','forecast.list','forecast.create','forecast.read','forecast.adjust','forecast.validate','forecast.approve','forecast.publish']
    if (m.get('operations')!=operations or m.get('verified_aal')!='aal2' or m.get('account_status')!='active' or m.get('authority_source')!='jungsi_backend.forecast_authorities' or
        m.get('trusted_identity')!='exact_Bearer_verified_by_Supabase_Auth_getUser' or m.get('trusted_profile')!='own_profiles_role_status_via_same_verified_Bearer_and_publishable_key_RLS' or m.get('existing_edit_approve_and_school_scope_required')is not True or
        m.get('nonstaff_capabilities')!='empty_false' or
        any(m.get(k)is not False for k in ('public_forecast_read_is_management','client_roles_or_user_metadata_trusted','profile_admin_override_allowed','new_app_role_profiles_GRANT_allowed','student_or_paid_service_MFA_required','unknown_profile_breaks_student_service','JWT_AAL_profile_status_in_public_DTO_allowed')) or
        m.get('errors')!={'aal1':[403,'management_mfa_required'],'inactive':[403,'management_account_inactive'],'unknown':[503,'management_account_state_unverified']}):
        errors.append('Opening management MFA or active scope drift')
    refs={o['id'] for o in spec.get('operations',[]) if o.get('management_security_contract_ref')=='opening_security_operations_contract.management'}
    if refs!=set(operations):errors.append('Opening management route coverage drift')
    if (m.get('admin_logs_actor_source')!='auth.uid()' or m.get('admin_logs_metadata_source')!='database' or m.get('signup_source')!='website_only_age14_consents_email_captcha' or m.get('signup_via_dashboard_add_user_allowed')is not False or m.get('SMTP_captcha_leaked_password_settings_change_allowed')is not False or m.get('external_migration_numbers_reserved')!=[32,33,34,35]):
        errors.append('Opening external security ownership drift')
    if (any(q.get(k)is not True for k in ('parameterized_bounded_JOIN_required','bounded_before_MATERIALIZED_required')) or any(q.get(k)is not False for k in ('N_plus_1_allowed','unbounded_current_scan_for_UI_allowed','full_count_for_UI_allowed','duplicate_index_creation_allowed','test_intake_in_production_allowed'))):
        errors.append('Opening bounded query contract drift')
    if (any(cap.get(k)is not True for k in ('source_files_preserved','private_immutable_Storage_archive_required','archive_remote_bytes_SHA_readback_required','reference_and_current_C_identity_preservation_required','archive_resolver_before_payload_removal_required','exact_row_column_removal_manifest_and_user_approval_required','IO_warning_requires_stop_and_owner_recheck')) or
        any(cap.get(k)is not False for k in ('generic_cleanup_request_is_exact_removal_approval','registry_or_overlays_bulk_deletion_allowed','production_allowed_false_means_unused','historical_0206_window_is_current_requirement','VACUUM_FULL_automatic_allowed','normal_VACUUM_guarantees_disk_shrink'))):
        errors.append('Opening capacity preservation contract drift')
    if c.get('document')not in spec.get('workflow',{}).get('development_harness',{}).get('required_documents',[]):
        errors.append('Opening mandatory document missing from harness')
    return errors


def opening_security_document_body(spec):
    c=spec['opening_security_operations_contract']
    management=[o for o in spec['operations'] if o['id']in c['management']['operations']]
    return (
        '2026-10-15 사용자 확정은 public.jeongsi_passes 원본을 유지하면서 동일 검증 Bearer의 본인 profiles.role=admin/status=active와 aal2를 모두 확인한 관리자에게만 이용권 예외를 허용하는 것이다. 과거 명시 연결만 준비하기로 한 결정·이용권 어댑터·검수 영수증은 이력으로 보존한다. 최신 실행 변경의 규범은 이 문서와 opening_security_operations_contract이다.\n\n'
        '## 이용권 읽기와 기본 서버 구성\n\n'
        '실제 PostgreSQL 저장소 구성은 public.jeongsi_passes를 읽는다. revoked_at IS NULL이고 starts_at <= UTC now < ends_at인 행 중 MAX(ends_at)를 채택한다. 메타데이터/RLS/역할/필수 열과 현재 만료를 한 배치 JOIN으로 검증하고 /me의 회원 판정과 만료를 같은 요청 값에 결속한다. 트랜잭션 설정 질의는 데이터 조회와 별개다. 요청 간 이용권 캐시는 쓰지 않고 조회 장애는 기존의 안전한 이용권 오류 코드와 503으로 거절하고 SQL 세부 예외를 노출하지 않는다. 기존 이용권 표로 장애 대체하거나 이용권 행을 생성하지 않는다. 실제 활성 pass가 있으면 원래 만료값을 우선 보존한다. pass가 없고 요청 내부의 검증 관리자 origin이 있을 때만 session/v1의 member_tier=paid, entitlement_expires_at=null로 접근 예외를 표시한다. 일반 paid의 만료 누락은 여전히503이다. 공개3필드·자료 승인·본인소유권·학교/검수 subject 범위는 유지한다. FE-ADMIN-ACCESS-01은 외부 화면팀이 null 만료를 날짜 없이 관리자 이용으로 표시하는 요청이며 프런트 구현은 해당 팀 소유다. 명시 의존 주입과 로컬 합성 저장소는 보존한다.\n\n'
        '## 관리자 MFA·본인 상태·업무 권한\n\n'
        '관리 요청은 Supabase Auth가 정확한 Bearer를 검증한 뒤 aal2를 신뢰한다. 같은 검증 Bearer와 publishable key로 자신의 profiles.role,status를 한 번 조회해 기존 RLS를 따른다. 관리자 예외는 같은 요청의 내부 origin으로 결속하며 다음 요청에서 역할·상태를 다시 확인한다. 관리자 확인 장애는 예외만 막고 이미 검증한 일반 유료 이용권을 버리지 않는다. active가 아니면 403 management_account_inactive, 상태 미확인은 관리만 503 management_account_state_unverified, aal1은 403 management_mfa_required다. 기존 forecast_authorities의 편집/승인·학교 범위도 모두 필요하다. public.is_admin()이나 이메일·클라이언트 role만으로 자체 관리 권한을 부여하지 않는다. staff_roles 테이블은 가정하지 않는다. 일반·유료 학생 조회/분석에는 MFA를 추가하지 않고 관리 상태 조회 실패만으로 성공한 학생 응답을 버리지 않는다. 비직원 capabilities는 empty/false다.\n\n'+
        table(['관리 operation','HTTP','경로'],[[o['id'],o['method'],o['path']]for o in management])+
        '\n\nOTP 등록은 계정 주인이 /admin에서 휴대폰 앱으로 수행한다. /jeongsi 미리보기와 관리 기능의 인증 조건은 구분한다. JWT/aal/profile 역할·상태와 관리자 origin은 서버 내부 값으로 공개 DTO에 넣지 않는다. admin_logs는 auth.uid() 본인 actor만 쓰고 이메일/IP/시각은 DB가 채운다. 시험 계정도 사이트 가입 화면에서 생성한다. 외부 마이그레이션 32~35 번호를 점유하고 SMTP·캡차·유출 비밀번호 설정은 변경하지 않는다.\n\n'
        '## 조회·용량·보존형 정리\n\n'
        '화면 조회는 매개변수화된 제한 범위 JOIN과 keyset을 쓴다. 전체 count·전국 FETCH와 N+1을 화면 경로에 붙이지 않는다. 제한 ID를 먼저 고른 MATERIALIZED는 별도이며 제거 자체를 성능 검증으로 간주하지 않는다. 기존 인덱스와 valid/ready·계획을 확인한 후 필요한 것만 제안한다. 시험 적재는 로컬/운영 외 DB에서 한다.\n\n'
        '원 압축 bytes를 재압축 없이 비공개 불변 Storage에 보관하고 원격 bytes/SHA를 다시 확인한 뒤 archive pointer/resolver·현재/C 근거 보존을 검수한다. csv/support NOT NULL·길이/해시 제약이 있어 업로드만으로 본문 제거가 가능해지지 않는다. 정확 표/PK/열·해시·참조·제거 명부에 사용자가 승인한 범위만 다음 단계에서 적용한다. registry·overlays의 전량 삭제, production_allowed=false를 미사용으로 해석, 무조건 VACUUM FULL은 금지한다. 일반 VACUUM의 내부 공간 재사용과 파일 크기 축소를 구분한다. 과거 02~06 제한은 현재 강제 규칙으로 재등록하지 않는다. I/O 경고가 다시 나타나면 대량 작업을 멈추고 Owner와 재확인한다.\n\n'
        '## 검증과 재개 조건\n\n아래 verification 표는 기존 PR31의 이용권·관리 MFA 인수 이력이며 신규 관리자 예외 인수 근거로 승격하지 않는다. 신규 예외의 구현 커밋·현재 검수는 정본 admin_exception_implementation.verification에 별도로 기록한다. 실제 JWT·runtime entry/read budget·005·BFF/배포는 NOT_RUN이다.\n\n'+table(['검수','현재 상태'],[[k,v]for k,v in c['verification'].items()])+
        '\n\n개발팀 코드는 담당 feature PR로 통합한다. 실제 JWT·MFA 관리·유료 발급/회수 브라우저 검수, Edge 재배포, CAP 실행·발행은 해당 영수증 없이 완료 처리하지 않는다. 검수 descriptor의 subject·purpose·만료·relay·PIN을 이 변경으로 풀거나 연장하지 않는다.'
    )


def generated_files(spec,read=None):
    digest=hashlib.sha256(json.dumps(spec,ensure_ascii=False,sort_keys=True,separators=(",",":")).encode()).hexdigest()
    def doc(title,body):
        return f"# {title}\n\n이 문서는 공통 명세 service_spec.json에서 생성한다. 현재 버전은 {spec['version']}이며 기획·라우팅·계층 문서를 같은 변경으로 갱신한다.\n\n{body}\n\n<!-- jungsi:generated spec_sha256={digest} -->\n"
    collaboration=collaboration_sections(spec)
    runtime_progress=live_execution_document(spec)
    page_rows=[[p["number"],p["label"],p["path"],rights(p["member_tiers"]),p["purpose"]] for p in spec["pages"]]
    requirement_text="\n\n".join(f"### {r['id']} {r['title']}\n\n{r['description']}" for r in spec["requirements"])
    pending="\n".join("- "+text for text in spec["pending"])
    changes=table(["변경일","요구사항","변경과 구현 범위"],[[r["date"],", ".join(r["requirements"]),r["summary"]] for r in spec.get("change_notes",[])])
    files={}
    platform=spec.get('backend_platform_contract')
    runtime_intro=('FastAPI '+str(len(spec['operations']))+'개 경로와 업무 서비스·Supabase/Drive 어댑터를 구현했다. 코드 합성 검증과 실제 운영 연결은 구분한다. [API DTO 계약](API_DTO_계약.md)과 [백엔드 운영 준비](백엔드_운영준비.md)를 함께 읽는다.' if platform else '아래 API는 연결 예정 계약이며 HTTP 핸들러가 등록된 상태가 아니다.')
    files[spec["current_documents"]["planning"]]=doc("정시터치 현재 서비스 기획",
       "학생·학부모가 전체 성적 위치에서 출발해 유리한 대학·학과와 핵심 지원 학교를 찾는 상담 서비스다. 교사·입시담당자는 부 사용자다. 현재는 계산·권한·라우팅의 개발 기반이며 운영 서비스 완성을 의미하지 않는다.\n\n"+
       "## 화면과 회원 정책\n\n"+table(["페이지","화면","경로","회원","역할"],page_rows)+
       "\n\n1페이지의 실제 결과 조회 네 학년도는 자료 공개 범위에 따라 별도 확정한다. 2024~2027 성적 환산 비교와 결과 공개 연도를 혼동하지 않는다. 3페이지는 검색부터 상세까지 유료 전용이며 성적이 없어도 유료 검색을 허용한다. 개인 분석이 준비되지 않으면 이유와 함께 보류한다.\n\n"+
       "## 확정 요구사항\n\n"+requirement_text+"\n\n## 이번 버전의 변경\n\n"+changes+"\n\n## 준비 상태와 후속 구현\n\n"+pending+
       runtime_progress+"\n\n현재 구현 기준은 [라우팅 명세](라우팅_명세.md), [3티어 개발구조](3티어_개발구조.md), [개발 브랜치 운영](개발_브랜치_운영.md)과 함께 읽는다."+collaboration["ownership"]+collaboration["drive"])
    if spec.get("score_input_policy_contract"):
        runtime_intro="현재 논리 API 계약은 기존22+확장3=25개다. Edge는 REQ-27 구현 후보이며 운영 활성화 전이다. Python은 기존22 업무의 명시 legacy_synthetic 회귀 경로를 보존하고 현재 운영 모드의 새 입력/분석·신규3은 미구현 503 hold다. 기존 실제 설치·배포·P2 증거는 아래 별도 이력으로 구분한다."
    operation_rows=[[o["id"],o["method"],o["path"],rights(o["member_tiers"]),"본인" if o["report_owner"] else "해당 없음","필요" if o["confirmed_score_profile"] else "불필요",o["response_scope"]] for o in spec["operations"]]

    current_review_section=""
    owner_status_section=""
    current_review=spec.get("official_history_db_display_contract",{}).get("current_review_connection")
    if isinstance(current_review,dict) and isinstance(current_review.get("route"),dict):
        review_labels=["## \ud604\uc7ac \uc815\ubcf8 \uc804\uc218 \uac80\uc218 \uacbd\ub85c","\ud568\uc218","\uc791\uc5c5 ID","\uba54\uc11c\ub4dc\u00b7\uacbd\ub85c","\ub300\uc0c1","\ud604\uc7ac \uc0c1\ud0dc","\uc77c\ubc18 \ud68c\uc6d0 \uacf5\uac1c\ub97c \uc704\ud55c \uae30\ubcf822API\uc640 \ubd84\ub9ac\ub41c \uac80\uc218 \uacbd\ub85c\ub2e4. \uba85\uc2dc subject \ud5c8\uc6a9 \uba85\ubd80\u00b7purpose\u00b7\ub9cc\ub8cc\u00b7\uc11c\ubc84 relay/JWT \uac80\uc0ac\ub97c \ubaa8\ub450 \ud1b5\uacfc\ud574\uc57c \ud55c\ub2e4. \uad00\ub9ac\uc790\u00b7\uc720\ub8cc \ub4f1\uae09\ub9cc\uc73c\ub85c \ud5c8\uc6a9\ud558\uc9c0 \uc54a\ub294\ub2e4. \uae30\uc874 C 5GET\uc740 \uc720\uc9c0\ud55c\ub2e4.","\uac80\uc0c9 \ud544\ub4dc: ","\uc751\ub2f5 \ud615\uc2dd: ","\ud604\uc7ac \uc9c0\ud45c\uc758 \uc6d0\ubb38 literal\u00b7\uc6d0 JSON \ud0c0\uc785\uc744 \ubcf4\uc874\ud55c\ub2e4. \uacf5\uc2dd \uacf5\uac1c \uc815\ubcf4\uac00 \ubbf8\ud655\uc778\uc778 \uacbd\uc6b0 null\uacfc \ubcf4\ub958 \uc0ac\uc720\ub97c \ubc18\ud658\ud558\uba70 \ubc1c\ud45c \uc785\uacb0\ub85c \uc2b9\uaca9\ud558\uc9c0 \uc54a\ub294\ub2e4. \uc6d0 canonical/source ID\u00b7PK\u00b7\uacbd\ub85c\u00b7\ud0a4\ub294 \uc751\ub2f5\uc5d0\uc11c \uc81c\uc678\ud55c\ub2e4.","\ud398\uc774\uc9c0\ub2f9 \ucd5c\ub300100\uac74, limit+1 keyset\uacfc \ub3d9\uc77c SQL \uc2a4\ub0c5\uc0f7\uc758 \uc815\ud655\ud55c \uad00\uce21/\ucd9c\ucc98 \ud559\uad50 \uc9d1\uacc4\ub97c \uc0ac\uc6a9\ud55c\ub2e4. cursor\ub294 \uc11c\ubc84 \uc804\uc6a9 \ud0a4\ub85c \uc554\ud638\ud654\ud558\uace0 \uac80\uc218\uc790\u00b7\uac80\uc0c9\uc870\uac74\u00b7\uc815\ubcf8 \ubcc0\uacbd \uc0c1\ud0dc\u00b7\ud22c\uc601\ud310\u00b7\ub9cc\ub8cc\uc5d0 \uacb0\uc18d\ud55c\ub2e4. \uc0c1\ud0dc\uac00 \ubc14\ub00c\uba74409\ub85c \ub2e4\uc2dc \uc870\ud68c\ud55c\ub2e4. \uc77c\ubc18 \ud68c\uc6d0 \uc6b4\uc601 \uacf5\uac1c\u00b7BFF/\ube0c\ub77c\uc6b0\uc800\u00b7\ubcf4\uc5483gate\u00b7DB \uc815\ub9ac \uc644\ub8cc\ub97c \ub73b\ud558\uc9c0 \uc54a\ub294\ub2e4."]
        route=current_review["route"]
        review_details=review_labels[10]+' 첫 조회도 승인판의 검증된 변경 명령·내용 SHA·뷰/상태 핀과 대조한다. 아직 승인되지 않은 최신 상태는503 current_review_state_unapproved로 보류하며, 이후 cursor 상태 변경은409로 거절한다.'
        live_review=current_review.get("live_bounded_v2",{})
        if isinstance(live_review,dict) and live_review.get("query_mode")=="live_bounded":
            review_details=("live_bounded v2는 페이지당 최대100개 표시행과 제한된 원형 scan을 사용한다. 전체 관측·출처 학교 count는 계산하지 않고 두 count=null과 count_status=unknown을 반환한다. "
                            "빈 items와 next_cursor가 함께 있으면 다음 범위가 남은 정상 응답이며, next_cursor=null일 때만 종료한다. 자동 전수 수집을 하지 않는다. "
                            "정렬은 canonical_result_id의 C 순서다. cursor 내부 year sentinel2024는 실제 학년도를 바꾸지 않는다. cursor는 서버4096자 범위에서 원문 그대로 전달하며 절단·해독·재작성·기록하지 않는다. "
                            "첫 페이지는 승인된 정의·scope·subject·기간 검수 후 같은 READONLY/RLS 스냅샷의 latest command head에 결속한다. 다음 페이지 head가 바뀌면409로 처음부터 다시 조회한다. "
                            "기존 frozen v1의 정확 count와 첫 페이지 고정 head 방식은 보존된 이력이며 현재 v2에 적용하지 않는다.")
            intake=current_review.get("frontend_receipt_intake",{})
            if isinstance(intake,dict) and intake:
                local_owner=intake.get('local_owner_confirmation',{})
                if isinstance(local_owner,dict) and local_owner:
                    review_details+=("\n\n내부 검수 화면: "+intake["internal_review_path"]+". 소비자4페이지·기본22API·기존C 함수와 분리한다. "
                        "원래16dea213 기능 영수증은 이력으로 보존한다. v9/bf6435d local·loopback dev·origin "+local_owner['origin']+
                        "에서 실JWT 첫100건과 수동 다음100건·HTML 비밀값4종 미출현 보고를 원문/PR 결속으로 수용했다. 승인된 Owner·화면팀의 local 조회를 막는 발견사항은0이다. "
                        "이는 화면팀 실행 보고의 수용이며 Root의 새 JWT/BFF/브라우저 실행이나 전국 전수 일치가 아니다. BFF의 no-cache,must-revalidate와 Edge의 기존 private,no-store 근거는 구분한다. "
                        "외부 PR18의 develop 통합·live 방문자 권한 runtime·브라우저 private/no-store·409 실제 관측·운영3gate·일반 발행·전체4페이지 계산·W1/W2/CAP 완료는 포함하지 않는다.")
                else:
                    review_details+=("\n\n내부 검수 화면: "+intake["internal_review_path"]+". 소비자4페이지·기본22API·기존C 함수와 분리한다. "
                                     "화면팀의 freshJWT API 및 승인된 검수 목적 BFF/브라우저 기능 수신 영수증은 보고상 PASS이며 독립 재실행이나 전수 census 인수가 아니다. 실행 환경 격리와 실제 runtime origin·배포판은 이 영수증으로 입증되지 않았다. "
                                     "외부 화면 feature 커밋·PR18 open을 develop 통합 완료로 보지 않는다. 공통 서버 tokenFile 검수는 방문자 관리자 권한을 증명하지 않으므로 네트워크 노출 전 방문자 gate 또는 사설 접근 통제 증거가 필요하다. "
                                     "409 실제 관측·전체 운영 보안3gate·일반 회원 공개·발행·엔진·DB 정리·W1/W2/CAP 완료는 포함하지 않는다.")
        owner_view=spec.get('official_history_db_display_contract',{}).get('owner_status_view',{})
        if isinstance(owner_view,dict) and owner_view:
            owner_cli=owner_view['local_status_cli']
            owner_status_section=("## 로컬 Owner·화면팀의 1~4페이지 확인\n\n"+
                owner_view['purpose']+". DB/source 등록과 승인 native runtime 선택은 별개다. 검수 화면 하나의 수신을 전체 네 페이지 계산 완료로 표시하지 않는다.\n\n"+
                table(['페이지','로컬 화면 경로','기존 작업','최소 실제 자료','현재 증거와 보류'],
                    [[p['page'],p['path'],', '.join(p['operations']),', '.join(p['minimum_data']),p['current_evidence']+' · '+p['preserve']] for p in owner_view['pages']])+
                "\n\n전체서비스 명시 factory: "+owner_view['full_service_factory']+". localhost bind는127.0.0.1이다. "+owner_view['local_purpose_composition']+
                " Supabase Owner 권한은 유료 이용권·본인 소유권·승인 subject를 자동 우회하는 조건이 아니다.\n\n"+
                "### 자료 자체와 현재 공급자의 제한\n\n"+
                table(['배지/상태','해석'],[[r['badge'],r['meaning']] for r in owner_view['badge_meanings']])+
                "\n\n"+owner_view['value_count_meaning']+" source_review_status는 현재18필드 DTO에 없다. 공식 메타6개null은 공급자의 미제공 투영이며 DB원문 결측을 뜻하지 않는다. "
                "C140은 제한된 역사 검수 승인이다. C recruitment는 현재 pending/null로 고정되며 자료 등록만으로 자동ready가 되지 않는다. 최종 합격 예비번호는 추가 합격 인원과 다르다.\n\n"+
                "### 로컬 상태 점검 명령\n\n"+
                "프로젝트 src를 PYTHONPATH에 둔 비공개 서버 환경에서 실행한다.\n\n```powershell\n"+
                owner_cli['four_page_command']+"\n"+owner_cli['review_status_command']+
                "\n```\n\n네 페이지 명령은 설정 존재성과 비공개 registry/selection metadata만, 단일응답 명령은 제외폴더의 최대1MiB·100행 캡처만 읽는다. "
                "DB/Auth/Storage/네트워크·엔진·환경파일 변경은 없고 실값·학교명·토큰·cursor·경로를 출력하지 않는다. metadata 적격은 실제 decoder·버전 결속·화면 연결 완료가 아니다. "
                "부족한 자료는 capability별로 보류하며 다른 페이지 성공을 지우지 않는다. "+owner_view.get('native_execution_summary', '새 실제 계산·브라우저 검수는 NOT_RUN으로 유지한다.')+"\n\n"+
                "화면팀 구현 기준:\n\n"+'\n'.join('- '+item for item in owner_view['frontend_actions']))
            w6=current_review.get('frontend_receipt_intake',{}).get('work_items',{}).get('W6',{})
            if isinstance(w6,dict) and w6:
                owner_status_section+=("\n\n### W6 첫 발행과 사람 판정 UI 회신\n\n"+
                    "첫 일반 공개 발행일은 현재 미정이다. local 검수 수신 완료와 별개이며 고정배지3개로 실제 검수 진행률을 산출하지 않는다. 첫 부분 배치 단위: "+w6['first_batch_unit']+
                    "\n\n자동 검사 대상: "+', '.join(w6['automatic_checks'])+". 사람 판정 대상: "+', '.join(w6['human_cases'])+
                    ". 자동/수작업 비율은 새 분모를 재측정하지 않아 미확인이다.\n\n"+
                    "검수 UI 계약은 "+w6['UI_proposal']+" 상태이며 현재22API에 새 쓰기 경로가 등록된 것이 아니다. 후보 입력: "+', '.join(w6['UI_required_fields'])+
                    "; 판정 "+', '.join(w6['UI_decisions'])+". 서버는 권한·revision409·불변 감사·idempotency를 유지하며 검수 판정만으로 일반 발행이나 엔진 승인을 자동 수행하지 않는다.\n\n"+
                    "W1 합류: "+w6['W1']+" W3의 bounded 연결과 W4의 제한 기능 수신은 완료 이력을 보존한다. W1~W6 모두가 같은 차단 상태는 아니다.")
        current_review_section=(
            review_labels[0]+"\n\n"+
            table(review_labels[1:6],[[current_review["function_name"],current_review["operation"],route["method"]+" "+route["path"],route["audience"],current_review["status"]]])+
            "\n\n"+review_labels[6]+"\n\n"+review_labels[7]+", ".join(current_review["query_fields"])+".\n\n"+
            review_labels[8]+current_review["review_DTO"]+".\n\n"+review_labels[9]+"\n\n"+review_details+"\n\n"+owner_status_section+"\n\n")
        files[spec["current_documents"]["planning"]]+="\n\n"+current_review_section

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
       runtime_progress+overall_section+current_review_section+"## 함께 생성하는 계약\n\n화면은 apps/web/route_catalog.json을, 애플리케이션은 src/jungsi_touch/application/route_catalog.json을 사용한다. 두 파일과 이 문서는 공통 명세에서 생성하고 검사한다."+collaboration["api_handoff"])
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
       runtime_progress+"\n\n기존 src/jungsi_touch 루트 계산 모듈은 애플리케이션의 엔진 라이브러리다. 경로를 옮겨 기존 사용자를 깨뜨리지 않는다. 새 application과 infrastructure를 통해 입출력·소유권·저장소를 연결한다. 메모리 어댑터는 합성 검산 전용으로 운영 연결을 의미하지 않는다.\n\n"+
       "## 데이터와 기술 결정\n\n실제 원자료·학생 성적·입결·환산표·곡선·모델과 .env 계열은 모든 브랜치에서 제외한다. database에는 DB 구조·마이그레이션 코드만 둘 수 있다. "+("FastAPI·Supabase PostgreSQL을 채택했다. UTC aware/timestamptz와 date를 구분하고 서버는 환경 설정만 읽는다. 제한된 실제 연결·자료 목적 승인·함수 배포의 현재 근거는 live_execution 원장을 따르며 전체 운영 인수는 미완료다." if platform else "DB 엔진·웹 프레임워크·HTTP 서버 채택은 미정이다.")+"\n\n"+
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
    frontend_runtime=spec.get('supabase_deployment_contract',{}).get('live_execution',{}).get('frontend_runtime_rule',
        '기존 가상 화면은 기획 이력이며 이 폴더의 실행 앱이 아니다. 실제 화면 앱·인증·API 연결은 후속 작업이다.')
    files["apps/web/README.md"]=doc("정시터치 프레젠테이션 개발 기준","현재 경로와 회원별 화면 접근 범위는 route_catalog.json을 따른다. [현재 기획](../../docs/current/서비스_기획.md)과 [라우팅 명세](../../docs/current/라우팅_명세.md)를 함께 갱신한다. "+frontend_runtime+"\n\n화면은 서버가 허용한 결과만 표시하고 자체 대학 계산이나 DB 직접 조회를 구현하지 않는다. 브라우저의 회원등급 선택값을 운영 권한으로 사용하지 않는다."+collaboration["presentation_intro"])
    files["database/README.md"]=doc("정시터치 데이터 계층 개발 기준","이 폴더에는 실제 값이 없는 DB 구조·마이그레이션 코드만 추가할 수 있다. "+(platform['database'] if platform else "운영 DB 채택과 스키마는 미정이다.")+" 원자료·성적·입결·환산표·곡선·모델·덤프·접속 비밀값은 여기에 복사하지 않는다.\n\n실제 데이터는 Git 제외 폴더 또는 비공개 DB·스토리지에 두고 애플리케이션 포트를 통해 접근한다. [3티어 개발구조](../docs/current/3티어_개발구조.md)를 따른다."+collaboration["drive"])
    if spec["current_documents"].get("presentation_handoff"):
        files[spec["current_documents"]["presentation_handoff"]]=doc("프레젠테이션 담당과 작업 인계",collaboration["handoff"]+("\n\n## 연결할 서버 계약\n\n"+runtime_intro+" HTTP 응답은 UTC Z 시각을 표시 경계에서 Asia/Seoul로 변환하며 YYYY-MM-DD 날짜는 그대로 표시한다. Supabase 검증 access token과 쓰기 요청 Idempotency-Key, expected_version을 보내고 401/403/404/409 및 pending/null을 구분한다. GET print는 고정 revision 상담 DTO이며 인쇄/PDF 렌더링은 화면 담당이다." if platform else ''))
    if platform:
        gap_rows=[[r['operation'],r['before'],r['after'],r['storage'],r['verification'],r['external_settings'],r['live_data']] for r in platform['operation_gaps']]
        time_rows=[[key,value] for key,value in platform['datetime'].items()]
        runtime=platform['runtime']
        files[spec['current_documents']['backend_readiness']]=doc('백엔드 구현과 운영 준비',
            '현재 구현 범위는 '+str(len(spec['operations']))+'개 HTTP/업무·서버 세션/이용권·저장/Drive 어댑터·추가 스키마·UTC 계약이다. code_status='+platform['code_status']+', live_server='+platform['live_server_status']+', live_data='+platform['live_data_status']+'. 실제 설정이 없는 운영 모드를 합성 인증/메모리 자료로 자동 대체하지 않는다.\n\n'+
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
            '## '+str(len(spec['operations']))+'개 요청과 응답\n\n'+table(['API','메서드/경로','본문','쿼리','응답 DTO','키 필수'],[[o['id'],o['method']+' '+o['path'],'; '.join(o['http_contract']['body']) or '없음',', '.join(o['http_contract']['query']) or '없음',o['http_contract']['response']+'; '+o['contract_ref'],o['http_contract']['idempotency_key_required']] for o in spec['operations']])+'\n\n모든 HTTP 업무 서비스는 PlatformService.execute이며 FastAPI create_app이 경로를 등록한다. 요청은 operations[].http_contract, 응답은 해당 contract_ref를 따른다. overall.analyze의 HTTP 응답은 persisted report이고 내부 overall 필드만 기존 OverallAnalysisService의 jungsi.overall-analysis/v1 엔진 DTO다. 두 객체를 루트 응답으로 혼동하지 않는다.\n\n'+
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
    if spec.get('local_verification_contract'):
        local=spec['local_verification_contract']
        files[spec['current_documents']['local_verification']]=doc('로컬 검증 연결',local_verification_text(spec))
        frontend['local_verification_contract']={key:local[key] for key in ('format','code_status','verification_status','frontend_connection','api_boundary')}
        backend['local_verification_contract']=local
    files["apps/web/route_catalog.json"]=json.dumps(frontend,ensure_ascii=False,indent=2)+"\n"
    files["src/jungsi_touch/application/route_catalog.json"]=json.dumps(backend,ensure_ascii=False,indent=2)+"\n"
    if spec.get('supabase_operations_handoff_contract'):
        files[spec['current_documents']['supabase_operations_handoff']]=doc('Supabase 운영 인수인계',supabase_operations_handoff_text(spec))
        files[spec['current_documents']['frontend_reply']]=doc('화면팀 최종 회신 요청과 로컬 연결 답변',frontend_reply_text(spec))
        files[spec['current_documents']['frontend_followup']]=doc('화면팀 로컬 검수 후속 작업 지시와 SUP 회신',frontend_followup_text(spec))
        frontend['supabase_operations_handoff']=supabase_operations_route_metadata(spec)
        backend['supabase_operations_handoff']=supabase_operations_route_metadata(spec)
        files['apps/web/route_catalog.json']=json.dumps(frontend,ensure_ascii=False,indent=2)+'\n'
        files['src/jungsi_touch/application/route_catalog.json']=json.dumps(backend,ensure_ascii=False,indent=2)+'\n'
    for path in spec['current_documents'].values():
        if path in files:
            marker='\n\n<!-- jungsi:generated'
            section=supabase_operations_summary(spec)
            files[path]=files[path].replace(marker,section+deletion_scope_text(spec)+marker)
    handoff=spec.get('contract_review',{}).get('handoff_response')
    if handoff:
        files[handoff['path']]=doc(handoff['title'],handoff['body'])
    if spec.get('local_verification_contract'):
        for key in ('planning','routing','architecture','backend_readiness','presentation_handoff','presentation_connection'):
            path=spec['current_documents'].get(key)
            if path in files:
                section='\n\n## 로컬 검증 연결 계약\n\n'+'[로컬 검증 연결](로컬_검증_연결.md)은 별도 loopback factory·메모리 저장소·네 시험 subject·수신PC DPAPI·신뢰 명부/선택명부와 출처 영수증을 규정한다. 이 로컬 factory의 성적·리포트·담기·시험 이용권·예측 초안/발행 내용은 메모리에만 있으므로 서버 재시작 시 사라진다. 원본 승인 파일·DPAPI 패키지 보존과 계산·저장 결과의 영속성은 별개이며 실제 학생의 저장 기능 인수에는 운영 DB 검수가 필요하다. 운영 factory/22API·DTO는 불변이다. 전체 분석에서 시험팩 미등록은 exam_not_available 503, 등록된 미채택 팩은 provider의 artifact_not_approved를 exam_data_unavailable 503으로 응답하는 조건이다. 이는 소스 조건이며 HTTP 관측은 별도 증거로 확인한다. 승인 시험팩이 있고 승인곡선이 없는 경우에는 HOLD와 계산에 성공한 총점 보존을 확인한다. 실제 DB/운영 인증/외부 브라우저 인수와 production_ready=false를 구분한다.'
                files[path]=files[path].replace('\n\n<!-- jungsi:generated',section+'\n\n<!-- jungsi:generated')
        if handoff:
            files[handoff['path']]=files[handoff['path']].replace('\n\n<!-- jungsi:generated',
                '\n\n[로컬 검증 계약과 실행 후보](../../current/로컬_검증_연결.md)를 함께 읽는다.\n\n<!-- jungsi:generated')
    if spec.get('supabase_operations_handoff_contract'):
        for path,link in [('apps/web/README.md','../../docs/current/Supabase_운영_인수인계.md'),('database/README.md','../docs/current/Supabase_운영_인수인계.md')]:
            files[path]=files[path].replace('\n\n<!-- jungsi:generated',supabase_operations_summary(spec,link)+'\n\n<!-- jungsi:generated')
        if handoff:
            files[handoff['path']]=files[handoff['path']].replace('\n\n<!-- jungsi:generated',supabase_operations_summary(spec,'../../current/Supabase_운영_인수인계.md')+'\n\n<!-- jungsi:generated')
    if spec.get('runtime_connection_preparation_contract'):
        runtime_path=spec['current_documents']['runtime_connection_preparation']
        files[runtime_path]=doc('Supabase 실행 자료 연결과 운영 준비',runtime_connection_document(spec))
        marker='\n\n<!-- jungsi:generated'
        for path in [spec['current_documents'][key] for key in ('planning','routing','architecture','workflow')]+['docs/current/Supabase_운영_인수인계.md','apps/web/README.md','database/README.md']:
            if path in files:
                link=('../../docs/current/' if path=='apps/web/README.md' else '../docs/current/' if path=='database/README.md' else '')+'Supabase_실행자료_연결.md'
                files[path]=files[path].replace(marker,'\n\n[명시 Supabase 실행 자료 연결·공급자별 readiness·운영 준비]('+link+')의 DEV-009 계약을 함께 따른다.'+marker)
    if spec.get('supabase_deployment_contract'):
        deployment_path=spec['current_documents']['supabase_deployment']
        files[deployment_path]=doc('Google Drive·Supabase 전용 배포와 화면 후속작업',supabase_deployment_document(spec))
        marker='\n\n<!-- jungsi:generated'
        for path in [spec['current_documents'][key] for key in ('planning','routing','architecture','workflow','runtime_connection_preparation','supabase_operations_handoff','frontend_reply','frontend_followup','presentation_handoff')]+['apps/web/README.md','database/README.md']:
            if path in files:
                link=('../../docs/current/' if path=='apps/web/README.md' else '../docs/current/' if path=='database/README.md' else '')+'Supabase_배포_화면_후속작업.md'
                files[path]=files[path].replace(marker,'\n\n## 현재 운영 플랫폼과 화면 인계\n\n[Google Drive·Supabase 전용 배포 계약]('+link+')이 이전 별도 FastAPI 호스팅/외부 워커 인계보다 우선한다. Python 검산은 보존하고 Edge 호환과 실제 인수는 후속 작업이다. relay는 X-Jungsi-Relay-Token 확정 계약이며 발행 감지는 최신 승인 native 버전/해시를 사용한다. 화면 제공 범위와 요금제 포함량 검수는 완료 전 상태를 유지한다.'+marker)
    display=spec.get('official_history_db_display_contract')
    if display:
        marker='\n\n<!-- jungsi:generated'
        body=(display['purpose']+'\n\n계약 '+display['revision']+' · 코드 '+display['code_status']+
              ' · production_ready=false. 담당 '+display['branch']+'.\n\n## 연결과 승인 범위\n\n'+
              '화면/BFF → Supabase Edge 서비스 API → 기존 비공개 입결 DB. Python은 로컬 기준이다. '+
              'DB 적재·C 로컬 수신·제한 클라우드 검수·운영 발행은 각각 구분한다.\n\n'+
              '\n'.join('- '+r for r in display['rules'])+
              '\n\n## 기존 API와 구현 경로\n\n'+table(['항목','값'],[[k,str(v)] for k,v in display['composition'].items()])+
              '\n\n논리 작업: '+', '.join(display['operations'])+'. 기존22 API 중 명시한 조회 부분만 연결하며 전체 엔진 포팅 완료를 뜻하지 않는다.'+
              '\n\n## 담당 작업\n\n'+table(['작업','담당','범위'],display['tasks'])+
              '\n\n## 화면팀 연결\n\n'+'\n'.join('- '+r for r in display['frontend_handoff'])+
              '\n\n'+owner_status_section+
              '\n\n## 증거와 미실행 범위\n\n'+table(['항목','상태'],[[k,str(v)] for k,v in display['verification'].items()]))
        files[spec['current_documents']['official_history_db_display']]=doc('Supabase 입결 DB와 화면 API 연결',body)
        for key in ('planning','routing','architecture','workflow','presentation_handoff','runtime_connection_preparation','supabase_deployment','supabase_operations_handoff','frontend_reply','frontend_followup'):
            target=spec['current_documents'].get(key)
            if target in files:
                files[target]=files[target].replace(marker,'\n\n## 기존 입결 DB를 화면 API에 연결\n\n'+
                    '[공식 입결 DB 표시 연결](DB_입결_화면연결.md)의 DEV-011을 따른다. 기존 DB를 별도 목적 범위로 명시 조회하며 '+
                    '기본 이용권·엔진/운영 원형 상태·22API/DTO·보안 gate를 유지한다. 코드 '+display['code_status']+
                    '; 실제 검수/운영 상태는 같은 문서의 항목별 증거로 확인한다.'+marker)
        for target in ('apps/web/route_catalog.json','src/jungsi_touch/application/route_catalog.json'):
            if target in files:
                route=json.loads(files[target]); route['official_history_db_display_contract']=display
                files[target]=json.dumps(route,ensure_ascii=False,indent=2)+'\n'
    history=spec.get('history_presentation_contract')
    if history:
        marker='\n\n<!-- jungsi:generated'
        preview=history['preview']; verification=history['verification']
        history_text=(history['decision']+'\n\n## 추정 2열의 표시와 산술'+'\n\n'+
            table(['열','산식'],[[r['label'],r['formula']] for r in history['estimated_columns']])+
            '\n\n'+'\n'.join('- '+r for r in history['rules'])+
            '\n\n## 발행 전 시사 준비\n\n선택한 준비 경로: '+preview['selected_preparation']+'. '+preview['reason']+
            '\n\n'+table(['안','방식','적용 조건'],preview['alternatives'])+
            '\n\n'+'\n'.join('- '+r for r in preview['local_preconditions'])+
            '\n\n'+preview['ETA_rule']+
            '\n\n## 별도 자료 반입 흐름\n\n'+history['separate_import']['reported_source']+
            '\n\n상태: '+history['separate_import']['verification_status']+'.\n\n'+
            '\n'.join('- '+r for r in history['separate_import']['rules'])+
            '\n\n## 담당 후속 작업\n\n'+table(['작업','담당','수행 범위'],history['frontend_tasks'])+
            '\n\n## 현재 검증 범위\n\n'+table(['항목','상태'],list(verification.items()))+
            '\n\n기획 검산은 외부 화면 구현·로컬 꾸러미 승인/수신·실제 시사·운영 발행/배포/보안 인수를 대신하지 않는다.')
        submission=history.get('submission_review')
        if submission:
            history_text+='\n\n## 화면 영수증 수신과 수정 인수\n\n화면 관측 '+submission['frontend_commit']+' · '+submission['evidence_scope']+'. '+submission['decision']+'\n\n'+table(['작업','항목','수정·인수 조건'],submission['corrections'])
            followup=submission.get('followup_review')
            if followup:
                history_text+='\n\n## 수정 회신의 독립 검토\n\n'+followup['summary']+'\n\n'+table(['항목','확인 범위·판정'],followup['accepted_observations'])+'\n\n'+table(['증거','상태·한계'],followup['evidence_boundaries'])
                history_text+='\n\n공식 근거: '+', '.join('['+r['title']+']('+r['url']+')' for r in followup['primary_sources'])+'.'
            latest=submission.get('latest_observation')
            if latest:
                history_text+='\n\n## 최신 소스 변경 관측\n\n'+latest['summary']+'\n\n'+table(['항목','현재 확인 범위'],latest['observations'])
        partial=history.get('partial_publication')
        if partial:
            history_text+='\n\n## 학교별 부분 발행 착수\n\n'+partial['request']+'\n\n상태 '+partial['state']+' · 단위 '+partial['unit']+' · 선택 '+partial['selection_strategy']+'.\n\n'+'\n'.join('- '+x for x in partial['rules'])+'\n\n'+table(['작업','담당','산출물'],partial['owners'])+'\n\n'+partial['first_batch_and_ETA']+' 운영 발행 '+partial['operational_publication']+'.'
        history_path=spec['current_documents']['history_display']
        files[history_path]=doc('1페이지 공식 자료·추정 표기·발행 전 시사',history_text)
        summary=('\n\n## 1페이지 추정 2열과 초안 시사\n\n'+
            '[공식 자료·추정 표기·시사 계약](1페이지_공식자료_추정표기_시사.md)을 따른다. '+
            history['decision']+' 동일 학년도/모집행/통계 분모와 결측·실제0·음수를 검사하고 실제 불합격자수와의 차이를 표시한다. '+
            'API의 공식 history_metric과 회원 권한은 유지한다. 학교별 부분 발행은 단일 활성 catalog의 누적 불변 판으로 착수하며 source 승격·자동 병합을 하지 않는다. 실제 발행된 과거 입결의 목록/검수 계보·부분 조회를 화면에서 대조하고 승인·선택·수신·브라우저·운영 발행은 별도 인수다.')
        for key in ('planning','routing','architecture','workflow','presentation_handoff','api_dto','presentation_connection','local_verification','frontend_reply','frontend_followup','supabase_deployment','runtime_connection_preparation'):
            path=spec['current_documents'].get(key)
            if path in files:files[path]=files[path].replace(marker,summary+marker)
        for path in ('apps/web/route_catalog.json','src/jungsi_touch/application/route_catalog.json'):
            catalog=json.loads(files[path]);catalog['history_presentation_contract']=history
            files[path]=json.dumps(catalog,ensure_ascii=False,indent=2)+'\n'
    for path,metadata in spec['workflow'].get('synchronized_work_items',{}).items():
        item=dict(metadata)
        item['scope']=spec[item['contract_ref']]
        files[path]=json.dumps(item,ensure_ascii=False,indent=2)+'\n'
    files.update(generated_sync_files(spec,doc,table))
    if spec.get('workflow',{}).get('documentation_sync'):
        marker='\n\n<!-- jungsi:generated'
        reference=('\n\n## 개발 변경과 문서 동기화\n\n'+
                   '[현재 개발현황과 문서 동기화](개발현황_문서동기화.md) 및 [코드 색인](code_routing_index.json)을 먼저 읽는다. '
                   '최신 검증 커밋부터 Git 변경 파일과 연결된 요구사항·라우팅만 검토하고 공통 명세에서 모든 문서를 함께 생성한다. '
                   '모든 에이전트는 코드·기획·라우팅을 같은 커밋에서 일치시키고 필수 훅·CI를 통과해야 한다. '
                   '이미 검증한 원자료·전체 소스를 매 작업마다 다시 읽지 않는다. 범위 확대 사유와 실제 운영 미검증 상태는 별도로 기록한다.')
        for key in ('planning','routing','architecture','workflow','presentation_handoff'):
            path=spec['current_documents'][key]
            files[path]=files[path].replace(marker,reference+marker)
    acceptance=common_tools_acceptance_text(spec)
    if acceptance:
        marker='\n\n<!-- jungsi:generated'
        for path in files:
            if path.endswith('.md'):
                files[path]=files[path].replace(marker,acceptance+marker)

    if spec.get("security_contract"):
        security_path=spec["security_contract"]["document"]
        files[security_path]=doc("외부접근 데이터보호 개발기준 · 필수 개발 참조",security_document_body(spec))
        marker="\n\n<!-- jungsi:generated"
        for path in spec["current_documents"].values():
            if path in files and path!=security_path:
                files[path]=files[path].replace(marker,security_reference(spec,PurePosixPath(security_path).name)+marker)
        for path,link in [
            ("apps/web/README.md","../../"+security_path),
            ("database/README.md","../"+security_path),
            (spec.get("contract_review",{}).get("handoff_response",{}).get("path"),"../../current/"+PurePosixPath(security_path).name),
        ]:
            if path in files:
                files[path]=files[path].replace(marker,security_reference(spec,link)+marker)
        for path in ("apps/web/route_catalog.json","src/jungsi_touch/application/route_catalog.json"):
            catalog=json.loads(files[path])
            catalog["security_contract"]=security_catalog_contract(spec)
            catalog["mandatory_security_document"]=security_path
            for op in catalog.get("operations",[]):
                canonical=next(o for o in spec["operations"] if o["id"]==op["id"])
                op["security_policy"]=canonical["security_policy"]
            files[path]=json.dumps(catalog,ensure_ascii=False,indent=2)+"\n"

    if spec.get('opening_security_operations_contract'):
        latest=spec['opening_security_operations_contract']['document']
        files[latest]=doc('오픈 전 보안·운영 변경 · 필수 개발 참조',opening_security_document_body(spec))
        for path in list(files):
            if path.endswith('.md') and path!=latest:
                relative=posixpath.relpath(latest,str(PurePosixPath(path).parent))
                note=('\n\n## 2026-10-14 오픈 전 최신 확정\n\n'
                      '유료 이용권 원본은 public.jeongsi_passes이며 관리자 접근 예외는 동일 검증 Bearer·본인 role=admin/status=active·aal2·요청 내부 origin이 모두 필요하다. 실제 만료 우선, 예외만 paid+null, 일반 paid 만료 누락503과 FE-ADMIN-ACCESS-01을 따른다. 관리 8경로의 검증 aal2·본인 active 상태·기존 학교 권한을 결합한다. '
                      '이 문서에 남은 과거 어댑터/명시 연결 전용 결정은 당시 이력이다. 현재 변경 범위와 검수 상태는 ['
                      '오픈 전 보안운영 변경]('+relative+')와 opening_security_operations_contract를 우선한다. API22/session3·자료 승인/보존 경계는 유지한다.\n\n')
                marker='\n\n<!-- jungsi:generated'
                files[path]=files[path].replace(marker,note+marker)
        for path in ('apps/web/route_catalog.json','src/jungsi_touch/application/route_catalog.json'):
            catalog=json.loads(files[path]);catalog['opening_security_operations_contract']=spec['opening_security_operations_contract']
            files[path]=json.dumps(catalog,ensure_ascii=False,indent=2)+'\n'
    if spec.get("edge_harness") is not None:
        for key in ("planning","routing","architecture","workflow"):
            target=spec["current_documents"][key]
            if target in files:files[target]=files[target]+edge_document_text(spec)
        files["docs/current/edge_contract.json"]=json.dumps(spec["edge_harness"],ensure_ascii=False,sort_keys=True,indent=2)+"\n"
    if spec.get("score_input_policy_contract"):
        reader=read or (lambda path:(ROOT/path).read_bytes())
        schemas=json.loads(reader("src/jungsi_touch/application/public_response_schemas.json"))
        policies=[{k:o[k] for k in ("id","method","path","member_tiers","report_owner","confirmed_score_profile","contract_ref")} for o in spec["operations"]]
        header="/** Generated public contract fixtures; no private data/config. Regenerate from service_spec and the closed schema registry. */\n"
        declarations='import type { ApiRoutePolicy } from "../../supabase/functions/_shared/jungsi/application/api_dispatch.ts";\n'
        def fixture(signature,value):
            text=json.dumps(value,ensure_ascii=False,separators=(',',':'))
            literal=chr(39)+text.replace(chr(92),chr(92)*2).replace(chr(39),chr(92)+chr(39)).replace(chr(0x2028),chr(92)+'u2028').replace(chr(0x2029),chr(92)+'u2029')+chr(39)
            return signature+" {\n  return JSON.parse(\n    "+literal+",\n  );\n}\n"
        files["tests/edge/public_api_contract_fixture.ts"]=(header+declarations+
            fixture('export function canonicalApiPolicies(): (ApiRoutePolicy & { readonly contract_ref: string })[]',policies)+
            fixture('export function canonicalPublicResponseSchemas(): unknown',schemas))
        structure=[{k:v for k,v in o.items() if k!="contract_ref"} for o in policies]
        files["tests/edge/synthetic_api_contract.ts"]=header+declarations+fixture('export function syntheticApiPolicies(): ApiRoutePolicy[]',structure)
    followup=spec.get("service_runtime_followup")
    if followup:
        section=("\n\n## 기존 운영 조회의 후속 검수\n\n"+followup["status"]+". "+followup["scope"]+" "+followup["new_policy_relation"]+" 복구 상태는 "+followup.get("recovery_verification_status","NOT_RUN")+"로 구분한다.\n")
        for key in ("planning","routing","architecture","workflow","supabase_deployment","development_sync"):
            target=spec["current_documents"].get(key)
            if target in files:files[target]+=section
    policy=spec.get("score_input_policy_contract")
    if policy:
        section=("\n\n## REQ-27 서비스 정책 후보\n\n"+policy["source_scope"]+"\n\n기존22 API와 신규3 API를 각각 검증한 현재 계약은 총25개다. session/v1은 기존3개 공개 필드를 유지한다. 신규 경로: "+", ".join(policy["extension_operation_ids"])+".\n\n"+policy["input_rights"]["atomic_boundary"]+" "+policy["input_rights"]["partial_success"]+"\n\n개인 일일 distinct_scores/calculation_cost는 단계별 최초1회+관리자 정정1회로 대체하며 빈도·공유 동시성·요청당 물리 비용/시간·반환량·저장소 보호를 유지한다. 미설정·legacy 미전환·미승인 단계는 fail closed다.\n\n첫 유료 결과는 해당 유료 작업의 공개 숫자 결과를 기준으로 생성 출처 이용권/현재 접근 이용권을 분리한다. 본인 read/export는 저장 원결과의 미전달 근거만 복구한다. 고정 가상 견본·단순 페이지 진입·통계·관리·전부 pending은 소비로 기록하지 않는다.\n\n런타임별 상태: "+policy["runtime_matrix"]["native_edge"]+" / "+policy["runtime_matrix"]["python_fastapi"]+". 006 상태: "+policy["actual_migration_status"]+". 공개 RPC·기존 프로필 전환·신규 scope/비용·정책 활성화·배포/실계정 검수: NOT_RUN. 기존003 승인은 새006의 실행 승인이 아니다.\n")
        for key in ("planning","routing","architecture","workflow","supabase_deployment"):
            target=spec["current_documents"].get(key)
            if target in files:files[target]+=section
        for path in list(files):
            if "개발현황_문서동기화" in path and isinstance(files[path],str):files[path]+=section
    performance=spec.get("service_performance_contract")
    if performance:
        cache=performance["cache"];proof=performance["verification"];batch=performance["batch_cr"];activation=performance["activation"]
        section=("\n\n## 서비스 성능 후보와 P1 조회 계약\n\n"+performance["id"]+" / "+performance["status"]+". SHA·길이·버전이 검증된 불변 본문만 worker 메모리에서 재사용한다. 최대16항목·원문4MiB·60초이며 파싱 트리의 추가 heap 비용이 있다. 현재 head·만료·registry/selection·버킷 비공개/상한·relay/JWT·현재 이용권/소유권·공유 원자 사용량은 매 요청 검사한다. 적중도 논리 요청/바이트를 차감하고 실제 GET/바이트를 별도 계수한다. 사용자 응답·권한·예산·진행 Promise는 저장하지 않는다. 동시 miss는 독립된 요청 한도/timeout으로 읽으며 공유 큐가 없다.\n\n첫 캐시 후보의 검증은 기존624+신규20=644 합성 회귀와 기존 oracle993이다. 오프라인 fake-fetch 계수는 실 지연/전체HTTP 인수를 증명하지 않는다. 실제 Auth/DB/Storage 및 배포는 "+proof["deployment"]+".\n\n"+batch["id"]+"는 "+batch["status"]+"다. "+batch["existing_option"]+" "+batch["year_mapping"]+" "+batch["proposed_extension"]+" "+batch["query"]+"\n\n재시도: "+performance["retry"]["client_rule"]+" 서버 대기는 별도 설계이며 현재 추가하지 않는다.\n\n배포 차이: "+activation["drop_in_032_compatibility"]+" "+activation["path"]+" 006a·기존 프로필 전환·usage/v2·신규3 scope·실제 반례·배포/활성화는 NOT_RUN이다.\n")
        for key in ("planning","routing","architecture","workflow","supabase_deployment","development_sync"):
            target=spec["current_documents"].get(key)
            if target in files:files[target]+=section
    scoped=spec.get("catalog_payload_scope_contract")
    if scoped:
        section=("\n\n## 카탈로그 전용 본문 선택 로딩 후속 후보\n\n"+scoped["id"]+" / "+scoped["status"]+". 별도 보존한 첫 캐시 후보7d53dda는 정상 훅/source·PR CI Python1125·Edge644·oracle993 PASS다. 현재 후속은 기존644+신규12=656 합성 회귀로 따로 검수한다.\n\n"+", ".join(scoped["operations"])+"만 catalog 본문을 읽는다. registry/selection의 전체선택 참조·승인·scope·형식·크기와 fresh 비공개 버킷의 전체선택 최대길이를 검사한다. policy exam의 선택참조 version/명시year도 일치시킨다. 실제 소비 catalog의 SHA·길이·버전·native decode는 그대로다. 사용하지 않은 exam/conversion 본문은 읽지도 검증했다고 기록하지도 않는다. 잘못된 참조 메타데이터는 이 분리로 통과시키지 않는다.\n\n미로딩 scoring 자료를 요구하면 runtime_dependency_not_loaded503이며 미선택 null/pending과 구분한다. 카탈로그 preflight는 catalog_payload_and_all_selected_reference_metadata만 검증했다고 기록한다. 나머지21 operation은 자료가 필요한 기존 경로에서 전체 선택 그래프 검사를 유지하고 health.ready도 전체 검사를 유지한다. JWT/현재권한/소유권/head·만료·공유 원자 예산·기존 작업 비용·반환량·읽기/시간 상한은 바꾸지 않는다. 캐시 적중은 해당 소비 본문의 cold 논리읽기 차감을 유지한다.\n\nSource 합성/오프라인 I/O 계수와 실제 응답시간 인수는 별도다. 새 API·운영 승인 확대·REQ27전환·032 drop-in·실제 DB/배포/활성화는 NOT_RUN이다.\n")
        for key in ("planning","routing","architecture","workflow","supabase_deployment","development_sync"):
            target=spec["current_documents"].get(key)
            if target in files:files[target]+=section
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
    errors=validate_sync_policy(spec) + validate_opening_security_operations(spec) + validate_score_input_policy(spec) + validate_service_performance(spec) + validate_catalog_payload_scope(spec)
    display=spec.get('official_history_db_display_contract')
    try: display_required=tuple(int(v) for v in spec.get('version','0.0.0').split('.')) >= (1,9,17)
    except (ValueError,TypeError): display_required=False
    if display is None and display_required:
        errors.append('Official history DB display purpose contract missing')
    if display is not None and not isinstance(display,dict):
        errors.append('Official history DB display purpose contract invalid')
        display=None
    if display is not None:
        scope=display.get('scope',{}); composition=display.get('composition',{})
        if not isinstance(scope,dict) or not isinstance(composition,dict):
            errors.append('Official history DB display purpose contract invalid')
            scope={}; composition={}
        if (display.get('format')!='jungsi.official-history-db-display/v1' or display.get('id')!='DEV-011' or
            display.get('branch')!='feature/application-pre-data-platform' or display.get('production_ready')is not False or
            set(display.get('operations',[]))!={'history.search','offerings.search','offering.read','recruitment.read','session.read'}):
            errors.append('Official history DB display purpose registration drift')
        if (scope.get('environment')!='restricted_cloud_review_only' or
            any(scope.get(k)is not True for k in ('explicit_server_selection_required','verified_review_subject_allowlist_required','immutable_descriptor_bytes_sha_required','exact_source_identity_type_PK_year_required','validity_and_revocation_required')) or
            any(scope.get(k)is not False for k in ('global_source_flags_changed','local_C_approval_is_cloud_approval','all_ingested_data_auto_adopted','engine_or_forecast_auto_adopted','actual_values_in_Git'))):
            errors.append('Official history DB display approval boundary drift')
        if (composition.get('default_factories_changed')is not True or composition.get('entitlement_authority')!='public.jeongsi_passes' or composition.get('opening_change_ref')!='opening_security_operations_contract' or
            composition.get('existing_API_count')!=22 or composition.get('new_logical_API_or_DTO')is not False or
            composition.get('browser_DB_credentials')is not False or composition.get('relay_header')!='X-Jungsi-Relay-Token'):
            errors.append('Official history DB display existing contract preservation drift')
        query=display.get('query_contract',{})
        if (not isinstance(query,dict) or
            any(query.get(k)is not True for k in ('parameterized_bulk_join','row_security_on','enforce_effective_RLS','reject_superuser_bypassrls_owner','verify_view_security_invoker_or_use_direct_RLS_relation','exact_selected_scope_only')) or
            type(query.get('data_queries_per_catalog'))is not int or query.get('data_queries_per_catalog')!=1 or query.get('row_by_row_query_allowed')is not False or
            query.get('automatic_unverified_fallback')is not False):
            errors.append('Official history DB display RLS or bulk query boundary drift')
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
        if row["id"] in ({"university.analyze","candidates.build","statistics.read","shortlist.update"} if spec.get("score_input_policy_contract") else {"university.analyze","candidates.build","report.export","statistics.read","shortlist.update"}) and row["member_tiers"]!=["paid"]:
            errors.append("Paid personal operation policy drift")
        unknown=set(re.findall(r"\{([^}]+)\}",row["path"]))-set(spec["routing_policy"]["template_placeholders"])
        if unknown:errors.append("Unregistered API parameter")
    contract=spec.get("overall_analysis_contract")
    if contract:
        operation=next((o for o in ops if o["id"]=="overall.analyze"),None)
        if not operation or operation["member_tiers"]!=(["paid"] if spec.get("score_input_policy_contract") else ["standard","paid"]) or operation["report_owner"] or operation["confirmed_score_profile"]:
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
    records=spec['workflow'].get('synchronized_work_items')
    expected_items={'docs/work_items/DEV-006-analysis-connection.json':'presentation_connection_contract',
                    'docs/work_items/DEV-007-forecast-policy.json':'forecast_policy_contract'}
    if 'secured_backend_preparation_contract' in spec:
        expected_items['docs/work_items/DEV-008-secured-backend-boundary.json']='secured_backend_preparation_contract'
    if 'runtime_connection_preparation_contract' in spec:
        expected_items['docs/work_items/DEV-009-runtime-connection-preparation.json']='runtime_connection_preparation_contract'
    if 'supabase_deployment_contract' in spec:
        expected_items['docs/work_items/DEV-010-supabase-platform-deployment.json']='supabase_deployment_contract'
    if display:
        expected_items['docs/work_items/DEV-011-official-history-db-display.json']='official_history_db_display_contract'
    if records is not None:
        if not isinstance(records,dict) or set(records)!=set(expected_items):
            errors.append('Synchronized work-item scope registration drift')
        else:
            for path,reference in expected_items.items():
                row=records[path]
                if not isinstance(row,dict) or row.get('contract_ref')!=reference or 'scope' in row or row.get('contract_version')!=spec['version']:
                    errors.append('Synchronized work-item contract reference drift: '+path)
    handoff=spec.get('contract_review',{}).get('handoff_response')
    if handoff is not None:
        if not isinstance(handoff,dict) or handoff.get('path')!='docs/team_sessions/2026-10-05/DEV006_서비스_DB_응답.md' or not isinstance(handoff.get('body'),str) or not handoff.get('body'):
            errors.append('DEV006 handoff source registration drift')
    session=[o for o in ops if o.get('id')=='session.read']
    if len(session)!=1 or session[0].get('method')!='GET' or session[0].get('path')!='/api/v1/me' or session[0].get('member_tiers')!=['standard','paid'] or session[0].get('report_owner') is not False or session[0].get('confirmed_score_profile') is not False:
        errors.append('Formal session access contract drift')
    if session:
        http=session[0].get('http_contract',{})
        dto=spec.get('backend_platform_contract',{}).get('dto_schemas',{}).get('session',{})
        if session[0].get('contract_ref')!='backend_platform_contract.dto_schemas.session' or http.get('response_schema')!='session' or http.get('body')!=[] or http.get('query')!=[] or http.get('idempotency_key_required') is not False or dto.get('format')!='jungsi.session/v1' or dto.get('fields')!=['format','member_tier','entitlement_expires_at']:
            errors.append('Formal session DTO contract drift')
    rules=' '.join(spec.get('backend_platform_contract',{}).get('dto_schemas',{}).get('session',{}).get('rules',[]))
    # Only the newly confirmed own-profile status clause is exempt from the
    # prohibition on inventing a status column for the passes authority.
    pass_rules=rules.replace('public.profiles.status=active','')
    if 'public.jeongsi_passes' not in rules or 'revoked_at IS NULL' not in rules or 'starts_at<=now<ends_at' not in rules or 'MAX(ends_at)' not in rules or 'status=active' in pass_rules:
        errors.append('Formal session entitlement rule drift')
    if 'session_contract' in spec:errors.append('Superseded proposed session contract must not be revived')
    errors.extend(validate_forecast_contract(spec))
    errors.extend(validate_local_verification_contract(spec))
    errors.extend(validate_security_contract(spec))
    errors.extend(validate_secured_preparation(spec))
    errors.extend(validate_runtime_connection_preparation(spec))
    errors.extend(validate_supabase_deployment_contract(spec))
    errors.extend(validate_live_execution(spec))
    errors.extend(validate_frontend_reply_contract(spec))
    errors.extend(validate_supabase_actual_update_contract(spec))
    errors.extend(validate_supabase_second_actual_update_contract(spec))
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

PUBLIC_RESPONSE_SCHEMA_PATH="src/jungsi_touch/application/public_response_schemas.json"


def validate_public_response_catalog(catalog,spec):
    """Check a static schema graph without importing implementation or private data."""
    errors=[]
    graph_error="DEV-008 public response schema type/reference graph invalid"
    if not isinstance(catalog,dict) or catalog.get("format")!="jungsi.public-response-schemas/v1":
        return ["DEV-008 public response schema registry invalid"]
    definitions=catalog.get("schemas")
    if not isinstance(definitions,dict) or not definitions or any(not isinstance(k,str) or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_.-]{0,127}",k) for k in definitions):
        return [graph_error]
    colors={}
    primitive={"string","integer","number","boolean","null"}
    def visit(node,depth=0):
        if not isinstance(node,dict) or depth>128:raise ValueError()
        if "nullable" in node and type(node["nullable"])is not bool:raise ValueError()
        if "ref" in node:
            if set(node)-{"ref","nullable","description"}:raise ValueError()
            name=node["ref"]
            if not isinstance(name,str) or name not in definitions or colors.get(name)==1:raise ValueError()
            if colors.get(name)!=2:
                colors[name]=1;visit(definitions[name],depth+1);colors[name]=2
            return
        kind=node.get("type")
        if kind in primitive:
            if "enum" in node:
                values=node["enum"]
                if not isinstance(values,list) or not values:raise ValueError()
                accepts={"string":lambda v:isinstance(v,str),"integer":lambda v:type(v)is int,
                         "number":lambda v:type(v)in (int,float),"boolean":lambda v:type(v)is bool,"null":lambda v:v is None}
                if any(not accepts[kind](v) for v in values):raise ValueError()
            return
        if kind=="enum":
            if not isinstance(node.get("values"),list) or not node["values"] or any(type(v)not in (str,int,float,bool,type(None)) for v in node["values"]):raise ValueError()
            return
        if kind=="object":
            properties=node.get("properties");required=node.get("required");optional=node.get("optional")
            if not isinstance(properties,dict) or not isinstance(required,list) or not isinstance(optional,list):raise ValueError()
            if any(not isinstance(k,str) for k in [*properties,*required,*optional]):raise ValueError()
            if len(required)!=len(set(required)) or len(optional)!=len(set(optional)) or set(required)&set(optional):raise ValueError()
            if set(required)|set(optional)!=set(properties) or node.get("additionalProperties") not in (None,False):raise ValueError()
            for child in properties.values():visit(child,depth+1)
            return
        if kind=="array":visit(node.get("items"),depth+1);return
        if kind=="map":visit(node.get("keys"),depth+1);visit(node.get("values"),depth+1);return
        if kind=="union":
            variants=node.get("variants",node.get("options"))
            if not isinstance(variants,list) or not variants:raise ValueError()
            for child in variants:visit(child,depth+1)
            return
        raise ValueError()
    try:
        for name in definitions:visit({"ref":name})
    except (ValueError,TypeError,RecursionError):errors.append(graph_error)
    if errors:return errors
    def properties(node):
        if "ref" in node:return properties(definitions[node["ref"]])
        if node["type"]=="union":
            result=set()
            for child in node.get("variants",node.get("options")):result.update(properties(child))
            return result
        if node["type"]!="object":raise ValueError()
        return set(node["properties"])
    operations=catalog.get("operations")
    if not isinstance(operations,list):return ["DEV-008 public response schema operation binding drift"]
    by_id={o["id"]:o for o in spec["operations"]};seen=set()
    for binding in operations:
        if not isinstance(binding,dict) or not isinstance(binding.get("id"),str) or binding["id"] not in by_id or binding["id"] in seen:
            errors.append("DEV-008 public response schema operation binding drift");continue
        seen.add(binding["id"]);operation=by_id[binding["id"]]
        if binding.get("contract_ref")!=operation.get("contract_ref"):
            errors.append("DEV-008 public response schema operation binding drift")
        roots=binding.get("roots")
        if not isinstance(roots,dict) or set(roots)!={"standard","paid"}:
            errors.append("DEV-008 public response schema operation binding drift");continue
        dto=spec["backend_platform_contract"]["dto_schemas"][operation["http_contract"]["response_schema"]]
        for role,root in roots.items():
            try:
                visit(root);actual=properties(root)
                expected=set(dto["fields"])|set(dto.get("optional_role_fields",{}).get(role,[]))|(set(dto.get("paid_fields",[])) if role=="paid" else set())
                if actual!=expected:errors.append("DEV-008 public response schema field boundary drift")
            except (ValueError,TypeError,KeyError,RecursionError):errors.append(graph_error)
    if seen!=set(by_id):errors.append("DEV-008 public response schema operation binding drift")
    auxiliary=catalog.get("auxiliary_roots")
    if not isinstance(auxiliary,dict) or set(auxiliary)!={"error","readiness"}:
        errors.append("DEV-008 public response auxiliary boundary drift")
    else:
        for name,root in auxiliary.items():
            try:
                visit(root)
                expected={"status","error","request_id"} if name=="error" else {"status","server_timezone","production_ready","security_boundary"}
                if properties(root)!=expected:errors.append("DEV-008 public response auxiliary boundary drift")
                if name=="error":
                    resolved=root
                    while "ref" in resolved:resolved=definitions[resolved["ref"]]
                    if properties(resolved["properties"]["error"])!={"code"}:errors.append("DEV-008 public response auxiliary boundary drift")
            except (ValueError,TypeError,KeyError,RecursionError):errors.append(graph_error)
    return sorted(set(errors))


def validate_public_response_registry(paths,read,spec):
    contract=spec.get("secured_backend_preparation_contract")
    if not contract:return []
    if PUBLIC_RESPONSE_SCHEMA_PATH not in paths:
        return [] if contract.get("code_status")=="planned" else ["DEV-008 public response schema registry missing"]
    def unique(pairs):
        result={}
        for key,value in pairs:
            if key in result:raise ValueError()
            result[key]=value
        return result
    try:catalog=json.loads(read(PUBLIC_RESPONSE_SCHEMA_PATH),object_pairs_hook=unique)
    except (ValueError,TypeError,RecursionError):return ["DEV-008 public response schema registry invalid"]
    return validate_public_response_catalog(catalog,spec)


def edge_registration_errors(paths,read,spec):
    """Structural preflight only; Deno parser and execution are required by the retained runner."""
    names=set(paths)
    from edge_source_scope import classify_sources,ScopeFailure
    try:scope=classify_sources(paths,read,spec)
    except ScopeFailure as error:return ["Edge suite scope: "+str(error)]
    edge={p for p in names if p=="supabase/functions/deno.json" or p.startswith(("supabase/functions/_shared/jungsi/","tests/edge/"))}
    ts=set(scope["foundation_ts"])
    c=spec.get("edge_harness")
    if not edge:
        return [] if c is None or c.get("state")=="prepared" else ["Active Edge registry has no sources"]
    if not isinstance(c,dict) or c.get("format")!="jungsi.edge-contract/v1" or c.get("state")!="required":
        return ["Edge sources require an activated common registry"]
    errors=[]
    if ts!=set(c.get("files",{})):errors.append("Edge registration coverage mismatch")
    for p,row in c.get("files",{}).items():
        if p not in names:errors.append("Registered Edge file absent: "+p);continue
        if row.get("layer") not in {"application","data_infrastructure","verification"}:errors.append("Unregistered Edge layer: "+p)
        if row.get("declarations",{}).get("source_sha256")!=hashlib.sha256(read(p)).hexdigest():errors.append("Edge source/declaration binding drift: "+p)
        if row.get("layer")!="verification":
            impl=next((r for r in spec["implementation"] if r["path"]==p),None)
            if not impl or impl["layer"]!=row["layer"] or set(impl["symbols"])!=set(row["symbols"]):errors.append("Edge implementation registry drift: "+p)
    required={c.get("config"),c.get("oracle"),*c.get("tests",[])}
    if None in required or not required<=names:errors.append("Edge suite/config/oracle reference absent")
    if any(p not in ts for p in c.get("tests",[])):errors.append("Edge test outside TS registry")
    if type(c.get("unit_count")) is not int or c["unit_count"]<=0 or type(c.get("oracle_count")) is not int or c["oracle_count"]<=0:errors.append("Edge expected test counts invalid")
    if c.get("runtime",{}).get("doc_json_version")!=2 or c.get("runtime",{}).get("info_json_version")!=1:errors.append("Edge parser schema unsupported")
    return errors

def edge_document_text(spec):
    c=spec.get("edge_harness")
    if c is None:return ""
    rows=[[p,r["layer"],", ".join(r.get("symbols",[]))] for p,r in c["files"].items()]
    return ("\n\n## DEV-010 foundation TypeScript 등록과 검산\n\n"+
      "상태: "+c["state"]+". domain은 애플리케이션 내부 계산 라이브러리다. TS 선언·기본값·반환형·import graph는 고정 snapshot에서 Deno doc/info로 대조한다.\n\n"+
      table(["파일","계층","등록 심볼"],rows)+
      "\n\n같은 Git snapshot에서 기존 Python 전체 검산 다음에 Deno check/lint/fmt·"+
      str(c["unit_count"])+" 단위검산·Python–Deno "+str(c["oracle_count"])+" 합성 대조를 실행한다. 로컬 훅은 명시한 Deno 경로를 사용한다. CI는 edge-runtime.lock.json의 공식 Deno "+c["runtime"]["deno"]+" 배포 파일을 scripts/bootstrap_edge_runtime.py로 새 보존 폴더에 공급하고 아카이브 해시·크기·실행 버전을 검증한다. 기존 폴더 덮어쓰기·삭제·시스템 설치·최신 버전 대체는 없다. 미설치·비호환·파서 실패·결과 누락은 실패이고 skip 성공은 없다. foundation 소스가 없는 공통 준비 단계는 NOT_APPLICABLE_NO_FOUNDATION_SOURCE이며 실행 검산 완료가 아니다. 실행기 공급 영수증도 서비스 단위검산·oracle 통과를 대신하지 않는다. 기존 공개 Edge 소스는 현재 문서 동기화 색인으로 결속하며 foundation 선언·graph·단위검산·oracle 결과에 포함하지 않는다.")

def validate_content(paths,read,spec):
    errors=validate_spec(spec)
    migration=spec.get("score_input_policy_contract",{})
    if migration.get("actual_migration_status")=="APPLIED_EMPTY_SCHEMA_NOT_ACTIVATED":
        evidence=migration.get("migration_evidence",{});sql_path=evidence.get("sql_path")
        if sql_path not in paths or hashlib.sha256(read(sql_path)).hexdigest()!=evidence.get("sql_sha256"):errors.append("REQ-27 applied SQL bytes differ from exact native schema receipt")
    errors.extend(edge_registration_errors(paths,read,spec))
    names=set(paths)
    errors.extend(validate_catalog(paths,read,spec))
    errors.extend(validate_public_response_registry(names,read,spec))
    transition=spec.get('supabase_operations_handoff_contract',{}).get('service_transition_contract',{})
    if transition.get('implementation_mode')=='explicit_prepared_default_unchanged':
        for path in transition.get('implementation_code_paths',[]):
            if path not in names:errors.append('Explicit prepared implementation reference absent from selected snapshot: '+path)
    for path,expected in generated_files(spec,read=read).items():
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
    if spec.get('workflow',{}).get('documentation_sync') and ("AGENTS.md" not in names or AGENT_MARKER not in read("AGENTS.md")):
        errors.append("AGENTS missing mandatory documentation synchronization")
    if ("AGENTS.md" not in names or b"<!-- jungsi:security-required -->" not in read("AGENTS.md") or
        SECURITY_DOCUMENT.encode("utf-8") not in read("AGENTS.md")):
        errors.append("AGENTS missing mandatory security reference")
    for path in ("README.md",".github/pull_request_template.md"):
        if path not in names or SECURITY_DOCUMENT.encode("utf-8") not in read(path):
            errors.append("Mandatory security entry point absent: "+path)
    harness=spec.get("workflow",{}).get("development_harness",{})
    for path in harness.get("required_documents",[]):
        if path not in names:errors.append("Mandatory development reference absent: "+path)
    return sorted(set(errors))

def validate_changed_paths(changed,spec):
    watched=("src/","apps/","database/","supabase/functions/",".github/workflows/",".githooks/","tests/")
    code_changed=any(p.startswith(watched) and not p.endswith(".md") for p in changed)
    code_changed=code_changed or bool(set(changed)&set(spec["workflow"]["shared_tools"]))
    required={SPEC_PATH,spec["current_documents"]["planning"],spec["current_documents"]["routing"]}
    if spec.get('workflow',{}).get('documentation_sync'):
        required.update(spec['current_documents'][k] for k in ('architecture','workflow','development_sync'))
    if code_changed and not required<=set(changed):
        return ["Code changed without matching specification planning and routing in the same commit"]
    return []

def snapshot_changed_paths(snapshot):
    """Compare the immutable selected result with every fixed merge parent."""
    oid_pattern=r"(?:[0-9a-f]{40}|[0-9a-f]{64})"
    def commit_oid(raw):
        value=raw.decode("ascii").strip()
        if not re.fullmatch(oid_pattern,value):raise ValueError("Invalid snapshot parent commit.")
        return value
    def parse_entries(raw,*,index):
        entries={}
        for row in raw.split(b"\0"):
            if not row:continue
            info,name=row.split(b"\t",1);fields=info.decode("ascii").split()
            if len(fields)!=3:raise ValueError("Invalid snapshot tree metadata.")
            mode,second,third=fields
            if index:
                oid=second
                if third!="0":raise ValueError("Resolve the index conflict before validation.")
            else:
                oid=third
                if second not in {"blob","commit"}:raise ValueError("Invalid snapshot tree metadata.")
            path=name.decode("utf-8")
            if not re.fullmatch(r"[0-7]{6}",mode) or not re.fullmatch(oid_pattern,oid) or not path or path in entries:
                raise ValueError("Invalid snapshot tree metadata.")
            entries[path]=(mode,oid)
        return entries
    if snapshot.staged:
        captured=getattr(snapshot,"entries",None)
        if not isinstance(captured,dict):raise ValueError("Staged snapshot entries are required.")
        captured=dict(captured)
        def assert_same_index():
            if parse_entries(git("ls-files","--stage","-z"),index=True)!=captured:
                raise ValueError("Index changed after the selected snapshot was captured.")
        def head_commit():
            try:return commit_oid(git("rev-parse","--verify","HEAD^{commit}"))
            except subprocess.CalledProcessError as failure:
                # Preserve ordinary initial staging only for a proven unborn branch.
                ref=git("symbolic-ref","--quiet","HEAD").decode("utf-8").strip()
                if not ref.startswith("refs/heads/"):raise failure
                try:git("show-ref","--verify","--quiet",ref)
                except subprocess.CalledProcessError as missing:
                    if missing.returncode==1:return None
                    raise
                raise failure
        merge_file=Path(git("rev-parse","--git-path","MERGE_HEAD").decode("utf-8").strip())
        if not merge_file.is_absolute():merge_file=ROOT/merge_file
        def merge_state():
            if merge_file.is_symlink():raise ValueError("Unexpected symbolic MERGE_HEAD.")
            try:return merge_file.read_bytes()
            except FileNotFoundError:return None
        assert_same_index()
        head=head_commit();merge_raw=merge_state();parents=[] if head is None else [head]
        if merge_raw is not None:
            heads=merge_raw.splitlines()
            if head is None or len(heads)!=1 or not re.fullmatch(oid_pattern.encode(),heads[0]):
                raise ValueError("Expected one fixed MERGE_HEAD commit.")
            merge=commit_oid(git("rev-parse","--verify",heads[0].decode("ascii")+"^{commit}"))
            if merge!=heads[0].decode("ascii") or merge==head:
                raise ValueError("Invalid staged merge parent.")
            parents.append(merge)
        changed=set(captured) if not parents else set()
        for parent in parents:
            entries=parse_entries(git("ls-tree","-r","-z",parent),index=False)
            changed.update(path for path in set(captured)|set(entries) if captured.get(path)!=entries.get(path))
        def assert_same_context():
            assert_same_index()
            if merge_state()!=merge_raw or head_commit()!=head:
                raise ValueError("Merge state changed while validating the index.")
        assert_same_context()
        snapshot._baseline_parent_commits=tuple(parents)
        snapshot._assert_baseline_context=assert_same_context
        return sorted(changed)
    elif snapshot.revision:
        revision=commit_oid(snapshot.revision.encode("ascii"))
        headers,separator,_=git("cat-file","commit",revision).partition(b"\n\n")
        rows=headers.splitlines();trees=[row for row in rows if row.startswith(b"tree ")]
        parent_rows=[row for row in rows if row.startswith(b"parent")]
        if not separator or len(trees)!=1 or not re.fullmatch(b"tree "+oid_pattern.encode(),trees[0]):
            raise ValueError("Invalid commit parent metadata.")
        if any(not re.fullmatch(b"parent "+oid_pattern.encode(),row) for row in parent_rows):
            raise ValueError("Invalid commit parent metadata.")
        parents=[row[7:].decode("ascii") for row in parent_rows]
        if not parents or len(set(parents))!=len(parents) or revision in parents:
            raise ValueError("Unsupported root commit or invalid commit parent metadata.")
        raw=b"".join(git("diff",parent,revision,"--name-only","-z","--") for parent in parents)
    else:
        return []
    return sorted({p.decode("utf-8") for p in raw.split(bytes([0])) if p})


def validate_snapshot_baseline(snapshot,baseline):
    """Validate ancestry of the selected result using its fixed parent context."""
    oid_pattern=r"(?:[0-9a-f]{40}|[0-9a-f]{64})"
    if not isinstance(baseline,str) or not re.fullmatch(oid_pattern,baseline):
        raise ValueError("Invalid development baseline commit.")
    resolved=git("rev-parse","--verify",baseline+"^{commit}").decode("ascii").strip()
    if resolved!=baseline:
        raise ValueError("Development baseline must identify the exact commit.")
    context=None
    if snapshot.staged:
        parents=getattr(snapshot,"_baseline_parent_commits",None)
        context=getattr(snapshot,"_assert_baseline_context",None)
        if not isinstance(parents,tuple) or not callable(context):
            raise ValueError("Fixed staged parent context is required for baseline validation.")
        context()
    else:
        selected=snapshot.revision or git("rev-parse","--verify","HEAD^{commit}").decode("ascii").strip()
        parents=(selected,)
    if any(not isinstance(parent,str) or not re.fullmatch(oid_pattern,parent) for parent in parents):
        raise ValueError("Invalid selected baseline parent commit.")
    accepted=False
    for parent in parents:
        result=subprocess.run(["git","merge-base","--is-ancestor",baseline,parent],cwd=ROOT,capture_output=True)
        if result.returncode not in (0,1):
            raise ValueError("Development baseline ancestry query failed.")
        accepted=accepted or result.returncode==0
    if context is not None:context()
    return [] if accepted else ["Development baseline is not an ancestor of the selected commit"]


def write_generated(spec):
    timestamp=datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup=ROOT/"outputs/document_sync"/timestamp
    for name,content in generated_files(spec,read=snapshot.read).items():
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
    errors.extend(validate_snapshot_baseline(snapshot,spec["baseline_commit"]))
    report=dict(checked_files=len(snapshot.paths),pages=len(spec["pages"]),operations=len(spec["operations"]),requirements=len(spec["requirements"]),
                generated_files=len(generated_files(spec)),snapshot=snapshot.revision or ("index" if args.staged else "working_tree"),passed=not errors,errors=errors)
    print(json.dumps(report,ensure_ascii=False,indent=2))
    return 1 if errors else 0

if __name__=="__main__":
    try:raise SystemExit(main())
    except (ValueError,KeyError,OSError,subprocess.CalledProcessError) as error:
        print("Project consistency check failed: "+str(error),file=sys.stderr)
        raise SystemExit(1)
