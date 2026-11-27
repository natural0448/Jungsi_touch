import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// Run the real live.ts against a fake fetch. Only "server-only" and React's request cache are replaced.
const data = (code) => "data:text/javascript," + encodeURIComponent(code);
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === "server-only") return { url: data(""), shortCircuit: true };
    if (spec === "react") return { url: data(`export function cache(fn){const m=new Map();return (...a)=>{const k=JSON.stringify(a);if(!m.has(k))m.set(k,fn(...a));return m.get(k)}}`), shortCircuit: true };
    // TypeScript sources import siblings without an extension
    if (spec.startsWith(".") && !/\.[a-z]+$/.test(spec) && ctx.parentURL?.endsWith(".ts")) return { url: new URL(spec + ".ts", ctx.parentURL).href, shortCircuit: true };
    return next(spec, ctx);
  },
});
process.env.JUNGSI_API_URL = "https://api.test";
const { liveSource } = await import("../src/lib/api/live.ts");
const { ConnectionError } = await import("../src/lib/api/source.ts");

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function fake(t, replies) {
  const seen = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    seen.push({ path: String(url).replace("https://api.test/api/v1", ""), method: init?.method ?? "GET" });
    const next = replies.shift();
    if (!next) throw new Error("unexpected request");
    return next();
  };
  t.after(() => { globalThis.fetch = original; });
  return seen;
}
const caller = (n) => ({ accessToken: `token-${n}` });
const down = () => json(503, { error: { code: "backend_dependency_unavailable" } });

test("a read that hits backend_dependency_unavailable is sent once more and succeeds", async (t) => {
  const seen = fake(t, [down, () => json(200, { current_report_id: "r1" })]);
  const st = await liveSource.readScoreInputStatus(caller(1), "exam");
  assert.equal(st.current_report_id, "r1");
  assert.equal(seen.length, 2);
});

test("only one extra try: a second backend_dependency_unavailable surfaces as unavailable", async (t) => {
  const seen = fake(t, [down, down]);
  await assert.rejects(liveSource.readScoreInputStatus(caller(2), "exam"), (e) => e instanceof ConnectionError && e.kind === "unavailable" && e.code === "backend_dependency_unavailable");
  assert.equal(seen.length, 2);
});

test("other 503 codes are configuration problems and are not sent again", async (t) => {
  const seen = fake(t, [() => json(503, { error: { code: "security_policy_unavailable" } })]);
  await assert.rejects(liveSource.readScoreInputStatus(caller(3), "exam"), (e) => e instanceof ConnectionError && e.code === "security_policy_unavailable");
  assert.equal(seen.length, 1);
});

test("candidate rebuild (same idempotency key) is replayed; score save is never replayed", async (t) => {
  const seen = fake(t, [down, () => json(200, { report_id: "r1" }), down]);
  const built = await liveSource.buildCandidates(caller(4), "r1", 3, "cb-key");
  assert.equal(built.ok, true);
  assert.equal(seen.filter((s) => s.method === "POST").length, 2);
  await assert.rejects(liveSource.createScoreProfile(caller(4), [], true, "sp-key"), (e) => e instanceof ConnectionError && e.kind === "unavailable");
  assert.equal(seen.length, 3);
});

const cpu = () => json(546, { error: { code: "WORKER_LIMIT", message: "CPU Time exceeded" } });

test("546 on a read is sent once more and succeeds", async (t) => {
  const seen = fake(t, [cpu, () => json(200, { current_report_id: "r2" })]);
  const st = await liveSource.readScoreInputStatus(caller(6), "exam");
  assert.equal(st.current_report_id, "r2");
  assert.equal(seen.length, 2);
});

test("546 on university analysis is replayed once; a second 546 is not retried again", async (t) => {
  const seen = fake(t, [cpu, () => json(200, { report_id: "r1" }), cpu, cpu]);
  const ok = await liveSource.analyzeUniversities(caller(7), "r1", 3, ["o1"], "ua-key");
  assert.equal(ok.ok, true);
  const failed = await liveSource.analyzeUniversities(caller(7), "r1", 3, ["o1"], "ua-key2");
  assert.equal(failed.ok, false);
  assert.equal(seen.length, 4);
});

test("546 on a score save is never replayed", async (t) => {
  const seen = fake(t, [cpu]);
  const r = await liveSource.createScoreProfile(caller(8), [], true, "sp-key2").catch((e) => e);
  assert.ok(r instanceof Error || r?.ok === false);
  assert.equal(seen.length, 1);
});

test("layout and page share one /me call per request", async (t) => {
  const seen = fake(t, [() => json(200, { member_tier: "paid" })]);
  const c = caller(5);
  const [a, b] = await Promise.all([liveSource.getSession(c), liveSource.getSession({ ...c })]);
  assert.equal(a.member_tier, "paid");
  assert.equal(b.member_tier, "paid");
  assert.equal(seen.filter((s) => s.path === "/me").length, 1);
});

test("snapshot part path keeps ':' in the snapshot id and still encodes other characters", async (t) => {
  const seen = fake(t, [() => new Response("x", { status: 200 })]);
  await liveSource.readSnapshotPart(caller(9), "p1-public-history:00000000000000000026", "part-1");
  assert.equal(seen[0].path.split("?")[0], "/admission-history/snapshots/p1-public-history:00000000000000000026");
  const { snapshotSegment } = await import("../src/lib/api/live.ts");
  assert.equal(snapshotSegment("a:b/c d"), "a:b%2Fc%20d");
});

test("offering paths keep ':' in 2027:PK ids (recruitment and published forecast)", async (t) => {
  const seen = fake(t, [() => json(200, { offering_id: "2027:1000001753" }), () => json(200, { status: "none" })]);
  await liveSource.readRecruitment(caller(11), "2027:1000001753");
  await liveSource.readPublishedForecast(caller(12), "2027:1000001753");
  assert.equal(seen[0].path.split("?")[0], "/offerings/2027:1000001753/recruitment");
  assert.equal(seen[1].path.split("?")[0], "/offerings/2027:1000001753/forecast");
});

test("429 contention waits: short steps, never past the server hint, kept going while the hint is far away (2026-11-21)", async () => {
  const { contentionWait } = await import("../src/lib/api/live.ts");
  assert.equal(contentionWait(0, null), 2000);
  assert.equal(contentionWait(0, 800), 800);
  assert.equal(contentionWait(0, 100), 500);
  assert.equal(contentionWait(1, 60_000), 3000); // 서버 시각이 1분 뒤여도 몇 초 간격으로 다시 본다
  assert.equal(contentionWait(40, 60_000), 6000);
});
