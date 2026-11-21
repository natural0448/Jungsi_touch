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

test("estimated drop-outs are applicants minus (quota + fill count) (2026-11-16)", () => {
  // 10명 × 5.1 = 51, 51 − (10 + 10) = 31
  assert.deepEqual(derived(row(cell("10", "명"), cell("5.0999999999999996", "대1"), cell("10", "번"))),
    { applicants: 51, dropped: 31, fill: 10, heldA: false, heldD: false });
});

test("the fill count (충원인원) is the waitlist rank or, without it, the published count under any name (2026-11-16)", () => {
  const d = derived(row(cell("86", "명"), cell("3.3", "대1"), none, cell("20", "명")));
  assert.equal(d.applicants, 284);
  assert.equal(d.fill, 20);
  assert.equal(d.dropped, 284 - 86 - 20);
  // 예비번호가 있으면 예비번호를 쓴다
  assert.equal(derived(row(cell("86", "명"), cell("3.3", "대1"), cell("15", "번"), cell("20", "명"))).fill, 15);
  // 단위가 없거나 다른 명칭이어도 정수면 쓴다
  assert.equal(derived(row(cell("86", "명"), cell("3.3", "대1"), none, cell("7", null))).fill, 7);
});

test("a rank larger than the remaining applicants leaves the cell empty instead of negative", () => {
  assert.equal(derived(row(cell("10", "명"), cell("2", "대1"), cell("15", "번"))).dropped, null);
});

test("a pending rank keeps its value in the calculation and marks the result as pending", () => {
  const d = derived(row(cell("22", "명"), cell("5.8", "대1"), cell("12", "번", "pending_metadata")));
  assert.equal(d.dropped, 128 - 22 - 12);
  assert.equal(d.heldD, true);
});

test("an integer in the rank cell is used whatever its unit; non-integer text is not used (2026-11-16)", () => {
  assert.equal(derived(row(cell("22", "명"), cell("5.8", "대1"), cell("12", "명"))).dropped, 128 - 22 - 12);
  for (const rk of [cell("12.5", "번"), cell("확인 중", "번")])
    assert.equal(derived(row(cell("22", "명"), cell("5.8", "대1"), rk)).dropped, null);
});

test("a past row with no fill value stays empty (2026-11-19 evening: 담당자안); '12.0' still reads as 12", () => {
  const past = (rc, cr, rk = none, ad = none, y = 2026) => ({ y, rc, cr, rk, ad });
  const d = derived(past(cell("22", "명"), cell("5.8", "대1")));
  assert.equal(d.fill, null);
  assert.equal(d.dropped, null);
  assert.equal(derived(past(cell("22", "명"), cell("5.8", "대1"), cell("12.0", "번"))).fill, 12);
});
