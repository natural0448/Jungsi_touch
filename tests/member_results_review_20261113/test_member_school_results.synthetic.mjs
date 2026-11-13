import test from "node:test";
import assert from "node:assert/strict";
import { projectMemberSchoolResults } from "../../supabase/functions/_shared/jungsi/application/member_school_results.ts";

const owner="00000000-0000-0000-0000-000000000001";
const profile={owner_id:owner,profile_id:"profile-1",confirmed:true,created_at:"2026-01-01T00:00:00Z",scores:{exam_id:"exam-1",pack_version:"pack-1"}};
const row={academic_year:2027,offering_id:"offering-1",university_name:"합성 대학교",department:"합성 학과"};
function report() { return {owner_id:owner,profile_id:"profile-1",report_id:"report-1",revision:2,updated_at:"2026-01-01T00:00:00Z",body:{overall:{exam:{academic_year:2027,exam_id:"exam-1"},pack_version:"pack-1"},analyses:{"offering-1":{offering_id:"offering-1",conversion:{status:"ready",converted_score:"0",profile_version:"profile-1",exam_id:"exam-1",pack_version:"pack-1",academic_year:2027,rule_version:"rule-1",release_version:"release-1"},percentile:{status:"pending",top_percent:null,profile_version:"profile-1",exam_id:"exam-1",pack_version:"pack-1",academic_year:2027}}}}}; }

test("preserves a zero score while the independent percentile remains pending",async()=>{
  const result=await projectMemberSchoolResults(owner,profile,report(),[row]);
  assert.equal(result.offerings[0].converted_score,"0");
  assert.equal(result.offerings[0].converted_percentile,null);
  assert.equal(result.offerings[0].top_percent,null);
  assert.equal(result.offerings[0].converted_score_status,"ready");
  assert.equal(result.offerings[0].top_percent_status,"pending");
  assert.match(result.native_result_hash,/^[a-f0-9]{64}$/);
});

test("retains the existing compatibility percentile only when the bound value matches",async()=>{
  const r=report();r.body.analyses["offering-1"].converted_percentile="12.3";
  r.body.analyses["offering-1"].percentile.status="ready";
  r.body.analyses["offering-1"].percentile.top_percent="12.3";
  r.body.analyses["offering-1"].percentile.rule_version="rule-1";
  r.body.analyses["offering-1"].percentile.curve_version="curve-1";
  r.body.analyses["offering-1"].percentile.source_model_version="model-1";
  const result=await projectMemberSchoolResults(owner,profile,r,[row]);
  assert.equal(result.offerings[0].converted_percentile,"12.3");
  assert.equal(result.offerings[0].top_percent,"12.3");
  delete r.body.analyses["offering-1"].converted_percentile;
  const older=await projectMemberSchoolResults(owner,profile,r,[row]);
  assert.equal(older.offerings[0].converted_percentile,"12.3");
  r.body.analyses["offering-1"].converted_percentile="20.0";
  const mismatched=await projectMemberSchoolResults(owner,profile,r,[row]);
  assert.equal(mismatched.offerings[0].converted_percentile,null);
  assert.equal(mismatched.offerings[0].top_percent,"12.3");
});

test("rejects cross-owner, changed score profile, year and duplicate offering",async()=>{
  const wrong=report();wrong.owner_id="00000000-0000-0000-0000-000000000002";
  await assert.rejects(projectMemberSchoolResults(owner,profile,wrong,[row]));
  const changed=report();changed.body.analyses["offering-1"].conversion.profile_version="another";
  await assert.rejects(projectMemberSchoolResults(owner,profile,changed,[row]));
  const mismatch=report();mismatch.body.analyses["offering-1"].percentile.status="ready";mismatch.body.analyses["offering-1"].percentile.top_percent="4";mismatch.body.analyses["offering-1"].percentile.rule_version="other-rule";
  const held=await projectMemberSchoolResults(owner,profile,mismatch,[row]);
  assert.equal(held.offerings[0].converted_score,"0");assert.equal(held.offerings[0].top_percent,null);
  await assert.rejects(projectMemberSchoolResults(owner,profile,report(),[{...row,academic_year:2026}]));
  await assert.rejects(projectMemberSchoolResults(owner,profile,report(),[row,row]));
});

test("one missing name stays null without losing another offering's score",async()=>{
  const result=await projectMemberSchoolResults(owner,profile,report(),[{...row,department:null},{...row,offering_id:"offering-2"}]);
  assert.equal(result.offerings[0].department,null);
  assert.equal(result.offerings[0].converted_score,"0");
  assert.equal(result.offerings[1].converted_score,null);
});

test("preserves the existing owned assessment needed by report consumers",async()=>{
  const original=report();
  original.body.analyses["offering-1"].category="pending";
  original.body.analyses["offering-1"].years=[{academic_year:2026,converted_score:"0"}];
  const result=await projectMemberSchoolResults(owner,profile,original,[row]);
  assert.equal(JSON.stringify(result.offerings[0].assessment),
    JSON.stringify(original.body.analyses["offering-1"]));
});
