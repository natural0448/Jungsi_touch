import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// 담당자 11-23 회신 D1(판정 없음 사유)·C1(예외 7곳 점수)
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:") && !/\.[cm]?[jt]sx?$|\.json$/.test(specifier)) {
    const url = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(fileURLToPath(url))) return next(url.href, context);
  }
  return next(specifier, context);
} });
const { csatNoJudgmentView, csatC1Score } = await import("../src/lib/csat-conditions.ts");

const subj = (area, subject, choice, p) => ({ area, subject, choice, standard_score: null, grade: null, top_percent_exclusive: null, top_percent_inclusive: null, basis: null, percentile_range: { low: p[0], high: p[1] } });
const a = (q1, q2, second = null) => ({
  exam: { exam_id: "2027-csat-provisional", academic_year: 2027, exam_type: "csat" },
  subjects: [subj("korean", "국어", "화법과 작문", [80, 90]), subj("math", "수학", "미적분", [85, 85]), subj("inquiry1", q1, null, [86, 86]), subj("inquiry2", q2, null, [94, 94])],
  absolute_grades: { 영어: 2, 한국사: 1 }, second_language: second,
});

test("D1: 과탐 2과목 확정 모집단위에 사회탐구 응시면 지원 조건 미충족", () => {
  // 담당자 D1_J1_⑤ 예: 가천대 의예과 등. 목록 51곳 안의 한 곳을 고른다
  const src = readFileSync(new URL("../src/lib/csat-conditions.ts", import.meta.url), "utf8");
  const first = Number(src.match(/const SCIENCE_PAIR = new Set\(\[(\d+)/)[1]);
  const pk = `2027:${1000000000 + first}`;
  assert.equal(csatNoJudgmentView(pk, a("생활과 윤리", "사회·문화")).label, "지원 조건 미충족");
  assert.equal(csatNoJudgmentView(pk, a("물리학Ⅰ", "화학Ⅰ")).label, "비교 기준 확인 필요");
  assert.equal(csatNoJudgmentView("2027:1000002062", a("생활과 윤리", "사회·문화")).label, "비교 기준 확인 필요");
  assert.equal(csatNoJudgmentView(pk, null), null);
});

test("C1: 예외 7곳 점수(조선대 상위 3영역 평균 × 7 / 3)", () => {
  // 국 80~90, 수 85, 영 2등급(95), 탐 max 94 → 상위 3 = 94·95·85~90 → 7×(274~279)/3
  const r = csatC1Score("2027:1000010868", a("생활과 윤리", "사회·문화"));
  assert.equal(r.label, "수능 반영분 점수");
  assert.equal(r.low, (7 * 274 / 3).toFixed(2));
  assert.equal(r.high, (7 * 279 / 3).toFixed(2));
  assert.equal(csatC1Score("2027:1000007388", a("생활과 윤리", "사회·문화")).label, "우수 3영역 점수");
  assert.equal(csatC1Score("2027:1000002062", a("생활과 윤리", "사회·문화")), null);
  const src = readFileSync(new URL("../src/lib/csat-conditions.ts", import.meta.url), "utf8");
  assert.ok(!/참고|추정/.test(src.split("*/")[1] ?? ""), "no 참고·추정 tags in screen strings");
});
test("D1 confirms unmet conditions and server minimum reasons (2026-11-24)", () => {
  const mk = (math, i1, i2) => ({ subjects: [{ area: "math", choice: math, subject: "수학" }, { area: "inquiry1", subject: i1 }, { area: "inquiry2", subject: i2 }], second_language: null });
  const social = mk("미적분", "생활과 윤리", "사회·문화"), prob = mk("확률과 통계", "물리학Ⅰ", "화학Ⅰ"), sci = mk("미적분", "물리학Ⅰ", "화학Ⅰ");
  assert.equal(csatNoJudgmentView("2027:1000002003", sci).label, "지원 조건 미충족"); // 대구한의대 한의예(인문): 사탐·확통
  assert.equal(csatNoJudgmentView("2027:1000007090", sci).label, "지원 조건 미충족"); // 동의대 한의예(확률과통계)
  assert.equal(csatNoJudgmentView("2027:1000000709", social, "unmet").label, "수능 최저 미충족");
  assert.equal(csatNoJudgmentView("2027:1000008020", social, "partial").label, "수능 최저 충족 여부 갈림");
  assert.notEqual(csatNoJudgmentView("2027:1000000297", prob).label, "비교 기준 확인 필요"); // 미적분·기하 지정
});
