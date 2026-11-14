/** 합성 전용: 실제 입결·분포·비밀이나 DB를 사용하지 않는다. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { JsonFloat, parseNativeJson } from "../../supabase/functions/_shared/jungsi/domain/native_json.ts";
import { matchesOriginalMethodAndCdf } from "../../supabase/functions/_shared/current_public_p1_reference_method.ts";

const cdf = "b".repeat(64);
const hash = async text => [...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,"0")).join("");
const raw = '{"method_id":"SYN-METHOD","metric":"estimated_upper_cumulative_percent_all_examinees","source_CDF":{"$asset_ref":"SYN-ASSET"},"native_score_and_source_definition_metadata":{"academic_year":2026,"school_id":"SYN-OLD-SCHOOL"},"native_CDF_header_observation":{"weight":90071992547409931234567890,"value":1.2300}}\n';
const rawHash=await hash(raw);
const evidence = () => ({methodId:"SYN-METHOD",methodRowSha256:rawHash,cdfSourceSha256:cdf,
  academicYear:2026,sourceSchoolId:"SYN-OLD-SCHOOL",manifestAssets:{"SYN-ASSET":{file_reference:{path:"synthetic.csv",bytes:99,sha256:cdf}}}});

test("기존 JSONL 원문과 공급된 고정 manifest의 CDF 참조가 일치한다", async () => {
  assert.equal(await matchesOriginalMethodAndCdf(raw,evidence()),true);
});
test("원문 변경이나 마지막 LF 누락은 같은 method로 인정하지 않는다", async () => {
  const changed=raw.replace("SYN-METHOD","OTHER");
  assert.equal(await matchesOriginalMethodAndCdf(changed,evidence()),false);
  assert.equal(await matchesOriginalMethodAndCdf(changed,{...evidence(),methodRowSha256:await hash(changed)}),false);
  const crlf=raw.slice(0,-1)+"\r\n";
  assert.equal(await matchesOriginalMethodAndCdf(crlf,evidence()),false);
  assert.equal(await matchesOriginalMethodAndCdf(crlf,{...evidence(),methodRowSha256:await hash(crlf)}),true);
  const noLF=raw.slice(0,-1);assert.equal(await matchesOriginalMethodAndCdf(noLF,{...evidence(),methodRowSha256:await hash(noLF)}),false);
});
test("중복 JSON key는 해당 method만 false로 둔다", async () => {
  const duplicate=raw.replace('"method_id":"SYN-METHOD"','"method_id":"SYN-METHOD","method_id":"SYN-METHOD"');
  assert.equal(await matchesOriginalMethodAndCdf(duplicate,{...evidence(),methodRowSha256:await hash(duplicate)}),false);
  assert.equal(await matchesOriginalMethodAndCdf(raw,evidence()),true);
});
test("손상 JSON과 해시 불일치는 해당 method만 false로 둔다", async () => {
  const malformed=raw.replace('"method_id":"SYN-METHOD"','"method_id":');
  assert.equal(await matchesOriginalMethodAndCdf(malformed,{...evidence(),methodRowSha256:await hash(malformed)}),false);
  assert.equal(await matchesOriginalMethodAndCdf(raw,{...evidence(),methodRowSha256:"a".repeat(64)}),false);
  assert.equal(await matchesOriginalMethodAndCdf(raw,evidence()),true);
});
test("큰 native 정수와 소수 토큰을 binary64로 바꾸지 않는다", async () => {
  const parsed=parseNativeJson(raw), header=parsed.native_CDF_header_observation;
  assert.equal(header.weight,90071992547409931234567890n);
  assert.ok(header.value instanceof JsonFloat);assert.equal(header.value.lexeme,"1.2300");
  assert.equal(await matchesOriginalMethodAndCdf(raw,evidence()),true);
});
test("CDF 참조나 해시 충돌은 거절한다", async () => {
  const e=evidence();e.manifestAssets["SYN-ASSET"].file_reference.sha256="c".repeat(64);
  assert.equal(await matchesOriginalMethodAndCdf(raw,e),false);
  const missing=evidence();delete missing.manifestAssets["SYN-ASSET"];
  assert.equal(await matchesOriginalMethodAndCdf(raw,missing),false);
});
test("관측의 원래 학년도와 학교코드만 대조한다", async () => {
  assert.equal(await matchesOriginalMethodAndCdf(raw,{...evidence(),academicYear:2025}),false);
  assert.equal(await matchesOriginalMethodAndCdf(raw,{...evidence(),sourceSchoolId:"SYN-OTHER"}),false);
  assert.equal(await matchesOriginalMethodAndCdf(raw,evidence()),true);
});
test("digest 대기 중 호출자가 근거와 자산을 바꿔도 처음 snapshot으로 검증한다", async () => {
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,"crypto"),original=globalThis.crypto;
  async function run(before,change,expected){
    const e=evidence();before(e);
    Object.defineProperty(globalThis,"crypto",{configurable:true,value:{subtle:{digest:(algorithm,bytes)=>{
      change(e);return original.subtle.digest(algorithm,bytes);
    }}}});
    try {assert.equal(await matchesOriginalMethodAndCdf(raw,e),expected);}
    finally {Object.defineProperty(globalThis,"crypto",descriptor);}
  }
  await run(e=>e.methodRowSha256="a".repeat(64),e=>e.methodRowSha256=rawHash,false);
  await run(e=>e.academicYear=2025,e=>e.academicYear=2026,false);
  await run(e=>e.sourceSchoolId="OTHER",e=>e.sourceSchoolId="SYN-OLD-SCHOOL",false);
  await run(e=>e.manifestAssets["SYN-ASSET"].file_reference.sha256="c".repeat(64),e=>e.manifestAssets["SYN-ASSET"].file_reference.sha256=cdf,false);
  await run(()=>{},e=>{e.methodId="OTHER";e.manifestAssets["SYN-ASSET"].file_reference.sha256="c".repeat(64)},true);
});
