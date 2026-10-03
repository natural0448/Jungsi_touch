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
        child='feature/presentation-favorable'
        self.assertEqual(policy.validate_pr(child,self.web,[('A','apps/web/src/app/page4.tsx')],self.spec),[])
        self.assertTrue(policy.validate_pr(child,'develop',[],self.spec))
    def test_two_development_nodes_do_not_merge_directly_to_each_other(self):
        self.assertTrue(policy.validate_pr(self.server,self.web,[],self.spec))
    def test_contract_proposal_cannot_add_runtime_implementation(self):
        head='feature/planning-presentation-contracts'
        self.assertEqual(policy.validate_pr(head,'develop',[('M','docs/current/service_spec.json')],self.spec),[])
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
    @classmethod
    def call(cls,*arguments,input=None):
        result=subprocess.run(['git','-c','gc.auto=0','-c','maintenance.auto=false',
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

if __name__=='__main__':unittest.main()
