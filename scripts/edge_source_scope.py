"""Bind DEV-010 foundation separately from already indexed public Edge code."""
from __future__ import annotations
import hashlib
from pathlib import PurePosixPath
FOUNDATION_ROOTS=("supabase/functions/_shared/jungsi/","tests/edge/")
FOUNDATION_CONFIG="supabase/functions/deno.json"
SUFFIXES={".ts",".tsx",".js",".jsx",".mts",".cts"}
SCOPE={"format":"jungsi.edge-suite-scope/v1","suite":"DEV010_FOUNDATION",
       "source_roots":list(FOUNDATION_ROOTS),
       "coexisting_source_basis":"workflow.documentation_sync.code_index.edge_sources"}
class ScopeFailure(ValueError):pass
def foundation_present(paths):
    return any(p==FOUNDATION_CONFIG or p.startswith(FOUNDATION_ROOTS) for p in paths)
def classify_sources(paths,read,spec,contract=None):
    names=set(paths)
    if any(not isinstance(p,str) or PurePosixPath(p).is_absolute() or ".." in PurePosixPath(p).parts or "\\" in p or ":" in p for p in names):
        raise ScopeFailure("unsafe_edge_inventory_path")
    candidates={p for p in names if p.startswith(("supabase/","tests/edge/")) and PurePosixPath(p).suffix in SUFFIXES}
    contract=spec.get("edge_harness") if contract is None else contract
    if contract is not None and "source_scope" not in contract:
        # Original retained fixtures keep their historical strict all-source scope.
        return {"foundation_active":bool(candidates),"foundation_ts":sorted(candidates),
                "coexisting_bound":[],"coverage":"LEGACY_ALL_EDGE"}
    if contract is not None and contract.get("source_scope")!=SCOPE:
        raise ScopeFailure("unsupported_edge_suite_scope")
    if contract is not None and contract.get("state")=="required" and not foundation_present(names):
        raise ScopeFailure("required_foundation_sources_missing")
    foundation={p for p in candidates if p.startswith(FOUNDATION_ROOTS)}
    if contract is None and foundation_present(names):
        raise ScopeFailure("foundation_registry_missing")
    others=candidates-foundation
    index=spec.get("workflow",{}).get("documentation_sync",{}).get("code_index",{}).get("edge_sources")
    rows=index.get("files",[]) if isinstance(index,dict) else []
    if others and (not isinstance(index,dict) or index.get("format")!="jungsi.typescript-source-hash-index/v1" or index.get("verification")!="whole_source_hash_not_type_or_runtime_proof"):
        raise ScopeFailure("coexisting_edge_index_missing_or_unsupported")
    if not isinstance(rows,list) or any(not isinstance(r,dict) or not isinstance(r.get("path"),str) for r in rows):
        raise ScopeFailure("coexisting_edge_index_entries_invalid")
    by_path={r["path"]:r for r in rows}
    if len(by_path)!=len(rows):raise ScopeFailure("coexisting_edge_index_duplicate")
    outside={p:r for p,r in by_path.items() if not p.startswith(FOUNDATION_ROOTS)}
    if set(outside)!=others:raise ScopeFailure("coexisting_edge_coverage_drift")
    registered={r["path"]:r for r in spec.get("implementation",[]) if isinstance(r,dict) and isinstance(r.get("path"),str)}
    for path,row in outside.items():
        item=registered.get(path)
        if item is None or any(row.get(k)!=item.get(k) for k in ("layer","status","requirements")) or row.get("declared_exports")!=item.get("symbols",[]):
            raise ScopeFailure("coexisting_edge_registration_drift:"+path)
        try:normalized=read(path).decode("utf-8-sig").replace("\r\n","\n").encode()
        except (UnicodeError,KeyError,OSError):raise ScopeFailure("coexisting_edge_source_unavailable:"+path)
        if hashlib.sha256(normalized).hexdigest()!=row.get("source_sha256"):
            raise ScopeFailure("coexisting_edge_hash_drift:"+path)
    return {"foundation_active":foundation_present(names),"foundation_ts":sorted(foundation),
            "coexisting_bound":sorted(others),"coverage":"DEV010_FOUNDATION"}
