import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// 수능 가채점 리포트의 3번째 화면(유리한 대학 찾기): candidates.build 응답의 학교별 가채점 7단계(source g, dep_r22)
registerHooks({ resolve(specifier, context, next) {
  if (specifier.endsWith(".json")) return { ...next(specifier, context), importAttributes: { type: "json" } };
  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:") && !/\.[cm]?[jt]sx?$|\.json$/.test(specifier)) {
    const url = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(fileURLToPath(url))) return next(url.href, context);
  }
  return next(specifier, context);
} });
const { csatView, csatBandText, csatBandOf, csatUpper } = await import("../src/lib/provisional-view.ts");

const off = (id, uni, dept) => ({ offering_id: id, academic_year: 2027, university_id: uni, university_name: `${uni}대`, department: dept, group: "가", track: "일반" });
const g = (code, upper) => ({ basis: "reference_threshold", code, label: code, ...(upper ? { upper_code: upper } : {}), source: "g" });

const withJudgments = {
  status: "ready", reason_code: null, basic_university_groups: [], wildcards: [],
  reference_university_groups: [
    { university_id: "U1", university_name: "U1대", offerings: [
      { offering: off("2027:1", "U1", "국어국문학과"), reference_band: g("stable") },
      { offering: off("2027:2", "U1", "경영학과"), reference_band: g("target", "aspirational") },
      // 9모 문턱 판정 행(source a)이 섞여 와도 가채점 화면에는 쓰지 않는다
      { offering: off("2027:3", "U1", "물리학과"), reference_band: { ...g("target"), source: "a" } },
    ] },
    { university_id: "U2", university_name: "U2대", offerings: [
      { offering: off("2027:4", "U2", "컴퓨터공학과"), reference_band: g("upward") },
      // 목록 밖 단계·모양이 어긋난 행은 뺀다
      { offering: off("2027:5", "U2", "수학과"), reference_band: g("challenge") },
      { offering: off("2027:6", "U2", "화학과"), reference_band: { code: "target", source: "g" } },
      { offering: null, reference_band: g("target") },
    ] },
  ],
  reference_threshold_summary: { basis: "reference_threshold", threshold_version: "t", universe: 10, judged: 8, listed: 3, delivered: 3, complete: true, sources: { g: { policy_version: "p", approval_version: "a" } }, by_code: { stable: 1, target: 1, upward: 1, challenge: 3, outside: 2 } },
};

test("with school judgments: universities → fields → rows in the 9-mock order, only source g rows", () => {
  const v = csatView(withJudgments);
  const ids = v.universities.flatMap((u) => u.fields.flatMap((f) => f.items.map((x) => x.offering.offering_id)));
  assert.deepEqual(ids.sort(), ["2027:1", "2027:2", "2027:4"]);
  // 적정·소신 → 상향 → 하향 → 안정 순(9모 참고 목록과 같다): 적정이 있는 U1 이 먼저
  assert.deepEqual(v.universities.map((u) => u.university_id), ["U1", "U2"]);
  assert.equal(v.universities[0].bestBand.code, "target");
  assert.equal(v.outsideBand, 5);
  assert.equal(v.judged, 8);
  // 누백·합격선 위치·유불리는 없고, 펼칠 때 계산하지 않는다
  for (const u of v.universities) for (const f of u.fields) for (const x of f.items) {
    assert.equal(x.reference_percentile, null);
    assert.equal(x.margin, null);
    assert.equal(x.advantage, null);
    assert.equal(x.pending, false);
  }
});

test("badge text: one stage when central, '적정~소신' when only the range is known", () => {
  assert.equal(csatBandText(g("stable")), "안정");
  assert.equal(csatBandText(g("target", "aspirational")), "적정~소신");
  assert.equal(csatBandText(g("downward", "upward")), "하향~상향");
  // 나쁜 끝이 좋은 끝보다 앞이거나 같으면 범위로 보지 않는다
  assert.equal(csatUpper(g("upward", "target")), null);
  assert.equal(csatUpper(g("target", "target")), null);
  assert.equal(csatUpper(g("target", "weird")), null);
  assert.equal(csatBandOf({ ...g("target"), source: "a" }), null);
  assert.equal(csatBandOf({ ...g("weird") }), null);
});

test("without school judgments (Secret off): nothing to list → '가채점 판정 준비 중'", () => {
  for (const c of [null, undefined, { status: "ready", basic_university_groups: [], wildcards: [] }, { status: "ready", reference_university_groups: [] },
    { status: "ready", reference_university_groups: [{ university_id: "U1", offerings: [{ offering: off("2027:1", "U1", "국어국문학과"), reference_band: { ...g("target"), source: "a" } }] }] },
    { status: "ready", reference_university_groups: "broken" }]) {
    const v = csatView(c);
    assert.deepEqual(v.universities, []);
    assert.equal(v.outsideBand, 0);
  }
});

test("a 9-mock threshold summary (source a) is not counted as CSAT outside-band", () => {
  const c = { ...withJudgments, reference_threshold_summary: { ...withJudgments.reference_threshold_summary, sources: { a: { policy_version: "p", approval_version: "a" } } } };
  const v = csatView(c);
  assert.equal(v.outsideBand, 0);
  assert.equal(v.judged, 3);
});
