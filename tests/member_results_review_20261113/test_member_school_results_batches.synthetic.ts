import { composeMemberSchoolResults, projectMemberSchoolResultBatches } from "../../supabase/functions/_shared/jungsi/application/member_school_results.ts";
import { nativeJsonSha256, nativeJsonText, type NativeObject } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import type { StoredProfile, StoredReport } from "../../supabase/functions/_shared/jungsi/application/platform_repository.ts";

const owner = "00000000-0000-4000-8000-000000000001";
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function rejects(run: () => Promise<unknown>) {
  let rejected = false;
  try { await run(); } catch { rejected = true; }
  assert(rejected, "expected rejection");
}
function fixture(count: number): { profile: StoredProfile; report: StoredReport; offerings: NativeObject[] } {
  const scores = { exam_id: "synthetic-exam", pack_version: "synthetic-pack" };
  const profile: StoredProfile = { profile_id: "p", owner_id: owner, scores, confirmed: true, created_at: "t" };
  const analyses: NativeObject = {}, offerings: NativeObject[] = [];
  for (let i = 0; i < count; i++) {
    const id = `synthetic:${i}`;
    analyses[id] = { offering_id: id, original: i };
    offerings.push({ academic_year: 2027, offering_id: id, university_name: "U", department: "D" });
  }
  const report: StoredReport = {
    report_id: "r", owner_id: owner, profile_id: "p", revision: 3, updated_at: "t",
    body: { analyses, overall: { exam: { academic_year: 2027, exam_id: "synthetic-exam" }, pack_version: "synthetic-pack" } },
  };
  return { profile, report, offerings };
}
Deno.test("more than 100 offerings are prepared and re-read without dropping rows", async () => {
  const f = fixture(205);
  const chunks = await projectMemberSchoolResultBatches(owner, f.profile, f.report, f.offerings);
  assert(chunks.length === 3 && (chunks[0].offerings as unknown[]).length === 100 &&
    (chunks[2].offerings as unknown[]).length === 5, "split must preserve all offerings");
  const emptyReport = { ...f.report, revision: 4, body: { ...f.report.body, analyses: {} } };
  const restored = await composeMemberSchoolResults(owner, f.profile, emptyReport, chunks);
  assert(restored.offerings.length === 205 && Object.keys(restored.analyses).length === 205,
    "later report revision must retain original results");
});
Deno.test("duplicate PK across batches is rejected before preparation", async () => {
  const f = fixture(101);
  f.offerings[100] = { ...f.offerings[0] };
  await rejects(() => projectMemberSchoolResultBatches(owner, f.profile, f.report, f.offerings));
});
Deno.test("stored duplicate and conflicting inline content are rejected", async () => {
  const f = fixture(1), chunks = await projectMemberSchoolResultBatches(owner, f.profile, f.report, f.offerings);
  await rejects(() => composeMemberSchoolResults(owner, f.profile, f.report, [...chunks, ...chunks]));
  const conflict = { ...f.report, body: { ...f.report.body, analyses: { "synthetic:0": { original: 9 } } } };
  await rejects(() => composeMemberSchoolResults(owner, f.profile, conflict, chunks));
});
Deno.test("wrong profile, newer source revision and tampering are rejected", async () => {
  const f = fixture(1), chunks = await projectMemberSchoolResultBatches(owner, f.profile, f.report, f.offerings);
  await rejects(() => composeMemberSchoolResults(owner, { ...f.profile, scores: { ...f.profile.scores, changed: true } }, f.report, chunks));
  await rejects(() => composeMemberSchoolResults(owner, f.profile, { ...f.report, revision: 2 }, chunks));
  const forged: NativeObject = { ...chunks[0], owner_binding: "00000000-0000-4000-8000-000000000002" };
  const content: NativeObject = { ...forged }; delete content.native_result_hash;
  forged.native_result_hash = await nativeJsonSha256(content);
  await rejects(() => composeMemberSchoolResults(owner, f.profile, f.report, [forged]));
});
Deno.test("empty offerings still require a valid report owner", async () => {
  const f = fixture(0);
  assert((await projectMemberSchoolResultBatches(owner, f.profile, f.report, [])).length === 0, "empty result");
  await rejects(() => projectMemberSchoolResultBatches("other", f.profile, f.report, []));
});
Deno.test("object byte limit also splits a batch and refuses an oversized single row", async () => {
  const f = fixture(2), one = await projectMemberSchoolResultBatches(owner, f.profile, f.report, f.offerings.slice(0, 1));
  const bytes = new TextEncoder().encode(nativeJsonText(one[0], true)).byteLength;
  const chunks = await projectMemberSchoolResultBatches(owner, f.profile, f.report, f.offerings, 100, bytes);
  assert(chunks.length === 2, "split by byte limit without dropping either row");
  await rejects(() => projectMemberSchoolResultBatches(owner, f.profile, f.report, f.offerings, 100, bytes - 1));
});

function previousFormat() {
  const f = fixture(1);
  (f.report.body.analyses as NativeObject)["synthetic:0"] = {
    offering_id: "synthetic:0",
    conversion: {
      status: "ready", converted_score: "0", profile_version: "p", exam_id: "synthetic-exam",
      pack_version: "synthetic-pack", academic_year: 2027, rule_version: "rule",
    },
    percentile: {
      status: "ready", top_percent: "3.5", profile_version: "p", exam_id: "synthetic-exam",
      pack_version: "synthetic-pack", academic_year: 2027, rule_version: "rule",
      curve_version: "curve", source_model_version: "model",
    },
  };
  return f;
}

Deno.test("bound prior-format summaries are restored on reread, including zero", async () => {
  const f = previousFormat();
  const chunks = await projectMemberSchoolResultBatches(owner, f.profile, f.report, f.offerings);
  const result = await composeMemberSchoolResults(owner, f.profile, f.report, chunks);
  const analysis = result.analyses["synthetic:0"] as NativeObject;
  assert(analysis.converted_score === "0" && analysis.converted_percentile === "3.5", "saved summaries");
});

Deno.test("unbound prior-format percentile is not inferred", async () => {
  const f = previousFormat();
  const analysis = (f.report.body.analyses as NativeObject)["synthetic:0"] as NativeObject;
  (analysis.percentile as NativeObject).rule_version = "another-rule";
  const chunks = await projectMemberSchoolResultBatches(owner, f.profile, f.report, f.offerings);
  const result = await composeMemberSchoolResults(owner, f.profile, f.report, chunks);
  const restored = result.analyses["synthetic:0"] as NativeObject;
  assert(restored.converted_score === "0" && !Object.hasOwn(restored, "converted_percentile"), "unbound percentile");
});

Deno.test("existing null summaries are not replaced by nested values", async () => {
  const f = previousFormat();
  const analysis = (f.report.body.analyses as NativeObject)["synthetic:0"] as NativeObject;
  analysis.converted_score = null;
  analysis.converted_percentile = null;
  const chunks = await projectMemberSchoolResultBatches(owner, f.profile, f.report, f.offerings);
  const result = await composeMemberSchoolResults(owner, f.profile, f.report, chunks);
  const restored = result.analyses["synthetic:0"] as NativeObject;
  assert(restored.converted_score === null && restored.converted_percentile === null, "explicit null");
});
