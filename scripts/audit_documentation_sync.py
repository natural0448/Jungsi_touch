"""Synchronize the public code index and audit a fixed Git delta. No cleanup."""
from __future__ import annotations

import argparse
import ast
import copy
import datetime
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

FORMAT = "jungsi.documentation-code-index/v1"
PARSER = "python-ast-signatures/v1"
SYNC_DOCUMENT = "docs/current/개발현황_문서동기화.md"
INDEX_DOCUMENT = "docs/current/code_routing_index.json"
AGENT_MARKER = b"<!-- jungsi:documentation-sync-required -->"
EDGE_SOURCE_PREFIX = "supabase/functions/"
EDGE_INDEX_FORMAT = "jungsi.typescript-source-hash-index/v1"


def edge_source_index(paths, read, spec):
    """Bind complete Edge bytes; this does not claim TypeScript parsing/testing."""
    rows = []
    for path in sorted(p for p in paths if p.startswith(EDGE_SOURCE_PREFIX) and p.endswith(".ts")):
        row = next((x for x in spec["implementation"] if x["path"] == path), None)
        if row is None:
            raise ValueError("Unregistered public Edge source: " + path)
        rows.append({**reference_metadata(path, spec), "source_sha256": source_digest(read(path)),
                     "declared_exports": list(row.get("symbols", []))})
    return {"format": EDGE_INDEX_FORMAT, "verification": "whole_source_hash_not_type_or_runtime_proof", "files": rows}


def validate_edge_index(paths, read, spec):
    current = spec.get("workflow", {}).get("documentation_sync", {}).get("code_index", {}).get("edge_sources")
    relevant = any(p.startswith(EDGE_SOURCE_PREFIX) and p.endswith(".ts") for p in paths)
    if current is None and not relevant:
        return []
    try:
        expected = edge_source_index(paths, read, spec)
    except (ValueError, UnicodeError, KeyError):
        return ["Public Edge source registration or encoding invalid"]
    return [] if current == expected else ["Public Edge whole source index drift"]


def normalized_source(raw: bytes) -> bytes:
    return raw.decode("utf-8-sig").replace("\r\n", "\n").encode("utf-8")


def source_digest(raw: bytes) -> str:
    return hashlib.sha256(normalized_source(raw)).hexdigest()


def source_paths(paths, spec):
    tools = set(spec["workflow"]["shared_tools"])
    return sorted(p for p in paths if p.endswith(".py") and (p.startswith("src/jungsi_touch/") or p in tools))


def extract_signatures(raw: bytes, filename: str):
    tree = ast.parse(normalized_source(raw).decode("utf-8"), filename=filename)
    symbols = []

    class Visitor(ast.NodeVisitor):
        def __init__(self):
            self.parents = []

        def visit_ClassDef(self, node):
            bases = [ast.unparse(x) for x in node.bases]
            bases += [(x.arg + "=" if x.arg else "**") + ast.unparse(x.value) for x in node.keywords]
            symbols.append({"kind": "class", "name": ".".join([*self.parents, node.name]),
                            "signature": "class " + node.name + ("(" + ", ".join(bases) + ")" if bases else "") + ":",
                            "decorators": [ast.unparse(x) for x in node.decorator_list]})
            self.parents.append(node.name)
            self.generic_visit(node)
            self.parents.pop()

        def visit_FunctionDef(self, node):
            self.function(node, False)

        def visit_AsyncFunctionDef(self, node):
            self.function(node, True)

        def function(self, node, asynchronous):
            result = ("async def " if asynchronous else "def ") + node.name + "(" + ast.unparse(node.args) + ")"
            if node.returns is not None:
                result += " -> " + ast.unparse(node.returns)
            symbols.append({"kind": "async_function" if asynchronous else "function",
                            "name": ".".join([*self.parents, node.name]), "signature": result + ":",
                            "decorators": [ast.unparse(x) for x in node.decorator_list]})
            self.parents.append(node.name)
            self.generic_visit(node)
            self.parents.pop()

    Visitor().visit(tree)
    return sorted(symbols, key=lambda x: (x["name"], x["kind"], x["signature"]))


def reference_metadata(path, spec):
    registration = next((x for x in spec["implementation"] if x["path"] == path), None)
    if registration:
        layer = registration["layer"]
        status = registration["status"]
        requirements = registration["requirements"]
    elif path in spec["workflow"]["shared_tools"]:
        layer, status, requirements = "planning_tool", "shared_management_or_synthetic_CLI", []
    else:
        layer = "data_infrastructure" if path.startswith("src/jungsi_touch/infrastructure/") else "application"
        status, requirements = "support_module_no_direct_operation_registration", []
    return {"path": path, "layer": layer, "status": status, "requirements": requirements}


def refresh_catalog(paths, read, spec):
    """Hash the inventory; parse only new/changed source or an invalidated parser."""
    policy = spec["workflow"]["documentation_sync"]
    old = policy.get("code_index", {})
    reusable = old.get("format") == FORMAT and old.get("parser") == PARSER
    rows = old.get("files", [])
    if not isinstance(rows, list) or not all(isinstance(x, dict) and isinstance(x.get("path"), str) for x in rows):
        reusable = False
    previous = {x["path"]: x for x in rows} if reusable else {}
    if len(previous) != len(rows):
        previous = {}
    rows, parsed, reused = [], [], []
    for path in source_paths(paths, spec):
        raw = read(path)
        digest = source_digest(raw)
        metadata = reference_metadata(path, spec)
        cached = previous.get(path)
        if cached and cached.get("source_sha256") == digest and isinstance(cached.get("symbols"), list):
            symbols = copy.deepcopy(cached["symbols"])
            reused.append(path)
        else:
            symbols = extract_signatures(raw, path)
            parsed.append(path)
        rows.append({**metadata, "source_sha256": digest, "symbols": symbols})
    return {"format": FORMAT, "parser": PARSER, "source_hash_policy": "UTF8_BOM_REMOVED_CRLF_TO_LF",
            "files": rows, "edge_sources": edge_source_index(paths, read, spec)}, {"parsed_files": parsed, "reused_files": reused}


def validate_catalog(paths, read, spec):
    """The mandatory snapshot gate independently verifies every indexed signature."""
    policy = spec.get("workflow", {}).get("documentation_sync")
    if not policy:
        return []
    if not isinstance(policy, dict):
        return ["Documentation synchronization policy invalid"]
    index = policy.get("code_index", {})
    if not isinstance(index, dict):
        return ["Documentation code index invalid"]
    if index.get("format") != FORMAT or index.get("parser") != PARSER:
        return ["Documentation code index parser/format missing"]
    rows = index.get("files", [])
    if not isinstance(rows, list) or not all(isinstance(x, dict) and isinstance(x.get("path"), str) for x in rows):
        return ["Documentation code index entries invalid"]
    by_path = {x["path"]: x for x in rows}
    expected = source_paths(paths, spec)
    errors = []
    if len(by_path) != len(rows) or sorted(by_path) != expected:
        errors.append("Documentation code index coverage drift")
    for path in expected:
        item = by_path.get(path)
        if item is None:
            continue
        try:
            actual = {**reference_metadata(path, spec), "source_sha256": source_digest(read(path)),
                      "symbols": extract_signatures(read(path), path)}
        except (SyntaxError, UnicodeError, ValueError):
            errors.append("Documentation code index parse failure: " + path)
            continue
        if item != actual:
            errors.append("Documentation code index drift: " + path)
    return sorted(set(errors + validate_edge_index(paths, read, spec)))


def validate_sync_policy(spec):
    policy = spec.get("workflow", {}).get("documentation_sync")
    if policy is None:  # Historical committed specifications retain their original gate.
        version = str(spec.get("version", "")).split(".")
        if len(version) == 3 and all(x.isdigit() for x in version) and tuple(map(int, version)) >= (1, 9, 15):
            return ["Documentation synchronization policy missing"]
        return []
    if not isinstance(policy, dict):
        return ["Documentation synchronization policy invalid"]
    errors = []
    if policy.get("format") != "jungsi.documentation-sync-policy/v1":
        errors.append("Documentation synchronization policy format drift")
    for key in ("required", "delta_first", "same_snapshot_required", "mandatory_gates_unchanged", "preserve_previous_results"):
        if policy.get(key) is not True:
            errors.append("Documentation synchronization mandatory rule drift: " + key)
    documents = spec.get("current_documents", {})
    if documents.get("development_sync") != SYNC_DOCUMENT or policy.get("index_document") != INDEX_DOCUMENT:
        errors.append("Documentation synchronization document registration drift")
    if not re.fullmatch(r"[0-9a-f]{40}", policy.get("initial_verified_commit", "")):
        errors.append("Documentation synchronization fixed baseline missing")
    if policy.get("source_scope") != "tracked_public_python_and_explicit_shared_tools":
        errors.append("Documentation synchronization source scope drift")
    if "scripts/audit_documentation_sync.py" not in spec["workflow"]["shared_tools"]:
        errors.append("Documentation synchronization shared tool missing")
    index = policy.get("code_index", {})
    if not isinstance(index, dict) or index.get("format") != FORMAT or index.get("parser") != PARSER:
        errors.append("Documentation code index parser/format missing")
    return errors


def generated_sync_files(spec, doc, table):
    policy = spec.get("workflow", {}).get("documentation_sync")
    if not policy:
        return {}
    rows = policy.get("code_index", {}).get("files", [])
    operations = [[o["id"], o["method"] + " " + o["path"], ", ".join(o["requirements"]),
                   "/".join(o["member_tiers"]), "본인" if o["report_owner"] else "해당 없음",
                   o.get("application_service", "미등록"), o.get("http_adapter", "미등록"),
                   o.get("implementation_status", "미등록")] for o in spec["operations"]]
    modules = [[r["path"], r["layer"], ", ".join(r["requirements"]) or "독립 업무 경로 미등록",
                r["status"], len(r["symbols"]), r["source_sha256"]] for r in rows]
    body = ("작업 시작점은 develop의 공통 명세, 이 현황표, [코드 색인](code_routing_index.json), 최신 검증 커밋이다. "
            "기획·라우팅·계층·브랜치 운영 문서는 같은 명세에서 생성한다.\n\n"
            "## 현재 개발 기준과 진행 상태\n\n최초 검증 기준 " + policy["initial_verified_commit"] + ". "
            "이후에는 정확한 SHA의 훅·CI와 검사 영수증이 통과한 최신 커밋을 다음 작업의 기준으로 사용한다. "
            "이 문서 안에 아직 생성되지 않은 자신의 커밋 SHA를 기록하지 않는다.\n\n" +
            table(["담당/범위", "참조", "상태", "해석과 다음 조건"], policy["development_state"]) +
            "\n\n## 모든 에이전트의 필수 동기화 순서\n\n" +
            "\n".join(str(i) + ". " + rule for i, rule in enumerate(policy["agent_steps"], 1)) +
            "\n\n## 명령과 검사 범위\n\n```text\npython -B scripts/audit_documentation_sync.py --sync\n"
            "python -B scripts/audit_documentation_sync.py --base <verified-commit>\n"
            "# 검토한 파일만 명시해 stage한 뒤 동일 index를 검사\n"
            "python -B scripts/audit_documentation_sync.py --staged --base <verified-commit>\n"
            "python -B scripts/check_project_consistency.py --staged\n```\n\n"
            "--sync는 해시가 바뀐 코드의 AST를 갱신하고 이전 명세·문서를 outputs에 보존한다. "
            "변경이 없는 코드의 시그니처는 재사용한다. --base는 한 번 고정한 커밋과 변경 소스·색인·짝 문서를 대조한다. "
            "코드 본문만 바뀌어도 해시를 갱신하며 새 파일·삭제·파싱 실패·문서 변조를 통과시키지 않는다. "
            "기존 커밋에 색인이 없으면 최초 색인 검증을 한 번 수행한다. 이후 색인이 있는 검증 커밋을 기준으로 변경 범위를 좁힌다.\n\n"
            "필수 훅·CI는 같은 Git 스냅샷 전체의 비공개 파일·계층·권한·생성 문서·시그니처 정합성을 독립 검사한다. "
            "이 자동 검사는 계속 실행한다. 에이전트가 전체 코드를 다시 읽거나 이미 검수한 원자료를 재수집하는 작업은 기본 절차가 아니다.\n\n"
            "## 범위를 넓히는 조건\n\n" + "\n".join("- " + rule for rule in policy["expand_only_when"]) +
            "\n\n넓힌 사유·파일 범위·재사용 근거를 검사 영수증에 기록한다. 원문 모집표 전수 검수, 코드 정합성, 운영 발행·브라우저 인수는 서로 다른 검증이다.\n\n"
            "## 화면/API와 구현 연결\n\n" +
            table(["작업 ID", "경로", "요구사항", "회원", "소유권", "업무 진입점", "HTTP 진입점", "코드 상태"], operations) +
            "\n\n## 공개 Python 코드 색인\n\n" +
            "함수·클래스·메서드의 전체 경로, 기본값·타입·반환·데코레이터·상속은 구조화 색인에 보존한다. "
            "보조 모듈은 업무 경로 등록과 구분하며 업무 완료를 새로 주장하지 않는다. planning_tool은 공통 검사/합성 CLI 분류로서 서비스의 추가 계층이 아니다. "
            "비공개 데이터와 작업 스크립트, 테스트의 합성 값은 이 업무 코드 색인에 넣지 않는다.\n\n" +
            table(["파일", "담당 계층", "요구사항", "등록 상태", "선언 수", "LF 정규화 SHA-256"], modules))
    edge = policy.get("code_index", {}).get("edge_sources", {}).get("files", [])
    if edge:
        body += ("\n\n## 공개 Edge TypeScript 소스 결속\n\n"
                 "등록된 함수·공유 의존·검수 소스의 전체 본문 해시와 담당 계층/선언 export를 같은 스냅샷에 결속한다. "
                 "이 색인은 TypeScript 문법·타입·런타임 검증을 주장하지 않는다. Deno check/test의 정확한 후보 증거를 별도로 기록한다. "
                 "기존 Python AST·필수 보안·브랜치 검사는 유지한다.\n\n" +
                 table(["파일", "담당 계층", "요구사항", "등록 상태", "등록 export", "LF 정규화 SHA-256"],
                       [[r["path"], r["layer"], ", ".join(r["requirements"]), r["status"],
                         ", ".join(r["declared_exports"]), r["source_sha256"]] for r in edge]))
    return {SYNC_DOCUMENT: doc("현재 개발현황과 기획·라우팅 문서 동기화", body),
            INDEX_DOCUMENT: json.dumps(policy["code_index"], ensure_ascii=False, indent=2) + "\n"}


def delta_audit(paths, read, spec, base_paths, base_read, base_spec=None):
    """Detailed AST review is confined to changed indexed source; gates stay separate."""
    policy = spec["workflow"]["documentation_sync"]
    entries = {x["path"]: x for x in policy["code_index"]["files"]}
    current = set(source_paths(paths, spec))
    base = set(source_paths(base_paths, base_spec or spec))
    changed = sorted(p for p in current | base if p not in current or p not in base or normalized_source(read(p)) != normalized_source(base_read(p)))
    observations, errors = [], validate_sync_policy(spec) + validate_edge_index(paths, read, spec)
    if len(entries) != len(policy["code_index"]["files"]) or set(entries) != current:
        errors.append("Documentation code index coverage drift")
    old_index = (base_spec or {}).get("workflow", {}).get("documentation_sync", {}).get("code_index", {})
    prior = {x["path"]: x for x in old_index.get("files", [])}
    initialized = old_index.get("format") == FORMAT and old_index.get("parser") == PARSER
    index_changed = {p for p in current if not initialized or prior.get(p) != entries.get(p)}
    # Check record-only tampering without re-parsing unrelated, verified rows.
    checked = {}
    for path in sorted(current):
        row = entries.get(path)
        metadata = reference_metadata(path, spec)
        if not row or set(row) != set(metadata) | {"source_sha256", "symbols"} or any(row.get(k) != v for k, v in metadata.items()) or row.get("source_sha256") != source_digest(read(path)):
            errors.append("Documentation code index drift: " + path)
        if path in index_changed or path in changed:
            try:
                checked[path] = extract_signatures(read(path), path)
                if not row or row.get("symbols") != checked[path]:
                    errors.append("Documentation code index signature drift: " + path)
            except (SyntaxError, UnicodeError, ValueError):
                errors.append("Documentation code index parse failure: " + path)
    for path in changed:
        if path not in current:
            errors.append("Deleted source requires explicit user authorization: " + path)
            observations.append({"path": path, "state": "removed_preserve_prior_evidence"})
            continue
        try:
            symbols = checked[path] if path in checked else extract_signatures(read(path), path)
            old = extract_signatures(base_read(path), path) if path in base else []
            expected = {**reference_metadata(path, spec), "source_sha256": source_digest(read(path)), "symbols": symbols}
            if entries.get(path) != expected:
                errors.append("Changed source is not synchronized: " + path)
            observations.append({"path": path, "state": "modified" if path in base else "added",
                                 "signature_changed": old != symbols, "symbols": symbols,
                                 "linked_requirements": expected["requirements"]})
        except (SyntaxError, UnicodeError, ValueError):
            errors.append("Changed source parse failure: " + path)
    required = [spec["current_documents"][k] for k in ("planning", "routing", "architecture", "workflow", "development_sync")]
    from check_project_consistency import generated_files
    for path, expected in generated_files(spec).items():
        if path not in paths or read(path) != expected:
            errors.append("Document or route drift: " + path)
    if "AGENTS.md" not in paths or AGENT_MARKER not in read("AGENTS.md"):
        errors.append("AGENTS missing mandatory documentation synchronization")
    edge_current = {p for p in paths if p.startswith(EDGE_SOURCE_PREFIX) and p.endswith(".ts")}
    edge_base = {p for p in base_paths if p.startswith(EDGE_SOURCE_PREFIX) and p.endswith(".ts")}
    edge_changed = sorted(p for p in edge_current | edge_base if p not in edge_current or p not in edge_base or normalized_source(read(p)) != normalized_source(base_read(p)))
    return {"format": "jungsi.documentation-delta-audit/v1", "passed": not errors,
            "changed_source_files": len(changed), "unchanged_source_files_reused": len(current - set(changed)),
            "changed_edge_source_files": edge_changed,
            "edge_verification_scope": "complete source hash; Deno type and runtime acceptance recorded separately",
            "index_entries_revalidated": len(index_changed | (set(changed) & current)),
            "initial_index_verification": not initialized,
            "source_observations": observations, "linked_documents": required, "errors": errors,
            "scope": "changed source AST and current documentation index; independent full snapshot/security/branch/test gates remain mandatory"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="HEAD", help="Resolve once to an immutable review baseline")
    choice = parser.add_mutually_exclusive_group()
    choice.add_argument("--staged", action="store_true")
    choice.add_argument("--revision")
    choice.add_argument("--sync", action="store_true", help="Update the canonical code index and generate all current documents")
    args = parser.parse_args()
    from check_project_consistency import ROOT, SPEC_PATH, GitSnapshot, generated_files, validate_spec
    snapshot = GitSnapshot(staged=args.staged, revision=args.revision)
    spec = json.loads(snapshot.text(SPEC_PATH))
    if "documentation_sync" not in spec["workflow"]:
        raise ValueError("Current specification does not define documentation synchronization")
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    destination = ROOT / "outputs/documentation_sync" / stamp
    destination.mkdir(parents=True, exist_ok=False)
    if args.sync:
        catalog, replay = refresh_catalog(snapshot.paths, snapshot.read, spec)
        spec["workflow"]["documentation_sync"]["code_index"] = catalog
        errors = validate_spec(spec) + validate_catalog(snapshot.paths, snapshot.read, spec)
        if errors:
            raise ValueError("Synchronization failed: " + "; ".join(errors))
        generated = generated_files(spec)
        for relative in [SPEC_PATH, *generated]:
            target = ROOT / relative
            if not target.resolve().is_relative_to(ROOT.resolve()) or any(p.is_symlink() for p in [target, *target.parents] if p.is_relative_to(ROOT)):
                raise ValueError("Documentation destination must stay inside the regular workspace: " + relative)
        with (destination / "service_spec.before.json").open("xb") as target:
            target.write(snapshot.read(SPEC_PATH))
        (ROOT / SPEC_PATH).write_text(json.dumps(spec, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        for relative, content in generated.items():
            target = ROOT / relative
            if target.is_symlink():
                raise ValueError("Generated documentation cannot target a symbolic link: " + relative)
            if target.exists() and target.read_bytes() == content:
                continue
            if target.exists():
                previous = destination / "before" / relative
                previous.parent.mkdir(parents=True, exist_ok=True)
                with previous.open("xb") as retained:
                    retained.write(target.read_bytes())
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
        result = {"format": "jungsi.documentation-sync-receipt/v1", "passed": True,
                  "spec_version": spec["version"], "indexed_files": len(catalog["files"]), **replay,
                  "deleted_files": 0, "mandatory_snapshot_gate": "RUN_SEPARATELY"}
    else:
        baseline = GitSnapshot(revision=args.base)
        result = delta_audit(snapshot.paths, snapshot.read, spec, baseline.paths, baseline.read,
                             json.loads(baseline.text(SPEC_PATH)))
        result.update(base_commit=baseline.revision, selected_snapshot=snapshot.revision or ("index" if args.staged else "working_tree"))
    with (destination / "verification.json").open("x", encoding="utf-8", newline="\n") as target:
        target.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"passed": result["passed"], "receipt": str(destination / "verification.json"),
                      **{k: result[k] for k in ("base_commit", "changed_source_files", "unchanged_source_files_reused", "indexed_files") if k in result}}, ensure_ascii=False))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, SyntaxError, subprocess.CalledProcessError) as error:
        print("Documentation audit failed: " + str(error), file=sys.stderr)
        raise SystemExit(2)
