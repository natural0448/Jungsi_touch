"""Exercise actual embedded CI bootstrap without network or real credentials.

Each fixture stays in a new ignored outputs directory; no temporary cleanup.
"""
import base64
import json
import os
from pathlib import Path
import textwrap
import types
import unittest
from unittest.mock import patch
from uuid import uuid4

ROOT=Path(__file__).resolve().parents[1]
workflow=(ROOT/'.github/workflows/project-consistency.yml').read_text(encoding='utf-8')
source=textwrap.dedent(workflow.split('# jungsi:ci-bootstrap-start\n',1)[1].split('# jungsi:ci-bootstrap-end',1)[0])
bootstrap=types.ModuleType('retained_ci_bootstrap')
exec(compile(source,'embedded_ci_bootstrap','exec'),bootstrap.__dict__)


class CiSnapshotPreservationTests(unittest.TestCase):
    def setUp(self):
        self.root=ROOT/'outputs/ci_preservation_tests'/uuid4().hex
        self.root.mkdir(parents=True,exist_ok=False)
        self.sha='a'*40
        self.environment=dict(GITHUB_REPOSITORY='SYNTHETIC-owner/SYNTHETIC-repo',GITHUB_SHA=self.sha,
            GITHUB_RUN_ID='123',GITHUB_RUN_ATTEMPT='1',GITHUB_WORKSPACE=str(self.root),
            JUNGSI_FETCH_TOKEN='SYNTHETIC-PRIVATE-TOKEN',GIT_TRACE='1',
            GIT_CONFIG_COUNT='1',GIT_CONFIG_VALUE_0='SYNTHETIC-UNTRUSTED-CONFIG')
        self.calls=[]
    def git(self,args,cwd,env):
        self.calls.append((list(args),dict(env)))
        if args[0]=='init':
            (cwd/'.git').mkdir();(cwd/'.git/config').write_text('[core]\n\tbare = false\n',encoding='utf-8')
        return self.sha if args[0]=='rev-parse' else ''
    def test_fixed_first_checkout_and_fetch_only_credentials(self):
        snapshot=bootstrap.prepare_snapshot(self.environment,self.git)
        self.assertEqual(snapshot,self.root/'retained_snapshots/run_123_attempt_1')
        self.assertEqual([args[0] for args,env in self.calls],['init','fetch','checkout','rev-parse'])
        self.assertEqual(self.calls[2][0],['checkout','--detach',self.sha])
        self.assertIn(self.sha,self.calls[1][0]);self.assertIn('--no-auto-maintenance',self.calls[1][0])
        for args,env in self.calls:
            self.assertNotIn('JUNGSI_FETCH_TOKEN',env);self.assertNotIn('GIT_TRACE',env)
            self.assertNotIn('SYNTHETIC-PRIVATE-TOKEN',json.dumps(args))
            self.assertNotIn('SYNTHETIC-UNTRUSTED-CONFIG',json.dumps(env))
            if args[0]!='fetch':self.assertEqual(env['GIT_CONFIG_COUNT'],'0');self.assertNotIn('GIT_CONFIG_VALUE_0',env)
        header=self.calls[1][1]['GIT_CONFIG_VALUE_0']
        self.assertEqual(base64.b64decode(header.split('basic ',1)[1]).decode(),'x-access-token:SYNTHETIC-PRIVATE-TOKEN')
        self.assertIn('auto = 0',(snapshot/'.git/config').read_text(encoding='utf-8'))
        self.assertIn('auto = false',(snapshot/'.git/config').read_text(encoding='utf-8'))
    def test_existing_snapshot_preserves_sentinel_and_runs_no_git(self):
        snapshot=self.root/'retained_snapshots/run_123_attempt_1';snapshot.mkdir(parents=True)
        sentinel=snapshot/'retained.txt';sentinel.write_text('SYNTHETIC-PRESERVE',encoding='utf-8')
        with self.assertRaises(FileExistsError):bootstrap.prepare_snapshot(self.environment,self.git)
        self.assertEqual(self.calls,[]);self.assertEqual(sentinel.read_text(encoding='utf-8'),'SYNTHETIC-PRESERVE')
    def test_wrong_checked_out_sha_cannot_pass(self):
        def wrong(args,cwd,env):
            result=self.git(args,cwd,env)
            return 'b'*40 if args[0]=='rev-parse' else result
        with self.assertRaisesRegex(RuntimeError,'fixed workflow SHA'):bootstrap.prepare_snapshot(self.environment,wrong)
    def test_git_error_cannot_emit_raw_credentials_or_cleanup(self):
        result=types.SimpleNamespace(returncode=1,stdout='',stderr='SYNTHETIC-PRIVATE-TOKEN')
        with patch.object(bootstrap.subprocess,'run',return_value=result):
            with self.assertRaises(RuntimeError) as caught:bootstrap.git_command(['fetch'],self.root,{})
        self.assertNotIn('SYNTHETIC-PRIVATE-TOKEN',str(caught.exception))


if __name__=='__main__':unittest.main()
