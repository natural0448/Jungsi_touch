import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// 가채점 판정 보류: 정수 넘침 8곳만(H1 861곳은 11-23 새 경계로 해제)
const { isCsatHeld, CSAT_HELD_COUNT, heldBand } = await import("../src/lib/csat-held.ts");
test("held list", () => {
  assert.equal(CSAT_HELD_COUNT, 8);
  assert.ok(!isCsatHeld("2027:1000001750")); // 가톨릭대 의예과(H1 새 경계로 해제)
  assert.ok(isCsatHeld("2027:1000001854")); // 건국대(글로컬) 의예과(정수 넘침)
  assert.ok(isCsatHeld("2027:1000010771")); // 울산대 의예과(정수 넘침)
  assert.ok(!isCsatHeld("2027:1000002062")); // 가천대 건축학부
  assert.ok(!isCsatHeld(null));
});
test("held rows are dropped where bands enter the screen", () => {
  const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
  for (const p of ["app/admissions/possibilities/mine-parts.tsx", "app/admissions/possibilities/mine-detail.tsx", "lib/provisional-view.ts", "lib/pro-counsel-view.ts", "components/csat-badge.tsx"]) assert.ok(/isCsatHeld|heldBand|band\.held/.test(src(p)), p);
  assert.ok(src("app/admissions/possibilities/catalog-browse.tsx").includes("!isCsatHeld(id)"));
});
test("heldBand keeps the score, marks held", () => {
  const b = { basis: "reference_threshold", code: "stable", label: "안정", source: "g", school_score: { central: "587.72", low: "565.07", high: "607.21" } };
  assert.equal(heldBand("2027:1000001854", b).held, true);
  assert.equal(heldBand("2027:1000001854", b).school_score.central, "587.72");
  assert.equal(heldBand("2027:1000002062", b), b);
  assert.equal(heldBand("2027:1000001854", null), undefined);
});
test("4P position card reads school_rank only from judged (not held) bands", () => {
  const src = readFileSync(new URL("../src/app/admissions/possibilities/parts.tsx", import.meta.url), "utf8");
  assert.ok(src.includes("const rk = judged?.school_rank"));
  assert.ok(src.includes("상위 {rk.central ?? rkRange"));
});
test("4P gain shows school_gain only for judged bands", () => {
  const p = readFileSync(new URL("../src/app/admissions/possibilities/parts.tsx", import.meta.url), "utf8");
  const b = readFileSync(new URL("../src/components/csat-badge.tsx", import.meta.url), "utf8");
  assert.ok(p.includes("const gain = csatGainView(judged)"));
  assert.ok(b.includes("band && !band.held ? band.school_gain"));
  assert.ok(!/참고/.test(b));
});
test("incomplete csat bands are remembered only briefly", async () => {
  const { csatBandsIncomplete, CSAT_INCOMPLETE_TTL_MS } = await import("../src/lib/report-pure.ts");
  const sc = { central: "1.00", low: "1.00", high: "1.00" };
  assert.equal(CSAT_INCOMPLETE_TTL_MS, 30000);
  assert.equal(csatBandsIncomplete({ a: { school_score: sc } }), true); // 위치 없음
  assert.equal(csatBandsIncomplete({ a: { school_score: sc, school_rank: { central: "5.00", best: "1.00", worst: "9.00" } } }), true); // 유불리 하나도 없음
  assert.equal(csatBandsIncomplete({ a: { school_score: sc, school_rank: { central: "5.00", best: "1.00", worst: "9.00" }, school_gain: { central: "+1.00", low: "+0.50", high: "+2.00" } }, b: { school_score: sc, school_rank: { central: "5.00", best: "1.00", worst: "9.00" } } }), false);
  assert.equal(csatBandsIncomplete({}), false);
});
