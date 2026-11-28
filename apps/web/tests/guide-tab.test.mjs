import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

test("이용 안내가 1번째 탭, 리포트가 6번째", () => {
  const routes = src("lib/routes.ts");
  assert.match(routes, /GUIDE_TAB = \{ path: "\/guide", label: "이용 안내", number: 1 \}/);
  assert.match(routes, /REPORT_TAB = \{ path: "\/reports\/me\/final", label: "리포트", number: 6 \}/);
  assert.match(routes, /number: i \+ 2/);
  const header = src("components/site-header.tsx");
  assert.ok(header.indexOf("GUIDE_TAB") < header.indexOf("PAGES"), "안내 탭이 앞");
});

// 2026-11-28 대표님 결정: 정시터치 루트는 늘 이용 안내로
test("정시터치 루트는 늘 이용 안내로", () => {
  const root = src("app/page.tsx");
  assert.match(root, /redirect\(GUIDE_TAB\.path\)/);
  assert.ok(!/ROOT_REDIRECT/.test(root));
  assert.match(src("components/nav-pending.tsx"), /BASE \+ GUIDE_TAB\.path \+ url\.search/);
  assert.match(src("app/guide/seen.tsx"), /max-age=31536000/);
});

test("안내 문구에 금지어가 없다", () => {
  const page = src("app/guide/page.tsx");
  assert.ok(!page.includes("참고"), "'참고' 금지");
  assert.ok(!/와일드카드/.test(page), "와일드카드는 실채점 뒤 공개");
});
