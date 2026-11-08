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

test("layout and page share one /me call per request", async (t) => {
  const seen = fake(t, [() => json(200, { member_tier: "paid" })]);
  const c = caller(5);
  const [a, b] = await Promise.all([liveSource.getSession(c), liveSource.getSession({ ...c })]);
  assert.equal(a.member_tier, "paid");
  assert.equal(b.member_tier, "paid");
  assert.equal(seen.filter((s) => s.path === "/me").length, 1);
});
