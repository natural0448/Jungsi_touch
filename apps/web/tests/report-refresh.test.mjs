import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";

const opsUrl = new URL("../src/lib/report-ops.ts", import.meta.url).href;
const classesUrl = new URL("../src/lib/api/source.ts", import.meta.url).href;
const data = (code) => "data:text/javascript," + encodeURIComponent(code);
const mocks = new Map([
  ["server-only", data("export {}")],
  ["@/lib/api", data(`export {AccessDenied,ConnectionError} from ${JSON.stringify(classesUrl)};export const getCaller=async()=>globalThis.__refreshFixture.caller;export const source=()=>globalThis.__refreshFixture.src;`)],
  // report-ops 가 브라우저 화면과 함께 쓰는 읽기 전용 판단(2026-11-22 ship54 분리)
  ["@/lib/report-pure", new URL("../src/lib/report-pure.ts", import.meta.url).href],
  ["@/lib/report-ref", data("export const screenReport=(c,r)=>r;export const currentReportId=async()=>globalThis.__refreshFixture.cookie;")],
  ["@/lib/report-ops", opsUrl],
  ["@/lib/connection-text", new URL("../src/lib/connection-text.ts", import.meta.url).href],
  // connection-text 가 시각 표시용으로 부르는 같은 폴더 모듈(429 안내, 2026-11-19)
  ["./format", new URL("../src/lib/format.ts", import.meta.url).href],
  ["next/cache", data("export const revalidatePath=(...args)=>globalThis.__refreshFixture.revalidations.push(args);")],
]);
registerHooks({ resolve(id, context, next) { return next(mocks.get(id) ?? id, context); } });
const { refreshAnalyses, refreshCandidates, ensureAnalyses, ensureCandidates } = await import(opsUrl);
const { refreshAnalysesNow, refreshCandidatesNow } = await import("../src/app/analysis-actions.ts");
const { ConnectionError, AccessDenied } = await import(classesUrl);
const ID1 = "00000000-0000-4000-8000-000000000001";
const ID2 = "00000000-0000-4000-8000-000000000002";
const ready = { status: "ready", converted_score: "0", category: "core" };
const held = { status: "pending", converted_score: "321.5", category: "pending", reason_code: "university_curve_missing" };
const candidates = { status: "pending", reason_code: "offering_analysis_pending", basic_university_groups: [], wildcards: [], pending_offerings: [{ offering_id: "A" }] };
const report = (patch = {}) => ({ report_id: "SYNTHETIC-R", profile_id: "SYNTHETIC-P", report_version: 7, analyses: { A: held, B: ready }, candidates, shortlist: { A: { selected: true } }, ...patch });
const intent = (patch = {}) => ({ id: ID1, reportId: "SYNTHETIC-R", profileId: "SYNTHETIC-P", reportVersion: 7, ...patch });
const conflict = () => ({ ok: false, code: "revision_conflict", status: 409 });
function fixture(r = report(), options = {}) {
  const f = { report: r, caller: { accessToken: "synthetic-port-only" }, cookie: r?.report_id ?? null, calls: [], reads: [], replies: [], revalidations: [], ...options };
  const write = (op, args) => {
    f.calls.push({ op, args }); const result = f.replies.shift(); if (result instanceof Error) throw result;
    return result ?? { ok: true, value: f.report };
  };
  f.src = {
    async readReport(...args) { f.calls.push({ op: "read", args }); return f.reads.length ? f.reads.shift() : f.report; },
    async analyzeUniversities(...args) { return write("ua", args); },
    async buildCandidates(...args) { return write("cb", args); },
  };
  globalThis.__refreshFixture = f; return f;
}
const calls = (f, op) => f.calls.filter((c) => c.op === op);
const analyze = (f, ids = ["A", "B"], command = intent()) => refreshAnalyses(f.src, f.caller, f.report, ids, command);
const build = (f, command = intent()) => refreshCandidates(f.src, f.caller, f.report, command);
const key = (prefix, version, payload) => `${prefix}-${createHash("sha256").update(JSON.stringify([prefix, "SYNTHETIC-R", version, { intent_id: ID1, request: payload }])).digest("hex")}`;
function form(patch = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ refresh_intent: ID1, report_id: "SYNTHETIC-R", profile_id: "SYNTHETIC-P", report_version: "7", ids: "A,B", ...patch })) fd.set(k, v);
  return fd;
}

test("default missing-only flows still reuse saved pending/ready and candidates", async () => {
  const f = fixture(); await ensureAnalyses(f.src, f.caller, f.report, ["A", "B"]); await ensureCandidates(f.src, f.caller, f.report);
  assert.equal(f.calls.length, 0);
});
test("explicit analysis sends the exact selected saved-pending/ready scope", async () => {
  const f = fixture(); const before = structuredClone(f.report); const out = await analyze(f, ["B", " A ", "A"]);
  assert.equal(out.report, f.report); assert.deepEqual(calls(f, "ua")[0].args.slice(1, 4), ["SYNTHETIC-R", 7, ["A", "B"]]);
  assert.equal(calls(f, "ua")[0].args[4], key("uar", 7, { expected_version: 7, offering_ids: ["A", "B"] }));
  assert.deepEqual(f.report, before); assert.equal(f.report.analyses.B.converted_score, "0"); assert.equal(f.report.analyses.A.converted_score, "321.5");
});
test("same intent/version/body retransmission has stable key after duplicate/order normalization", async () => {
  const a = fixture(); await analyze(a, ["A", "B", "A"]); const b = fixture(); await analyze(b, ["B", "A"]);
  assert.deepEqual(calls(a, "ua")[0].args, calls(b, "ua")[0].args);
});
test("next explicit intent gets a different key even at the same report revision", async () => {
  const a = fixture(); await analyze(a); const b = fixture(); await analyze(b, ["A", "B"], intent({ id: ID2 }));
  assert.notEqual(calls(a, "ua")[0].args[4], calls(b, "ua")[0].args[4]);
});
test("same form revision is retained for replay after current report revision advances", async () => {
  const a = fixture(); await analyze(a); const b = fixture(report({ report_version: 8 })); await analyze(b);
  assert.deepEqual(calls(a, "ua")[0].args, calls(b, "ua")[0].args);
});
test("a conflict rereads once and retries exact explicit scope with same intent/new body", async () => {
  const fresh = report({ report_version: 8 }); const f = fixture(report(), { replies: [conflict()], reads: [fresh] });
  await analyze(f); assert.equal(calls(f, "read").length, 1); assert.equal(calls(f, "ua").length, 2);
  assert.equal(calls(f, "ua")[1].args[4], key("uar", 8, { expected_version: 8, offering_ids: ["A", "B"] }));
  assert.notEqual(calls(f, "ua")[0].args[4], calls(f, "ua")[1].args[4]);
});
test("two refresh conflicts are failure and preserve the latest saved result", async () => {
  const fresh = report({ report_version: 8 }); const f = fixture(report(), { replies: [conflict(), conflict()], reads: [fresh] });
  assert.deepEqual(await analyze(f), { kind: "failed", report: fresh, code: "revision_conflict" });
  assert.equal(calls(f, "read").length, 1); assert.equal(calls(f, "ua").length, 2);
});
for (const patch of [{ report_id: "OTHER-R" }, { profile_id: "OTHER-P" }]) {
  test(`refresh target change before call is rejected: ${Object.keys(patch)[0]}`, async () => {
    const f = fixture(report(patch)); assert.equal((await analyze(f)).code, "refresh_target_changed"); assert.equal(f.calls.length, 0);
  });
  test(`refresh target change after conflict is not silently retargeted: ${Object.keys(patch)[0]}`, async () => {
    const f = fixture(report(), { replies: [conflict()], reads: [report({ report_version: 8, ...patch })] });
    assert.equal((await analyze(f)).code, "refresh_target_changed"); assert.equal(calls(f, "ua").length, 1);
  });
}
for (const command of [intent({ id: "bad" }), intent({ reportVersion: 0 }), intent({ reportVersion: 8 }), intent({ reportVersion: 1.5 })]) {
  test(`invalid refresh intent is rejected: ${command.id}:${command.reportVersion}`, async () => {
    const f = fixture(); assert.equal((await analyze(f, ["A"], command)).code, "invalid_refresh_intent"); assert.equal(f.calls.length, 0);
  });
}
for (const ids of [[], Array.from({ length: 101 }, (_, i) => "X" + i)]) {
  test(`refresh scope is explicit and not silently truncated: ${ids.length}`, async () => {
    const f = fixture(); assert.equal((await analyze(f, ids)).code, "invalid_refresh_scope"); assert.equal(f.calls.length, 0);
  });
}
test("deduplicated 100-ID explicit scope is accepted", async () => {
  const f = fixture(); await analyze(f, [...Array.from({ length: 100 }, (_, i) => "X" + i), "X0"]); assert.equal(calls(f, "ua")[0].args[3].length, 100);
});
for (const c of [candidates, { ...candidates, status: "ready", pending_offerings: [] }]) {
  test(`explicit candidate refresh reaches the existing API for saved ${c.status}`, async () => {
    const f = fixture(report({ candidates: c })); const out = await build(f);
    assert.equal(calls(f, "cb").length, 1); assert.equal(out.report.candidates, c);
    assert.equal(calls(f, "cb")[0].args[3], key("cbr", 7, { expected_version: 7 }));
  });
}
test("candidate retry does not use the default saved-pending shortcut", async () => {
  const f = fixture(report(), { replies: [conflict()], reads: [report({ report_version: 8 })] }); await build(f);
  assert.equal(calls(f, "read").length, 1); assert.equal(calls(f, "cb").length, 2);
});
test("candidate new intent is distinct while retransmission stays stable", async () => {
  const a = fixture(); await build(a); const b = fixture(); await build(b); const c = fixture(); await build(c, intent({ id: ID2 }));
  assert.equal(calls(a, "cb")[0].args[3], calls(b, "cb")[0].args[3]); assert.notEqual(calls(a, "cb")[0].args[3], calls(c, "cb")[0].args[3]);
});
test("analysis and candidate refresh keys are separated", async () => {
  const f = fixture(); await analyze(f); await build(f); assert.notEqual(calls(f, "ua")[0].args[4], calls(f, "cb")[0].args[3]);
});
test("successful pending response remains pending rather than pretending ready results", async () => {
  const f = fixture(); const out = await analyze(f); assert.equal(out.report.analyses.A.status, "pending");
  assert.equal(out.report.analyses.A.converted_score, "321.5"); assert.equal(out.report.candidates.status, "pending");
});
test("analysis action uses only current own report and explicit bounded IDs", async () => {
  const f = fixture(); assert.deepEqual(await refreshAnalysesNow({ error: null }, form()), { error: null });
  assert.equal(calls(f, "ua").length, 1); assert.deepEqual(f.revalidations, [["/", "layout"]]);
});
test("candidate action refreshes stored pending without score entry", async () => {
  const f = fixture(); assert.deepEqual(await refreshCandidatesNow({ error: null }, form()), { error: null });
  assert.equal(calls(f, "cb").length, 1); assert.equal(f.report.profile_id, "SYNTHETIC-P");
});
for (const version of ["0", "7.0", "1e1", "9007199254740992", ""]) {
  test(`malformed form revision ${version || "empty"} is rejected before port access`, async () => {
    const f = fixture(); assert.ok((await refreshAnalysesNow({ error: null }, form({ report_version: version }))).error); assert.equal(f.calls.length, 0);
  });
}
test("missing intent and oversized form scope are rejected before port access", async () => {
  const f = fixture(); assert.ok((await refreshCandidatesNow({ error: null }, form({ refresh_intent: "" }))).error);
  assert.ok((await refreshAnalysesNow({ error: null }, form({ ids: Array.from({ length: 101 }, (_, i) => "X"+i).join(",") }))).error); assert.equal(f.calls.length, 0);
});
test("cookie/report or profile switch never applies a stale form to new scores", async () => {
  const f = fixture(report({ profile_id: "NEW-SYNTHETIC-P" })); assert.match((await refreshAnalysesNow({ error: null }, form())).error, /refresh_target_changed/);
  assert.equal(calls(f, "ua").length, 0); assert.equal(f.revalidations.length, 0);
});
test("transition-pending action has a distinct preserved-score notice without a promised date", async () => {
  const f = fixture(report(), { replies: [new ConnectionError("unavailable", "score_input_transition_pending")] });
  const out = await refreshCandidatesNow({ error: null }, form()); assert.match(out.error, /같은 성적을 다시 입력할 필요가 없습니다/);
  assert.doesNotMatch(out.error, /몇 초|잠시 뒤|나중에 다시|10월|10\/30/); assert.equal(f.revalidations.length, 0);
});
test("transition-pending Result uses the same dedicated notice without immediate-retry advice", async () => {
  const f = fixture(report(), { replies: [{ ok: false, code: "score_input_transition_pending", status: 503 }] });
  const out = await refreshAnalysesNow({ error: null }, form()); assert.match(out.error, /같은 성적을 다시 입력할 필요가 없습니다/);
  assert.match(out.error, /score_input_transition_pending/); assert.doesNotMatch(out.error, /몇 초|잠시 뒤|나중에 다시|10월|10\/30/);
  assert.equal(f.revalidations.length, 0);
});
for (const error of [new AccessDenied(401, "expired"), new AccessDenied(403, "paid_required"), new ConnectionError("rate_limited", "quota")]) {
  test(`refresh preserves existing authorization/rate-limit failure ${error.message}`, async () => {
    const f = fixture(report(), { replies: [error] }); assert.ok((await refreshAnalysesNow({ error: null }, form())).error); assert.equal(f.revalidations.length, 0);
  });
}
