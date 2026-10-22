import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { gzipSync } from "node:zlib";

// Execute the actual TypeScript modules. Only framework bindings are substituted;
// neither a copy of the function body nor production credentials are used.
registerHooks({ resolve(specifier, context, next) {
  if (specifier === "server-only") return { shortCircuit: true, url: "data:text/javascript,export default {}" };
  if (specifier === "@opennextjs/cloudflare") return { shortCircuit: true, url: "data:text/javascript,export async function getCloudflareContext(){if(!globalThis.__p1TestBindings)throw Error('outside worker');return globalThis.__p1TestBindings}" };
  let url;
  if (specifier.startsWith("@/")) url = new URL(`../src/${specifier.slice(2)}`, import.meta.url);
  else if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) url = new URL(specifier, context.parentURL);
  if (url && !/\.[cm]?[jt]sx?$/.test(url.pathname) && existsSync(fileURLToPath(new URL(url.href + ".ts")))) return next(url.href + ".ts", context);
  if (url && specifier.startsWith("@/")) return next(url.href, context);
  return next(specifier, context);
} });
const { P1SnapshotCoordinator } = await import("../src/worker/p1-coordinator.ts");
const { p1CoordinatorClient } = await import("../src/lib/p1-coordinator-core.ts");
const { SnapshotChanged } = await import("../src/lib/api/source.ts");
const encode = new TextEncoder(), realNow = Date.now;
const sha = async b => Buffer.from(await crypto.subtle.digest("SHA-256", b)).toString("hex");
let serial = 0;

async function world(t, { parts = 2, schools = 1, missing = false, row = {} } = {}) {
  const priorMode = process.env.JUNGSI_API_MODE, priorNode = process.env.NODE_ENV;
  process.env.JUNGSI_API_MODE = "live"; process.env.NODE_ENV = "test";
  const w = { now: Date.parse("2026-10-21T00:00:00Z"), headCalls: 0, partCalls: 0, writes: [], cache: new Map(), delayedKey: null };
  Date.now = () => w.now;
  w.db = new DatabaseSync(":memory:");
  const ctx = { storage: { sql: { exec(sql, ...bindings) {
    const rows = w.db.prepare(sql).all(...bindings);
    return { toArray: () => rows };
  } }, transactionSync(work) {
    w.db.exec("BEGIN IMMEDIATE");
    try { const result = work(); w.db.exec("COMMIT"); return result; }
    catch (error) { w.db.exec("ROLLBACK"); throw error; }
  } } };
  w.actor = new P1SnapshotCoordinator(ctx);
  w.restart = () => { w.actor = new P1SnapshotCoordinator(ctx); };
  w.kv = { async get(key) { return key === w.delayedKey ? null : w.cache.get(key) ?? null; }, async put(key, value) {
    // Any repeated key inside one second models the documented native KV constraint.
    const previous = w.writes.findLast(x => x.key === key);
    if (previous && w.now - previous.at < 1000) throw Error("synthetic_KV_429_same_key");
    w.writes.push({ key, at: w.now }); w.cache.set(key, value);
  } };
  globalThis.__p1TestBindings = { env: missing ? {} : { JT_SHARED_CACHE: w.kv, JT_P1_COORDINATOR: { getByName(name) {
    assert.equal(name, "public-v2:live"); return { fetch: request => w.actor.fetch(request) };
  } } } };
  const pins = [], bodies = new Map();
  for (let i = 0; i < parts; i++) {
    const part = `part${i}`, university = `TEST${i % schools}`;
    const json = JSON.stringify({ format: "jungsi.history-snapshot/v1", part_id: part, payload_id: `payload${i}`, rows: [{
      university_id: university, university_name: `가상대학교${i % schools}`, academic_year: 2026,
      original_pk: `pk${i}`, department: `가상학과${i}`, region: "가상지역", group: "가",
      competition_ratio: { value: "__EXACT_NUMBER__", status: "ready", unit: "대1" },
      ...row,
    }] }).replace('"__EXACT_NUMBER__"', "9.71000000000000009").replace('"__STAT_NUMBER__"', "84.10000000000000009");
    const decoded = encode.encode(json), gzip = gzipSync(decoded);
    pins.push({ part_id: part, payload_id: `payload${i}`, gzip_bytes: gzip.length, gzip_sha256: await sha(gzip), decoded_bytes: decoded.length, decoded_sha256: await sha(decoded), rows: 1, mapped_rows: 1, mapping_pending_rows: 0 });
    bodies.set(part, i % 2 ? decoded : gzip);
  }
  w.head = { format: "jungsi.history-snapshot-head/v1", status: "approved", snapshot_id: "synthetic.snapshot.v1",
    publication_sha256: "a".repeat(64), source_head_sha256: "b".repeat(64), generated_at: "2026-10-20T00:00:00Z", source_as_of: null,
    schema_version: "synthetic.v1", normalization_rules_version: "synthetic.v1", selection_rules_version: "synthetic.v1",
    counts: { rows: parts, mapped_rows: parts, mapping_pending_rows: 0, schools }, delivery_mode: "parts", full: null, parts: pins, expires_at: "2099-01-01T00:00:00Z" };
  w.source = { kind: "live", async readSnapshotHead() { w.headCalls++; await new Promise(r => setTimeout(r, 5)); return structuredClone(w.head); },
    async readSnapshotPart(_caller, _snapshot, id) { w.partCalls++; await new Promise(r => setTimeout(r, 1)); return bodies.get(id); } };
  w.caller = { accessToken: "SYNTHETIC_PRIVATE_CALLER_DO_NOT_STORE" };
  w.module = await import(`../src/lib/p1-snapshot.ts?instance=${serial++}`);
  w.second = await import(`../src/lib/p1-snapshot.ts?instance=${serial++}`);
  w.state = () => JSON.parse(w.db.prepare("SELECT body FROM p1_coordinator_state WHERE id=1").get().body);
  w.prepare = async (module = w.module) => {
    for (let i = 0; i < 100; i++) { const s = await module.warmStep(w.source, w.caller); if (s.state === "ready") return s.ready; }
    throw Error("synthetic preparation exceeded bounded steps");
  };
  t.after(() => { Date.now = realNow; w.db.close(); globalThis.__p1TestBindings = undefined;
    if (priorMode === undefined) delete process.env.JUNGSI_API_MODE; else process.env.JUNGSI_API_MODE = priorMode;
    if (priorNode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = priorNode;
  });
  return w;
}

test("immutable KV writes avoid the old same-key progress rate error and preserve numeric text", async t => {
  const w = await world(t), ready = await w.prepare();
  assert.equal(new Set(w.writes.map(x => x.key)).size, w.writes.length);
  assert.ok(w.writes.every(x => !/:(warm|checked|ready)$/.test(x.key)));
  const result = await w.module.searchSnapshot(ready, {});
  assert.equal(result.total_schools, 1); assert.equal(result.total_units, 2);
  assert.equal(result.schools[0].rows[0].cr.v, "9.71000000000000009");
  assert.equal(result.schools[0].rows[0].cr.n, 1);
  assert.equal(w.partCalls, 2);
});
test("20 requests across two BFF instances recheck the head once", async t => {
  const w = await world(t); await w.prepare(); const before = w.headCalls;
  w.now += 600001;
  const values = await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? w.module : w.second).currentSnapshot(w.source, w.caller)));
  assert.equal(w.headCalls - before, 1);
  assert.ok(values.every(x => x.state === "ready"));
  assert.equal(w.writes.filter(x => /checked/.test(x.key)).length, 0);
});
test("two administrators share one warm and actor restart resumes committed progress", async t => {
  const w = await world(t);
  await Promise.all([w.module.warmStep(w.source, w.caller), w.second.warmStep(w.source, w.caller)]);
  assert.equal(w.partCalls, 2);
  const step = w.state().warm.step; assert.ok(step > 0);
  w.restart(); const ready = await w.prepare(w.second);
  assert.equal(ready.counts.rows, 2); assert.equal(w.partCalls, 2);
  assert.ok(w.state().warm.step >= step);
});
test("an expired warm owner cannot write over a newer step or publish ready", async t => {
  const w = await world(t); let release, started;
  const blocked = new Promise(r => { release = r; }), entered = new Promise(r => { started = r; });
  const read = w.source.readSnapshotPart; let first = true;
  w.source.readSnapshotPart = async (...args) => { if (first) { first = false; started(); await blocked; } return read(...args); };
  const old = w.module.warmStep(w.source, w.caller); await entered;
  w.now += 120001; await w.second.warmStep(w.source, w.caller);
  const step = w.state().warm.step, writes = w.writes.length;
  release(); await old;
  assert.equal(w.state().warm.step, step); assert.equal(w.writes.length, writes);
  const ready = await w.prepare(w.second);
  assert.equal(ready.counts.rows, 2);
});
test("a new publication invalidates ready while retaining old immutable cache objects", async t => {
  const w = await world(t); await w.prepare(); const count = w.cache.size;
  w.now += 600001; w.head.snapshot_id = "synthetic.snapshot.v2"; w.head.publication_sha256 = "c".repeat(64);
  assert.equal((await w.module.currentSnapshot(w.source, w.caller)).state, "changed");
  assert.equal(w.state().ready, null); assert.equal(w.cache.size, count);
});
test("KV propagation gaps never become empty data or ready", async t => {
  const w = await world(t); await w.module.warmStep(w.source, w.caller);
  w.delayedKey = Object.values(w.state().warm.progress.part_keys)[0];
  await assert.rejects(w.module.warmStep(w.source, w.caller), e => e.code === "p1_cache_visibility_pending");
  assert.equal(w.state().ready, null); w.delayedKey = null;
  assert.equal((await w.prepare()).counts.rows, 2);
});
test("live and deployed synthetic modes fail closed when shared bindings are absent", async t => {
  const w = await world(t, { missing: true });
  await assert.rejects(w.module.warmStep(w.source, w.caller), e => e.code === "p1_shared_coordination_unconfigured");
  process.env.NODE_ENV = "production"; process.env.JUNGSI_API_MODE = "synthetic";
  await assert.rejects(w.module.warmStep({ ...w.source, kind: "synthetic" }, w.caller), e => e.code === "p1_shared_coordination_unconfigured");
  assert.equal(w.partCalls, 0); assert.equal(w.headCalls, 0);
});
test("explicit local synthetic dev mode uses the same coordinator state machine", async t => {
  const w = await world(t, { missing: true }); process.env.JUNGSI_API_MODE = "synthetic";
  globalThis.__jtP1ExplicitLocalV2 = undefined;
  const ready = await w.module.warmStep({ ...w.source, kind: "synthetic" }, w.caller);
  assert.equal(ready.state, "running"); assert.equal(w.partCalls, 2);
});
test("credentials never enter KV or the persisted coordinator document", async t => {
  const w = await world(t); await w.prepare();
  const stored = JSON.stringify(w.state()) + [...w.cache.values()].join("\n");
  assert.ok(!stored.includes(w.caller.accessToken));
  for (const secret of ["Authorization", "refresh_token", "relay_token", "subject_id"]) assert.ok(!stored.includes(secret));
});
test("bad pins and interrupted publication preserve fail-closed state", async t => {
  const w = await world(t); w.head.parts[0].decoded_sha256 = "0".repeat(64);
  await assert.rejects(w.module.warmStep(w.source, w.caller), /p1_decoded_pin_mismatch/);
  assert.equal(w.state().ready, null);
  w.source.readSnapshotPart = async () => { throw new SnapshotChanged(); };
  assert.equal((await w.module.warmStep(w.source, w.caller)).state, "changed");
});
test("source still authorizes each admin action before claiming a warm lease", () => {
  const actions = readFileSync(new URL("../src/app/management/p1-snapshot/actions.ts", import.meta.url), "utf8");
  assert.ok(actions.indexOf("await isEdutouchAdmin()") < actions.indexOf("await warmStep("));
  const entry = readFileSync(new URL("../worker.mjs", import.meta.url), "utf8");
  assert.match(entry, /export \{ default \} from "\.\/.open-next\/worker.js"/);
});


test("final assembly rechecks after a peer refresh instead of reusing a pre-assembly revision", async t => {
  const w = await world(t), originalPut = w.kv.put;
  const client = p1CoordinatorClient({ fetch: request => w.actor.fetch(request) });
  let peerRefreshed = false;
  w.kv.put = async (key, value) => {
    await originalPut(key, value);
    if (!key.endsWith(":index") || peerRefreshed) return;
    peerRefreshed = true;
    const before = await client.inspect(), claim = await client.claimHead(before.headRevision);
    assert.equal(claim.state, "claimed");
    await client.commitHead(claim.token, await w.source.readSnapshotHead(w.caller));
    w.head.snapshot_id = "synthetic.changed.after.peer";
    w.head.publication_sha256 = "d".repeat(64);
  };
  let last;
  for (let i = 0; i < 10; i++) {
    last = await w.module.warmStep(w.source, w.caller);
    if (last.state === "changed") break;
    assert.notEqual(last.state, "ready");
  }
  assert.ok(peerRefreshed); assert.equal(last.state, "changed");
  assert.equal(w.state().ready, null); assert.equal(w.state().head.snapshot_id, w.head.snapshot_id);
  assert.ok(w.headCalls >= 3);
});

test("live and synthetic use separate server-selected actors on the same native bindings", async t => {
  const w = await world(t), names = [];
  const db = new DatabaseSync(":memory:"); t.after(() => db.close());
  const syntheticActor = new P1SnapshotCoordinator({ storage: {
    sql: { exec(sql, ...args) { const rows = db.prepare(sql).all(...args); return { toArray: () => rows }; } },
    transactionSync(work) { db.exec("BEGIN IMMEDIATE"); try { const r = work(); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; } },
  } });
  globalThis.__p1TestBindings.env.JT_P1_COORDINATOR.getByName = name => {
    names.push(name); assert.ok(["public-v2:live", "public-v2:synthetic"].includes(name));
    return { fetch: request => (name === "public-v2:live" ? w.actor : syntheticActor).fetch(request) };
  };
  const ready = await w.prepare(), live = JSON.stringify(w.state());
  await w.second.warmStep({ ...w.source, kind: "synthetic", async readSnapshotHead() {
    const h = structuredClone(w.head); h.snapshot_id = "synthetic.separate"; h.publication_sha256 = "e".repeat(64); return h;
  } }, w.caller);
  assert.equal(JSON.stringify(w.state()), live);
  assert.equal((await w.module.currentSnapshot(w.source, w.caller)).state, "ready");
  assert.equal(ready.cache_mode, "live");
  assert.ok(names.includes("public-v2:live")); assert.ok(names.includes("public-v2:synthetic"));
});

test("published statistics retain their own percent, cohort, source context and native numeric text through warming", async t => {
  const context = { observation_id: `observation:${"d".repeat(64)}`, identity_variant_index: 1, scope_status: "review_pending" };
  const cell = { value: "84.10", status: "pending_metadata", reason_code: "SOURCE_DEFINITION_UNIT_OR_QUALIFICATION_PENDING",
    unit: "점", statistic_label: "평균", statistic_percent: null, basis_code: "published_standard_score", basis_label: "표준점수",
    cohort: "initial_admits", cohort_code: "initial_admits", cohort_label: "최초합격자", source_as_of: "2026-09-10",
    source_url: "https://example.edu/results", source_context: context };
  const entries = [cell, { ...cell, value: "__STAT_NUMBER__", statistic_label: "90%컷", statistic_percent: 90 },
    { ...cell, value: 0, statistic_label: "최저" }, { ...cell, value: null, statistic_label: "최고" }];
  const w = await world(t, { parts: 1, row: { alternate_cut: { status: "pending_metadata", reason_code: "SOURCE_DEFINITION_UNIT_OR_QUALIFICATION_PENDING", omitted_other_basis_count: 2, entries } } });
  const ready = await w.prepare(), result = await w.module.searchSnapshot(ready, {});
  const alt = result.schools[0].rows[0].alt;
  assert.equal(alt.e.length, 4); assert.equal(alt.om, 2);
  const [mean, cut90, minimum, maximum] = alt.e;
  assert.equal(mean.v, "84.10"); assert.equal(mean.n, undefined); assert.equal(mean.p, null); assert.equal(mean.l, "평균");
  assert.equal(mean.bc, "published_standard_score"); assert.equal(mean.cc, "initial_admits"); assert.equal(mean.co, "최초합격자");
  assert.equal(mean.at, "2026-09-10"); assert.equal(mean.url, "https://example.edu/results"); assert.deepEqual(mean.ctx, { identity_variant_index: 1, scope_status: "review_pending" });
  assert.equal(JSON.stringify(result).includes(context.observation_id), false);
  assert.equal(mean.s, "pending_metadata");
  assert.equal(cut90.v, "84.10000000000000009"); assert.equal(cut90.n, 1); assert.equal(cut90.p, 90);
  assert.equal(minimum.v, "0"); assert.equal(minimum.n, 1); assert.equal(minimum.p, null);
  assert.equal(maximum.v, null); assert.equal(maximum.p, null);
  assert.equal(result.schools[0].rows[0].c50.v, null); assert.equal(result.schools[0].rows[0].c70.v, null);
});

test("published statistic labels preserve source wording and do not turn a mean or missing percent into a cut", async () => {
  const { publishedStatisticLabel } = await import("../src/lib/p1-shape.ts");
  const base = { v: "10.00", s: "pending_metadata", r: "SOURCE_DEFINITION_UNIT_OR_QUALIFICATION_PENDING", u: "점", l: null };
  assert.equal(publishedStatisticLabel({ ...base, l: "최초합격자\n평균", p: null }), "최초합격자\n평균");
  assert.equal(publishedStatisticLabel({ ...base, p: 80 }), "80%컷");
  assert.equal(publishedStatisticLabel({ ...base, p: null }), "발표 기준 확인 중");
  assert.equal(publishedStatisticLabel({ ...base, p: 0 }), "발표 기준 확인 중");
  assert.equal(publishedStatisticLabel({ ...base, p: 101 }), "발표 기준 확인 중");
});
