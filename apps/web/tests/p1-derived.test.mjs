import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
// p1-derived 가 확장자 없이 부르는 같은 폴더 모듈(./format 등)을 .ts 로 찾는다
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:") && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    const url = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(fileURLToPath(url))) return next(url.href, context);
  }
  return next(specifier, context);
} });
const { derived } = await import("../src/lib/p1-derived.ts");

const cell = (v, u, s = "verified_official") => ({ v, s, r: null, u, l: null });
const none = cell(null, null, "unpublished");
const row = (rc, cr, rk, ad = none) => ({ rc, cr, rk, ad });

test("estimated non-admits are applicants minus quota and actual additional admits", () => {
  const r = row(cell("10", "명"), cell("5.0999999999999996", "대1"), cell("17", "번"), cell("10", "명"));
  assert.deepEqual(derived(r), { applicants: 51, dropped: 31, fill: 10, rank: 17, heldA: false, heldD: false });
});

test("rank-only and unqualified values do not produce estimated non-admits", () => {
  const cap = cell("86", "명"), ratio = cell("3.3", "대1");
  for (const ad of [none, cell("7", null), cell("7", "번"), cell("7", "명", "pending_metadata")]) {
    const d = derived(row(cap, ratio, cell("15", "번"), ad));
    assert.deepEqual([d.applicants, d.fill, d.rank, d.dropped], [284, null, 15, null]);
  }
});

test("additional-admit count exceeding available applicants leaves the estimate blank", () => {
  assert.equal(derived(row(cell("10", "명"), cell("2", "대1"), none, cell("15", "명"))).dropped, null);
});

test("a pending rank may be displayed without changing the estimate", () => {
  const d = derived(row(cell("22", "명"), cell("5.8", "대1"), cell("12", "번", "pending_metadata"), cell("8", "명")));
  assert.deepEqual([d.rank, d.fill, d.dropped, d.heldD], [12, 8, 98, false]);
});

test("verified zero and integer-valued count text retain count semantics", () => {
  const cap = cell("22", "명"), ratio = cell("5.8", "대1");
  assert.equal(derived(row(cap, ratio, none, cell("0", "명"))).dropped, 106);
  assert.equal(derived(row(cap, ratio, none, cell("12.0", "명"))).fill, 12);
  assert.equal(derived(row(cap, ratio, cell("12", "명"))).rank, null);
});
