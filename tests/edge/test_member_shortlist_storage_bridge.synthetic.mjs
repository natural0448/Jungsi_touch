
import test from "node:test";
import assert from "node:assert/strict";
import { projectMemberSchoolResultBatches } from "../../supabase/functions/_shared/jungsi/application/member_school_results.ts";
import { nativeJsonSha256 } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";
import { MemberSchoolResultsStorage } from "../../supabase/functions/_shared/jungsi/infrastructure/member_school_results_storage.ts";
import { MEMBER_RESULTS_SQL, SupabaseMemberShortlistLegacy } from "../../supabase/functions/_shared/jungsi/infrastructure/member_shortlist_postgres.ts";

const owner = "00000000-0000-0000-0000-000000000001";
const otherOwner = "00000000-0000-0000-0000-000000000002";
const stamp = "2026-11-13T00:00:00.000000Z";
const scores = { exam_id: "exam-2027", pack_version: "pack-a", zero: 0 };
const profile = { owner_id: owner, profile_id: "profile-a", scores, confirmed: true, created_at: stamp };
const overall = { exam: { academic_year: 2027, exam_id: "exam-2027" }, pack_version: "pack-a" };
const offerings = Array.from({length: 102}, (_, i) => ({
  academic_year: 2027, offering_id: "o-" + i, university_name: "Synthetic U", department: "Unit " + i,
}));
const sourceAnalyses = Object.fromEntries(offerings.map(({offering_id}, i) => [
  offering_id, {offering_id, status: "ready", marker: i === 0 ? 0 : i === 1 ? "" : null},
]));
const sourceReport = {
  owner_id: owner, report_id: "report-a", profile_id: profile.profile_id, revision: 2,
  body: {overall, analyses: sourceAnalyses, shortlist: {}}, updated_at: stamp,
};
const documents = await projectMemberSchoolResultBatches(owner, profile, sourceReport, offerings);
const payloads = new Map();
const fetcher = async (url, init) => {
  const u = new URL(url);
  const key = u.pathname.replace("/storage/v1/object/authenticated/", "/storage/v1/object/");
  if (init.method === "POST") {
    if (payloads.has(key)) return new Response("", {status: 409});
    payloads.set(key, Uint8Array.from(init.body));
    return new Response("", {status: 201});
  }
  const bytes = payloads.get(key);
  return bytes ? new Response(bytes, {status: 200}) : new Response("", {status: 404});
};
const storage = new MemberSchoolResultsStorage({
  projectUrl: "https://synthetic.supabase.co", bucket: "private", prefix: "member/",
  secretKey: "synthetic", maxBytes: 2_000_000, maxItems: 100, timeoutMs: 5000,
}, fetcher);
const identity = {
  owner, academicYear: 2027, reportId: "report-a", reportRevision: 2, currentReportRevision: 2,
  profileId: profile.profile_id, profileFingerprint: await nativeJsonSha256(scores),
  examId: scores.exam_id, packVersion: scores.pack_version,
};
const refs = [];
for (const doc of documents) refs.push(await storage.create(identity, doc));
function bodyWithRefs() { return { overall, analyses: {}, shortlist: {}, member_school_results_refs: structuredClone(refs) }; }
function fakeDb(body, dbScores = scores) {
  let active = false;
  const sql = {
    async read(subject, run) {
      if (subject !== owner) return null;
      active = true;
      try {
        return await run({ async query(statement, args) {
          assert.equal(args[0], owner);
          if (statement === MEMBER_RESULTS_SQL) {
            const selected = Object.fromEntries(JSON.parse(args[2]).filter(x => Object.hasOwn(body.analyses, x)).map(x => [x, body.analyses[x]]));
            const hasRefs = Object.hasOwn(body, "member_school_results_refs");
            return [[ "report-a", "3", "profile-a", scores.exam_id, scores.pack_version, JSON.stringify(selected),
              hasRefs ? JSON.stringify(body) : null, hasRefs ? JSON.stringify(dbScores) : null,
              hasRefs ? true : null, hasRefs ? stamp : null, hasRefs ? stamp : null ]];
          }
          assert.match(statement, /SELECT v\.profile_id,v\.body::text/);
          const hasRefs = Object.hasOwn(body, "member_school_results_refs");
          return [["profile-a", JSON.stringify(body), stamp, hasRefs ? JSON.stringify(dbScores) : null,
            hasRefs ? true : null, hasRefs ? stamp : null]];
        }});
      } finally { active = false; }
    },
  };
  const guarded = { async read(i, r) { assert.equal(active, false, "external read must be outside the DB transaction"); return storage.read(i, r); } };
  return { sql, guarded };
}
function legacy(body, dbScores = scores, reader = true) {
  const {sql, guarded} = fakeDb(body, dbScores);
  return new SupabaseMemberShortlistLegacy(sql, 2_000_000, 200, reader ? guarded : null);
}
test("requested PKs are restored from two verified chunks, preserving zero and empty", async () => {
  const result = await legacy(bodyWithRefs()).read(owner, 2027, ["o-0","o-1","o-101"], "report-a", 3);
  assert.deepEqual(Object.keys(result.analyses), ["o-0","o-1","o-101"]);
  assert.equal(result.analyses["o-0"].marker, 0);
  assert.equal(result.analyses["o-1"].marker, "");
  assert.equal(result.analyses["o-101"].marker, null);
});
test("counseling snapshot restores all analyses and prior revision remains bound", async () => {
  const result = await legacy(bodyWithRefs()).snapshot(owner, 2027, "report-a", 3);
  assert.equal(Object.keys(result.report.body.analyses).length, 102);
  assert.equal(result.report.body.analyses["o-101"].offering_id, "o-101");
  assert.equal(result.report.revision, 3);
});
test("legacy inline report works without storage", async () => {
  const body = {overall, analyses: {"o-0": sourceAnalyses["o-0"]}, shortlist: {}};
  const r = await legacy(body, scores, false).read(owner, 2027, ["o-0"], "report-a", 3);
  assert.equal(r.analyses["o-0"].marker, 0);
  const s = await legacy(body, scores, false).snapshot(owner, 2027, "report-a", 3);
  assert.equal(s.report.body.analyses["o-0"].marker, 0);
});
test("duplicate reference is rejected", async () => {
  const body = bodyWithRefs(); body.member_school_results_refs.push(structuredClone(refs[0]));
  await assert.rejects(() => legacy(body).read(owner, 2027, ["o-0"], "report-a", 3));
});
test("different profile fingerprint and owner are never returned", async () => {
  await assert.rejects(() => legacy(bodyWithRefs(), {...scores, zero: 1}).read(owner, 2027, ["o-0"], "report-a", 3));
  assert.equal(await legacy(bodyWithRefs()).read(otherOwner, 2027, ["o-0"], "report-a", 3), null);
});
test("a future source revision is rejected and missing storage fails closed", async () => {
  const body = bodyWithRefs(); body.member_school_results_refs[0].source_report_revision = 4;
  await assert.rejects(() => legacy(body).read(owner, 2027, ["o-0"], "report-a", 3));
  await assert.rejects(() => legacy(bodyWithRefs(), scores, false).read(owner, 2027, ["o-0"], "report-a", 3));
});
test("conflicting inline assessment is rejected without overwriting either", async () => {
  const body = bodyWithRefs(); body.analyses["o-0"] = {...sourceAnalyses["o-0"], marker: 99};
  await assert.rejects(() => legacy(body).snapshot(owner, 2027, "report-a", 3));
  assert.equal(body.analyses["o-0"].marker, 99);
});
test("empty or missing records are not invented and other years cannot use these refs", async () => {
  const r = await legacy(bodyWithRefs()).read(owner, 2027, ["not-found"], "report-a", 3);
  assert.deepEqual(r.analyses, {});
  await assert.rejects(() => legacy(bodyWithRefs()).read(owner, 2026, ["o-0"], "report-a", 3));
});
