import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// 2026-11-28 담당자 회신 30: 묶음 교체 표시(KV jt:csat-cache-epoch) 세 사례를 실제 report-ops 코드로 확인한다.
//  ① 같은 리포트·프로필·표시면 다시 쓰고, 표시가 바뀌면 3페이지 후보·4페이지 판정·4페이지 전국 훑기 세 경로가 모두 새로 받는다
//  ② 3페이지 계산 중 표시가 바뀌어도 그 결과는 새 표시 열쇠로 저장되지 않는다
//  ③ KV 를 못 읽으면 재사용·저장을 건너뛰고(요청은 1.5초 안에 끝남), 회복하면 재사용이 돌아온다
const data = (code) => "data:text/javascript," + encodeURIComponent(code);
const classesUrl = new URL("../src/lib/api/source.ts", import.meta.url).href;
const mocks = new Map([
  ["server-only", data("export {}")],
  ["@opennextjs/cloudflare", data("export async function getCloudflareContext(){return {env:{JT_SHARED_CACHE:{get:(k,o)=>globalThis.__epochKv(k,o)}}}}")],
  ["@/lib/api", data(`export {AccessDenied, ConnectionError} from ${JSON.stringify(classesUrl)};`)],
  ["@/lib/report-pure", new URL("../src/lib/report-pure.ts", import.meta.url).href],
  ["@/lib/candidate-eligibility", new URL("../src/lib/candidate-eligibility.ts", import.meta.url).href],
  ["@/lib/report-ref", data("export async function currentReportId(){return null};export const screenReport=(c,r)=>r;")],
  ["@/lib/connection-text", new URL("../src/lib/connection-text.ts", import.meta.url).href],
  ["./format", new URL("../src/lib/format.ts", import.meta.url).href],
  ["next/cache", data("export function revalidatePath(){}")],
]);
registerHooks({
  resolve(spec, ctx, next) {
    if (mocks.has(spec)) return next(mocks.get(spec), ctx);
    if (spec.startsWith(".") && !/\.[a-z]+$/.test(spec) && ctx.parentURL?.endsWith(".ts")) return { url: new URL(spec + ".ts", ctx.parentURL).href, shortCircuit: true };
    return next(spec, ctx);
  },
});

// 시계: 표시 기억(30초·실패 1초)을 넘기려고 Date.now 만 앞당긴다
let offset = 0;
const realNow = Date.now.bind(Date);
Date.now = () => realNow() + offset;
const advance = (ms) => { offset += ms; };
const EPOCH_TTL = 30_001;

let kvGet = async () => "E1";
let kvReads = 0;
globalThis.__epochKv = (k, o) => {
  kvReads++;
  assert.equal(k, "jt:csat-cache-epoch");
  assert.equal(o?.type, "text");
  return kvGet();
};
const setEpoch = (v) => { kvGet = async () => v; advance(EPOCH_TTL); };

const ops = await import("../src/lib/report-ops.ts");
const caller = { accessToken: "synthetic-port-only" };
const prov = (id, v = 3) => ({ report_id: id, report_version: v, profile_id: "p1", overall: { input_kind: "provisional_raw", score_basis: "provisional_estimate" }, analyses: {} });
const band = { basis: "reference_threshold", code: "stable", label: "x", source: "g" };
const groups = [{ university_id: "u", university_name: "u", offerings: [{ offering: { offering_id: "2027:1" }, reference_band: band }] }];

function p4Port() {
  const calls = [];
  return { calls, src: {
    async analyzeUniversities(_c, id, ver) { calls.push("ua"); return { ok: true, value: { ...prov(id, ver), candidates: { reference_university_groups: groups } } }; },
    async scanUniversities(_c, id, ver) {
      calls.push("scan");
      return { ok: true, value: { ...prov(id, ver), candidates: { reference_university_groups: groups,
        status_scan: { offerings: [{ offering_id: "2027:1" }], matched: 1, next_after: null, complete: true } } } };
    },
  } };
}
function p3Port(report, during = () => {}) {
  const calls = [];
  const lists = { reference_university_groups: groups, reference_threshold_summary: { complete: true } };
  const built = { ...report, report_version: report.report_version + 1, candidates: { status: "ready", reason_code: null, basic_university_groups: [], wildcards: [], ...lists } };
  return { calls, built, src: {
    async buildCandidates() { calls.push("cb"); await during(); return { ok: true, value: built }; },
    async readReport() { calls.push("read"); return built; },
  } };
}
const p3Base = (id) => ({ ...prov(id, 5), candidates: { status: "ready", reason_code: null, basic_university_groups: [], wildcards: [] } });
const scanReq = { stage: "stable", limit: 20 };

test("① 같은 표시면 세 경로 모두 다시 쓰고, 표시를 바꾸면 세 경로 모두 새로 받는다", async () => {
  setEpoch("E1");
  // 4페이지 개별 판정
  const p4 = p4Port();
  await ops.provisionalBands(p4.src, caller, prov("c1-p4"), ["2027:1"]);
  await ops.provisionalBands(p4.src, caller, prov("c1-p4"), ["2027:1"]);
  assert.deepEqual(p4.calls, ["ua"]);
  // 4페이지 전국 훑기
  await ops.provisionalScan(p4.src, caller, prov("c1-scan"), scanReq);
  await ops.provisionalScan(p4.src, caller, prov("c1-scan"), scanReq);
  assert.deepEqual(p4.calls, ["ua", "scan"]);
  // 3페이지 후보
  const base = p3Base("c1-p3");
  const p3 = p3Port(base);
  await ops.settleCandidates(p3.src, caller, base, { shared: true });
  await ops.settleCandidates(p3.src, caller, { ...p3.built, candidates: base.candidates }, { shared: true });
  assert.deepEqual(p3.calls, ["cb", "read"]);

  setEpoch("E2");
  await ops.provisionalBands(p4.src, caller, prov("c1-p4"), ["2027:1"]);
  await ops.provisionalScan(p4.src, caller, prov("c1-scan"), scanReq);
  assert.deepEqual(p4.calls, ["ua", "scan", "ua", "scan"]);
  await ops.settleCandidates(p3.src, caller, { ...p3.built, candidates: base.candidates }, { shared: true });
  assert.deepEqual(p3.calls, ["cb", "read", "cb", "read"]);
  // 새 표시에서도 두 번째부터는 다시 쓴다
  await ops.provisionalBands(p4.src, caller, prov("c1-p4"), ["2027:1"]);
  await ops.provisionalScan(p4.src, caller, prov("c1-scan"), scanReq);
  await ops.settleCandidates(p3.src, caller, { ...p3.built, candidates: base.candidates }, { shared: true });
  assert.deepEqual(p4.calls, ["ua", "scan", "ua", "scan"]);
  assert.deepEqual(p3.calls, ["cb", "read", "cb", "read"]);
});

test("② 3페이지 계산 중 표시가 바뀌면 그 결과는 새 표시 열쇠로 쓰이지 않는다", async () => {
  setEpoch("F1");
  const base = p3Base("c2-p3");
  // 계산 도중(서버 응답 전)에 운영자가 표시를 F2 로 바꾸고 30초가 지난 상황
  const p3 = p3Port(base, async () => { if (p3.calls.length === 1) setEpoch("F2"); });
  await ops.settleCandidates(p3.src, caller, base, { shared: true });
  assert.deepEqual(p3.calls, ["cb", "read"]);
  // 새 표시(F2)로 연 요청은 F1 계산 결과를 쓰지 않고 새로 받는다
  await ops.settleCandidates(p3.src, caller, { ...p3.built, candidates: base.candidates }, { shared: true });
  assert.deepEqual(p3.calls, ["cb", "read", "cb", "read"]);
  // F2 로 새로 받은 결과는 F2 에서 다시 쓴다
  await ops.settleCandidates(p3.src, caller, { ...p3.built, candidates: base.candidates }, { shared: true });
  assert.deepEqual(p3.calls, ["cb", "read", "cb", "read"]);
});

test("③ KV 를 못 읽으면 재사용·저장을 건너뛰고, 회복하면 재사용이 돌아온다", async () => {
  // 읽기 오류
  kvGet = async () => { throw new Error("kv down"); };
  advance(EPOCH_TTL);
  const p4 = p4Port();
  await ops.provisionalBands(p4.src, caller, prov("c3-p4"), ["2027:1"]);
  advance(1_001);
  await ops.provisionalBands(p4.src, caller, prov("c3-p4"), ["2027:1"]);
  assert.deepEqual(p4.calls, ["ua", "ua"]);
  const base = p3Base("c3-p3");
  const p3 = p3Port(base);
  advance(1_001);
  await ops.settleCandidates(p3.src, caller, base, { shared: true });
  advance(1_001);
  await ops.settleCandidates(p3.src, caller, { ...p3.built, candidates: base.candidates }, { shared: true });
  assert.deepEqual(p3.calls, ["cb", "read", "cb", "read"]);

  // 응답 없음: 1.5초에서 끊고 일반 조회로 진행
  kvGet = () => new Promise(() => {});
  advance(1_001);
  const t0 = performance.now();
  await ops.provisionalScan(p4.src, caller, prov("c3-scan"), scanReq);
  const waited = performance.now() - t0;
  assert.ok(waited >= 1_400 && waited < 2_500, `KV 무응답 대기 ${Math.round(waited)}ms`);
  advance(1_001);
  await ops.provisionalScan(p4.src, caller, prov("c3-scan"), scanReq);
  assert.deepEqual(p4.calls, ["ua", "ua", "scan", "scan"]);
  console.log(`# KV 무응답 때 늘어난 요청 시간 약 ${Math.round(waited)}ms`);

  // 회복: 첫 요청이 저장하고 다음 요청부터 다시 쓴다
  kvGet = async () => "G1";
  advance(1_001);
  await ops.provisionalBands(p4.src, caller, prov("c3-p4"), ["2027:1"]);
  await ops.provisionalBands(p4.src, caller, prov("c3-p4"), ["2027:1"]);
  await ops.provisionalScan(p4.src, caller, prov("c3-scan"), scanReq);
  await ops.provisionalScan(p4.src, caller, prov("c3-scan"), scanReq);
  assert.deepEqual(p4.calls, ["ua", "ua", "scan", "scan", "ua", "scan"]);
  await ops.settleCandidates(p3.src, caller, { ...p3.built, candidates: base.candidates }, { shared: true });
  await ops.settleCandidates(p3.src, caller, { ...p3.built, candidates: base.candidates }, { shared: true });
  assert.deepEqual(p3.calls, ["cb", "read", "cb", "read", "cb", "read"]);
});
