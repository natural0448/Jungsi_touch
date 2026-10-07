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
    if len(spec['operations'])!=22:errors.append('Local verification 22 API boundary drift')
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
                 "security_policy_unavailable":(503,False)}
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
           "현재 등록은 기획과 계약 하네스의 기준이며 런타임 보안 구현·운영 인수가 아니다. "+
           f"전체 구현 상태 {c['implementation_status']} / production_ready={str(c['production_ready']).lower()}. "+
           "기존 인증·소유권·이용권 코드가 존재해도 아래 추가 통제를 구현·검수하기 전 완료로 처리하지 않는다.\n\n")
    risks=table(["외부 반출 경로","필수 대응","인수 기준"],[
        ["화면 전달물에서 내부 자료를 얻음","SEC-01·02: 역할별 필드 허용목록과 브라우저 전달물 검사",
         "정상/pending/오류/재응답/인쇄·JS/HTML/RSC 등에 전체 곡선·환산표·비밀이 없음"],
        ["화면을 거치지 않고 API 직접 호출","SEC-03·04: 서버 중계 신원과 실제 사용자 권한을 각각 확인",
         "서버 신원 누락·타인·무료 유료기능·만료·scope 밖 결과 거절"],
        ["정상 계정으로 점수·결과를 반복 수집","SEC-05·06·07: 원자적 공유 예산과 계산/반환량·탐지",
         "무료 누백까지 적용; ID/JWT/worker/재시작 교체로 예산 초기화 불가"],
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
        "검수 상태 "+v["status"]+". 합성 인수: "+"; ".join(v["cases"])+".\n\n"+
        "남은 인수: "+"; ".join(c["remaining"])+". 전체 SEC-01~08/3 보안 gate와 실운영 준비는 미완료로 유지한다.")


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
        p.get("legacy_factories")!=["create_app","configured_app"] or p.get("default_factories_unchanged") is not True or
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
    runtime_intro=('FastAPI '+str(len(spec['operations']))+'개 경로와 업무 서비스·Supabase/Drive 어댑터를 구현했다. 코드 합성 검증과 실제 운영 연결은 구분한다. [API DTO 계약](API_DTO_계약.md)과 [백엔드 운영 준비](백엔드_운영준비.md)를 함께 읽는다.' if platform else '아래 API는 연결 예정 계약이며 HTTP 핸들러가 등록된 상태가 아니다.')
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
    for path,metadata in spec['workflow'].get('synchronized_work_items',{}).items():
        item=dict(metadata)
        item['scope']=spec[item['contract_ref']]
        files[path]=json.dumps(item,ensure_ascii=False,indent=2)+'\n'
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
    records=spec['workflow'].get('synchronized_work_items')
    expected_items={'docs/work_items/DEV-006-analysis-connection.json':'presentation_connection_contract',
                    'docs/work_items/DEV-007-forecast-policy.json':'forecast_policy_contract'}
    if 'secured_backend_preparation_contract' in spec:
        expected_items['docs/work_items/DEV-008-secured-backend-boundary.json']='secured_backend_preparation_contract'
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
    if 'jungsi_backend.entitlements' not in rules or 'active=true' not in rules or 'starts_at<=now<expires_at' not in rules or 'status=active' in rules:
        errors.append('Formal session entitlement rule drift')
    if 'session_contract' in spec:errors.append('Superseded proposed session contract must not be revived')
    errors.extend(validate_forecast_contract(spec))
    errors.extend(validate_local_verification_contract(spec))
    errors.extend(validate_security_contract(spec))
    errors.extend(validate_secured_preparation(spec))
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
                expected=set(dto["fields"])|(set(dto.get("paid_fields",[])) if role=="paid" else set())
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


def validate_content(paths,read,spec):
    errors=validate_spec(spec)
    names=set(paths)
    errors.extend(validate_public_response_registry(names,read,spec))
    transition=spec.get('supabase_operations_handoff_contract',{}).get('service_transition_contract',{})
    if transition.get('implementation_mode')=='explicit_prepared_default_unchanged':
        for path in transition.get('implementation_code_paths',[]):
            if path not in names:errors.append('Explicit prepared implementation reference absent from selected snapshot: '+path)
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
    watched=("src/","apps/","database/",".github/workflows/",".githooks/","tests/")
    code_changed=any(p.startswith(watched) and not p.endswith(".md") for p in changed)
    code_changed=code_changed or bool(set(changed)&set(spec["workflow"]["shared_tools"]))
    required={SPEC_PATH,spec["current_documents"]["planning"],spec["current_documents"]["routing"]}
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
        assert_same_index()
        if merge_state()!=merge_raw or head_commit()!=head:
            raise ValueError("Merge state changed while validating the index.")
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
