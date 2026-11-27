import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// 2026-11-25 공개 전 편의성 QA(대표님 선택 1·2·3·5)
const src = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("1: current report shows '리포트 갱신' instead of a misleading '저장' time", () => {
  for (const p of ["../src/app/reports/me/page.tsx", "../src/app/reports/me/final/page.tsx"]) {
    const s = src(p);
    assert.match(s, /seoulDateTime\(report\.updated_at\)\} 리포트 갱신/);
    assert.doesNotMatch(s, /seoulDateTime\(report\.updated_at\)\} 저장<\/span>/);
  }
});
test("2: the tray on the page without 담기 tells where to 담기", () => {
  const s = src("../src/components/shortlist-tray.tsx");
  assert.match(s, /other === "PAGE-03" \? `담은 곳이 없습니다\. \$\{to\.label\}에서 담기를 누르세요\.`/);
});
test("3: field basis notes are hidden (kept only as a hover title)", () => {
  assert.doesNotMatch(src("../src/components/field-tag.tsx"), /<small> · \{f\.note\}<\/small>/);
  for (const p of ["../src/app/admissions/favorable/csat-groups.tsx", "../src/app/admissions/favorable/reference-groups.tsx", "../src/app/admissions/favorable/school-card.tsx"]) {
    assert.doesNotMatch(src(p), /<small>2025 분류 기준<\/small>/);
  }
});
test("5: 3페이지 candidate groups drop the duplicated heading visually", () => {
  assert.match(src("../src/app/admissions/favorable/csat-candidates.tsx"), /hid=\{`csat-cand-\$\{g\}`\} compact \/>/);
  assert.match(src("../src/app/admissions/favorable/csat-groups.tsx"), /className=\{compact \? "sr-only" : undefined\}/);
  assert.match(src("../src/styles/base.css"), /\.sr-only \{/);
});
