import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";

// 어느 리포트를 열지는 계정 기준(2026-11-04 사용자 결정): 서버 입력 상태의 current_report_id, 브라우저 번호 없음
const refUrl = new URL("../src/lib/report-ref.ts", import.meta.url);
const data = (code) => "data:text/javascript," + encodeURIComponent(code);
const mocks = new Map([
  ["server-only", data("export {}")],
  ["@/lib/exam", data("export const EXAM={exam_id:'synthetic-exam'}")],
  ["@/lib/score-validity", new URL("../src/lib/score-validity.ts", import.meta.url).href],
]);
registerHooks({ resolve(id, context, next) { return next(mocks.get(id) ?? id, context); } });
const { currentReportId, inaccurateSeen, screenReport } = await import(refUrl.href);

const caller = { accessToken: "synthetic-port-only" };
const src = (status) => {
  const calls = [];
  return { calls, async readScoreInputStatus(...args) { calls.push(args); if (status instanceof Error) throw status; return status; } };
};

test("the current report comes from the account's score-input status", async () => {
  const s = src({ current_report_id: "SYNTHETIC-R" });
  assert.equal(await currentReportId(s, caller), "SYNTHETIC-R");
  assert.deepEqual(s.calls, [[caller, "synthetic-exam"]]);
});

test("an account without a saved score has no current report", async () => {
  assert.equal(await currentReportId(src({ current_report_id: null }), caller), null);
});

test("a status read failure is not turned into 'no report'", async () => {
  const err = new Error("synthetic connection failure");
  await assert.rejects(currentReportId(src(err), caller), err);
});

test("no page or action remembers a report id in the browser", async () => {
  const files = ["../src/lib/report-ref.ts", "../src/lib/report-ops.ts", "../src/app/reports/me/actions.ts", "../src/app/reports/me/page.tsx", "../src/app/reports/me/print/page.tsx"];
  for (const f of files) {
    const text = await readFile(new URL(f, import.meta.url), "utf8");
    // 인쇄 화면만 예외: 9월 지난 기록의 '상담 리포트 인쇄용 보기'(2026-11-22)가 주소로 리포트 번호를 넘긴다 — 아래 시험에서 범위를 확인한다
    const forbidden = f.endsWith("print/page.tsx") ? /jt_report_id|cookies\(\)|getReportId|setReportId|\?pick=1/ : /jt_report_id|cookies\(\)|getReportId|setReportId|\?pick=1|\?report=/;
    assert.doesNotMatch(text, forbidden, f);
  }
});

test("print page: a report id from the address is printed only if it is in the member's own 9월 list; otherwise the current report", async () => {
  const text = await readFile(new URL("../src/app/reports/me/print/page.tsx", import.meta.url), "utf8");
  assert.match(text, /src\.listOwnReports\(caller, \{ exam_id: MOCK_EXAM\.exam_id, limit: 20 \}\)/);
  assert.match(text, /reportId = list\.items\.some\(\(i\) => i\.report_id === wanted && \(!i\.exam_id \|\| i\.exam_id === MOCK_EXAM\.exam_id\)\) \? wanted : null;/);
  // 브라우저에 리포트 번호를 저장하지 않는다(주소 값은 그 요청에만 쓴다)
  assert.doesNotMatch(text, /localStorage|sessionStorage|document\.cookie/);
});

// 부정확 입력(2026-11-22 대표님 결정): 3·4페이지와 분석 버튼은 현재 리포트를 받지 못해 분석하지 않고, 화면은 안내를 고른다
test("an inaccurate (rejected) last save opens no current report and is remembered for the page", async () => {
  const c = { accessToken: "synthetic-inaccurate" };
  assert.equal(await currentReportId(src({ stage: "provisional", last_attempt_outcome: "rejected", current_report_id: "OLD" }), c), null);
  assert.equal(inaccurateSeen(c), true);
  const ok = { accessToken: "synthetic-accurate" };
  assert.equal(await currentReportId(src({ stage: "provisional", last_attempt_outcome: "accepted", current_report_id: "R" }), ok), "R");
  assert.equal(inaccurateSeen(ok), false);
  // 끝난 9월 모의평가 단계의 거절은 막지 않는다(지난 기록 그대로)
  const mock = { accessToken: "synthetic-mock" };
  assert.equal(await currentReportId(src({ stage: "mock", last_attempt_outcome: "rejected", current_report_id: "M" }), mock), "M");
});

test("a provisional report saved with an unattainable raw score is screened out", () => {
  const c = { accessToken: "synthetic-screen" };
  const report = { overall: { subjects: [{ area: "korean", raw_score: 99 }, { area: "math", raw_score: 84 }] } };
  assert.equal(screenReport(c, report), null);
  assert.equal(inaccurateSeen(c), true);
  const fine = { overall: { subjects: [{ area: "korean", raw_score: 98 }, { area: "inquiry1", subject: "x", raw_score: 50 }] } };
  const c2 = { accessToken: "synthetic-screen-ok" };
  assert.equal(screenReport(c2, fine), fine);
  assert.equal(inaccurateSeen(c2), false);
});