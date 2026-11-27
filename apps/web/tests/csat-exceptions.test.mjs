import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// 수능 가채점 예외 17곳(담당자 출시 자료 2026-11-23): 7단계 대신 허용된 이름만, 성균관대 4곳은 최저 충족 여부
registerHooks({ resolve(specifier, context, next) {
  if (specifier.endsWith(".json")) return { ...next(specifier, context), importAttributes: { type: "json" } };
  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:") && !/\.[cm]?[jt]sx?$|\.json$/.test(specifier)) {
    const url = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(fileURLToPath(url))) return next(url.href, context);
  }
  return next(specifier, context);
} });
const { CSAT_EXCEPTIONS, skkuMinimumLabel, skkuMinimumFromAnalysis, csatExceptionView } = await import("../src/lib/csat-exceptions.ts");

const PK = "2027:1000003818";
const EX = "2027-csat-provisional";
const area = (g) => (g === "unknown" ? { attendance: "unknown", grade: null } : g === "not_attended" ? { attendance: "not_attended", grade: null } : { attendance: "attended", grade: g });
const inq = (v, i) => {
  if (v === "not_attended") return { attendance: "not_attended", grade: null };
  const [kind, g] = v.split(":");
  return { ...(g === "unknown" ? { attendance: "unknown", grade: null } : { attendance: "attended", grade: Number(g) }), kind, subjectId: `${kind}-${i}` };
};
// 담당자 SKKU094_2027_CSAT_MINIMUM.private.v1.json illustrative_examples 10건 그대로(예시 기본값: 제2외국어/한문 미응시 확인)
const CASES = [
  [{ k: 2, m: 2, e: 2, q: ["social:3", "social:5"] }, "최저충족"],
  [{ k: 2, m: 2, e: 9, q: ["social:2", "social:3"] }, "최저미충족"],
  [{ k: 2, m: 2, e: 9, q: ["science:2", "social:5"] }, "최저충족"],
  [{ k: 2, m: 2, e: 9, q: ["social:3", "social:6"], o: 1 }, "최저충족"],
  [{ k: 2, m: 2, e: 2, q: ["social:3", "social:5"], h: "unknown" }, null],
  [{ k: 2, m: 2, e: 2, q: ["social:3", "social:5"], h: "not_attended" }, "최저미충족"],
  [{ k: 2, m: 2, e: 2, q: ["social:3", "science:unknown"] }, null],
  [{ k: 2, m: 2, e: 2, q: ["social:3", "not_attended"], o: 1 }, "최저미충족"],
  [{ k: 2, m: 2, e: 9, q: ["social:3", "social:6"], o: "attended_grade_unknown" }, null],
  [{ k: 3, m: 3, e: 9, q: ["social:3", "social:6"], o: "attended_grade_unknown" }, "최저미충족"],
];
test("owner illustrative examples (evaluator copied unchanged)", () => {
  for (const [c, want] of CASES) {
    const input = {
      examId: EX, korean: area(c.k), math: area(c.m), english: area(c.e),
      koreanHistory: c.h ? area(c.h) : { attendance: "attended", grade: 4 },
      inquiry1: inq(c.q[0], 1), inquiry2: inq(c.q[1], 2),
      secondForeignLanguageOrClassicalChinese: c.o === undefined ? { attendance: "not_attended", grade: null } : c.o === "attended_grade_unknown" ? { attendance: "attended", grade: null } : area(c.o),
    };
    assert.equal(skkuMinimumLabel(PK, input), want, JSON.stringify(c));
  }
  assert.equal(skkuMinimumLabel("2027:1000000001", { examId: EX }), null);
});

const subj = (area, subject, lo, hi) => ({ area, subject, choice: null, standard_score: null, grade: null, top_percent_exclusive: null, top_percent_inclusive: null, basis: null, grade_range: { low: lo, high: hi } });
const analysis = (k, m, q1, q2, e = 2, second = null) => ({
  exam: { exam_id: EX, academic_year: 2027, exam_type: "csat" },
  subjects: [subj("korean", "화법과 작문", ...k), subj("math", "미적분", ...m), subj("inquiry1", "생활과 윤리", ...q1), subj("inquiry2", "물리학Ⅰ", ...q2)],
  absolute_grades: { 영어: e, 한국사: 3 }, second_language: second,
});
test("grade ranges: same answer across every case, otherwise wait", () => {
  assert.equal(skkuMinimumFromAnalysis(PK, analysis([1, 2], [1, 2], [2, 2], [2, 2])), "최저충족");
  assert.equal(skkuMinimumFromAnalysis(PK, analysis([4, 5], [4, 5], [4, 5], [4, 5], 4)), "최저미충족");
  assert.equal(skkuMinimumFromAnalysis(PK, analysis([2, 3], [2, 3], [3, 4], [3, 4], 2)), null);
  assert.equal(csatExceptionView(PK, analysis([2, 3], [2, 3], [3, 4], [3, 4], 2)).label, "최저 확인 대기");
  assert.equal(csatExceptionView(PK, analysis([1, 2], [1, 2], [2, 2], [2, 2])).label, "최저충족");
});
test("17 rows and labels only (no source reasons on screen)", () => {
  assert.equal(Object.keys(CSAT_EXCEPTIONS).length, 17);
  assert.equal(Object.values(CSAT_EXCEPTIONS).filter((m) => m === "csat_minimum_only").length, 4);
  assert.equal(csatExceptionView("2027:1000002877", null).label, "환산 방식 확인"); // 담당자 J1 ⑥
  assert.equal(csatExceptionView("2027:1000010768", null).label, "이번 전형 모집 없음");
  assert.equal(csatExceptionView("2027:1000008661", null).label, "이월 선발 조건 확인");
  assert.equal(csatExceptionView("2027:1000003567", null).label, "수능 반영분 점수");
  assert.equal(csatExceptionView("2027:1000007388", null).label, "우수 3영역 점수");
  assert.equal(csatExceptionView("2027:1000000064", null), null);
  const src = readFileSync(new URL("../src/lib/csat-exceptions.ts", import.meta.url), "utf8");
  assert.ok(!src.includes("official_scope_reason\":"), "no source reasons");
  assert.ok(!src.includes("참고"), "no 참고 tag");
});
