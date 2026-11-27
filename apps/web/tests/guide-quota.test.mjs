import { test } from "node:test";
import assert from "node:assert/strict";
import { quota27Count } from "../src/lib/p1-shape.ts";

const q = (over = {}) => ({ v: "10", ls: "numeric_literal", st: null, ct: null, cs: null, rs: "ok", ...over });

test("단계 없는 2027 모집요강 인원은 1페이지처럼 숫자로", () => {
  assert.equal(quota27Count(q()), 10);
  assert.equal(quota27Count(q({ st: "initial" })), 10);
});
test("0명·숫자 아님·이월 조건부·원문 충돌·없음은 쓰지 않는다", () => {
  assert.equal(quota27Count(q({ v: "0" })), null);
  assert.equal(quota27Count(q({ v: "약간명", ls: "text_literal" })), null);
  assert.equal(quota27Count(q({ ls: "conditional_carryover" })), null);
  assert.equal(quota27Count(q({ rs: "source_conflict" })), null);
  assert.equal(quota27Count(undefined), null);
});
