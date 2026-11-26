import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
// pro-counsel 이 확장자 없이 부르는 같은 폴더 모듈(./format 등)을 .ts 로 찾는다
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:") && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    const url = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(fileURLToPath(url))) return next(url.href, context);
  }
  return next(specifier, context);
} });
const { schoolCounsel, choiceGuide, zoneOf, EXPECTATION } = await import("../src/lib/pro-counsel.ts");
const { counselSchools, csatRows } = await import("../src/lib/pro-counsel-view.ts");

const school = (over = {}) => ({
  offering_id: "2027:1", university_name: "가대학교", department: "경영학과", group: "가",
  band: { code: "target", upper: null }, provisional: true,
  position: { score: "704.94", better_gap: "2.62", worse_gap: "4.61", share_pct: 63 },
  quota2027: null, years: null, ...over,
});
const all = (c) => [...c.why, ...c.chance, ...c.history, ...c.cautions].join("\n");
// 확률은 "합격 확률이 아닙니다" 안내에만 허용한다
const FORBIDDEN = /확률(?!이 아닙니다)|합격률|%\s*로\s*합격|어디가|대학알리미|출처|https?:|근거 번호/;

test("position sentences use only server numbers", () => {
  const c = schoolCounsel(school());
  const t = all(c);
  for (const v of ["704.94", "2.62", "4.61", "63"]) assert.ok(t.includes(v), v);
  assert.ok(t.includes("가운데"));
  assert.ok(t.includes("한 단계 위인 하향 점수대와는 2.62점 차이입니다"));
  assert.ok(!t.includes("모자랍니다") && !t.includes("부족"));
  assert.ok(t.includes("4.61점 이상 낮아지면 한 단계 아래인 소신으로"));
  assert.ok(t.includes("맨 아래 0, 맨 위 100"));
  assert.ok(!t.includes("경계"));
  assert.ok(c.chance.includes(EXPECTATION.target));
  assert.ok(!FORBIDDEN.test(t));
});

test("missing numbers drop sentences instead of inventing", () => {
  const c = schoolCounsel(school({ position: null }));
  assert.ok(!all(c).includes("점입니다"));
  assert.ok(!c.chance.some((x) => x.includes("모자랍니다")));
  assert.equal(c.history.length, 0);
  const none = schoolCounsel(school({ band: null, position: null }));
  assert.equal(none.chance.length, 0);
  assert.ok(none.why[0].includes("아직 판정이 없습니다"));
});

test("stable has no better boundary and outside no worse boundary; 0.00 reads as under 0.01", () => {
  const st = schoolCounsel(school({ band: { code: "stable" }, position: { score: "1.00", better_gap: null, worse_gap: "3.50", share_pct: null } }));
  assert.ok(!st.chance.some((x) => x.includes("모자랍니다")));
  assert.ok(st.chance.some((x) => x.includes("하향으로 내려갑니다")));
  const up = schoolCounsel(school({ band: { code: "upward" }, position: { score: "648.50", better_gap: "0.00", worse_gap: "1.50", share_pct: 100 } }));
  assert.ok(up.chance.some((x) => x.includes("소신과 0.1점도 차이 나지 않는, 소신 바로 아래 점수입니다")));
  const edge = schoolCounsel(school({ position: { score: "1.00", better_gap: "1.00", worse_gap: "0.04", share_pct: 1 } }));
  assert.ok(edge.chance.some((x) => x.includes("아주 조금만(0.1점 미만) 낮아져도") && x.includes("맨 끝")));
  assert.ok(!all(edge).includes("경계"));
});

test("range judgment explains the range and gives no point position", () => {
  const c = schoolCounsel(school({ band: { code: "target", upper: "aspirational" }, position: { score: "1.00", better_gap: "1.00", worse_gap: "1.00", share_pct: 50 } }));
  assert.ok(c.why[0].includes("적정~소신"));
  assert.ok(c.chance.some((x) => x.includes("적정부터 소신까지")));
  assert.ok(!c.chance.some((x) => x.includes("1.00")));
  assert.ok(c.chance.includes(EXPECTATION.aspirational));
});

test("fill history: facts only, expectation sentence only for reach stages", () => {
  const years = [2024, 2025, 2026].map((year, i) => ({ year, quota: 10, ratio: ["4.123", "5.2", "6"][i], fill: [12, 15, 10][i], first: null, second: { label: "70%컷", value: ["600.1", "605.5", "602"][i], unit: "점" } }));
  const up = schoolCounsel(school({ band: { code: "upward" }, years, quota2027: 8 }));
  const t = all(up);
  assert.ok(t.includes("2024 12명(모집 10명)"));
  assert.ok(t.includes("3개 학년도 모두 충원인원이 모집인원 이상"));
  assert.ok(t.includes("추가 합격을 기대해 볼 근거"));
  assert.ok(t.includes("경쟁률: 2024 4.12대 1 → 2025 5.2대 1 → 2026 6대 1. 해마다 올랐습니다."));
  assert.ok(t.includes("모집인원이 2026학년도 10명에서 2027학년도 8명으로 2명 줄었습니다"));
  assert.ok(t.includes("대학 발표 70%컷: 2024 600.1점 · 2025 605.5점 · 2026 602점. 해마다 최대 5.4점 차이"));
  assert.ok(t.includes("바로 견주지 않습니다"));
  assert.ok(!FORBIDDEN.test(t));
  const safe = schoolCounsel(school({ band: { code: "stable" }, position: null, years }));
  assert.ok(!all(safe).includes("기대해 볼 근거"));
  // 모집인원이 없는 해는 충원 문장에 넣지 않는다
  const partial = schoolCounsel(school({ years: [{ year: 2025, quota: null, ratio: null, fill: 3, first: null, second: null }] }));
  assert.ok(!all(partial).includes("충원(추가 합격)"));
});

test("zones", () => {
  assert.equal(zoneOf(67), "위쪽"); assert.equal(zoneOf(33), "아래쪽"); assert.equal(zoneOf(50), "가운데"); assert.equal(zoneOf(null), null);
});

test("choice guide orders by band, forms combos only from picked schools", () => {
  const mk = (id, group, code, share = 50) => school({ offering_id: id, university_name: `대학${id}`, department: "학과", group, band: { code }, position: { score: "1.00", better_gap: "1.00", worse_gap: "1.00", share_pct: share } });
  const list = [mk("a1", "가", "upward"), mk("a2", "가", "target"), mk("b1", "나", "stable"), mk("b2", "나", "challenge"), mk("c1", "다", "downward"), mk("c2", "다", "aspirational")];
  const g = choiceGuide(list);
  assert.deepEqual(g.groups[0].rows.map((r) => r.school.offering_id), ["a2", "a1"]);
  const names = g.combos.map((c) => c.name);
  assert.deepEqual(names, ["안정형", "균형형", "도전형"]);
  const bal = g.combos[1].picks.map((r) => r.tier).sort();
  assert.deepEqual(bal, ["fit", "reach", "safe"]);
  assert.ok(g.groups[0].lines.some((x) => x.includes("고르는 문제")));
  assert.ok(g.notes.at(-1).includes("최종 선택은 학생이 합니다"));
  for (const x of [...g.groups.flatMap((y) => y.lines), ...g.notes]) assert.ok(!FORBIDDEN.test(x) && !x.includes("경계"));
  const two = choiceGuide([mk("a1", "가", "target"), mk("b1", "나", "upward")]);
  assert.equal(two.combos.length, 0);
  assert.ok(two.groups[2].lines[0].includes("다군에 담은 학교가 없습니다"));
  assert.ok(two.notes.some((x) => x.includes("안전권(안정·하향) 학교가 없습니다")));
});

test("csatRows keeps only provisional source g threshold rows; counselSchools maps picked ids", () => {
  const off = (id, group) => ({ offering_id: id, academic_year: 2027, university_id: "U", university_name: "가대학교", campus: null, department: `학과${id}`, track: null, group, region: null, wildcard_group: null });
  const candidates = {
    status: "ready", reason_code: null, basic_university_groups: [], wildcards: [], pending_offerings: [], catalog_version: "v",
    reference_university_groups: [{ university_id: "U", university_name: "가대학교", offerings: [
      { offering: off("2027:1", "가"), reference_band: { basis: "reference_threshold", code: "target", label: "적정", source: "g", position: { score: "1.00", better_gap: "1.00", worse_gap: "2.00", share_pct: 33 } } },
      { offering: off("2027:2", "나"), reference_band: { basis: "reference_threshold", code: "stable", label: "안정" } },
      { offering: off("2027:3", "다"), reference_band: { basis: "reference_threshold", code: "nope", label: "?", source: "g" } },
    ] }],
  };
  assert.deepEqual(csatRows(candidates).map((r) => r.offering.offering_id), ["2027:1"]);
  const shortlist = { "2027:1": { selected: true }, "2027:2": { selected: true }, "2027:9": { selected: true }, "2027:3": { selected: false } };
  const s = counselSchools({ candidates, shortlist }, true);
  assert.deepEqual(s.map((x) => x.offering_id), ["2027:1", "2027:2"]);
  assert.equal(s[0].band.code, "target"); assert.equal(s[0].position.share_pct, 33);
  assert.equal(s[1].band, null);
});

test("watch points: when to check what, with this school's numbers only", () => {
  const years = [2025, 2026].map((year, i) => ({ year, quota: 10, ratio: ["4.5", "5.25"][i], fill: [11, 12][i], first: null, second: null }));
  const fit = schoolCounsel(school({ years, quota2027: 9 }));
  assert.equal(fit.watch.length, 4);
  assert.ok(fit.watch[0].startsWith("접수 전") && fit.watch[0].includes("9명"));
  assert.ok(fit.watch[1].startsWith("접수 중") && fit.watch[1].includes("2026학년도 최종 경쟁률 5.25대 1"));
  assert.ok(fit.watch[2].includes("안심하기 어려우니"));
  assert.ok(fit.watch[3].startsWith("발표 뒤") && fit.watch[3].includes("2026학년도 충원인원 12명"));
  const up = schoolCounsel(school({ band: { code: "upward" }, years }));
  assert.ok(up.watch.some((x) => x.includes("기대를 걸어 볼 근거")));
  assert.ok(all(up).includes("예비 순위로 다시 확인"));
  assert.ok(!FORBIDDEN.test(all(fit)) && !all(fit).includes("경계"));
  assert.equal(schoolCounsel(school()).watch.length, 0);
});
