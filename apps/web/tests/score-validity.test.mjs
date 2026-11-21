import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// 받을 수 없는 점수·모든 과목 필수·두 번 경고·부정확 입력·가채점 정정 자동 승인·재입력 경고(2026-11-22 대표님 결정)
const V = await import("../src/lib/score-validity.ts");
const { selfCorrectionOpen } = await import("../src/lib/csat-release.ts");
const { hasMockReports, studentHasMockReports } = await import("../src/lib/past-mock.ts");
const src = (f) => readFile(new URL(f, import.meta.url), "utf8");

const range = (max) => Array.from({ length: max + 1 }, (_, i) => i);
const impossible = (area, max) => range(max).filter((x) => !V.isAchievableRaw(area, x));

test("시험 구조로 계산한 불가 점수가 대표님 기준표와 같다(국어·수학·영어 1·99, 한국사·탐구 1·49, 제2외국어/한문 없음)", () => {
  assert.deepEqual(impossible("korean", 100), [1, 99]);
  assert.deepEqual(impossible("math", 100), [1, 99]);
  assert.deepEqual(impossible("english", 100), [1, 99]);
  assert.deepEqual(impossible("korean_history", 50), [1, 49]);
  assert.deepEqual(impossible("inquiry", 50), [1, 49]);
  assert.deepEqual(impossible("second_language", 50), []);
  // 구조 자체로 계산해도 같다(기준표 덮어쓰기 없이)
  for (const [area, max, want] of [["korean", 100, [1, 99]], ["math", 100, [1, 99]], ["english", 100, [1, 99]], ["korean_history", 50, [1, 49]], ["inquiry", 50, [1, 49]], ["second_language", 50, []]]) {
    const set = V.achievableScores(V.RAW_STRUCTURES[area]);
    assert.deepEqual(range(max).filter((x) => !set.has(x)), want, area);
    assert.equal(V.RAW_STRUCTURES[area].reduce((s, [p, c]) => s + p * c, 0), max, `${area} 만점`);
  }
});

test("경계: 국어 0·2·98·100 가능, 1·99 불가 / 영어 0·100 가능 / 탐구 50·48 가능, 49 불가 / 제2외국어 1·49 가능", () => {
  for (const x of [0, 2, 3, 97, 98, 100]) assert.equal(V.isAchievableRaw("korean", x), true, `국어 ${x}`);
  for (const x of [1, 99]) assert.equal(V.isAchievableRaw("korean", x), false, `국어 ${x}`);
  assert.equal(V.isAchievableRaw("english", 0), true);
  assert.equal(V.isAchievableRaw("english", 100), true);
  assert.equal(V.isAchievableRaw("math", 96), true);
  assert.equal(V.isAchievableRaw("inquiry", 48), true);
  assert.equal(V.isAchievableRaw("inquiry", 50), true);
  assert.equal(V.isAchievableRaw("inquiry", 49), false);
  assert.equal(V.isAchievableRaw("korean_history", 1), false);
  assert.equal(V.isAchievableRaw("second_language", 1), true);
  assert.equal(V.isAchievableRaw("second_language", 49), true);
  assert.equal(V.isAchievableRaw("korean", 50.5), false);
});

const BASE = { korean_choice: "화법과 작문", korean: 88, math_choice: "미적분", math: 84, inq1: "물리학Ⅰ", inq1_raw: 44, inq2: "화학Ⅰ", inq2_raw: 42, english: 90, history: 45, sl_subject: "none" };

test("양식 값에서 어떤 과목·어떤 점수가 받을 수 없는지 알려 준다", () => {
  assert.deepEqual(V.unattainableRaw(BASE), []);
  const bad = V.unattainableRaw({ ...BASE, korean: 99, english: 1, inq2_raw: 49, sl_subject: "한문Ⅰ", sl_raw: 49 });
  assert.deepEqual(bad, [{ label: "국어(화법과 작문)", score: 99 }, { label: "영어", score: 1 }, { label: "탐구 2(화학Ⅰ)", score: 49 }]);
  assert.equal(V.badScoreText(bad), "국어(화법과 작문) 99점, 영어 1점, 탐구 2(화학Ⅰ) 49점");
});

test("9월·실채점 표준점수: 팩 표가 있을 때만 표에 없는 점수를 찾는다", () => {
  const table = { korean: new Set([130, 131]), math: new Set([128]), "생활과 윤리": new Set([65]), "사회·문화": new Set([63]) };
  const v = { korean: 132, math: 128, inq1: "생활과 윤리", inq1_score: 65, inq2: "사회·문화", inq2_score: 60 };
  assert.deepEqual(V.unobservedStandard(v, table).map((b) => b.score), [132, 60]);
  assert.deepEqual(V.unobservedStandard(v, null), []);
});

test("모든 과목 필수: 선택과목·영어·한국사 등급까지 빈 칸이 있으면 막는다", () => {
  const full = { korean_choice: "언어와 매체", math_choice: "기하", inq1: "a", inq2: "b", korean: 130, math: 128, inq1_score: 65, inq2_score: 63, english: 2, history: 3 };
  assert.deepEqual(V.missingStandard((k) => full[k]), []);
  assert.deepEqual(V.missingStandard((k) => ({ ...full, korean_choice: undefined, english: undefined, history: NaN })[k]), ["korean_choice", "english", "history"]);
  assert.ok(V.STANDARD_REQUIRED.includes("math_choice"));
});

test("두 번 경고: 받을 수 없는 점수가 있으면 대조 → 첫 안내 → 두 번째 경고 → 저장, 없으면 바로 저장", () => {
  assert.equal(V.nextStep("review", false), "send");
  assert.equal(V.nextStep("review", true), "warn1");
  assert.equal(V.nextStep("warn1", true), "warn2");
  assert.equal(V.nextStep("warn2", true), "send");
  assert.equal(V.UNATTAINABLE_FIRST, "입력하신 점수는 조합상 받을 수 없는 점수입니다. 그럼에도 불구하고 이 점수로 저장하시겠습니까?");
  assert.equal(
    V.unattainableSecond("홍길동"),
    "해당 과목에서 받을 수 없는 점수를 입력할 시 성적분석이 되지 않으나 성적 입력횟수는 1회가 차감됩니다. 이에 대한 불이익은 온전히 홍길동님에게 있음을 다시 한번 경고드립니다.",
  );
  assert.equal(V.inaccurateText("홍길동"), "홍길동님께서 부정확한 성적을 입력하여 성적 분석이 되지 않습니다");
  assert.equal(V.REENTRY_WARNING, "본인의 성적이 제대로 입력되었는지 다시 한번 확인해 주세요. 이번에 저장하면 더 이상 가채점 원점수의 정정이 불가능합니다.");
});

test("부정확 입력 상태: 서버의 정상 거절 또는 받을 수 없는 원점수가 남은 가채점 리포트", () => {
  assert.equal(V.isInaccurate({ stage: "provisional", last_attempt_outcome: "rejected" }), true);
  assert.equal(V.isInaccurate({ stage: "final", last_attempt_outcome: "rejected" }), true);
  assert.equal(V.isInaccurate({ stage: "mock", last_attempt_outcome: "rejected" }), false);
  assert.equal(V.isInaccurate({ stage: "provisional", last_attempt_outcome: "accepted" }), false);
  assert.equal(V.isInaccurate({ stage: "provisional", last_attempt_outcome: "accepted" }, { overall: { subjects: [{ area: "math", raw_score: 1 }] } }), true);
  assert.equal(V.isInaccurate(null, { overall: { subjects: [{ area: "math", standard_score: 128 }] } }), false);
});

const ST = { stage: "provisional", stage_state: "open", paid_input_allowed: true, input_limit_mode: "stage_rights", initial_remaining: 0, correction_request_remaining: 1, correction_granted: 0, correction_used: 0 };
test("가채점 정정 자동 승인: 사진·관리자 없이 바로 정정 입력, 한 번뿐·성적표 배부 전까지·가채점만", () => {
  const before = new Date("2026-12-01T03:00:00Z");
  assert.equal(selfCorrectionOpen(ST, "2026-12-11", before), true);
  assert.equal(selfCorrectionOpen({ ...ST, initial_remaining: 1 }, null, before), false, "최초 입력 전");
  assert.equal(selfCorrectionOpen({ ...ST, correction_request_remaining: 0, correction_granted: 1, correction_used: 1 }, null, before), false, "정정을 이미 씀");
  assert.equal(selfCorrectionOpen({ ...ST, correction_granted: 1 }, null, before), false, "이미 정정권이 있으면 그 정정권으로(새로 만들지 않음)");
  assert.equal(selfCorrectionOpen(ST, "2026-12-01", before), false, "배부일 당일부터 닫힘");
  assert.equal(selfCorrectionOpen({ ...ST, stage: "final" }, null, before), false, "실채점은 사진 요청 그대로");
  assert.equal(selfCorrectionOpen({ ...ST, stage_state: "closed" }, null, before), false);
});

test("화면 연결: 두 번 경고·재입력 경고·부정확 입력 안내·3·4페이지 막기·서버 액션 확인 표지", async () => {
  const form = await src("../src/app/reports/me/provisional-form.tsx");
  assert.match(form, /nextStep\(review\.step/);
  assert.match(form, /name="ack_unattainable"/);
  assert.match(form, /REENTRY_WARNING/);
  assert.match(form, /unattainableSecond\(who\)/);
  const sform = await src("../src/app/reports/me/score-form.tsx");
  assert.match(sform, /nextStep\(review\.step/);
  for (const f of ["../src/app/reports/me/provisional-actions.ts", "../src/app/pro/actions.ts"]) {
    assert.match(await src(f), /ack_unattainable/, f);
  }
  const page = await src("../src/app/reports/me/page.tsx");
  assert.match(page, /<InaccurateNotice name=\{name\}/);
  assert.match(page, /selfCorrectionOpen\(status, releaseOn\)/);
  assert.match(page, /correcting/);
  for (const f of ["../src/app/admissions/favorable/page.tsx", "../src/app/admissions/possibilities/catalog-browse.tsx"]) {
    assert.match(await src(f), /inaccurateSeen\(caller\)/, f);
  }
  const ops = await src("../src/lib/report-ops.ts");
  assert.equal((ops.match(/screenReport\(caller/g) ?? []).length, 3, "세 곳의 현재 리포트 읽기가 모두 거른다");
});

test("지난 기록 · 9월 모의평가: 9월 리포트가 있을 때만", async () => {
  const MOCK = "2027-september-mock";
  assert.equal(hasMockReports({ items: [{ report_id: "a", exam_id: MOCK }] }, MOCK), true);
  assert.equal(hasMockReports({ items: [] }, MOCK), false);
  assert.equal(hasMockReports(null, MOCK), false);
  assert.equal(hasMockReports({ items: [{ report_id: "b", exam_id: "2027-csat-provisional" }] }, MOCK), false);
  assert.equal(studentHasMockReports([{ stage: "provisional" }], MOCK), false);
  assert.equal(studentHasMockReports([{ stage: "mock" }], MOCK), true);
  const page = await src("../src/app/reports/me/page.tsx");
  assert.doesNotMatch(page, /\{csat && <Link className="btn" href=\{pastHref\(\)\}>/);
  assert.match(page, /pastMock && <Link className="btn" href=\{pastHref\(\)\}>/);
  assert.match(page, /if \(!\(await hasPastMock\(src, caller\)\)\) redirect\(route\.path\)/);
  const past = await src("../src/app/reports/me/past-records.tsx");
  assert.match(past, /limit: 1/);
  assert.match(past, /catch \{\s*return false;/);
});
