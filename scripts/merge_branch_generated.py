"""Review-only merge result generator. Never modifies Git index, worktree, refs or old files.

Run only from a checkout with a stopped two-parent merge. The operator must
pin six blobs or explicitly provide an independently reviewed commit. The output directory must be
new and inside that checkout's outputs/ tree. No git add/merge/cleanup is run.
"""
from __future__ import annotations
import argparse, copy, decimal, hashlib, json, math, os, re, subprocess, sys, types
from pathlib import Path, PurePosixPath

SPEC = 'docs/current/service_spec.json'
GEN = 'scripts/check_project_consistency.py'
AUDIT = 'scripts/audit_documentation_sync.py'
DEPS = {'scripts/edge_source_scope.py':'edge_source_scope','scripts/check_edge_contract.py':'check_edge_contract','scripts/run_edge_tests.py':'run_edge_tests','scripts/check_branch_policy.py':'check_branch_policy'}
OID = re.compile(r'^(?:[0-9a-f]{40}|[0-9a-f]{64})$')
MAX_BLOB = 16 * 1024 * 1024
MISSING = object()

class Stop(ValueError): pass

def parse_json(raw):
    def pairs(items):
        d = {}
        for k, v in items:
            if k in d: raise Stop('duplicate_json_key')
            d[k] = v
        return d
    def invalid(_): raise Stop('nonfinite_number')
    def exact_float(text):
        try:
            d=decimal.Decimal(text); f=float(text)
            if not math.isfinite(f) or d!=decimal.Decimal(repr(f)): raise Stop('lossy_json_float')
            return f
        except (decimal.InvalidOperation,OverflowError,ValueError) as e:
            raise Stop('lossy_json_float') from e
    try:
        x = json.loads(raw.decode('utf-8'), object_pairs_hook=pairs, parse_constant=invalid, parse_float=exact_float)
    except (UnicodeError, json.JSONDecodeError, RecursionError) as e:
        raise Stop('invalid_json') from e
    if not isinstance(x, dict): raise Stop('spec_not_object')
    return x

def key(value):
    if value is MISSING: return b'\x00missing'
    try: return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')
    except (TypeError, ValueError, RecursionError) as e: raise Stop('unsupported_json') from e

def same(a, b): return key(a) == key(b)

def merge_value(base, ours, theirs, path=()):
    if same(ours, theirs): return copy.deepcopy(ours) if ours is not MISSING else MISSING
    if same(base, ours): return copy.deepcopy(theirs) if theirs is not MISSING else MISSING
    if same(base, theirs): return copy.deepcopy(ours) if ours is not MISSING else MISSING
    if all(isinstance(x, dict) for x in (base, ours, theirs)):
        out = {}
        for name in dict.fromkeys([*base, *ours, *theirs]):
            if not isinstance(name, str): raise Stop('invalid_key')
            val = merge_value(base.get(name, MISSING), ours.get(name, MISSING), theirs.get(name, MISSING), path+(name,))
            if val is not MISSING: out[name] = val
        return out
    raise Stop('unresolved_spec_conflict:' + '/'.join(path))

def merge_notes(base, ours, theirs):
    if not all(isinstance(x, list) for x in (base, ours, theirs)): raise Stop('change_notes_not_list')
    if len(ours)<len(base) or len(theirs)<len(base) or any(not same(base[i], ours[i]) or not same(base[i], theirs[i]) for i in range(len(base))):
        raise Stop('change_notes_not_append_only')
    a,b=ours[len(base):],theirs[len(base):]
    if not a and not b: return copy.deepcopy(base)
    # No stable IDs exist. Cross-side equal entries might be the same event or
    # two events: do not guess or silently drop either one.
    if {key(x) for x in a} & {key(x) for x in b}: raise Stop('ambiguous_duplicate_change_notes')
    return copy.deepcopy(base+a+b)

def merge_spec(base, ours, theirs):
    if any('change_notes' not in x for x in (base,ours,theirs)): raise Stop('change_notes_missing')
    left={k:v for k,v in base.items() if k!='change_notes'}
    mid={k:v for k,v in ours.items() if k!='change_notes'}
    right={k:v for k,v in theirs.items() if k!='change_notes'}
    result=merge_value(left,mid,right)
    result['change_notes']=merge_notes(base['change_notes'],ours['change_notes'],theirs['change_notes'])
    return result

def safe_path(name):
    if not isinstance(name,str) or not name or '\\' in name or '\x00' in name or ':' in name: raise Stop('unsafe_path')
    p=PurePosixPath(name)
    if p.is_absolute() or any(x in ('','.', '..') for x in p.parts) or str(p)!=name: raise Stop('unsafe_path')
    return p

def parse_index(raw):
    result={}
    for record in raw.split(b'\0'):
        if not record: continue
        try:
            meta, name = record.split(b'\t',1); mode,sha,stage=meta.decode('ascii').split(' '); name=name.decode('utf8');stage=int(stage)
        except (ValueError,UnicodeError) as e: raise Stop('invalid_index') from e
        safe_path(name)
        if mode not in ('100644','100755') or not OID.fullmatch(sha) or stage not in (0,1,2,3): raise Stop('unsupported_index_entry')
        d=result.setdefault(name,{})
        if stage in d or (stage==0 and d) or (stage!=0 and 0 in d): raise Stop('invalid_index_stages')
        d[stage]=(mode,sha)
    return result

def ensure_generated_conflicts(index, generated):
    generated=set(generated)
    for p, stages in index.items():
        if 0 not in stages and p!=SPEC and p not in generated:
            raise Stop('unresolved_non_generated_conflict:'+p)

def git(repo,*args):
    env={**os.environ,'GIT_OPTIONAL_LOCKS':'0','GIT_NO_REPLACE_OBJECTS':'1'}
    r=subprocess.run(['git','-C',str(repo),*args],stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env)
    if r.returncode: raise Stop('git_read_failed:'+args[0])
    return r.stdout

def pins_from_commit(repo,commit,index):
    """Resolve only caller-specified reviewed commit; this does not establish trust."""
    if not isinstance(commit,str) or not OID.fullmatch(commit): raise Stop('full_verified_commit_required')
    if git(repo,'cat-file','-t',commit).strip()!=b'commit': raise Stop('verified_commit_not_commit')
    if git(repo,'rev-parse','--verify',commit+'^{commit}').decode('ascii').strip()!=commit: raise Stop('verified_commit_not_exact')
    wanted={GEN,AUDIT,*DEPS}; found={}
    raw=git(repo,'ls-tree','-r','-z','--full-tree',commit,'--',*sorted(wanted))
    for record in raw.split(b'\0'):
        if not record:continue
        try:
            meta,name=record.split(b'\t',1);mode,kind,sha=meta.decode('ascii').split(' ');name=name.decode('utf8')
        except (ValueError,UnicodeError) as e: raise Stop('invalid_verified_tree') from e
        if name not in wanted or name in found or kind!='blob' or mode not in ('100644','100755') or not OID.fullmatch(sha) or len(sha)!=len(commit):
            raise Stop('invalid_verified_tree')
        if index.get(name)!={0:(mode,sha)}:raise Stop('verified_commit_index_mismatch:'+name)
        found[name]=sha
    if set(found)!=wanted:raise Stop('verified_commit_missing_tools')
    return found

def context(repo):
    head=git(repo,'rev-parse','--verify','HEAD^{commit}').decode('ascii').strip()
    p=git(repo,'rev-parse','--git-path','MERGE_HEAD').decode('utf8').strip()
    f=Path(p) if Path(p).is_absolute() else repo/p
    try: parents=f.read_text(encoding='ascii').splitlines()
    except OSError as e: raise Stop('not_in_merge') from e
    if len(parents)!=1 or not OID.fullmatch(parents[0]) or not OID.fullmatch(head): raise Stop('unsupported_merge_context')
    return head,parents[0],git(repo,'ls-files','--stage','-z')

# These variables can redirect Git to a different repository, index, object
# graph or attribute source. A caller needing them must use another reviewed
# workflow rather than silently weakening this preflight.
GIT_ENV_DENY={'GIT_DIR','GIT_WORK_TREE','GIT_COMMON_DIR','GIT_INDEX_FILE','GIT_OBJECT_DIRECTORY','GIT_ALTERNATE_OBJECT_DIRECTORIES','GIT_REPLACE_REF_BASE','GIT_GRAFT_FILE','GIT_NAMESPACE','GIT_ATTR_SOURCE','GIT_CONFIG','GIT_CONFIG_GLOBAL','GIT_CONFIG_SYSTEM','GIT_CONFIG_NOSYSTEM','GIT_CONFIG_PARAMETERS','GIT_CONFIG_COUNT','GIT_PREFIX'}
def ensure_git_environment():
    if any(k in os.environ for k in GIT_ENV_DENY) or any(k.startswith(('GIT_CONFIG_KEY_','GIT_CONFIG_VALUE_')) for k in os.environ):raise Stop('git_environment_override')

def renormalize_setting(repo):
    env={**os.environ,'GIT_OPTIONAL_LOCKS':'0','GIT_NO_REPLACE_OBJECTS':'1'}
    p=subprocess.run(['git','-C',str(repo),'config','--type=bool','--get','merge.renormalize'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env)
    if p.returncode==1 and not p.stdout:return 'unset'
    if p.returncode!=0:raise Stop('merge_renormalize_unknown')
    val=p.stdout.strip()
    if val==b'false':return 'false'
    if val==b'true':raise Stop('merge_renormalize_enabled')
    raise Stop('merge_renormalize_unknown')

def attributes(repo,options):
    names=('filter','working-tree-encoding','ident','merge')
    raw=git(repo,'check-attr',*options,'-z',*names,'--',SPEC)
    fields=raw.split(b'\0')
    if fields[-1:]!=[b''] or len(fields)!=len(names)*3+1:raise Stop('attributes_invalid')
    result={}
    for i in range(0,len(fields)-1,3):
        try:path,name,value=(v.decode('utf8') for v in fields[i:i+3])
        except UnicodeError as e:raise Stop('attributes_invalid') from e
        if path!=SPEC or name not in names or name in result:raise Stop('attributes_invalid')
        result[name]=value
    if set(result)!=set(names):raise Stop('attributes_invalid')
    if any(result[n] not in ('unspecified','unset') for n in ('filter','working-tree-encoding','ident')) or result['merge'] not in ('unspecified','text'):
        raise Stop('unsupported_conversion_or_merge_driver')
    return result

def tree_spec(repo,revision):
    raw=git(repo,'ls-tree','-z','--full-tree',revision,'--',SPEC)
    records=[x for x in raw.split(b'\0') if x]
    if len(records)!=1:raise Stop('tree_spec_missing_or_ambiguous')
    try:
        meta,path=records[0].split(b'\t',1);mode,kind,sha=meta.decode('ascii').split(' ');path=path.decode('utf8')
    except (ValueError,UnicodeError) as e:raise Stop('tree_spec_invalid') from e
    if path!=SPEC or mode!='100644' or kind!='blob' or not OID.fullmatch(sha) or len(sha)!=len(revision):raise Stop('tree_spec_invalid')
    return mode,sha

def parse_tree_changes(raw,allow_renames):
    fields=raw.split(b'\0')
    if fields[-1:]!=[b'']:raise Stop('tree_diff_invalid')
    rows=[];i=0
    while i<len(fields)-1:
        try:status=fields[i].decode('ascii')
        except UnicodeError as e:raise Stop('tree_diff_invalid') from e
        i+=1
        rename=re.fullmatch(r'R(100|[0-9]{1,2})',status)
        if rename and allow_renames:count=2
        elif re.fullmatch(r'(?:A|D|T|M(?:100|[0-9]{1,2})?)',status):count=1
        else:raise Stop('tree_diff_invalid')
        if i+count>len(fields)-1:raise Stop('tree_diff_invalid')
        try:paths=tuple(fields[j].decode('utf8') for j in range(i,i+count))
        except UnicodeError as e:raise Stop('tree_diff_invalid') from e
        for path in paths:safe_path(path)
        if SPEC in paths and (status[0]!='M' or len(paths)!=1):raise Stop('spec_path_changed_or_renamed')
        rows.append((status,paths));i+=count
    return rows

def check_spec_tree_identity(repo,base,parent):
    common=('diff-tree','-r','--no-commit-id','--name-status','--no-ext-diff','--no-textconv','-z')
    raw=git(repo,*common,'--no-renames',base,parent)
    rows=parse_tree_changes(raw,False)
    # Rename detection is quadratic. Do not silently truncate Git's analysis:
    # fail closed when the review scope exceeds this explicit technical cap.
    if len(rows)>256:raise Stop('rename_review_scope_too_large')
    detected=git(repo,*common,'--break-rewrites=20%','--find-renames=1%','-l0',base,parent)
    parse_tree_changes(detected,True)

def verify_stage_binding(repo,head,parent,index):
    ensure_git_environment()
    if git(repo,'rev-parse','--is-shallow-repository').strip()!=b'false':raise Stop('shallow_repository')
    graft_path=git(repo,'rev-parse','--git-path','info/grafts').decode('utf8').strip()
    graft=Path(graft_path) if Path(graft_path).is_absolute() else repo/graft_path
    if graft.exists() and (not graft.is_file() or graft.read_bytes().strip()):raise Stop('grafts_not_supported')
    if git(repo,'cat-file','-t',head).strip()!=b'commit' or git(repo,'cat-file','-t',parent).strip()!=b'commit':raise Stop('merge_parent_not_commit')
    try: bases=git(repo,'merge-base','--all',head,parent).decode('ascii').splitlines()
    except UnicodeError as e:raise Stop('merge_base_invalid') from e
    if len(bases)!=1 or not OID.fullmatch(bases[0]) or len(bases[0])!=len(head):raise Stop('merge_base_not_unique')
    base=bases[0]
    if git(repo,'cat-file','-t',base).strip()!=b'commit':raise Stop('merge_base_invalid')
    for path,stages in index.items():
        if (path=='.gitattributes' or path.endswith('/.gitattributes')) and 0 not in stages:raise Stop('unmerged_attributes')
    snapshots={}
    for stage,revision in ((1,base),(2,head),(3,parent)):
        mode,sha=tree_spec(repo,revision)
        if index.get(SPEC,{}).get(stage)!=(mode,sha):raise Stop('spec_stage_parent_mismatch:'+str(stage))
        snapshots[str(stage)]={'commit':revision,'mode':mode,'blob':sha}
    check_spec_tree_identity(repo,base,head);check_spec_tree_identity(repo,base,parent)
    observed=[attributes(repo,['--source',x]) for x in (base,head,parent)]
    observed += [attributes(repo,['--cached']),attributes(repo,[])]
    if any(x!=observed[0] for x in observed[1:]):raise Stop('attributes_not_consistent')
    renormalize=renormalize_setting(repo)
    return {'base':base,'stages':snapshots,'attributes':observed[0],'renormalize_config':renormalize,
            'scope':'exact same-path tree blobs; rename detection is heuristic; historical merge invocation not established'}

class Blobs:
    def __init__(self,repo):
        env={**os.environ,'GIT_OPTIONAL_LOCKS':'0','GIT_NO_REPLACE_OBJECTS':'1'}
        self.p=subprocess.Popen(['git','-C',str(repo),'cat-file','--batch'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env)
    def read(self,oid):
        if not OID.fullmatch(oid): raise Stop('bad_oid')
        self.p.stdin.write((oid+'\n').encode());self.p.stdin.flush()
        parts=self.p.stdout.readline().split()
        if len(parts)!=3 or parts[0].decode()!=oid or parts[1]!=b'blob': raise Stop('bad_blob')
        size=int(parts[2])
        if size>MAX_BLOB: raise Stop('blob_too_large')
        data=self.p.stdout.read(size)
        if len(data)!=size or self.p.stdout.read(1)!=b'\n': raise Stop('truncated_blob')
        algorithm='sha1' if len(oid)==40 else 'sha256'
        if hashlib.new(algorithm,b'blob '+str(size).encode()+b'\0'+data).hexdigest()!=oid: raise Stop('blob_hash_mismatch')
        return data
    def close(self):
        self.p.stdin.close(); self.p.stdout.close(); self.p.stderr.close(); self.p.wait()

def load_generator(repo,index,blob,expected_gen,expected_audit,dependencies):
    if set(dependencies)!=set(DEPS): raise Stop('dependency_pins_required')
    pins={GEN:expected_gen,AUDIT:expected_audit,**dependencies}
    for p,expected in pins.items():
        if not OID.fullmatch(expected) or index.get(p,{}).get(0,('',None))[1]!=expected: raise Stop('unapproved_generator:'+p)
    modules={}
    for path,name in [*DEPS.items(),(AUDIT,'audit_documentation_sync'),(GEN,'check_project_consistency')]:
        mod=types.ModuleType(name);mod.__file__=str(repo/path);sys.modules[name]=mod
        exec(compile(blob.read(pins[path]),mod.__file__,'exec'),mod.__dict__);modules[name]=mod
    return modules['audit_documentation_sync'],modules['check_project_consistency']

def check_destination(repo, dest):
    out=repo/'outputs'
    if not out.exists() and not out.is_symlink():
        raise Stop('outputs_missing: create the outputs folder in the repository root and retry')
    if not out.is_dir() or out.is_symlink(): raise Stop('outputs_not_regular')
    dest=Path(dest)
    if not dest.is_absolute(): dest=repo/dest
    try: rel=dest.relative_to(out)
    except ValueError as e: raise Stop('outside_outputs') from e
    if not rel.parts or any(x in ('','.','..') for x in rel.parts): raise Stop('unsafe_output')
    cursor=out
    for part in rel.parts[:-1]:
        cursor=cursor/part
        if not cursor.is_dir() or cursor.is_symlink(): raise Stop('output_parent_not_regular')
    if dest.exists() or dest.is_symlink(): raise Stop('output_exists')
    return dest

def write_new(root,relative,data):
    p=safe_path(relative);target=root.joinpath(*p.parts)
    target.parent.mkdir(parents=True,exist_ok=True)
    with target.open('xb') as f:f.write(data)

def read_worktree(repo,path):
    target=repo.joinpath(*safe_path(path).parts);cursor=repo
    for component in safe_path(path).parts:
        cursor=cursor/component
        if cursor.is_symlink(): raise Stop('worktree_symlink')
    if not target.exists():return None
    if not target.is_file() or target.stat().st_size>MAX_BLOB: raise Stop('worktree_not_regular')
    data=target.read_bytes()
    if len(data)>MAX_BLOB: raise Stop('worktree_not_regular')
    return data

def preview(repo,dest,expected_head,expected_parent,expected_gen,expected_audit,dependencies,verified_commit=None):
    repo=Path(repo).resolve(strict=True);dest=check_destination(repo,dest)
    ensure_git_environment()
    head,parent,raw=context(repo)
    if head!=expected_head or parent!=expected_parent: raise Stop('merge_context_changed')
    index=parse_index(raw)
    if set(index.get(SPEC,{}))!={1,2,3}: raise Stop('spec_three_stages_required')
    binding=verify_stage_binding(repo,head,parent,index)
    if verified_commit is not None:
        if expected_gen is not None or expected_audit is not None or dependencies is not None:raise Stop('mixed_pin_modes')
        pins=pins_from_commit(repo,verified_commit,index)
        expected_gen,expected_audit=pins[GEN],pins[AUDIT]
        dependencies={name:pins[name] for name in DEPS}
    elif expected_gen is None or expected_audit is None or dependencies is None:
        raise Stop('complete_pin_mode_required')
    blobs=Blobs(repo)
    try:
        originals={str(i):blobs.read(index[SPEC][i][1]) for i in (1,2,3)}
        merged=merge_spec(*(parse_json(originals[str(i)]) for i in (1,2,3)))
        audit,check=load_generator(repo,index,blobs,expected_gen,expected_audit,dependencies)
        names=set(index)
        def read(path):
            entry=index.get(path,{})
            if set(entry)!={0}: raise Stop('unresolved_input:'+str(path))
            return blobs.read(entry[0][1])
        catalog,_=audit.refresh_catalog(names,read,merged)
        merged['workflow']['documentation_sync']['code_index']=catalog
        errors=check.validate_spec(merged)+audit.validate_catalog(names,read,merged)
        if errors: raise Stop('merged_spec_invalid:'+str(errors[:3]))
        generated=check.generated_files(merged,read=read)
        if not isinstance(generated,dict) or not generated: raise Stop('no_generated_files')
        for p,b in generated.items():
            safe_path(p)
            if p==SPEC or not isinstance(b,bytes): raise Stop('invalid_generated_output')
        ensure_generated_conflicts(index,generated)
        # Capture every generated worktree file, including stage 0. Refuse
        # unstaged changes or an untracked file at a newly generated path.
        saved={};worktree={}
        unresolved={path for path,stages in index.items() if 0 not in stages}
        for path in unresolved:
            for n,(_,oid) in index[path].items():saved[f'stages/{n}/{path}']=blobs.read(oid)
        for path in sorted(set(generated)|unresolved|{SPEC}):
            current=read_worktree(repo,path);worktree[path]=current
            if path in generated and 0 in index.get(path,{}):
                if current is None or current!=read(path): raise Stop('unstaged_generated_change:'+path)
            elif path in generated and path not in index and current is not None:
                raise Stop('untracked_generated_collision:'+path)
            if current is not None:saved['worktree/'+path]=current
        final=(json.dumps(merged,ensure_ascii=False,indent=2,allow_nan=False)+'\n').encode('utf8')
        digest=hashlib.sha256(json.dumps(merged,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()
        if context(repo)!=(head,parent,raw): raise Stop('merge_context_changed')
        if verify_stage_binding(repo,head,parent,index)!=binding:raise Stop('stage_binding_changed')
        if any(read_worktree(repo,path)!=value for path,value in worktree.items()): raise Stop('worktree_changed_during_review')
        items={'candidate/'+SPEC:final,**{'candidate/'+p:b for p,b in generated.items()},**saved}
        report={'format':'jungsi.merge-preview/v1','state':'REVIEW_ONLY','head':head,'merge_head':parent,
          'index_sha256':hashlib.sha256(raw).hexdigest(),'pin_source':'caller_specified_commit' if verified_commit is not None else 'explicit_blobs','verified_commit':verified_commit,'generator_blob':expected_gen,'auditor_blob':expected_audit,'dependency_blobs':dependencies,
          'stage_binding':binding,'canonical_spec_sha256':digest,'generated_count':len(generated),'worktree_paths':{p:None if v is None else hashlib.sha256(v).hexdigest() for p,v in sorted(worktree.items())},'conflicted_paths':sorted(p for p,s in index.items() if 0 not in s),
          'files':{k:hashlib.sha256(v).hexdigest() for k,v in sorted(items.items())},
          'not_run':['staged_snapshot_checks','normal_git_hooks','remote_ci','git_merge','index_updates']}
        dest.mkdir(exist_ok=False)
        for p,b in items.items():write_new(dest,p,b)
        write_new(dest,'receipt.json',(json.dumps(report,ensure_ascii=False,indent=2)+'\n').encode('utf8'))
        return report
    finally: blobs.close()

def main(argv=None):
    p=argparse.ArgumentParser(description=__doc__)
    for x in ('repo','out','head','merge-head'):p.add_argument('--'+x,required=True)
    p.add_argument('--verified-commit',help='Exact full SHA independently reviewed by the operator; no automatic trust is inferred')
    p.add_argument('--generator-blob');p.add_argument('--auditor-blob')
    p.add_argument('--dependency-blob',action='append',metavar='PATH=OID')
    a=p.parse_args(argv)
    if a.verified_commit is not None:
        if a.generator_blob is not None or a.auditor_blob is not None or a.dependency_blob is not None:raise Stop('mixed_pin_modes')
        deps=None
    else:
        if a.generator_blob is None or a.auditor_blob is None or a.dependency_blob is None:raise Stop('complete_pin_mode_required')
        deps={}
        for item in a.dependency_blob:
            path,sep,sha=item.partition('=')
            if not sep or path in deps: raise Stop('invalid_dependency_pin')
            deps[path]=sha
        if set(deps)!=set(DEPS):raise Stop('dependency_pins_required')
    result=preview(a.repo,a.out,a.head,a.merge_head,a.generator_blob,a.auditor_blob,deps,a.verified_commit)
    print(json.dumps({'state':result['state'],'generated_count':result['generated_count'],'canonical_spec_sha256':result['canonical_spec_sha256']},ensure_ascii=False))
if __name__=='__main__':
    try:main()
    except (Stop,OSError,KeyError,TypeError,ValueError,RecursionError) as e:print('STOP: '+str(e),file=sys.stderr);sys.exit(1)
