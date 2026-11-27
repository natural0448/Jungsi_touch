import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// 2026-11-26 담당자 회신: 성균관대 4곳은 등급 범위가 최저 기준을 가로지를 때만 대표 등급으로 '최저충족/미충족 예상'
registerHooks({ resolve(specifier, context, next) {
  if (specifier.endsWith(".json")) return { ...next(specifier, context), importAttributes: { type: "json" } };
  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:") && !/\.[cm]?[jt]sx?$|\.json$/.test(specifier)) {
    const url = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(fileURLToPath(url))) return next(url.href, context);
  }
  return next(specifier, context);
} });
const { csatExceptionView, projectSkkuExpectedMinimum, skkuExpectedFromAnalysis, formatExpectedMinimum } = await import("../src/lib/csat-exceptions.ts");

const PK = "2027:1000003818";
const sub = (area, subject, low, high, rep) => ({ area, subject, grade_range: { low, high }, ...(rep === undefined ? {} : { representative_grade: rep }) });
const analysis = (subjects, e = 2, h = 1) => ({ exam: { exam_id: "2027-csat-provisional" }, subjects, absolute_grades: { 영어: e, 한국사: h }, second_language: null });

test("범위가 기준을 가로지르면 대표 등급으로 예상", () => {
  const a = analysis([sub("korean", "화법과 작문", 2, 3, 2), sub("math", "미적분", 2, 2, 2), sub("inquiry1", "생활과 윤리", 2, 3, 3), sub("inquiry2", "사회·문화", 3, 3, 3)]);
  const x = skkuExpectedFromAnalysis(PK, a);
  assert.deepEqual(x, { label: "최저충족 예상", representative_grade_sum: 6, best_grade_sum: 6, worst_grade_sum: 7, maximum_grade_sum: 6, optional_substitution_can_change_label: false });
  const v = csatExceptionView(PK, a);
  assert.equal(v.kind, "expected");
  assert.equal(v.label, "최저충족 예상");
  assert.match(v.desc, /가채점 대표값 기준\) · 대표 등급합 6 · 가능 등급합 6~7 · 기준 6 이내 · 등급에 따라 미충족 가능/);
});

test("대표 등급이 기준 밖이면 미충족 예상과 제2외국어 대체 안내", () => {
  const a = analysis([sub("korean", "화법과 작문", 2, 3, 3), sub("math", "미적분", 2, 3, 3), sub("inquiry1", "생활과 윤리", 3, 3, 3), sub("inquiry2", "사회·문화", 3, 3, 3)], 2);
  const x = skkuExpectedFromAnalysis(PK, a);
  assert.equal(x.label, "최저미충족 예상");
  assert.equal(x.representative_grade_sum, 8);
  assert.equal(x.best_grade_sum, 6);
  assert.equal(x.worst_grade_sum, 8);
  assert.equal(csatExceptionView(PK, a).label, "최저미충족 예상");
  // 제2외국어 미응시로 확인되면 대체 안내 없음(second_language null → 미응시)
  assert.equal(x.optional_substitution_can_change_label, false);
});

test("대표 등급이 하나라도 없으면 지금처럼 최저 확인 대기", () => {
  const a = analysis([sub("korean", "화법과 작문", 2, 3), sub("math", "미적분", 2, 2, 2), sub("inquiry1", "생활과 윤리", 2, 3, 3), sub("inquiry2", "사회·문화", 3, 3, 3)]);
  assert.equal(skkuExpectedFromAnalysis(PK, a), null);
  assert.equal(csatExceptionView(PK, a).label, "최저 확인 대기");
});

test("범위 안 모두 같은 답이면 확정 판정이 그대로", () => {
  const a = analysis([sub("korean", "화법과 작문", 1, 2, 1), sub("math", "미적분", 1, 1, 1), sub("inquiry1", "생활과 윤리", 1, 2, 1), sub("inquiry2", "사회·문화", 1, 1, 1)], 1);
  const v = csatExceptionView(PK, a);
  assert.equal(v.kind, "minimum");
  assert.equal(v.label, "최저충족");
});

test("다른 모집단위·범위가 안 가로지르면 예상 없음", () => {
  const input = { examId: "2027-csat-provisional", korean: { attendance: "attended", grade: 2 }, math: { attendance: "attended", grade: 2 }, english: { attendance: "attended", grade: 2 }, koreanHistory: { attendance: "attended", grade: 1 }, inquiry1: { attendance: "attended", grade: 3, subjectId: "a", kind: "social" }, inquiry2: { attendance: "attended", grade: 3, subjectId: "b", kind: "social" }, secondForeignLanguageOrClassicalChinese: { attendance: "not_attended", grade: null } };
  assert.equal(projectSkkuExpectedMinimum("2027:1000000001", 12, 14, input), null);
  assert.equal(projectSkkuExpectedMinimum(PK, 10, 12, input), null);
  assert.equal(formatExpectedMinimum(projectSkkuExpectedMinimum(PK, 12, 14, input)).startsWith("최저충족 예상 (가채점 대표값 기준)"), true);
});
