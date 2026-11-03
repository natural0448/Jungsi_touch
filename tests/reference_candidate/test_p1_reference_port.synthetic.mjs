/** 합성 fixture만 사용한다. 실제 DB 연결과 자료판 승인 검증이 아니다. */
import assert from "node:assert/strict";
import {test} from "node:test";
import {readReferenceMethodEvidence,REFERENCE_EVIDENCE_EDGE_SQL,REFERENCE_EVIDENCE_METHOD_SQL} from "../../supabase/functions/_shared/current_public_p1_reference_port.ts";
import {AccessError} from "../../supabase/functions/_shared/jungsi/application/access.ts";
import {RequestLimitError} from "../../supabase/functions/_shared/jungsi/application/request_budget.ts";
import {safeFailure} from "../../supabase/functions/_shared/jungsi/infrastructure/auth_relay.ts";

const HASH=(c)=>c.repeat(64), cid=(c)=>"observation:"+HASH(c), release="reference-percentile:"+HASH("a"), sourceHead=HASH("b");
const head={releaseId:release,receiptSha256:HASH("c"),fingerprint:HASH("d")};
const CDF=HASH("e"),MID="SYN-METHOD";
const method='{"method_id":"SYN-METHOD","metric":"estimated_upper_cumulative_percent_all_examinees","source_CDF":{"$asset_ref":"SYN-ASSET"},"native_score_and_source_definition_metadata":{"academic_year":2026,"school_id":"SYN-OLD"},"weight":90071992547409931234567890}\n';
const ref=JSON.stringify({path:"synthetic.csv",bytes:99,sha256:CDF});
const hash=async text=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,"0")).join("");
const bytes=text=>new TextEncoder().encode(text).byteLength;
const methodHash=await hash(method);
const methodProof=(id=MID,hash=methodHash)=>({referenceReleaseId:release,methodId:id,academicYear:2026,schoolId:"SYN-OLD",methodRowSha256:hash,cdfSourceSha256:CDF});
const target=(c,pk)=>({canonicalResultId:cid(c),academicYear:2026,schoolId:"SYN-OLD",offeringPk:pk});
const proof=(x)=>({canonicalResultId:x.canonicalResultId,referenceReleaseId:release,academicYear:x.academicYear,schoolId:x.schoolId,
 offeringPk:x.offeringPk,sourceResultId:"SYN-SOURCE-"+x.offeringPk,rowFingerprint:HASH("7"),sourceRowFingerprint:HASH("8"),axisStatus:"verified"});
const edge=(ordinal,x,value="0.000")=>[ordinal,x.canonicalResultId,"2026",x.schoolId,x.offeringPk,
 "SYN-SOURCE-"+x.offeringPk,HASH("7"),HASH("8"),true,x.canonicalResultId,release,"2026",x.schoolId,x.offeringPk,
 MID,value,"estimated_upper_cumulative_percent_all_examinees","CALCULATED_WHOLE_COHORT_MODEL_ESTIMATE",false,false,
 release,x.schoolId,"2026",x.offeringPk,MID];
const methodRow=()=>[MID,release,MID,methodHash,CDF,String(bytes(method)+bytes(ref)),method,ref];
function fixture(){
 const x=target("1","SYN-PK1"),y=target("2","SYN-PK2"),stats={gate:0,queries:[],source:0,methodProof:0};
 const state={proofs:[proof(x),proof(y)],methodProofs:[methodProof()],edge:(i,z)=>edge(i,z),methods:()=>[methodRow()],throwAt:null,error:null,mutateOnEdge:null,mutateOnMethod:null,approved:true};
 const maybeThrow=(stage)=>{if(state.throwAt===stage)throw state.error;};
 const tx={query:async(sql,args)=>{stats.queries.push({sql,args});
   if(sql===REFERENCE_EVIDENCE_EDGE_SQL){maybeThrow("edge");const result=JSON.parse(args[0]).map((id,i)=>state.edge(i+1,id===x.canonicalResultId?x:y));state.mutateOnEdge?.();return result;}
   if(sql===REFERENCE_EVIDENCE_METHOD_SQL){maybeThrow("method_sql");state.mutateOnMethod?.();return state.methods();}throw new Error("unexpected query");}};
 const gate={assertCurrent:async(actual,request,boundary,sh,h)=>{assert.equal(actual,tx);assert.equal(sh,sourceHead);assert.equal(h.releaseId,release);
   stats.gate++;maybeThrow(`gate${stats.gate}`);return {approved:state.approved,maxTargets:10,maxMethodRecordBytes:4096,maxMethodBatchBytes:8192};}};
 const sourcePort={readVerified:async(actual,request,boundary,sh,h,items)=>{assert.equal(actual,tx);stats.source++;maybeThrow("source");return state.proofs.filter(p=>items.some(i=>i.canonicalResultId===p.canonicalResultId));}};
 const methodPort={readVerified:async(actual,request,boundary,sh,h,claims)=>{assert.equal(actual,tx);stats.methodProof++;maybeThrow("method_proof");return state.methodProofs.filter(p=>claims.some(c=>c.methodId===p.methodId && c.academicYear===p.academicYear && c.schoolId===p.schoolId));}};
 const run=(items=[x,y],port=sourcePort,mp=methodPort)=>readReferenceMethodEvidence(tx,{}, {},sourceHead,head,items,gate,port,mp);
 return {x,y,stats,state,tx,gate,sourcePort,methodPort,run};
}

test("동일 method는 한 번 조회하고 확인된 0 원문·기존 관측을 보존한다",async()=>{
 const f=fixture(),out=await f.run([f.x,f.y,f.x]);
 assert.deepEqual(out.map(x=>x.state),["stored_reference_candidate","stored_reference_candidate","stored_reference_candidate"]);
 assert.equal(out[0].percentileText,"0.000");assert.equal(out[0],out[2]);assert.equal(out[0].engineApproved,false);assert.equal(out[0].productionAllowed,false);
 assert.equal(out[0].snapshotConsistency,"same_transaction_only");assert.equal(out[0].freshHeadStatus,"not_verified");
 assert.equal(f.stats.gate,2);assert.equal(f.stats.queries.length,2);assert.deepEqual(JSON.parse(f.stats.queries[1].args[0]),[MID]);
 const wire=JSON.stringify(out);for(const secret of [method,methodHash,CDF,"synthetic.csv",HASH("7"),HASH("8")])assert.equal(wire.includes(secret),false);
});
test("기존 source 근거가 없는 CID만 보류하고 다른 CID는 유지한다",async()=>{
 const f=fixture();f.state.proofs=[proof(f.x)];const out=await f.run();
 assert.equal(out[0].state,"stored_reference_candidate");assert.equal(out[1].reason,"source_revision_or_axis_unverified");
 assert.deepEqual(JSON.parse(f.stats.queries[0].args[0]),[f.x.canonicalResultId]);
});
test("행 지문·원래 PK·성분 근거 충돌은 해당 관측만 보류한다",async()=>{
 for(const change of [r=>r[6]=HASH("9"),r=>r[13]="WRONG",r=>r[24]="OTHER"]){
  const f=fixture();f.state.edge=(i,x)=>{const r=edge(i,x);if(x===f.y)change(r);return r};const out=await f.run();
  assert.equal(out[0].state,"stored_reference_candidate");assert.equal(out[1].reason,"current_identity_or_reference_mismatch");
 }
 const f=fixture();f.state.proofs[1].axisStatus="pending";const out=await f.run();
 assert.equal(out[0].state,"stored_reference_candidate");assert.equal(out[1].reason,"source_revision_or_axis_unverified");
});
test("같은 CID의 다른 원래 PK 주장은 그 CID만 보류한다",async()=>{
 const f=fixture(),out=await f.run([f.x,{...f.x,offeringPk:"SYN-OTHER"},f.y]);
 assert.equal(out[0].reason,"conflicting_observation_identity");assert.equal(out[1].reason,"conflicting_observation_identity");assert.equal(out[2].state,"stored_reference_candidate");
});
test("method 원문 손상·CDF 참조 충돌은 부정확한 누백을 반환하지 않는다",async()=>{
 const f=fixture();f.state.methods=()=>{const r=methodRow();r[4]=HASH("f");return [r]};const out=await f.run();
 assert.equal(out[0].reason,"method_evidence_unverified");assert.equal(out[1].reason,"method_evidence_unverified");
});
test("method 중복·승인 byte 한도 밖 응답은 통과하지 않는다",async()=>{
 const f=fixture();f.state.methods=()=>[methodRow(),methodRow()];const out=await f.run();assert.equal(out[0].reason,"method_evidence_unverified");
 const g=fixture();g.state.methods=()=>{const r=methodRow();r[5]="99999";return [r]};assert.equal((await g.run())[0].reason,"method_evidence_unverified");
 const h=fixture();h.state.methods=()=>{const r=methodRow();r[6]="x".repeat(9000);return [r]};await assert.rejects(h.run(),e=>e instanceof AccessError && e.http===503);
});
test("명시적 true 승인만 허용하고 전후 gate 둘 다 검사한다",async()=>{
 for(const approved of [false,1,"true",null,undefined]){const f=fixture();f.state.approved=approved;
  await assert.rejects(f.run(),e=>e instanceof AccessError && e.http===503);assert.equal(f.stats.queries.length,0);}
 const f=fixture(),original=f.gate.assertCurrent;f.gate.assertCurrent=async(...args)=>{const value=await original(...args);return f.stats.gate===2?{...value,approved:false}:value;};
 await assert.rejects(f.run(),e=>e instanceof AccessError && e.http===503);assert.equal(f.stats.gate,2);
});
test("모든 의존성 단계에서 기존 429·401을 보존하고 미지 예외를 안전 변환한다",async()=>{
 for(const stage of ["gate1","source","edge","method_proof","method_sql","gate2"]){
  for(const [error,status,retry] of [[new RequestLimitError("rate_limit_exceeded",17),429,"17"],[new AccessError("authentication_required",401),401,null]]){
   const f=fixture();f.state.throwAt=stage;f.state.error=error;
   let caught;try{await f.run();assert.fail("dependency exception must propagate");}catch(e){caught=e;}
   assert.equal(caught,error);const response=safeFailure(caught,"0".repeat(32));assert.equal(response.status,status);assert.equal(response.headers.get("Retry-After"),retry);
  }
  const f=fixture();f.state.throwAt=stage;f.state.error=new Error("PRIVATE_SYNTHETIC_MARKER");
  let caught;try{await f.run();assert.fail("dependency exception must propagate");}catch(e){caught=e;}
  const response=safeFailure(caught,"0".repeat(32));assert.equal(response.status,503);assert.equal((await response.text()).includes("PRIVATE_SYNTHETIC_MARKER"),false);
 }
 const f=fixture();f.state.throwAt="source";f.state.error={status:429,retryAfterSeconds:17};
 let caught;try{await f.run();assert.fail("spoof must fail");}catch(e){caught=e;}const response=safeFailure(caught,"0".repeat(32));assert.equal(response.status,503);assert.equal(response.headers.get("Retry-After"),null);
});
test("검증된 별도 method 근거가 없거나 변경되면 그 method만 보류한다",async()=>{
 const f=fixture(),out=await f.run([f.x,f.y],f.sourcePort,null);
 assert.equal(out[0].reason,"method_reference_unverified");assert.equal(f.stats.queries.length,1);
 const g=fixture();g.state.methods=async()=>{const modified=method.replace("90071992547409931234567890","90071992547409931234567891");const r=methodRow();r[3]=await hash(modified);r[5]=String(bytes(modified)+bytes(ref));r[6]=modified;return [r]};
 assert.equal((await g.run())[0].reason,"method_evidence_unverified");
 const h=fixture();h.state.methodProofs=[methodProof(),methodProof()];assert.equal((await h.run())[0].reason,"method_reference_unverified");
});
test("본문 또는 CDF 참조 한쪽만 누락돼도 정상 형제 method는 유지한다",async()=>{
 for(const missing of [6,7]){
  const f=fixture(),mid2="SYN-METHOD-2",method2=method.replaceAll(MID,mid2),hash2=await hash(method2);
  f.state.edge=(i,x)=>{const r=edge(i,x);if(x===f.y){r[14]=mid2;r[24]=mid2;}return r;};
  f.state.methodProofs=[methodProof(),methodProof(mid2,hash2)];
  f.state.methods=()=>{const first=methodRow();first[missing]=null;const second=[mid2,release,mid2,hash2,CDF,String(bytes(method2)+bytes(ref)),method2,ref];return [first,second];};
  const out=await f.run();assert.equal(out[0].reason,"method_evidence_unverified");assert.equal(out[1].state,"stored_reference_candidate");
 }
});
test("읽기 SQL은 바인딩 변수만 쓰며 관측·method 배열을 한 번씩 조회한다",async()=>{
 const f=fixture();await f.run();assert.equal(f.stats.queries.length,2);
 for(const q of f.stats.queries){assert.match(q.sql,/\$1::jsonb/);assert.equal(q.sql.includes(f.x.canonicalResultId),false);assert.doesNotMatch(q.sql,/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER)\b/i);}
});
test("source 증명이나 요청 값이 비동기 조회 중 바뀌어도 이전 snapshot을 사용한다",async()=>{
 const f=fixture(),before=f.state.proofs[0];f.state.mutateOnEdge=()=>{before.rowFingerprint=HASH("9");f.x.schoolId="OTHER"};
 const out=await f.run();assert.equal(out[0].state,"stored_reference_candidate");assert.equal(out[0].schoolId,"SYN-OLD");
 const g=fixture(),methodBefore=g.state.methodProofs[0];g.state.mutateOnMethod=()=>{methodBefore.methodRowSha256=HASH("9");};
 assert.equal((await g.run())[0].state,"stored_reference_candidate");
});
