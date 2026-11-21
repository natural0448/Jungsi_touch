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
const empty = { status: "ready", basic_university_groups: [], wildcards: [], pending_offerings: [] };

test("page 3: candidates are built when missing; a stored list is kept as is", async () => {
  const built = report({ report_id: "C1", report_version: 8, candidates: full });
  const p = port([{ ok: true, value: built }]);
  assert.equal(await settleCandidates(p.src, caller, report({ report_id: "C1" })), built);
  assert.deepEqual(p.calls.map((c) => c.op), ["cb", "read"]);
  const none = port();
  const ready = report({ report_id: "C2", candidates: full });
  assert.equal(await settleCandidates(none.src, caller, ready), ready);
  assert.equal(none.calls.length, 0);
});

test("page 3: stale or empty stored candidates are re-checked once per report version", async () => {
  const stale = report({ report_id: "C3", candidates: full, candidates_stale: true });
  const fresh = report({ report_id: "C3", report_version: 8, candidates: full });
  const q = port([{ ok: true, value: fresh }]);
  assert.equal(await settleCandidates(q.src, caller, stale), fresh);
  assert.deepEqual(q.calls.map((c) => c.op), ["cb", "read"]);
  // 표식이 없어도 비어 있는 후보(판정이 켜지기 전에 만든 것)는 한 번 다시 확인하고, 다시 열 때는 되풀이하지 않는다
  const old = report({ report_id: "C4", candidates: empty });
  const stillEmpty = report({ report_id: "C4", report_version: 8, candidates: empty });
  const r1 = port([{ ok: true, value: stillEmpty }]);
  assert.equal(await settleCandidates(r1.src, caller, old), stillEmpty);
  const r2 = port();
  assert.equal(await settleCandidates(r2.src, caller, stillEmpty), stillEmpty);
  assert.equal(writes(r1).length, 1);
  assert.equal(r2.calls.length, 0);
});

test("page 3: a deferred threshold summary (complete=false) gets one more try on the next open, then stops (dep_r15, 2026-11-21)", async () => {
  const partial = { ...empty, reference_threshold_summary: { basis: "reference_threshold", threshold_version: "t", universe: 600, judged: 600, listed: 300, delivered: 200, complete: false, deferred: 100 } };
  const r0 = report({ report_id: "C5", candidates: partial });
  const r1 = report({ report_id: "C5", report_version: 8, candidates: partial });
  const p1 = port([{ ok: true, value: r1 }]);
  assert.equal(await settleCandidates(p1.src, caller, r0), r1);
  const r2 = report({ report_id: "C5", report_version: 9, candidates: partial });
  const p2 = port([{ ok: true, value: r2 }]);
  assert.equal(await settleCandidates(p2.src, caller, r1), r2);
  assert.notEqual(writes(p1)[0].args[3], writes(p2)[0].args[3]); // 두 번째는 다른 요청 키로 이어 계산
  const p3 = port();
  assert.equal(await settleCandidates(p3.src, caller, r2), r2);
  assert.equal(p3.calls.length, 0); // 세 번째는 보내지 않는다
});

test("page 3: analysing rows (report version goes up) does not rebuild unflagged empty candidates again", async () => {
  const r0 = report({ report_id: "C6", candidates: empty });
  const r1 = report({ report_id: "C6", report_version: 8, candidates: empty });
  await settleCandidates(port([{ ok: true, value: r1 }]).src, caller, r0);
  const later = report({ report_id: "C6", report_version: 12, candidates: empty });
  const p = port();
  assert.equal(await settleCandidates(p.src, caller, later), later);
  assert.equal(p.calls.length, 0);
});

test("an unexpected (non-connection) error during automatic settling never breaks the page (2026-11-22 incident)", async () => {
  const r = report({ report_id: "E1" });
  const boom = port([new Error("정시터치 API 500 internal")]);
  assert.equal(await settleAnalyses(boom.src, caller, r, ["A"]), r);
  const built = report({ report_id: "E1", report_version: 8, candidates: full });
  const rereadBoom = port([{ ok: true, value: built }, new Error("정시터치 API 500 reread")]);
  assert.equal(await settleCandidates(rereadBoom.src, caller, r), built);
});
