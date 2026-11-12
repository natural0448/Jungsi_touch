"""Independent bounded safety suite registration; no authority or runtime readiness."""
import hashlib,json,re
from pathlib import Path

MANIFEST_PATH="tests/reference_safety_suite_manifest.20261113_fmt.current.json"
MANIFEST_SHA="08a8d4689214f5eeb7890b8623f1eab7ff52e2d06eb80d1fafa9c16403e8e018"
TESTS=(
 "supabase/functions/_shared/jungsi/application/identity_fence.synthetic_test.ts",
 "supabase/functions/_shared/jungsi/application/reference_quiescence_fence.synthetic_test.ts",
 "supabase/functions/_shared/jungsi/application/named_owner_port.synthetic_test.ts",
)
COUNTS=(9,6,3)
FORMAT="jungsi.reference-safety-synthetic-suite/v1"
KEY="reference_safety_synthetic_test_extension"
FIELDS={"format","status","activation_status","native_acceptance","operating_writes","test_count","test_paths","manifest"}
def required(spec):
 if not isinstance(spec,dict):raise ValueError("reference_safety_spec_invalid")
 backend=spec.get("backend_platform_contract",{})
 if not isinstance(backend,dict):raise ValueError("reference_safety_spec_invalid")
 if KEY not in backend:return False
 ext=backend[KEY]
 if (not isinstance(ext,dict) or set(ext)!=FIELDS or ext["format"]!=FORMAT or
     ext["status"]!="SOURCE_REGISTERED_NOT_EXECUTED" or ext["activation_status"]!="NOT_RUN" or
     ext["native_acceptance"]!="NOT_VERIFIED_BY_SOURCE_SUITE" or
     type(ext["operating_writes"]) is not int or ext["operating_writes"]!=0 or
     type(ext["test_count"]) is not int or ext["test_count"]!=18 or ext["test_paths"]!=list(TESTS) or
     ext["manifest"]!={"path":MANIFEST_PATH,"sha256":MANIFEST_SHA}):
  raise ValueError("reference_safety_registration_invalid")
 return True
def registration(spec,before,read):
 enabled=required(spec)
 if not isinstance(before,dict) or not callable(read):raise ValueError("reference_safety_snapshot_invalid")
 if not enabled:
  if any(p in before for p in TESTS) or MANIFEST_PATH in before:raise ValueError("reference_safety_orphan_sources")
  return None
 if before.get(MANIFEST_PATH)!=MANIFEST_SHA:raise ValueError("reference_safety_manifest_binding_invalid")
 raw=read(MANIFEST_PATH)
 if not isinstance(raw,bytes) or hashlib.sha256(raw).hexdigest()!=MANIFEST_SHA:raise ValueError("reference_safety_manifest_bytes_invalid")
 def no_dupes(pairs):
  out={}
  for k,v in pairs:
   if k in out:raise ValueError("duplicate key")
   out[k]=v
  return out
 m=json.loads(raw,object_pairs_hook=no_dupes)
 if (not isinstance(m,dict) or set(m)!={"format","review_only","roots","case_names_by_path","test_count","source_bindings","graphs"} or
     m["format"]!="jungsi.reference-safety-synthetic-closure/v1" or m["review_only"] is not True or
     m["roots"]!=list(TESTS) or type(m["test_count"]) is not int or m["test_count"]!=18 or
     not isinstance(m["source_bindings"],dict) or not isinstance(m["graphs"],dict) or set(m["graphs"])!=set(TESTS) or
     not isinstance(m["case_names_by_path"],dict) or set(m["case_names_by_path"])!=set(TESTS)):
  raise ValueError("reference_safety_manifest_shape_invalid")
 names=m["case_names_by_path"]
 allcases=[]
 for path,count in zip(TESTS,COUNTS):
  cases=names[path]
  if not isinstance(cases,list) or len(cases)!=count or any(not isinstance(n,str) or not n for n in cases) or len(set(cases))!=count:
   raise ValueError("reference_safety_case_names_invalid")
  allcases.extend((path,n) for n in cases)
 if len(allcases)!=18 or len(set(allcases))!=18:raise ValueError("reference_safety_duplicate_cases")
 bindings=m["source_bindings"]
 if not set(TESTS)<=set(bindings) or "supabase/functions/deno.json" not in bindings:raise ValueError("reference_safety_missing_sources")
 for path,digest in bindings.items():
  if (not isinstance(path,str) or path.startswith("/") or "\\" in path or ":" in path or ".." in Path(path).parts or
      not isinstance(digest,str) or not re.fullmatch(r"[a-f0-9]{64}",digest) or before.get(path)!=digest):
   raise ValueError("reference_safety_source_binding_invalid")
 return {"test_paths":list(TESTS),"test_count":18,"case_names_by_path":names,
         "source_bindings":bindings,"manifest_sha256":MANIFEST_SHA}