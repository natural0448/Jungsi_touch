import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";

// Execute the actual server helpers/actions. Only framework I/O and the API port
// are replaced; no source rewriting, install, credentials or network is used.
const opsUrl = new URL("../src/lib/report-ops.ts", import.meta.url).href;
const classesUrl = new URL("../src/lib/api/source.ts", import.meta.url).href;
const data = (code) => "data:text/javascript," + encodeURIComponent(code);
const apiUrl = data(`export {AccessDenied, ConnectionError} from ${JSON.stringify(classesUrl)};
export async function getCaller(){const f=globalThis.__reportOpsFixture;if(f.callerError)throw f.callerError;return f.caller}
export function source(){return globalThis.__reportOpsFixture.src}`);
const mocks = new Map([
  ["server-only", data("export {}")],
  ["@/lib/api", apiUrl],
  // 계정의 현재 리포트 번호(서버 입력 상태)만 대신한다. 브라우저 번호는 없다(2026-11-04)
  // report-ops 가 브라우저 화면과 함께 쓰는 읽기 전용 판단(2026-11-22 ship54 분리)
  ["@/lib/report-pure", new URL("../src/lib/report-pure.ts", import.meta.url).href],
  ["@/lib/report-ref", data("export const screenReport=(c,r)=>r;export async function currentReportId(){return globalThis.__reportOpsFixture.reportId}")],
  ["@/lib/report-ops", opsUrl],
  ["@/lib/connection-text", new URL("../src/lib/connection-text.ts", import.meta.url).href],
  // connection-text 가 시각 표시용으로 부르는 같은 폴더 모듈(429 안내, 2026-11-19)
  ["./format", new URL("../src/lib/format.ts", import.meta.url).href],
  ["next/cache", data("export function revalidatePath(...args){globalThis.__reportOpsFixture.revalidations.push(args)}")],
]);
registerHooks({ resolve(id, context, next) { return next(mocks.get(id) ?? id, context); } });
const { provisionalBands } = await import(opsUrl);

// 4페이지 수능 가채점 판정(서버 dep_r29, 2026-11-23): university.analyze 응답의 source g 판정만 모은다
const caller = { accessToken: "synthetic-port-only" };
const prov = (v = 3) => ({ report_id: "r1", report_version: v, profile_id: "p1", overall: { input_kind: "provisional_raw", score_basis: "provisional_estimate" } });
const row = (id, band) => ({ offering: { offering_id: id }, reference_band: band });
const g = (code, extra = {}) => ({ basis: "reference_threshold", code, label: "x", source: "g", ...extra });

test("provisionalBands: 요청한 모집단위의 source g 판정만, 쓴 뒤 판 번호와 함께", async () => {
  const calls = [];
  globalThis.__reportOpsFixture = { src: {
    async analyzeUniversities(_c, id, ver, ids, key) {
      calls.push({ id, ver, ids, key });
      return { ok: true, value: { ...prov(ver + 1), candidates: { reference_university_groups: [
        { university_id: "u", university_name: "u", offerings: [
          row("2027:1", g("target")), row("2027:2", g("stable", { upper_code: "target" })),
          row("2027:3", { ...g("target"), source: "a" }), row("2027:9", g("outside")), row("2027:4", { basis: "reference_percentile", code: "target" }),
        ] },
      ] } } };
    },
  } };
  const got = await provisionalBands(globalThis.__reportOpsFixture.src, caller, prov(), ["2027:2", "2027:1", "2027:3", "2027:4", "2027:2"]);
  assert.deepEqual(Object.keys(got.bands).sort(), ["2027:1", "2027:2"]);
  assert.equal(got.bands["2027:2"].upper_code, "target");
  assert.equal(got.version, 4);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].ids, ["2027:1", "2027:2", "2027:3", "2027:4"]);
  assert.match(calls[0].key, /^uap-/);
  // 같은 리포트·같은 묶음은 다시 보내지 않는다(15분)
  const again = await provisionalBands(globalThis.__reportOpsFixture.src, caller, prov(4), ["2027:1", "2027:2", "2027:3", "2027:4"]);
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(again.bands).sort(), ["2027:1", "2027:2"]);
  assert.equal(again.version, 4);
});

test("provisionalBands: 실패·9모 리포트·빈 요청은 빈 표(오류 화면 없음)", async () => {
  let n = 0;
  const src = {
    async analyzeUniversities() { n++; return { ok: false, code: "score_input_transition_pending", status: 503 }; },
    async readReport() { return null; },
  };
  const failed = await provisionalBands(src, caller, { ...prov(), report_id: "r2" }, ["2027:1"]);
  assert.deepEqual(failed, { bands: {}, version: 3 });
  const thrown = await provisionalBands({ async analyzeUniversities() { throw new Error("down"); } }, caller, { ...prov(), report_id: "r3" }, ["2027:1"]);
  assert.deepEqual(thrown.bands, {});
  const mock = await provisionalBands(src, caller, { report_id: "r4", report_version: 1, profile_id: "p", overall: { input_kind: "raw", score_basis: "mock" } }, ["2027:1"]);
  assert.deepEqual(mock.bands, {});
  const empty = await provisionalBands(src, caller, { ...prov(), report_id: "r5" }, []);
  assert.deepEqual(empty.bands, {});
  assert.equal(n, 1);
});
