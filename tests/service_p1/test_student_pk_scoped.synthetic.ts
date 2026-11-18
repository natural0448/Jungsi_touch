import { attachSavedPageScores } from "../../supabase/functions/_shared/jungsi/application/attach_saved_scores.ts";
import { readSavedCandidateGroups } from "../../supabase/functions/_shared/jungsi/application/member_saved_candidate_groups.ts";
import { MemberJsonResults } from "../../supabase/functions/_shared/jungsi/application/member_json_results.ts";
import { AccessError } from "../../supabase/functions/_shared/jungsi/application/access.ts";
import { readSavedScoreMap, SavedScoreTransientUnavailable } from "../../supabase/functions/_shared/jungsi/infrastructure/member_score_map_read.ts";
import type { SupabaseSqlTransport } from "../../supabase/functions/_shared/jungsi/infrastructure/transaction_sql.ts";
import type { SessionSnapshot } from "../../supabase/functions/_shared/jungsi/application/session_service.ts";
import type { NativeObject } from "../../supabase/functions/_shared/jungsi/domain/json_value.ts";

function ok(value: unknown, message = "assertion_failed"): asserts value { if (!value) throw new Error(message); }
async function rejected(work: () => Promise<unknown>, code: string) {
  try { await work(); } catch (e) { if (e instanceof AccessError && e.code === code) return; throw e; }
  throw new Error("expected_rejection_" + code);
}
const owner = "00000000-0000-4000-8000-000000000001";
const now = 1760000000000000n;
const paid: SessionSnapshot = { user: { subjectId: owner, expiresAtUtc: now + 90000000n },
  evaluatedAtUtc: now, tier: "paid", paidUntilUtc: now + 80000000n };
const clock = { nowUtc: () => now };
const controller = new AbortController();
const item = (id: string, university = "UNI1"): NativeObject => ({
  offering_id: id, academic_year: 2027, university_id: university, university_name: "가상대",
  campus: null, department: "합성학과", track: "합성전형", group: "가", region: null, wildcard_group: null,
});

Deno.test("3P: same owner, year and requested PKs return stored zero and leave missing blank", async () => {
  const got: { owner?: string; year?: number; ids?: readonly string[] } = {};
  const result = await attachSavedPageScores({ items: [item("2027:a"), item("2027:b")] }, paid, clock,
    controller.signal, { read: async (session, year, ids) => {
      got.owner = session.user.subjectId; got.year = year; got.ids = ids;
      return { state: "ready" as const, scores: new Map([["2027:a", {
        status: "ready" as const, converted_score: "0", official_max_score: "1000", reason_code: null,
      }]]) };
    } });
  const rows = result.items as NativeObject[];
  ok(got.owner === owner && got.year === 2027 && got.ids?.join(",") === "2027:a,2027:b");
  ok((rows[0].my_score as NativeObject).converted_score === "0");
  ok(rows[1].my_score === null && result.my_score_state === "partial");
});
Deno.test("3P: unavailable personal score preserves the catalog with blank fields", async () => {
  const result = await attachSavedPageScores({ items: [item("2027:a")] }, paid, clock, controller.signal,
    { read: async () => ({ state: "unavailable" as const }) });
  ok(result.my_score_state === "unavailable" && (result.items as NativeObject[])[0].my_score === null);
});
Deno.test("3P: unpaid user is rejected before personal score read", async () => {
  let called = false;
  const standard: SessionSnapshot = { ...paid, tier: "standard", paidUntilUtc: null };
  await rejected(() => attachSavedPageScores({ items: [item("2027:a")] }, standard, clock, controller.signal,
    { read: async () => { called = true; return { state: "no_profile" as const }; } }), "paid_required");
  ok(!called);
});
Deno.test("3P: unrelated score PK is rejected instead of leaking into output", async () => {
  await rejected(() => attachSavedPageScores({ items: [item("2027:a")] }, paid, clock, controller.signal,
    { read: async () => ({ state: "ready" as const, scores: new Map([["2027:other", {
      status: "ready" as const, converted_score: "1", official_max_score: "1000", reason_code: null,
    }]]) }) }), "storage_result_invalid");
});
Deno.test("3P SQL: owner, profile, approved pin and requested PK are bound together", async () => {
  let seen: readonly unknown[] = [];
  const fake = { read: async (subject: string, work: (tx: unknown) => Promise<unknown>) => {
    ok(subject === owner);
    return await work({ query: async (sql: string, params: readonly unknown[]) => {
      ok(sql.includes("m.owner_id=$1") && sql.includes("m.profile_id=$2") && sql.includes("m.data_pin=$3"));
      ok(sql.includes("p.confirmed")); seen = params;
      return [["2027:a", "ready", "0", "1000", null]];
    } });
  } } as unknown as SupabaseSqlTransport;
  const pin = "a".repeat(64);
  const got = await readSavedScoreMap(fake, { owner, profileId: "profile-1", dataPin: pin,
    signal: controller.signal, assertActive() {} }, ["2027:a"]);
  ok(seen[0] === owner && seen[1] === "profile-1" && seen[2] === pin && seen[3] === '["2027:a"]');
  ok(got.get("2027:a")?.converted_score === "0");
});
Deno.test("3P SQL: transient connection error is distinct from authorization errors", async () => {
  const fake = { read: async (_: string, work: (tx: unknown) => Promise<unknown>) =>
    await work({ query: async () => { throw { code: "ECONNRESET" }; } }) } as unknown as SupabaseSqlTransport;
  try { await readSavedScoreMap(fake, { owner, profileId: "profile-1", dataPin: "a".repeat(64),
    signal: controller.signal, assertActive() {} }, ["2027:a"]); }
  catch (e) { ok(e instanceof SavedScoreTransientUnavailable); return; }
  throw new Error("expected_transient_error");
});
const expected = { reportId: "report-1", revision: 3, profileId: "profile-1",
  examId: "exam-2027", packVersion: "pack-1" };
function savedFor(contextOwner = owner, profile = "profile-1") {
  return new MemberJsonResults({ read: async (subject, year, ids, reportId, revision) => {
    ok(subject === owner && year === 2027 && reportId === "report-1" && revision === 3);
    ok(ids.join(",") === "2027:a,2027:b,2027:c");
    return { context: { owner: contextOwner, year: 2027, report_id: "report-1", report_revision: 3,
      profile_id: profile, exam_id: "exam-2027", pack_version: "pack-1", source: "selected_report" as const },
      analyses: { "2027:a": { status: "ready", category: "core", reason_code: null },
        "2027:b": { status: "ready", category: "room", reason_code: null } } };
  } }, 100);
}
Deno.test("4P: saved matching PKs group by university and retain missing as partial", async () => {
  const result = await readSavedCandidateGroups(paid, 2027,
    [item("2027:a"), item("2027:b"), item("2027:c")], "current:abc",
    savedFor(), clock, controller.signal, expected, ["2027:a", "2027:b", "2027:c", "2027:missing"]);
  const groups = result.basic_university_groups as NativeObject[];
  const missing = result.pending_offerings as NativeObject[];
  ok(result.status === "pending" && result.reason_code === "approved_candidates_missing");
  ok(groups.length === 1 && groups[0].university_id === "UNI1");
  ok((groups[0].offerings as NativeObject[]).length === 2);
  ok(missing.some((row) => row.offering_id === "2027:c"));
  ok(missing.some((row) => row.offering_id === "2027:missing"));
});
Deno.test("4P: another owner or a different saved profile is rejected", async () => {
  const rows = [item("2027:a"), item("2027:b"), item("2027:c")];
  await rejected(() => readSavedCandidateGroups(paid, 2027, rows, "current:abc",
    savedFor("00000000-0000-4000-8000-000000000002"), clock, controller.signal, expected,
    ["2027:a", "2027:b", "2027:c"]), "storage_result_invalid");
  await rejected(() => readSavedCandidateGroups(paid, 2027, rows, "current:abc",
    savedFor(owner, "other-profile"), clock, controller.signal, expected,
    ["2027:a", "2027:b", "2027:c"]), "storage_result_invalid");
});