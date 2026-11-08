"""고정된 관측·방법 조합의 Deno 합성 검사. 기존 공통 gate는 변경하지 않는다."""
import hashlib,json,re,sqlite3,unittest
from pathlib import Path
import test_service_candidate_suites as common
from check_edge_contract import dynamic_imports
ROOT=Path(__file__).resolve().parents[1]
MANIFEST='tests/reference_candidate/manifest.json'
MANIFEST_SHA256='786bd2be16e410578f1eadd8a79d62b385b0f4bdb3281657aac866518424ee15'
ROOTS=['tests/reference_candidate/test_p1_reference_method_integrity.synthetic.mjs', 'tests/reference_candidate/test_p1_reference_port.synthetic.mjs']
ALLOWED=['node:assert/strict', 'node:test']
class ReferenceCandidateSuite(unittest.TestCase):
 def test_method_byte_window_in_memory(self):
  source=common.safe_file('supabase/functions/_shared/current_public_p1_reference_port.ts').read_text(encoding='utf-8')
  match=re.search(r'sum\(.+\) OVER \(.+\) AS running_bytes',source)
  if not match:raise AssertionError('method byte window not found')
  expression=match.group(0).replace('$3::bigint',':perRecord').replace('COLLATE "C"','COLLATE BINARY')
  db=sqlite3.connect(':memory:')
  try:
   db.execute('PRAGMA temp_store=MEMORY')
   db.executescript("CREATE TABLE synthetic_methods(requested_id TEXT, body_bytes INTEGER); INSERT INTO synthetic_methods VALUES ('a',9000),('b',3000),('c',3000),('d',3000)")
   rows=db.execute('SELECT requested_id,body_bytes,'+expression+' FROM synthetic_methods ORDER BY requested_id',{'perRecord':4096}).fetchall()
  finally:db.close()
  self.assertEqual([r[2] for r in rows],[0,3000,6000,9000])
  self.assertEqual([r[1]<=4096 and r[2]<=8192 for r in rows],[False,True,True,False])
 def test_reference_20_deno(self):
  common.load_manifest()
  file=common.safe_file(MANIFEST);raw=file.read_bytes()
  if hashlib.sha256(raw).hexdigest()!=MANIFEST_SHA256:raise ValueError('reference suite manifest mismatch')
  data=json.loads(raw)
  if data.get('format')!='jungsi.reference-candidate-suite/v1' or data.get('roots')!=ROOTS or data.get('allowed_builtins')!=ALLOWED or data.get('expected_count')!=20 or data.get('manual_read_files')!=[] or set(data.get('graphs',{}))!=set(ROOTS):raise ValueError('reference suite registration mismatch')
  for path,digest in data['files'].items():
   if common.bound_digest(path)!=digest:raise ValueError('reference suite file mismatch')
   if path.endswith(('.ts','.mjs','.js','.mts','.cts')) and dynamic_imports(common.safe_file(path).read_text(encoding='utf-8')):raise ValueError('reference suite dynamic import rejected')
  if common.layer_bindings(data['files'],data['graphs'])!=data['layers']:raise ValueError('reference suite layer mismatch')
  for root in ROOTS:
   if common.graph(root,ALLOWED)!=data['graphs'][root]:raise ValueError('reference suite graph mismatch')
  args=[str(common.DENO),'test','--config',common.CONFIG,'--cached-only','--no-lock','--no-prompt','--no-remote','--no-npm','--deny-read','--deny-write','--deny-net','--deny-env','--deny-run','--deny-sys','--deny-ffi','--reporter=dot',*ROOTS]
  output=common.invoke(args,120)
  matches=re.findall(r'^ok \| (\d+) passed \| (\d+) failed(?: \| (\d+) ignored)?(?: \| (\d+) filtered out)? \(',output,re.M)
  if len(matches)!=1 or tuple(int(n or 0) for n in matches[0])!=(20,0,0,0):raise AssertionError('reference Deno count mismatch: '+output[-1000:])
  for path,digest in data['files'].items():
   if common.bound_digest(path)!=digest:raise ValueError('reference suite changed during test')
  for root in ROOTS:
   if common.graph(root,ALLOWED)!=data['graphs'][root]:raise ValueError('reference suite graph changed during test')
  print('JUNGSI_REFERENCE_CANDIDATE_DENO_TESTS=20')
