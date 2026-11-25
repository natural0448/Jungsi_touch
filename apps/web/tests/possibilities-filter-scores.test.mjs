import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// 2026-11-25 담당자 R22 운영 재현: 4페이지 '판정 근거 부족' 필터에서 보류 행의 환산점수가 '—'로 빠졌다
// (강원대 강릉 사학과 2027:1000000012 일반 검색 298.50점, 필터 —). 필터도 보이는 쪽의 보류 행 점수를 기존 PK 조회로 채운다.
const s = readFileSync(new URL("../src/app/admissions/possibilities/catalog-browse.tsx", import.meta.url), "utf8");

test("status filter hydrates withheld rows on the visible page (not only judged rows)", () => {
  assert.match(s, /!bandsAll\[id\]\?\.school_score && !dispAll\[id\]\?\.central_score && keyOf\(bandsAll, id\) !== "ineligible"/);
  assert.doesNotMatch(s, /keyOf\(bandsAll, id\) !== "none" && keyOf\(bandsAll, id\) !== "ineligible"\)/);
});
test("status filter keeps withheld display and minimum reasons when following later pages", () => {
  assert.match(s, /Object\.assign\(minAll, detail\.min\)/);
  assert.match(s, /if \(detail\.display\) Object\.assign\(dispAll, detail\.display\)/);
  assert.match(s, /report = \{ \.\.\.base, provisional_bands: bandsAll, provisional_min: minAll, overall: withSchoolDisplay\(base\.overall, dispAll\) \};/);
});
test("a row's own display reason decides the filter key", () => {
  assert.match(s, /const rowOverall = overallA && display \? \{ \.\.\.overallA, provisional_school_display: \{ \[id\]: display \} \} : overallA;/);
});
