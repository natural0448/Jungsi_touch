import { test } from "node:test";
import assert from "node:assert/strict";

// 2026-11-28 담당자 통합 회신 R29 §2: 약칭으로 1·4페이지에서 0건이던 학교
const { expandUniversityTerm, expandUniversityQuery } = await import("../src/lib/university-alias.ts");

test("담당자가 짚은 약칭 세 개는 정식 이름의 일부로 바뀐다", () => {
  assert.equal(expandUniversityTerm("금오공대"), "금오공과");
  assert.equal(expandUniversityTerm("서울과기대"), "서울과학기술");
  assert.equal(expandUniversityTerm("한기대"), "한국기술교육");
  assert.equal(expandUniversityTerm("한 기 대"), "한국기술교육");
});

test("끝말 규칙: 여대·외대·교대·공대", () => {
  assert.equal(expandUniversityTerm("서울여대"), "서울여자");
  assert.equal(expandUniversityTerm("부산외대"), "부산외국어");
  assert.equal(expandUniversityTerm("서울교대"), "서울교육");
  assert.equal(expandUniversityTerm("한국외대"), "한국외국어");
});

test("정식 이름·이미 맞는 일부는 그대로", () => {
  for (const q of ["강원대", "홍익대학교", "금오", "서울과학기술", "한국기술교육대학교", "공대"]) assert.equal(expandUniversityTerm(q), q);
});

test("쉼표로 여러 학교: 각각 바꾼다", () => {
  assert.equal(expandUniversityQuery("금오공대, 강원대"), "금오공과, 강원대");
  assert.equal(expandUniversityQuery(undefined), undefined);
});
