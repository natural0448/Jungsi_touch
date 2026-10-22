"""Exact approvals exercised with retained Git objects; no file is deleted."""
from copy import deepcopy
from pathlib import Path
import datetime,hashlib,json,os,subprocess,sys,unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import check_branch_policy as policy

class DeletionApprovalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.repo=ROOT/'outputs/deletion_tests'/datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        cls.repo.mkdir(parents=True,exist_ok=False)
        cls.git_env={k:v for k,v in os.environ.items() if not k.startswith('GIT_')}
        cls.call('init','--initial-branch=fixture')
        # Retained snapshot paths can exceed MAX_PATH on Windows; only this synthetic repository is configured.
        cls.call('config','core.longpaths','true')
        cls.spec=json.loads((ROOT/'docs/current/service_spec.json').read_bytes())
        old=deepcopy(cls.spec);old['workflow']['branch_governance'].pop('file_deletion_policy',None)
        cls.payload={path:('SYNTHETIC retained '+path+'\n').encode() for path in policy.DELETION_PATHS}
        cls.base=cls.commit(cls.files(old))
        cls.source=cls.commit(cls.files(old),(cls.base,))
        cls.approved=deepcopy(cls.spec);record=cls.approved['workflow']['branch_governance']['file_deletion_policy']['record']
        record['source_commit']=cls.source
        record['files']=[{'path':p,'mode':'100644','blob':cls.call('hash-object','--stdin',input=b).decode(),'sha256':hashlib.sha256(b).hexdigest()} for p,b in sorted(cls.payload.items())]
        cls.rehash(record)
        cls.grant=cls.commit(cls.files(cls.approved),(cls.base,))
        cls.sync=cls.commit(cls.files(cls.approved),(cls.source,cls.grant))
        cls.deleted=cls.commit(cls.files(cls.approved,removed=True),(cls.sync,))
    @classmethod
    def rehash(cls,r):
        r['preservation']['manifest_sha256']=policy.canonical_hash(r['files'])
        r['record_sha256']=policy.canonical_hash({k:v for k,v in r.items() if k!='record_sha256'})
    @classmethod
    def call(cls,*args,input=None):
        r=subprocess.run(['git','-c','gc.auto=0','-c','maintenance.auto=false','-c','user.name=Synthetic approval fixture','-c','user.email=synthetic@example.invalid',*args],cwd=cls.repo,env=cls.git_env,input=input,capture_output=True)
        if r.returncode:raise AssertionError(r.stderr.decode('utf-8',errors='replace'))
        return r.stdout.strip()
    @classmethod
    def files(cls,spec,removed=False):
        return {'docs/current/service_spec.json':(json.dumps(spec,ensure_ascii=False,indent=2)+'\n').encode(),'README.md':b'SYNTHETIC preserved\n',**({} if removed else cls.payload)}
    @classmethod
    def commit(cls,files,parents=(),message="Retained synthetic approval snapshot"):
        nested={}
        for path,content in files.items():
            node=nested;parts=path.split('/')
            for part in parts[:-1]:node=node.setdefault(part,{})
            node[parts[-1]]=content
        def tree(node):
            rows=[]
            for name,value in sorted(node.items()):
                if isinstance(value,dict):mode,kind,oid='040000','tree',tree(value)
                else:mode,kind,oid='100644','blob',cls.call('hash-object','-w','--stdin',input=value)
                rows.append((mode+' '+kind+' '+oid.decode()+'\t'+name+'\n').encode())
            return cls.call('mktree',input=b''.join(rows))
        args=['commit-tree',tree(nested).decode(),'-m',message]
        for parent in parents:args+=['-p',parent]
        return cls.call(*args).decode()
    def setUp(self):
        self.env_patch=patch.dict(os.environ,self.git_env,clear=True);self.env_patch.start();self.addCleanup(self.env_patch.stop)
        self.root_patch=patch.object(policy,'ROOT',self.repo);self.root_patch.start();self.addCleanup(self.root_patch.stop)
        self.call('update-ref','refs/remotes/origin/develop',self.grant)
        self.call('update-ref','refs/remotes/origin/'+policy.DELETION_BRANCH,self.sync)
        self.call('symbolic-ref','HEAD','refs/heads/'+policy.DELETION_BRANCH)
        self.call('update-ref','refs/heads/'+policy.DELETION_BRANCH,self.sync)
        self.call('read-tree',self.sync)
    def stage(self,commit,branch=None,head=None):
        branch=branch or policy.DELETION_BRANCH
        self.call('symbolic-ref','HEAD','refs/heads/'+branch)
        self.call('update-ref','refs/heads/'+branch,head or self.sync)
        self.call('read-tree',commit)
    def test_exact_first_deletion_passes_staged_and_push(self):
        self.stage(self.deleted)
        self.assertEqual(policy.validate_staged_snapshot(policy.DELETION_BRANCH,'presentation',self.approved),[])
        self.assertEqual(policy.validate_push_history(policy.DELETION_BRANCH,self.sync,self.deleted,self.approved),[])
    def test_spec_blob_can_be_read_from_a_retained_long_working_directory(self):
        # Git's revision/path disambiguation must not stat a >MAX_PATH filename on Windows.
        padding=max(1,190-len(str(self.repo))-len('/retained_object_read_'))
        long_root=self.repo/('retained_object_read_'+'x'*padding)
        long_root.mkdir(parents=True,exist_ok=False)
        with (long_root/'.git').open('x',encoding='utf-8',newline='\n') as stream:
            stream.write('gitdir: '+str(self.repo/'.git')+'\n')
        with patch.object(policy,'ROOT',long_root):
            self.assertEqual(policy.load_spec(self.grant),self.approved)
    def test_registered_source_PR_passes_and_wrong_parent_fails(self):
        event={'pull_request':{'head':{'ref':policy.DELETION_BRANCH,'sha':self.deleted,'repo':{'full_name':'synthetic/repo'}},'base':{'ref':'develop','sha':self.grant,'repo':{'full_name':'synthetic/repo'}}}}
        self.assertEqual(policy.validate_event('pull_request',event,self.deleted,self.approved),[])
        event['pull_request']['base']['ref']='main'
        self.assertTrue(policy.validate_event('pull_request',event,self.deleted,self.approved))
    def test_approved_source_deletion_is_inherited_by_merge(self):
        self.call('update-ref','refs/remotes/origin/'+policy.DELETION_BRANCH,self.deleted)
        merged=self.commit(self.files(self.approved,removed=True),(self.grant,self.deleted))
        self.assertEqual(policy.validate_push_history('develop',self.grant,merged,self.approved),[])
    def test_parallel_distinct_deletions_cannot_reconsume_in_push_or_PR(self):
        # D1 and D2 have equal trees but distinct native commit IDs and the same parent.
        d1=self.deleted
        d2=self.commit(self.files(self.approved,removed=True),(self.sync,),message='SYNTHETIC independent deletion D2')
        self.assertNotEqual(d1,d2)
        self.call('update-ref','refs/remotes/origin/'+policy.DELETION_BRANCH,d1)
        for parents in [(d2,d1),(d1,d2)]:
            with self.subTest(parents=parents):
                merged=self.commit(self.files(self.approved,removed=True),parents)
                self.assertTrue(policy.ancestor(d1,merged))
                expected='File deletion requires explicit user scope: '+sorted(policy.DELETION_PATHS)[0]
                self.assertIn(expected,policy.validate_push_history(policy.DELETION_BRANCH,d1,merged,self.approved))
                event={'pull_request':{'head':{'ref':policy.DELETION_BRANCH,'sha':merged,'repo':{'full_name':'synthetic/repo'}},
                    'base':{'ref':'develop','sha':self.grant,'repo':{'full_name':'synthetic/repo'}}}}
                self.assertIn(expected,policy.validate_event('pull_request',event,merged,self.approved))

    def test_trusted_remote_consumption_blocks_stale_staged_reuse(self):
        path=sorted(policy.DELETION_PATHS)[0]
        files=self.files(self.approved);files.pop(path)
        consumed=self.commit(files,(self.sync,),message='SYNTHETIC earlier remote consumption')
        self.call('update-ref','refs/remotes/origin/'+policy.DELETION_BRANCH,consumed)
        self.stage(self.deleted,head=self.sync)
        errors=policy.validate_staged_snapshot(policy.DELETION_BRANCH,'presentation',self.approved)
        self.assertEqual(errors,['File deletion requires explicit user scope: '+path])

    def test_parallel_sync_inspection_includes_existing_destination_history(self):
        d2=self.commit(self.files(self.approved,removed=True),(self.sync,),message='SYNTHETIC parallel sync deletion')
        self.call('update-ref','refs/remotes/origin/'+policy.DELETION_BRANCH,d2)
        approved,errors=policy.inspect_deletion_events(policy.DELETION_BRANCH,self.deleted,d2)
        self.assertEqual(approved,set())
        self.assertTrue(errors)

    def test_same_origin_deletion_is_carried_to_develop_and_ready_main(self):
        # Release readiness is explicit synthetic evidence in this repository only.
        ready=deepcopy(self.approved)
        gate=ready['workflow']['branch_governance']['release_gate'];gate['state']='ready'
        for check in gate['checks']:
            check['status']='passed';check['evidence']='SYNTHETIC release fixture only'
        ready_grant=self.commit(self.files(ready),(self.grant,))
        self.call('update-ref','refs/remotes/origin/develop',ready_grant)
        self.call('update-ref','refs/remotes/origin/'+policy.DELETION_BRANCH,self.deleted)
        integrated=self.commit(self.files(ready,removed=True),(ready_grant,self.deleted))
        self.assertEqual(policy.validate_push_history('develop',ready_grant,integrated,ready),[])
        self.call('update-ref','refs/remotes/origin/develop',integrated)
        main_before=self.commit(self.files(ready),(ready_grant,))
        release=self.commit(self.files(ready,removed=True),(main_before,integrated))
        self.assertEqual(policy.validate_push_history('main',main_before,release,ready),[])
        self.assertTrue(policy.validate_push_history('main',main_before,release,ready,local=True))

    def test_default_deny_without_registration(self):
        self.call('update-ref','refs/remotes/origin/develop',self.base)
        self.stage(self.deleted)
        self.assertTrue(policy.validate_staged_snapshot(policy.DELETION_BRANCH,'presentation',self.approved))
    def test_candidate_cannot_self_approve_same_commit(self):
        forged=self.commit(self.files(self.approved,removed=True),(self.source,))
        self.stage(forged,head=self.source)
        self.assertTrue(policy.validate_staged_snapshot(policy.DELETION_BRANCH,'presentation',self.approved))
    def test_registration_cannot_retroactively_approve_old_deletion(self):
        past=self.commit(self.files(self.approved,removed=True),(self.source,))
        self.assertTrue(policy.validate_push_history(policy.DELETION_BRANCH,self.source,past,self.approved))
    def test_wrong_executor_branch_is_rejected(self):
        self.stage(self.deleted,branch=self.spec['workflow']['server_work_branch'])
        self.assertTrue(policy.validate_staged_snapshot(self.spec['workflow']['server_work_branch'],'development',self.approved))
    def test_extra_unapproved_deletion_is_rejected(self):
        files=self.files(self.approved,removed=True);files.pop('README.md')
        deleted=self.commit(files,(self.sync,));self.stage(deleted)
        self.assertIn('File deletion requires explicit user scope: README.md',policy.validate_staged_snapshot(policy.DELETION_BRANCH,'presentation',self.approved))
    def test_modify_then_restore_cannot_reuse_baseline(self):
        path=sorted(policy.DELETION_PATHS)[0];files=self.files(self.approved);files[path]=b'SYNTHETIC changed\n'
        changed=self.commit(files,(self.sync,));restored=self.commit(self.files(self.approved),(changed,));deleted=self.commit(self.files(self.approved,removed=True),(restored,))
        self.stage(deleted,head=restored)
        self.assertTrue(policy.validate_staged_snapshot(policy.DELETION_BRANCH,'presentation',self.approved))
    def test_delete_restore_delete_cannot_reuse_approval(self):
        restored=self.commit(self.files(self.approved),(self.deleted,));deleted=self.commit(self.files(self.approved,removed=True),(restored,));self.stage(deleted,head=restored)
        self.assertTrue(policy.validate_staged_snapshot(policy.DELETION_BRANCH,'presentation',self.approved))
    def test_hidden_side_parent_delete_restore_is_rejected(self):
        side=self.commit(self.files(self.approved,removed=True),(self.sync,));restored=self.commit(self.files(self.approved),(side,));merged=self.commit(self.files(self.approved),(self.sync,restored))
        self.assertTrue(policy.validate_push_history(policy.DELETION_BRANCH,self.sync,merged,self.approved))
    def test_direct_merge_deletion_is_not_inherited(self):
        other=self.commit(self.files(self.approved),(self.sync,));merged=self.commit(self.files(self.approved,removed=True),(self.sync,other))
        self.assertTrue(policy.validate_push_history(policy.DELETION_BRANCH,self.sync,merged,self.approved))
    def test_modified_approval_cannot_be_rewritten(self):
        rewritten=deepcopy(self.approved);r=rewritten['workflow']['branch_governance']['file_deletion_policy']['record'];r['reason']='SYNTHETIC changed approval';self.rehash(r)
        self.stage(self.deleted)
        self.assertIn('Preexisting deletion approval cannot be removed or rewritten',policy.validate_staged_snapshot(policy.DELETION_BRANCH,'presentation',rewritten))
    def test_invalid_paths_hashes_and_evidence_fail_closed(self):
        for mutate in [lambda r:r['files'][0].update(path='apps/web/src/**'),lambda r:r['files'][0].update(path='../README.md'),lambda r:r['files'][0].update(path='apps/Web/src/lib/contract.ts'),lambda r:r['files'][0].update(path='data/private.csv'),lambda r:r['files'][0].update(blob='abc'),lambda r:r['files'][0].update(sha256='abc'),lambda r:r['files'][0].update(mode='120000'),lambda r:r['user_evidence'].update(message_id='old_unverified_claim'),lambda r:r.update(origin_branch='develop'),lambda r:r['preservation'].update(local_receipt='outputs/../Resource/private.json'),lambda r:r['preservation'].update(local_receipt='outputs/*/original-preservation.json')]:
            with self.subTest(mutate=mutate):
                spec=deepcopy(self.approved);r=spec['workflow']['branch_governance']['file_deletion_policy']['record'];mutate(r);self.rehash(r)
                self.assertTrue(policy.validate_governance(spec))
    def test_optimized_python_still_rejects_forged_user_evidence(self):
        wrong=deepcopy(self.approved);r=wrong['workflow']['branch_governance']['file_deletion_policy']['record'];r['user_evidence']['message_id']='SYNTHETIC forged message';self.rehash(r)
        code="import json,sys;sys.path.insert(0,'scripts');import check_branch_policy as p;s=json.load(sys.stdin);e=p.validate_deletion_registry(s);print(json.dumps(e));sys.exit(0 if e else 1)"
        result=subprocess.run([sys.executable,'-B','-O','-X','utf8','-c',code],cwd=ROOT,input=json.dumps(wrong).encode(),capture_output=True,env=self.git_env)
        self.assertEqual(result.returncode,0,result.stderr.decode('utf-8',errors='replace'))
        self.assertIn('Invalid exact file deletion approval registry',json.loads(result.stdout))

    def test_original_byte_hash_mismatch_is_rejected(self):
        wrong=deepcopy(self.approved);r=wrong['workflow']['branch_governance']['file_deletion_policy']['record'];r['files'][0]['sha256']='0'*64;self.rehash(r)
        grant=self.commit(self.files(wrong),(self.base,));self.call('update-ref','refs/remotes/origin/develop',grant);self.stage(self.deleted)
        self.assertTrue(policy.validate_staged_snapshot(policy.DELETION_BRANCH,'presentation',self.approved))
    def test_missing_trusted_ref_is_closed_without_local_fallback(self):
        # A fresh retained repository has no tracking ref; no ref is removed.
        with patch.object(policy,'approved_develop_tip',side_effect=ValueError('Approved origin/develop parent ref is unavailable')):
            self.stage(self.deleted)
            self.assertTrue(policy.validate_staged_snapshot(policy.DELETION_BRANCH,'presentation',self.approved))
    def test_source_modify_restore_in_grant_ancestry_is_rejected(self):
        old=deepcopy(self.approved);old['workflow']['branch_governance'].pop('file_deletion_policy')
        files=self.files(old);path=sorted(policy.DELETION_PATHS)[0];files[path]=b'SYNTHETIC mutation before grant'
        mutated=self.commit(files,(self.source,));restored=self.commit(self.files(old),(mutated,))
        grant=self.commit(self.files(self.approved),(restored,));parent=self.commit(self.files(self.approved),(self.source,grant))
        deleted=self.commit(self.files(self.approved,removed=True),(parent,))
        self.call('update-ref','refs/remotes/origin/develop',grant);self.stage(deleted,head=parent)
        self.assertTrue(policy.validate_staged_snapshot(policy.DELETION_BRANCH,'presentation',self.approved))
        self.assertTrue(policy.validate_push_history(policy.DELETION_BRANCH,parent,deleted,self.approved))
    def test_hidden_approval_mutate_delete_restore_is_rejected_in_push_and_PR(self):
        wrong=deepcopy(self.approved);r=wrong['workflow']['branch_governance']['file_deletion_policy']['record'];r['reason']='SYNTHETIC hidden altered reason';self.rehash(r)
        deletion=self.commit(self.files(wrong,removed=True),(self.sync,));restored=self.commit(self.files(self.approved,removed=True),(deletion,))
        self.assertTrue(policy.validate_push_history(policy.DELETION_BRANCH,self.sync,restored,self.approved))
        event={'pull_request':{'head':{'ref':policy.DELETION_BRANCH,'sha':restored,'repo':{'full_name':'synthetic/repo'}},'base':{'ref':'develop','sha':self.grant,'repo':{'full_name':'synthetic/repo'}}}}
        self.assertTrue(policy.validate_event('pull_request',event,restored,self.approved))
    def test_hidden_policy_default_downgrade_is_rejected(self):
        wrong=deepcopy(self.approved);wrong['workflow']['branch_governance']['file_deletion_policy']['default']='allow'
        deletion=self.commit(self.files(wrong,removed=True),(self.sync,));restored=self.commit(self.files(self.approved,removed=True),(deletion,))
        self.assertTrue(policy.validate_push_history(policy.DELETION_BRANCH,self.sync,restored,self.approved))

    def test_ref_deletion_force_and_main_gate_stay_closed(self):
        self.assertTrue(policy.validate_push_history(policy.DELETION_BRANCH,self.sync,policy.ZERO,self.approved))
        self.assertTrue(policy.validate_push_history(policy.DELETION_BRANCH,self.deleted,self.sync,self.approved))
        self.assertTrue(policy.validate_pr(policy.DELETION_BRANCH,'main',[],self.approved))

class RawMetricsDeletionApprovalTests(unittest.TestCase):
    """Exercise the separate grant in retained synthetic Git trees, without removing files."""
    call=DeletionApprovalTests.__dict__['call']
    commit=DeletionApprovalTests.__dict__['commit']
    stage=DeletionApprovalTests.stage
    rehash=DeletionApprovalTests.__dict__['rehash']

    @classmethod
    def files(cls,spec,removed=False):
        return {'docs/current/service_spec.json':(json.dumps(spec,ensure_ascii=False,indent=2)+'\n').encode(),
                'README.md':b'SYNTHETIC preserved\n',**({} if removed else {policy.RAW_METRICS_PATH:cls.payload})}

    @classmethod
    def setUpClass(cls):
        cls.repo=ROOT/'outputs/deletion_tests'/datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        cls.repo.mkdir(parents=True,exist_ok=False)
        cls.git_env={k:v for k,v in os.environ.items() if not k.startswith('GIT_')}
        cls.call('init','--initial-branch=fixture')
        # Retained snapshot paths can exceed MAX_PATH on Windows; only this synthetic repository is configured.
        cls.call('config','core.longpaths','true')
        cls.spec=json.loads((ROOT/'docs/current/service_spec.json').read_bytes())
        old=deepcopy(cls.spec);old['workflow']['branch_governance']['file_deletion_policy'].pop('additional_records',None)
        cls.payload=b'SYNTHETIC unused raw metrics fixture\n'
        cls.row={'path':policy.RAW_METRICS_PATH,'mode':'100644','blob':cls.call('hash-object','--stdin',input=cls.payload).decode(),
                 'sha256':hashlib.sha256(cls.payload).hexdigest()}
        cls.base=cls.commit(cls.files(old))
        cls.source=cls.commit(cls.files(old),(cls.base,))
        cls.approved=deepcopy(cls.spec)
        r=cls.approved['workflow']['branch_governance']['file_deletion_policy']['additional_records'][0]
        r['source_commit']=cls.source;r['files']=[cls.row];cls.rehash(r)
        cls.grant=cls.commit(cls.files(cls.approved),(cls.base,))
        cls.sync=cls.commit(cls.files(cls.approved),(cls.source,cls.grant))
        cls.deleted=cls.commit(cls.files(cls.approved,removed=True),(cls.sync,))

    def setUp(self):
        DeletionApprovalTests.setUp(self)
        expected=patch.object(policy,'RAW_METRICS_ROW',self.row);expected.start();self.addCleanup(expected.stop)

    def test_exact_separate_grant_passes_and_historical_grant_is_unchanged(self):
        self.assertEqual(policy.deletion_record(self.approved),policy.deletion_record(self.spec))
        self.assertEqual(policy.validate_deletion_registry(self.approved),[])
        self.stage(self.deleted)
        self.assertEqual(policy.validate_staged_snapshot(policy.DELETION_BRANCH,'presentation',self.approved),[])
        self.assertEqual(policy.validate_push_history(policy.DELETION_BRANCH,self.sync,self.deleted,self.approved),[])

    def test_missing_trusted_registration_rejects_candidate_self_approval(self):
        self.call('update-ref','refs/remotes/origin/develop',self.base)
        self.stage(self.deleted)
        self.assertTrue(policy.validate_staged_snapshot(policy.DELETION_BRANCH,'presentation',self.approved))

    def test_wrong_branch_or_extra_path_is_rejected(self):
        self.stage(self.deleted,branch=self.spec['workflow']['server_work_branch'])
        self.assertTrue(policy.validate_staged_snapshot(self.spec['workflow']['server_work_branch'],'development',self.approved))
        files=self.files(self.approved,removed=True);files.pop('README.md')
        extra=self.commit(files,(self.sync,));self.stage(extra)
        self.assertIn('File deletion requires explicit user scope: README.md',policy.validate_staged_snapshot(policy.DELETION_BRANCH,'presentation',self.approved))

    def test_changed_approval_or_payload_pin_is_rejected(self):
        wrong=deepcopy(self.approved);r=wrong['workflow']['branch_governance']['file_deletion_policy']['additional_records'][0]
        r['files'][0]['sha256']='0'*64;self.rehash(r)
        self.assertTrue(policy.validate_deletion_registry(wrong))
        self.assertTrue(policy.deletion_registry_sticky(self.approved,wrong))

    def test_wrong_user_proof_and_unknown_additional_grants_are_rejected(self):
        for mutate in [lambda r:r['user_evidence'].update(question_call_id='unverified'),
                       lambda r:r.update(id='unapproved'),lambda r:r['files'][0].update(path='apps/web/src/**')]:
            wrong=deepcopy(self.approved);r=wrong['workflow']['branch_governance']['file_deletion_policy']['additional_records'][0]
            mutate(r);self.rehash(r)
            self.assertTrue(policy.validate_deletion_registry(wrong))
        wrong=deepcopy(self.approved);wrong['workflow']['branch_governance']['file_deletion_policy']['additional_records']*=2
        self.assertTrue(policy.validate_deletion_registry(wrong))

    def test_modify_restore_cannot_reuse_exact_grant(self):
        files=self.files(self.approved);files[policy.RAW_METRICS_PATH]=b'SYNTHETIC changed\n'
        changed=self.commit(files,(self.sync,));restored=self.commit(self.files(self.approved),(changed,))
        deleted=self.commit(self.files(self.approved,removed=True),(restored,));self.stage(deleted,head=restored)
        self.assertTrue(policy.validate_staged_snapshot(policy.DELETION_BRANCH,'presentation',self.approved))

    def test_parallel_origin_and_delete_restore_reuse_are_rejected(self):
        other=self.commit(self.files(self.approved,removed=True),(self.sync,),message='SYNTHETIC second deletion origin')
        self.call('update-ref','refs/remotes/origin/'+policy.DELETION_BRANCH,self.deleted)
        self.assertTrue(policy.validate_push_history(policy.DELETION_BRANCH,self.sync,other,self.approved))
        restored=self.commit(self.files(self.approved),(self.deleted,));again=self.commit(self.files(self.approved,removed=True),(restored,))
        self.stage(again,head=restored)
        self.assertTrue(policy.validate_staged_snapshot(policy.DELETION_BRANCH,'presentation',self.approved))

    def test_inherited_normal_merge_keeps_same_single_origin(self):
        self.call('update-ref','refs/remotes/origin/'+policy.DELETION_BRANCH,self.deleted)
        merged=self.commit(self.files(self.approved,removed=True),(self.grant,self.deleted))
        self.assertEqual(policy.validate_push_history('develop',self.grant,merged,self.approved),[])

if __name__=='__main__':unittest.main()
