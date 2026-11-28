import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

// 2026-11-28 대표님 결정: 가채점 정정 양식을 열기 전에 '한 번뿐·이번에 저장하면 더 고칠 수 없음'을 확인받는다
test("가채점 정정은 확인 화면을 거쳐야 양식이 열린다", () => {
  const page = src("app/reports/me/page.tsx");
  const confirm = page.indexOf('if (sp.go !== "1")');
  const form = page.indexOf("<ProvisionalForm", confirm);
  assert.ok(confirm > 0 && form > confirm, "확인 화면이 양식보다 먼저");
  assert.match(page, /한 번만 할 수 있습니다/);
  assert.match(page, /이번에 정정해서 저장하면, 그 뒤로는 더 이상 정정할 수 없습니다/);
  assert.match(page, /\?correct=1&go=1/);
  assert.match(page, /이번 정정이 마지막 기회입니다/);
});

// 2026-11-28 담당자 검수(회신 31 P2): 미리보기 계정은 본문처럼 확인 창도 '입력 횟수를 세지 않습니다'
test("미리보기 계정의 저장 확인 창은 입력 횟수를 말하지 않는다", () => {
  const form = src("app/reports/me/provisional-form.tsx");
  assert.match(form, /exempt \? \(/);
  assert.match(form, /미리보기 계정이라 입력 횟수를 세지 않습니다/);
  assert.match(form, /correcting && !exempt && /);
  const page = src("app/reports/me/page.tsx");
  assert.equal((page.match(/exempt=\{status\.input_limit_mode === "preview_exempt"\}/g) ?? []).length, 2);
});
