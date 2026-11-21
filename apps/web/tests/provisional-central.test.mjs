import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// 2026-11-22 대표님 결정: 가채점 과목별 결과를 '표준점수 121 · 백분위 83'(가운데 값)으로 보인다.
// 서버 dep_r26 percentile_at_central 이 있을 때만 그렇게 하고, 키가 없거나 null 이면 지금처럼 범위로 보인다.
const data = (code) => "data:text/javascript," + encodeURIComponent(code);
const lib = new URL("../src/lib/", import.meta.url);
const mocks = new Map([
  ["server-only", data("export {}")],
  ["next/headers", data("export async function cookies(){return {get(){return undefined}}}")],
]);
registerHooks({
  resolve(spec, ctx, next) {
    if (mocks.has(spec)) return next(mocks.get(spec), ctx);
    if (spec.startsWith("@/lib/")) return { url: new URL(spec.slice("@/lib/".length) + ".ts", lib).href, shortCircuit: true };
    if (spec.startsWith(".") && !/\.[a-z]+$/.test(spec) && ctx.parentURL?.endsWith(".ts")) return { url: new URL(spec + ".ts", ctx.parentURL).href, shortCircuit: true };
    return next(spec, ctx);
  },
  // 화면 원본은 JSON 을 import 속성 없이 부른다(번들러가 처리)
  load(url, ctx, next) {
    if (url.endsWith(".json")) return next(url, { ...ctx, importAttributes: { ...ctx.importAttributes, type: "json" } });
    return next(url, ctx);
  },
});

const { provisionalSubjectView, centralPercentile } = await import("../src/lib/provisional-report.ts");

const base = { standard_score_range: { low: 117, central: 121, high: 125 }, percentile_range: { low: 77, high: 89 } };

test("값 있음: 가운데 표준점수와 그 백분위 한 값, 범위는 보조로", () => {
  const v = provisionalSubjectView({ ...base, percentile_at_central: 83 });
  assert.deepEqual(v, { mode: "central", standard: 121, percentile: 83, standardRange: "117~125", percentileRange: "77~89" });
});

test("null: 지금처럼 백분위 범위", () => {
  const v = provisionalSubjectView({ ...base, percentile_at_central: null });
  assert.deepEqual(v, { mode: "range", standardRange: "117~125", central: 121, percentileRange: "77~89" });
});

test("필드 없음(옛 리포트·서버 배포 전): 지금처럼 백분위 범위", () => {
  const v = provisionalSubjectView({ ...base });
  assert.deepEqual(v, { mode: "range", standardRange: "117~125", central: 121, percentileRange: "77~89" });
});

test("잘못된 값은 없음으로 본다(소수·범위 밖·문자열)", () => {
  for (const bad of [83.5, -1, 101, "83", Number.NaN]) assert.equal(centralPercentile({ ...base, percentile_at_central: bad }), null);
  assert.equal(provisionalSubjectView({ ...base, percentile_at_central: "83" }).mode, "range");
});

test("추정 없는 원점수는 값이 와도 '추정 없음'", () => {
  assert.deepEqual(provisionalSubjectView({ standard_score_range: null, percentile_range: null, percentile_at_central: 50 }), { mode: "none" });
  assert.deepEqual(provisionalSubjectView(undefined), { mode: "none" });
});

test("끝이 같은 범위는 보조 줄을 따로 적지 않는다", () => {
  const v = provisionalSubjectView({ standard_score_range: { low: 140, central: 140, high: 140 }, percentile_range: { low: 100, high: 100 }, percentile_at_central: 100 });
  assert.deepEqual(v, { mode: "central", standard: 140, percentile: 100, standardRange: null, percentileRange: null });
});

test("합성 모드도 percentile_at_central 을 범위 안 정수로 싣는다", async () => {
  const { computeProvisional } = await import("../src/lib/api/synthetic-report.ts");
  const a = computeProvisional({
    exam_id: "2027-csat-provisional", pack_version: "t",
    korean: { raw_score: 80, choice: "화법과 작문" }, math: { raw_score: 2, choice: "미적분" },
    inquiry: [{ subject: "물리학Ⅰ", raw_score: 40 }, { subject: "화학Ⅰ", raw_score: 30 }],
    english_raw: 90, korean_history_raw: 40, second_language: null,
  });
  for (const s of a.subjects) {
    if (!s.standard_score_range) {
      assert.equal(s.percentile_at_central, null);
      assert.equal(provisionalSubjectView(s).mode, "none");
      continue;
    }
    assert.ok(Number.isInteger(s.percentile_at_central));
    assert.ok(s.percentile_at_central >= s.percentile_range.low && s.percentile_at_central <= s.percentile_range.high);
    assert.equal(provisionalSubjectView(s).mode, "central");
  }
  assert.equal(a.subjects.find((s) => s.area === "math").standard_score_range, null);
});
