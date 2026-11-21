import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// 2026-11-21 대표님 지적: 3·4페이지는 계산(분석·후보·옛 자료판 재확인)을 끝낸 뒤 한 번에 보인다.
// report-ops 의 settleAnalyses·settleCandidates 를 실제 코드로 돌리고 API 포트만 바꾼다.
const opsUrl = new URL("../src/lib/report-ops.ts", import.meta.url).href;
const classesUrl = new URL("../src/lib/api/source.ts", import.meta.url).href;
const data = (code) => "data:text/javascript," + encodeURIComponent(code);
const mocks = new Map([
  ["server-only", data("export {}")],
  ["@/lib/api", data(`export {AccessDenied, ConnectionError} from ${JSON.stringify(classesUrl)};`)],
  ["@/lib/report-ref", data("export async function currentReportId(){return null}")],
]);
registerHooks({ resolve(id, context, next) { return next(mocks.get(id) ?? id, context); } });
const { settleAnalyses, settleCandidates } = await import(opsUrl);
const { ConnectionError } = await import(classesUrl);

const caller = { accessToken: "synthetic-port-only" };
const saved = { status: "ready" };
const report = (patch = {}) => ({ report_id: "R", profile_id: "P", report_version: 7, analyses: {}, candidates: null, shortlist: {}, ...patch });
const writes = (p) => p.calls.filter((c) => c.op !== "read");
const conflictReply = () => ({ ok: false, code: "revision_conflict", status: 409 });
function port(replies = []) {
  const calls = [];
  const reply = (op, args) => {
    calls.push({ op, args });
    const r = replies.shift();
    if (r instanceof Error) throw r;
    return r;
  };
  return {
    calls,
    src: {
      async readReport(...args) { return reply("read", args); },
      async analyzeUniversities(...args) { return reply("ua", args); },
      async buildCandidates(...args) { return reply("cb", args); },
    },
  };
}

test("missing analyses are computed before the list is drawn; saved ones are not recomputed", async () => {
  const done = report({ report_version: 8, analyses: { A: saved, B: saved } });
  const p = port([{ ok: true, value: done }]);
  const out = await settleAnalyses(p.src, caller, report({ analyses: { A: saved } }), ["A", "B"]);
  assert.equal(out, done);
  assert.deepEqual(p.calls.map((c) => c.op), ["ua", "read"]);
  assert.deepEqual(p.calls[0].args[3], ["B"]);
});

test("after a successful write the list is drawn from a fresh report read, not the write response (2026-11-22 rnat3f)", async () => {
  // 쓰기 응답에는 읽기에서만 붙는 값이 빠져 옛 결과처럼 보였다. 새로 읽은 리포트로 그린다
  const old = report({ report_id: "R-read", analyses: { A: saved }, stale_analysis_ids: ["A"] });
  const response = report({ report_id: "R-read", report_version: 8, analyses: { A: saved } });
  const readBack = report({ report_id: "R-read", report_version: 8, analyses: { A: { status: "pending", reference_band: { code: "target" } } }, stale_analysis_ids: [] });
  const p = port([{ ok: true, value: response }, readBack]);
  assert.equal(await settleAnalyses(p.src, caller, old, ["A"]), readBack);
  assert.deepEqual(p.calls.map((c) => c.op), ["ua", "read"]);
  const built = report({ report_id: "C-read", report_version: 8, candidates: full });
  const builtRead = report({ report_id: "C-read", report_version: 8, candidates: full, candidates_stale: false });
  const q = port([{ ok: true, value: built }, builtRead]);
  assert.equal(await settleCandidates(q.src, caller, report({ report_id: "C-read" })), builtRead);
  // 다시 읽기가 실패하면 쓰기 응답으로라도 그린다(재확인 전 리포트로 되돌리지 않는다)
  const r = port([{ ok: true, value: response }, new ConnectionError("unavailable", "backend_dependency_unavailable")]);
  assert.equal(await settleAnalyses(r.src, caller, report({ report_id: "R-read2" }), ["A"]), response);
});

test("nothing to do sends nothing", async () => {
  const p = port();
  const r = report({ analyses: { A: saved } });
  assert.equal(await settleAnalyses(p.src, caller, r, ["A"]), r);
  assert.equal(p.calls.length, 0);
});

test("stale analyses in view are re-checked once; reopening the same report version does not send again", async () => {
  const r = report({ report_id: "R-stale", analyses: { A: saved, B: saved }, stale_analysis_ids: ["B", "Z"] });
  // 서버가 재확인 뒤에도 옛 자료판이라고 해도 그 결과를 확정 표시로 두고 되풀이하지 않는다
  const still = report({ report_id: "R-stale", report_version: 8, analyses: { A: saved, B: saved }, stale_analysis_ids: ["B"] });
  const p1 = port([{ ok: true, value: still }]);
  assert.equal(await settleAnalyses(p1.src, caller, r, ["A", "B"]), still);
  assert.equal(writes(p1).length, 1);
  assert.deepEqual(p1.calls[0].args[3], ["B"]);
  const p2 = port();
  assert.equal(await settleAnalyses(p2.src, caller, r, ["B", "A"]), r);
  assert.equal(await settleAnalyses(p2.src, caller, still, ["B", "A"]), still);
  assert.equal(p2.calls.length, 0);
  // 리포트 판이 그 뒤로 올라가면(새 분석·담기 등) 다시 한 번 확인한다
  const later = report({ report_id: "R-stale", report_version: 9, analyses: { A: saved, B: saved }, stale_analysis_ids: ["B"] });
  const p3 = port([{ ok: true, value: later }]);
  await settleAnalyses(p3.src, caller, later, ["A", "B"]);
  assert.equal(writes(p3).length, 1);
});

test("a failed or rate-limited computation still draws the screen with the report it had", async () => {
  const r = report();
  const failed = port([{ ok: false, code: "offering_not_found", status: 404 }]);
  assert.equal(await settleAnalyses(failed.src, caller, r, ["A"]), r);
  const limited = port([new ConnectionError("rate_limited", "rate_limit_exceeded")]);
  assert.equal(await settleAnalyses(limited.src, caller, r, ["A"]), r);
});

test("a 503 after the write re-reads the report (the analysis may have been saved)", async () => {
  const r = report();
  const reread = report({ report_version: 8, analyses: { A: saved } });
  const p = port([new ConnectionError("unavailable", "backend_dependency_unavailable"), reread]);
  assert.equal(await settleAnalyses(p.src, caller, r, ["A"]), reread);
  assert.deepEqual(p.calls.map((c) => c.op), ["ua", "read"]);
});

const full = { status: "ready", basic_university_groups: [{ university_id: "U", university_name: "u", offerings: [] }], wildcards: [], pending_offerings: [] };

const refRows = [{ university_id: "T", university_name: "문턱대", offerings: [{ offering: { offering_id: "2027:91", department: "경영학과" }, reference_band: { basis: "reference_threshold", code: "target", label: "적정", source: "c" } }] }];
const summary = { basis: "reference_threshold", threshold_version: "t", universe: 10, judged: 5, listed: 1, delivered: 1, complete: false };

test("page 3 (dep_r17): every open builds once with a fresh key; the response's reference list is kept over report.read", async () => {
  const before = report({ report_id: "C1", candidates: full });
  const response = report({ report_id: "C1", report_version: 8, candidates: { ...full, reference_university_groups: refRows, reference_threshold_summary: summary } });
  const readBack = report({ report_id: "C1", report_version: 8, candidates: full, shortlist: { X: { selected: true } } });
  const p = port([{ ok: true, value: response }, readBack]);
  const out = await settleCandidates(p.src, caller, before);
  assert.deepEqual(p.calls.map((c) => c.op), ["cb", "read"]);
  assert.equal(p.calls[0].args[2], 7); // expected_version = 연 리포트 판
  assert.deepEqual(out.candidates.reference_university_groups, refRows);
  assert.equal(out.candidates.reference_threshold_summary.complete, false); // 미뤄도 받은 만큼, 다시 부르지 않는다
  assert.ok(out.shortlist.X); // 나머지는 다시 읽은 리포트
  const q = port([{ ok: true, value: response }, readBack]);
  await settleCandidates(q.src, caller, readBack);
  assert.equal(writes(q).length, 1);
  assert.notEqual(p.calls[0].args[3], q.calls[0].args[3]); // 열 때마다 새 요청 키
  assert.equal(q.calls[0].args[2], 8); // 응답 판으로 다음 호출
});

test("page 3 (dep_r17): a server-action re-render reuses the list just received instead of building again", async () => {
  const before = report({ report_id: "C7", candidates: full });
  const response = report({ report_id: "C7", report_version: 8, candidates: { ...full, reference_university_groups: refRows, reference_threshold_summary: summary } });
  await settleCandidates(port([{ ok: true, value: response }, report({ report_id: "C7", report_version: 8, candidates: full })]).src, caller, before);
  const afterAction = report({ report_id: "C7", report_version: 9, candidates: full });
  const p = port();
  const out = await settleCandidates(p.src, caller, afterAction, { reuse: true });
  assert.equal(p.calls.length, 0);
  assert.deepEqual(out.candidates.reference_university_groups, refRows);
  // 받은 목록이 없으면(다른 화면 서버 등) 한 번 만든다
  const other = port([{ ok: true, value: response }]);
  await settleCandidates(other.src, caller, report({ report_id: "C8", candidates: full }), { reuse: true });
  assert.equal(writes(other).length, 1);
});

test("page 3 (dep_r13 compatible): a list already stored in the report is used as is; no list keeps the plain report", async () => {
  const stored = [{ university_id: "S", university_name: "저장대", offerings: [{ offering: { offering_id: "2027:5", department: "가" }, reference_percentile: { status: "reference_estimated", estimated_upper_cumulative_percent_all_examinees: "5" } }] }];
  const read = report({ report_id: "C9", report_version: 8, candidates: { ...full, reference_university_groups: stored } });
  const p = port([{ ok: true, value: read }, read]);
  const out = await settleCandidates(p.src, caller, report({ report_id: "C9", candidates: full }));
  assert.deepEqual(out.candidates.reference_university_groups, stored);
  // 후보가 없던 리포트: 응답 후보로 그린다
  const built = report({ report_id: "C10", report_version: 8, candidates: full });
  const q = port([{ ok: true, value: built }, report({ report_id: "C10", report_version: 8, candidates: null })]);
  assert.deepEqual((await settleCandidates(q.src, caller, report({ report_id: "C10" }))).candidates, full);
});

test("page 3 (dep_r17): 409 reads the current version and retries once; other refusals keep the report", async () => {
  const before = report({ report_id: "C11", candidates: full });
  const fresh = report({ report_id: "C11", report_version: 9, candidates: full });
  const built = report({ report_id: "C11", report_version: 10, candidates: full });
  const p = port([conflictReply(), fresh, { ok: true, value: built }, built]);
  assert.equal(await settleCandidates(p.src, caller, before), built);
  assert.deepEqual(p.calls.map((c) => c.op), ["cb", "read", "cb", "read"]);
  assert.equal(p.calls[2].args[2], 9);
  const twice = port([conflictReply(), fresh, conflictReply()]);
  assert.equal(await settleCandidates(twice.src, caller, before), fresh);
  const refused = port([{ ok: false, code: "score_confirmation_required", status: 409 }]);
  assert.equal(await settleCandidates(refused.src, caller, before), before);
});
test("an unexpected (non-connection) error during automatic settling never breaks the page (2026-11-22 incident)", async () => {
  const r = report({ report_id: "E1" });
  const boom = port([new Error("정시터치 API 500 internal")]);
  assert.equal(await settleAnalyses(boom.src, caller, r, ["A"]), r);
  const built = report({ report_id: "E1", report_version: 8, candidates: full });
  const rereadBoom = port([{ ok: true, value: built }, new Error("정시터치 API 500 reread")]);
  assert.equal(await settleCandidates(rereadBoom.src, caller, r), built);
});
