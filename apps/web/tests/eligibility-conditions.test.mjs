import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// TypeScript sources import siblings without an extension (same as live-retry.test.mjs)
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && !/\.[a-z]+$/.test(spec) && ctx.parentURL?.endsWith(".ts")) return { url: new URL(spec + ".ts", ctx.parentURL).href, shortCircuit: true };
    return next(spec, ctx);
  },
});
const { conditionLines } = await import("../src/lib/eligibility-conditions.ts");

const base = { offering_id: "2027:1", status: "pending", eligibility_status: "needs_confirmation" };
const subjects = [
  { area: "math", subject: "수학", choice: "미적분" },
  { area: "inquiry1", subject: "물리학Ⅰ", choice: null },
  { area: "inquiry2", subject: "화학Ⅰ", choice: null },
];

test("no conditions → no lines", () => {
  assert.deepEqual(conditionLines({ ...base }), []);
  assert.deepEqual(conditionLines({ ...base, eligibility_conditions: null }), []);
});

test("listed math and inquiry domains are compared with my input", () => {
  const a = { ...base, eligibility_conditions: { required_areas: ["국어", "수학", "영어", "탐구"], math_choices: ["미적분", "기하"], math_note: null, inquiry_domains: ["과학"], inquiry_note: "과학탐구 2과목" } };
  const lines = conditionLines(a, subjects);
  assert.deepEqual(lines.map((l) => [l.label, l.mark]), [["필수 응시", null], ["수학", "match"], ["탐구", "match"]]);
  assert.equal(lines[0].text, "국어·수학·영어·탐구");
  assert.equal(lines[2].text, "과학탐구 인정 · 과학탐구 2과목");
});

test("different input is marked differ; note-only math is shown as text without a mark", () => {
  const a = { ...base, eligibility_conditions: { required_areas: [], math_choices: null, math_note: "선택과목 제한 없음", inquiry_domains: ["사회"], inquiry_note: null } };
  const lines = conditionLines(a, subjects);
  assert.deepEqual(lines, [
    { label: "필수 응시", text: "별도 지정 없음", mark: null },
    { label: "수학", text: "선택과목 제한 없음", mark: null },
    { label: "탐구", text: "사회탐구 인정", mark: "differ" },
  ]);
});

test("unknown input leaves no mark", () => {
  const a = { ...base, eligibility_conditions: { required_areas: null, math_choices: ["확률과통계"], math_note: null, inquiry_domains: null, inquiry_note: null } };
  assert.deepEqual(conditionLines(a, []), [{ label: "수학", text: "확률과통계 중 응시", mark: null }]);
  assert.equal(conditionLines(a, [{ area: "math", subject: "수학", choice: "확률과 통계" }])[0].mark, "match");
});

const { conditionUnmet, withConditionUnmet } = await import("../src/lib/eligibility-conditions.ts");
const cond = (x) => ({ required_areas: null, math_choices: null, math_note: null, inquiry_domains: null, inquiry_note: null, ...x });

test("designated subject not taken → unmet only when certain", () => {
  const stat = [{ area: "math", subject: "수학", choice: "확률과 통계" }, { area: "inquiry1", subject: "생활과 윤리", choice: null }, { area: "inquiry2", subject: "사회·문화", choice: null }];
  const mixed = [{ area: "math", subject: "수학", choice: "미적분" }, { area: "inquiry1", subject: "물리학Ⅰ", choice: null }, { area: "inquiry2", subject: "사회·문화", choice: null }];
  const math = { ...base, eligibility_conditions: cond({ math_choices: ["미적분", "기하"] }) };
  const sci = { ...base, eligibility_conditions: cond({ inquiry_domains: ["과학"] }) };
  assert.equal(conditionUnmet(math, subjects), false);
  assert.equal(conditionUnmet(math, stat), true);
  assert.equal(conditionUnmet(sci, subjects), false);
  assert.equal(conditionUnmet(sci, stat), true);
  assert.equal(conditionUnmet(sci, mixed), false); // 일부만 맞으면 단정하지 않는다
  assert.equal(conditionUnmet({ ...base, eligibility_conditions: cond({ math_note: "미적분 또는 기하" }) }, stat), false); // 문장 조건은 판정하지 않는다
  assert.equal(conditionUnmet(math, undefined), false);
});

test("report analyses are relabelled and reference judgment is dropped", () => {
  const stat = [{ area: "math", subject: "수학", choice: "확률과 통계" }];
  const a = { ...base, reference_band: { code: "stable" }, eligibility_conditions: cond({ math_choices: ["미적분", "기하"] }) };
  const b = { ...base, offering_id: "2027:2", reference_band: { code: "stable" } };
  const report = { overall: { subjects: stat }, analyses: { "2027:1": a, "2027:2": b } };
  const out = withConditionUnmet(report);
  assert.equal(out.analyses["2027:1"].status, "ineligible");
  assert.equal(out.analyses["2027:1"].category, "ineligible");
  assert.equal(out.analyses["2027:1"].reference_band, null);
  assert.equal(out.analyses["2027:2"], b);
  assert.equal(a.status, "pending"); // 원본은 그대로
  const same = { overall: { subjects }, analyses: { "2027:1": a } };
  assert.equal(withConditionUnmet(same), same);
});

const { requiredUnmet, withRequiredUnmet, formal105Notice } = await import("../src/lib/eligibility-conditions.ts");
const { setEligibilityTablesForTest, parseEligibilityTables, ELIGIBILITY_TABLES_FORMAT } = await import("../src/lib/eligibility-tables.ts");
// 실제 명부는 화면 서버 KV에만 둔다(담당자 v45 지시 2026-11-20). 시험은 같은 모양의 합성 행을 쓴다
const T = {
  required: {
    "2027:9000000001": { m: ["미적분", "기하"], d: ["과학"], n: 2 },
    "2027:9000000002": { d: ["사회", "과학"], n: 2, s: 1 },
    "2027:9000000003": { d: ["사회", "과학"], n: 2 },
    "2027:9000000004": { d: ["과학"], n: 2, x: 1 },
  },
  formal105: { "2027:9000000105": { d: ["과학"], n: 2 }, "2027:9000000106": {}, "2027:9000000107": { d: ["사회", "과학"], n: 2, g: 1 } },
};
setEligibilityTablesForTest(T);
const subj = (math, i1, i2) => [
  { area: "math", subject: "수학", choice: math },
  { area: "inquiry1", subject: i1, choice: null },
  { area: "inquiry2", subject: i2, choice: null },
];

test("only listed required rows can turn into 'conditions not met' (2026-11-19)", () => {
  assert.equal(requiredUnmet("2027:9000000001", subj("확률과 통계", "물리학Ⅰ", "화학Ⅰ")), true);
  assert.equal(requiredUnmet("2027:9000000001", subj("미적분", "생활과 윤리", "화학Ⅰ")), true);
  assert.equal(requiredUnmet("2027:9000000001", subj("미적분", "물리학Ⅰ", "화학Ⅰ")), false);
  assert.equal(requiredUnmet("2027:9000000002", subj("확률과 통계", "생활과 윤리", "한국지리")), true);
  assert.equal(requiredUnmet("2027:9000000002", subj("확률과 통계", "생활과 윤리", "화학Ⅰ")), false);
  assert.equal(requiredUnmet("2027:9000000003", subj("확률과 통계", "생활과 윤리", "한국지리")), false);
  assert.equal(requiredUnmet("2027:9000000004", subj("미적분", "물리학Ⅰ", "물리학Ⅱ")), true);
  assert.equal(requiredUnmet("2027:9000000004", subj("미적분", "물리학Ⅰ", "화학Ⅱ")), false);
  assert.equal(requiredUnmet("2027:1", subj("확률과 통계", "생활과 윤리", "한국지리")), false);
  assert.equal(requiredUnmet("2027:9000000001", []), false);
});

test("withRequiredUnmet changes only listed offerings and keeps the server value otherwise", () => {
  const report = {
    overall: { subjects: subj("확률과 통계", "생활과 윤리", "한국지리") },
    analyses: {
      "2027:9000000001": { offering_id: "2027:9000000001", status: "pending", category: "pending", eligibility_status: "needs_confirmation", reference_band: { code: "target" } },
      "2027:1": { offering_id: "2027:1", status: "pending", category: "pending", eligibility_status: "needs_confirmation" },
    },
  };
  const out = withRequiredUnmet(report);
  assert.equal(out.analyses["2027:9000000001"].status, "ineligible");
  assert.equal(out.analyses["2027:9000000001"].reference_band, null);
  assert.equal(out.analyses["2027:1"], report.analyses["2027:1"]);
});

test("formal 105: 탐구 조건 미충족은 확실할 때만, 점수 조건 충족은 본수능 실채점일 때만(2026-11-20)", () => {
  const sci = "2027:9000000105", plain = "2027:9000000106";
  assert.equal(requiredUnmet(sci, subj("미적분", "생활과 윤리", "화학Ⅰ")), true);
  assert.equal(requiredUnmet(sci, subj("미적분", "물리학Ⅰ", "화학Ⅰ")), false);
  assert.equal(requiredUnmet(plain, subj("확률과 통계", "생활과 윤리", "한국지리")), false);
  assert.equal(formal105Notice(sci, "september_mock", subj("미적분", "물리학Ⅰ", "화학Ⅰ")).score, "unverified");
  assert.equal(formal105Notice(sci, "csat_final", subj("미적분", "물리학Ⅰ", "화학Ⅰ")).score, "met");
  assert.equal(formal105Notice(sci, "csat_final", subj("미적분", "생활과 윤리", "화학Ⅰ")).score, "unverified");
  assert.match(formal105Notice("2027:9000000107", "september_mock", []).documents, /지역인재/);
  assert.equal(formal105Notice("2027:1", "csat_final", []), null);
});

test("KV 표는 형식이 하나라도 어긋나면 쓰지 않고, 표가 없으면 아무 행도 바꾸지 않는다", () => {
  const ok = JSON.stringify({ format: ELIGIBILITY_TABLES_FORMAT, ...T });
  assert.ok(parseEligibilityTables(ok));
  assert.equal(parseEligibilityTables(JSON.stringify({ format: "x", ...T })), null);
  assert.equal(parseEligibilityTables(JSON.stringify({ format: ELIGIBILITY_TABLES_FORMAT, required: { "2027:1": { d: ["외계"] } }, formal105: {} })), null);
  assert.equal(parseEligibilityTables(JSON.stringify({ format: ELIGIBILITY_TABLES_FORMAT, required: { "bad": {} }, formal105: {} })), null);
  assert.equal(parseEligibilityTables(null), null);
  setEligibilityTablesForTest(null);
  assert.equal(requiredUnmet("2027:9000000001", subj("확률과 통계", "물리학Ⅰ", "화학Ⅰ")), false);
  assert.equal(formal105Notice("2027:9000000105", "csat_final", []), null);
  setEligibilityTablesForTest(T);
});
