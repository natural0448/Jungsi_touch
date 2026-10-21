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
    def execute(self,methods):
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
        self.assertTrue(progress)
        self.assertEqual(set(progress[0]),{'test_number','test_id','phase'})
        self.assertTrue(progress[0]['test_id'].endswith('.SyntheticCase.test_a'))
        return result,json.loads(lines[0].split('=',1)[1])

    def test_progress_keeps_all_test_results_and_failure_exit(self):
        result,receipt=self.execute('    def test_a(self): self.assertTrue(True)\n'
                                    '    def test_b(self): self.fail("synthetic failure")\n')
        self.assertNotEqual(result.returncode,0)
        self.assertEqual((receipt['tests_run'],receipt['failures'],receipt['errors'],receipt['skipped']),(2,1,0,0))
        self.assertFalse(receipt['successful'])

    def test_skip_remains_counted_and_verification_timeouts_stay_finite(self):
        result,receipt=self.execute('    @unittest.skip("synthetic skip")\n    def test_a(self): pass\n')
        self.assertEqual(receipt['tests_run'],1)
        self.assertEqual(receipt['skipped'],1)
        self.assertEqual(runner.PYTHON_SUITE_TIMEOUT_SECONDS,1800)
        self.assertEqual(runner.RETAINED_RUNNER_TIMEOUT_SECONDS,2200)
        self.assertGreater(runner.RETAINED_RUNNER_TIMEOUT_SECONDS,runner.PYTHON_SUITE_TIMEOUT_SECONDS+300)


if __name__=='__main__':unittest.main()
