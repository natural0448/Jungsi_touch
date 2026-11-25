import { test } from "node:test";
import assert from "node:assert/strict";
import { verifiedInitial } from "../src/lib/p1-stage-verified.ts";

const rec = (n) => ({ status: "ready", recruitment: { initial_count: n } });
test("1페이지 최초 모집: 등록 행만, 서버 최초 인원과 정리본 숫자가 같을 때만", async () => {
  const calls = [];
  const src = { readRecruitment: async (_c, id) => { calls.push(id); return id === "2027:1000005794" ? rec(10) : null; } };
  const rows = [
    { y: 2027, pk: "1000005794", q27: { v: "10" } },
    { y: 2027, pk: "1000000001", q27: { v: "3" } },
    { y: 2026, pk: "2026:1", q27: { v: "10" } },
  ];
  assert.deepEqual([...(await verifiedInitial(src, {}, rows))], ["1000005794"]);
  assert.deepEqual(calls, ["2027:1000005794"]);
});
test("숫자가 다르거나 읽기 실패·대기면 '모집' 그대로", async () => {
  const row = [{ y: 2027, pk: "1000005794", q27: { v: "10" } }];
  assert.equal((await verifiedInitial({ readRecruitment: async () => rec(12) }, {}, row)).size, 0);
  assert.equal((await verifiedInitial({ readRecruitment: async () => { throw new Error("x"); } }, {}, row)).size, 0);
  assert.equal((await verifiedInitial({ readRecruitment: async () => ({ status: "pending", recruitment: null }) }, {}, row)).size, 0);
});
