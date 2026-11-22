import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

/*
  3페이지 '9월 모의평가 기준으로 보기'(2026-11-22 대표님 결정).
  - 열 리포트 고르기: 주소의 report(목록에 있을 때만) → 마지막 9월 성적(is_current) → 가장 최근 저장
  - 거르기·펼치기 주소가 past·report 를 지켜 수능 가채점 화면으로 튀지 않는다
  - 읽기 전용: 담기 띠·담기 버튼·분석 계산을 두지 않는다
*/
const { choosePastReport } = await import("../src/lib/past-mock.ts");
const Q = await import("../src/app/admissions/favorable/query.ts");
const src = (f) => readFile(new URL(f, import.meta.url), "utf8");

const MOCK = "2027-september-mock";
const items = [
  { report_id: "old", exam_id: MOCK, report_version: 1, updated_at: "2026-09-10T01:00:00Z", is_current: false },
  { report_id: "cur", exam_id: MOCK, report_version: 3, updated_at: "2026-09-20T01:00:00Z", is_current: true },
  { report_id: "new", exam_id: MOCK, report_version: 2, updated_at: "2026-09-25T01:00:00Z", is_current: false },
  { report_id: "csat", exam_id: "2027-csat-provisional", report_version: 1, updated_at: "2026-11-20T01:00:00Z", is_current: true },
];

test("열 9월 리포트: 기본은 마지막 9월 성적(is_current), 없으면 가장 최근", () => {
  const r = choosePastReport(items, MOCK);
  assert.equal(r.chosen?.report_id, "cur");
  assert.deepEqual(r.items.map((i) => i.report_id), ["new", "cur", "old"], "9월 리포트만, 최근 저장 먼저");
  const noCur = choosePastReport(items.map((i) => ({ ...i, is_current: false })), MOCK);
  assert.equal(noCur.chosen?.report_id, "new");
});

test("열 9월 리포트: 주소의 report 는 목록에 있을 때만 연다", () => {
  assert.equal(choosePastReport(items, MOCK, "old").chosen?.report_id, "old");
  assert.equal(choosePastReport(items, MOCK, "csat").chosen?.report_id, "cur", "가채점 리포트 id 는 열지 않는다");
  assert.equal(choosePastReport(items, MOCK, "someone-else").chosen?.report_id, "cur", "목록에 없는 id 는 열지 않는다");
});

test("열 9월 리포트: 목록이 비거나 이상하면 null", () => {
  assert.equal(choosePastReport([], MOCK).chosen, null);
  assert.equal(choosePastReport(null, MOCK).chosen, null);
  assert.equal(choosePastReport(undefined, MOCK, "x").chosen, null);
  assert.equal(choosePastReport([items[3]], MOCK).chosen, null);
});

test("3페이지 주소: past·report 를 읽고, 거르기·펼치기에서 지킨다", () => {
  const cur = Q.parseQuery({ past: "1", report: "r-1", has: "core" });
  assert.equal(cur.past, true);
  assert.equal(cur.report, "r-1");
  assert.equal(Q.hrefWith(cur, { has: "room", open: undefined }), "/admissions/favorable?past=1&report=r-1&has=room");
  assert.equal(Q.hrefWith(cur, { open: "u1", field: "공학" }), "/admissions/favorable?past=1&report=r-1&has=core&open=u1&field=%EA%B3%B5%ED%95%99");
  assert.equal(Q.hrefWith(Q.parseQuery({ past: "1" }), { has: undefined }), "/admissions/favorable?past=1");
});

test("3페이지 주소: past 가 아니면 report 를 받지 않고, 지금 화면 주소는 그대로", () => {
  const cur = Q.parseQuery({ report: "r-1", has: "core" });
  assert.equal(cur.past, undefined);
  assert.equal(cur.report, undefined);
  assert.equal(Q.hrefWith(cur, {}), "/admissions/favorable?has=core");
  assert.equal(Q.hrefWith({}, {}), "/admissions/favorable");
  assert.equal(Q.parseQuery({ past: "1", report: "../x" }).report, undefined, "이상한 id 는 버린다");
});

test("9월 기준 보기 주소와 목록 열쇠", async () => {
  assert.equal(Q.pastFavorableHref(), "/admissions/favorable?past=1");
  assert.equal(Q.pastFavorableHref("r 2"), "/admissions/favorable?past=1&report=r+2");
  // 모드·리포트가 바뀌면 목록 열쇠(listKey)가 바뀌어 책 넘김 대기 화면을 다시 보인다 — open 만 빼고 모든 조건이 열쇠에 든다
  const q = await src("../src/app/admissions/possibilities/query.ts");
  assert.match(q, /if \(k === "open" \|\| v === undefined\) continue;/);
});

test("9월 기준 보기는 읽기 전용이고 차분한 안내로 끝난다", async () => {
  const page = await src("../src/app/admissions/favorable/page.tsx");
  assert.match(page, /listOwnReports\(caller, \{ exam_id: MOCK_EXAM\.exam_id, limit: 20 \}\)/);
  assert.match(page, /choosePastReport\(list\?\.items, MOCK_EXAM\.exam_id, cur\.report\)/);
  assert.match(page, /isProvisionalOverall\(report\.overall\)/);
  assert.match(page, /\{!past && \(\s*<Suspense key=\{qk\} fallback=\{null\}>\s*<StreamTray/);
  assert.match(page, /canPick=\{!past\}/g);
  assert.equal((page.match(/canPick=\{!past\}/g) ?? []).length, 2, "학교 카드·와일드카드 둘 다");
  assert.match(page, /readOnly=\{!!past\}/);
  assert.match(page, /const wildPending = past \? \[\] :/);
  assert.match(page, /9월 기준 추천 목록을 지금 불러올 수 없습니다/);
  assert.match(page, /수능 가채점 기준으로 돌아가기/);
  assert.match(page, /9월 모의평가 기준 · 지난 기록 · 읽기 전용/);
  const card = await src("../src/app/admissions/favorable/school-card.tsx");
  assert.match(card, /\{canPick && <PickButton/);
  const groups = await src("../src/app/admissions/favorable/reference-groups.tsx");
  assert.match(groups, /pendingIds=\{readOnly \? \[\] :/);
});
