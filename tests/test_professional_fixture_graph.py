"""Strict single-test coexisting fixture graph; in-memory only, no DB or cleanup."""
import copy, hashlib, sys, unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"scripts"))
import check_edge_contract as edge
SUP=edge.PROFESSIONAL_FIXTURE_PATH
SRC=edge.PROFESSIONAL_FIXTURE_IMPORTER
PACK=edge.PROFESSIONAL_FIXTURE_SYNTHETIC_PACK
APP="supabase/functions/_shared/jungsi/application/access.ts"
OTHER="tests/edge/test_wildcard_selection.synthetic.ts"

def spec():
 raw=(ROOT/SUP).read_bytes();normalized=raw.decode("utf-8-sig").replace("\r\n","\n").encode()
 row={"path":SUP,"layer":"verification","status":"SYNTHETIC","requirements":["SYN-REQ"],"declared_exports":["fixture"],"source_sha256":hashlib.sha256(normalized).hexdigest()}
 item={"path":SUP,"layer":"verification","status":"SYNTHETIC","requirements":["SYN-REQ"],"symbols":["fixture"]}
 return {"workflow":{"documentation_sync":{"code_index":{"edge_sources":{"format":"jungsi.typescript-source-hash-index/v1","verification":"whole_source_hash_not_type_or_runtime_proof","files":[row]}}}},"implementation":[item]}
def manifest():return {SUP:hashlib.sha256((ROOT/SUP).read_bytes()).hexdigest()}
def proof():return edge.graph_coexisting_catalog(ROOT,{"coexisting_bound":[SUP]},spec(),manifest())
def graph():
 url=lambda path:(ROOT/path).resolve().as_uri()
 d={"specifier":edge.PROFESSIONAL_FIXTURE_SPECIFIER,"code":{"specifier":url(SUP)}}
 module=lambda path,deps:{"specifier":url(path),"kind":"esm","mediaType":"TypeScript","dependencies":deps}
 return {"version":1,"roots":[url(SRC)],"modules":[module(SRC,[d]),module(SUP,[])],"redirects":{},"npmPackages":{}}
def normal(raw=None,*,p=None,m=None,layers=None):
 registered={SRC,PACK,OTHER,APP};lay={SRC:"verification",PACK:"verification",OTHER:"verification",APP:"application"}
 if layers:lay.update(layers)
 return edge.normalize_graph(raw or graph(),ROOT,registered,lay,manifest=manifest() if m is None else m,coexisting=proof() if p is None else p)
class ProfessionalFixtureGraphTests(unittest.TestCase):
 def test_registered_single_static_test_and_exam_pack(self):
  g=graph();g["modules"][1]["dependencies"]=[{"specifier":"../../../tests/edge/synthetic_exam_pack.ts","code":{"specifier":(ROOT/PACK).resolve().as_uri()}}]
  g["modules"].append({"specifier":(ROOT/PACK).resolve().as_uri(),"kind":"esm","mediaType":"TypeScript","dependencies":[]})
  _,seen=normal(g);self.assertTrue({SRC,SUP,PACK}<=seen)
 def test_root_other_test_dynamic_alias_and_type_denied(self):
  for mode in ("root","fixture_root","dynamic","alias","type","duplicate"):
   with self.subTest(mode=mode):
    g=graph();d=g["modules"][0]["dependencies"][0]
    if mode=="root":g["roots"]=[(ROOT/OTHER).resolve().as_uri()]
    if mode=="fixture_root":g["roots"]=[(ROOT/SUP).resolve().as_uri()]
    if mode=="dynamic":d["isDynamic"]=True
    if mode=="alias":d["specifier"]="./alias.ts"
    if mode=="type":d["type"]=d.pop("code")
    if mode=="duplicate":g["modules"][0]["dependencies"].append(copy.deepcopy(d))
    with self.assertRaises(edge.EdgeFailure):normal(g)
 def test_other_verification_and_application_incoming_denied(self):
  for path in (OTHER,APP):
   with self.subTest(path=path):
    g=graph();d=copy.deepcopy(g["modules"][0]["dependencies"][0]);g["modules"].append({"specifier":(ROOT/path).resolve().as_uri(),"kind":"esm","mediaType":"TypeScript","dependencies":[d]})
    with self.assertRaisesRegex(edge.EdgeFailure,"professional_fixture_incoming_denied"):normal(g)
 def test_fixture_cannot_import_arbitrary_verification_code(self):
  g=graph();g["modules"][1]["dependencies"].append({"specifier":"../../../"+OTHER,"code":{"specifier":(ROOT/OTHER).resolve().as_uri()}})
  with self.assertRaisesRegex(edge.EdgeFailure,"professional_fixture_verification_dependency_denied"):normal(g)
  g=graph();g["modules"][1]["dependencies"].append({"specifier":"../../../tests/edge/synthetic_exam_pack.ts","isDynamic":True,"code":{"specifier":(ROOT/PACK).resolve().as_uri()}})
  with self.assertRaisesRegex(edge.EdgeFailure,"professional_fixture_dynamic_dependency_denied"):normal(g)
 def test_wrong_layer_manifest_and_index_denied(self):
  p=proof();p[SUP]["layer"]="application"
  with self.assertRaisesRegex(edge.EdgeFailure,"coexisting_graph_unapproved"):normal(p=p)
  m=manifest();m[SUP]="0"*64
  with self.assertRaisesRegex(edge.EdgeFailure,"coexisting_graph_manifest_mismatch"):edge.graph_coexisting_catalog(ROOT,{"coexisting_bound":[SUP]},spec(),m)
  s=spec();s["workflow"]["documentation_sync"]["code_index"]["edge_sources"]["files"][0]["source_sha256"]="0"*64
  with self.assertRaisesRegex(edge.EdgeFailure,"coexisting_graph_index_mismatch"):edge.graph_coexisting_catalog(ROOT,{"coexisting_bound":[SUP]},s,manifest())
 def test_required_fixture_edge_and_node_cannot_be_omitted(self):
  g=graph();g["modules"]=g["modules"][:1];g["modules"][0]["dependencies"]=[]
  with self.assertRaisesRegex(edge.EdgeFailure,"professional_fixture_required_once"):normal(g)
 def test_source_manifest_index_and_forged_proof_cannot_repin_together(self):
  current=spec();actual=Path.read_bytes;tampered=actual(ROOT/SUP)+b" ";digest=hashlib.sha256(tampered).hexdigest()
  current["workflow"]["documentation_sync"]["code_index"]["edge_sources"]["files"][0]["source_sha256"]=digest
  m={SUP:digest};forged={SUP:{"layer":"verification","source_sha256":digest}}
  def fake(p):return tampered if p==ROOT/SUP else actual(p)
  with patch.object(Path,"read_bytes",fake):
   with self.assertRaisesRegex(edge.EdgeFailure,"professional_fixture_fixed_pin_mismatch"):edge.graph_coexisting_catalog(ROOT,{"coexisting_bound":[SUP]},current,m)
   with self.assertRaisesRegex(edge.EdgeFailure,"professional_fixture_fixed_pin_mismatch"):normal(p=forged,m=m)
 def test_registered_coexisting_overlap_denied_even_when_fixture_is_root(self):
  for root_is_fixture in (False,True):
   with self.subTest(root_is_fixture=root_is_fixture):
    g=graph()
    if root_is_fixture:g["roots"]=[(ROOT/SUP).resolve().as_uri()]
    layers={SRC:"verification",SUP:"verification"}
    with self.assertRaisesRegex(edge.EdgeFailure,"coexisting_graph_registered_overlap"):
     edge.normalize_graph(g,ROOT,{SRC,SUP},layers,manifest=manifest(),coexisting=proof())
 def test_raw_bom_and_crlf_cannot_repin_even_if_normalized_hash_matches(self):
  current=spec();actual=Path.read_bytes;original=actual(ROOT/SUP)
  for changed in (b"\xef\xbb\xbf"+original,original.replace(b"\n",b"\r\n")):
   with self.subTest(bytes=len(changed)):
    self.assertEqual(hashlib.sha256(changed.decode("utf-8-sig").replace("\r\n","\n").encode()).hexdigest(),edge.PROFESSIONAL_FIXTURE_SHA256)
    m={SUP:hashlib.sha256(changed).hexdigest()};forged={SUP:{"layer":"verification","source_sha256":edge.PROFESSIONAL_FIXTURE_SHA256}}
    def fake(p):return changed if p==ROOT/SUP else actual(p)
    with patch.object(Path,"read_bytes",fake):
     with self.assertRaisesRegex(edge.EdgeFailure,"professional_fixture_fixed_pin_mismatch"):edge.graph_coexisting_catalog(ROOT,{"coexisting_bound":[SUP]},current,m)
     with self.assertRaisesRegex(edge.EdgeFailure,"professional_fixture_fixed_pin_mismatch"):normal(p=forged,m=m)
 def test_tampered_source_and_unlisted_fixture_denied(self):
  current_spec=spec();actual=Path.read_bytes;tampered=actual(ROOT/SUP)+b" ";m={SUP:hashlib.sha256(tampered).hexdigest()}
  def fake(p):return tampered if p==ROOT/SUP else actual(p)
  with patch.object(Path,"read_bytes",fake),self.assertRaisesRegex(edge.EdgeFailure,"coexisting_graph_index_mismatch"):
   edge.graph_coexisting_catalog(ROOT,{"coexisting_bound":[SUP]},current_spec,m)
  with self.assertRaisesRegex(edge.EdgeFailure,"coexisting_graph_scope_invalid"):normal(p={"other.ts":{}})
if __name__=="__main__":unittest.main()
