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
  ["@/lib/report-ref", data("export async function currentReportId(){return globalThis.__reportOpsFixture.reportId}")],
  ["@/lib/report-ops", opsUrl],
  ["@/lib/connection-text", new URL("../src/lib/connection-text.ts", import.meta.url).href],
  ["next/cache", data("export function revalidatePath(...args){globalThis.__reportOpsFixture.revalidations.push(args)}")],
]);
registerHooks({ resolve(id, context, next) { return next(mocks.get(id) ?? id, context); } });
const { ensureAnalyses, ensureCandidates, togglePickOn, loadMine, canonicalOfferingIds } = await import(opsUrl);
const { analyzeNow, buildNow } = await import("../src/app/analysis-actions.ts");
const { AccessDenied, ConnectionError } = await import(classesUrl);

const caller = { accessToken: "synthetic-port-only" };
const conflict = () => ({ ok: false, code: "revision_conflict", status: 409 });
const saved = { qualification: { status: "eligible" }, score: { converted_score: 0 } };
const pending = { qualification: { status: "pending", reason: "synthetic_missing" }, score: null };
const candidates = { basic_university_groups: [], wildcards: [], pending_offerings: [{ offering_id: "C" }] };
function report(patch = {}) {
  return { report_id: "synthetic-report-A", report_version: 7, analyses: {}, candidates: null, shortlist: {}, ...patch };
}
function fixture(initial = report(), options = {}) {
  const f = { caller, reportId: initial?.report_id ?? null, report: initial, calls: [], revalidations: [], reads: [], writes: [], ...options };
  function write(op, args) {
    f.calls.push({ op, args });
    const res = f.writes.shift();
    if (res instanceof Error) throw res;
    return res ?? { ok: true, value: report({ ...initial, report_version: args[2] + 1 }) };
  }
  f.src = {
    async readReport(...args) { f.calls.push({ op: "read", args }); return f.reads.length ? f.reads.shift() : f.report; },
    async analyzeUniversities(...args) { return write("ua", args); },
    async buildCandidates(...args) { return write("cb", args); },
    async updateShortlist(...args) { return write("sl", args); },
  };
  globalThis.__reportOpsFixture = f;
  return f;
}
const writes = (f, op = "ua") => f.calls.filter((c) => c.op === op);
const reads = (f) => f.calls.filter((c) => c.op === "read");
const form = (ids) => { const fd = new FormData(); fd.set("ids", ids); return fd; };
const invoke = (f, ids = ["B", "A"]) => ensureAnalyses(f.src, caller, f.report, ids);
const expectedKey = (prefix, r, body) => `${prefix}-${createHash("sha256").update(JSON.stringify([prefix, r.report_id, r.report_version, body])).digest("hex")}`;

test("ID canonicalization removes blanks/duplicates and uses stable lexical order", () => {
  assert.deepEqual(canonicalOfferingIds([" B ", "A", "", "B", "A"]), ["A", "B"]);
});
test("empty analysis intent sends no POST", async () => {
  const f = fixture(); assert.equal((await invoke(f, [])).kind, "ready"); assert.equal(f.calls.length, 0);
});
test("saved zero and pending analyses are both preserved without recomputation", async () => {
  const f = fixture(report({ analyses: { A: saved, C: pending } }));
  const out = await invoke(f, ["C", "A"]); assert.equal(out.report, f.report); assert.equal(f.calls.length, 0);
  assert.equal(out.report.analyses.A.score.converted_score, 0); assert.equal(out.report.analyses.C, pending);
});
test("actual POST body is the canonical missing set and key hashes that exact body", async () => {
  const f = fixture(report({ analyses: { C: pending } })); await invoke(f, ["B", "C", " A ", "B"]);
  const args = writes(f)[0].args; assert.deepEqual(args.slice(0, 4), [caller, f.report.report_id, 7, ["A", "B"]]);
  assert.equal(args[4], expectedKey("ua", f.report, { expected_version: 7, offering_ids: ["A", "B"] }));
  assert.match(args[4], /^[A-Za-z0-9._:-]{1,128}$/);
});
test("100-ID bound is applied after deduplication and saved-analysis exclusion", async () => {
  const f = fixture(report({ analyses: { A: saved } }));
  await invoke(f, [...Array(150).fill("A"), ...Array.from({ length: 105 }, (_, i) => `X${String(i).padStart(3, "0")}`)]);
  assert.equal(writes(f)[0].args[3].length, 100); assert.equal(writes(f)[0].args[3][0], "X000");
});
test("conflict reread with all targets already saved sends no second POST", async () => {
  const fresh = report({ report_version: 8, analyses: { A: saved, B: pending } });
  const f = fixture(report(), { writes: [conflict()], reads: [fresh] });
  const out = await invoke(f); assert.equal(out.report, fresh); assert.equal(writes(f).length, 1); assert.equal(reads(f).length, 1);
});
test("conflict reread recomputes only remaining IDs and binds new revision/body", async () => {
  const fresh = report({ report_version: 8, analyses: { A: saved } });
  const f = fixture(report(), { writes: [conflict()], reads: [fresh] }); await invoke(f);
  const args = writes(f)[1].args; assert.equal(args[2], 8); assert.deepEqual(args[3], ["B"]);
  assert.equal(args[4], expectedKey("ua", fresh, { expected_version: 8, offering_ids: ["B"] }));
  assert.notEqual(args[4], writes(f)[0].args[4]);
});
test("two conflicts return failed, with exactly two POSTs and one reread", async () => {
  const fresh = report({ report_version: 8 }); const f = fixture(report(), { writes: [conflict(), conflict()], reads: [fresh] });
  assert.deepEqual(await invoke(f), { kind: "failed", report: fresh, code: "revision_conflict" });
  assert.equal(writes(f).length, 2); assert.equal(reads(f).length, 1);
});
test("report disappearance during conflict is none, without second POST", async () => {
  const f = fixture(report(), { writes: [conflict()], reads: [null] });
  assert.equal((await invoke(f)).kind, "none"); assert.equal(writes(f).length, 1);
});
for (const code of ["score_confirmation_required", "forbidden", "invalid_request"]) {
  test(`${code} preserves failure and does not retry`, async () => {
    const f = fixture(report(), { writes: [{ ok: false, code, status: 403 }] }); const out = await invoke(f);
    assert.equal(out.kind, code === "score_confirmation_required" ? "score_required" : "failed");
    assert.equal(writes(f).length, 1); assert.equal(reads(f).length, 0);
  });
}
for (const c of [candidates, { ...candidates, pending_offerings: [] }]) {
  test(`stored candidates are not rebuilt (pending=${c.pending_offerings.length})`, async () => {
    const f = fixture(report({ candidates: c })); assert.equal((await ensureCandidates(f.src, caller, f.report)).report, f.report);
    assert.equal(f.calls.length, 0);
  });
  test(`candidates saved during conflict are not rebuilt (pending=${c.pending_offerings.length})`, async () => {
    const fresh = report({ report_version: 8, candidates: c }); const f = fixture(report(), { writes: [conflict()], reads: [fresh] });
    assert.equal((await ensureCandidates(f.src, caller, f.report)).report, fresh); assert.equal(writes(f, "cb").length, 1);
  });
}
test("candidate creation with no stored result calls only its own operation", async () => {
  const f = fixture(); await ensureCandidates(f.src, caller, f.report);
  const args = writes(f, "cb")[0].args; assert.equal(args[3], expectedKey("cb", f.report, { expected_version: 7 }));
  assert.equal(writes(f).length, 0);
});
test("candidate second conflict is failed", async () => {
  const f = fixture(report(), { writes: [conflict(), conflict()], reads: [report({ report_version: 8 })] });
  assert.equal((await ensureCandidates(f.src, caller, f.report)).kind, "failed"); assert.equal(reads(f).length, 1);
});
test("duplicate/reordered clicks share exact body and key", async () => {
  const a = fixture(); await invoke(a, ["B", "A", "A"]); const b = fixture(); await invoke(b, [" A ", "B"]);
  assert.deepEqual(writes(a)[0], writes(b)[0]);
});
for (const [name, patch, ids] of [["report", { report_id: "synthetic-report-B" }, ["A", "B"]], ["revision", { report_version: 8 }, ["A", "B"]], ["ID set", {}, ["A", "C"]]]) {
  test(`different ${name} gets a distinct request key`, async () => {
    const a = fixture(); await invoke(a); const b = fixture(report(patch)); await invoke(b, ids);
    assert.notEqual(writes(a)[0].args[4], writes(b)[0].args[4]);
  });
}
test("operation and shortlist selection are bound separately", async () => {
  const f = fixture(); await invoke(f); await ensureCandidates(f.src, caller, f.report);
  await togglePickOn(f.src, caller, f.report, "A", true); await togglePickOn(f.src, caller, f.report, "A", false);
  const keys = [writes(f)[0].args[4], writes(f, "cb")[0].args[3], ...writes(f, "sl").map((c) => c.args[5])];
  assert.equal(new Set(keys).size, 4); assert.ok(keys.every((k) => /^[A-Za-z0-9._:-]{1,128}$/.test(k)));
});
test("P2 missing saved analyses fixture: explicit action posts B only and preserves A=0/C=pending", async () => {
  const initial = report({ analyses: { A: saved, C: pending }, shortlist: { A: { selected: true }, B: { selected: true }, C: { selected: true } } });
  const fresh = report({ ...initial, report_version: 8, analyses: { ...initial.analyses, B: saved } });
  const f = fixture(initial, { writes: [{ ok: true, value: fresh }] });
  assert.deepEqual(await analyzeNow({ error: null }, form("C,B,A,B")), { error: null });
  assert.deepEqual(writes(f)[0].args[3], ["B"]); assert.deepEqual(f.revalidations, [["/", "layout"]]);
  f.report = fresh; await analyzeNow({ error: null }, form("A,B,C")); assert.equal(writes(f).length, 1);
  assert.equal(fresh.analyses.A.score.converted_score, 0); assert.equal(fresh.analyses.C, pending);
});
test("action deduplicates IDs before 100 bound", async () => {
  const f = fixture(); await analyzeNow({ error: null }, form([...Array(120).fill("B"), "A"].join(",")));
  assert.deepEqual(writes(f)[0].args[3], ["A", "B"]);
});
test("empty action neither reads nor writes", async () => {
  const f = fixture(); assert.deepEqual(await analyzeNow({ error: null }, form(" , ,")), { error: null }); assert.equal(f.calls.length, 0);
});
test("no selected report cannot POST or return action success", async () => {
  const f = fixture(null); assert.equal(await loadMine(f.src, caller), null);
  assert.ok((await buildNow()).error); assert.equal(f.calls.length, 0); assert.equal(f.revalidations.length, 0);
});
test("action final conflict remains an error without success revalidation", async () => {
  const f = fixture(report(), { writes: [conflict(), conflict()] });
  assert.match((await analyzeNow({ error: null }, form("A"))).error, /revision_conflict/); assert.equal(f.revalidations.length, 0);
});
test("explicit candidate action preserves a stored pending result without POST", async () => {
  const f = fixture(report({ candidates })); assert.deepEqual(await buildNow(), { error: null });
  assert.equal(writes(f, "cb").length, 0); assert.equal(reads(f).length, 1);
});
for (const error of [new AccessDenied(401, "unauthorized"), new AccessDenied(403, "forbidden"), new ConnectionError("rate_limited", "quota")]) {
  test(`action maps ${error.message} without false success`, async () => {
    const f = fixture(report(), { writes: [error] }); assert.ok((await buildNow()).error); assert.equal(f.revalidations.length, 0);
  });
}
// 503(unavailable)은 서버가 저장을 마친 뒤 응답만 실패했을 수 있다(10-26 운영 관측). 오류는 그대로 보이되 화면은 다시 읽는다
test("action maps unavailable as an error and refreshes the page to show the real saved state", async () => {
  const f = fixture(report(), { writes: [new ConnectionError("unavailable", "down")] }); const out = await buildNow();
  assert.ok(out.error); assert.match(out.error, /실제 저장 상태/); assert.deepEqual(f.revalidations, [["/", "layout"]]);
});
test("caller failure is mapped by the same action error boundary", async () => {
  const f = fixture(report(), { callerError: new AccessDenied(401, "expired") });
  assert.match((await buildNow()).error, /로그인/); assert.equal(f.calls.length, 0);
});
test("unexpected port error is not disguised as ready", async () => {
  fixture(report(), { writes: [new Error("synthetic-unexpected")] }); await assert.rejects(buildNow, /synthetic-unexpected/);
});
