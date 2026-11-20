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
  assert.equal(p.calls.length, 1);
  assert.deepEqual(p.calls[0].args[3], ["B"]);
});

test("nothing to do sends nothing", async () => {
  const p = port();
  const r = report({ analyses: { A: saved } });
  assert.equal(await settleAnalyses(p.src, caller, r, ["A"]), r);
  assert.equal(p.calls.length, 0);
});

test("stale analyses in view are re-checked once with a stable intent (same screen → same key)", async () => {
  const r = report({ analyses: { A: saved, B: saved }, stale_analysis_ids: ["B", "Z"] });
  const fresh = report({ report_version: 8, analyses: { A: saved, B: saved }, stale_analysis_ids: [] });
  const p1 = port([{ ok: true, value: fresh }]);
  assert.equal(await settleAnalyses(p1.src, caller, r, ["A", "B"]), fresh);
  const p2 = port([{ ok: true, value: fresh }]);
  await settleAnalyses(p2.src, caller, r, ["B", "A"]);
  assert.equal(p1.calls.length, 1);
  assert.deepEqual(p1.calls[0].args[3], ["B"]);
  assert.equal(p1.calls[0].args[4], p2.calls[0].args[4]);
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

test("page 3: candidates are built when missing and re-checked when stale", async () => {
  const built = report({ report_version: 8, candidates: { basic_university_groups: [], wildcards: [], pending_offerings: [] } });
  const p = port([{ ok: true, value: built }]);
  assert.equal(await settleCandidates(p.src, caller, report()), built);
  const stale = report({ candidates: built.candidates, candidates_stale: true });
  const fresh = report({ report_version: 9, candidates: built.candidates, candidates_stale: false });
  const q = port([{ ok: true, value: fresh }]);
  assert.equal(await settleCandidates(q.src, caller, stale), fresh);
  assert.deepEqual(q.calls.map((c) => c.op), ["cb"]);
  const none = port();
  const ready = report({ candidates: built.candidates });
  assert.equal(await settleCandidates(none.src, caller, ready), ready);
  assert.equal(none.calls.length, 0);
});
