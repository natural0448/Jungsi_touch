"""Offline Edge declarations/import graph from retained, hash-bound snapshot bytes.
Deno is explicit, version-gated, never installed. Every output is CreateNew.
"""
from __future__ import annotations
import argparse,datetime,hashlib,json,os,re,subprocess,sys
from pathlib import Path
from edge_source_scope import classify_sources,ScopeFailure,PurePosixPath
from urllib.parse import urlparse,unquote
class EdgeFailure(ValueError): pass
def digest(raw): return hashlib.sha256(raw).hexdigest()
def json_bytes(value): return (json.dumps(value,ensure_ascii=False,sort_keys=True,indent=2)+"\n").encode()
def write_new(path,raw):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    with path.open("xb") as stream: stream.write(raw)
def safe_path(value):
    if not isinstance(value,str) or not value or "\\" in value or ":" in value: raise EdgeFailure("unsafe_snapshot_path")
    p=PurePosixPath(value)
    if p.is_absolute() or any(x in {"",".",".."} for x in value.split("/")): raise EdgeFailure("unsafe_snapshot_path")
    return value
def hashes(root,paths):
    out={}
    for path in paths:
        safe_path(path); target=root/path
        if any(p.is_symlink() for p in [target,*target.parents]) or not target.is_file(): raise EdgeFailure("nonregular_snapshot_file")
        if not target.resolve().is_relative_to(root.resolve()): raise EdgeFailure("snapshot_escape")
        out[path]=digest(target.read_bytes())
    return out
def verify_manifest(root,manifest):
    if manifest.get("format")!="jungsi.retained-snapshot/v1" or not isinstance(manifest.get("files"),dict) or not manifest["files"]: raise EdgeFailure("source_manifest_invalid")
    if hashes(root,manifest["files"])!=manifest["files"]: raise EdgeFailure("source_manifest_mismatch")
    return manifest["files"]
def command(argv,*,root,output,name,timeout=45,input=None):
    try:
        p=subprocess.run(argv,cwd=root,input=input,capture_output=True,timeout=timeout,
          env={**os.environ,"DENO_DIR":str(output/"deno_cache"),"DENO_NO_UPDATE_CHECK":"1","PYTHONDONTWRITEBYTECODE":"1"})
    except subprocess.TimeoutExpired as e:
        write_new(output/(name+".stdout"),e.stdout or b"");write_new(output/(name+".stderr"),e.stderr or b"")
        raise EdgeFailure("step_timeout:"+name) from e
    except OSError as e: raise EdgeFailure("runtime_unavailable:"+name) from e
    write_new(output/(name+".stdout"),p.stdout);write_new(output/(name+".stderr"),p.stderr)
    if p.returncode: raise EdgeFailure("step_failed:"+name+":"+str(p.returncode))
    return p.stdout
def runtime(deno,contract,root,output):
    if not deno or not Path(deno).is_file(): raise EdgeFailure("deno_unavailable")
    raw=command([deno,"--version"],root=root,output=output,name="deno-version").decode("utf-8")
    lines=raw.splitlines()
    if len(lines)!=3 or not lines[0].startswith("deno ") or not lines[1].startswith("v8 ") or not lines[2].startswith("typescript "): raise EdgeFailure("deno_version_schema_unsupported")
    data=dict(deno=lines[0].split()[1],v8=lines[1].split()[1],typescript=lines[2].split()[1])
    if data.get("deno")!=contract["runtime"]["deno"]: raise EdgeFailure("deno_version_incompatible")
    return dict(version=data,sha256=digest(Path(deno).read_bytes()))
def local_url(url,root):
    parsed=urlparse(url)
    if parsed.scheme!="file" or parsed.netloc not in ("","localhost"): raise EdgeFailure("nonlocal_module")
    if parsed.query or parsed.fragment: raise EdgeFailure("module_url_suffix")
    raw=unquote(parsed.path)
    if os.name=="nt" and re.match(r"/[A-Za-z]:/",raw): raw=raw[1:]
    p=Path(raw).resolve()
    if not p.is_relative_to(root.resolve()): raise EdgeFailure("module_outside_snapshot")
    return p.relative_to(root.resolve()).as_posix()
def tokens(text):
    """Conservative lexer: comments/strings/regex are opaque; template expressions are scanned."""
    result=[]
    def scan(i,end=None):
        previous=None;depth=0
        while i<len(text):
            ch=text[i]
            if end and ch==end and depth==0:return i+1
            if ch.isspace():i+=1;continue
            if text.startswith("//",i):
                n=text.find("\n",i+2);i=len(text) if n<0 else n+1;continue
            if text.startswith("/*",i):
                n=text.find("*/",i+2)
                if n<0:raise EdgeFailure("unterminated_comment")
                i=n+2;continue
            if ch in "'\"":
                start=i;q=ch;i+=1
                while i<len(text) and text[i]!=q:
                    i+=2 if text[i]=="\\" else 1
                if i>=len(text):raise EdgeFailure("unterminated_string")
                result.append(("string",text[start+1:i],start,i+1));i+=1;previous="literal";continue
            if ch=="\u0060":
                start=i;result.append(("template","",i,i+1));i+=1
                while i<len(text) and text[i]!="\u0060":
                    if text[i]=="\\":i+=2
                    elif text.startswith("$"+"{",i):i=scan(i+2,"}")
                    else:i+=1
                if i>=len(text):raise EdgeFailure("unterminated_template")
                i+=1;previous="literal";continue
            if ch=="/" and (previous is None or previous in {"=","(","[","{",",",":",";","!","?","|","&","return","throw","case","=>"}):
                start=i;i+=1;cls=False
                while i<len(text):
                    if text[i]=="\\":i+=2;continue
                    if text[i]=="[":cls=True
                    if text[i]=="]":cls=False
                    if text[i]=="/" and not cls:break
                    if text[i]=="\n":raise EdgeFailure("unsupported_slash_lexeme")
                    i+=1
                if i>=len(text):raise EdgeFailure("unterminated_regex")
                i+=1
                while i<len(text) and text[i].isalpha():i+=1
                result.append(("regex","",start,i));previous="literal";continue
            if ch=="\\":raise EdgeFailure("escaped_identifier_unsupported")
            if ch.isalpha() or ch in "_$":
                start=i;i+=1
                while i<len(text) and (text[i].isalnum() or text[i] in "_$"):i+=1
                value=text[start:i];result.append(("word",value,start,i));previous=value;continue
            value="=>" if text.startswith("=>",i) else ch
            result.append(("punct",value,i,i+len(value)))
            if ch=="{":depth+=1
            elif ch=="}":depth-=1
            previous=value;i+=len(value)
        if end:raise EdgeFailure("unterminated_template_expression")
        return i
    scan(0);return result
def dynamic_imports(text):
    t=tokens(text);literals=[]
    for i,item in enumerate(t):
        if item[0]!="word" or item[1]!="import":continue
        if i and t[i-1][1]==".":continue
        if i+1<len(t) and t[i+1][1]=="(":
            if i+3>=len(t) or t[i+2][0]!="string" or t[i+3][1]!=")" or "\\" in t[i+2][1]:
                raise EdgeFailure("computed_dynamic_import_unsupported")
            literals.append(t[i+2][1])
    return literals
def normalize_graph(raw,root,registered,layer_by_path):
    if raw.get("version")!=1 or not isinstance(raw.get("modules"),list) or not isinstance(raw.get("roots"),list):raise EdgeFailure("info_schema_unsupported")
    if raw.get("redirects") or raw.get("npmPackages"):raise EdgeFailure("external_graph_resolution")
    edges={};seen=set()
    for module in raw["modules"]:
        path=local_url(module["specifier"],root)
        if path not in registered:raise EdgeFailure("unregistered_graph_module:"+path)
        if module.get("kind")!="esm" or module.get("mediaType") not in ("TypeScript","Tsx") or "error" in module:raise EdgeFailure("module_parse_or_resolution_failure")
        seen.add(path);rows=[]
        for dep in module.get("dependencies",[]):
            if not isinstance(dep.get("specifier"),str):raise EdgeFailure("dependency_schema_unsupported")
            resolved=[]
            for kind in ("code","type"):
                target=dep.get(kind)
                if target is None:continue
                if not isinstance(target,dict) or "error" in target or not isinstance(target.get("specifier"),str):raise EdgeFailure("dependency_resolution_failure")
                destination=local_url(target["specifier"],root)
                if destination not in registered:raise EdgeFailure("unregistered_dependency:"+destination)
                src_layer=layer_by_path[path];dst_layer=layer_by_path[destination]
                allowed={"application":{"application"},"data_infrastructure":{"application","data_infrastructure"},"verification":{"application","data_infrastructure","verification"}}
                if dst_layer not in allowed.get(src_layer,set()):raise EdgeFailure("layer_dependency_violation:"+path)
                resolved.append(dict(kind=kind,path=destination))
            if not resolved:raise EdgeFailure("unresolved_dependency")
            rows.append(dict(specifier=dep["specifier"],dynamic=dep.get("isDynamic",False),targets=resolved))
        edges[path]=sorted(rows,key=lambda r:json.dumps(r,sort_keys=True))
    return edges,seen
def declaration_model(module,root,path,registered=None):
    if not isinstance(module.get("symbols"),list) or not isinstance(module.get("imports",[]),list):raise EdgeFailure("doc_node_schema_unsupported")
    source=(root/path).read_bytes();text=source.decode("utf-8")
    def param_slice(index,filename=None):
        # Re-exports retain the declaration origin; byte offsets belong to that source.
        origin=local_url(filename,root) if filename else path
        if origin not in (registered or {path}):raise EdgeFailure("declaration_origin_unregistered")
        origin_source=(root/origin).read_bytes();origin_text=origin_source.decode("utf-8")
        prefix=origin_source[:index].decode("utf-8");start=len(prefix)
        subset=tokens(origin_text[start:]);angle=0;opening=None;level=0
        left,right=("[","]") if subset and subset[0][1]=="[" else ("(",")")
        for kind,value,a,b in subset:
            if kind!="punct":continue
            if opening is None:
                if value=="<":angle+=1
                elif value==">":angle=max(0,angle-1)
                elif value==left and angle==0:opening=start+a;level=1
                elif value in {"{",";"} and angle==0:break
            elif value==left:level+=1
            elif value==right:
                level-=1
                if level==0:return origin_text[opening:start+b]
        raise EdgeFailure("callable_source_fidelity_unsupported:"+path+":"+str(index))
    def clean(value,location=None):
        if isinstance(value,list):return [clean(x) for x in value]
        if not isinstance(value,dict):return value
        loc=value.get("location",location);out={}
        for k,v in value.items():
            if k in {"location","jsDoc"}:continue
            out[k]=clean(v,loc if k=="def" else None)
        if "params" in value and loc and "byteIndex" in loc:
            out["parameter_source"]=param_slice(loc["byteIndex"],loc.get("filename"))
        return out
    symbols=clean(module["symbols"])
    imports=[]
    for row in module.get("imports",[]):
        imports.append({**row,"src":local_url(row["src"],root)})
    return dict(symbols=symbols,imports=sorted(imports,key=lambda r:json.dumps(r,sort_keys=True)),source_sha256=digest(source))
def parse_contract(root,contract,deno,output,*,spec=None,manifest_names=None):
    paths=list(contract["files"]);registered=set(paths);layers={p:r["layer"] for p,r in contract["files"].items()}
    expected=sorted(p.relative_to(root).as_posix() for folder in ("supabase","tests/edge") if (root/folder).exists() for p in (root/folder).rglob("*") if p.suffix in {".ts",".tsx",".js",".jsx",".mts",".cts"} and p.is_file())
    if manifest_names is not None and not set(expected)<=set(manifest_names):raise EdgeFailure("edge_sources_outside_manifest")
    scope=classify_sources(expected,lambda p:(root/p).read_bytes(),spec or {"edge_harness":contract},contract)
    if scope["foundation_ts"]!=sorted(paths):raise EdgeFailure("TS_registration_coverage_mismatch")
    for p in paths:
        hashes(root,[p]);dynamic_imports((root/p).read_text(encoding="utf-8"))
    tool=runtime(deno,contract,root,output)
    config=safe_path(contract["config"])
    resolver=[]
    config_value=json.loads((root/config).read_bytes())
    if config_value.get("imports") or config_value.get("scopes"):
        def target_url(value):
            if not isinstance(value,str):raise EdgeFailure("import_map_target_invalid")
            if value.startswith(("./","../")):
                target=(root/config).parent/value;url=target.resolve().as_uri()
                if value.endswith("/") and not url.endswith("/"):url+="/"
            elif value.startswith("file:"):url=value
            else:raise EdgeFailure("nonlocal_import_map_target")
            local_url(url,root);return url
        mapping={}
        if "imports" in config_value:mapping["imports"]={k:target_url(v) for k,v in config_value["imports"].items()}
        if "scopes" in config_value:mapping["scopes"]={target_url(k):{a:target_url(v) for a,v in values.items()} for k,values in config_value["scopes"].items()}
        import_map=output.resolve()/"import_map.json"
        write_new(import_map,json_bytes(mapping));resolver=["--import-map",str(import_map)]
    raw=json.loads(command([deno,"doc","--json","--private","--no-lock","--no-remote","--no-npm","--config",config,*resolver,*paths],root=root,output=output,name="doc"))
    if raw.get("version")!=2 or not isinstance(raw.get("nodes"),dict):raise EdgeFailure("doc_schema_unsupported")
    nodes={local_url(k,root):v for k,v in raw["nodes"].items()}
    if set(nodes)!=registered:raise EdgeFailure("doc_root_coverage_mismatch")
    for p in paths:
        if not set(contract["files"][p]["symbols"])<={s["name"] for s in nodes[p]["symbols"]}:raise EdgeFailure("registered_symbol_missing:"+p)
    files={p:{**contract["files"][p],"declarations":declaration_model(nodes[p],root,p,registered)} for p in paths}
    graph={}
    for i,path in enumerate(paths):
        info=json.loads(command([deno,"info","--json","--no-lock","--no-remote","--no-npm","--config",config,*resolver,path],root=root,output=output,name="info-"+str(i)))
        parsed,_=normalize_graph(info,root,registered,layers)
        for key,value in parsed.items():
            if key in graph and graph[key]!=value:raise EdgeFailure("inconsistent_import_graph")
            graph[key]=value
    if set(graph)!=registered:raise EdgeFailure("graph_coverage_mismatch")
    for p in paths:
        literal=dynamic_imports((root/p).read_text(encoding="utf-8"))
        resolved={x["specifier"] for x in graph[p]}
        if not set(literal)<=resolved:raise EdgeFailure("dynamic_graph_incomplete")
        files[p]["dependencies"]=graph[p]
    return {**contract,"files":files},tool
def check_workspace(root,manifest,deno,output,*,emit=False):
    root=Path(root).resolve();output=Path(output);output.mkdir(parents=True,exist_ok=False)
    before=verify_manifest(root,manifest);spec=json.loads((root/"docs/current/service_spec.json").read_bytes())
    contract=spec.get("edge_harness")
    scope=classify_sources(before,lambda p:(root/p).read_bytes(),spec,contract)
    edge=scope["foundation_active"]
    if not edge:
        return dict(status="NOT_APPLICABLE_NO_FOUNDATION_SOURCE",successful=True,edge_execution=False,coexisting_edge_sources=len(scope["coexisting_bound"]),coverage="DEV010_FOUNDATION")
    if not isinstance(contract,dict) or contract.get("state")!="required":raise EdgeFailure("edge_registration_not_activated")
    required={*contract["files"],contract["config"],contract["oracle"],*contract["tests"]}
    if not required<=set(before):raise EdgeFailure("edge_sources_outside_manifest")
    model,tool=parse_contract(root,contract,deno,output,spec=spec,manifest_names=before)
    expected=contract
    if not emit and model!=expected:raise EdgeFailure("parsed_declarations_or_graph_drift")
    if verify_manifest(root,manifest)!=before:raise EdgeFailure("snapshot_changed_during_check")
    result=dict(format="jungsi.edge-contract-check/v1",status="PASS" if not emit else "PROPOSED_CONTRACT_NOT_ACCEPTED",successful=True,tool=tool,files=len(model["files"]),coverage=scope["coverage"],coexisting_edge_sources=len(scope["coexisting_bound"]),contract=model if emit else None,source_manifest_sha256=digest(json_bytes(manifest)))
    write_new(output/"edge_contract_receipt.json",json_bytes(result));return result
def main():
    parser=argparse.ArgumentParser(description=__doc__)
    mode=parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--snapshot-root");mode.add_argument("--staged",action="store_true");mode.add_argument("--revision")
    parser.add_argument("--source-manifest");parser.add_argument("--deno",default=os.environ.get("JUNGSI_DENO"));parser.add_argument("--output-root",required=True)
    parser.add_argument("--emit-contract",action="store_true")
    args=parser.parse_args();output=Path(args.output_root)
    if args.snapshot_root:
        if not args.source_manifest:raise EdgeFailure("source_manifest_required")
        root=Path(args.snapshot_root);manifest=json.loads(Path(args.source_manifest).read_bytes())
    else:
        from check_project_consistency import GitSnapshot,validate_content,validate_changed_paths,snapshot_changed_paths,SPEC_PATH
        snapshot=GitSnapshot(staged=args.staged,revision=args.revision);spec=json.loads(snapshot.text(SPEC_PATH))
        errors=validate_content(snapshot.paths,snapshot.read,spec)+validate_changed_paths(snapshot_changed_paths(snapshot),spec)
        if errors and not args.emit_contract:raise EdgeFailure("common_snapshot_gate_failed")
        if args.emit_contract:
            from check_project_consistency import protected_path,TOKEN_PATTERN,validate_spec
            if validate_spec(spec) or any(protected_path(p,spec["workflow"]["shared_tools"]) or TOKEN_PATTERN.search(snapshot.read(p)) for p in snapshot.paths):raise EdgeFailure("unsafe_proposal_snapshot")
        root=output.parent/(output.name+"-workspace");root.mkdir(parents=True,exist_ok=False)
        for p in snapshot.paths:write_new(root/safe_path(p),snapshot.read(p))
        manifest=dict(format="jungsi.retained-snapshot/v1",files=hashes(root,snapshot.paths),snapshot=snapshot.revision or "index")
    result=check_workspace(root,manifest,args.deno,output,emit=args.emit_contract);print(json.dumps({k:v for k,v in result.items() if k!="contract"},ensure_ascii=False));return 0
if __name__=="__main__":
    try:raise SystemExit(main())
    except (ValueError,KeyError,OSError,subprocess.SubprocessError,json.JSONDecodeError) as e:
        print(json.dumps(dict(successful=False,error=str(e)),ensure_ascii=False),file=sys.stderr);raise SystemExit(2)
