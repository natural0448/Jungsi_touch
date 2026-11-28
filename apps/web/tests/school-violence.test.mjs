import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// 2026-11-28 대표님 결정: 학교폭력 감점 모집단위에는 본인 조치 확인 안내, 환산점수는 감점 미반영
const sv = await import("../src/lib/school-violence.ts");
test("대구가톨릭대 11행에 학교폭력 감점 안내", () => {
  assert.equal(sv.SCHOOL_VIOLENCE_DEDUCTION.size, 11);
  assert.ok(sv.hasSchoolViolenceDeduction("2027:1000002844"));
  assert.ok(!sv.hasSchoolViolenceDeduction("2027:1000002090"));
  assert.match(sv.SCHOOL_VIOLENCE_NOTICE, /본인의 학교폭력 조치 여부를 확인하세요/);
  assert.match(sv.SCHOOL_VIOLENCE_NOTICE, /감점을 반영하지 않은 결과/);
  const md = readFileSync(new URL("../src/app/admissions/possibilities/mine-detail.tsx", import.meta.url), "utf8");
  assert.match(md, /<SchoolViolenceNote id=\{props\.o\.offering_id\} \/>/);
});
