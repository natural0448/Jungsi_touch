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
  // 2026-11-27 대표님 결정: 판 번호 대신 미충족 확정 목록 지문(eligibilityFingerprint)을 넣는다
  // 2026-11-27 대표님 결정(담당자 후속 ① 대안): 묶음 교체 표시(csatEpoch)도 넣는다 — 묶음을 바꾸면 옛 결과를 쓰지 않는다
  assert.match(ops, /const memoKey = \(r: ReportDto, epoch: string\) => JSON\.stringify\(\[referenceCacheVersion, r\.report_id, r\.profile_id, r\.candidates\?\.catalog_version \?\? null, eligibilityFingerprint\(r\), epoch\]\);/);
  assert.match(ops, /"p4-v2", report\.report_id, report\.profile_id, report\.report_version, targets, eligibilityFingerprint\(report\), epoch\]/);
  assert.match(ops, /"p4scan-v1", report\.report_id, report\.profile_id, report\.report_version, scan, eligibilityFingerprint\(report\), epoch\]/);
  assert.match(ops, /const CSAT_EPOCH_KEY = "jt:csat-cache-epoch";/);
});
test("R21 B: server no-comparison rows show '비교 자료 없음' (not an eligibility failure)", async () => {
  const s = src("../src/lib/csat-conditions.ts");
  assert.match(s, /if \(min === "nocomp"\) return \{ label: "비교 자료 없음", cls: "check"/);
  assert.match(src("../src/lib/report-ops.ts"), /for \(const id of c\?\.csat_no_comparison \?\? \[\]\) out\[id\] = "nocomp";/);
});
