import test from "node:test";
import assert from "node:assert/strict";
const { noRecruit } = await import("../src/lib/p1-adiga-fill.ts");

const empty = () => ({ v: null, s: "pending_metadata", r: null, u: null, l: null });
const cell = (v, u = null) => ({ v, s: "verified_official", r: null, u, l: null });
const row = (extra = {}) => ({ y: 2026, rc: cell("0", "명"), c50: empty(), c70: empty(), alt: { s: "x", r: null, om: 0, e: [] }, ...extra });

test("모집인원 0명이고 성적 값이 없으면 모집 없음(2026-11-20 대표님 결정)", () => {
  assert.equal(noRecruit(row()), true);
  // 성적 칸 사유 코드만 있고 값이 없어도 모집 없음
  assert.equal(noRecruit(row({ c50: { ...empty(), r: "stats_le3_undisclosed:no_recruit" } })), true);
});

test("성적 값이 하나라도 있거나 모집인원이 0이 아니면 그대로 둔다", () => {
  assert.equal(noRecruit(row({ c70: cell("268.5") })), false);
  assert.equal(noRecruit(row({ alt: { s: "x", r: null, om: 0, e: [cell("80.1")] } })), false);
  assert.equal(noRecruit(row({ rc: cell("16", "명") })), false);
  assert.equal(noRecruit(row({ rc: empty() })), false);
  assert.equal(noRecruit(row({ y: 2027 })), false);
});
