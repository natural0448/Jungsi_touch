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

async function world(t, { parts = 2, schools = 1, missing = false, row = {}, rowsOf = null, schema = "synthetic.v1", body = {}, headExtra = {} } = {}) {
  const priorMode = process.env.JUNGSI_API_MODE, priorNode = process.env.NODE_ENV;
  process.env.JUNGSI_API_MODE = "live"; process.env.NODE_ENV = "test";
  const w = { now: Date.parse("2026-10-21T00:00:00Z"), headCalls: 0, partCalls: 0, reads: [], writes: [], cache: new Map(), delayedKey: null };
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
  w.kv = { async get(key) { w.reads.push(key); return key === w.delayedKey ? null : w.cache.get(key) ?? null; }, async put(key, value) {
    // Any repeated key inside one second models the documented native KV constraint.
    const previous = w.writes.findLast(x => x.key === key);
    if (previous && w.now - previous.at < 1000) throw Error("synthetic_KV_429_same_key");
    w.writes.push({ key, at: w.now }); w.cache.set(key, value);
  } };
  globalThis.__p1TestBindings = { env: missing ? {} : { JT_SHARED_CACHE: w.kv, JT_P1_COORDINATOR: { getByName(name) {
    assert.equal(name, "public-v2:live"); return { fetch: request => w.actor.fetch(request) };
  } } } };
  const pins = [], bodies = new Map();
  let total = 0;
  for (let i = 0; i < parts; i++) {
    const part = `part${i}`, university = `TEST${i % schools}`;
    const rows = rowsOf ? rowsOf(i, university) : [{
      university_id: university, university_name: `가상대학교${i % schools}`, academic_year: 2026,
      original_pk: `pk${i}`, department: `가상학과${i}`, region: "가상지역", group: "가",
      competition_ratio: { value: "__EXACT_NUMBER__", status: "ready", unit: "대1" },
      ...row,
    }];
    const format = schema === "jungsi.history-snapshot/v2" ? schema : "jungsi.history-snapshot/v1";
    const json = JSON.stringify({ format, part_id: part, payload_id: `payload${i}`, rows, ...body }).replace('"__EXACT_NUMBER__"', "9.71000000000000009").replace('"__STAT_NUMBER__"', "84.10000000000000009");
    const decoded = encode.encode(json), gzip = gzipSync(decoded), pending = rows.filter(r => r.original_pk === null).length;
    pins.push({ part_id: part, payload_id: `payload${i}`, gzip_bytes: gzip.length, gzip_sha256: await sha(gzip), decoded_bytes: decoded.length, decoded_sha256: await sha(decoded), rows: rows.length, mapped_rows: rows.length - pending, mapping_pending_rows: pending });
    bodies.set(part, i % 2 ? decoded : gzip); total += rows.length;
  }
  const pendingRows = pins.reduce((n, p) => n + p.mapping_pending_rows, 0);
  w.head = { format: "jungsi.history-snapshot-head/v1", status: "approved", snapshot_id: "synthetic.snapshot.v1",
    publication_sha256: "a".repeat(64), source_head_sha256: "b".repeat(64), generated_at: "2026-10-20T00:00:00Z", source_as_of: null,
    schema_version: schema, normalization_rules_version: "synthetic.v1", selection_rules_version: "synthetic.v1",
    counts: { rows: total, mapped_rows: total - pendingRows, mapping_pending_rows: pendingRows, schools }, delivery_mode: "parts", full: null, parts: pins, expires_at: "2099-01-01T00:00:00Z", ...headExtra };
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

async function partialSchool(t, options = {}) {
  const w = await world(t, { parts: 21, ...options });
  for (let i = 0; i < 100; i++) {
    const reads = w.reads.length, calls = w.partCalls;
    const result = await w.module.warmStep(w.source, w.caller);
    assert.ok(w.partCalls - calls <= 6);
    assert.ok(new Set(w.reads.slice(reads).filter(key => key.includes(":frag:"))).size <= 20);
    assert.notEqual(result.state, "ready");
    if (w.state().warm.progress.school_assembly) return w;
  }
  throw Error("synthetic partial school was not reached");
}

test("a 21-fragment school resumes within the existing read budget and preserves every native row", async t => {
  const w = await partialSchool(t, { row: { final_70_percent_cut: { value: "__STAT_NUMBER__", status: "ready", unit: "점", statistic_percent: 70 } } });
  const progress = w.state().warm.progress;
  assert.equal(progress.school_assembly.next_fragment, 20);
  assert.equal(progress.schoolsDone, 0); assert.deepEqual(progress.school_keys, {}); assert.equal(w.state().ready, null);
  assert.ok(!JSON.stringify(progress).includes("9.71000000000000009"));
  assert.ok(!JSON.stringify(progress).includes("84.10000000000000009"));
  const partial = JSON.parse(w.cache.get(progress.school_assembly.key));
  assert.equal(partial.rows.length, 20); assert.equal(partial.fragment_ids.length, 20);
  const reads = w.reads.length;
  await w.module.warmStep(w.source, w.caller);
  assert.equal(w.reads.slice(reads).filter(key => key.includes(":frag:")).length, 1);
  assert.equal(w.state().warm.progress.schoolsDone, 1);
  assert.equal(w.state().warm.progress.school_assembly, undefined);
  const ready = await w.prepare(), result = await w.module.searchSnapshot(ready, {}), rows = result.schools[0].rows;
  assert.equal(result.total_units, 21); assert.equal(rows.length, 21);
  assert.deepEqual(new Set(rows.map(row => row.pk)), new Set(Array.from({ length: 21 }, (_, i) => `pk${i}`)));
  assert.ok(rows.every(row => row.cr.v === "9.71000000000000009" && row.cr.n === 1 && row.c70.v === "84.10000000000000009" && row.c70.n === 1 && row.c70.p === 70));
  assert.equal(w.partCalls, 21); assert.equal(new Set(w.writes.map(x => x.key)).size, w.writes.length);
});

test("a school spanning 41 fragments crosses three fenced assembly steps without widening caps", async t => {
  const w = await partialSchool(t, { parts: 41 });
  assert.equal(w.state().warm.progress.school_assembly.next_fragment, 20);
  let before = w.reads.length;
  await w.second.warmStep(w.source, w.caller);
  assert.equal(w.reads.slice(before).filter(key => key.includes(":frag:")).length, 20);
  assert.equal(w.state().warm.progress.school_assembly.next_fragment, 40); assert.equal(w.state().warm.progress.schoolsDone, 0);
  before = w.reads.length; await w.module.warmStep(w.source, w.caller);
  assert.equal(w.reads.slice(before).filter(key => key.includes(":frag:")).length, 1);
  const ready = await w.prepare(); assert.equal(ready.counts.rows, 41); assert.equal(w.partCalls, 41);
  const result = await w.module.searchSnapshot(ready, {});
  assert.equal(result.total_units, 41); assert.equal(result.schools[0].rows.length, 41);
});

test("two administrators resume a persisted partial school after an actor restart", async t => {
  const w = await partialSchool(t); w.restart();
  await Promise.all([w.module.warmStep(w.source, w.caller), w.second.warmStep(w.source, w.caller)]);
  const ready = await w.prepare(w.second);
  assert.equal(ready.counts.rows, 21); assert.equal(w.partCalls, 21);
  assert.equal(w.state().warm.progress.schoolsDone, 1);
  assert.equal(new Set(w.writes.map(x => x.key)).size, w.writes.length);
});

test("an invisible partial-school KV object stays pending and resumes without rereading source parts", async t => {
  const w = await partialSchool(t), pending = structuredClone(w.state().warm.progress.school_assembly);
  w.delayedKey = pending.key;
  await assert.rejects(w.module.warmStep(w.source, w.caller), e => e.code === "p1_cache_visibility_pending");
  assert.deepEqual(w.state().warm.progress.school_assembly, pending); assert.equal(w.state().ready, null);
  assert.deepEqual(w.state().warm.progress.school_keys, {});
  w.delayedKey = null; const ready = await w.prepare();
  assert.equal(ready.counts.rows, 21); assert.equal(w.partCalls, 21);
});

test("an expired partial-school claimant cannot overwrite a newer fenced completion", async t => {
  const w = await partialSchool(t), pending = w.state().warm.progress.school_assembly;
  const get = w.kv.get; let release, entered, first = true;
  const blocked = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  w.kv.get = async key => { if (key === pending.key && first) { first = false; entered(); await blocked; } return get(key); };
  const old = w.module.warmStep(w.source, w.caller); await started;
  w.now += 120001; await w.second.warmStep(w.source, w.caller);
  const step = w.state().warm.step, writes = w.writes.length;
  release(); await old;
  assert.equal(w.state().warm.step, step); assert.equal(w.writes.length, writes);
  const ready = await w.prepare(); assert.equal(ready.counts.rows, 21); assert.equal(w.partCalls, 21);
});

test("a head change while resuming a partial school never publishes the old generation", async t => {
  const w = await partialSchool(t), pending = w.state().warm.progress.school_assembly, oldGeneration = w.state().warm.generation;
  const get = w.kv.get; let release, entered, first = true;
  const blocked = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  w.kv.get = async key => { if (key === pending.key && first) { first = false; entered(); await blocked; } return get(key); };
  const old = w.module.warmStep(w.source, w.caller); await started;
  const client = p1CoordinatorClient({ fetch: request => w.actor.fetch(request) }), view = await client.inspect();
  const claim = await client.claimHead(view.headRevision); assert.equal(claim.state, "claimed");
  w.head.snapshot_id = "synthetic.changed.during.partial"; w.head.publication_sha256 = "e".repeat(64);
  await client.commitHead(claim.token, w.head); await w.second.warmStep(w.source, w.caller);
  const generation = w.state().warm.generation; assert.notEqual(generation, oldGeneration);
  release(); await old; assert.equal(w.state().ready, null);
  const ready = await w.prepare(w.second);
  assert.equal(ready.snapshot_id, w.head.snapshot_id); assert.equal(ready.publication_sha256, w.head.publication_sha256);
  assert.ok(Object.values(w.state().warm.progress.school_keys).every(key => key.startsWith(`p1c:v1:${generation}:`)));
  assert.ok(w.cache.has(pending.key));
});

test("partial-school metadata rejects a wrong school, offset, step or fenced key", async t => {
  const mutations = {
    school: p => { p.school_id = "OTHER"; }, zero: p => { p.next_fragment = 0; },
    end: p => { p.next_fragment = 21; }, fractional: p => { p.next_fragment = 1.5; },
    step: p => { p.step++; }, futureFence: p => { p.write_prefix = p.write_prefix.replace(/:f[0-9]+:/, ":f999999:"); p.key = `${p.write_prefix}:school-partial:${p.school_id}`; },
    generation: p => { p.write_prefix = "p1c:v1:foreign:f1:n"; p.key = `${p.write_prefix}:school-partial:${p.school_id}`; },
    key: p => { p.key += ":other"; },
  };
  for (const [name, change] of Object.entries(mutations)) await t.test(name, async t => {
    const w = await partialSchool(t), state = w.state(); change(state.warm.progress.school_assembly);
    w.db.prepare("UPDATE p1_coordinator_state SET body=? WHERE id=1").run(JSON.stringify(state));
    await assert.rejects(w.module.warmStep(w.source, w.caller), e => e.code === (name === "fractional" ? "p1_coordinator_state_invalid" : "p1_cache_partial_binding_invalid"));
    assert.equal(w.state().ready, null); assert.deepEqual(w.state().warm.progress.school_keys, {});
  });
});

test("partial-school payload must match the current publication, generation and exact fragment order", async t => {
  const mutations = {
    publication: p => { p.publication_sha256 = "d".repeat(64); }, snapshot: p => { p.snapshot_id += ".other"; },
    generation: p => { p.generation = "foreign"; }, school: p => { p.school_id = "OTHER"; },
    order: p => { [p.fragment_ids[0], p.fragment_ids[1]] = [p.fragment_ids[1], p.fragment_ids[0]]; },
    count: p => { p.fragment_ids.pop(); }, rows: p => { p.rows = null; },
  };
  for (const [name, change] of Object.entries(mutations)) await t.test(name, async t => {
    const w = await partialSchool(t), key = w.state().warm.progress.school_assembly.key, partial = JSON.parse(w.cache.get(key));
    change(partial); w.cache.set(key, JSON.stringify(partial));
    await assert.rejects(w.module.warmStep(w.source, w.caller), e => e.code === "p1_cache_partial_binding_invalid");
    assert.equal(w.state().ready, null); assert.deepEqual(w.state().warm.progress.school_keys, {});
  });
});

test("the existing twelve-school completion and six-part step caps remain bounded", async t => {
  const w = await world(t, { parts: 33, schools: 33 }); let priorSchools = 0;
  for (let i = 0; i < 100; i++) {
    const reads = w.reads.length, calls = w.partCalls, result = await w.module.warmStep(w.source, w.caller);
    const completed = w.state().warm.progress.schoolsDone;
    assert.ok(completed - priorSchools <= 12); priorSchools = completed;
    assert.ok(w.partCalls - calls <= 6);
    assert.ok(new Set(w.reads.slice(reads).filter(key => key.includes(":frag:"))).size <= 20);
    if (result.state === "ready") { assert.equal(result.ready.counts.rows, 33); assert.equal(completed, 33); return; }
  }
  assert.fail("synthetic bounded school preparation did not finish");
});

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

/* ── 2027 모집행 수신(담당자 1.9.141 schema v2, r27_source·r27_scope_coverage) ── */
const coverage = { status: "partial", source_rows: 10, included_rows: 3, excluded_rows: 2, review_pending_rows: 5 };
const r27Row = (university, pk, quota, links = []) => ({
  university_id: university, university_name: "가상대학교0", academic_year: 2027, original_pk: pk, department: "가상학과", region: "가상지역", group: "가",
  mapping_status: "mapped", recruitment_count_with_stage: { value: null, status: "pending_value_missing", stage: "unspecified" },
  r27_source: { scope_key: `scope:${pk}`, scope_review: "eligible", quota, quota_review_status: quota.quota_literal_state ? "condition_present" : "source_stage_only",
    history_link_status: links.length ? "exact_reviewed" : "not_reviewed", history_link_pending_years: [],
    historical_links: links.map(([y, p]) => ({ academic_year: y, school_id: university, original_pk: p, campus: null, admission_track: null, group: "가" })) },
});
const pastRow = (university, year, pk) => ({ university_id: university, university_name: "가상대학교0", academic_year: year, original_pk: pk, department: "가상학과", region: "가상지역", group: "가" });

test("a v2 partial publication keeps 2027 quotas verbatim and groups only server-reviewed history", async t => {
  const w = await world(t, { parts: 1, schema: "jungsi.history-snapshot/v2", headExtra: { r27_scope_coverage: coverage }, body: { r27_scope_coverage: coverage },
    rowsOf: (_i, u) => [
      r27Row(u, "k27a", { quota_value: 12, quota_literal_state: "conditional_carryover", quota_stage: "initial", quota_condition_text: "수시 미충원 인원 이월" }, [[2026, "p26a"], [2025, "p25a"]]),
      r27Row(u, "k27b", { quota_value: null, quota_literal_state: "conditional_transfer", quota_stage: null }, [[2026, "shared"]]),
      r27Row(u, "k27c", { quota_value: "0", quota_literal_state: null, quota_stage: "final" }, [[2026, "shared"]]),
      pastRow(u, 2026, "p26a"), pastRow(u, 2025, "p25a"), pastRow(u, 2026, "shared"), pastRow(u, 2024, "alone"),
    ] });
  const ready = await w.prepare();
  assert.deepEqual(ready.r27_scope_coverage, coverage);
  const result = await w.module.searchSnapshot(ready, {}), rows = result.schools[0].rows;
  const { unitKey, r27Summary } = await import("../src/lib/p1-shape.ts");
  const keyOf = pk => unitKey(rows.find(r => r.pk === pk));
  // Reviewed links join the 2027 row; a past row claimed by two 2027 rows and an unlinked one stay separate.
  assert.equal(keyOf("p26a"), "pk:k27a"); assert.equal(keyOf("p25a"), "pk:k27a");
  assert.equal(keyOf("shared"), "pk:shared"); assert.equal(keyOf("alone"), "pk:alone");
  assert.equal(result.total_units, 5);
  const a = rows.find(r => r.pk === "k27a");
  assert.deepEqual(a.q27, { v: "12", ls: "conditional_carryover", st: "initial", ct: "수시 미충원 인원 이월", cs: null, rs: "condition_present" });
  assert.deepEqual(a.hl, ["2026|p26a", "2025|p25a"]);
  const units = await w.module.unitRows(ready, "TEST0", "pk:k27a");
  assert.deepEqual(units.map(r => r.y).sort(), [2025, 2026, 2027]);
  assert.equal(r27Summary(a.q27).carry, true); assert.equal(r27Summary(a.q27).v, "12");
  // A native zero stays zero; it is never replaced by a missing value.
  assert.equal(r27Summary(rows.find(r => r.pk === "k27c").q27).v, "0");
});

test("2027 coverage must match between head and every part, and v2 heads refuse v1 bodies", async t => {
  const one = (u) => [pastRow(u, 2026, "p")];
  const cases = [
    { schema: "jungsi.history-snapshot/v2", headExtra: { r27_scope_coverage: coverage }, body: { r27_scope_coverage: { ...coverage, excluded_rows: 1, review_pending_rows: 6 } } },
    { schema: "jungsi.history-snapshot/v2", headExtra: { r27_scope_coverage: coverage } },
    { schema: "jungsi.history-snapshot/v2", headExtra: { r27_scope_coverage: coverage }, body: { r27_scope_coverage: { ...coverage, note: "x" } } },
    { body: { r27_scope_coverage: coverage } },
    { schema: "jungsi.history-snapshot/v2", body: { format: "jungsi.history-snapshot/v1" } },
  ];
  for (const c of cases) {
    const w = await world(t, { parts: 1, rowsOf: (_i, u) => one(u), ...c });
    await assert.rejects(w.prepare(), /p1_part_invalid/);
  }
});

test("the public head accepts r27_scope_coverage only as an exact, internally consistent v2 partial disclosure", async () => {
  const { validatePublicHead } = await import("../src/lib/p1-coordinator-core.ts");
  const pin = { part_id: "p0", payload_id: "y0", gzip_bytes: 1, gzip_sha256: "c".repeat(64), decoded_bytes: 1, decoded_sha256: "d".repeat(64), rows: 1, mapped_rows: 1, mapping_pending_rows: 0 };
  const head = { format: "jungsi.history-snapshot-head/v1", status: "approved", snapshot_id: "s1", publication_sha256: "a".repeat(64), source_head_sha256: "b".repeat(64),
    generated_at: "2026-10-20T00:00:00Z", source_as_of: null, schema_version: "jungsi.history-snapshot/v2", normalization_rules_version: "n", selection_rules_version: "s",
    counts: { rows: 1, mapped_rows: 1, mapping_pending_rows: 0, schools: 1 }, delivery_mode: "parts", full: null, parts: [pin], expires_at: "2099-01-01T00:00:00Z" };
  const now = Date.parse("2026-11-02T00:00:00Z");
  assert.equal(validatePublicHead({ ...head }, now).r27_scope_coverage, undefined);
  assert.deepEqual(validatePublicHead({ ...head, r27_scope_coverage: coverage }, now).r27_scope_coverage, coverage);
  for (const bad of [
    { ...coverage, status: "complete" }, { ...coverage, review_pending_rows: 0, excluded_rows: 7 }, { ...coverage, included_rows: 0, excluded_rows: 5 },
    { ...coverage, source_rows: 11 }, { ...coverage, extra: 1 }, { ...coverage, included_rows: 3.5 }, null, [],
  ]) assert.throws(() => validatePublicHead({ ...head, r27_scope_coverage: bad }, now), /p1_head_invalid|p1_coordinator_metadata_invalid/);
  assert.throws(() => validatePublicHead({ ...head, schema_version: "jungsi.history-snapshot/v1", r27_scope_coverage: coverage }, now), /p1_head_invalid/);
});

test("the 2027 quota summary shows source wording and never turns carryover or unknown states into a number", async () => {
  const { r27Summary } = await import("../src/lib/p1-shape.ts");
  const q = (o) => ({ v: null, ls: null, st: null, ct: null, cs: null, rs: "source_stage_only", ...o });
  const pick = s => [s.hold, s.v, s.carry, s.initial];
  assert.deepEqual(pick(r27Summary(q({ v: "12", st: "final" }))), [false, "12", false, false]);
  assert.deepEqual(pick(r27Summary(q({ v: "12", st: "initial" }))), [false, "12", false, true]);
  assert.deepEqual(pick(r27Summary(q({ v: "12", ls: "conditional_carryover", st: "initial" }))), [false, "12", true, false]);
  assert.deepEqual(pick(r27Summary(q({ v: "0", ls: "conditional_transfer" }))), [false, "0", true, false]);
  const only = r27Summary(q({ ls: "conditional_carryover" }));
  assert.deepEqual(pick(only), [false, null, true, false]);
  assert.match(only.note, /남은 인원이 있을 때만/);
  assert.equal(r27Summary(q({ v: null })).hold, true);
  assert.equal(r27Summary(q({ v: "12", ls: "unknown_future_state" })).hold, true);
  assert.equal(r27Summary(q({ v: "약 10", ls: "conditional_carryover" })).hold, true);
  assert.equal(r27Summary(q({ v: "12", rs: "source_conflict" })).hold, true);
  assert.equal(r27Summary(undefined).hold, true);
  assert.equal(r27Summary(q({ v: "12", cs: "pending_metadata" })).check, true);
  assert.match(r27Summary(q({ v: "3", ct: "수시 미충원 시 이월" })).note, /모집요강: 수시 미충원 시 이월/);
});
