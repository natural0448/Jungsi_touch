import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
registerHooks({ resolve(specifier, context, next) {
  if (specifier.endsWith(".json")) return { ...next(specifier, context), importAttributes: { type: "json" } };
  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:") && !/\.[cm]?[jt]sx?$|\.json$/.test(specifier)) {
    const url = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(fileURLToPath(url))) return next(url.href, context);
  }
  return next(specifier, context);
} });
const { statusKeyOf, parseStatusFilter, toggleStatus, STATUS_LABEL } = await import("../src/lib/status-filter.ts");
const { hrefWith, parseQuery } = await import("../src/app/admissions/possibilities/query.ts");

const band = (code, upper) => ({ basis: "reference_percentile", code, label: code, policy_version: "p", approval_version: "v", ...(upper ? { upper_code: upper } : {}) });
const base = { status: "pending", category: "pending", eligibility_status: "eligible", reason_code: null, years: [], versions: {} };

test("filter key follows the badge: a range reference band uses the estimate stage (code, favourable end), 2026-11-22", () => {
  assert.equal(statusKeyOf({ ...base, reference_band: band("stable", "outside") }), "stable");
  assert.equal(statusKeyOf({ ...base, reference_band: band("aspirational") }), "aspirational");
  assert.equal(statusKeyOf({ ...base }), "none"); // 판정 경계도 합격선도 없으면 판정 근거 부족
  assert.equal(statusKeyOf({ ...base, status: "ineligible", category: "ineligible" }), "ineligible");
  assert.equal(statusKeyOf({ ...base, status: "ready", category: "core", band: { code: "target" } }), "target");
  assert.equal(statusKeyOf({ ...base, status: "ready", category: "core" }), "other");
  assert.equal(statusKeyOf(null), "other");
  assert.equal(statusKeyOf("need"), "other");
});

test("display names match the badge: server stable = 안정, downward = 하향 (2026-11-22 이름 바꿈 취소)", () => {
  assert.equal(STATUS_LABEL.stable, "안정");
  assert.equal(STATUS_LABEL.downward, "하향");
});

test("st= in the address: unknown values dropped, stable order, toggle adds/removes, changing it restarts from the first page", () => {
  assert.deepEqual(parseStatusFilter("upward,bogus,stable"), ["stable", "upward"]);
  assert.equal(parseStatusFilter("bogus"), undefined);
  assert.deepEqual(toggleStatus(["stable"], "target"), ["stable", "target"]);
  assert.equal(toggleStatus(["stable"], "stable"), undefined);
  const cur = parseQuery({ st: "target,stable", cursor: "abc" });
  assert.deepEqual(cur.st, ["stable", "target"]);
  const href = hrefWith(cur, { st: ["stable"] });
  assert.match(href, /st=stable/);
  assert.doesNotMatch(href, /cursor=/);
  assert.match(hrefWith(cur, { cursor: "next" }), /st=stable%2Ctarget|st=stable,target/);
});
