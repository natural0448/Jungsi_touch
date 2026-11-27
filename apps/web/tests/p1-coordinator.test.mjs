/** Synthetic native SQLite in RAM. No Cloudflare binding, network, Auth, admissions DB or KV.
 * Node24 strips erasable TS. The only loader adjustment resolves the adapter's bundler-style import.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.endsWith("/p1-coordinator.ts") && specifier === "../lib/p1-coordinator-core") return nextResolve(new URL("../lib/p1-coordinator-core.ts", context.parentURL).href, context);
  return nextResolve(specifier, context);
} });
const { P1SnapshotCoordinator } = await import("../src/worker/p1-coordinator.ts");
const { p1CoordinatorClient, P1CoordinationCore, localP1CoordinatorClient } = await import("../src/lib/p1-coordinator-core.ts");
const H = "a".repeat(64), S = "b".repeat(64), D = "c".repeat(64);
function head(edit = {}) {
  return { format: "jungsi.history-snapshot-head/v1", status: "approved", snapshot_id: "SYNTHETIC-snapshot", publication_sha256: H, source_head_sha256: S,
    generated_at: "2026-10-20T00:00:00Z", source_as_of: null, schema_version: "jungsi.history-snapshot/v1", normalization_rules_version: "SYNTHETIC-n1", selection_rules_version: "SYNTHETIC-s1",
    counts: { rows: 1, mapped_rows: 1, mapping_pending_rows: 0, schools: 1 }, delivery_mode: "parts", full: null,
    parts: [{ part_id: "SYNTHETIC-p1", payload_id: "SYNTHETIC-payload", gzip_bytes: 10, gzip_sha256: D, decoded_bytes: 20, decoded_sha256: D, rows: 1, mapped_rows: 1, mapping_pending_rows: 0 }],
    expires_at: "2099-01-01T00:00:00Z", ...edit };
}
function ready(h, token, edit = {}) {
  return { snapshot_id: h.snapshot_id, publication_sha256: h.publication_sha256, source_head_sha256: h.source_head_sha256,
    generated_at: h.generated_at, source_as_of: h.source_as_of, normalization_rules_version: h.normalization_rules_version, selection_rules_version: h.selection_rules_version,
    counts: h.counts, expires_at: h.expires_at, warmed_at: "2026-10-20T00:00:01Z", pub: "SYNTHETIC-public-prefix", index_key: token.writePrefix + ":index", ...edit };
}
async function fixture(work) {
  const originalNow = Date.now; let now = Date.parse("2026-10-20T01:00:00Z"); Date.now = () => now;
  const db = new DatabaseSync(":memory:"); let writes = 0;
  const ctx = { storage: {
    sql: { exec(sql, ...bindings) {
      const statement = db.prepare(sql);
      if (/^SELECT/.test(sql)) return { toArray: () => statement.all(...bindings) };
      statement.run(...bindings); if (/^INSERT/.test(sql)) writes++;
      return { toArray: () => [] };
    } },
    transactionSync(fn) { db.exec("BEGIN"); try { const result = fn(); db.exec("COMMIT"); return result; } catch (e) { db.exec("ROLLBACK"); throw e; } },
  } };
  const create = () => p1CoordinatorClient(new P1SnapshotCoordinator(ctx));
  const client = create();
  try { await work({ client, create, db, advance: ms => { now += ms; }, writes: () => writes, raw: () => db.prepare("SELECT body FROM p1_coordinator_state WHERE id=1").get()?.body ?? null }); }
  finally { db.close(); Date.now = originalNow; }
}
async function seed(client, h = head()) {
  const c = await client.claimHead(); assert.equal(c.state, "claimed");
  await client.commitHead(c.token, h); return h;
}
const denied = (promise, code) => assert.rejects(promise, e => e.code === code);

test("20 head claims issue one work permit; no shared I/O promise", async () => fixture(async f => {
  const calls = Array.from({ length: 20 }, () => f.client.claimHead()); assert.equal(new Set(calls).size, 20);
  const results = await Promise.all(calls); assert.equal(results.filter(x => x.state === "claimed").length, 1); assert.equal(results.filter(x => x.state === "busy").length, 19);
  let sourceCalls = 0;
  for (const result of results) if (result.state === "claimed") { sourceCalls++; await f.client.commitHead(result.token, head()); }
  const views = await Promise.all(Array.from({ length: 20 }, () => f.client.inspect()));
  assert(views.every(v => v.headFresh)); assert.equal(sourceCalls, 1);
}));
test("10-minute expiry coalesces 20 renewed checks into one permit", async () => fixture(async f => {
  await seed(f.client); f.advance(600000);
  assert.equal((await f.client.inspect()).headFresh, false);
  const results = await Promise.all(Array.from({ length: 20 }, () => f.client.claimHead()));
  assert.equal(results.filter(x => x.state === "claimed").length, 1);
  await f.client.commitHead(results.find(x => x.state === "claimed").token, head());
  assert.equal((await f.client.claimHead()).state, "cached");
}));
test("afterRevision coalesces forced checks even when peers arrive after commit", async () => fixture(async f => {
  await seed(f.client); const rev = (await f.client.inspect()).headRevision;
  const c = await f.client.claimHead(rev); assert.equal(c.state, "claimed");
  await f.client.commitHead(c.token, head());
  const followers = await Promise.all(Array.from({ length: 20 }, () => f.client.claimHead(rev)));
  assert(followers.every(x => x.state === "cached"));
}));
test("two object instances sharing durable state do not both win", async () => fixture(async f => {
  const other = f.create(), results = await Promise.all([f.client.claimHead(), other.claimHead()]);
  assert.equal(results.filter(x => x.state === "claimed").length, 1);
}));
test("restart preserves lease; expiry increments fence and rejects late head", async () => fixture(async f => {
  const first = await f.client.claimHead(), restarted = f.create();
  assert.equal((await restarted.claimHead()).state, "busy"); f.advance(30001);
  const second = await restarted.claimHead(); assert(second.token.fence > first.token.fence);
  await denied(f.client.commitHead(first.token, head()), "p1_coordinator_fence_stale");
  await f.client.failHead(first.token); assert.equal((await restarted.claimHead()).state, "busy");
  await restarted.commitHead(second.token, head());
}));
test("head failure releases only its lease and stores no caller failure", async () => fixture(async f => {
  const c = await f.client.claimHead(); await f.client.failHead(c.token);
  assert.equal((await f.client.claimHead()).state, "claimed"); assert(!f.raw().includes("accessToken"));
}));
test("two admins receive one warm writer; restart retains committed checkpoint", async () => fixture(async f => {
  await seed(f.client); const a = await f.client.claimWarm(H), b = await f.create().claimWarm(H);
  assert.equal(a.state, "claimed"); assert.equal(b.state, "busy");
  await f.client.commitWarm(a.token, { phase: "parts", done: ["SYNTHETIC-p1"], part_keys: { p1: a.token.writePrefix + ":frag:p1" } });
  const restarted = f.create(), c = await restarted.claimWarm(H);
  assert.equal(c.view.step, 1); assert.deepEqual(c.view.progress.done, ["SYNTHETIC-p1"]); assert(c.token.fence > a.token.fence);
}));
test("checkpoint commit replay is idempotent and changed content conflicts", async () => fixture(async f => {
  await seed(f.client); const c = await f.client.claimWarm(H), progress = { phase: "parts", done: ["SYNTHETIC-p1"] };
  await f.client.commitWarm(c.token, progress); const writes = f.writes();
  const replay = await f.client.commitWarm(c.token, { done: ["SYNTHETIC-p1"], phase: "parts" });
  assert.equal(replay.replayed, true); assert.equal(replay.view.step, 1); assert.equal(f.writes(), writes);
  await denied(f.client.commitWarm(c.token, { phase: "index" }), "p1_coordinator_replay_conflict");
}));
test("expired writer cannot commit or release a replacement; writes have unique prefixes", async () => fixture(async f => {
  const h = await seed(f.client); const old = await f.client.claimWarm(H); f.advance(120001);
  const next = await f.create().claimWarm(H); assert.notEqual(old.token.writePrefix, next.token.writePrefix);
  const immutableKV = new Map([[old.token.writePrefix + ":index", "old"], [next.token.writePrefix + ":index", "new"]]);
  await denied(f.client.commitWarm(old.token, { phase: "ready" }, ready(h, old.token)), "p1_coordinator_fence_stale");
  await f.client.failWarm(old.token); assert.equal((await f.client.claimWarm(H)).state, "busy");
  await f.client.commitWarm(next.token, { phase: "ready" }, ready(h, next.token));
  assert.equal(immutableKV.get((await f.client.inspect()).ready.index_key), "new"); assert.equal(immutableKV.size, 2);
}));
test("failed step preserves committed progress and permits a new fenced retry", async () => fixture(async f => {
  await seed(f.client); const a = await f.client.claimWarm(H); await f.client.commitWarm(a.token, { phase: "schools", schoolsDone: 1 });
  const b = await f.client.claimWarm(H); await f.client.failWarm(b.token);
  const c = await f.client.claimWarm(H); assert.equal(c.view.step, 1); assert.equal(c.view.progress.schoolsDone, 1); assert(c.token.fence > b.token.fence);
}));
test("ready promotion requires the active immutable index namespace and exact head", async () => fixture(async f => {
  const h = await seed(f.client), c = await f.client.claimWarm(H);
  for (const edit of [{ index_key: "mutable:ready" }, { publication_sha256: D }, { counts: { ...h.counts, rows: 2 } }, { selection_rules_version: "SYNTHETIC-other" }]) {
    await denied(f.client.commitWarm(c.token, { phase: "ready" }, ready(h, c.token, edit)), "p1_coordinator_ready_invalid");
    assert.equal((await f.client.inspect()).step, 0);
  }
  await f.client.commitWarm(c.token, { phase: "ready" }, ready(h, c.token));
  assert.equal((await f.client.claimWarm(H)).state, "ready");
}));
for (const change of [{ publication_sha256: D }, { normalization_rules_version: "SYNTHETIC-n2" }, { selection_rules_version: "SYNTHETIC-s2" }]) {
  test("changed head invalidates active writer and ready: " + Object.keys(change)[0], async () => fixture(async f => {
    const h = await seed(f.client), warm = await f.client.claimWarm(H);
    await f.client.commitWarm(warm.token, { phase: "ready" }, ready(h, warm.token));
    const check = await f.client.claimHead((await f.client.inspect()).headRevision);
    await f.client.commitHead(check.token, head(change)); const v = await f.client.inspect();
    assert.equal(v.ready, null); assert.equal(v.progress, null);
    await denied(f.client.commitWarm(warm.token, { phase: "ready" }, ready(h, warm.token)), "p1_coordinator_fence_stale");
  }));
}
test("expired head cannot serve ready or start warm", async () => fixture(async f => {
  const h = await seed(f.client), c = await f.client.claimWarm(H); await f.client.commitWarm(c.token, { phase: "ready" }, ready(h, c.token));
  f.advance(600001); assert.equal((await f.client.inspect()).ready, null);
  await denied(f.client.claimWarm(H), "p1_head_check_required");
}));
test("peek serves the stored ready after the 10-minute check lapses, never after expiry or a changed head (11-17)", async () => fixture(async f => {
  const h = await seed(f.client), c = await f.client.claimWarm(H); await f.client.commitWarm(c.token, { phase: "ready" }, ready(h, c.token));
  f.advance(600001);
  const stale = await f.client.peek();
  assert.equal(stale.headFresh, false); assert.equal(stale.ready.publication_sha256, H);
  assert.equal((await f.client.inspect()).ready, null);
  await denied(f.client.claimWarm(H), "p1_head_check_required");
  f.advance(Date.parse(h.expires_at) - Date.now() + 86400000 * 400);
  assert.equal((await f.client.peek()).ready, null);
}));
test("warm margin renews a check near the 10-minute edge so a step cannot lapse mid-commit (11-06 seq18)", async () => fixture(async f => {
  await seed(f.client); f.advance(600000 - 110000);
  // Plain visitors still reuse the check; a warm step asking for 120s left gets one renewal permit.
  assert.equal((await f.client.claimHead()).state, "cached");
  const results = await Promise.all(Array.from({ length: 5 }, () => f.client.claimHead(undefined, 120000)));
  assert.equal(results.filter(x => x.state === "claimed").length, 1); assert.equal(results.filter(x => x.state === "busy").length, 4);
  await f.client.commitHead(results.find(x => x.state === "claimed").token, head());
  assert.equal((await f.client.claimHead(undefined, 120000)).state, "cached");
  // The renewed check survives a full step: claim, then commit 119s later.
  const w = await f.client.claimWarm(H); f.advance(119000);
  await f.client.commitWarm(w.token, { phase: "parts" });
  // Without the margin the same timing fails, as seen in production.
  await f.client.claimHead(); f.advance(600000 - 119000 - 1000);
  const late = await f.client.claimWarm(H); assert.equal(late.state, "claimed"); f.advance(20000);
  await denied(f.client.commitWarm(late.token, { phase: "parts" }), "p1_head_check_required");
}));
test("minFreshMs must be a bounded integer", async () => fixture(async f => {
  for (const bad of [-1, 300001, 1.5, "120000"]) await denied(f.client.claimHead(undefined, bad), "p1_coordinator_request_invalid");
}));
test("private values and unexpected RPC keys cannot enter shared storage", async () => fixture(async f => {
  await seed(f.client); const c = await f.client.claimWarm(H), before = f.raw();
  for (const progress of [{ accessToken: "SYNTHETIC-user-token" }, { scores: { korean: 99 } }, { nested: { owner_id: "SYNTHETIC-owner" } }, { roles: ["admin"] }, { nested: { permissions: ["SYNTHETIC-permission"] } }, { claims: { aal: "aal2" } }]) await denied(f.client.commitWarm(c.token, progress), "p1_coordinator_private_value");
  assert.equal(f.raw(), before);
  const response = await new P1SnapshotCoordinator({ storage: { sql: { exec: () => ({ toArray: () => [] }) }, transactionSync: fn => fn() } }).fetch(new Request("https://internal/command", { method: "POST", body: JSON.stringify({ op: "inspect", accessToken: "SYNTHETIC" }) }));
  assert.equal(response.status, 409);
}));
test("malformed public heads are rejected before publication", async () => fixture(async f => {
  const c = await f.client.claimHead();
  for (const h of [head({ expires_at: "not-a-date" }), head({ accessToken: "SYNTHETIC" }), head({ counts: { rows: 2, mapped_rows: 1, mapping_pending_rows: 0, schools: 1 } }), head({ parts: [head().parts[0], head().parts[0]] })]) await assert.rejects(f.client.commitHead(c.token, h));
  assert.equal((await f.client.inspect()).head, null);
}));
test("corrupt durable state fails closed without resetting fence", async () => fixture(async f => {
  await seed(f.client); f.db.prepare("UPDATE p1_coordinator_state SET body=? WHERE id=1").run("{broken");
  await denied(f.create().inspect(), "p1_coordinator_state_invalid"); assert.equal(f.raw(), "{broken");
}));
test("local synthetic client uses exactly the production dispatcher", async () => {
  let state = null, serial = 0; const store = { read: () => structuredClone(state), atomic: fn => { const next = fn(structuredClone(state)); state = structuredClone(next.state); return next.result; } };
  const core = new P1CoordinationCore(store, () => Date.parse("2026-10-20T01:00:00Z"), () => "SYNTHETIC-nonce-" + ++serial), client = localP1CoordinatorClient(core);
  await seed(client); assert.equal((await client.inspect()).headFresh, true);
});
test("JSON-valid credential contamination in persisted state fails closed", async () => fixture(async f => {
  await seed(f.client); const stored = JSON.parse(f.raw()); stored.head.accessToken = "SYNTHETIC-private";
  const raw = JSON.stringify(stored); f.db.prepare("UPDATE p1_coordinator_state SET body=? WHERE id=1").run(raw);
  await denied(f.create().inspect(), "p1_coordinator_state_invalid"); assert.equal(f.raw(), raw);
}));
test("fencing counter exhaustion fails closed without wraparound", async () => fixture(async f => {
  await seed(f.client); const stored = JSON.parse(f.raw()); stored.fence = Number.MAX_SAFE_INTEGER;
  f.db.prepare("UPDATE p1_coordinator_state SET body=? WHERE id=1").run(JSON.stringify(stored));
  await denied(f.client.claimWarm(H), "p1_coordinator_fence_exhausted");
  assert.equal(JSON.parse(f.raw()).fence, Number.MAX_SAFE_INTEGER);
}));
test("head pin changes invalidate ready even when publication identity is unchanged", async () => fixture(async f => {
  const h = await seed(f.client), c = await f.client.claimWarm(H); await f.client.commitWarm(c.token, { phase: "ready" }, ready(h, c.token));
  const fresh = await f.client.claimHead((await f.client.inspect()).headRevision);
  await f.client.commitHead(fresh.token, head({ generated_at: "2026-10-20T00:01:00Z" })); assert.equal((await f.client.inspect()).ready, null);
}));
test("oversized internal command is bounded before parse and never persists", async () => fixture(async f => {
  const response = await new P1SnapshotCoordinator({ storage: { sql: { exec: () => ({ toArray: () => [] }) }, transactionSync: fn => fn() } }).fetch(new Request("https://internal/command", { method: "POST", body: " ".repeat(262145) }));
  assert.equal(response.status, 409); assert.equal((await response.json()).error.code, "p1_coordinator_request_too_large"); assert.equal(f.raw(), null);
}));

test("rebuild keeps serving the previous ready (standby) until the new generation commits (2026-11-16)", async () => fixture(async f => {
  const h = await seed(f.client);
  const c1 = await f.client.claimWarm(H); assert.equal(c1.state, "claimed");
  const r1 = ready(h, c1.token);
  await f.client.commitWarm(c1.token, { phase: "ready" }, r1);
  assert.equal((await f.client.inspect()).ready.index_key, r1.index_key);
  // 다시 만들기: 이전 준비본은 대기본으로 계속 보인다
  const v = await f.client.rebuildWarm(H);
  assert.equal(v.ready.index_key, r1.index_key);
  const c2 = await f.client.claimWarm(H); assert.equal(c2.state, "claimed"); assert.notEqual(c2.token.generation, c1.token.generation);
  assert.equal(c2.view.ready.index_key, r1.index_key);
  // 진행 중에는 다시 시작할 수 없다
  await denied(f.client.rebuildWarm(H), "p1_rebuild_busy");
  await f.client.commitWarm(c2.token, { phase: "parts" }, null);
  assert.equal((await f.client.inspect()).ready.index_key, r1.index_key);
  const c3 = await f.client.claimWarm(H); assert.equal(c3.state, "claimed");
  const r2 = ready(h, c3.token);
  await f.client.commitWarm(c3.token, { phase: "ready" }, r2);
  assert.equal((await f.client.inspect()).ready.index_key, r2.index_key);
  // 완료되면 대기본 칸이 저장 형식에서 사라진다(옛 코드로 되돌려도 읽힌다)
  assert.equal(JSON.parse(f.raw()).standby, undefined);
  assert.equal((await f.client.claimWarm(H)).state, "ready");
}));

test("rebuild: a new head drops the standby; a stale publication or no ready is harmless (2026-11-16)", async () => fixture(async f => {
  const h = await seed(f.client);
  await denied(f.client.rebuildWarm("d".repeat(64)), "p1_publication_changed");
  assert.equal((await f.client.rebuildWarm(H)).ready, null); // 준비본이 없으면 아무것도 하지 않는다
  const c1 = await f.client.claimWarm(H); await f.client.commitWarm(c1.token, { phase: "ready" }, ready(h, c1.token));
  await f.client.rebuildWarm(H);
  f.advance(600000);
  const hc = await f.client.claimHead(); assert.equal(hc.state, "claimed");
  await f.client.commitHead(hc.token, head({ publication_sha256: "e".repeat(64) }));
  const view = await f.client.inspect();
  assert.equal(view.ready, null);
  assert.equal(JSON.parse(f.raw()).standby, undefined);
}));
