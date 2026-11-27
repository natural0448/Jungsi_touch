import test from "node:test";
import assert from "node:assert/strict";

// 가채점 정정은 수능 성적표 배부일 전날까지(2026-10-29 사용자 결정). 실제 TypeScript 모듈을 그대로 실행한다.
const { releaseFor, provisionalClosed, lastCorrectionDay, correctionInputClosed } = await import("../src/lib/csat-release.ts");

const rows = [{ academic_year: 2027, score_release_on: "2026-12-11" }, { academic_year: 2028, score_release_on: "2027-12-10" }];

test("release date by academic year, latest when the year is unknown", () => {
  assert.equal(releaseFor(rows, 2027), "2026-12-11");
  assert.equal(releaseFor(rows), "2027-12-10");
  assert.equal(releaseFor(rows, 2030), null);
  assert.equal(releaseFor([]), null);
});

test("closed from the release day in Korea, open the day before; no date never closes", () => {
  assert.equal(provisionalClosed("2026-12-11", new Date("2026-12-10T14:59:00Z")), false); // 12-10 23:59 KST
  assert.equal(provisionalClosed("2026-12-11", new Date("2026-12-10T15:00:00Z")), true); // 12-11 00:00 KST
  assert.equal(provisionalClosed(null, new Date("2030-01-01T00:00:00Z")), false);
  assert.equal(lastCorrectionDay("2026-12-01"), "2026.11.30");
});

test("only an approved provisional correction is blocked after release", () => {
  const after = new Date("2026-12-12T00:00:00Z");
  const approved = { stage: "provisional", initial_remaining: 0, correction_granted: 1, correction_used: 0 };
  assert.equal(correctionInputClosed(approved, "2026-12-11", after), true);
  assert.equal(correctionInputClosed({ ...approved, initial_remaining: 1 }, "2026-12-11", after), false);
  assert.equal(correctionInputClosed({ ...approved, stage: "final" }, "2026-12-11", after), false);
  assert.equal(correctionInputClosed(approved, null, after), false);
  assert.equal(correctionInputClosed(approved, "2026-12-11", new Date("2026-12-01T00:00:00Z")), false);
});
