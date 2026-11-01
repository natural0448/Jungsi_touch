"""Verify no-delete retained-test output routing with synthetic, preserved paths."""
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
from uuid import uuid4
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import run_committed_tests as runner

class RetainedResultsRootTests(unittest.TestCase):
    def setUp(self):
        self.base=ROOT/'outputs/retained_results_root_tests'/uuid4().hex
        self.base.mkdir(parents=True,exist_ok=False)
        self.workspace=self.base/'workspace';self.workspace.mkdir()
        self.scratch=self.base/'scratch';self.scratch.mkdir()
        self.destination=self.base/'20261030T123456123456Z'
    def test_default_is_unchanged_and_creates_nothing(self):
        result,env=runner.retained_results_destination(self.destination,self.workspace,{})
        self.assertEqual(result,self.destination/'results');self.assertEqual(env,{})
        self.assertEqual(list(self.scratch.iterdir()),[])
    def test_external_results_and_all_temporary_paths_are_within_new_run(self):
        result,env=runner.retained_results_destination(self.destination,self.workspace,{'JUNGSI_RETAINED_RESULTS_ROOT':str(self.scratch)})
        run=self.scratch/'committed-results-20261030T123456123456Z'
        self.assertEqual(result,run/'results');self.assertFalse(result.exists())
        self.assertTrue((run/'tmp').is_dir())
        self.assertEqual({env[k] for k in ('TEMP','TMP','TMPDIR')},{str(run/'tmp')})
        self.assertEqual(env['DENO_DIR'],str(run/'deno-cache'))
        self.assertTrue(all(Path(v).is_relative_to(self.scratch) for v in env.values()))
    def test_collision_never_reuses_or_overwrites_prior_run(self):
        env={'JUNGSI_RETAINED_RESULTS_ROOT':str(self.scratch)}
        runner.retained_results_destination(self.destination,self.workspace,env)
        with self.assertRaises(FileExistsError):runner.retained_results_destination(self.destination,self.workspace,env)
    def test_relative_empty_or_missing_root_fails_closed(self):
        for raw in ('','relative',str(self.base/'missing')):
            with self.subTest(root=raw),self.assertRaises((ValueError,OSError)):
                runner.retained_results_destination(self.destination,self.workspace,{'JUNGSI_RETAINED_RESULTS_ROOT':raw})
    def test_root_inside_or_containing_snapshot_is_rejected(self):
        for root in (self.workspace,self.base):
            with self.subTest(root=str(root)),self.assertRaises(ValueError):
                runner.retained_results_destination(self.destination,self.workspace,{'JUNGSI_RETAINED_RESULTS_ROOT':str(root)})
    def test_junction_is_rejected_before_creation(self):
        root=self.scratch
        with patch.object(Path,'is_junction',lambda p:p==root),self.assertRaises(ValueError):
            runner.retained_results_destination(self.destination,self.workspace,{'JUNGSI_RETAINED_RESULTS_ROOT':str(root)})
        self.assertEqual(list(self.scratch.iterdir()),[])
    def test_bad_run_id_is_rejected(self):
        with self.assertRaises(ValueError):
            runner.retained_results_destination(self.base/'other',self.workspace,{'JUNGSI_RETAINED_RESULTS_ROOT':str(self.scratch)})

if __name__=='__main__':unittest.main()
