import test from "node:test";
import assert from "node:assert/strict";
import { ratioText, untilDate } from "../src/lib/format.ts";

test("competition ratios round half-up to two decimals only when the source has more", () => {
  assert.equal(ratioText("5.0999999999999996"), "5.1");
  assert.equal(ratioText("4.567"), "4.57");
  assert.equal(ratioText("4.565"), "4.57");
  assert.equal(ratioText("4.564"), "4.56");
  assert.equal(ratioText("9.995"), "10");
  assert.equal(ratioText("0.004"), "0");
  assert.equal(ratioText("0.005"), "0.01");
  // Source text with up to two decimals and non-numeric text stay verbatim.
  for (const v of ["3.3", "4.50", "12", "0", "미발표", "3.3:1"]) assert.equal(ratioText(v), v);
});

test("pass end dates show the last usable day whether the end is exclusive or 23:59:59", () => {
  assert.equal(untilDate("2027-01-07T15:00:00Z"), "2027.01.07");
  assert.equal(untilDate("2027-01-07T14:59:59Z"), "2027.01.07");
  assert.equal(untilDate("2027-01-07T15:00:00.001Z"), "2027.01.08");
  assert.equal(untilDate(null), "─");
  assert.equal(untilDate("not-a-date"), "─");
});
