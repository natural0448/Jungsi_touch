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

test("원문으로 확인된 최종 합격 예비번호(ranks)는 예비번호 칸이 비어 있으면 같은 PK·전형·군에서 채운다", () => {
  const text = JSON.stringify({ format: ADIGA_FILL_FORMAT, cells: { "2026|1|50%컷": "600" }, ranks: { "2024|1000000501|수능(일반전형)|다": "13" } });
  const fill = parseAdigaFill(text);
  const [r] = applyAdigaFill([row(2024, "1000000501")], fill);
  assert.equal(r.rk.v, "13");
  assert.equal(r.rk.u, "번");
  // 기존 실제 인원은 보존하고, 다른 전형·군에는 붙이지 않는다
  const [kept] = applyAdigaFill([row(2024, "1000000501", { ad: { ...empty(), v: "5", u: "명" } })], fill);
  assert.equal(kept.rk.v, "13");
  assert.equal(kept.ad.v, "5");
  const [other] = applyAdigaFill([row(2024, "1000000501", { g: "나" })], fill);
  assert.equal(other.rk.v, null);
  // ranks 형식이 어긋나면 표 전체를 쓰지 않는다
  for (const bad of [{ "2024|1|x|라": "1" }, { "2024|1|x|다": "0" }, { "2024|1|x|다": 3 }, []]) {
    assert.equal(parseAdigaFill(JSON.stringify({ format: ADIGA_FILL_FORMAT, cells: { "2026|1|50%컷": "600" }, ranks: bad })), null);
  }
});

test("대학어디가 충원인원(fills, 0 포함)은 별도의 빈 인원 칸에 '명'으로 채운다", () => {
  const k = "2025|1000000777|수능(일반전형)|다";
  const fill = parseAdigaFill(JSON.stringify({ format: ADIGA_FILL_FORMAT, cells: { "2026|1|50%컷": "600" }, fills: { [k]: "7", "2025|1000000778|수능(일반전형)|다": "0" } }));
  const [a, b] = applyAdigaFill([row(2025, "1000000777"), row(2025, "1000000778")], fill);
  assert.equal(a.ad.v, "7");
  assert.equal(a.ad.u, "명");
  assert.equal(b.ad.v, "0");
  const both = parseAdigaFill(JSON.stringify({ format: ADIGA_FILL_FORMAT, cells: { "2026|1|50%컷": "600" }, ranks: { [k]: "13" }, fills: { [k]: "7" } }));
  const [c] = applyAdigaFill([row(2025, "1000000777")], both);
  assert.equal(c.rk.v, "13");
  assert.equal(c.ad.v, "7");
  assert.equal(c.ad.u, "명");
  assert.equal(parseAdigaFill(JSON.stringify({ format: ADIGA_FILL_FORMAT, cells: { "2026|1|50%컷": "600" }, fills: { [k]: "-1" } })), null);
});

test("미발표 코드·'가군' 표기·성적 stats·3인 이하 미발표(2026-11-19 밤)", async () => {
  const { FILL_UNDISCLOSED, STATS_LE3 } = await import("../src/lib/p1-adiga-fill.ts");
  const text = JSON.stringify({
    format: ADIGA_FILL_FORMAT, cells: { "2026|1|50%컷": "600" },
    fills: { "2025|11|수능(일반전형)|다": "undisclosed", "2025|12|수능(일반전형)|가": "9" },
    stats: { "2025|11|수능(일반전형)|다": [{ label: "50%컷", value: "788", basis: "대학 환산점수" }], "2025|13|수능(일반전형)|다": "le3" },
  });
  const fill = parseAdigaFill(text);
  assert.ok(fill);
  const [a, b, c] = applyAdigaFill([row(2025, "11"), row(2025, "12", { g: "가군" }), row(2025, "13")], fill);
  assert.equal(a.ad.v, null);
  assert.equal(a.ad.r, FILL_UNDISCLOSED);
  assert.equal(a.c50.v, "788");
  assert.equal(b.ad.v, "9");
  assert.equal(c.c50.r, `${STATS_LE3}:le3`);
  assert.equal(c.c50.v, null);
  // 모르는 지표 이름·잘못된 코드는 표 전체를 버린다
  for (const bad of [{ fills: { "2025|11|x|다": "none" } }, { stats: { "2025|11|x|다": [{ label: "상위평균", value: "1", basis: "대학 환산점수" }] } }, { stats: { "2025|11|x|다": [{ label: "평균", value: "1", basis: "학생부" }] } }, { stats: { "2025|11|x|다": "le4" } }]) {
    assert.equal(parseAdigaFill(JSON.stringify({ format: ADIGA_FILL_FORMAT, cells: { "2026|1|50%컷": "600" }, ...bad })), null);
  }
});

test("성적 사유 코드(모집 없음 등)와 50·70%컷 밖 지표(평균·90%컷)는 대체 통계로(2026-11-20)", async () => {
  const { STATS_LE3, STATS_CODE_TEXT } = await import("../src/lib/p1-adiga-fill.ts");
  const fill = parseAdigaFill(JSON.stringify({
    format: ADIGA_FILL_FORMAT, cells: { "2026|1|50%컷": "600" },
    stats: {
      "2026|21|수능(일반전형)|다": "no_recruit",
      "2026|22|수능(일반전형)|다": [{ label: "평균", value: "79.4", basis: "대학 환산점수" }],
      "2026|23|수능(일반전형)|다": [{ label: "50%컷", value: "95", basis: "수능 백분위(대학 반영 방식)" }, { label: "90%컷", value: "91", basis: "수능 백분위(대학 반영 방식)" }],
    },
  }));
  assert.ok(fill);
  const [a, b, c] = applyAdigaFill([row(2026, "21"), row(2026, "22"), row(2026, "23")], fill);
  assert.equal(a.c50.r, `${STATS_LE3}:no_recruit`);
  assert.equal(STATS_CODE_TEXT.no_recruit, "모집 없음");
  assert.equal(b.alt.e.at(-1).l, "평균");
  assert.equal(publishedStats(b)[0].label, "평균");
  assert.equal(c.c50.v, "95");
  assert.equal(c.c50.b, "대학 반영 백분위");
  const [one, two] = publishedStats(c);
  assert.equal(one.cell.v, "95");
  assert.equal(two.label, "90%컷");
});

test("정본이 공식 미발표(not_published)인 충원 칸에는 KV 숫자를 붙이지 않는다(2026-11-20 담당자 v46 검토)", () => {
  const key = "2025|900|수능(일반전형)|다";
  const fill = parseAdigaFill(JSON.stringify({ format: ADIGA_FILL_FORMAT, cells: { "2025|900|50%컷": "1.0" }, fills: { [key]: "7" } }));
  const nope = { v: null, s: "not_published", r: null, u: null, l: null };
  const official = row(2025, 900, { ad: nope });
  const [o] = applyAdigaFill([official], fill);
  assert.equal(o.ad.v, null);
  assert.equal(o.ad.s, "not_published");
  // 사유가 없는 빈 칸에는 그대로 붙는다
  const [p] = applyAdigaFill([row(2025, 900)], fill);
  assert.equal(p.ad.v, "7");
});

test("담당자 회신12 확인 충원 인원(confirmed): 정본 값과 같을 때만 확인된 실제 충원 인원으로 올리고, 다르면 그대로", () => {
  const doc = JSON.stringify({ format: ADIGA_FILL_FORMAT, cells: { "2024|1|50%컷": "1" }, confirmed: { "2024|1000002513|수능(일반학생전형)|다": "37" } });
  const fill = parseAdigaFill(doc);
  const cell = (v, s = "pending_metadata") => ({ v, s, r: "SOURCE_DEFINITION_UNIT_OR_QUALIFICATION_PENDING", u: "명", l: "충원 합격 인원", at: null, ctx: null });
  const none = { v: null, s: "pending_value_missing", r: null, u: null, l: null, at: null, ctx: null };
  const row = (ad) => ({ y: 2024, pk: "1000002513", t: "수능(일반학생전형)", g: "다", rk: none, ad, c50: { ...none, v: "x" }, c70: { ...none, v: "x" }, alt: { e: [] } });
  const [same] = applyAdigaFill([row(cell("37"))], fill);
  assert.equal(same.ad.s, "screen_adiga_fill");
  assert.equal(same.ad.l, "충원인원");
  assert.equal(same.ad.v, "37");
  const [diff] = applyAdigaFill([row(cell("36"))], fill);
  assert.equal(diff.ad.s, "pending_metadata");
  assert.equal(parseAdigaFill(JSON.stringify({ format: ADIGA_FILL_FORMAT, cells: { "2024|1|50%컷": "1" }, confirmed: { "2024|1|x|다": "3.5" } })), null);
});
