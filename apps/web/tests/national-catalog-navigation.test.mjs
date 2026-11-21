import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
// query.ts 가 지원가능성 필터(lib/status-filter, 2026-11-22)를 확장자 없이 읽는다
registerHooks({ resolve(specifier, context, next) {
  if (specifier.endsWith(".json")) return { ...next(specifier, context), importAttributes: { type: "json" } };
  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:") && !/\.[cm]?[jt]sx?$|\.json$/.test(specifier)) {
    const url = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(fileURLToPath(url))) return next(url.href, context);
  }
  return next(specifier, context);
} });
const { hrefWith, LIMIT, parseQuery, skipEmptyPages, toSearch, YEAR } = await import("../src/app/admissions/possibilities/query.ts");

const favorable = { path: "/admissions/favorable", catalogView: true };

test("P4 catalogue stays in catalogue mode while search changes clear cursors", () => {
  const query = parseQuery({ university: "가상대", region: "제주", group: "가", cursor: "opaque+cursor/1" });
  const next = new URL(hrefWith(query, { cursor: "opaque+cursor/2" }, favorable), "https://example.test");
  assert.equal(next.pathname, favorable.path);
  assert.equal(next.searchParams.get("view"), "catalog");
  assert.equal(next.searchParams.get("cursor"), "opaque+cursor/2");

  const filtered = new URL(hrefWith(query, { group: "나" }, favorable), "https://example.test");
  assert.equal(filtered.searchParams.get("view"), "catalog");
  assert.equal(filtered.searchParams.get("cursor"), null);
  assert.equal(filtered.searchParams.get("group"), "나");
  assert.equal(hrefWith({}, {}, favorable), "/admissions/favorable?view=catalog");
  assert.equal(hrefWith({}, {}), "/admissions/possibilities");
  assert.equal(toSearch(query).academic_year, YEAR);
  assert.equal(toSearch(query).limit, LIMIT);
});

test("sparse pages keep continuation after the bounded automatic hops", async () => {
  const cursors = [];
  const source = {
    async searchOfferings(_caller, query) {
      cursors.push(query.cursor ?? null);
      return { items: [], next_cursor: `cursor-${cursors.length}` };
    },
  };
  const query = toSearch({});
  const result = await skipEmptyPages(source, {}, query);
  assert.deepEqual(cursors, [null, "cursor-1", "cursor-2", "cursor-3", "cursor-4", "cursor-5"]);
  assert.equal(result.next_cursor, "cursor-6");
});

test("full catalogue can be traversed with 30 rows per request, including rows awaiting analysis", async () => {
  const fixtures = Array.from({ length: 3994 }, (_, i) => ({ offering_id: `synthetic-${i}` }));
  let requests = 0;
  const source = {
    async searchOfferings(_caller, query) {
      requests++;
      assert.equal(query.academic_year, YEAR);
      assert.equal(query.limit, 30);
      const offset = query.cursor === undefined ? 0 : Number(query.cursor);
      const items = fixtures.slice(offset, offset + query.limit);
      const end = offset + items.length;
      return { items, next_cursor: end === fixtures.length ? null : String(end) };
    },
  };
  const ids = [];
  let cursor;
  do {
    const page = await skipEmptyPages(source, {}, toSearch({ cursor }));
    ids.push(...page.items.map(({ offering_id }) => offering_id));
    cursor = page.next_cursor ?? undefined;
  } while (cursor !== undefined);

  assert.equal(requests, 134);
  assert.equal(new Set(ids).size, 3994);
  assert.deepEqual(ids, fixtures.map(({ offering_id }) => offering_id));
});
