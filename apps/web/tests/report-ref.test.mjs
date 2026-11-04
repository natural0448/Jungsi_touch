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
]);
registerHooks({ resolve(id, context, next) { return next(mocks.get(id) ?? id, context); } });
const { currentReportId } = await import(refUrl.href);

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
    assert.doesNotMatch(text, /jt_report_id|cookies\(\)|getReportId|setReportId|\?pick=1|\?report=/, f);
  }
});
