import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// 계열 자료(R2 회신)의 모양: 한 PK 는 한 계열에만, 8개 이름만, 자유전공은 7계열과 따로
const data = JSON.parse(readFileSync(new URL("../src/lib/field-groups-2027.json", import.meta.url), "utf8"));
const NAMES = ["인문", "사회", "교육", "공학", "자연", "의약", "예체능", "자유전공"];

test("field groups: only the eight known names and 2027", () => {
  assert.equal(data.year, 2027);
  assert.deepEqual(Object.keys(data.groups), NAMES);
  assert.match(data.source_sha256, /^[a-f0-9]{64}$/);
});

test("field groups: every PK is a positive integer and belongs to exactly one group", () => {
  const seen = new Set();
  for (const name of NAMES) {
    for (const pk of data.groups[name]) {
      assert.ok(Number.isSafeInteger(pk) && pk > 0, `${name} ${pk}`);
      assert.ok(!seen.has(pk), `duplicate ${pk}`);
      seen.add(pk);
    }
  }
  assert.ok(seen.size > 0 && seen.size <= data.total_rows);
  // 2027 요강·요강 초안 근거는 7계열에 든 PK 여야 하고 서로 겹치지 않는다(자유전공 아님)
  const free = new Set(data.groups["자유전공"]);
  for (const pk of [...data.guide_2027, ...data.draft_2027]) assert.ok(seen.has(pk) && !free.has(pk), String(pk));
  assert.equal(new Set([...data.guide_2027, ...data.draft_2027]).size, data.guide_2027.length + data.draft_2027.length);
});
