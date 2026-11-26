import { test } from "node:test";
import assert from "node:assert/strict";
import { freeProvisionalUntil, isFreeProvisional } from "../src/lib/free-provisional.ts";
import { csatBandsIncomplete } from "../src/lib/report-pure.ts";
import { readFileSync } from "node:fs";

const now = Date.parse("2026-11-29T00:00:00Z");
const s = (tier, until) => ({ format: "jungsi.session/v1", member_tier: tier, entitlement_expires_at: null, ...(until ? { free_provisional_until: until } : {}) });

test("무료 공개 기간: 서버가 기간을 보낸 일반 회원만, 기간 안에서만", () => {
  assert.equal(isFreeProvisional(s("standard", "2026-12-13T15:00:00Z"), now), true);
  assert.equal(freeProvisionalUntil(s("standard", "2026-12-13T15:00:00Z"), now).toISOString(), "2026-12-13T15:00:00.000Z");
  assert.equal(isFreeProvisional(s("standard", "2026-11-28T00:00:00Z"), now), false);
  assert.equal(isFreeProvisional(s("standard"), now), false);
  assert.equal(isFreeProvisional(s("paid", "2026-12-13T15:00:00Z"), now), false);
  assert.equal(isFreeProvisional(s("standard", "not-a-date"), now), false);
  assert.equal(isFreeProvisional(null, now), false);
});

test("무료 응답(구간·방향만)은 덜 찬 결과로 보지 않는다 — 30초마다 다시 요청하지 않게", () => {
  const free = { a: { code: "target", school_score: { central: "1", low: "1", high: "1" }, rank_bucket: 5, gain_tone: "up" } };
  assert.equal(csatBandsIncomplete(free), false);
  assert.equal(csatBandsIncomplete({ a: { code: "target", school_score: { central: "1", low: "1", high: "1" } } }), true);
});

test("3·4페이지 잠금은 무료 기간에만 풀린다(routes.ts), 인쇄 리포트는 그대로 유료", () => {
  const routes = readFileSync(new URL("../src/lib/routes.ts", import.meta.url), "utf8");
  assert.match(routes, /isFreeProvisional\(session\) && \(route\.id === "PAGE-03" \|\| route\.id === "PAGE-04"\)/);
  const print = readFileSync(new URL("../src/app/reports/me/print/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(print, /isFreeProvisional/);
});
