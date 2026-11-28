import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

// 2026-11-28 대표님 결정(A안): 4페이지에서 판정 나온 학과를 먼저, '가채점 판정 준비 중'은 학교 아래 접기
test("4페이지: 판정 준비 중인 학과는 접고, 판정 있는 학교가 먼저", () => {
  const c = src("app/admissions/possibilities/catalog-browse.tsx");
  assert.match(c, /<details className="pending-rows"/);
  assert.match(c, /가채점 판정 준비 중인 학과/);
  assert.match(c, /const split = provisionalShown && report && !cur\.st;/);
  assert.match(c, /groups\.sort\(\(x, y\) => Number\(hasReady\(y\)\) - Number\(hasReady\(x\)\)\)/);
});
test("'판정 근거 부족' 문구는 '가채점 판정 준비 중'으로", () => {
  assert.match(src("lib/position-note.ts"), /POSITION_NONE_LABEL = "가채점 판정 준비 중"/);
  assert.match(src("lib/status-filter.ts"), /none: "가채점 판정 준비 중"/);
  assert.ok(!src("app/admissions/favorable/wildcard.tsx").includes(">판정 근거 부족<"));
});

// 2026-11-28 대표님 요청: 유리한 대학 찾기 설명을 더 잘 보이게(요약 + 두 단계)
test("유리한 대학 찾기 설명: 요약 한 줄과 ★ 두 단계", () => {
  const p = src("app/admissions/favorable/page.tsx");
  assert.match(p, /className="fav-lead"/);
  assert.match(p, /<b>내 성적으로 지원에 유리한 대학<\/b>/);
  assert.match(p, /<em>1<\/em>/);
  assert.match(p, /<em>2<\/em>/);
  const at = p.indexOf('className="fav-lead"');
  const lead = p.slice(at, p.indexOf("</span>", p.indexOf("fav-lead-steps", at)) + 400);
  assert.ok(lead.length > 0 && !lead.includes("참고"));
});

// 2026-11-28 대표님 요청: 4페이지 담기 설명 크게, 준비 중 학과는 계속 업데이트 중 표시
test("4페이지 설명 세 단계·준비 중 학과 업데이트 표시", () => {
  const p = src("app/admissions/possibilities/page.tsx");
  assert.match(p, /className="fav-lead"/);
  assert.match(p, /<b>담기<\/b> 누르기/);
  assert.match(p, /<em>3<\/em><b>리포트<\/b>/);
  const c = src("app/admissions/possibilities/catalog-browse.tsx");
  assert.match(c, /판정 근거 계속 업데이트 중/);
  assert.match(c, /판정 근거를 계속 추가하고 있습니다/);
  assert.match(src("lib/position-note.ts"), /판정 근거는 계속 업데이트하고 있어/);
  assert.match(src("styles/jungsi.css"), /\.et \.fav-lead\{/);
});

// 2026-11-28: 학생 목록은 실채점이 열리기 전 실채점 상태를 묻지 않는다(학생마다 503 거절이 났다)
test("전문가용 학생 목록: 실채점 전에는 final 상태 요청 없음", () => {
  const p = src("app/pro/page.tsx");
  assert.match(p, /const finalReady = finalOpen\(\);/);
  assert.match(p, /final: finalReady \? await used\(x\.student_id, "final"\) : null/);
});
