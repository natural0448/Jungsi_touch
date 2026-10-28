import test from "node:test";
import assert from "node:assert/strict";

// 정정 입력 뒤에는 현재 리포트 하나만 보인다(2026-10-28 사용자 결정). 실제 TypeScript 모듈을 그대로 실행한다.
const { onlyReportAfterCorrection } = await import("../src/lib/superseded.ts");

test("after a correction only the current report stays; otherwise nothing is hidden", () => {
  assert.equal(onlyReportAfterCorrection({ correction_used: 1, current_report_id: "r-new" }), "r-new");
  assert.equal(onlyReportAfterCorrection({ correction_used: 0, current_report_id: "r-first" }), null);
  // 입력 상태를 읽지 못했거나 현재 리포트를 모르면 숨기지 않는다
  assert.equal(onlyReportAfterCorrection(null), null);
  assert.equal(onlyReportAfterCorrection({ correction_used: 1, current_report_id: null }), null);
});
