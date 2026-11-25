import { test } from "node:test";
import assert from "node:assert/strict";
import { csatComboNote } from "../src/lib/csat-combo.ts";

test("하향인데 불리 → '불리하지만, 그래도 합격권보다 앞'", () => {
  assert.equal(csatComboNote("downward", undefined, "down"), "이 대학 계산 방식은 내게 불리하지만, 그래도 예상 합격권보다 앞에 있습니다.");
});
test("불가인데 유리 → '유리하지만, 그래도 합격선에 못 미침'", () => {
  assert.equal(csatComboNote("outside", undefined, "up"), "이 대학 계산 방식은 내게 유리하지만, 그래도 예상 합격선에 못 미칩니다.");
});
test("범위 판정·같은 방향·값 없음", () => {
  assert.match(csatComboNote("downward", "outside", "down"), /하향~불가/);
  assert.equal(csatComboNote("target", undefined, "up"), "이 대학 계산 방식이 내게 유리하고, 예상 합격권 안 앞쪽에 있습니다.");
  assert.equal(csatComboNote("target", undefined, null), null);
  assert.equal(csatComboNote("x", undefined, "up"), null);
});
