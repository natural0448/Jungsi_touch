import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/*
  인쇄 화면(상담 리포트 /reports/me/print, 지난 기록 ?report=, 전문가용 학생 인쇄)은 화면에서 아무것도 열지 않았어도
  담은 학교 전부의 상세(모집군·인원, 지원 조건, 네 칸, 판단 이유, 연도별 근거, 설명 문장)를 펼친 채로 찍는다(대표님 결정 2026-11-22).
*/
const { mapPool } = await import("../src/lib/print-pool.ts");
const src = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\"'`])\/\/.*$/gm, "$1");

test("미리 받기 대기열: 동시에 limit 개까지만, 결과는 넣은 순서, 하나가 실패해도 나머지는 계속", async () => {
  let now = 0, peak = 0;
  const items = Array.from({ length: 15 }, (_, i) => i);
  const out = await mapPool(items, 2, async (i) => {
    now++;
    peak = Math.max(peak, now);
    await new Promise((r) => setTimeout(r, (i * 7) % 5));
    now--;
    if (i === 4) throw new Error("boom");
    return i * 10;
  }, (_e, i) => -i);
  assert.equal(peak, 2);
  assert.deepEqual(out, items.map((i) => (i === 4 ? -4 : i * 10)));
  assert.deepEqual(await mapPool([], 2, async () => 1, () => 0), []);
});

test("미리 받기: 서버 동시 요청 2를 넘지 않고(학교마다 모집 정보 → 발행 기준 차례), 펼친 기록은 남기지 않는다", () => {
  const f = code(src("../src/app/admissions/possibilities/print-extras.ts"));
  assert.match(f, /export const PRINT_EXTRAS_CONCURRENCY = 2;/);
  assert.match(f, /mapPool\(\s*offerings,\s*PRINT_EXTRAS_CONCURRENCY/);
  assert.match(f, /const rec = await src\.readRecruitment[\s\S]*const pub = await src\.readPublishedForecast/);
  assert.doesNotMatch(f, /logContentView/);
  assert.doesNotMatch(f, /Promise\.all\(\[src\./);
});

test("상담 리포트 인쇄: 담은 학교마다 표의 한 줄 아래에 상세 카드를 펼친 채로(details 없음), 학교 하나가 쪽 사이에서 잘리지 않게", () => {
  const page = code(src("../src/app/reports/me/print/page.tsx"));
  assert.match(page, /await loadPrintExtras\(src, caller, /);
  assert.match(page, /<PickedTable items=\{shortlist\} overall=\{a\.overall\} print detailOf=\{detailOf\} \/>/);
  assert.match(page, /<PrintDetail o=\{s\.offering\} a=\{s\.assessment\} extras=\{extras\[s\.offering_id\]\}/);
  assert.match(page, /import "@\/app\/admissions\/possibilities\/possibilities\.css";/);
  // 가채점 리포트: 4페이지와 같은 학교별 판정 표(2026-11-23 리포트 탭)
  assert.match(page, /<CsatPickedTable single items=\{shortlist\} bands=\{csatBands\} a=\{a\} print min=\{csatMin\} \/>/);
  // 지난 기록(?report=)도 같은 화면이 그린다
  assert.match(page, /const wanted = typeof sp\.report === "string"/);

  const view = code(src("../src/app/reports/me/report-view.tsx"));
  const table = view.slice(view.indexOf("export function PickedTable"));
  assert.match(table, /const full = print && !pending && !!detailOf;/);
  assert.match(table, /<tbody key=\{s\.offering_id\} className="pr-unit">/);
  assert.match(table, /<tr className="rp-drow pr-open">\s*<td colSpan=\{span\}>\{d\}<\/td>/);
  assert.doesNotMatch(table, /<details/);

  const detail = code(src("../src/app/reports/me/print-detail.tsx"));
  assert.doesNotMatch(detail, /"use client"/);
  assert.doesNotMatch(detail, /<details|<summary/);
  assert.match(detail, /<ExtrasBody[\s\S]*detail=\{(?:csat \?\? )?<Detail [^>]*acts=\{false\} \/>\}[\s\S]*conds=\{(?:csat \? undefined : )?<ConditionsBlock /);

  const css = src("../src/app/reports/me/report.css");
  assert.match(css, /\.et \.pr-sheet \.pr-unit\{break-inside:avoid/);
  assert.match(css, /\.et \.rp-picked\.print\.full \.rp-group\{break-inside:auto\}/);
  assert.match(css, /@media print\{[\s\S]*\.et \.pr-detail \.recruit a\{display:none\}/);
});

test("상세 카드 안에는 접힌 설명(details·접기 단추)이 없다 — 2페이지 펼침·인쇄에서 설명이 모두 보인다", () => {
  for (const f of ["../src/app/admissions/possibilities/parts.tsx", "../src/app/admissions/possibilities/recruit-parts.tsx", "../src/components/school-reflected.tsx"]) {
    assert.doesNotMatch(code(src(f)), /<details|<summary|useState/, f);
  }
  // 받기 훅(useOfferingExtras)은 상태를 쓰지만, 그리는 부분(ExtrasBody)에는 접기가 없다
  const body = code(src("../src/app/admissions/possibilities/offering-extras.tsx"));
  assert.doesNotMatch(body.slice(body.indexOf("export function ExtrasBody")), /<details|<summary|useState/);
  // 인쇄에서는 전체 위치 설명('이 숫자는 어떻게 계산했나요?')도 펼친다
  assert.match(src("../src/app/reports/me/print/page.tsx"), /<OverallCard a=\{a\} fold=\{false\} \/>/);
  // 개인용 가채점 인쇄는 단일 대표값(2026-11-24 담당자) — 범위 설명 접기 자체가 없다
  assert.match(src("../src/app/reports/me/print/page.tsx"), /<ProvisionalOverallCard a=\{a\} fold=\{false\} single \/>/);
});

test("전문가용 학생 인쇄: 인쇄본을 만들 때 상세 자료까지 받아, 담은 학교마다 한 줄 아래에 상세를 펼친 채로", () => {
  const sheet = code(src("../src/app/pro/students/[studentId]/print/print-sheet.tsx"));
  assert.match(sheet, /loadProPrintExtras\(items\)/);
  assert.match(sheet, /<tbody key=\{id\} className="pr-unit">/);
  assert.match(sheet, /<PrintDetail o=\{o\} a=\{x \?\? null\} extras=\{state\.extras\[id\]\}/);
  assert.match(sheet, /<ProvisionalOverallCard a=\{a\} fold=\{false\} \/>/);
  assert.match(src("../src/app/pro/students/[studentId]/print/page.tsx"), /import "@\/app\/admissions\/possibilities\/possibilities\.css";\s*import "..\/..\/..\/..\/reports\/me\/report\.css";/);
  const act = code(src("../src/app/pro/students/[studentId]/print/print-extras-action.ts"));
  assert.match(act, /^\s*"use server";/);
  assert.match(act, /\.slice\(0, PRINT_MAX\)/);
  assert.match(act, /loadPrintExtras\(source\(\), await getCaller\(\), /);
  // 학생 성적·리포트는 이 동작으로 보내지 않는다(모집단위 번호·대학 이름만)
  assert.doesNotMatch(act, /exportReport|readReport|scores/);
});

test("전문가용 학생용 인쇄(2026-11-27 대표님): 수능 판정 리포트는 개인용 학생용 인쇄본과 같은 부품(조합별 점수·위치 그래프·핵심 지원 학교 표·학교별 상세)", () => {
  const sheet = code(src("../src/app/pro/students/[studentId]/print/print-sheet.tsx"));
  assert.match(sheet, /const csatStudent = !teacher && isCsatJudgedOverall\(a\)/);
  assert.match(sheet, /<CsatPickedTable items=\{pickedList\}/);
  assert.match(sheet, /<CsatPickedDetails items=\{pickedList\}[^>]*wrap=\{\(s, detail\) => <PrintDetail o=\{s\.offering!\} a=\{s\.assessment\} extras=\{state\.extras\[s\.offering_id\]\} csat=\{detail\} \/>\}/);
  assert.match(sheet, /\{!teacher && <ProvisionalComboScores a=\{a\} \/>\}/);
  assert.match(sheet, /\{!teacher && <ProvisionalPositionChart a=\{a\} \/>\}/);
  // 판정은 ③과 같은 전문가용 서버 판정(학생·기관 권한은 서버가 다시 확인)
  const act = code(src("../src/app/pro/students/[studentId]/print/print-extras-action.ts"));
  assert.match(act, /const got = await loadProForAction\(caller, org, student, report\);/);
  assert.match(act, /proP4\(caller, got\.view, \{ offering_ids: want \}\)/);
});

test("개인용 가채점 단일 대표값(2026-11-24 담당자): 내 성적·리포트·인쇄는 single, 전문가용은 범위 그대로", () => {
  for (const f of ["../src/app/reports/me/page.tsx", "../src/app/reports/me/final/page.tsx", "../src/app/reports/me/print/page.tsx"]) {
    const s = src(f);
    for (const c of ["ProvisionalOverallCard", "ProvisionalSubjectsSheet", "ProvisionalComboScores", "ProvisionalPositionChart"]) {
      assert.match(s, new RegExp("<" + c + " a=\{a\}[^>]* single />"), f + " " + c);
    }
  }
  for (const f of ["../src/app/pro/students/[studentId]/student-view.tsx", "../src/app/pro/students/[studentId]/print/print-sheet.tsx"]) {
    assert.doesNotMatch(src(f), / single \/>/, f);
  }
});
