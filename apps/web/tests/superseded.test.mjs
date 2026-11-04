import test from "node:test";
import assert from "node:assert/strict";

// 정정 입력 뒤에는 현재 리포트 하나만 보인다(2026-10-28 사용자 결정). 실제 TypeScript 모듈을 그대로 실행한다.
const { onlyReportAfterCorrection, correctionExhausted } = await import("../src/lib/superseded.ts");

test("after a correction only the current report stays; otherwise nothing is hidden", () => {
  assert.equal(onlyReportAfterCorrection({ correction_used: 1, current_report_id: "r-new" }), "r-new");
  assert.equal(onlyReportAfterCorrection({ correction_used: 0, current_report_id: "r-first" }), null);
  // 입력 상태를 읽지 못했거나 현재 리포트를 모르면 숨기지 않는다
  assert.equal(onlyReportAfterCorrection(null), null);
  assert.equal(onlyReportAfterCorrection({ correction_used: 1, current_report_id: null }), null);
});

test("own list follows server is_current per stage when given, otherwise the status fallback", async () => {
  const { visibleOwnItems } = await import("../src/lib/superseded.ts");
  const it = (id, stage, is_current) => ({ report_id: id, exam_id: "e", report_version: 1, updated_at: "2026-12-01T00:00:00Z", stage, is_current });
  // 서버가 단계별 현재 여부를 주면: 가채점 현재 + 실채점 현재가 함께 남고 정정 전 리포트만 빠진다
  const server = visibleOwnItems([it("p-old", "provisional", false), it("p-new", "provisional", true), it("f-1", "final", true), it("x", null, null)], "f-1");
  assert.deepEqual(server.items.map((x) => x.report_id), ["p-new", "f-1", "x"]);
  assert.equal(server.byServer, true);
  // 지금 운영(필드 없음): 입력 상태의 현재 리포트 하나
  const legacy = visibleOwnItems([{ report_id: "a", exam_id: "e", report_version: 1, updated_at: "" }, { report_id: "b", exam_id: "e", report_version: 1, updated_at: "" }], "b");
  assert.deepEqual(legacy.items.map((x) => x.report_id), ["b"]);
  assert.equal(visibleOwnItems(legacy.items, null).items.length, 1);
  // 새 서버가 키는 보내고 값이 모두 null(모름): 아무것도 숨기지 않고, 입력 상태 하나로 되돌아가지도 않는다
  const allNull = visibleOwnItems([it("a", null, null), it("b", "final", null)], "b");
  assert.deepEqual(allNull.items.map((x) => x.report_id), ["a", "b"]);
  assert.equal(allNull.byServer, true);
  // 빈 목록
  assert.deepEqual(visibleOwnItems([], "b").items, []);
});

test("the '정정 입력 횟수 소진' tag appears only after every granted correction is used", () => {
  assert.equal(correctionExhausted({ correction_used: 1, correction_granted: 1, correction_request_remaining: 0 }), true);
  assert.equal(correctionExhausted({ correction_used: 0, correction_granted: 0, correction_request_remaining: 1 }), false);
  assert.equal(correctionExhausted({ correction_used: 0, correction_granted: 1, correction_request_remaining: 0 }), false);
  assert.equal(correctionExhausted({ correction_used: 1, correction_granted: 2, correction_request_remaining: 0 }), false);
  assert.equal(correctionExhausted({ correction_used: 1, correction_granted: 1, correction_request_remaining: 1 }), false);
  assert.equal(correctionExhausted(null), false);
});
