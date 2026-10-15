"""Check registered branches, planning changes and PR parents without deleting files.
Local JUNGSI_TEAM is a declaration, not authenticated GitHub authorization.
"""
from __future__ import annotations
import argparse,hashlib,json,os,re,subprocess,sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
SPEC_PATH='docs/current/service_spec.json'
ZERO='0'*40
KINDS={'release','integration','system','presentation','system_task','presentation_task','planning_task','release_task','retired'}

DELETION_FORMAT='jungsi.file-deletion-scope/v1'
DELETION_BRANCH='feature/presentation-foundation'
DELETION_PATHS=frozenset({
    'apps/web/src/lib/contract.ts','apps/web/src/lib/api/synthetic-fixtures.ts',
    'apps/web/src/app/admissions/possibilities/actions.ts','apps/web/src/components/pending-page.tsx'})
USER_EVIDENCE_IDS=('01a0ccde-6f3d-7772-acd3-3eaca9a67b65','01a10bf5-8841-74a3-93e2-f2e2de8ac674','01a10bf5-898b-7180-8442-3bfd4d1c2914')
USER_APPROVAL_TEXT='그럼 완료될 때까지 작업해 필요하다면 개발팀과 데이터팀 두군대와 협력해서 작업해'
REQUEST_SHA256='686e51deb7f29cc259e5fb8d63e1c16456b16aebfa5fc9f4c04e9988d0d694e3'


def canonical_hash(value):
    return hashlib.sha256(json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode('utf-8')).hexdigest()


def deletion_record(spec):
    return spec.get('workflow',{}).get('branch_governance',{}).get('file_deletion_policy',{}).get('record')


def validate_deletion_registry(spec):
    policy = spec.get('workflow', {}).get('branch_governance', {}).get('file_deletion_policy')
    if policy is None:
        return []
    try:
        if not (policy['format'] == DELETION_FORMAT and policy['default'] == 'deny'):
            raise ValueError('Invalid exact file deletion approval registry')
        record = policy['record']
        if not isinstance(record, dict):
            raise ValueError('Invalid exact file deletion approval registry')
        if not set(record) == {'id', 'origin_branch', 'target_parent', 'source_commit', 'scope', 'executor_scope', 'developer_scope', 'reason', 'user_evidence', 'source_request_sha256', 'files', 'preservation', 'activation', 'record_sha256'}:
            raise ValueError('Invalid exact file deletion approval registry')
        if not (record['origin_branch'] == DELETION_BRANCH and record['target_parent'] == 'develop'):
            raise ValueError('Invalid exact file deletion approval registry')
        if not record['id'] == 'DEV006-7-four-retained-drafts':
            raise ValueError('Invalid exact file deletion approval registry')
        if not record['scope'] == 'exact_tracked_four_files_first_deletion_only':
            raise ValueError('Invalid exact file deletion approval registry')
        if not record['executor_scope'] == 'external_presentation_team_only':
            raise ValueError('Invalid exact file deletion approval registry')
        if not record['developer_scope'] == 'registry_checker_and_synthetic_tests_only_no_actual_deletion':
            raise ValueError('Invalid exact file deletion approval registry')
        if not record['activation'] == 'preexisting_trusted_develop_registration_required':
            raise ValueError('Invalid exact file deletion approval registry')
        if not (record['reason'] and re.fullmatch('[0-9a-f]{40}', record['source_commit']) and (record['source_commit'] != ZERO)):
            raise ValueError('Invalid exact file deletion approval registry')
        proof = record['user_evidence']
        if not tuple((proof[k] for k in ('thread_id', 'turn_id', 'message_id'))) == USER_EVIDENCE_IDS:
            raise ValueError('Invalid exact file deletion approval registry')
        if not (proof['text'] == USER_APPROVAL_TEXT and proof['text_sha256'] == hashlib.sha256(USER_APPROVAL_TEXT.encode('utf-8')).hexdigest()):
            raise ValueError('Invalid exact file deletion approval registry')
        if not (proof['interpretation'] and record['source_request_sha256'] == REQUEST_SHA256):
            raise ValueError('Invalid exact file deletion approval registry')
        rows = record['files']
        if not (len(rows) == 4 and {r['path'] for r in rows} == DELETION_PATHS):
            raise ValueError('Invalid exact file deletion approval registry')
        if not [r['path'] for r in rows] == sorted(DELETION_PATHS):
            raise ValueError('Invalid exact file deletion approval registry')
        for row in rows:
            if not (set(row) == {'path', 'blob', 'mode', 'sha256'} and row['mode'] == '100644'):
                raise ValueError('Invalid exact file deletion approval registry')
            if not (re.fullmatch('[0-9a-f]{40}', row['blob']) and row['blob'] != ZERO):
                raise ValueError('Invalid exact file deletion approval registry')
            if not re.fullmatch('[0-9a-f]{64}', row['sha256']):
                raise ValueError('Invalid exact file deletion approval registry')
        preserved = record['preservation']
        if not (preserved['originals_and_previous_versions_retained'] is True and preserved['source_commit_and_blobs_retained'] is True):
            raise ValueError('Invalid exact file deletion approval registry')
        if not (preserved['manifest_sha256'] == canonical_hash(rows) and re.fullmatch(r'outputs/service_review/[0-9]{8}T[0-9]{12}Z/original-preservation\.json', preserved['local_receipt'])):
            raise ValueError('Invalid exact file deletion approval registry')
        if not re.fullmatch('[0-9a-f]{64}', record['record_sha256']):
            raise ValueError('Invalid exact file deletion approval registry')
        if not record['record_sha256'] == canonical_hash({k: v for k, v in record.items() if k != 'record_sha256'}):
            raise ValueError('Invalid exact file deletion approval registry')
    except (ValueError, KeyError, TypeError, AttributeError):
        return ['Invalid exact file deletion approval registry']
    return []



def deletion_registry_sticky(trusted,candidate):
    old=deletion_record(trusted)
    return ['Preexisting deletion approval cannot be removed or rewritten'] if old and old!=deletion_record(candidate) else []


class DeletionAuthority:
    """Only preexisting registration on the trusted develop first-parent history."""
    def __init__(self,observed_tips=()):
        if git('rev-parse','--is-shallow-repository').decode().strip()!='false':raise ValueError('Complete trusted deletion history is required')
        self.tip=approved_develop_tip();self.spec=load_spec(self.tip)
        if validate_deletion_registry(self.spec):raise ValueError('Invalid trusted deletion approval')
        self.record=deletion_record(self.spec)
        if not self.record:raise ValueError('Deletion approval is not registered on trusted develop')
        self.source=self.record['source_commit'];self.rows={r['path']:r for r in self.record['files']}
        self.cache={};self.histories={};self.origins={}
        self.observed_tips=tuple(tip for tip in observed_tips if tip and tip!=ZERO)
        self.grant=None
        commits=git('rev-list','--first-parent','--reverse',self.tip,'--').decode().split()
        for commit in commits:
            if not git('ls-tree',commit,'--',SPEC_PATH):continue
            if deletion_record(load_spec(commit))==self.record:
                self.grant=commit;break
        if not self.grant:raise ValueError('Preexisting develop registration history is unavailable')
        for path,row in self.rows.items():
            entry=self.entry(self.source,path)
            if entry!=(row['mode'],row['blob']):raise ValueError('Approved source blob/mode is unavailable or mismatched')
            if hashlib.sha256(git('cat-file','blob',row['blob'])).hexdigest()!=row['sha256']:
                raise ValueError('Preserved source byte hash is mismatched')

    def entry(self,revision,path):
        line=git('ls-tree',revision,'--',path).decode('utf-8').strip()
        if not line:return None
        meta,sep,name=line.partition('\t');parts=meta.split()
        if not sep or name!=path or len(parts)!=3 or parts[1]!='blob':raise ValueError('Unrecognized approved file entry')
        return parts[0],parts[2]

    def changes(self,commit):
        if commit not in self.cache:
            parents=git('rev-list','--parents','-n','1',commit,'--').decode().split()[1:]
            changes=change_records(parents[0],commit) if parents else []
            self.cache[commit]=(parents,changes)
        return self.cache[commit]

    def since_source(self,tip):
        if tip not in self.histories:
            self.histories[tip]=git('rev-list','--reverse','--topo-order',tip,'--not',self.source,'--').decode().split()
        return self.histories[tip]

    def origin_deletions(self,tip,path):
        """Distinct one-parent deletion origins in the entire retained DAG."""
        if tip not in self.origins:
            origins={name:set() for name in DELETION_PATHS}
            for commit in self.since_source(tip):
                parents,changes=self.changes(commit)
                if len(parents)==1:
                    for status,name in changes:
                        if status=='D' and name in origins:origins[name].add(commit)
            self.origins[tip]=origins
        return self.origins[tip][path]

    def unique_origin(self,commit,path,event_tip):
        # Include both event parents/destination history and confirmed remote heads.
        # Excluding the push "before" can hide an already consumed parallel D1.
        tips=set(self.observed_tips)|{event_tip,self.tip,self.source_remote()}
        origins=set()
        for tip in tips:origins.update(self.origin_deletions(tip,path))
        return origins==(set() if commit=='INDEX' else {commit})

    def source_remote(self):
        value=git('show-ref','--verify','--hash','refs/remotes/origin/'+DELETION_BRANCH).decode().strip()
        if not re.fullmatch('[0-9a-f]{40}',value) or not ancestor(self.source,value):raise ValueError('Trusted origin source branch history is unavailable')
        return value

    def first(self,commit,parent,path,branch,event_tip):
        if not ancestor(self.grant,parent) or not ancestor(self.source,parent):return False
        if commit!='INDEX' and deletion_record(load_spec(commit))!=self.record:return False
        if deletion_record(load_spec(parent))!=self.record:return False
        if self.entry(parent,path)!=(self.rows[path]['mode'],self.rows[path]['blob']):return False
        lineage=git('rev-list','--first-parent',event_tip,'--').decode().split()
        if branch==DELETION_BRANCH and (commit=='INDEX' or commit in lineage):pass
        else:
            remote=self.source_remote()
            if commit not in git('rev-list','--first-parent',remote,'--').decode().split():return False
            if branch!='develop' and not ancestor(commit,self.tip):return False
        if not self.unique_origin(commit,path,event_tip):return False
        # Every introduced side-parent is inspected, not just final net diff.
        # A modify/restore or delete/restore cannot recycle this record.
        for previous in self.since_source(parent):
            if any(name==path for status,name in self.changes(previous)[1]):return False
        return True

    def inherited(self,commit,parents,path):
        if len(parents)!=2 or self.entry(parents[1],path) is not None:return False
        if deletion_record(load_spec(commit))!=self.record:return False
        expected,_=automatic_merge(parents[0],parents[1],self.spec)
        if change_records(expected,commit):
            if any(name==path for status,name in change_records(expected,commit)):return False
        remote=self.source_remote()
        nodes=[]
        for node in self.since_source(parents[1]):
            previous,changes=self.changes(node)
            if len(previous)==1 and ('D',path) in changes:nodes.append((node,previous[0]))
        if len(nodes)!=1:return False
        node,parent=nodes[0]
        if not ancestor(node,remote):return False
        return self.first(node,parent,path,DELETION_BRANCH,remote)


def registry_history_errors(before,after):
    args=['rev-list','--reverse','--topo-order',after]
    if before and before!=ZERO:args+=['--not',before]
    args+=['--'];errors=[]
    for commit in git(*args).decode().split():
        if not git('ls-tree',commit,'--',SPEC_PATH):continue
        current=load_spec(commit);errors+=validate_deletion_registry(current)
        parents=git('rev-list','--parents','-n','1',commit,'--').decode().split()[1:]
        for parent in parents:
            if git('ls-tree',parent,'--',SPEC_PATH):errors+=deletion_registry_sticky(load_spec(parent),current)
    return sorted(set(errors))


def inspect_deletion_events(branch,before,after,*,staged=False):
    """Prove first events and inherited merges; never execute a deletion."""
    events=[]
    if staged:
        changes=change_records(staged=True)
        events=[('INDEX',[before],name) for status,name in changes if status=='D']
    else:
        args=['rev-list','--reverse','--topo-order',after]
        if before and before!=ZERO:args+=['--not',before]
        args+=['--']
        for commit in git(*args).decode().split():
            parents=git('rev-list','--parents','-n','1',commit,'--').decode().split()[1:]
            if parents:
                events.extend((commit,parents,name) for status,name in change_records(parents[0],commit) if status=='D')
    history_errors=[] if staged else registry_history_errors(before,after)
    if not events:return set(),history_errors
    authority=None;errors=history_errors;allowed=set()
    try:authority=DeletionAuthority((before,after))
    except ValueError as error:errors.append(str(error))
    for commit,parents,path in events:
        valid=False
        if authority and path in DELETION_PATHS:
            try:
                if commit=='INDEX' or len(parents)==1:
                    valid=authority.first(commit,parents[0],path,branch,before if staged else after)
                elif len(parents)==2:valid=authority.inherited(commit,parents,path)
            except ValueError as error:errors.append(str(error))
        if valid:allowed.add(path)
        else:errors.append('File deletion requires explicit user scope: '+path)
    return allowed,sorted(set(errors))

def branches(spec):
    policy=spec['workflow']['branch_governance']
    return {row['name']:row for row in policy['core_branches']+policy['additional_branches']}

def validate_governance(spec):
    policy=spec.get('workflow',{}).get('branch_governance')
    if not policy:return ['Missing registered branch governance']
    errors=[]
    merge_policy=policy.get('merge_scope_policy')
    if merge_policy is not None and (not isinstance(merge_policy,dict) or merge_policy.get('format')!='jungsi.merge-scope/v1'):
        errors.append('Unsupported merge scope policy')
    rows=policy.get('core_branches',[])+policy.get('additional_branches',[])
    if policy.get('format')!='jungsi.branch-governance/v1':errors.append('Unsupported branch governance')
    names=[row.get('name') for row in rows]
    if len(names)!=len(set(names)):errors.append('Duplicate registered branch')
    expected={'main':'release','develop':'integration',spec['workflow']['server_work_branch']:'system',spec['workflow']['presentation_work_branch']:'presentation'}
    core={row['name']:row['kind'] for row in policy.get('core_branches',[])}
    if core!=expected or len(core)!=4:errors.append('Exactly four permanent branch nodes required')
    registered={row['name']:row for row in rows}
    for row in rows:
        name=row.get('name','')
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_./-]*',name) or any(v in name for v in ['..','//','@{']) or name.endswith(('/','.','.lock')):
            errors.append('Invalid registered branch name')
        if row.get('kind') not in KINDS or not row.get('owner'):errors.append('Registered branch needs kind and owner')
        if row['name']!='main' and row.get('parent') not in registered:errors.append('Unknown registered parent')
        if row.get('status')=='active' and row['name']!='main' and row.get('pr_target')!=row.get('parent'):
            errors.append('PR target must match registered parent')
        chain=set();node=row
        while node.get('parent') in registered:
            if node['name'] in chain:errors.append('Branch parent cycle');break
            chain.add(node['name']);node=registered[node['parent']]
        if row.get('temporary'):
            if not row.get('purpose') or not re.fullmatch(r'[0-9a-f]{40}',row.get('base_commit','')):
                errors.append('Temporary branch needs purpose and fixed starting SHA')
            if not row.get('exception'):
                matches=[t for t in policy.get('child_templates',[]) if row.get('kind')==t['kind'] and name.startswith(t['pattern'].split('<slug>')[0]) and registered.get(row.get('parent'),{}).get('kind') in t['allowed_parent_kinds']]
                if not matches:errors.append('Temporary branch must use a registered child template')
    gate=policy.get('release_gate',{})
    if gate.get('state') not in {'not_ready','ready'} or not gate.get('checks'):errors.append('Missing release acceptance gate')
    if gate.get('state')=='ready' and any(c.get('status')!='passed' or not c.get('evidence') for c in gate['checks']):
        errors.append('Release ready requires every acceptance check and evidence')
    errors.extend(validate_deletion_registry(spec))
    return sorted(set(errors))

def validate_work_branch(branch,spec):
    row=branches(spec).get(branch)
    if row is None:return ['Unregistered branch: '+branch]
    if row.get('status')!='active':return ['Retired branch cannot receive new work: '+branch]
    return []

def validate_planning_paths(paths,spec):
    policy=spec['workflow']['branch_governance']
    allowed=set(policy['planning_direct_paths'])|set(spec['current_documents'].values())|{
        'apps/web/README.md','apps/web/route_catalog.json','database/README.md','src/jungsi_touch/application/route_catalog.json'}
    return ['Direct planning change outside document/administration scope: '+path for path in paths
            if path not in allowed and not path.startswith(tuple(policy['planning_direct_prefixes']))]

def validate_deletions(changes,approved=()):
    return ['File deletion requires explicit user scope: '+name for status,name in changes if status=='D' and not (name in approved and name in DELETION_PATHS)]

def validate_staged(branch,team,changes,spec,*,direct_changes=None,approved=()):
    direct=changes if direct_changes is None else direct_changes
    errors=validate_work_branch(branch,spec)+validate_deletions(changes,approved)+validate_deletions(direct,approved)
    row=branches(spec).get(branch,{})
    if branch=='main':errors.append('main accepts final develop pull requests, not local commits')
    if branch=='develop':
        if team!='planning':errors.append('develop direct work requires JUNGSI_TEAM=planning declaration')
        errors.extend(validate_planning_paths([name for _,name in direct],spec))
    elif row.get('kind')=='planning_task':errors.extend(validate_planning_paths([name for _,name in direct],spec))
    return sorted(set(errors))

def validate_pr(head,base,changes,spec,*,approved=()):
    errors=validate_work_branch(head,spec)+validate_work_branch(base,spec)+validate_deletions(changes,approved)
    row=branches(spec).get(head,{})
    if row.get('pr_target')!=base:errors.append('PR target must be registered parent: '+head+' -> '+base)
    if head=='main':errors.append('main is a release destination, not a work branch')
    if base=='main':
        if head!='develop':errors.append('main only accepts develop')
        if spec['workflow']['branch_governance']['release_gate']['state']!='ready':errors.append('main release acceptance is not ready')
    if row.get('kind')=='planning_task':errors.extend(validate_planning_paths([name for _,name in changes],spec))
    return sorted(set(errors))

def git(*arguments):
    result=subprocess.run(['git',*arguments],cwd=ROOT,capture_output=True)
    if result.returncode:raise ValueError('Required Git history is unavailable for branch policy')
    return result.stdout

def load_spec(revision):return json.loads(git('cat-file','blob',revision+':'+SPEC_PATH).decode('utf-8'))

def change_records(before=None,after=None,*,staged=False):
    args=['diff','--name-status','--no-renames','-z']
    if staged:
        args.append('--cached')
        if before is not None:args.append(before)
    else:args.extend([before,after])
    args.append('--')
    parts=git(*args).split(b'\0')
    if parts and not parts[-1]:parts.pop()
    if len(parts)%2:raise ValueError('Unexpected Git changed-path output')
    return [(parts[i].decode('ascii'),parts[i+1].decode('utf-8')) for i in range(0,len(parts),2)]

def ancestor(before,after):
    result=subprocess.run(['git','merge-base','--is-ancestor',before,after],cwd=ROOT,capture_output=True)
    if result.returncode not in (0,1):raise ValueError('Required ancestor is unavailable')
    return result.returncode==0

MERGE_SCOPE_FORMAT='jungsi.merge-scope/v1'

def merge_scope_adopted(spec):
    return spec.get('workflow',{}).get('branch_governance',{}).get('merge_scope_policy',{}).get('format')==MERGE_SCOPE_FORMAT

def automatic_merge(before,incoming,spec):
    """Reconstruct both parents; only regular-file planning conflicts are resolvable."""
    result=subprocess.run(['git','-c','gc.auto=0','-c','maintenance.auto=false',
        'merge-tree','--write-tree','--no-messages','-z',before,incoming],cwd=ROOT,capture_output=True)
    if result.returncode not in (0,1):raise ValueError('Automatic merge history is unavailable')
    parts=result.stdout.split(bytes([0]))
    if parts and not parts[-1]:parts.pop()
    if not parts or not re.fullmatch(b'[0-9a-f]{40}',parts[0]):
        raise ValueError('Unrecognized automatic merge output')
    tree=parts[0].decode('ascii')
    conflicts={}
    for record in parts[1:]:
        header,separator,path=record.partition(b'\t')
        fields=header.split(b' ')
        if not separator or len(fields)!=3 or fields[0] not in (b'100644',b'100755') or not re.fullmatch(b'[0-9a-f]{40}',fields[1]) or fields[2] not in (b'1',b'2',b'3'):
            raise ValueError('Unrecognized or non-file merge conflict')
        name=path.decode('utf-8')
        if not name or name.startswith('/') or any(part in ('','..','.') for part in name.split('/')):
            raise ValueError('Unrecognized merge conflict path')
        stage=int(fields[2])
        if stage in conflicts.setdefault(name,{}):raise ValueError('Duplicate merge conflict stage')
        conflicts[name][stage]=fields[0]
    if result.returncode==0 and conflicts or result.returncode==1 and not conflicts:
        raise ValueError('Automatic merge conflict status is inconsistent')
    if any(not {2,3}.issubset(stages) for stages in conflicts.values()):
        raise ValueError('Deletion or structural merge conflicts require separate approval')
    if validate_planning_paths(list(conflicts),spec):
        raise ValueError('Merge conflict outside planning scope')
    return tree,sorted(conflicts)

def unresolved_markers(conflicts,revision=None):
    errors=[]
    for name in conflicts:
        data=git('show',(':'+name) if revision is None else revision+':'+name)
        if re.search(rb'(?m)^(?:<{7,}|>{7,})(?: |$)',data):
            errors.append('Planning merge conflict markers remain: '+name)
    return errors

def staged_merge_head():
    """Read worktree-aware MERGE_HEAD without changing Git state."""
    location=Path(git('rev-parse','--git-path','MERGE_HEAD').decode('utf-8').strip())
    if not location.is_absolute():location=ROOT/location
    if not location.exists():return None
    if not location.is_file() or location.is_symlink():raise ValueError('Invalid merge state')
    values=location.read_text(encoding='ascii').splitlines()
    if len(values)!=1 or not re.fullmatch(r'[0-9a-f]{40}',values[0]):
        raise ValueError('Exactly one fixed merge parent is required')
    return values[0]

def approved_develop_tip():
    # Only the confirmed tracking ref authorizes incoming sync content; no local-ref fallback.
    result=subprocess.run(['git','show-ref','--verify','--hash','refs/remotes/origin/develop'],
                          cwd=ROOT,capture_output=True)
    if result.returncode:raise ValueError('Approved origin/develop parent ref is unavailable')
    value=result.stdout.decode('ascii').strip()
    if not re.fullmatch(r'[0-9a-f]{40}',value):raise ValueError('Invalid approved parent ref')
    return value

def validate_staged_snapshot(branch,team,spec):
    changes=change_records(staged=True)
    incoming=staged_merge_head()
    trusted=load_spec('HEAD')
    sticky=[] if not merge_scope_adopted(trusted) or merge_scope_adopted(spec) else ['Adopted merge scope policy cannot be removed']
    sticky+=deletion_registry_sticky(trusted,spec)
    approved,deletion_errors=inspect_deletion_events(branch,git('rev-parse','HEAD').decode().strip(),None,staged=True) if incoming is None else (set(),[])
    if incoming is None:return sorted(set(sticky+deletion_errors+validate_staged(branch,team,changes,spec,approved=approved)))
    errors=sticky+validate_governance(trusted)+validate_work_branch(branch,trusted)
    row=branches(trusted).get(branch,{})
    if row.get('kind') not in {'planning_task','system','presentation'} or row.get('parent')!='develop':
        return sorted(set(errors+validate_staged(branch,team,changes,spec)+['Merge sync requires an active registered develop child']))
    errors+=deletion_registry_sticky(load_spec(incoming),spec)
    if incoming!=approved_develop_tip():
        return sorted(set(errors+validate_staged(branch,team,changes,spec)+['MERGE_HEAD is not the approved develop parent']))
    if git('ls-files','--unmerged','-z'):
        return sorted(set(errors+validate_staged(branch,team,changes,spec)+['Unresolved index stages cannot be committed']))
    expected,conflicts=automatic_merge(git('rev-parse','HEAD').decode().strip(),incoming,trusted)
    direct=change_records(expected,staged=True)
    # Sync exemptions apply only to reconstructed incoming content. Direct edits remain planning work.
    approved,deletion_errors=inspect_deletion_events(branch,git('rev-parse','HEAD').decode().strip(),incoming)
    if any(status=='D' for status,name in direct):deletion_errors+=validate_deletions(direct)
    errors+=deletion_errors+validate_staged(branch,team,changes,spec,direct_changes=direct,approved=approved)
    errors+=validate_staged(branch,team,changes,trusted,direct_changes=direct,approved=approved)
    errors+=validate_planning_paths([name for _,name in direct],trusted)
    errors+=unresolved_markers(conflicts)
    return sorted(set(errors))

def validate_merge_commit(branch,commit,spec):
    """New marker-bearing merges cannot hide direct code edits inside two parents."""
    parents=git('rev-list','--parents','-n','1',commit,'--').decode().split()[1:]
    if len(parents)!=2:return ['Exactly two merge parents are required']
    expected,conflicts=automatic_merge(parents[0],parents[1],spec)
    direct=change_records(expected,commit)
    errors=validate_deletions(direct)+validate_planning_paths([name for _,name in direct],spec)
    errors+=unresolved_markers(conflicts,commit)
    return sorted(set(errors))

def new_merge_history_errors(branch,before,after,spec,*,approved=()):
    errors=[]
    for commit in git('rev-list','--first-parent','--reverse',before+'..'+after,'--').decode().split():
        current=load_spec(commit)
        parents=git('rev-list','--parents','-n','1',commit,'--').decode().split()[1:]
        inherited=bool(parents and merge_scope_adopted(load_spec(parents[0])))
        if inherited and not merge_scope_adopted(current):
            errors.append('Adopted merge scope policy cannot be removed')
        if not merge_scope_adopted(current):continue
        if parents:errors.extend(validate_deletions(change_records(parents[0],commit),approved))
        if len(parents)>1:errors.extend(validate_merge_commit(branch,commit,spec))
    return sorted(set(errors))

def validate_push_history(branch,before,after,spec,*,team=None,local=False):
    errors=validate_work_branch(branch,spec)
    if after==ZERO:return ['Branch/ref deletion requires explicit user scope']
    if before==ZERO and branch in {'main','develop'}:errors.append('Permanent release/integration refs must already exist')
    if before!=ZERO and not ancestor(before,after):errors.append('Non-fast-forward update is prohibited')
    if branch=='main':
        if local:errors.append('main direct push is blocked; use a release-ready develop PR')
        elif spec['workflow']['branch_governance']['release_gate']['state']!='ready':errors.append('main release acceptance is not ready')
        if not local:
            parents=git('rev-list','--parents','-n','1',after,'--').decode().split()[1:]
            if len(parents)!=2 or (before!=ZERO and parents[0]!=before):errors.append('main push must be a release merge commit')
    if branch=='develop' and local and team!='planning':errors.append('develop direct push requires JUNGSI_TEAM=planning declaration')
    row=branches(spec).get(branch,{})
    if row.get('temporary') and not ancestor(row['base_commit'],after):errors.append('Temporary branch starting SHA must be an ancestor')
    approved,deletion_errors=inspect_deletion_events(branch,before,after)
    errors+=deletion_errors
    if before!=ZERO:
        errors+=deletion_registry_sticky(load_spec(before),load_spec(after))
        errors.extend(validate_deletions(change_records(before,after),approved))
        errors.extend(new_merge_history_errors(branch,before,after,spec,approved=approved))
        if branch=='develop' or row.get('kind')=='planning_task':
            commits=git('rev-list','--first-parent','--reverse',before+'..'+after,'--').decode().split()
            for commit in commits:
                parents=git('rev-list','--parents','-n','1',commit,'--').decode().split()[1:]
                # Before adoption, old commits remain historical; they are not new-policy work.
                current=load_spec(commit)
                if not current.get('workflow',{}).get('branch_governance'):continue
                if len(parents)==1:
                    errors.extend(validate_planning_paths([name for _,name in change_records(parents[0],commit)],spec))
    return sorted(set(errors))

def validate_event(event_name,event,revision,spec):
    candidate=load_spec(revision)
    errors=validate_governance(candidate)
    if event_name=='pull_request':
        pr=event['pull_request']; head=pr['head']['ref'];base=pr['base']['ref']
        if pr['head']['repo']['full_name']!=pr['base']['repo']['full_name']:errors.append('Work PR must use this repository registered branches')
        common=git('merge-base',pr['base']['sha'],pr['head']['sha']).decode().strip()
        approved,deletion_errors=inspect_deletion_events(head,common,pr['head']['sha'])
        errors+=deletion_errors+deletion_registry_sticky(spec,candidate)
        errors.extend(validate_pr(head,base,change_records(common,pr['head']['sha']),spec,approved=approved))
        errors.extend(new_merge_history_errors(head,common,pr['head']['sha'],spec,approved=approved))
        if base=='main' and candidate['workflow']['branch_governance']['release_gate']['state']!='ready':errors.append('Release candidate acceptance is not ready')
    elif event_name=='push':
        ref=event.get('ref','')
        if not ref.startswith('refs/heads/'):return ['Only registered branch push events are supported']
        if event.get('deleted') or event.get('after')==ZERO:return ['Branch/ref deletion requires explicit user scope']
        branch=ref[len('refs/heads/'):]
        # Authorized planning policy updates are evaluated from the candidate on develop.
        use=candidate if branch=='develop' else spec
        errors.extend(validate_push_history(branch,event['before'],event['after'],use))
    elif event_name!='workflow_dispatch':errors.append('Unsupported GitHub event')
    return sorted(set(errors))

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    modes=parser.add_mutually_exclusive_group(required=True)
    modes.add_argument('--staged',action='store_true')
    modes.add_argument('--push',nargs=3,metavar=('LOCAL_SHA','REMOTE_REF','REMOTE_SHA'))
    modes.add_argument('--github-event')
    parser.add_argument('--revision',default=None)
    args=parser.parse_args()
    if args.staged:
        raw=git('show',':'+SPEC_PATH);spec=json.loads(raw.decode('utf-8'))
        branch=git('symbolic-ref','--quiet','--short','HEAD').decode().strip()
        errors=validate_governance(spec)+validate_staged_snapshot(branch,os.environ.get('JUNGSI_TEAM'),spec)
        mode='staged';detail=branch
    elif args.push:
        after,ref,before=args.push
        if not ref.startswith('refs/heads/'):raise ValueError('Only registered branch refs may be pushed')
        if after==ZERO:raise ValueError('Branch/ref deletion requires explicit user scope')
        spec=load_spec(after)
        errors=validate_governance(spec)+validate_push_history(ref[len('refs/heads/'):],before,after,spec,team=os.environ.get('JUNGSI_TEAM'),local=True)
        mode='local_push';detail=ref
    else:
        revision=args.revision or os.environ['GITHUB_SHA']
        event=json.loads(Path(args.github_event).read_text(encoding='utf-8'))
        name=os.environ['GITHUB_EVENT_NAME']
        trusted_revision=event['pull_request']['base']['sha'] if name=='pull_request' else event.get('before')
        candidate=load_spec(revision)
        spec=load_spec(trusted_revision) if trusted_revision and trusted_revision!=ZERO else candidate
        if not spec.get('workflow',{}).get('branch_governance'):spec=candidate
        errors=validate_event(name,event,revision,spec)
        mode='github_'+name;detail=revision
    errors=sorted(set(errors))
    print(json.dumps({'branch_policy':mode,'target':detail,'passed':not errors,'errors':errors},ensure_ascii=False,indent=2))
    return 1 if errors else 0

if __name__=='__main__':
    try:raise SystemExit(main())
    except (ValueError,KeyError,OSError,json.JSONDecodeError) as error:
        print('Branch policy failed: '+str(error),file=sys.stderr);raise SystemExit(1)
