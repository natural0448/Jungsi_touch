"""Check registered branches, planning changes and PR parents without deleting files.
Local JUNGSI_TEAM is a declaration, not authenticated GitHub authorization.
"""
from __future__ import annotations
import argparse,json,os,re,subprocess,sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
SPEC_PATH='docs/current/service_spec.json'
ZERO='0'*40
KINDS={'release','integration','system','presentation','system_task','presentation_task','planning_task','release_task','retired'}

def branches(spec):
    policy=spec['workflow']['branch_governance']
    return {row['name']:row for row in policy['core_branches']+policy['additional_branches']}

def validate_governance(spec):
    policy=spec.get('workflow',{}).get('branch_governance')
    if not policy:return ['Missing registered branch governance']
    errors=[]
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

def validate_deletions(changes):
    return ['File deletion requires explicit user scope: '+name for status,name in changes if status=='D']

def validate_staged(branch,team,changes,spec):
    errors=validate_work_branch(branch,spec)+validate_deletions(changes)
    row=branches(spec).get(branch,{})
    if branch=='main':errors.append('main accepts final develop pull requests, not local commits')
    if branch=='develop':
        if team!='planning':errors.append('develop direct work requires JUNGSI_TEAM=planning declaration')
        errors.extend(validate_planning_paths([name for _,name in changes],spec))
    elif row.get('kind')=='planning_task':errors.extend(validate_planning_paths([name for _,name in changes],spec))
    return sorted(set(errors))

def validate_pr(head,base,changes,spec):
    errors=validate_work_branch(head,spec)+validate_work_branch(base,spec)+validate_deletions(changes)
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

def load_spec(revision):return json.loads(git('show',revision+':'+SPEC_PATH).decode('utf-8'))

def change_records(before=None,after=None,*,staged=False):
    args=['diff','--name-status','--no-renames','-z']
    if staged:args.append('--cached')
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
    if before!=ZERO:
        errors.extend(validate_deletions(change_records(before,after)))
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
        errors.extend(validate_pr(head,base,change_records(common,pr['head']['sha']),spec))
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
        errors=validate_governance(spec)+validate_staged(branch,os.environ.get('JUNGSI_TEAM'),change_records(staged=True),spec)
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
