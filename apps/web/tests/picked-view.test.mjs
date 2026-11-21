import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
registerHooks({ resolve(specifier, context, next) {
  if (specifier.endsWith(".json")) return { ...next(specifier, context), importAttributes: { type: "json" } };
  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:") && !/\.[cm]?[jt]sx?$|\.json$/.test(specifier)) {
    const url = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(fileURLToPath(url))) return next(url.href, context);
  }
  return next(specifier, context);
} });
const { PICK_GROUP_LIMIT, PICK_TOTAL_LIMIT, groupPicked, groupCounts, decisionBasisText } = await import("../src/lib/picked-view.ts");
const { BAND } = await import("../src/lib/decision-labels.ts");
const { statusKeyOf } = await import("../src/lib/status-filter.ts");

const item = (id, group) => ({ offering_id: id, offering: group === null ? null : { group, university_name: id, department: "d" }, entry: { selected: true }, assessment: null });
const reason = (code) => (code ? `REASON:${code}` : "");
const base = { offering_id: "x", status: "pending", category: "pending", eligibility_status: "eligible", reason_code: "reference_conversion_not_production_approved", years: [], versions: {} };
const refPct = (v, up) => ({ status: "reference_estimated", estimated_upper_cumulative_percent_all_examinees: v, ...(up ? { estimated_upper_cumulative_percent_upper_bound: up } : {}), metric: "estimated_upper_cumulative_percent_all_examinees" });
const overall = { status: "observed", top_percent: "10.0", exclusive_top_percent: "9.8", inclusive_top_percent: "10.2" };

test("담기 한도는 군별 5 · 전체 15 (대표님 요청 2026-11-21, 전에는 4·12)", () => {
  assert.equal(PICK_GROUP_LIMIT, 5);
  assert.equal(PICK_TOTAL_LIMIT, 15);
});

test("가·나·다군으로 나누고, 빈 군도 칸을 두며, 모집군을 모르는 곳은 맨 뒤 따로", () => {
  const g = groupPicked([item("a", "나"), item("b", "가"), item("c", null), item("d", "나군"), item("e", "전형외")]);
  assert.deepEqual(g.groups.map((x) => x.group), ["가", "나", "다"]);
  assert.deepEqual(g.groups.map((x) => x.items.map((i) => i.offering_id)), [["b"], ["a", "d"], []]);
  assert.deepEqual(g.other.map((i) => i.offering_id), ["c", "e"]);
  assert.deepEqual(groupCounts([item("a", "나"), item("b", "가"), item("c", null)]), [{ group: "가", n: 1 }, { group: "나", n: 1 }, { group: "다", n: 0 }]);
});

test("7단계 이름 순서: 안정 → 하향 → 적정 → 소신 → 상향 → 도전 → 불가", () => {
  assert.deepEqual(Object.values(BAND).map((b) => b.label), ["안정", "하향", "적정", "소신", "상향", "도전", "불가"]);
});

test("판단 근거: 참고 기준 7단계가 있으면 그 단계 문장(배지·4페이지 필터와 같은 단계), 참고 환산 문장이 아니다", () => {
  const a = { ...base, reference_percentile: refPct("4.1"), reference_band: { basis: "reference_percentile", code: "stable", label: "안정", policy_version: "p", approval_version: "v" } };
  const t = decisionBasisText(a, overall, reason);
  assert.match(t, /'안정'입니다/);
  assert.ok(t.includes(BAND.stable.desc));
  assert.doesNotMatch(t, /REASON:/);
  assert.equal(statusKeyOf(a, overall), "stable");
  const ranged = decisionBasisText({ ...a, reference_band: { ...a.reference_band, code: "target", upper_code: "upward" } }, overall, reason);
  assert.match(ranged, /'적정'입니다/);
  assert.match(ranged, /범위로 나와/);
});

test("판단 근거: 판정 경계가 없고 지난해 합격선이 있으면 합격선 대비 위치 문장", () => {
  const a = { ...base, reference_percentile: refPct("8.0"), year_cutoffs: [{ academic_year: 2025, published_metric: "70%컷", cutoff_top_percent: "12.0", score_component: null }] };
  const t = decisionBasisText(a, overall, reason);
  assert.match(t, /^2025 70%컷보다 4\.0%p 위입니다/);
  assert.match(t, /합격 가능성 판정은 아닙니다/);
});

test("판단 근거: 이 대학 위치가 없으면 전체 위치로 견주고(overall 을 넘겨야 함), 합격선도 없으면 판정 근거 부족 문장", () => {
  const cut = [{ academic_year: 2025, published_metric: "70%컷", cutoff_top_percent: "15.0", score_component: null }];
  const viaOverall = decisionBasisText({ ...base, year_cutoffs: cut }, overall, reason);
  assert.match(viaOverall, /전체 위치로 견줌/);
  // 전체 위치를 넘기지 않으면 같은 학과가 '판정 근거 부족'으로 떨어진다(2페이지 표의 옛 원인)
  assert.match(decisionBasisText({ ...base, year_cutoffs: cut }, null, reason), /판정을 만들지 않았습니다/);
  assert.match(decisionBasisText({ ...base }, overall, reason), /판정을 만들지 않았습니다/);
});

test("판단 근거: 정식 판정·자격 미충족·내 입력 이유", () => {
  const ready = decisionBasisText({ ...base, status: "ready", category: "core", reason_code: null, band: { code: "aspirational" } }, overall, reason);
  assert.match(ready, /'소신'입니다/);
  assert.equal(decisionBasisText({ ...base, status: "ineligible", category: "ineligible", reason_code: "eligibility_not_met" }, overall, reason), "REASON:eligibility_not_met");
  assert.equal(decisionBasisText({ ...base, reason_code: "designated_subject_not_taken" }, overall, reason), "REASON:designated_subject_not_taken");
  // 배지와 같은 순서: 자격 확인이 필요해도 판정 경계·합격선이 없으면 '판정 근거 부족'이 먼저다
  assert.match(decisionBasisText({ ...base, eligibility_status: "needs_confirmation", reason_code: null }, overall, reason), /판정을 만들지 않았습니다/);
});

const src = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("2페이지 표는 3·4페이지처럼 그리기 전에 분석을 맞추고(settleAnalyses) 전체 위치를 넘긴다; 가채점 리포트는 준비 중", () => {
  const page = src("../src/app/reports/me/page.tsx");
  assert.match(page, /settleAnalyses\(src, caller, report, ids\)/);
  assert.match(page, /<PickedTable items=\{items\} overall=\{current\.overall\?\.overall\} \/>/);
  assert.match(page, /<Picked src=\{src\} caller=\{caller\} report=\{report\} pending \/>/);
  const print = src("../src/app/reports/me/print/page.tsx");
  assert.match(print, /<PickedTable items=\{shortlist\} overall=\{a\.overall\} print \/>/);
  assert.match(print, /<PickedTable items=\{shortlist\} pending print \/>/);
  const view = src("../src/app/reports/me/report-view.tsx");
  assert.match(view, /<ScoreCell a=\{a\} plain \/>/); // 환산점수 아래 '참고' 꼬리표 없음
  assert.match(view, /<StatusCell a=\{a\} overall=\{overall\} \/>/);
  assert.match(view, /<AdvantageCell a=\{a\} overall=\{overall\} \/>/);
  assert.match(view, /decisionBasis\(a, overall\)/);
});

test("담기 한도 문구·합성 서버가 같은 상수를 쓴다(4·12 숫자가 남지 않음)", () => {
  assert.match(src("../src/app/shortlist-actions.ts"), /\$\{PICK_GROUP_LIMIT\}개까지/);
  assert.match(src("../src/lib/api/synthetic-report.ts"), /same >= PICK_GROUP_LIMIT/);
  assert.doesNotMatch(src("../src/components/shortlist-tray.tsx"), /PICK_GROUP_LIMIT = 4|PICK_TOTAL_LIMIT = 12/);
});
