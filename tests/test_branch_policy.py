"""Meaningful policy checks; synthetic Git object fixtures are retained, never cleaned."""
from copy import deepcopy
import datetime,json,os,subprocess,sys,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import check_branch_policy as policy

class BranchPolicyTests(unittest.TestCase):
    def setUp(self):
        self.spec=json.loads((ROOT/'docs/current/service_spec.json').read_text(encoding='utf-8'))
        self.server=self.spec['workflow']['server_work_branch']
        self.web=self.spec['workflow']['presentation_work_branch']
    def test_current_four_nodes_are_valid(self):
        self.assertEqual(policy.validate_governance(self.spec),[])
    def test_extra_permanent_developer_branch_is_rejected(self):
        s=deepcopy(self.spec)
        s['workflow']['branch_governance']['core_branches'].append(
            dict(name='feature/third-developer',kind='system',owner='test',parent='develop',pr_target='develop',status='active'))
        self.assertIn('Exactly four permanent branch nodes required',policy.validate_governance(s))
    def test_parent_cycle_is_rejected(self):
        s=deepcopy(self.spec);row=s['workflow']['branch_governance']['core_branches'][2]
        row['parent']=row['name'];row['pr_target']=row['name']
        self.assertIn('Branch parent cycle',policy.validate_governance(s))
    def test_parent_and_pr_target_cannot_diverge(self):
        s=deepcopy(self.spec);s['workflow']['branch_governance']['core_branches'][3]['pr_target']='main'
        self.assertIn('PR target must match registered parent',policy.validate_governance(s))
    def test_develop_requires_planning_declaration(self):
        e=policy.validate_staged('develop','development',[('M','docs/current/service_spec.json')],self.spec)
        self.assertIn('develop direct work requires JUNGSI_TEAM=planning declaration',e)
    def test_planning_docs_and_policy_administration_are_allowed(self):
        changes=[('M','docs/current/service_spec.json'),('M','scripts/check_branch_policy.py'),('M','.github/workflows/project-consistency.yml'),('M','apps/web/route_catalog.json'),('A','tests/test_branch_policy.py')]
        self.assertEqual(policy.validate_staged('develop','planning',changes,self.spec),[])
    def test_develop_cannot_directly_receive_runtime_or_migration(self):
        for path in ['src/jungsi_touch/application/platform.py','apps/web/src/app/page.tsx','database/migrations/002.sql','backend-runtime.lock.json']:
            self.assertTrue(policy.validate_staged('develop','planning',[('M',path)],self.spec),path)
    def test_unregistered_and_retired_branches_reject_work(self):
        self.assertTrue(policy.validate_staged('feature/random-task','development',[],self.spec))
        self.assertTrue(policy.validate_staged('feature/overall-analysis-service','development',[],self.spec))
    def test_file_removal_is_rejected_even_for_planning(self):
        self.assertIn('File deletion requires explicit user scope: README.md',
                      policy.validate_staged('develop','planning',[('D','README.md')],self.spec))
    def test_local_main_commit_is_rejected(self):
        self.assertTrue(policy.validate_staged('main','planning',[('M','docs/current/service_spec.json')],self.spec))
    def test_two_permanent_work_prs_target_develop(self):
        self.assertEqual(policy.validate_pr(self.server,'develop',[('M','src/jungsi_touch/application/platform.py')],self.spec),[])
        self.assertEqual(policy.validate_pr(self.web,'develop',[('A','apps/web/src/app/page.tsx')],self.spec),[])
    def test_child_ui_pr_cannot_skip_its_parent(self):
        spec=deepcopy(self.spec);child='feature/presentation-task/independent-screen'
        spec['workflow']['branch_governance']['additional_branches'].append(
            dict(name=child,kind='presentation_task',owner='presentation',parent=self.web,pr_target=self.web,
                 status='active',temporary=True,purpose='independent review',base_commit='a'*40))
        self.assertEqual(policy.validate_pr(child,self.web,[('A','apps/web/src/app/page4.tsx')],spec),[])
        self.assertTrue(policy.validate_pr(child,'develop',[],spec))
    def test_two_development_nodes_do_not_merge_directly_to_each_other(self):
        self.assertTrue(policy.validate_pr(self.server,self.web,[],self.spec))
    def test_contract_proposal_cannot_add_runtime_implementation(self):
        head='feature/planning-presentation-contracts'
        self.assertIn('Retired branch cannot receive new work: '+head,policy.validate_pr(head,'develop',[('M','docs/current/service_spec.json')],self.spec))
        self.assertTrue(policy.validate_pr(head,'develop',[('M','src/jungsi_touch/application/platform.py')],self.spec))
    def test_main_only_accepts_final_develop(self):
        self.assertTrue(policy.validate_pr(self.web,'main',[],self.spec))
        self.assertIn('main release acceptance is not ready',policy.validate_pr('develop','main',[],self.spec))
    def test_ready_gate_cannot_hide_pending_checks(self):
        s=deepcopy(self.spec);s['workflow']['branch_governance']['release_gate']['state']='ready'
        self.assertIn('Release ready requires every acceptance check and evidence',policy.validate_governance(s))
        for check in s['workflow']['branch_governance']['release_gate']['checks']:
            check['status']='passed';check['evidence']='synthetic proof reference'
        self.assertEqual(policy.validate_governance(s),[])
        self.assertEqual(policy.validate_pr('develop','main',[],s),[])
    def test_new_child_needs_registered_parent_and_fixed_start(self):
        s=deepcopy(self.spec);s['workflow']['branch_governance']['additional_branches'].append(
            dict(name='feature/system-task/new-contract',kind='system_task',owner='system',parent=self.server,pr_target=self.server,status='active',temporary=True,purpose='independent review',base_commit='a'*40))
        self.assertEqual(policy.validate_governance(s),[])
        s['workflow']['branch_governance']['additional_branches'][-1]['base_commit']='unfixed'
        self.assertIn('Temporary branch needs purpose and fixed starting SHA',policy.validate_governance(s))
    def test_duplicate_branch_is_rejected(self):
        s=deepcopy(self.spec)
        s['workflow']['branch_governance']['additional_branches'].append(deepcopy(s['workflow']['branch_governance']['core_branches'][2]))
        self.assertIn('Duplicate registered branch',policy.validate_governance(s))

class RetainedGitHistoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec=json.loads((ROOT/'docs/current/service_spec.json').read_text(encoding='utf-8'))
        cls.git_env={k:v for k,v in os.environ.items() if not k.startswith('GIT_')}
        stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        cls.repo=ROOT/'outputs/branch_policy_tests'/stamp
        cls.repo.mkdir(parents=True,exist_ok=False)
        cls.call('init','--initial-branch=fixture')
        cls.call('config','core.longpaths','true')
    @classmethod
    def call(cls,*arguments,input=None):
        result=subprocess.run(['git','-c','gc.auto=0','-c','maintenance.auto=false','-c','core.longpaths=true',
                               '-c','user.name=Synthetic policy fixture',
                               '-c','user.email=synthetic@example.invalid',*arguments],
                              cwd=cls.repo,input=input,capture_output=True,env=cls.git_env)
        if result.returncode:raise AssertionError(result.stderr.decode('utf-8',errors='replace'))
        return result.stdout.strip()
    @classmethod
    def commit(cls,files,parents=()):
        nested={}
        for name,value in files.items():
            node=nested;parts=name.split('/')
            for part in parts[:-1]:node=node.setdefault(part,{})
            node[parts[-1]]=value
        def tree(node):
            entries=[]
            for name,value in sorted(node.items()):
                if isinstance(value,dict):mode,kind,oid='040000','tree',tree(value)
                else:mode,kind,oid='100644','blob',cls.call('hash-object','-w','--stdin',input=value)
                entries.append((mode+' '+kind+' '+oid.decode('ascii')+'\t'+name+'\n').encode('utf-8'))
            return cls.call('mktree',input=b''.join(entries))
        args=['commit-tree',tree(nested).decode('ascii'),'-m','Synthetic retained policy history']
        for parent in parents:args+=['-p',parent]
        return cls.call(*args).decode('ascii')
    def setUp(self):
        # Restore only process environment after each test; no filesystem cleanup.
        self.env_patch=patch.dict(os.environ,self.git_env,clear=True)
        self.env_patch.start()
    def tearDown(self):
        self.env_patch.stop()
    def test_fixture_ignores_git_hook_repository_environment(self):
        with patch.dict(os.environ,{'GIT_DIR':str(ROOT/'.git'),'GIT_INDEX_FILE':str(ROOT/'untouched_index')}):
            self.assertEqual(self.call('rev-parse','--git-dir'),b'.git')
        self.assertFalse(any(k.startswith('GIT_') for k in self.git_env))
    def files(self,spec=None,**extra):
        return {'docs/current/service_spec.json':json.dumps(spec or self.spec).encode('utf-8'),**extra}
    def test_new_direct_business_commit_to_develop_fails(self):
        first=self.commit(self.files())
        second=self.commit(self.files(**{'src/jungsi_touch/application/platform.py':b'synthetic change\n'}),(first,))
        with patch.object(policy,'ROOT',self.repo):
            errors=policy.validate_push_history('develop',first,second,self.spec,team='planning',local=True)
        self.assertTrue(any('scope' in v for v in errors))
    def test_planning_direct_push_passes_and_missing_declaration_fails(self):
        first=self.commit(self.files())
        second=self.commit(self.files(**{'docs/current/synthetic_note.md':b'planning note\n'}),(first,))
        with patch.object(policy,'ROOT',self.repo):
            self.assertEqual(policy.validate_push_history('develop',first,second,self.spec,team='planning',local=True),[])
            self.assertTrue(policy.validate_push_history('develop',first,second,self.spec,team='development',local=True))
    def test_business_implementation_through_merge_commit_is_allowed(self):
        first=self.commit(self.files())
        work=self.commit(self.files(**{'src/jungsi_touch/application/platform.py':b'synthetic implementation\n'}),(first,))
        merged=self.commit(self.files(**{'src/jungsi_touch/application/platform.py':b'synthetic implementation\n'}),(first,work))
        with patch.object(policy,'ROOT',self.repo):
            self.assertEqual(policy.validate_push_history('develop',first,merged,self.spec),[])
    def test_non_fast_forward_and_ref_removal_fail(self):
        first=self.commit(self.files(**{'docs/current/note.md':b'first\n'}))
        unrelated=self.commit(self.files(**{'docs/current/note.md':b'other\n'}))
        with patch.object(policy,'ROOT',self.repo):
            self.assertIn('Non-fast-forward update is prohibited',policy.validate_push_history('develop',first,unrelated,self.spec))
            self.assertTrue(policy.validate_push_history('develop',first,policy.ZERO,self.spec))
    def test_previous_commits_before_policy_adoption_are_preserved(self):
        old=deepcopy(self.spec);old['workflow'].pop('branch_governance')
        first=self.commit(self.files(old))
        historic=self.commit(self.files(old,**{'src/jungsi_touch/application/platform.py':b'old implementation\n'}),(first,))
        adoption=self.commit(self.files(**{'src/jungsi_touch/application/platform.py':b'old implementation\n'}),(historic,))
        with patch.object(policy,'ROOT',self.repo):
            self.assertEqual(policy.validate_push_history('develop',first,adoption,self.spec),[])
    def test_initial_governance_adoption_cannot_introduce_runtime_work(self):
        old=deepcopy(self.spec);old['workflow'].pop('branch_governance')
        first=self.commit(self.files(old))
        adoption=self.commit(self.files(**{'src/jungsi_touch/application/platform.py':b'new runtime implementation\n'}),(first,))
        with patch.object(policy,'ROOT',self.repo):
            errors=policy.validate_push_history('develop',first,adoption,self.spec)
            self.assertTrue(any('Direct planning change outside' in error for error in errors))
    def test_initial_governance_adoption_validates_reserved_core_registry(self):
        old=deepcopy(self.spec);old['workflow'].pop('branch_governance')
        first=self.commit(self.files(old))
        candidate=deepcopy(self.spec)
        candidate['workflow']['branch_governance']['service_delegation_policy']['protected_paths']=[]
        adoption=self.commit(self.files(candidate),(first,))
        with patch.object(policy,'ROOT',self.repo):
            self.assertTrue(policy.validate_push_history('develop',first,adoption,self.spec))
    def test_github_pr_enforces_parent_from_base_policy(self):
        first=self.commit(self.files())
        work=self.commit(self.files(**{'apps/web/src/app/page.tsx':b'synthetic screen\n'}),(first,))
        merged=self.commit(self.files(**{'apps/web/src/app/page.tsx':b'synthetic screen\n'}),(first,work))
        event={'pull_request':{'head':{'ref':'feature/presentation-foundation','sha':work,'repo':{'full_name':'synthetic/repo'}},
                               'base':{'ref':'develop','sha':first,'repo':{'full_name':'synthetic/repo'}}}}
        with patch.object(policy,'ROOT',self.repo):
            self.assertEqual(policy.validate_event('pull_request',event,merged,self.spec),[])
            event['pull_request']['base']['ref']='main'
            self.assertTrue(policy.validate_event('pull_request',event,merged,self.spec))
    def test_github_push_distinguishes_direct_runtime_and_merge(self):
        first=self.commit(self.files())
        work=self.commit(self.files(**{'src/jungsi_touch/application/platform.py':b'synthetic implementation\n'}),(first,))
        merged=self.commit(self.files(**{'src/jungsi_touch/application/platform.py':b'synthetic implementation\n'}),(first,work))
        event={'ref':'refs/heads/develop','before':first,'after':work,'deleted':False}
        with patch.object(policy,'ROOT',self.repo):
            self.assertTrue(policy.validate_event('push',event,work,self.spec))
            event['after']=merged
            self.assertEqual(policy.validate_event('push',event,merged,self.spec),[])
    def test_pull_request_cannot_register_itself_outside_base_policy(self):
        first=self.commit(self.files())
        candidate=deepcopy(self.spec)
        candidate['workflow']['branch_governance']['additional_branches'].append(
            dict(name='feature/system-task/undeclared',kind='system_task',owner='system',parent=candidate['workflow']['server_work_branch'],
                 pr_target=candidate['workflow']['server_work_branch'],status='active',temporary=True,purpose='test only',base_commit=first))
        work=self.commit(self.files(candidate),(first,))
        event={'pull_request':{'head':{'ref':'feature/system-task/undeclared','sha':work,'repo':{'full_name':'synthetic/repo'}},
                               'base':{'ref':candidate['workflow']['server_work_branch'],'sha':first,'repo':{'full_name':'synthetic/repo'}}}}
        with patch.object(policy,'ROOT',self.repo):
            self.assertTrue(any('Unregistered branch' in v for v in policy.validate_event('pull_request',event,work,self.spec)))
    def test_new_release_integration_ref_cannot_bypass_existing_history(self):
        after=self.commit(self.files())
        with patch.object(policy,'ROOT',self.repo):
            self.assertIn('Permanent release/integration refs must already exist',policy.validate_push_history('develop',policy.ZERO,after,self.spec))

class RetainedMergeScopeTests(unittest.TestCase):
    """Native two-parent trees/indexes; every repository, object and index is retained."""
    def setUp(self):
        import uuid
        self.spec=json.loads((ROOT/'docs/current/service_spec.json').read_text(encoding='utf-8'))
        self._blobs={};self._trees={}
        self.spec['workflow']['branch_governance']['merge_scope_policy']={
            'format':'jungsi.merge-scope/v1','adoption':'commits_with_policy_marker_only'}
        # Only this retained synthetic repository registers an active planning task.
        # The operational retired branch and its history remain unchanged.
        self.branch='feature/planning-task/synthetic-merge-policy'
        self.git_env={k:v for k,v in os.environ.items() if not k.startswith('GIT_')}
        self.env_patch=patch.dict(os.environ,self.git_env,clear=True);self.env_patch.start()
        stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'_'+uuid.uuid4().hex[:8]
        self.repo=ROOT/'outputs/branch_policy_merge_tests'/stamp
        self.repo.mkdir(parents=True,exist_ok=False)
        self.git_dir=ROOT/'outputs/branch_policy_git'/stamp
        self.git_dir.parent.mkdir(parents=True,exist_ok=True)
        self.call('init','--initial-branch=fixture','--separate-git-dir='+str(self.git_dir))
        # Retained snapshot paths can exceed Windows Git's default stat limit.
        self.call('config','core.longpaths','true')
        (self.repo/'fixture.json').write_bytes(json.dumps({'repository':str(self.repo),
            'retained_git_dir':str(self.git_dir),'cleanup_performed':False}).encode('utf-8'))
        base_spec=deepcopy(self.spec)
        self.seed=self.commit(self.files(base_spec))
        self.spec['workflow']['branch_governance']['additional_branches'].append(
            dict(name=self.branch,kind='planning_task',owner='synthetic-planning-fixture',
                 parent='develop',pr_target='develop',status='active',temporary=True,
                 purpose='Explicit isolated synthetic merge-policy regression',base_commit=self.seed))
        self.assertEqual(policy.validate_governance(self.spec),[])
        self.base=self.commit(self.files(),(self.seed,))

    def tearDown(self):
        self.env_patch.stop()

    def call(self,*args,input=None,raw=False):
        result=subprocess.run(['git','-c','gc.auto=0','-c','maintenance.auto=false','-c','core.longpaths=true',
            '-c','user.name=Synthetic policy fixture','-c','user.email=synthetic@example.invalid',
            *args],cwd=self.repo,input=input,capture_output=True,env=self.git_env)
        if result.returncode:raise AssertionError(result.stderr.decode('utf-8',errors='replace'))
        return result.stdout if raw else result.stdout.strip()

    def files(self,spec=None,**extra):
        return {'docs/current/service_spec.json':json.dumps(spec or self.spec,indent=2).encode('utf-8'),
                'README.md':b'Preserved synthetic baseline\n',**extra}

    def commit(self,files,parents=()):
        nested={}
        for name,value in files.items():
            node=nested;parts=name.split('/')
            for part in parts[:-1]:node=node.setdefault(part,{})
            node[parts[-1]]=value
        def tree(node):
            entries=[]
            for name,value in sorted(node.items()):
                if isinstance(value,dict):mode,kind,oid='040000','tree',tree(value)
                else:
                    if value not in self._blobs:self._blobs[value]=self.call('hash-object','-w','--stdin',input=value)
                    mode,kind,oid='100644','blob',self._blobs[value]
                entries.append((mode+' '+kind+' '+oid.decode()+'\t'+name+'\n').encode('utf-8'))
            key=b''.join(entries)
            if key not in self._trees:self._trees[key]=self.call('mktree',input=key)
            return self._trees[key]
        args=['commit-tree',tree(nested).decode(),'-m','Retained merge scope fixture']
        for parent in parents:args+=['-p',parent]
        return self.call(*args).decode()

    def divergent(self,*,left=None,right=None):
        left_files=self.files(**{'docs/current/own_note.md':b'Owned planning note\n'})
        right_files=self.files(**{'src/jungsi_touch/application/platform.py':b'Approved incoming implementation\n'})
        left_files.update(left or {});right_files.update(right or {})
        return self.commit(left_files,(self.base,)),self.commit(right_files,(self.base,))

    def expected(self,left,right):
        with patch.object(policy,'ROOT',self.repo):
            return policy.automatic_merge(left,right,self.spec)

    def tree_files(self,tree):
        files={}
        for record in self.call('ls-tree','-r','-z',tree).split(bytes([0])):
            if not record:continue
            header,name=record.split(b'\t',1);mode,kind,oid=header.split()
            self.assertEqual(kind,b'blob')
            files[name.decode()]=self.call('cat-file','blob',oid.decode(),raw=True)
        # Blob bytes, including trailing newlines, are retained exactly.
        return files

    def stage(self,left,right,tree,*,branch=None,merge_head=None,approved=None):
        self.call('update-ref','refs/heads/'+(branch or self.branch),left)
        self.call('symbolic-ref','HEAD','refs/heads/'+(branch or self.branch))
        if approved is not False:self.call('update-ref','refs/remotes/origin/develop',approved or right)
        self.call('read-tree',tree)
        if merge_head is not False:
            with (self.git_dir/'MERGE_HEAD').open('x',encoding='ascii',newline='\n') as stream:
                stream.write((right if merge_head is None else merge_head)+'\n')

    def check(self,*,branch=None,team='planning',candidate=None):
        with patch.object(policy,'ROOT',self.repo):
            return policy.validate_staged_snapshot(branch or self.branch,team,candidate or self.spec)

    def test_pure_develop_merge_into_registered_planning_task_passes(self):
        left,right=self.divergent();tree,conflicts=self.expected(left,right)
        self.assertEqual(conflicts,[]);self.stage(left,right,tree)
        self.assertEqual(self.check(),[])

    def test_pure_develop_merge_into_both_permanent_work_branches_passes(self):
        for branch in (self.spec['workflow']['server_work_branch'],self.spec['workflow']['presentation_work_branch']):
            left,right=self.divergent();tree,_=self.expected(left,right)
            with patch.object(policy,'ROOT',self.repo):
                self.call('update-ref','refs/heads/'+branch,left)
                self.call('symbolic-ref','HEAD','refs/heads/'+branch)
                direct=policy.change_records(left,tree)
                self.assertEqual(policy.validate_staged(branch,'development',direct,self.spec),[])
        # Actual MERGE_HEAD/index validation uses one retained merge state per repository.
        branch=self.spec['workflow']['server_work_branch'];self.stage(left,right,tree,branch=branch)
        self.assertEqual(self.check(branch=branch,team='development'),[])

    def test_ordinary_planning_runtime_commit_is_still_rejected(self):
        left,right=self.divergent()
        self.stage(left,right,right,merge_head=False)
        self.assertTrue(any('scope' in e for e in self.check()))

    def test_ordinary_owned_system_runtime_commit_remains_allowed(self):
        left,right=self.divergent();branch=self.spec['workflow']['server_work_branch']
        tree,_=self.expected(left,right)
        self.stage(left,right,tree,branch=branch,merge_head=False)
        self.assertEqual(self.check(branch=branch,team='development'),[])

    def test_forged_merge_parent_is_not_an_approved_develop_tip(self):
        left,right=self.divergent();tree,_=self.expected(left,right)
        rogue=self.commit(self.files(**{'src/rogue.py':b'Unapproved code\n'}),(self.base,))
        self.stage(left,right,tree,merge_head=rogue)
        self.assertTrue(any('approved develop parent' in e for e in self.check()))

    def test_remote_parent_tip_cannot_be_replaced_by_local_tip(self):
        left,right=self.divergent();tree,_=self.expected(left,right)
        self.stage(left,right,tree,approved=self.base);self.call('update-ref','refs/heads/develop',right)
        self.assertTrue(any('approved develop parent' in e for e in self.check()))

    def test_multiple_merge_parents_fail_closed(self):
        left,right=self.divergent();tree,_=self.expected(left,right)
        self.stage(left,right,tree,merge_head=right+'\n'+left)
        with self.assertRaisesRegex(ValueError,'Exactly one fixed'):self.check()

    def test_symbolic_merge_parent_fails_closed(self):
        left,right=self.divergent();tree,_=self.expected(left,right)
        self.stage(left,right,tree,merge_head='refs/remotes/origin/develop')
        with self.assertRaisesRegex(ValueError,'Exactly one fixed'):self.check()

    def test_main_is_not_a_sync_work_destination(self):
        left,right=self.divergent();tree,_=self.expected(left,right)
        self.stage(left,right,tree,branch='main')
        self.assertTrue(any('main accepts final' in e for e in self.check(branch='main')))

    def test_retired_or_unregistered_branch_cannot_claim_sync(self):
        left,right=self.divergent();tree,_=self.expected(left,right)
        self.stage(left,right,tree,branch='feature/not-registered')
        self.assertTrue(any('Unregistered branch' in e for e in self.check(branch='feature/not-registered')))

    def test_candidate_cannot_reparent_the_trusted_branch_for_sync(self):
        trusted=deepcopy(self.spec)
        row=next(r for r in trusted['workflow']['branch_governance']['additional_branches'] if r['name']==self.branch)
        row['parent']=trusted['workflow']['server_work_branch'];row['pr_target']=row['parent']
        left=self.commit(self.files(trusted),(self.base,));right=self.commit(self.files(),(self.base,))
        # The trusted source may conflict in planning metadata, but parent authorization runs first.
        self.stage(left,right,right)
        self.assertTrue(any('registered develop child' in e for e in self.check()))

    def test_direct_runtime_edit_hidden_in_clean_merge_is_rejected(self):
        left,right=self.divergent();tree,_=self.expected(left,right)
        files=self.tree_files(tree);files['src/jungsi_touch/application/platform.py']=b'Unauthorized direct edit'
        actual=self.commit(files);self.stage(left,right,actual)
        self.assertTrue(any('platform.py' in e and 'scope' in e for e in self.check()))

    def test_direct_runtime_edit_on_permanent_sync_also_requires_separate_commit(self):
        left,right=self.divergent();tree,_=self.expected(left,right)
        files=self.tree_files(tree);files['src/jungsi_touch/application/platform.py']=b'Additional owned code'
        actual=self.commit(files);branch=self.spec['workflow']['server_work_branch']
        self.stage(left,right,actual,branch=branch)
        self.assertTrue(any('scope' in e for e in self.check(branch=branch,team='development')))

    def test_direct_planning_resolution_is_allowed(self):
        left,right=self.divergent();tree,_=self.expected(left,right)
        files=self.tree_files(tree);files['docs/current/resolution.md']=b'Allowed merge note'
        actual=self.commit(files);self.stage(left,right,actual)
        self.assertEqual(self.check(),[])

    def test_total_staged_file_removal_is_rejected(self):
        left,right=self.divergent();tree,_=self.expected(left,right)
        files=self.tree_files(tree);files.pop('README.md')
        actual=self.commit(files);self.stage(left,right,actual)
        self.assertTrue(any('File deletion requires explicit' in e for e in self.check()))

    def test_removal_of_new_incoming_file_is_also_rejected(self):
        left,right=self.divergent();tree,_=self.expected(left,right)
        files=self.tree_files(tree);files.pop('src/jungsi_touch/application/platform.py')
        actual=self.commit(files);self.stage(left,right,actual)
        self.assertTrue(any('File deletion requires explicit' in e for e in self.check()))

    def conflict_parents(self,path):
        base=self.commit(self.files(**{path:b'base line\n'}),(self.base,))
        left=self.commit(self.files(**{path:b'planning side\n'}),(base,))
        right=self.commit(self.files(**{path:b'incoming side\n','src/incoming.py':b'Approved incoming bytes\n'}),(base,))
        return left,right

    def test_allowed_planning_conflict_resolution_with_incoming_runtime_passes(self):
        left,right=self.conflict_parents('docs/current/conflict_note.md')
        tree,conflicts=self.expected(left,right)
        self.assertEqual(conflicts,['docs/current/conflict_note.md'])
        files=self.tree_files(tree);files['docs/current/conflict_note.md']=b'Resolved planning text'
        actual=self.commit(files);self.stage(left,right,actual)
        self.assertEqual(self.check(),[])

    def test_actual_service_spec_conflict_can_be_resolved_inside_planning_scope(self):
        left_spec=deepcopy(self.spec);right_spec=deepcopy(self.spec)
        left_spec['fixture_note']='planning';right_spec['fixture_note']='develop'
        left=self.commit(self.files(left_spec),(self.base,))
        right=self.commit(self.files(right_spec,**{'src/incoming.py':b'Incoming runtime bytes'}),(self.base,))
        tree,conflicts=self.expected(left,right)
        self.assertEqual(conflicts,['docs/current/service_spec.json'])
        files=self.tree_files(tree);resolved=deepcopy(right_spec);resolved['fixture_note']='reviewed resolution'
        files['docs/current/service_spec.json']=json.dumps(resolved,indent=2).encode()
        actual=self.commit(files);self.stage(left,right,actual)
        self.assertEqual(self.check(candidate=resolved),[])

    def test_nonplanning_conflict_cannot_use_the_sync_exemption(self):
        left,right=self.conflict_parents('src/conflicted.py')
        self.stage(left,right,right)
        with self.assertRaisesRegex(ValueError,'outside planning scope'):self.check()

    def test_planning_conflict_does_not_hide_a_direct_runtime_edit(self):
        left,right=self.conflict_parents('docs/current/conflict_note.md');tree,_=self.expected(left,right)
        files=self.tree_files(tree);files['docs/current/conflict_note.md']=b'Allowed resolution'
        files['src/incoming.py']=b'Forbidden code resolution'
        actual=self.commit(files);self.stage(left,right,actual)
        self.assertTrue(any('src/incoming.py' in e and 'scope' in e for e in self.check()))

    def test_remaining_conflict_markers_are_rejected(self):
        left,right=self.conflict_parents('docs/current/conflict_note.md');tree,_=self.expected(left,right)
        self.stage(left,right,tree)
        self.assertTrue(any('conflict markers remain' in e for e in self.check()))

    def test_unmerged_index_stages_are_rejected(self):
        left,right=self.divergent();tree,_=self.expected(left,right);self.stage(left,right,tree)
        oid=self.call('hash-object','-w','--stdin',input=b'Unresolved planning text').decode()
        stages=('100644 '+oid+' 2\tdocs/current/unresolved.md\n100644 '+oid+
                ' 3\tdocs/current/unresolved.md\n').encode()
        self.call('update-index','--index-info',input=stages)
        self.assertTrue(any('Unresolved index stages' in e for e in self.check()))

    def test_unrecognized_merge_output_is_rejected(self):
        fake=subprocess.CompletedProcess([],1,stdout=b'not-an-object\x00unknown\x00',stderr=b'')
        with patch.object(policy.subprocess,'run',return_value=fake):
            with self.assertRaisesRegex(ValueError,'Unrecognized automatic'):policy.automatic_merge('a'*40,'b'*40,self.spec)

    def test_planning_conflict_delete_modify_is_not_implicitly_approved(self):
        base=self.commit(self.files(**{'docs/current/note.md':b'base\n'}),(self.base,))
        left=self.commit(self.files(**{'docs/current/note.md':b'changed\n'}),(base,))
        right=self.commit(self.files(),(base,));self.stage(left,right,left)
        with self.assertRaisesRegex(ValueError,'Deletion or structural'):self.check()

    def test_new_clean_two_parent_push_and_pr_match_staged_result(self):
        left,right=self.divergent();tree,_=self.expected(left,right)
        merged=self.call('commit-tree',tree,'-p',left,'-p',right,'-m','Approved retained merge').decode()
        self.stage(left,right,tree);self.assertEqual(self.check(),[])
        event={'pull_request':{'head':{'ref':self.branch,'sha':merged,'repo':{'full_name':'synthetic/repo'}},
            'base':{'ref':'develop','sha':right,'repo':{'full_name':'synthetic/repo'}}}}
        with patch.object(policy,'ROOT',self.repo):
            self.assertEqual(policy.validate_push_history(self.branch,left,merged,self.spec),[])
            self.assertEqual(policy.validate_event('pull_request',event,merged,self.spec),[])

    def test_new_merge_runtime_injection_is_rejected_in_push_and_pr(self):
        left,right=self.divergent();tree,_=self.expected(left,right)
        files=self.tree_files(tree);files['src/jungsi_touch/application/platform.py']=b'Injected merge edit'
        merged=self.commit(files,(left,right))
        event={'pull_request':{'head':{'ref':self.branch,'sha':merged,'repo':{'full_name':'synthetic/repo'}},
            'base':{'ref':'develop','sha':right,'repo':{'full_name':'synthetic/repo'}}}}
        with patch.object(policy,'ROOT',self.repo):
            self.assertTrue(any('scope' in e for e in policy.validate_push_history(self.branch,left,merged,self.spec)))
            self.assertTrue(any('scope' in e for e in policy.validate_event('pull_request',event,merged,self.spec)))

    def test_planning_conflict_resolution_matches_push_policy(self):
        left,right=self.conflict_parents('docs/current/conflict_note.md');tree,_=self.expected(left,right)
        files=self.tree_files(tree);files['docs/current/conflict_note.md']=b'Accepted planning resolution'
        merged=self.commit(files,(left,right))
        with patch.object(policy,'ROOT',self.repo):
            self.assertEqual(policy.validate_push_history('develop',left,merged,self.spec),[])

    def test_old_merge_history_is_preserved_before_marker_adoption(self):
        old=deepcopy(self.spec);old['workflow']['branch_governance'].pop('merge_scope_policy')
        first=self.commit(self.files(old))
        incoming=self.commit(self.files(old,**{'src/old.py':b'Old merged content'}),(first,))
        historic=self.commit(self.files(old,**{'src/old.py':b'Historical direct merge resolution'}),(first,incoming))
        adoption=self.commit(self.files(**{'src/old.py':b'Historical direct merge resolution'}),(historic,))
        with patch.object(policy,'ROOT',self.repo):
            self.assertEqual(policy.validate_push_history('develop',first,adoption,self.spec),[])

    def test_removing_adopted_marker_cannot_restore_the_old_merge_exemption(self):
        left,right=self.divergent();old=deepcopy(self.spec);old['workflow']['branch_governance'].pop('merge_scope_policy')
        merged=self.commit(self.files(old,**{'src/rogue.py':b'Injected after removing marker'}),(left,right))
        with patch.object(policy,'ROOT',self.repo):
            errors=policy.validate_push_history('develop',left,merged,self.spec)
            self.assertIn('Adopted merge scope policy cannot be removed',errors)

    def test_missing_origin_ref_cannot_be_replaced_by_a_local_parent(self):
        left,right=self.divergent();tree,_=self.expected(left,right)
        self.stage(left,right,tree,approved=False);self.call('update-ref','refs/heads/develop',right)
        with self.assertRaisesRegex(ValueError,'origin/develop parent ref is unavailable'):self.check()

    def test_pure_develop_merge_into_presentation_branch_passes(self):
        left,right=self.divergent();tree,_=self.expected(left,right)
        branch=self.spec['workflow']['presentation_work_branch'];self.stage(left,right,tree,branch=branch)
        self.assertEqual(self.check(branch=branch,team='presentation'),[])

    def test_delete_then_restore_in_new_history_cannot_hide_deletion(self):
        removed=self.files();removed.pop('README.md')
        deletion=self.commit(removed,(self.base,))
        restored=self.commit(self.files(),(deletion,))
        with patch.object(policy,'ROOT',self.repo):
            errors=policy.validate_push_history(self.spec['workflow']['server_work_branch'],self.base,restored,self.spec)
            self.assertIn('File deletion requires explicit user scope: README.md',errors)

    def test_confirmed_develop_policy_history_is_not_a_new_service_policy_edit(self):
        approved=deepcopy(self.spec)
        approved['workflow']['branch_governance']['service_delegation_policy']['allowed_work']+=' Synthetic approved planning note.'
        integration=self.commit(self.files(approved),(self.base,))
        candidate=self.commit(self.files(approved,**{'docs/current/pro_note.md':b'Synthetic service note'}),(integration,))
        self.call('update-ref','refs/remotes/origin/develop',integration)
        with patch.object(policy,'ROOT',self.repo):
            self.assertEqual(policy.validate_push_history(self.spec['workflow']['server_work_branch'],self.base,candidate,approved),[])

    def test_unapproved_policy_edit_then_restore_is_rejected_despite_equal_final_policy(self):
        forged=deepcopy(self.spec)
        forged['workflow']['branch_governance']['service_delegation_policy']['allowed_work']+=' Synthetic unapproved policy edit.'
        changed=self.commit(self.files(forged),(self.base,))
        restored=self.commit(self.files(),(changed,))
        self.call('update-ref','refs/remotes/origin/develop',self.base)
        with patch.object(policy,'ROOT',self.repo):
            self.assertIn('Service delegation ownership policy is managed on planning develop',
                policy.validate_push_history(self.spec['workflow']['server_work_branch'],self.base,restored,self.spec))

    def test_local_develop_ref_cannot_approve_policy_history_without_origin(self):
        approved=deepcopy(self.spec)
        approved['workflow']['branch_governance']['service_delegation_policy']['allowed_work']+=' Synthetic local ref only.'
        candidate=self.commit(self.files(approved),(self.base,))
        self.call('update-ref','refs/heads/develop',candidate)
        with patch.object(policy,'ROOT',self.repo):
            errors=policy.validate_push_history(self.spec['workflow']['server_work_branch'],self.base,candidate,approved)
            self.assertIn('Service delegation ownership policy is managed on planning develop',errors)
            self.assertIn('Approved origin/develop history is unavailable for policy inheritance',errors)

    def test_confirmed_ancestry_cannot_hide_policy_removal_and_restore(self):
        removed=deepcopy(self.spec)
        removed['workflow']['branch_governance'].pop('service_delegation_policy')
        removal=self.commit(self.files(removed),(self.base,))
        restored=self.commit(self.files(),(removal,))
        self.call('update-ref','refs/remotes/origin/develop',restored)
        with patch.object(policy,'ROOT',self.repo):
            self.assertIn('Adopted service delegation policy cannot be removed',
                policy.validate_push_history(self.spec['workflow']['server_work_branch'],self.base,restored,self.spec))

    def test_new_octopus_merge_cannot_receive_a_merge_exemption(self):
        left,right=self.divergent();tree,_=self.expected(left,right)
        merged=self.call('commit-tree',tree,'-p',left,'-p',right,'-p',self.seed,'-m','Retained octopus fixture').decode()
        with patch.object(policy,'ROOT',self.repo):
            self.assertIn('Exactly two merge parents are required',policy.validate_push_history('develop',left,merged,self.spec))

    def test_staged_ordinary_policy_downgrade_is_rejected(self):
        left,right=self.divergent();old=deepcopy(self.spec);old['workflow']['branch_governance'].pop('merge_scope_policy')
        staged=self.commit(self.files(old));self.stage(left,right,staged,merge_head=False)
        self.assertIn('Adopted merge scope policy cannot be removed',self.check(candidate=old))



class FrontendServiceDelegationTests(unittest.TestCase):
    def setUp(self):
        self.spec=json.loads((ROOT/'docs/current/service_spec.json').read_bytes())
        self.web=self.spec['workflow']['presentation_work_branch']
        self.server=self.spec['workflow']['server_work_branch']
        self.path='src/jungsi_touch/application/platform.py'
        self.source=b'FACTOR = 2\nclass PlatformService:\n    def statistics(self, values):\n        return sorted(value * FACTOR for value in values)\n    def report(self):\n        return "old"\n'
    def inspect(self,after,before=None):
        return policy.validate_delegated_python_symbols(self.web,[self.path],self.spec,
            lambda p:self.source if before is None else before,lambda p:after)
    def test_screen_team_can_write_services_DTO_and_shared_HTTP_adapters(self):
        paths=['database/README.md','src/jungsi_touch/application/screen_catalog.py','supabase/functions/_shared/jungsi/application/screen_report.ts',
               'src/jungsi_touch/application/platform.py',*self.spec['workflow']['branch_governance']['service_delegation_policy']['shared_http_paths']]
        self.assertEqual(policy.validate_staged(self.web,'presentation',[('M',p) for p in paths],self.spec),[])
    def test_screen_team_cannot_edit_DB_or_calculation_core(self):
        paths=['database/migrations/new.sql','src/jungsi_touch/university_conversion.py','src/jungsi_touch/application/overall_analysis.py',
               'src/jungsi_touch/infrastructure/postgres_repository.py','supabase/functions/_shared/jungsi/domain/percentile.ts',
               'supabase/functions/_shared/current_admission_owner_sql.ts','supabase/functions/_shared/jungsi/application/report_actions.ts']
        for path in paths:
            with self.subTest(path=path):
                self.assertTrue(policy.validate_staged(self.web,'presentation',[('M',path)],self.spec))
                self.assertTrue(policy.validate_pr(self.web,'develop',[('M',path)],self.spec))
    def test_existing_system_owner_keeps_DB_and_engine_scope(self):
        self.assertEqual(policy.validate_staged(self.server,'development',[('M','database/migrations/new.sql'),('M','src/jungsi_touch/percentile.py')],self.spec),[])
    def test_registered_screen_child_has_same_boundary(self):
        s=deepcopy(self.spec);name='feature/presentation-task/synthetic-services'
        s['workflow']['branch_governance']['additional_branches'].append(dict(name=name,kind='presentation_task',owner='synthetic',parent=self.web,pr_target=self.web,status='active',temporary=True,purpose='test',base_commit='a'*40))
        self.assertTrue(policy.validate_delegated_service_paths(name,['database/synthetic.sql'],s))
        self.assertEqual(policy.validate_delegated_service_paths(name,['src/jungsi_touch/application/synthetic.py'],s),[])
    def test_authorized_incoming_develop_core_is_not_a_direct_screen_edit(self):
        changes=[('M','database/migrations/approved.sql'),('M','src/jungsi_touch/percentile.py')]
        self.assertEqual(policy.validate_staged(self.web,'presentation',changes,self.spec,direct_changes=[('M','docs/current/service_spec.json')]),[])
        self.assertTrue(policy.validate_staged(self.web,'presentation',changes,self.spec))
    def test_screen_cannot_self_relax_ownership_registry(self):
        candidate=deepcopy(self.spec);candidate['workflow']['branch_governance']['service_delegation_policy']['protected_paths']=[]
        self.assertTrue(policy.delegation_policy_edit_errors(self.web,self.spec,candidate))
        self.assertEqual(policy.delegation_policy_edit_errors('develop',self.spec,candidate),[])
        candidate['workflow']['branch_governance'].pop('service_delegation_policy')
        self.assertIn('Adopted service delegation policy cannot be removed',policy.delegation_policy_edit_errors(self.web,self.spec,candidate))
    def test_missing_historical_governance_never_authorizes_a_new_feature_policy(self):
        legacy={'workflow':{}}
        self.assertEqual(policy.delegation_policy_edit_errors(self.web,legacy,legacy),[])
        self.assertTrue(policy.delegation_policy_edit_errors(self.web,legacy,self.spec))
    def test_non_calculation_service_body_in_mixed_file_is_editable(self):
        self.assertEqual(self.inspect(self.source.replace(b'return "old"',b'return "new UI heading"')),[])
    def test_calculation_body_cannot_change_under_service_authority(self):
        changed=self.source.replace(b'value * FACTOR',b'value + FACTOR')
        self.assertTrue(self.inspect(changed))
    def test_calculation_global_binding_and_class_base_are_protected(self):
        self.assertTrue(self.inspect(self.source.replace(b'FACTOR = 2',b'FACTOR = 3')))
        self.assertTrue(self.inspect(self.source.replace(b'class PlatformService:',b'class PlatformService(NewBase):')))
    def test_new_global_cannot_shadow_used_calculation_builtin(self):
        self.assertTrue(self.inspect(self.source+b'\ndef sorted(value):\n    return []\n'))
    def test_missing_or_unparseable_calculation_never_passes(self):
        self.assertTrue(self.inspect(self.source.replace(b'def statistics(',b'def renamed(')))
        self.assertTrue(self.inspect(b'broken ('))
    def test_whitespace_and_comments_do_not_lock_mixed_file(self):
        changed=self.source.replace(b'FACTOR = 2',b'FACTOR=2 # same meaning').replace(b'return sorted',b'# retained calculation\n        return sorted')
        self.assertEqual(self.inspect(changed),[])

if __name__=='__main__':unittest.main()
