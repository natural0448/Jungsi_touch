"""Synthetic only; writes new retained fixtures inside the explicitly supplied scratch."""
from __future__ import annotations
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import tarfile
import unittest
import uuid
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import check_edge_contract as edge
import run_edge_tests as runner

raw_scratch=os.environ.get('JUNGSI_NATIVE_NPM_APPROVED_SCRATCH')
if raw_scratch:
    if not Path(raw_scratch).is_absolute():raise RuntimeError('approved synthetic scratch must be absolute')
    SCRATCH=Path(raw_scratch).resolve(strict=True)
else:
    SCRATCH=ROOT/'outputs/native_seed_synthetic'
    SCRATCH.mkdir(parents=True,exist_ok=True)
    SCRATCH=SCRATCH.resolve(strict=True)
if not SCRATCH.is_dir():
    raise RuntimeError('approved synthetic scratch is unavailable')

def encode(value):
    return json.dumps(value,sort_keys=True,separators=(',',':')).encode()

def create(path,raw):
    path.parent.mkdir(parents=True,exist_ok=True)
    with path.open('xb') as stream:
        stream.write(raw)

def digest(raw):
    return hashlib.sha256(raw).hexdigest()

class NativeSeedCases(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.work=SCRATCH/('synthetic_retained_'+uuid.uuid4().hex)
        cls.work.mkdir(exist_ok=False)
        cls.source=cls.work/'source'/'deno'/'npm'/'registry.npmjs.org'/'postgres'
        package=encode({'name':'postgres','version':'3.4.5'})
        cls.package={'package.json':package}
        cls.package.update({f'src/fake_{i:02}.js':f'// synthetic {i}\n'.encode() for i in range(36)})
        buffer=io.BytesIO()
        with tarfile.open(fileobj=buffer,mode='w:gz') as archive:
            for name,raw in cls.package.items():
                member=tarfile.TarInfo('package/'+name)
                member.size=len(raw)
                archive.addfile(member,io.BytesIO(raw))
        cls.tar=buffer.getvalue()
        cls.integrity='sha512-'+base64.b64encode(hashlib.sha512(cls.tar).digest()).decode()
        cls.lock=encode({'version':'5','specifiers':{'npm:postgres@3.4.5':'3.4.5'},
            'npm':{'postgres@3.4.5':{'integrity':cls.integrity}}})
        cls.registry=encode({'name':'postgres','versions':{'3.4.5':{'dist':{'integrity':cls.integrity}}}})
        cls.files={'registry.json':cls.registry,**{'3.4.5/'+n:v for n,v in cls.package.items()}}
        for name,raw in cls.files.items():create(cls.source/name,raw)
        cls.tar_path=cls.work/'verified-public-synthetic.tgz'
        create(cls.tar_path,cls.tar)
        cls.manifest=encode({'format':'offline-postgres-cache-observation/v1',
            'cache_root':str(cls.source),'lock_integrity':cls.integrity,
            'files':[{'path':name,'bytes':len(raw),'sha256':digest(raw)}
                for name,raw in sorted(cls.files.items())]})
        cls.manifest_path=cls.work/'manifest.json'
        create(cls.manifest_path,cls.manifest)
        cls.env={'JUNGSI_NATIVE_NPM_SEED':'1','JUNGSI_NATIVE_NPM_MANIFEST':str(cls.manifest_path),
            'JUNGSI_NATIVE_NPM_MANIFEST_SHA256':digest(cls.manifest),
            'JUNGSI_NATIVE_NPM_TARBALL':str(cls.tar_path),
            'JUNGSI_NATIVE_NPM_APPROVED_SCRATCH':str(cls.work),
            'JUNGSI_NATIVE_NPM_DENY_PROXY':'http://127.0.0.1:1'}

    def output(self):
        result=self.work/('output_'+uuid.uuid4().hex)
        result.mkdir(exist_ok=False)
        return result

    def prepare(self,output,env=None,lock=None):
        with patch.dict(os.environ,self.env if env is None else env,clear=True):
            return runner.prepare_optional_native_seed(self.lock if lock is None else lock,output)

    def test_absent_opt_in_leaves_existing_flow(self):
        output=self.output()
        with patch.dict(os.environ,{},clear=True):
            self.assertIsNone(runner.prepare_optional_native_seed(self.lock,output))
        self.assertFalse((output/'deno_cache').exists())

    def test_exact_tar_and_manifest_seed_two_separate_output_caches(self):
        first=self.output();second=self.output()
        one=self.prepare(first);two=self.prepare(second)
        self.assertNotEqual(one['destination'],two['destination'])
        self.assertEqual(set(one['files']),set(self.files))
        self.assertEqual(len(one['files']),38)
        for result in (one,two):
            runner._native_verify_cache(result['destination'],self.files)
            self.assertEqual(result['proxy'],'http://127.0.0.1:1')
        self.assertEqual(digest(self.manifest_path.read_bytes()),digest(self.manifest))

    def test_incomplete_or_invalid_opt_in_fails_before_copy(self):
        for env in ({'JUNGSI_NATIVE_NPM_SEED':'1'},{'JUNGSI_NATIVE_NPM_SEED':'yes'}):
            output=self.output()
            with self.assertRaises(edge.EdgeFailure):self.prepare(output,env)
            self.assertFalse((output/'deno_cache').exists())

    def test_manifest_mismatch_fails_before_copy(self):
        output=self.output();env={**self.env,'JUNGSI_NATIVE_NPM_MANIFEST_SHA256':'0'*64}
        with self.assertRaisesRegex(edge.EdgeFailure,'manifest_not_approved'):self.prepare(output,env)
        self.assertFalse((output/'deno_cache').exists())

    def test_unapproved_manifest_content_fails_before_copy(self):
        output=self.output();alternate=self.work/('alternate_'+uuid.uuid4().hex+'.json')
        create(alternate,self.manifest+b' ')
        env={**self.env,'JUNGSI_NATIVE_NPM_MANIFEST':str(alternate)}
        with self.assertRaisesRegex(edge.EdgeFailure,'manifest_not_approved'):self.prepare(output,env)
        self.assertFalse((output/'deno_cache').exists())

    def test_duplicate_manifest_path_fails_before_copy(self):
        output=self.output();data=json.loads(self.manifest)
        data['files'][-1]=dict(data['files'][0])
        raw=encode(data);path=self.work/('duplicate_'+uuid.uuid4().hex+'.json')
        create(path,raw)
        env={**self.env,'JUNGSI_NATIVE_NPM_MANIFEST':str(path),'JUNGSI_NATIVE_NPM_MANIFEST_SHA256':digest(raw)}
        with self.assertRaisesRegex(edge.EdgeFailure,'duplicate_path'):self.prepare(output,env)
        self.assertFalse((output/'deno_cache').exists())

    def test_wrong_lock_identity_fails_before_copy(self):
        output=self.output();bad=encode({'specifiers':{'npm:postgres@3.4.5':'9.9.9'},
            'npm':{'postgres@3.4.5':{'integrity':self.integrity}}})
        with self.assertRaises(edge.EdgeFailure):self.prepare(output,lock=bad)
        self.assertFalse((output/'deno_cache').exists())

    def test_tarball_and_lock_mismatch_fail_before_copy(self):
        output=self.output();bad=self.work/('bad_tar_'+uuid.uuid4().hex)
        create(bad,self.tar+b'x')
        with self.assertRaisesRegex(edge.EdgeFailure,'tarball_integrity_mismatch'):
            self.prepare(output,{**self.env,'JUNGSI_NATIVE_NPM_TARBALL':str(bad)})
        self.assertFalse((output/'deno_cache').exists())

    def test_source_modified_against_manifest_fails_before_copy(self):
        output=self.output();original=runner._native_file
        target=self.source/'3.4.5'/'src'/'fake_00.js'
        def altered(path,maximum):
            raw=original(path,maximum)
            return b'bad' if Path(path)==target else raw
        with patch.object(runner,'_native_file',side_effect=altered):
            with self.assertRaisesRegex(edge.EdgeFailure,'source_content_mismatch'):self.prepare(output)
        self.assertFalse((output/'deno_cache').exists())

    def test_source_inventory_extra_fails_before_copy(self):
        output=self.output();original=runner._native_inventory
        def altered(path):
            value=original(path)
            return value|{'3.4.5/extra.js'} if Path(path)==self.source else value
        with patch.object(runner,'_native_inventory',side_effect=altered):
            with self.assertRaisesRegex(edge.EdgeFailure,'source_inventory_mismatch'):self.prepare(output)
        self.assertFalse((output/'deno_cache').exists())

    def test_self_pinned_modified_package_still_fails_official_tar_comparison(self):
        output=self.output();new_root=self.work/('fake_source_'+uuid.uuid4().hex)/'deno/npm/registry.npmjs.org/postgres'
        fake=dict(self.files);fake['3.4.5/src/fake_00.js']=b'// altered synthetic\n'
        for name,raw in fake.items():create(new_root/name,raw)
        manifest=encode({'format':'offline-postgres-cache-observation/v1','cache_root':str(new_root),
            'lock_integrity':self.integrity,'files':[{'path':name,'bytes':len(raw),'sha256':digest(raw)}
                for name,raw in sorted(fake.items())]})
        path=self.work/('fake_manifest_'+uuid.uuid4().hex+'.json');create(path,manifest)
        env={**self.env,'JUNGSI_NATIVE_NPM_MANIFEST':str(path),'JUNGSI_NATIVE_NPM_MANIFEST_SHA256':digest(manifest)}
        with self.assertRaisesRegex(edge.EdgeFailure,'tar_content_mismatch'):self.prepare(output,env)
        self.assertFalse((output/'deno_cache').exists())

    def test_unapproved_output_and_reparse_fail_before_copy(self):
        output=self.output()
        env={**self.env,'JUNGSI_NATIVE_NPM_APPROVED_SCRATCH':str(self.source)}
        with self.assertRaisesRegex(edge.EdgeFailure,'outside_approved_scratch'):self.prepare(output,env)
        env={**self.env,'JUNGSI_NATIVE_NPM_APPROVED_SCRATCH':str(self.work.parent)}
        with self.assertRaisesRegex(edge.EdgeFailure,'source_scratch_binding'):self.prepare(output,env)
        original=Path.is_symlink
        def is_link(path):return Path(path)==output or original(path)
        with patch.object(Path,'is_symlink',is_link):
            with self.assertRaisesRegex(edge.EdgeFailure,'reparse_path'):self.prepare(output)
        self.assertFalse((output/'deno_cache').exists())

    def test_unavailable_junction_detection_fails_before_copy(self):
        output=self.output()
        with patch.object(runner,'_native_junction_supported',return_value=False):
            with self.assertRaisesRegex(edge.EdgeFailure,'junction_detection_unavailable'):
                self.prepare(output)
        self.assertFalse((output/'deno_cache').exists())

    def test_existing_conflict_and_extra_file_are_preserved(self):
        output=self.output();target=output/'deno_cache/npm/registry.npmjs.org/postgres/registry.json'
        create(target,b'preserve-conflict')
        with self.assertRaisesRegex(edge.EdgeFailure,'existing_cache_conflict'):self.prepare(output)
        self.assertEqual(target.read_bytes(),b'preserve-conflict')
        other=self.output();extra=other/'deno_cache/npm/registry.npmjs.org/postgres/extra.txt'
        create(extra,b'preserve-extra')
        with self.assertRaisesRegex(edge.EdgeFailure,'unexpected_existing_cache_file'):self.prepare(other)
        self.assertEqual(extra.read_bytes(),b'preserve-extra')

    def test_unexpected_cache_directory_is_preserved_and_rejected(self):
        output=self.output()
        extra=output/'deno_cache/npm/registry.npmjs.org/postgres/unexpected-empty'
        extra.mkdir(parents=True,exist_ok=False)
        with self.assertRaisesRegex(edge.EdgeFailure,'unexpected_cache_directory'):self.prepare(output)
        self.assertTrue(extra.is_dir())

    def test_post_seed_verifier_rejects_extra_without_repair(self):
        output=self.output();result=self.prepare(output)
        extra=result['destination']/'unexpected.txt';create(extra,b'preserve')
        with self.assertRaisesRegex(edge.EdgeFailure,'destination_inventory_mismatch'):
            runner._native_verify_cache(result['destination'],result['files'])
        self.assertEqual(extra.read_bytes(),b'preserve')

    def test_proxy_only_for_selected_native_deno_child(self):
        output=self.output();seen=[]
        def run(argv,**kwargs):
            seen.append((list(argv),kwargs['env']))
            class Result:
                stdout=b'ok';stderr=b'';returncode=0
            return Result()
        parent={'HTTP_PROXY':'http://parent.invalid:8888','NO_PROXY':'example.invalid'}
        with patch.dict(os.environ,parent,clear=True),patch.object(edge.subprocess,'run',side_effect=run),\
             patch.object(edge,'write_new'):
            edge.command(['deno','info'],root=self.work,output=output,name='professional_native_info',
                native_deno_proxy='http://127.0.0.1:1')
            edge.command(['python','oracle.py'],root=self.work,output=output,name='oracle')
            self.assertEqual(os.environ.get('HTTP_PROXY'),parent['HTTP_PROXY'])
            with self.assertRaisesRegex(edge.EdgeFailure,'native_proxy_scope_invalid'):
                edge.command(['python','oracle.py'],root=self.work,output=output,name='oracle',
                    native_deno_proxy='http://127.0.0.1:1')
        deno_env=seen[0][1];oracle_env=seen[1][1]
        self.assertEqual(deno_env['HTTP_PROXY'],'http://127.0.0.1:1')
        self.assertEqual(deno_env['HTTPS_PROXY'],'http://127.0.0.1:1')
        self.assertEqual(deno_env['ALL_PROXY'],'http://127.0.0.1:1')
        self.assertEqual(deno_env['NO_PROXY'],'')
        self.assertEqual(oracle_env['HTTP_PROXY'],parent['HTTP_PROXY'])
        self.assertEqual(oracle_env['NO_PROXY'],parent['NO_PROXY'])
        self.assertEqual(len(seen),2)

    def test_bad_proxy_and_path_inputs_fail_closed(self):
        for proxy in ('https://127.0.0.1:1','http://example.invalid:1','http://127.0.0.1:1?x=1'):
            output=self.output()
            with self.assertRaisesRegex(edge.EdgeFailure,'proxy_invalid'):
                self.prepare(output,{**self.env,'JUNGSI_NATIVE_NPM_DENY_PROXY':proxy})
            self.assertFalse((output/'deno_cache').exists())
        for name in ('../escape','3.4.5/../x','3.4.5/CON.txt','3.4.5/bad:stream','3.4.5/bad.'):
            with self.assertRaises(edge.EdgeFailure):runner._native_rel(name)

    def test_native_argv_and_non_opt_in_call_shape_are_preserved(self):
        root=self.work/('synthetic_root_'+uuid.uuid4().hex)
        create(root/runner.PROFESSIONAL_NATIVE_LOCK,self.lock)
        output=self.output();seen=[]
        def call(argv,**kwargs):
            seen.append((argv,kwargs))
            return b'{}'
        with patch.dict(os.environ,{},clear=True),\
             patch.object(runner,'professional_native_dependency_inputs',return_value={}),\
             patch.object(runner,'professional_native_graph',return_value={'synthetic':True}) as graph,\
             patch.object(runner,'command',side_effect=call):
            result=runner.check_professional_native_entrypoint(root,{},'synthetic-deno','config.json',
                output,runner.PROFESSIONAL_NATIVE_ENTRYPOINT)
        self.assertEqual(len(seen),2)
        self.assertEqual([argv[1] for argv,_ in seen],['check','info'])
        for argv,kwargs in seen:
            self.assertIn('--no-remote',argv);self.assertIn('--frozen-lockfile',argv)
            self.assertNotIn('--no-npm',argv);self.assertNotIn('native_deno_proxy',kwargs)
        graph.assert_called_once()
        self.assertNotIn('native_cache_seed',result)

    def test_seeded_native_check_and_info_reverify_before_next_call(self):
        root=self.work/('synthetic_root_'+uuid.uuid4().hex)
        create(root/runner.PROFESSIONAL_NATIVE_LOCK,self.lock)
        output=self.output();calls=[]
        def call(argv,**kwargs):
            calls.append(kwargs['name'])
            self.assertEqual(kwargs.get('native_deno_proxy'),'http://127.0.0.1:1')
            if kwargs['name']=='professional_native_check':
                self.assertIn('--cached-only',argv)
                create(output/'deno_cache/npm/registry.npmjs.org/postgres/extra.txt',b'preserve')
            return b'{}'
        with patch.dict(os.environ,self.env,clear=True),\
             patch.object(runner,'professional_native_dependency_inputs',return_value={}),\
             patch.object(runner,'command',side_effect=call):
            with self.assertRaisesRegex(edge.EdgeFailure,'destination_inventory_mismatch'):
                runner.check_professional_native_entrypoint(root,{},'synthetic-deno','config.json',
                    output,runner.PROFESSIONAL_NATIVE_ENTRYPOINT)
        self.assertEqual(calls,['professional_native_check'])
        self.assertTrue((output/'deno_cache/npm/registry.npmjs.org/postgres/extra.txt').is_file())

if __name__=='__main__':
    unittest.main(verbosity=2)
