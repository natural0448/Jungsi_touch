import test from "node:test";
import assert from "node:assert/strict";
const { parseAdigaFill, applyAdigaFill, ADIGA_FILL_FORMAT } = await import("../src/lib/p1-adiga-fill.ts");
const { publishedStats } = await import("../src/lib/p1-published-stats.ts");

const empty = (r = "MULTIPLE_SAME_PRIORITY_BASIS_DEFINITIONS_UNRESOLVED") => ({ v: null, s: "pending_metadata", r, u: null, l: null });
const row = (y, pk, extra = {}) => ({
  y, pk, ob: null, n: "가야대학교", d: "간호학과", t: "수능(일반전형)", g: "다", c: null, rg: "경남", idv: 0,
  rc: empty(), cr: empty(), ad: empty(), rk: empty(), c50: empty(), c70: empty(), alt: { s: "pending", r: null, om: 0, e: [] }, ...extra,
});
const doc = (cells) => JSON.stringify({ format: ADIGA_FILL_FORMAT, cells });

test("가야대 간호 2026: 빈 50%·70%컷을 대학어디가 값으로 채우고 ①② 에 보인다", () => {
  const fill = parseAdigaFill(doc({ "2026|1000006263|50%컷": "652", "2026|1000006263|70%컷": "642.5" }));
  const [r] = applyAdigaFill([row(2026, "1000006263")], fill);
  assert.equal(r.c50.v, "652");
  assert.equal(r.c70.v, "642.5");
  const [a, b] = publishedStats(r);
  assert.deepEqual([a.label, a.cell.v, b.label, b.cell.v], ["50%컷", "652", "70%컷", "642.5"]);
});

test("이미 보이는 값은 바꾸지 않고, 원래 행 객체도 바꾸지 않는다", () => {
  const shown = { v: "646.5", s: "pending_metadata", r: null, u: null, l: "50%컷", b: "대학 환산점수", co: "final_registrants" };
  const orig = row(2025, "1000006263", { c50: shown });
  const fill = parseAdigaFill(doc({ "2025|1000006263|50%컷": "999", "2025|1000006263|70%컷": "648.5" }));
  const [r] = applyAdigaFill([orig], fill);
  assert.equal(r.c50.v, "646.5");
  assert.equal(r.c70.v, "648.5");
  assert.equal(orig.c70.v, null);
});

test("같은 이름·같은 기준 값이 이미 다른 칸에 있으면 채우지 않는다(화면이 둘 다 숨기므로)", () => {
  const alt = { s: "x", r: null, om: 0, e: [{ v: "700", s: "x", r: null, u: null, l: "70%컷", b: "대학 환산점수" }] };
  const [r] = applyAdigaFill([row(2024, "1"), row(2024, "2", { alt })], parseAdigaFill(doc({ "2024|2|70%컷": "701" })));
  assert.equal(r.c70.v, null);
  const [, r2] = applyAdigaFill([row(2024, "1"), row(2024, "2", { alt })], parseAdigaFill(doc({ "2024|2|70%컷": "701" })));
  assert.equal(r2.c70.v, null);
});

test("2027 행·PK 없는 행은 건드리지 않는다", () => {
  const fill = parseAdigaFill(doc({ "2026|5|50%컷": "1" }));
  const rows = [row(2027, "5"), row(2026, null)];
  assert.deepEqual(applyAdigaFill(rows, fill), rows);
});

test("표 형식이 하나라도 어긋나면 표 전체를 쓰지 않는다", () => {
  assert.equal(parseAdigaFill(null), null);
  assert.equal(parseAdigaFill("not json"), null);
  assert.equal(parseAdigaFill(JSON.stringify({ format: "other", cells: { "2026|1|50%컷": "1" } })), null);
  assert.equal(parseAdigaFill(doc({ "2026|1|50%컷": "1,000" })), null);
  assert.equal(parseAdigaFill(doc({ "2023|1|50%컷": "1" })), null);
  assert.equal(parseAdigaFill(doc({ "2026|1|80%컷": "1" })), null);
  assert.equal(parseAdigaFill(doc({})), null);
  assert.equal(parseAdigaFill(doc({ "2026|1|70%컷": "642.5" })).get("2026|1|70%컷"), "642.5");
});

test("원문으로 확인된 최종 합격 예비번호(ranks)는 예비번호·충원 칸이 모두 빈 행에만 채운다(2026-11-19)", () => {
  const text = JSON.stringify({ format: ADIGA_FILL_FORMAT, cells: { "2026|1|50%컷": "600" }, ranks: { "2024|1000000501|수능(일반전형)|다": "13" } });
  const fill = parseAdigaFill(text);
  const [r] = applyAdigaFill([row(2024, "1000000501")], fill);
  assert.equal(r.rk.v, "13");
  assert.equal(r.rk.u, "번");
  // 이미 값이 있으면, 다른 전형·군이면 채우지 않는다
  const [kept] = applyAdigaFill([row(2024, "1000000501", { ad: { ...empty(), v: "5", u: "명" } })], fill);
  assert.equal(kept.rk.v, null);
  const [other] = applyAdigaFill([row(2024, "1000000501", { g: "나" })], fill);
  assert.equal(other.rk.v, null);
  // ranks 형식이 어긋나면 표 전체를 쓰지 않는다
  for (const bad of [{ "2024|1|x|라": "1" }, { "2024|1|x|다": "0" }, { "2024|1|x|다": 3 }, []]) {
    assert.equal(parseAdigaFill(JSON.stringify({ format: ADIGA_FILL_FORMAT, cells: { "2026|1|50%컷": "600" }, ranks: bad })), null);
  }
});
