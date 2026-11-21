import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// 현재 리포트 미리 읽기(2026-11-10 임시 단축). 실제 report-ops 를 돌리고 API 포트와 입력 상태만 대신한다.
const opsUrl = new URL("../src/lib/report-ops.ts", import.meta.url).href;
const classesUrl = new URL("../src/lib/api/source.ts", import.meta.url).href;
const data = (code) => "data:text/javascript," + encodeURIComponent(code);
const mocks = new Map([
  ["server-only", data("export {}")],
  ["@/lib/api", data(`export {AccessDenied, ConnectionError} from ${JSON.stringify(classesUrl)};`)],
  // 입력 상태의 현재 리포트 번호. 기다리는 동안 리포트 읽기가 이미 나갔는지 보려고 풀어 주는 시점을 시험이 정한다
  ["@/lib/report-ref", data("export const screenReport=(c,r)=>r;export async function currentReportId(){return globalThis.__hintFixture.status()}")],
]);
registerHooks({ resolve(id, context, next) { return next(mocks.get(id) ?? id, context); } });
const { loadMineEager, loadMine } = await import(opsUrl);

function fixture(currentId) {
  const log = [];
  let release;
  const gate = new Promise((r) => (release = r));
  globalThis.__hintFixture = {
    status: async () => {
      log.push("status");
      await gate;
      return currentId;
    },
  };
  const src = {
    kind: "live",
    async readReport(_caller, id) {
      log.push(`report:${id}`);
      if (id === "GONE") throw new Error("synthetic stale hint failure");
      return { report_id: id };
    },
  };
  return { log, src, release };
}

const run = async (f, caller) => {
  const p = loadMineEager(f.src, caller);
  await new Promise((r) => setTimeout(r, 5)); // 입력 상태가 오기 전에 나간 요청을 본다
  const before = [...f.log];
  f.release();
  return { report: await p, before };
};

test("first visit has no hint: status first, then the report, and the id is remembered", async () => {
  const caller = { accessToken: "synthetic-token-A1" };
  const f = fixture("R1");
  const { report, before } = await run(f, caller);
  assert.deepEqual(before, ["status"]);
  assert.deepEqual(f.log, ["status", "report:R1"]);
  assert.equal(report.report_id, "R1");

  // 두 번째부터는 입력 상태와 리포트가 함께 나가고, 리포트는 한 번만 읽는다
  const g = fixture("R1");
  const second = await run(g, caller);
  assert.deepEqual([...second.before].sort(), ["report:R1", "status"]);
  assert.deepEqual([...g.log].sort(), ["report:R1", "status"]);
  assert.equal(second.report.report_id, "R1");
});

test("a changed current report (e.g. after a correction) discards the hint and reads the server's id", async () => {
  const caller = { accessToken: "synthetic-token-B1" };
  await run(fixture("OLD"), caller);
  const f = fixture("NEW");
  const { report } = await run(f, caller);
  assert.equal(report.report_id, "NEW");
  assert.deepEqual([...f.log].sort(), ["report:NEW", "report:OLD", "status"]);
  // 다음에는 새 번호가 힌트다
  const g = fixture("NEW");
  await run(g, caller);
  assert.deepEqual([...g.log].sort(), ["report:NEW", "status"]);
});

test("another login never sends the previous account's report id", async () => {
  await run(fixture("A-REPORT"), { accessToken: "synthetic-token-C1" });
  const f = fixture("B-REPORT");
  const { report, before } = await run(f, { accessToken: "synthetic-token-C2" });
  assert.deepEqual(before, ["status"]);
  assert.ok(!f.log.includes("report:A-REPORT"));
  assert.equal(report.report_id, "B-REPORT");
});

test("a failed stale prefetch is not shown; the right report is read", async () => {
  const caller = { accessToken: "synthetic-token-D1" };
  await run(fixture("GONE"), caller).catch(() => {}); // 첫 방문은 GONE 읽기가 실패(힌트만 남는다)
  const f = fixture("R2");
  const { report } = await run(f, caller);
  assert.equal(report.report_id, "R2");
});

test("no current report clears the hint", async () => {
  const caller = { accessToken: "synthetic-token-E1" };
  await run(fixture("R3"), caller);
  const f = fixture(null);
  assert.equal((await run(f, caller)).report, null);
  const g = fixture("R4");
  const { before } = await run(g, caller);
  assert.deepEqual(before, ["status"]);
});

test("page 3 and actions (loadMine) only remember the hint, they do not prefetch", async () => {
  const caller = { accessToken: "synthetic-token-F1" };
  await run(fixture("R5"), caller);
  const f = fixture("R5");
  const p = loadMine(f.src, caller);
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(f.log, ["status"]);
  f.release();
  assert.equal((await p).report_id, "R5");
});

test("no token, no hint", async () => {
  const f = fixture("R6");
  await run(f, { accessToken: null });
  const g = fixture("R6");
  const { before } = await run(g, { accessToken: null });
  assert.deepEqual(before, ["status"]);
});
