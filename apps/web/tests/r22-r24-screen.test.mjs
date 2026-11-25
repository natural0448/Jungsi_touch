import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// 2026-11-25 담당자 R22·R24 화면 반영
const src = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("R22: withheld rows keep the server's school position only when it is verified", () => {
  const pure = src("../src/lib/report-pure.ts");
  assert.match(pure, /const verifiedRank = score !== null && x\.reason !== "final_cutoffs_pending" && rank\?\.basis === scoreKind/);
  const parts = src("../src/app/admissions/possibilities/parts.tsx");
  assert.match(parts, /const withheldRank = !final && !rk \? c1\?\.centralRank : undefined;/);
});
test("R24: automatic candidates drop rows the server marked as condition or minimum unmet", () => {
  const view = src("../src/lib/provisional-view.ts");
  assert.match(view, /export function blockedCsatRecommendationIds/);
  assert.match(view, /if \(typeof id !== "string" \|\| blocked\.has\(id\) \|\| isCsatHeld\(id\)\) continue;/);
});
test("R24: 3페이지 재사용 열쇠에 판 번호를 넣지 않는다(4페이지 조회마다 다시 만들지 않게)", () => {
  const ops = src("../src/lib/report-ops.ts");
  assert.match(ops, /const memoKey = \(r: ReportDto\) => JSON\.stringify\(\[referenceCacheVersion, r\.report_id, r\.profile_id, r\.candidates\?\.catalog_version \?\? null\]\);/);
});
test("R21 B: server no-comparison rows show '비교 자료 없음' (not an eligibility failure)", async () => {
  const s = src("../src/lib/csat-conditions.ts");
  assert.match(s, /if \(min === "nocomp"\) return \{ label: "비교 자료 없음", cls: "check"/);
  assert.match(src("../src/lib/report-ops.ts"), /for \(const id of c\?\.csat_no_comparison \?\? \[\]\) out\[id\] = "nocomp";/);
});
