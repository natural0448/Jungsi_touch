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
  assert.equal(csatNoJudgmentView("2027:1000002003", sci).label, "반영 과목 불일치"); // 대구한의대 한의예(인문): 반영 과목 기반(담당자 R1: 지원 자격 단정 안 함)
  assert.equal(csatNoJudgmentView("2027:1000007090", sci).label, "반영 과목 불일치"); // 동의대 한의예(확률과통계)
  assert.equal(csatNoJudgmentView("2027:1000000631", social).label, "지원 조건 미충족"); // 부산대: 과학탐구 1과목 이상 필수(확인됨)
  assert.notEqual(csatNoJudgmentView("2027:1000000631", mk("확률과 통계", "생활과 윤리", "물리학Ⅰ")).label, "지원 조건 미충족"); // 부산대: 과탐 1과목·확통 허용
  assert.equal(csatNoJudgmentView("2027:1000003844", sci).label, "지원 조건 미충족"); // 성신여대 간호(인문): 사회탐구 1과목 이상 필수
  assert.notEqual(csatNoJudgmentView("2027:1000003844", mk("미적분", "사회·문화", "물리학Ⅰ")).label, "지원 조건 미충족");
  assert.equal(csatNoJudgmentView("2027:1000000709", social, "unmet").label, "수능 최저 미충족");
  assert.equal(csatNoJudgmentView("2027:1000008020", social, "partial").label, "수능 최저 충족 여부 갈림");
  assert.equal(csatNoJudgmentView("2027:1000000297", prob).label, "반영 과목 불일치"); // 미적분·기하 반영(지원 자격 단정 안 함)
});
test("SNU type I (담당자 R4): second language required, score = 국1.0+수1.2+탐0.8 − 감점", () => {
  const sub = (area, subject, r) => ({ area, subject, standard_score: null, standard_score_range: { low: r[0], central: r[1], high: r[2] } });
  const base = { subjects: [sub("korean", "국어", [120, 125, 130]), { ...sub("math", "수학", [120, 125, 130]), choice: "확률과 통계" }, sub("inquiry1", "생활과 윤리", [60, 62, 64]), sub("inquiry2", "사회·문화", [60, 62, 64])], absolute_grades: { 영어: 2, 한국사: 4 } };
  assert.equal(csatNoJudgmentView("2027:1000000747", { ...base, second_language: null }).label, "제2외국어/한문 확인 필요"); // R27: 확인 안내
  const with2 = { ...base, second_language: { subject: "일본어Ⅰ", grade: 3 } };
  const c = csatC1Score("2027:1000000747", with2);
  // 가운데: 10*125+12*125+8*124 − (영어2 5 + 한국사4 4 + 제2외3 5) = 3742−14 = 3728 → 372.80
  assert.equal(c.central, "372.80");
  assert.equal(csatNoJudgmentView("2027:1000000747", with2).label, "유형Ⅰ 점수만 계산");
  // 서버가 '조건'으로 알려도(유형Ⅱ-2 경로가 받지 않음) 유형Ⅰ 안내가 먼저다(11-27 dep_r52 뒤 가려지던 것)
  assert.equal(csatNoJudgmentView("2027:1000000747", with2, "condition").label, "유형Ⅰ 점수만 계산");
  assert.equal(csatNoJudgmentView("2027:1000000747", { ...base, second_language: null }, "condition").label, "제2외국어/한문 확인 필요");
});

test("R27 정확한 128개 조합만 지원 조건 미충족(서버가 조건으로 알린 경우)", () => {
  const s2 = (k, m, q1, q2) => ({ subjects: [{ area: "korean", subject: "국어", choice: k }, { area: "math", subject: "수학", choice: m }, { area: "inquiry1", subject: q1 }, { area: "inquiry2", subject: q2 }], absolute_grades: {} });
  // 서울대 749(084-2027-R02): 화작/확통/생윤·사문은 목록에 있다 → 과탐 조건
  const hit = csatNoJudgmentView("2027:1000000749", s2("화법과 작문", "확률과 통계", "사회·문화", "생활과 윤리"), "condition");
  assert.equal(hit.label, "지원 조건 미충족");
  assert.match(hit.desc, /과학탐구 2과목/);
  // 같은 모집단위의 목록 밖 조합(세계지리·경제)은 넓히지 않는다
  assert.equal(csatNoJudgmentView("2027:1000000749", s2("화법과 작문", "확률과 통계", "세계지리", "경제"), "condition").label, "반영 과목 불일치");
  // 물리·화학 조건(758): 생명Ⅰ·지구Ⅰ
  assert.match(csatNoJudgmentView("2027:1000000758", s2("화법과 작문", "미적분", "생명과학Ⅰ", "지구과학Ⅰ"), "condition").desc, /물리학/);
  // 성신여대 간호(인문) 3844: 과탐만 2과목
  assert.match(csatNoJudgmentView("2027:1000003844", s2("언어와 매체", "미적분", "물리학Ⅰ", "화학Ⅰ"), "condition").desc, /사회탐구 1과목/);
  // 목록 밖 모집단위는 그대로 반영 과목 불일치
  assert.equal(csatNoJudgmentView("2027:1000000297", s2("화법과 작문", "확률과 통계", "사회·문화", "생활과 윤리"), "condition").label, "반영 과목 불일치");
});

test("담당자 v3 판정 보류(서버 csat_withheld → overall.provisional_school_display): 사유 이름과 가운데 환산점수", () => {
  const a = { subjects: [], absolute_grades: {}, provisional_school_display: {
    "2027:1000002512": { reason: "non_csat_components_missing", score_kind: "csat_component", central_score: "180.00" },
    "2027:1000000012": { reason: "comparison_axis_unverified", score_kind: "university_score", central_score: "612.34" },
  } };
  assert.equal(csatNoJudgmentView("2027:1000002512", a)?.label, "환산점수만 제공");
  assert.match(csatNoJudgmentView("2027:1000002512", a)?.desc ?? "", /이 환산점수를 바탕으로 직접 검토/);
  assert.equal(csatNoJudgmentView("2027:1000000012", a)?.label, "비교 기준 확인 필요");
  assert.deepEqual(csatC1Score("2027:1000002512", a), { label: "수능 반영분 점수", central: "180.00", low: "180.00", high: "180.00" });
  assert.equal(csatC1Score("2027:1000000012", a)?.label, "대학 환산점수");
});

// 2026-11-25 실채점 전환 준비: 실채점 판정 자료 전(final_cutoffs_pending)은 '환산점수만 제공', 화면이 판정을 못 받은 행(unloaded)은 '판정 다시 불러오기'
test("final_cutoffs_pending shows converted score only; unloaded asks to reload", () => {
  const base = a("물리학Ⅰ", "화학Ⅰ");
  const pk = "2027:1000099999";
  const fin = { ...base, provisional_school_display: { [pk]: { reason: "final_cutoffs_pending", score_kind: "university_score", central_score: "500.00" } } };
  const v = csatNoJudgmentView(pk, fin);
  assert.equal(v.label, "환산점수만 제공");
  assert.match(v.desc, /확정 성적/);
  assert.equal(csatNoJudgmentView(pk, base, "unloaded").label, "판정 다시 불러오기");
});

// 2026-11-26 담당자 R23-2: 비교축 70행 중 13행은 환산점수 뒤 '비교 자료 없음', 위치가 있는 행은 위치를 먼저 보인다는 설명
test("R23-2: 13행은 비교 자료 없음, 위치가 있는 비교 기준 확인 행은 위치 먼저 안내", () => {
  const a = { subjects: [], absolute_grades: {}, provisional_school_display: {
    "2027:1000000922": { reason: "comparison_axis_unverified", score_kind: "university_score", central_score: "900.00" },
    "2027:1000000920": { reason: "comparison_axis_unverified", score_kind: "university_score", central_score: "915.83", central_rank: { basis: "university_score", top_percent: "4.50" } },
  } };
  assert.equal(csatNoJudgmentView("2027:1000000922", a)?.label, "비교 자료 없음");
  assert.equal(csatC1Score("2027:1000000922", a)?.central, "900.00");
  const v = csatNoJudgmentView("2027:1000000920", a);
  assert.equal(v?.label, "비교 기준 확인 필요");
  assert.match(v?.desc ?? "", /대학 안 위치를 먼저/);
});
