"""Exercise retained runner progress without real credentials or cleanup."""
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
from uuid import uuid4

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import run_committed_tests as runner


class CommittedRunnerProgressTests(unittest.TestCase):
    def execute(self,methods,expect_progress=True):
        directory=ROOT/'outputs/runner_progress_tests'/uuid4().hex
        directory.mkdir(parents=True,exist_ok=False)
        source=directory/'synthetic_case.py'
        source.write_text('import unittest\nclass SyntheticCase(unittest.TestCase):\n'+methods,encoding='utf-8')
        result=subprocess.run([sys.executable,'-B','-X','utf8','-c',runner.HELPER],
            cwd=directory,input=json.dumps(['synthetic_case.py']),capture_output=True,text=True,
            env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'},timeout=20)
        lines=[line for line in result.stdout.splitlines()if line.startswith('JUNGSI_TEST_RESULT=')]
        self.assertEqual(len(lines),1)
        progress=[json.loads(line.split('=',1)[1]) for line in result.stderr.splitlines()
                  if line.startswith('JUNGSI_TEST_PROGRESS=')]
        if expect_progress:
            self.assertTrue(progress)
            self.assertEqual(set(progress[0]),{'test_number','test_id','phase'})
            self.assertTrue(progress[0]['test_id'].endswith('.SyntheticCase.test_a'))
        else:
            self.assertEqual(progress,[])
        return result,json.loads(lines[0].split('=',1)[1])

    def test_progress_keeps_all_test_results_and_failure_exit(self):
        result,receipt=self.execute('    def test_a(self): self.assertTrue(True)\n'
                                    '    def test_b(self): self.fail("synthetic failure")\n')
        self.assertNotEqual(result.returncode,0)
        self.assertEqual((receipt['tests_run'],receipt['failures'],receipt['errors'],receipt['skipped']),(2,1,0,0))
        self.assertFalse(receipt['successful'])

    def test_first_failure_stops_remaining_tests(self):
        result,receipt=self.execute('    def test_a(self): self.fail("first failure")\n'
                                    '    def test_b(self): self.fail("must not run")\n')
        self.assertNotEqual(result.returncode,0)
        self.assertEqual((receipt['tests_run'],receipt['failures'],receipt['errors']),(1,1,0))
        self.assertFalse(receipt['successful'])

    def test_first_error_stops_remaining_tests(self):
        result,receipt=self.execute('    def test_a(self): raise ValueError("first error")\n'
                                    '    def test_b(self): self.fail("must not run")\n')
        self.assertNotEqual(result.returncode,0)
        self.assertEqual((receipt['tests_run'],receipt['failures'],receipt['errors']),(1,0,1))
        self.assertFalse(receipt['successful'])

    def test_success_still_runs_all_selected_tests(self):
        result,receipt=self.execute('    def test_a(self): pass\n'
                                    '    def test_b(self): pass\n'
                                    '    def test_c(self): pass\n')
        self.assertEqual(result.returncode,0)
        self.assertEqual((receipt['selected_tests'],receipt['tests_run'],receipt['failures'],receipt['errors'],receipt['skipped']),(3,3,0,0,0))
        self.assertTrue(receipt['successful'])

    def test_first_setup_error_stops_following_class(self):
        result,receipt=self.execute('    @classmethod\n    def setUpClass(cls): raise ValueError("first setup error")\n'
                                    '    def test_a(self): pass\n'
                                    'class ZFollowingCase(unittest.TestCase):\n'
                                    '    def test_z(self): self.fail("must not run")\n',expect_progress=False)
        self.assertNotEqual(result.returncode,0)
        self.assertEqual((receipt['selected_tests'],receipt['tests_run'],receipt['not_executed'],receipt['errors']),(2,0,2,1))
        self.assertFalse(receipt['successful'])

    def test_failfast_keeps_normal_teardown_and_cleanup(self):
        result,receipt=self.execute('    def setUp(self): self.addCleanup(lambda: print("CLEANUP_OK"))\n'
                                    '    def tearDown(self): print("TEARDOWN_OK")\n'
                                    '    @classmethod\n    def tearDownClass(cls): print("CLASS_CLEANUP_OK")\n'
                                    '    def test_a(self): self.fail("first failure")\n'
                                    '    def test_b(self): self.fail("must not run")\n')
        self.assertEqual((receipt['selected_tests'],receipt['tests_run'],receipt['failures']),(2,1,1))
        for marker in ("CLEANUP_OK","TEARDOWN_OK","CLASS_CLEANUP_OK"):
            self.assertIn(marker,result.stdout)

    def test_skip_remains_counted_and_verification_timeouts_stay_finite(self):
        result,receipt=self.execute('    @unittest.skip("synthetic skip")\n    def test_a(self): pass\n')
        self.assertEqual(receipt['tests_run'],1)
        self.assertEqual(receipt['skipped'],1)
        self.assertEqual(runner.PYTHON_SUITE_TIMEOUT_SECONDS,3600)
        self.assertEqual(runner.RETAINED_RUNNER_TIMEOUT_SECONDS,4200)
        self.assertGreater(runner.RETAINED_RUNNER_TIMEOUT_SECONDS,runner.PYTHON_SUITE_TIMEOUT_SECONDS+300)


if __name__=='__main__':unittest.main()
