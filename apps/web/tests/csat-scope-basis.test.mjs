import { test } from "node:test";
import assert from "node:assert/strict";
import { csatScopeBasis, CSAT_SCOPE_TAG } from "../src/lib/csat-scope-basis.ts";

test("수능 기준 판정 근거 종류(담당자 R23-4: 69·217·431)", () => {
  assert.equal(csatScopeBasis("2027:1000002458"), "source");
  assert.equal(csatScopeBasis("2027:1000001750"), "peer");
  assert.equal(csatScopeBasis("2027:1000000001"), "same");
  assert.equal(csatScopeBasis(undefined), "same");
  assert.ok(!Object.values(CSAT_SCOPE_TAG).some((t) => t.includes("참고")));
});
